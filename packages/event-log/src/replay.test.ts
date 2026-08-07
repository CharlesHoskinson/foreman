import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_LOG_SCHEMA_VERSION,
  MAX_PHYSICAL_LINE_BYTES,
  MAX_PHYSICAL_LINES,
  MAX_REPLAY_INPUT_BYTES,
  replayNdjson,
  replayNdjsonBytes,
  replayNdjsonText,
  type ReplayResult,
  type StoredEvent,
} from "./index.js";

const enc = new TextEncoder();

function eventLine(
  seq: number,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    seq,
    ts: "2026-08-04T12:00:00Z",
    type: "heartbeat",
    lane: "grok",
    payload: { n: seq },
    ...extra,
  });
}

function logOf(lines: string[], eol = "\n"): string {
  return lines.map((l) => l + eol).join("");
}

function assertClean(r: ReplayResult, lineCount: number, recordCount: number): void {
  assert.equal(r.schemaVersion, EVENT_LOG_SCHEMA_VERSION);
  assert.equal(r.terminal._tag, "CleanEof");
  assert.equal(r.validPhysicalLines, lineCount);
  assert.equal(r.records.length, recordCount);
}

describe("replayNdjson basics", () => {
  it("empty bytes is clean EOF at cursor 0", () => {
    const r = replayNdjsonText("", { fromLine: 0 });
    assertClean(r, 0, 0);
  });

  it("missing/empty iterable is clean EOF", () => {
    const r = replayNdjson([], { fromLine: 0 });
    assertClean(r, 0, 0);
  });

  it("replays a single valid LF-terminated event", () => {
    const r = replayNdjsonText(logOf([eventLine(1)]), { fromLine: 0 });
    assertClean(r, 1, 1);
    assert.equal(r.records[0]!.physicalLine, 1);
    assert.equal(r.records[0]!.event.seq, 1);
  });

  it("LF and CRLF produce the same decoded event", () => {
    const line = eventLine(1);
    const lf = replayNdjsonText(line + "\n", { fromLine: 0 });
    const crlf = replayNdjsonText(line + "\r\n", { fromLine: 0 });
    assertClean(lf, 1, 1);
    assertClean(crlf, 1, 1);
    assert.deepEqual(lf.records[0]!.event, crlf.records[0]!.event);
  });

  it("does not rewrite source: CRLF log still validates only by bytes", () => {
    const body = eventLine(1) + "\r\n" + eventLine(2) + "\r\n";
    const r = replayNdjsonText(body, { fromLine: 0 });
    assertClean(r, 2, 2);
    assert.equal(r.records[0]!.event.seq, 1);
    assert.equal(r.records[1]!.event.seq, 2);
  });

  it("allows seq 0 then gaps, rejects duplicates and decreases", () => {
    const ok = replayNdjsonText(
      logOf([eventLine(0), eventLine(5), eventLine(10)]),
      { fromLine: 0 },
    );
    assertClean(ok, 3, 3);

    const dup = replayNdjsonText(
      logOf([eventLine(1), eventLine(1)]),
      { fromLine: 0 },
    );
    assert.equal(dup.terminal._tag, "Stopped");
    if (dup.terminal._tag === "Stopped") {
      assert.equal(dup.terminal.reason, "sequence_duplicate");
      assert.equal(dup.terminal.line, 2);
    }
    assert.equal(dup.validPhysicalLines, 1);
    assert.equal(dup.records.length, 1);

    const dec = replayNdjsonText(
      logOf([eventLine(5), eventLine(3)]),
      { fromLine: 0 },
    );
    assert.equal(dec.terminal._tag, "Stopped");
    if (dec.terminal._tag === "Stopped") {
      assert.equal(dec.terminal.reason, "sequence_not_monotonic");
    }
    assert.equal(dec.validPhysicalLines, 1);
  });

  it("torn final valid JSON stops without accepting the line", () => {
    const body = eventLine(1); // no trailing LF
    const r = replayNdjsonText(body, { fromLine: 0 });
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "torn_tail");
      assert.equal(r.terminal.line, 1);
    }
    assert.equal(r.validPhysicalLines, 0);
    assert.equal(r.records.length, 0);
  });

  it("malformed middle line preserves valid prefix only", () => {
    const body = logOf([eventLine(1), "{not-json", eventLine(3)]);
    const r = replayNdjsonText(body, { fromLine: 0 });
    assert.equal(r.validPhysicalLines, 1);
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0]!.event.seq, 1);
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "invalid_json");
      assert.equal(r.terminal.line, 2);
    }
  });

  it("corrupt line before cursor still fails closed", () => {
    const body = logOf(["{bad}", eventLine(2), eventLine(3)]);
    const r = replayNdjsonText(body, { fromLine: 2 });
    assert.equal(r.validPhysicalLines, 0);
    assert.equal(r.records.length, 0);
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.line, 1);
      assert.equal(r.terminal.reason, "invalid_json");
    }
  });

  it("fromLine skips emission but validates sequence across prefix", () => {
    const body = logOf([eventLine(1), eventLine(2), eventLine(3)]);
    const r = replayNdjsonText(body, { fromLine: 2 });
    assertClean(r, 3, 1);
    assert.equal(r.records[0]!.physicalLine, 3);
    assert.equal(r.records[0]!.event.seq, 3);
  });

  it("cursor at EOF yields no records and clean EOF", () => {
    const body = logOf([eventLine(1), eventLine(2)]);
    const r = replayNdjsonText(body, { fromLine: 2 });
    assertClean(r, 2, 0);
  });

  it("cursor beyond EOF fails closed", () => {
    const body = logOf([eventLine(1)]);
    const r = replayNdjsonText(body, { fromLine: 5 });
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "cursor_beyond_eof");
    }
    assert.equal(r.validPhysicalLines, 1);
    assert.equal(r.records.length, 0);
  });

  it("cursor beyond empty log fails closed", () => {
    const r = replayNdjsonText("", { fromLine: 1 });
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "cursor_beyond_eof");
    }
  });

  it("physical line is independent of sequence values", () => {
    const body = logOf([eventLine(10), eventLine(20)]);
    const r = replayNdjsonText(body, { fromLine: 0 });
    assert.equal(r.records[0]!.physicalLine, 1);
    assert.equal(r.records[0]!.event.seq, 10);
    assert.equal(r.records[1]!.physicalLine, 2);
    assert.equal(r.records[1]!.event.seq, 20);
  });
});

