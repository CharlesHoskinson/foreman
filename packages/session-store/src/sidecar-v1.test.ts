import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSnapshotV1 } from "./sidecar-v1.js";
import { reasonOf } from "./failures.js";
import { emptySnapshot, type SessionSnapshot } from "./entities.js";
import { findViolations } from "./integrity.js";
import { encodeSnapshot } from "./sidecar.js";

const HEADER = `{"format": "foreman-session-sidecar", "format_version": 1}`;

function lines(...rows: string[]): readonly string[] {
  return [HEADER, ...rows];
}

test("maps plural table names to singular kinds", () => {
  const snap = decodeSnapshotV1(
    lines(
      `{"table": "facts", "row": {"id": 1, "statement": "s", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
    ),
  );
  assert.equal(snap.facts.length, 1);
  assert.equal(snap.facts[0]?.id, 1);
});

test("drops schema_meta rows rather than treating them as entities", () => {
  const snap = decodeSnapshotV1(
    lines(`{"table": "schema_meta", "row": {"key": "version", "value": "3"}}`),
  );
  assert.equal(snap.sessions.length, 0);
  assert.equal(snap.facts.length, 0);
  assert.equal(snap.measurements.length, 0);
  assert.equal(snap.obligations.length, 0);
});

test("computes next_ids as max(id) + 1 per counted kind", () => {
  const snap = decodeSnapshotV1(
    lines(
      `{"table": "facts", "row": {"id": 7, "statement": "s", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
    ),
  );
  assert.equal(snap.nextIds.fact, 8);
  assert.equal(snap.nextIds.measurement, 1);
  assert.equal(snap.nextIds.obligation, 1);
});

test("normalizes blocked obligations to open and keeps the blocker", () => {
  const snap = decodeSnapshotV1(
    lines(
      `{"table": "obligations", "row": {"id": 1, "statement": "s", "status": "blocked", "blocker": "why", "opened_ts": "2026-01-01T00:00:00Z", "closed_ts": null, "session_id": null}}`,
    ),
  );
  assert.equal(snap.obligations[0]?.status, "open");
  assert.equal(snap.obligations[0]?.blocker, "why");
});

test("leaves open, done and dropped statuses untouched", () => {
  for (const status of ["open", "done", "dropped"]) {
    const snap = decodeSnapshotV1(
      lines(
        `{"table": "obligations", "row": {"id": 1, "statement": "s", "status": "${status}", "blocker": null, "opened_ts": "2026-01-01T00:00:00Z", "closed_ts": null, "session_id": null}}`,
      ),
    );
    assert.equal(snap.obligations[0]?.status, status);
  }
});

test("declares model version 1", () => {
  assert.equal(decodeSnapshotV1(lines()).modelVersion, 1);
});

test("rejects an unknown table name", () => {
  let reason: string | null = null;
  try {
    decodeSnapshotV1(lines(`{"table": "widgets", "row": {"id": 1}}`));
  } catch (e) {
    reason = reasonOf(e);
  }
  assert.equal(reason, "unknown_entity_kind");
});

test("rejects a record that is not exactly table and row", () => {
  let reason: string | null = null;
  try {
    decodeSnapshotV1(lines(`{"kind": "fact", "row": {"id": 1}}`));
  } catch (e) {
    reason = reasonOf(e);
  }
  assert.equal(reason, "sidecar_malformed");
});

test("encodeSnapshot refuses a snapshot the reader would reject", () => {
  // A row id at or above its watermark is the exact violation the live
  // corruption produced: fact 36 present, next_ids.fact still 1.
  const snap: SessionSnapshot = {
    ...emptySnapshot(),
    sessions: [],
    facts: [
      {
        id: 36,
        statement: "live fact",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
        superseded_by: null,
        superseded_at: null,
        supersede_reason: null,
      },
    ] as never,
  };
  assert.ok(
    findViolations(snap).some((v) => v.detail.includes("at or above nextIds.fact")),
    "fixture does not reproduce the violation under test",
  );
  assert.throws(() => encodeSnapshot(snap), /at or above nextIds\.fact/);
});
