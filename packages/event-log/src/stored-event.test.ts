import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeStoredEvent,
  decodeStoredEventFromBytes,
  decodeStoredEventFromText,
  isEventDecodeFailure,
  MAX_EVENT_JSON_NODES,
  MAX_EVENT_NESTING_DEPTH,
  type StoredEvent,
} from "./index.js";

function goodEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 1,
    ts: "2026-08-04T12:00:00Z",
    type: "heartbeat",
    lane: "grok",
    payload: { alive: true },
    ...overrides,
  };
}

function goodJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(goodEvent(overrides));
}

describe("decodeStoredEvent known-good", () => {
  it("accepts a minimal valid event", () => {
    const r = decodeStoredEvent(goodEvent());
    assert.ok(!isEventDecodeFailure(r));
    const e = r as StoredEvent;
    assert.equal(e.seq, 1);
    assert.equal(e.ts, "2026-08-04T12:00:00Z");
    assert.equal(e.type, "heartbeat");
    assert.equal(e.lane, "grok");
    assert.equal(e.payload["alive"], true);
    assert.equal("commit" in e, false);
  });

  it("accepts optional non-empty commit", () => {
    const r = decodeStoredEvent(goodEvent({ commit: "a".repeat(40) }));
    assert.ok(!isEventDecodeFailure(r));
    assert.equal((r as StoredEvent).commit, "a".repeat(40));
  });

  it("accepts initial seq 0 (imported sentinel)", () => {
    const r = decodeStoredEvent(goodEvent({ seq: 0 }));
    assert.ok(!isEventDecodeFailure(r));
    assert.equal((r as StoredEvent).seq, 0);
  });

  it("accepts seq gaps at the decoder boundary (no sequence history)", () => {
    const r = decodeStoredEvent(goodEvent({ seq: 99 }));
    assert.ok(!isEventDecodeFailure(r));
    assert.equal((r as StoredEvent).seq, 99);
  });

  it("accepts unknown event types", () => {
    const r = decodeStoredEvent(goodEvent({ type: "custom.vendor.event" }));
    assert.ok(!isEventDecodeFailure(r));
    assert.equal((r as StoredEvent).type, "custom.vendor.event");
  });

  it("accepts unknown payload keys", () => {
    const r = decodeStoredEvent(
      goodEvent({ payload: { attempt: 3, evidence: { x: 1 }, extra: "ok" } }),
    );
    assert.ok(!isEventDecodeFailure(r));
    const p = (r as StoredEvent).payload;
    assert.equal(p["attempt"], 3);
    assert.equal(p["extra"], "ok");
  });

  it("preserves __proto__ as ordinary payload data (no pollution)", () => {
    const parsed = decodeStoredEventFromText(
      '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{"__proto__":{"p":1},"x":2}}',
    );
    assert.ok(!isEventDecodeFailure(parsed));
    const e = parsed as StoredEvent;
    assert.ok(Object.prototype.hasOwnProperty.call(e.payload, "__proto__"));
    assert.equal(({} as { p?: number }).p, undefined);
  });
});