describe("replay chunk boundary invariance", () => {
  it("identical output for every single-byte split of a valid log", () => {
    const body = logOf([eventLine(1), eventLine(2)]);
    const bytes = enc.encode(body);
    const baseline = replayNdjsonBytes(bytes, { fromLine: 0 });
    assertClean(baseline, 2, 2);

    for (let split = 0; split <= bytes.byteLength; split += 1) {
      const left = bytes.subarray(0, split);
      const right = bytes.subarray(split);
      const r = replayNdjson([left, right], { fromLine: 0 });
      assert.equal(r.terminal._tag, baseline.terminal._tag, `split ${split}`);
      assert.equal(r.validPhysicalLines, baseline.validPhysicalLines);
      assert.equal(r.records.length, baseline.records.length);
      for (let i = 0; i < r.records.length; i += 1) {
        assert.equal(r.records[i]!.physicalLine, baseline.records[i]!.physicalLine);
        assert.deepEqual(r.records[i]!.event, baseline.records[i]!.event);
      }
    }
  });

  it("multi-byte UTF-8 value split at every byte boundary succeeds", () => {
    // Euro sign U+20AC is E2 82 AC
    const line = JSON.stringify({
      seq: 1,
      ts: "2026-08-04T12:00:00Z",
      type: "note",
      lane: "grok",
      payload: { msg: "price €42" },
    });
    const body = line + "\n";
    const bytes = enc.encode(body);
    const baseline = replayNdjsonBytes(bytes, { fromLine: 0 });
    assertClean(baseline, 1, 1);
    assert.equal((baseline.records[0]!.event as StoredEvent).payload["msg"], "price €42");

    for (let split = 0; split <= bytes.byteLength; split += 1) {
      const r = replayNdjson(
        [bytes.subarray(0, split), bytes.subarray(split)],
        { fromLine: 0 },
      );
      assert.equal(r.terminal._tag, "CleanEof", `split ${split}`);
      assert.equal(r.records[0]!.event.payload["msg"], "price €42");
    }
  });

  it("CRLF split between CR and LF still yields one line", () => {
    const line = eventLine(1);
    const bytes = enc.encode(line + "\r\n");
    const crIndex = bytes.byteLength - 2;
    const r = replayNdjson(
      [bytes.subarray(0, crIndex + 1), bytes.subarray(crIndex + 1)],
      { fromLine: 0 },
    );
    assertClean(r, 1, 1);
  });
});

