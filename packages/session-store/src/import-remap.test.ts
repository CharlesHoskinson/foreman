import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SESSION_MODEL_VERSION,
  countRows,
  emptySnapshot,
  type SessionSnapshot,
} from "./entities.js";
import { SessionStoreError } from "./failures.js";
import { findViolations } from "./integrity.js";
import {
  additiveImportProjectionUpserts,
  planAdditiveRemapImport,
  resolveIdCollisionPolicy,
} from "./import-remap.js";
import { encodeSnapshot } from "./sidecar.js";

function endedSession(
  session_id: string,
  note: string | null = null,
): SessionSnapshot["sessions"][number] {
  return {
    session_id,
    started_ts: "2026-08-08T10:00:00Z",
    start_sha: null,
    ended_ts: "2026-08-08T11:00:00Z",
    note,
  };
}

function openSession(session_id: string): SessionSnapshot["sessions"][number] {
  return {
    session_id,
    started_ts: "2026-08-08T10:00:00Z",
    start_sha: null,
    ended_ts: null,
    note: null,
  };
}

function factRow(
  id: number,
  over: Partial<SessionSnapshot["facts"][number]> = {},
): SessionSnapshot["facts"][number] {
  return {
    id,
    statement: `fact-${id}`,
    evidence: null,
    established_ts: "2026-08-08T10:00:00Z",
    session_id: null,
    superseded_by: null,
    superseded_at: null,
    supersede_reason: null,
    ...over,
  };
}

function measurementRow(
  id: number,
  over: Partial<SessionSnapshot["measurements"][number]> = {},
): SessionSnapshot["measurements"][number] {
  return {
    id,
    metric: `m-${id}`,
    value: String(id),
    value_num: id,
    command: null,
    measured_ts: "2026-08-08T10:00:00Z",
    measured_sha: null,
    scope_paths: null,
    session_id: null,
    superseded_by: null,
    superseded_at: null,
    supersede_reason: null,
    ...over,
  };
}

describe("resolveIdCollisionPolicy", () => {
  it("defaults undefined to refuse and accepts remap", () => {
    assert.equal(resolveIdCollisionPolicy(undefined), "refuse");
    assert.equal(resolveIdCollisionPolicy("refuse"), "refuse");
    assert.equal(resolveIdCollisionPolicy("remap"), "remap");
  });

  it("rejects unknown runtime policies", () => {
    assert.throws(
      () => resolveIdCollisionPolicy("merge"),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "invalid_argument");
        return true;
      },
    );
  });
});

