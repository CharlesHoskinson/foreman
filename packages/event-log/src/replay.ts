import {
  EVENT_LOG_SCHEMA_VERSION,
  MAX_PHYSICAL_LINE_BYTES,
  MAX_PHYSICAL_LINES,
  MAX_REPLAY_INPUT_BYTES,
} from "./bounds.js";
import {
  isEventDecodeFailure,
  type ReplayStopReason,
} from "./failures.js";
import {
  decodeStoredEventFromBytes,
  type StoredEvent,
} from "./stored-event.js";

/** One decoded record paired with its one-based physical line number. */
export type ReplayRecord = {
  readonly physicalLine: number;
  readonly event: StoredEvent;
};

export type ReplayTerminal =
  | { readonly _tag: "CleanEof" }
  | {
      readonly _tag: "Stopped";
      readonly line: number;
      readonly reason: ReplayStopReason;
    };

/**
 * Closed valid-prefix replay result. Always preserves the valid prefix.
 * Does not mutate or commit a cursor.
 */
export type ReplayResult = {
  readonly schemaVersion: typeof EVENT_LOG_SCHEMA_VERSION;
  readonly records: readonly ReplayRecord[];
  readonly validPhysicalLines: number;
  readonly terminal: ReplayTerminal;
};

export type ReplayOptions = {
  /** Nonnegative safe-integer count of physical lines already consumed. */
  readonly fromLine: number;
};

function cleanResult(
  records: readonly ReplayRecord[],
  validPhysicalLines: number,
): ReplayResult {
  return {
    schemaVersion: EVENT_LOG_SCHEMA_VERSION,
    records,
    validPhysicalLines,
    terminal: { _tag: "CleanEof" },
  };
}

function stoppedResult(
  records: readonly ReplayRecord[],
  validPhysicalLines: number,
  line: number,
  reason: ReplayStopReason,
): ReplayResult {
  return {
    schemaVersion: EVENT_LOG_SCHEMA_VERSION,
    records,
    validPhysicalLines,
    terminal: { _tag: "Stopped", line, reason },
  };
}

function isNonNegativeSafeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * Bounded streaming NDJSON replay over deterministic byte chunks.
 * Works for any chunk boundary (mid UTF-8 sequence, CRLF, last byte of line).
 *
 * - LF terminates a line; exactly one CR immediately before LF is stripped.
 * - Every physical line is validated, including lines at or before fromLine.
 * - Sequence values must increase strictly across the valid prefix; gaps and
 *   an initial zero are permitted; duplicates and decreases stop replay.
 * - A nonempty final fragment without LF is torn_tail.
 * - Clean EOF with fromLine > validPhysicalLines is cursor_beyond_eof.
 * - Does not rewrite source bytes; does not commit a cursor.
 */