describe("decodeStoredEvent rejections", () => {
  const cases: Array<{ name: string; value: unknown; reason?: string }> = [
    { name: "missing seq", value: { ts: "2026-08-04T12:00:00Z", type: "t", lane: "l", payload: {} } },
    { name: "missing ts", value: { seq: 1, type: "t", lane: "l", payload: {} } },
    { name: "missing type", value: { seq: 1, ts: "2026-08-04T12:00:00Z", lane: "l", payload: {} } },
    { name: "missing lane", value: { seq: 1, ts: "2026-08-04T12:00:00Z", type: "t", payload: {} } },
    { name: "missing payload", value: { seq: 1, ts: "2026-08-04T12:00:00Z", type: "t", lane: "l" } },
    { name: "unknown top-level field", value: goodEvent({ extra: 1 }) },
    { name: "wrong type seq string", value: goodEvent({ seq: "1" }) },
    { name: "negative seq", value: goodEvent({ seq: -1 }) },
    { name: "unsafe integer seq", value: goodEvent({ seq: Number.MAX_SAFE_INTEGER + 1 }) },
    { name: "float seq", value: goodEvent({ seq: 1.5 }) },
    { name: "NaN seq", value: goodEvent({ seq: Number.NaN }) },
    { name: "empty type", value: goodEvent({ type: "" }) },
    { name: "empty lane", value: goodEvent({ lane: "" }) },
    { name: "null commit", value: goodEvent({ commit: null }) },
    { name: "empty commit", value: goodEvent({ commit: "" }) },
    { name: "array payload", value: goodEvent({ payload: [] }) },
    { name: "null payload", value: goodEvent({ payload: null }) },
    { name: "string payload", value: goodEvent({ payload: "x" }) },
    { name: "root array", value: [] },
    { name: "root null", value: null },
    { name: "root string", value: "x" },
  ];

  for (const c of cases) {
    it(`rejects ${c.name}`, () => {
      const r = decodeStoredEvent(c.value);
      assert.ok(isEventDecodeFailure(r), `expected failure for ${c.name}`);
      assert.equal(r.reason, "event_schema");
    });
  }

  const badTs = [
    "2026-08-04T12:00:00",
    "2026-08-04T12:00:00.000Z",
    "2026-08-04T12:00:00+00:00",
    "2026-08-04 12:00:00Z",
    "2026-02-30T12:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-08-04T24:00:00Z",
    "",
  ];
  for (const ts of badTs) {
    it(`rejects timestamp ${JSON.stringify(ts)}`, () => {
      const r = decodeStoredEvent(goodEvent({ ts }));
      assert.ok(isEventDecodeFailure(r));
      assert.equal(r.reason, "event_schema");
    });
  }

  it("accepts leap-day UTC second timestamp", () => {
    const r = decodeStoredEvent(goodEvent({ ts: "2024-02-29T23:59:59Z" }));
    assert.ok(!isEventDecodeFailure(r));
  });
});

describe("decodeStoredEventFromText JSON failures", () => {
  it("rejects duplicate keys", () => {
    const text =
      '{"seq":1,"seq":2,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{}}';
    const r = decodeStoredEventFromText(text);
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "duplicate_key");
  });

  it("rejects nested duplicate keys", () => {
    const text =
      '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{"a":1,"a":2}}';
    const r = decodeStoredEventFromText(text);
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "duplicate_key");
  });

  it("rejects invalid JSON", () => {
    const r = decodeStoredEventFromText("{");
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "invalid_json");
  });

  it("rejects suffix values", () => {
    const r = decodeStoredEventFromText(goodJson() + " trailing");
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "invalid_json");
  });

  it("rejects non-JSON numeric forms via invalid token", () => {
    const r = decodeStoredEventFromText(
      '{"seq":0x1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":{}}',
    );
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "invalid_json");
  });

  it("rejects malformed UTF-8 bytes", () => {
    const bad = new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]); // { malformed }
    const r = decodeStoredEventFromBytes(bad);
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "malformed_utf8");
  });
});

describe("structure limits", () => {
  it("accepts nesting depth exactly at the bound", () => {
    // Root depth 1; build chain of depth MAX_EVENT_NESTING_DEPTH.
    let inner: unknown = {};
    for (let d = 1; d < MAX_EVENT_NESTING_DEPTH; d += 1) {
      inner = { n: inner };
    }
    // inner depth from root of event: payload is depth 2, so nest MAX-2 more inside payload.
    let payload: unknown = {};
    for (let d = 2; d < MAX_EVENT_NESTING_DEPTH; d += 1) {
      payload = { n: payload };
    }
    const r = decodeStoredEvent(goodEvent({ payload: payload as Record<string, unknown> }));
    assert.ok(!isEventDecodeFailure(r), "depth at bound should pass");
  });

  it("rejects nesting depth one past the bound", () => {
    let payload: unknown = {};
    for (let d = 2; d <= MAX_EVENT_NESTING_DEPTH; d += 1) {
      payload = { n: payload };
    }
    // deepest node is at depth MAX+1
    const r = decodeStoredEvent(goodEvent({ payload: payload as Record<string, unknown> }));
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "event_structure_limit");
  });

  it("accepts node count exactly at the bound", () => {
    // Top-level event has 5 keys (seq,ts,type,lane,payload) = 5 nodes.
    // Payload keys add more. Need total keys+array elems = MAX_EVENT_JSON_NODES.
    const topKeys = 5;
    const payloadKeys = MAX_EVENT_JSON_NODES - topKeys;
    const payload: Record<string, unknown> = Object.create(null);
    for (let i = 0; i < payloadKeys; i += 1) {
      payload["k" + i] = 1;
    }
    const r = decodeStoredEvent(goodEvent({ payload }));
    assert.ok(!isEventDecodeFailure(r), "nodes at bound should pass");
  });

  it("rejects node count one past the bound", () => {
    const topKeys = 5;
    const payloadKeys = MAX_EVENT_JSON_NODES - topKeys + 1;
    const payload: Record<string, unknown> = Object.create(null);
    for (let i = 0; i < payloadKeys; i += 1) {
      payload["k" + i] = 1;
    }
    const r = decodeStoredEvent(goodEvent({ payload }));
    assert.ok(isEventDecodeFailure(r));
    assert.equal(r.reason, "event_structure_limit");
  });
});