describe("planAdditiveRemapImport", () => {
  const targetBase: SessionSnapshot = {
    ...emptySnapshot(),
    nextIds: { fact: 10, measurement: 20, obligation: 30 },
    sessions: [endedSession("T1")],
    facts: [factRow(1, { statement: "keep-me", session_id: "T1" })],
    measurements: [measurementRow(1, { session_id: "T1" })],
    obligations: [
      {
        id: 1,
        statement: "keep-ob",
        status: "done",
        blocker: null,
        opened_ts: "2026-08-08T10:00:00Z",
        closed_ts: "2026-08-08T11:00:00Z",
        session_id: "T1",
      },
    ],
  };

  it("preserves target rows byte-for-byte and returns donor row count", () => {
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      sessions: [endedSession("D1")],
      facts: [factRow(1, { statement: "donor", session_id: "D1" })],
    };
    const plan = planAdditiveRemapImport(targetBase, donor);
    assert.equal(plan.written, countRows(donor));
    const preserved = plan.merged.facts.filter((f) => f.id === 1);
    assert.deepEqual(preserved, [...targetBase.facts]);
    assert.equal(plan.insert.facts[0]?.id, 10);
    assert.equal(plan.merged.nextIds.fact, 11);
  });

  it("allocates every donor counted row per kind and rewrites pointers including fan-in", () => {
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 3, measurement: 4, obligation: 1 },
      sessions: [endedSession("D")],
      facts: [
        factRow(1, { superseded_by: 2, superseded_at: "t", supersede_reason: "r", session_id: "D" }),
        factRow(2, { statement: "live", session_id: "D" }),
      ],
      measurements: [
        measurementRow(1, {
          superseded_by: 3,
          superseded_at: "t",
          supersede_reason: "fan",
          session_id: "D",
        }),
        measurementRow(2, {
          superseded_by: 3,
          superseded_at: "t",
          supersede_reason: "fan",
          session_id: "D",
        }),
        measurementRow(3, { metric: "live", session_id: "D" }),
      ],
    };
    const plan = planAdditiveRemapImport(targetBase, donor);
    assert.deepEqual([...plan.idMaps.fact.entries()], [
      [1, 10],
      [2, 11],
    ]);
    assert.deepEqual([...plan.idMaps.measurement.entries()], [
      [1, 20],
      [2, 21],
      [3, 22],
    ]);
    assert.equal(plan.insert.facts[0]?.superseded_by, 11);
    assert.equal(plan.insert.measurements[0]?.superseded_by, 22);
    assert.equal(plan.insert.measurements[1]?.superseded_by, 22);
    assert.equal(plan.merged.nextIds.measurement, 23);
  });

  it("preserves unused sessions, remaps collisions, and avoids reserved donor originals", () => {
    const target: SessionSnapshot = {
      ...emptySnapshot(),
      sessions: [endedSession("A", "target")],
    };
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      sessions: [
        endedSession("A", "target"),
        endedSession("A~import-1", "reserved"),
        endedSession("B"),
      ],
      facts: [factRow(1, { session_id: "A" })],
    };
    const plan = planAdditiveRemapImport(target, donor);
    assert.equal(plan.sessionMap.get("A"), "A~import-2");
    assert.equal(plan.sessionMap.get("A~import-1"), "A~import-1");
    assert.equal(plan.sessionMap.get("B"), "B");
    assert.equal(plan.insert.facts[0]?.session_id, "A~import-2");
    assert.deepEqual(
      plan.merged.sessions.map((s) => s.session_id),
      ["A", "A~import-1", "A~import-2", "B"],
    );
  });

  it("refuses when both sides have an open session", () => {
    const target: SessionSnapshot = {
      ...emptySnapshot(),
      sessions: [openSession("T")],
      facts: [factRow(1)],
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
    };
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      sessions: [openSession("D")],
    };
    assert.throws(
      () => planAdditiveRemapImport(target, donor),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "invalid_argument");
        assert.match(error.message, /open session/);
        return true;
      },
    );
  });

  it("refuses unsupported target modelVersion without substituting the donor", () => {
    const target: SessionSnapshot = {
      ...targetBase,
      modelVersion: SESSION_MODEL_VERSION + 1,
    };
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      sessions: [endedSession("D1")],
      facts: [factRow(1, { session_id: "D1" })],
    };
    assert.throws(
      () => planAdditiveRemapImport(target, donor),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "model_version_unsupported");
        assert.match(error.message, /target/);
        assert.match(
          error.message,
          new RegExp(String(SESSION_MODEL_VERSION + 1)),
        );
        assert.ok(!error.message.includes("donor"));
        return true;
      },
    );
  });

  it("refuses unsupported donor modelVersion without substituting the target", () => {
    const unsupported = SESSION_MODEL_VERSION + 7;
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      modelVersion: unsupported,
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      sessions: [endedSession("D1")],
      facts: [factRow(1, { session_id: "D1" })],
    };
    assert.throws(
      () => planAdditiveRemapImport(targetBase, donor),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "model_version_unsupported");
        assert.match(error.message, /donor/);
        assert.match(error.message, new RegExp(String(unsupported)));
        assert.ok(!error.message.includes("target"));
        return true;
      },
    );
  });

  it("refuses duplicate session_id in the target before a plan exists", () => {
    const dup = endedSession("T-dup");
    const target: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      // Byte-identical duplicate rows must still be rejected.
      sessions: [dup, { ...dup }],
      facts: [factRow(1, { session_id: "T-dup" })],
    };
    assert.ok(
      findViolations(target).some(
        (v) =>
          v.detail.includes("duplicate session_id") &&
          v.detail.includes("T-dup"),
      ),
      "integrity must name the duplicate session_id",
    );
    assert.throws(
      () => planAdditiveRemapImport(target, emptySnapshot()),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.match(error.message, /duplicate session_id/);
        assert.match(error.message, /T-dup/);
        return true;
      },
    );
  });

  it("refuses duplicate session_id in the donor before a plan exists", () => {
    const dup = endedSession("D-dup");
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      sessions: [dup, endedSession("D-dup", "different-note")],
      facts: [factRow(1, { session_id: "D-dup" })],
    };
    assert.ok(
      findViolations(donor).some(
        (v) =>
          v.detail.includes("duplicate session_id") &&
          v.detail.includes("D-dup"),
      ),
      "integrity must name the duplicate session_id",
    );
    assert.throws(
      () => planAdditiveRemapImport(targetBase, donor),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.match(error.message, /duplicate session_id/);
        assert.match(error.message, /D-dup/);
        return true;
      },
    );
  });

  it("refuses safe-integer overflow before producing a plan", () => {
    const target: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: {
        fact: Number.MAX_SAFE_INTEGER,
        measurement: 1,
        obligation: 1,
      },
      sessions: [endedSession("T")],
      facts: [factRow(1)],
    };
    // Integrity allows nextIds == MAX_SAFE_INTEGER with no row at that id.
    assert.equal(findViolations(target).length, 0);
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 2, measurement: 1, obligation: 1 },
      facts: [factRow(1)],
    };
    assert.throws(
      () => planAdditiveRemapImport(target, donor),
      (error: unknown) => {
        assert.ok(error instanceof SessionStoreError);
        assert.equal(error.failure.reason, "invalid_argument");
        assert.match(error.message, /overflow/);
        return true;
      },
    );
  });

  it("returns a true empty-donor no-op plan", () => {
    const plan = planAdditiveRemapImport(targetBase, emptySnapshot());
    assert.equal(plan.written, 0);
    assert.equal(plan.insert.facts.length, 0);
    assert.equal(encodeSnapshot(plan.merged), encodeSnapshot(targetBase));
  });

  it("queues sanitized upserts only for imported live counted rows", () => {
    const donor: SessionSnapshot = {
      ...emptySnapshot(),
      nextIds: { fact: 3, measurement: 1, obligation: 1 },
      sessions: [endedSession("D")],
      facts: [
        factRow(1, {
          statement: "pred",
          superseded_by: 2,
          superseded_at: "t",
          supersede_reason: "r",
          session_id: "D",
        }),
        factRow(2, { statement: "live-donor", session_id: "D" }),
      ],
    };
    const plan = planAdditiveRemapImport(targetBase, donor);
    const upserts = additiveImportProjectionUpserts(targetBase, plan.merged);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0]?.kind, "fact");
    assert.equal(upserts[0]?.id, 11);
    assert.equal(upserts[0]?.text, "live-donor");
    assert.ok(!upserts.some((u) => u.id === 10), "superseded fresh id must not upsert");
    assert.ok(
      !upserts.some((u) => String(u.key).includes("session")),
      "sessions must not enter the projection outbox",
    );
  });
});
