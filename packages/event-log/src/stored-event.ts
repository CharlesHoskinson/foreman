import {
  decodeUtf8Fatal,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
  rejectUnknownKeys,
} from "@foreman/core";
import {
  eventDecodeFailure,
  type EventDecodeFailure,
  type EventDecodeReason,
} from "./failures.js";
import { checkEventStructure, checkJsonNestingText } from "./structure.js";
import { isUtcSecondTimestamp } from "./timestamp.js";

/**
 * Frozen top-level stored-event record (schema version 1).
 * `type` and `lane` stay opaque and non-empty at this boundary.
 */
export type StoredEvent = {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly lane: string;
  readonly commit?: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

const TOP_LEVEL_KEYS = ["seq", "ts", "type", "lane", "commit", "payload"] as const;

function mapCoreToDecodeReason(tag: string): EventDecodeReason {
  switch (tag) {
    case "MalformedUtf8":
      return "malformed_utf8";
    case "DuplicateJsonKey":
      return "duplicate_key";
    case "InvalidJson":
    case "OversizeInput":
      return "invalid_json";
    default:
      return "event_schema";
  }
}

function isNonNegativeSafeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Decode a frozen top-level stored event from a JSON value.
 * Rejects unknown top-level fields, bad types, structure over-limits, and
 * non-UTC-second timestamps. Does not close over event `type` values.
 */
export function decodeStoredEvent(
  value: unknown,
): StoredEvent | EventDecodeFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return eventDecodeFailure("event_schema");
  }
  const obj = value as Record<string, unknown>;

  const structure = checkEventStructure(obj);
  if (structure !== "ok") {
    return eventDecodeFailure("event_structure_limit");
  }

  const unknown = rejectUnknownKeys(obj, TOP_LEVEL_KEYS);
  if (unknown !== null) {
    return eventDecodeFailure("event_schema");
  }

  if (!("seq" in obj) || !("ts" in obj) || !("type" in obj) || !("lane" in obj) || !("payload" in obj)) {
    return eventDecodeFailure("event_schema");
  }

  const seq = obj["seq"];
  if (typeof seq !== "number" || !isNonNegativeSafeInteger(seq)) {
    return eventDecodeFailure("event_schema");
  }

  const ts = obj["ts"];
  if (typeof ts !== "string" || !isUtcSecondTimestamp(ts)) {
    return eventDecodeFailure("event_schema");
  }

  const type = obj["type"];
  if (!isNonEmptyString(type)) {
    return eventDecodeFailure("event_schema");
  }

  const lane = obj["lane"];
  if (!isNonEmptyString(lane)) {
    return eventDecodeFailure("event_schema");
  }

  const payload = obj["payload"];
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return eventDecodeFailure("event_schema");
  }

  let commit: string | undefined;
  if ("commit" in obj) {
    const c = obj["commit"];
    if (c === null || c === undefined) {
      return eventDecodeFailure("event_schema");
    }
    if (typeof c !== "string" || c.length === 0) {
      return eventDecodeFailure("event_schema");
    }
    commit = c;
  }

  const payloadObj = payload as Record<string, unknown>;
  if (commit !== undefined) {
    return {
      seq,
      ts,
      type,
      lane,
      commit,
      payload: payloadObj,
    };
  }
  return {
    seq,
    ts,
    type,
    lane,
    payload: payloadObj,
  };
}

/**
 * Decode one stored event from UTF-8 JSON text bytes.
 * Maps core UTF-8 / duplicate-key / invalid-JSON failures to closed reasons.
 */
export function decodeStoredEventFromBytes(
  bytes: Uint8Array,
): StoredEvent | EventDecodeFailure {
  const text = decodeUtf8Fatal(bytes);
  if (isCoreFailure(text)) {
    return eventDecodeFailure(mapCoreToDecodeReason(text._tag));
  }
  return decodeStoredEventFromText(text);
}

/**
 * Decode one stored event from a complete JSON text string.
 * Preflight nesting depth on the text (iterative, no recursion), then
 * reject trailing suffix data via the core duplicate-key-refusing parser.
 * Core remains the authority for UTF-8 (bytes path), duplicate keys, and
 * full JSON syntax.
 */
export function decodeStoredEventFromText(
  text: string,
): StoredEvent | EventDecodeFailure {
  if (checkJsonNestingText(text) !== "ok") {
    return eventDecodeFailure("event_structure_limit");
  }
  const parsed = parseJsonRejectDuplicateKeys(text);
  if (isCoreFailure(parsed)) {
    return eventDecodeFailure(mapCoreToDecodeReason(parsed._tag));
  }
  return decodeStoredEvent(parsed);
}