describe("pre-parse nesting guard (text / bytes)", () => {
  const EVENT_PREFIX =
    '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l","payload":';

  it("deep nested arrays return event_structure_limit without throwing", () => {
    const n = 12_000;
    const text = EVENT_PREFIX + "[".repeat(n) + "0" + "]".repeat(n) + "}";
    let threw: unknown;
    let r: ReturnType<typeof decodeStoredEventFromText> | undefined;
    try {
      r = decodeStoredEventFromText(text);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, undefined, "must not throw RangeError or any Error");
    assert.ok(r !== undefined && isEventDecodeFailure(r));
    assert.equal(r!.reason, "event_structure_limit");
    const json = JSON.stringify(r);
    assert.equal(json.includes("RangeError"), false);
    assert.equal(json.includes("stack"), false);
    assert.equal(json.includes("Maximum call"), false);
    assert.equal(json.includes("[[[["), false);
    assert.deepEqual(Object.keys(r!).sort(), ["_tag", "reason"]);
  });

  it("deep nested arrays via bytes also return event_structure_limit", () => {
    const n = 12_000;
    const text = EVENT_PREFIX + "[".repeat(n) + "0" + "]".repeat(n) + "}";
    const bytes = new TextEncoder().encode(text);
    let threw: unknown;
    let r: ReturnType<typeof decodeStoredEventFromBytes> | undefined;
    try {
      r = decodeStoredEventFromBytes(bytes);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, undefined);
    assert.ok(r !== undefined && isEventDecodeFailure(r));
    assert.equal(r!.reason, "event_structure_limit");
  });

  it("braces and brackets inside strings do not trigger structure limit", () => {
    const braces = "[".repeat(200) + "]".repeat(200) + "{".repeat(200) + "}".repeat(200);
    const text = goodJson({
      payload: { note: braces, alive: true },
    });
    const r = decodeStoredEventFromText(text);
    assert.ok(!isEventDecodeFailure(r), "string content must not count as nesting");
    assert.equal((r as StoredEvent).payload["note"], braces);
  });

  it("escaped quotes and backslashes inside strings do not false-limit", () => {
    // String holds literal quote and braces after escapes: \" { [ ] }
    const text =
      '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l",' +
      '"payload":{"s":"end-of-string-not-yet \\" {[]]} still-in-string","x":1}}';
    const r = decodeStoredEventFromText(text);
    assert.ok(!isEventDecodeFailure(r), "escaped quote must keep braces inside string");
    const s = (r as StoredEvent).payload["s"];
    assert.equal(typeof s, "string");
    assert.ok(String(s).includes("{[]]}"));
  });

  it("backslash-escaped backslash before quote ends the string correctly", () => {
    // "foo\\" ends string with a trailing backslash; following { is structural.
    // Build shallow nesting that remains under the bound.
    const text =
      '{"seq":1,"ts":"2026-08-04T12:00:00Z","type":"t","lane":"l",' +
      '"payload":{"s":"foo\\\\","n":1}}';
    const r = decodeStoredEventFromText(text);
    assert.ok(!isEventDecodeFailure(r));
    assert.equal((r as StoredEvent).payload["s"], "foo\\");
  });
});

describe("public failure hygiene", () => {
  it("failure objects contain no paths, stacks, or input text", () => {
    const secret = "/home/secret/path/events.jsonl with stack Trace";
    const r = decodeStoredEventFromText(secret);
    assert.ok(isEventDecodeFailure(r));
    const json = JSON.stringify(r);
    assert.equal(json.includes("/home"), false);
    assert.equal(json.includes("stack"), false);
    assert.equal(json.includes("Trace"), false);
    assert.equal(json.includes("events.jsonl"), false);
    assert.equal(r.reason, "invalid_json");
    assert.deepEqual(Object.keys(r).sort(), ["_tag", "reason"]);
  });
});