describe("replay bounds exact acceptance", () => {
  it("accepts a line of exactly MAX_PHYSICAL_LINE_BYTES content", () => {
    // Build compact event and pad payload string to exact content length.
    const prefix =
      '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{"p":"';
    const suffix = '"}}';
    const pad = MAX_PHYSICAL_LINE_BYTES - prefix.length - suffix.length;
    assert.ok(pad > 0, "fixture pad must be positive");
    const line = prefix + "x".repeat(pad) + suffix;
    assert.equal(enc.encode(line).byteLength, MAX_PHYSICAL_LINE_BYTES);
    const r = replayNdjsonText(line + "\n", { fromLine: 0 });
    assertClean(r, 1, 1);
  });

  it("rejects a line one byte over MAX_PHYSICAL_LINE_BYTES", () => {
    const content = "y".repeat(MAX_PHYSICAL_LINE_BYTES + 1);
    const r = replayNdjsonText(content + "\n", { fromLine: 0 });
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "line_too_large");
      assert.equal(r.terminal.line, 1);
    }
    assert.equal(r.validPhysicalLines, 0);
  });

  it("accepts total input exactly at MAX_REPLAY_INPUT_BYTES with valid prefix", () => {
    // Use maximum-size valid records, then one smaller final valid record.
    // fromLine skips retention of the first 63 decoded payloads while still
    // requiring every physical line to validate.
    function* exactBudgetChunks(): Iterable<Uint8Array> {
      let used = 0;
      let seq = 1;
      while (true) {
        const pfx =
          `{"seq":${seq},"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{"p":"`;
        const sfx = '"}}';
        const padLen = MAX_PHYSICAL_LINE_BYTES - pfx.length - sfx.length;
        assert.ok(padLen > 0);
        const b = enc.encode(pfx + "x".repeat(padLen) + sfx + "\n");
        if (used + b.byteLength > MAX_REPLAY_INPUT_BYTES) {
          break;
        }
        used += b.byteLength;
        yield b;
        seq += 1;
      }

      const remain = MAX_REPLAY_INPUT_BYTES - used;
      assert.ok(remain > 1 && remain <= MAX_PHYSICAL_LINE_BYTES + 1);
      const pfx =
        `{"seq":${seq},"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{"p":"`;
      const sfx = '"}}';
      const padLen = remain - 1 - pfx.length - sfx.length;
      assert.ok(padLen >= 0);
      yield enc.encode(pfx + "x".repeat(padLen) + sfx + "\n");
    }

    // Count total bytes produced
    let total = 0;
    const chunks: Uint8Array[] = [];
    for (const c of exactBudgetChunks()) {
      total += c.byteLength;
      chunks.push(c);
    }
    assert.equal(total, MAX_REPLAY_INPUT_BYTES);
    const r = replayNdjson(chunks, { fromLine: chunks.length - 1 });
    assertClean(r, chunks.length, 1);
    assert.equal(r.records[0]!.physicalLine, chunks.length);
  });

  it("rejects input one byte over MAX_REPLAY_INPUT_BYTES preserving prior valid lines", () => {
    // Near-max-size valid lines so total input can reach the 64 MiB bound
    // without hitting too_many_lines (100k) or line_too_large (1 MiB content).
    function maxContentLine(seq: number): Uint8Array {
      const pfx = `{"seq":${seq},"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{"p":"`;
      const sfx = '"}}';
      const pad = MAX_PHYSICAL_LINE_BYTES - pfx.length - sfx.length;
      assert.ok(pad > 0);
      return enc.encode(pfx + "x".repeat(pad) + sfx + "\n");
    }
    function* overBudget(): Iterable<Uint8Array> {
      let used = 0;
      let seq = 1;
      while (true) {
        const b = maxContentLine(seq);
        if (used + b.byteLength > MAX_REPLAY_INPUT_BYTES) break;
        used += b.byteLength;
        yield b;
        seq += 1;
      }
      const remain = MAX_REPLAY_INPUT_BYTES - used;
      if (remain > 0) {
        // Start the next physical line without LF; stay under line byte bound.
        assert.ok(remain <= MAX_PHYSICAL_LINE_BYTES);
        yield new Uint8Array(remain).fill(0x41);
      }
      yield new Uint8Array([0x42]); // one byte past total input bound
    }
    // Large fromLine avoids retaining huge payload records in the result.
    const r = replayNdjson(overBudget(), { fromLine: Number.MAX_SAFE_INTEGER });
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "input_too_large");
    }
    assert.ok(r.validPhysicalLines >= 1);
    assert.equal(r.records.length, 0);
  });

  it("accepts exactly MAX_PHYSICAL_LINES and rejects plus one", () => {
    // Streaming: do not hold 100k lines as one string.
    function* nLines(n: number): Iterable<Uint8Array> {
      for (let i = 1; i <= n; i += 1) {
        yield enc.encode(eventLine(i) + "\n");
      }
    }
    const ok = replayNdjson(nLines(MAX_PHYSICAL_LINES), { fromLine: 0 });
    assert.equal(ok.terminal._tag, "CleanEof");
    assert.equal(ok.validPhysicalLines, MAX_PHYSICAL_LINES);
    // records would be 100k — heavy but required for correctness.
    // To reduce memory of asserted records, only check counts.
    assert.equal(ok.records.length, MAX_PHYSICAL_LINES);

    const over = replayNdjson(nLines(MAX_PHYSICAL_LINES + 1), { fromLine: 0 });
    assert.equal(over.terminal._tag, "Stopped");
    if (over.terminal._tag === "Stopped") {
      assert.equal(over.terminal.reason, "too_many_lines");
      assert.equal(over.terminal.line, MAX_PHYSICAL_LINES + 1);
    }
    assert.equal(over.validPhysicalLines, MAX_PHYSICAL_LINES);
  });
});