export function replayNdjson(
  chunks: Iterable<Uint8Array>,
  options: ReplayOptions,
): ReplayResult {
  const fromLine = options.fromLine;
  if (typeof fromLine !== "number" || !isNonNegativeSafeInteger(fromLine)) {
    // Programmer error: treat as stop with event_schema at line 1 if any
    // data exists; for empty input, still cursor semantics via 0 lines.
    // Prefer a closed stop rather than throw.
    return stoppedResult([], 0, 1, "event_schema");
  }

  const records: ReplayRecord[] = [];
  let validPhysicalLines = 0;
  let lastSeq: number | null = null;
  let totalBytes = 0;
  // Line content buffer (bytes before the terminating LF).
  let lineBuf: number[] = [];
  let sawCrPending = false;

  const finishClean = (): ReplayResult => {
    if (fromLine > validPhysicalLines) {
      return stoppedResult(
        records,
        validPhysicalLines,
        validPhysicalLines === 0 ? 1 : validPhysicalLines,
        "cursor_beyond_eof",
      );
    }
    return cleanResult(records, validPhysicalLines);
  };

  const processCompleteLine = (content: Uint8Array): ReplayResult | null => {
    const nextLine = validPhysicalLines + 1;

    if (validPhysicalLines >= MAX_PHYSICAL_LINES) {
      return stoppedResult(records, validPhysicalLines, nextLine, "too_many_lines");
    }

    if (content.byteLength > MAX_PHYSICAL_LINE_BYTES) {
      return stoppedResult(records, validPhysicalLines, nextLine, "line_too_large");
    }

    const decoded = decodeStoredEventFromBytes(content);
    if (isEventDecodeFailure(decoded)) {
      return stoppedResult(
        records,
        validPhysicalLines,
        nextLine,
        decoded.reason,
      );
    }

    if (lastSeq !== null) {
      if (decoded.seq === lastSeq) {
        return stoppedResult(
          records,
          validPhysicalLines,
          nextLine,
          "sequence_duplicate",
        );
      }
      if (decoded.seq < lastSeq) {
        return stoppedResult(
          records,
          validPhysicalLines,
          nextLine,
          "sequence_not_monotonic",
        );
      }
    }
    lastSeq = decoded.seq;
    validPhysicalLines = nextLine;

    if (nextLine > fromLine) {
      records.push({ physicalLine: nextLine, event: decoded });
    }
    return null;
  };

  for (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      return stoppedResult(records, validPhysicalLines, validPhysicalLines + 1, "event_schema");
    }
    for (let i = 0; i < chunk.byteLength; i += 1) {
      totalBytes += 1;
      if (totalBytes > MAX_REPLAY_INPUT_BYTES) {
        const line = validPhysicalLines + 1;
        return stoppedResult(records, validPhysicalLines, line, "input_too_large");
      }

      const b = chunk[i]!;

      if (b === 0x0a) {
        // LF: strip exactly one CR immediately before LF (already tracked).
        if (sawCrPending) {
          // CR was held out of the buffer; content is lineBuf as-is.
          sawCrPending = false;
        }
        // If previous byte was CR, it was not pushed; if it was pushed by
        // mistake we strip below. Our logic holds CR out of the buffer.
        const content = Uint8Array.from(lineBuf);
        lineBuf = [];
        const stop = processCompleteLine(content);
        if (stop !== null) return stop;
        continue;
      }

      if (sawCrPending) {
        // Previous byte was CR but this is not LF → CR is ordinary content.
        if (lineBuf.length >= MAX_PHYSICAL_LINE_BYTES) {
          return stoppedResult(
            records,
            validPhysicalLines,
            validPhysicalLines + 1,
            "line_too_large",
          );
        }
        lineBuf.push(0x0d);
        sawCrPending = false;
      }

      if (b === 0x0d) {
        sawCrPending = true;
        continue;
      }

      if (lineBuf.length >= MAX_PHYSICAL_LINE_BYTES) {
        return stoppedResult(
          records,
          validPhysicalLines,
          validPhysicalLines + 1,
          "line_too_large",
        );
      }
      lineBuf.push(b);
    }
  }

  // EOF
  if (sawCrPending) {
    // Trailing CR without LF is part of a torn fragment.
    if (lineBuf.length >= MAX_PHYSICAL_LINE_BYTES) {
      return stoppedResult(
        records,
        validPhysicalLines,
        validPhysicalLines + 1,
        "line_too_large",
      );
    }
    lineBuf.push(0x0d);
    sawCrPending = false;
  }

  if (lineBuf.length > 0) {
    return stoppedResult(
      records,
      validPhysicalLines,
      validPhysicalLines + 1,
      "torn_tail",
    );
  }

  return finishClean();
}

/**
 * Convenience: replay from a single contiguous byte array.
 */
export function replayNdjsonBytes(
  bytes: Uint8Array,
  options: ReplayOptions,
): ReplayResult {
  return replayNdjson([bytes], options);
}

/**
 * Convenience: encode text as UTF-8 and replay. Text must already be the
 * log body; this does not reinterpret newlines beyond the byte contract.
 */
export function replayNdjsonText(
  text: string,
  options: ReplayOptions,
): ReplayResult {
  return replayNdjson([new TextEncoder().encode(text)], options);
}
