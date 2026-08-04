import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeAttemptId,
  decodeAttemptIdText,
  decodeAttemptIdentity,
  decodeLaneId,
  decodeRunId,
  extractPayloadAttempt,
  isAttemptFailure,
  makeAttemptIdentity,
  nextAttempt,
  type AttemptId,
  type LaneId,
  type RunId,
} from "./index.js";

describe("attempt identity", () => {
  it("decodes valid run, lane, attempt and identity", () => {
    const run = decodeRunId("v030-event-log-20260804");
    const lane = decodeLaneId("grok-r1");
    const attempt = decodeAttemptId(1);
    assert.ok(!isAttemptFailure(run));
    assert.ok(!isAttemptFailure(lane));
    assert.ok(!isAttemptFailure(attempt));
    const id = makeAttemptIdentity(run as RunId, lane as LaneId, attempt as AttemptId);
    assert.equal(id.runId, "v030-event-log-20260804");
    assert.equal(id.laneId, "grok-r1");
    assert.equal(id.attemptId, 1);

    const all = decodeAttemptIdentity("run.a", "lane_b", 7);
    assert.ok(!isAttemptFailure(all));
  });

  it("run id rejects empty, path separators, NUL, oversize", () => {
    for (const v of ["", "a/b", "a\\b", "a\0b", "x".repeat(256)]) {
      const r = decodeRunId(v);
      assert.ok(isAttemptFailure(r), JSON.stringify(v));
      assert.equal(r.reason, "invalid_run_id");
    }
  });

  it("lane grammar accepts legacy charset and rejects others", () => {
    assert.ok(!isAttemptFailure(decodeLaneId("Grok.1_2-3")));
    for (const v of ["", "has space", "slash/x", "a:b", "rōma"]) {
      const r = decodeLaneId(v);
      assert.ok(isAttemptFailure(r), v);
      assert.equal(r.reason, "invalid_lane_id");
    }
  });

  it("attempt id must be positive safe integer", () => {
    assert.ok(!isAttemptFailure(decodeAttemptId(1)));
    for (const v of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const r = decodeAttemptId(v);
      assert.ok(isAttemptFailure(r));
      assert.equal(r.reason, "invalid_attempt_id");
    }
  });
});

describe("nextAttempt", () => {
  it("maps missing to 1", () => {
    assert.equal(nextAttempt(null) as number, 1);
    assert.equal(nextAttempt(undefined) as number, 1);
  });

  it("increments monotonically", () => {
    const a = decodeAttemptId(3) as AttemptId;
    assert.equal(nextAttempt(a) as number, 4);
  });

  it("returns overflow at MAX_SAFE_INTEGER", () => {
    const a = decodeAttemptId(Number.MAX_SAFE_INTEGER) as AttemptId;
    const r = nextAttempt(a);
    assert.ok(isAttemptFailure(r));
    assert.equal(r.reason, "attempt_overflow");
  });
});

describe("attempt stored text", () => {
  it("accepts strict positive decimals", () => {
    assert.equal(decodeAttemptIdText("1") as number, 1);
    assert.equal(decodeAttemptIdText("42") as number, 42);
  });

  it("rejects zero, corrupt, and leading zeros without reset", () => {
    for (const t of ["0", "01", "", "+1", "-1", "1e2", "1\n", " 1", "1 ", "abc"]) {
      const r = decodeAttemptIdText(t);
      assert.ok(isAttemptFailure(r), JSON.stringify(t));
      assert.equal(r.reason, "invalid_attempt_text");
    }
  });
});

describe("extractPayloadAttempt", () => {
  it("returns undefined when absent", () => {
    assert.equal(extractPayloadAttempt({}), undefined);
  });

  it("extracts top-level payload.attempt only", () => {
    assert.equal(extractPayloadAttempt({ attempt: 3 }) as number, 3);
    // nested evidence.attempt is ignored as a top-level key absence... if only nested:
    assert.equal(extractPayloadAttempt({ evidence: { attempt: 9 } }), undefined);
  });

  it("rejects non-positive attempt values", () => {
    const r = extractPayloadAttempt({ attempt: 0 });
    assert.ok(isAttemptFailure(r));
    assert.equal(r.reason, "invalid_payload_attempt");
  });
});

describe("attempt failure hygiene", () => {
  it("does not leak input in JSON form", () => {
    const r = decodeRunId("/secret/path\0");
    assert.ok(isAttemptFailure(r));
    const json = JSON.stringify(r);
    assert.equal(json.includes("secret"), false);
    assert.equal(json.includes("/"), false);
    assert.deepEqual(Object.keys(r).sort(), ["_tag", "reason"]);
  });
});