describe("replay deep nesting preflight", () => {
  const EVENT_PREFIX =
    '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":';

  it("deep nested line stops with event_structure_limit and never throws", () => {
    const n = 12_000;
    const line = EVENT_PREFIX + "[".repeat(n) + "0" + "]".repeat(n) + "}\n";
    let threw: unknown;
    let r: ReplayResult | undefined;
    try {
      r = replayNdjsonText(line, { fromLine: 0 });
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, undefined, "must not throw RangeError");
    assert.ok(r !== undefined);
    assert.equal(r!.terminal._tag, "Stopped");
    if (r!.terminal._tag === "Stopped") {
      assert.equal(r!.terminal.reason, "event_structure_limit");
      assert.equal(r!.terminal.line, 1);
    }
    assert.equal(r!.validPhysicalLines, 0);
    assert.equal(r!.records.length, 0);
    const json = JSON.stringify(r);
    assert.equal(json.includes("RangeError"), false);
    assert.equal(json.includes("Maximum call"), false);
    assert.equal(json.includes("[[[["), false);
  });

  it("prior valid events are kept when a later deep line stops replay", () => {
    const n = 12_000;
    const deep =
      EVENT_PREFIX + "[".repeat(n) + "0" + "]".repeat(n) + "}\n";
    const body = logOf([eventLine(1), eventLine(2)]) + deep;
    const r = replayNdjsonText(body, { fromLine: 0 });
    assert.equal(r.terminal._tag, "Stopped");
    if (r.terminal._tag === "Stopped") {
      assert.equal(r.terminal.reason, "event_structure_limit");
      assert.equal(r.terminal.line, 3);
    }
    assert.equal(r.validPhysicalLines, 2);
    assert.equal(r.records.length, 2);
    assert.equal(r.records[0]!.event.seq, 1);
    assert.equal(r.records[1]!.event.seq, 2);
  });

  it("string-embedded delimiters do not stop replay as structure limit", () => {
    const braces = "[".repeat(200) + "{".repeat(200);
    const line = eventLine(1, { payload: { note: braces } });
    const r = replayNdjsonText(line + "\n", { fromLine: 0 });
    assertClean(r, 1, 1);
    assert.equal(r.records[0]!.event.payload["note"], braces);
  });
});

describe("replay failure hygiene", () => {
  it("stopped results contain no absolute paths or stacks", () => {
    const r = replayNdjsonText("{bad}\n", { fromLine: 0 });
    const json = JSON.stringify(r);
    assert.equal(json.includes("/home"), false);
    assert.equal(json.includes("Error"), false);
    assert.equal(json.includes("at "), false);
    assert.equal(r.terminal._tag, "Stopped");
  });
});
