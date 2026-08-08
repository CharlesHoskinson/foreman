/**
 * Backend-agnostic SessionStore conformance suite.
 *
 * A second implementation of the port is trustworthy exactly to the degree it
 * passes this. Cases are driven by a factory so nothing here is SQLite-specific.
 */

import {
  SESSION_MODEL_VERSION,
  emptySnapshot,
  snapshotsEqual,
  type SessionSnapshot,
} from "./entities.js";
import { decodeSnapshot, encodeSnapshot } from "./sidecar.js";
import { findViolations } from "./integrity.js";
import { reasonOf, type SessionStoreFailureReason } from "./failures.js";
import type { SessionStore } from "./port.js";

export type StoreFactory = () => SessionStore;

export type CaseResult = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type SuiteReport = {
  readonly results: readonly CaseResult[];
  readonly passed: number;
  readonly failed: number;
  readonly ok: boolean;
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    const e = new Error(msg);
    e.name = "AssertionError";
    throw e;
  }
}

/** Assert that `fn` fails with the given port failure reason. */
function assertRejects(fn: () => unknown, reason: SessionStoreFailureReason): void {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    const got = reasonOf(e);
    assert(
      got === reason,
      `expected failure ${reason}, got ${got ?? (e as Error).message}`,
    );
  }
  assert(threw, `expected failure ${reason}, but the call succeeded`);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export function seedFixture(store: SessionStore): void {
  store.beginSession({
    session_id: "S1",
    started_ts: "2026-08-08T10:00:00Z",
    start_sha: "abc123",
    note: null,
  });
  const f1 = store.addFact({
    statement: "the port is the contract",
    evidence: null,
    established_ts: "2026-08-08T10:01:00Z",
    session_id: "S1",
  });
  store.supersedeFact(
    f1.id,
    {
      statement: "the port is the contract, and the model declares it",
      evidence: "packages/session-store/src/entities.ts",
      established_ts: "2026-08-08T10:02:00Z",
      session_id: "S1",
    },
    "sharpened",
    "2026-08-08T10:02:00Z",
  );
  store.addMeasurement({
    metric: "typecheck.errors",
    value: "0",
    value_num: 0,
    command: "npm run typecheck",
    measured_ts: "2026-08-08T10:03:00Z",
    measured_sha: "abc123",
    scope_paths: "packages/session-store",
    session_id: "S1",
  });
  const o1 = store.addObligation({
    statement: "write the conformance suite",
    blocker: null,
    opened_ts: "2026-08-08T10:04:00Z",
    session_id: "S1",
  });
  store.closeObligation(o1.id, "done", "2026-08-08T10:05:00Z");
}

/** Mutate a snapshot's rows for hostile-input cases. */
function withFacts(
  base: SessionSnapshot,
  facts: readonly Record<string, unknown>[],
): SessionSnapshot {
  return { ...base, facts: facts as never };
}

function baseWithSession(): SessionSnapshot {
  return {
    ...emptySnapshot(),
    sessions: [
      {
        session_id: "S1",
        started_ts: "2026-08-08T10:00:00Z",
        start_sha: null,
        ended_ts: null,
        note: null,
      },
    ],
  };
}

function fact(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    statement: "s",
    evidence: null,
    established_ts: "2026-08-08T10:00:00Z",
    session_id: "S1",
    superseded_by: null,
    superseded_at: null,
    supersede_reason: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

type Case = { readonly name: string; readonly run: (f: StoreFactory) => void };

export const CASES: readonly Case[] = [
  {
    name: "roundtrip/empty-store",
    run: (f) => {
      const s = f();
      try {
        const snap = s.snapshot();
        const back = decodeSnapshot(encodeSnapshot(snap));
        assert(snapshotsEqual(snap, back), "empty snapshot did not round-trip");
      } finally {
        s.close();
      }
    },
  },
  {
    name: "roundtrip/populated-store",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const snap = s.snapshot();
        const back = decodeSnapshot(encodeSnapshot(snap));
        assert(snapshotsEqual(snap, back), "populated snapshot did not round-trip");
      } finally {
        s.close();
      }
    },
  },
  {
    name: "roundtrip/import-of-export-is-equal",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        const snap = a.snapshot();
        b.importSnapshot(decodeSnapshot(encodeSnapshot(snap)));
        assert(
          snapshotsEqual(snap, b.snapshot()),
          "import(export(store)) produced a different snapshot",
        );
      } finally {
        a.close();
        b.close();
      }
    },
  },
  {
    name: "encoding/byte-stable-across-repeated-encodes",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const one = encodeSnapshot(s.snapshot());
        const two = encodeSnapshot(s.snapshot());
        assert(one === two, "two encodes of an untouched store differed");
        const three = encodeSnapshot(decodeSnapshot(one));
        assert(one === three, "encode∘decode∘encode was not byte-identical");
      } finally {
        s.close();
      }
    },
  },
  {
    name: "encoding/ends-with-exactly-one-newline",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const text = encodeSnapshot(s.snapshot());
        assert(text.endsWith("\n"), "sidecar must end with a newline");
        assert(!text.endsWith("\n\n"), "sidecar must not end with a blank line");
        assert(!text.includes("\r"), "sidecar must not contain CR");
      } finally {
        s.close();
      }
    },
  },
  {
    name: "identity/ids-are-port-minted-and-advance",
    run: (f) => {
      const s = f();
      try {
        assert(s.peekNextId("fact") === 1, "fresh store should mint fact id 1");
        const a = s.addFact({
          statement: "a",
          evidence: null,
          established_ts: "2026-08-08T10:00:00Z",
          session_id: null,
        });
        assert(a.id === 1, `expected minted id 1, got ${a.id}`);
        assert(s.peekNextId("fact") === 2, "counter did not advance");
      } finally {
        s.close();
      }
    },
  },
  {
    name: "identity/allocation-state-round-trips",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        const before = a.peekNextId("fact");
        b.importSnapshot(decodeSnapshot(encodeSnapshot(a.snapshot())));
        assert(
          b.peekNextId("fact") === before,
          `next id did not round-trip: ${b.peekNextId("fact")} != ${before}`,
        );
      } finally {
        a.close();
        b.close();
      }
    },
  },
  {
    name: "supersession/set-once",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const superseded = s.listFacts().find((r) => r.superseded_by !== null);
        assert(superseded !== undefined, "fixture should contain a superseded fact");
        assertRejects(
          () =>
            s.supersedeFact(
              superseded.id,
              {
                statement: "third",
                evidence: null,
                established_ts: "2026-08-08T11:00:00Z",
                session_id: "S1",
              },
              null,
              "2026-08-08T11:00:00Z",
            ),
          "supersession_incomplete",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "obligation/close-is-once-only",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const done = s.listObligations().find((o) => o.status === "done");
        assert(done !== undefined, "fixture should contain a closed obligation");
        assertRejects(
          () => s.closeObligation(done.id, "dropped", "2026-08-08T12:00:00Z"),
          "invalid_argument",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "write/rejects-non-finite-value-num",
    run: (f) => {
      const s = f();
      try {
        assertRejects(
          () =>
            s.addMeasurement({
              metric: "rate",
              value: "Infinity",
              value_num: Number.POSITIVE_INFINITY,
              command: null,
              measured_ts: "2026-08-08T10:00:00Z",
              measured_sha: null,
              scope_paths: null,
              session_id: null,
            }),
          "field_type",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "import/refuses-non-empty-store-without-force",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assertRejects(
          () => s.importSnapshot(emptySnapshot()),
          "store_not_empty",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "import/newer-model-version-refused-without-mutation",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const before = encodeSnapshot(s.snapshot());
        const future: SessionSnapshot = {
          ...emptySnapshot(),
          modelVersion: SESSION_MODEL_VERSION + 1,
        };
        assertRejects(
          () => s.importSnapshot(future, { force: true }),
          "model_version_unsupported",
        );
        assert(
          encodeSnapshot(s.snapshot()) === before,
          "store was mutated despite refusing a newer model version",
        );
      } finally {
        s.close();
      }
    },
  },
];

/** Hostile-snapshot cases: pure validation, no store needed. */
export const HOSTILE_CASES: readonly Case[] = [
  {
    name: "hostile/dangling-superseded-by",
    run: () => {
      const snap = withFacts(baseWithSession(), [
        fact({ superseded_by: 99, superseded_at: "2026-08-08T10:00:00Z" }),
      ]);
      assert(findViolations(snap).length > 0, "dangling pointer was accepted");
    },
  },
  {
    name: "hostile/self-supersession",
    run: () => {
      const snap = withFacts(baseWithSession(), [
        fact({ id: 1, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" }),
      ]);
      assert(findViolations(snap).length > 0, "self-supersession was accepted");
    },
  },
  {
    name: "hostile/supersession-cycle",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 2, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 1, superseded_at: "2026-08-08T10:00:00Z" }),
        ]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 },
      };
      assert(findViolations(snap).length > 0, "supersession cycle was accepted");
    },
  },
  {
    name: "hostile/two-rows-supersede-the-same-target",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [
          fact({ id: 1, superseded_by: 3, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 2, superseded_by: 3, superseded_at: "2026-08-08T10:00:00Z" }),
          fact({ id: 3 }),
        ]),
        nextIds: { fact: 4, measurement: 1, obligation: 1 },
      };
      assert(findViolations(snap).length > 0, "forked supersession was accepted");
    },
  },
  {
    name: "hostile/partial-supersession-metadata",
    run: () => {
      const snap = withFacts(baseWithSession(), [
        fact({ id: 1, superseded_by: null, superseded_at: "2026-08-08T10:00:00Z" }),
      ]);
      assert(
        findViolations(snap).length > 0,
        "superseded_at without superseded_by was accepted",
      );
    },
  },
  {
    name: "hostile/absent-field-instead-of-null",
    run: () => {
      const partial = { ...fact({}) };
      delete partial["evidence"];
      const snap = withFacts(baseWithSession(), [partial]);
      assert(findViolations(snap).length > 0, "absent key was accepted");
    },
  },
  {
    name: "hostile/unknown-extra-field",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ rogue: "x" })]);
      assert(findViolations(snap).length > 0, "unknown field was accepted");
    },
  },
  {
    name: "hostile/unknown-session-reference",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ session_id: "NOPE" })]);
      assert(findViolations(snap).length > 0, "dangling session ref was accepted");
    },
  },
  {
    name: "hostile/duplicate-id",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [fact({ id: 1 }), fact({ id: 1 })]),
        nextIds: { fact: 2, measurement: 1, obligation: 1 },
      };
      assert(findViolations(snap).length > 0, "duplicate id was accepted");
    },
  },
  {
    name: "hostile/id-at-or-above-watermark",
    run: () => {
      const snap = withFacts(baseWithSession(), [fact({ id: 5 })]);
      assert(
        findViolations(snap).length > 0,
        "id at/above nextIds watermark was accepted",
      );
    },
  },
  {
    name: "hostile/rows-out-of-declared-order",
    run: () => {
      const snap = {
        ...withFacts(baseWithSession(), [fact({ id: 2 }), fact({ id: 1 })]),
        nextIds: { fact: 3, measurement: 1, obligation: 1 },
      };
      assert(findViolations(snap).length > 0, "out-of-order rows were accepted");
    },
  },
  {
    name: "hostile/open-obligation-with-closed-ts",
    run: () => {
      const snap: SessionSnapshot = {
        ...baseWithSession(),
        nextIds: { fact: 1, measurement: 1, obligation: 2 },
        obligations: [
          {
            id: 1,
            statement: "x",
            status: "open",
            blocker: null,
            opened_ts: "2026-08-08T10:00:00Z",
            closed_ts: "2026-08-08T11:00:00Z",
            session_id: "S1",
          },
        ],
      };
      assert(
        findViolations(snap).length > 0,
        "open obligation with closed_ts was accepted",
      );
    },
  },
  {
    name: "hostile/duplicate-json-key-in-sidecar",
    run: () => {
      const line =
        '{"format":"foreman-session-sidecar","format_version":2,' +
        '"session_model_version":1,"next_ids":{"fact":1,"measurement":1,"obligation":1}}\n' +
        '{"kind":"session","kind":"session","row":{}}\n';
      let threw = false;
      try {
        decodeSnapshot(line);
      } catch {
        threw = true;
      }
      assert(threw, "duplicate JSON key was accepted");
    },
  },
  {
    name: "hostile/crlf-line-endings",
    run: () => {
      let threw = false;
      try {
        decodeSnapshot(encodeSnapshot(emptySnapshot()).replace(/\n/g, "\r\n"));
      } catch {
        threw = true;
      }
      assert(threw, "CRLF sidecar was accepted");
    },
  },
  {
    name: "hostile/missing-trailing-newline",
    run: () => {
      let threw = false;
      try {
        decodeSnapshot(encodeSnapshot(emptySnapshot()).trimEnd());
      } catch {
        threw = true;
      }
      assert(threw, "sidecar without a trailing newline was accepted");
    },
  },
  {
    name: "hostile/unknown-entity-kind",
    run: () => {
      const text =
        '{"format":"foreman-session-sidecar","format_version":2,' +
        '"session_model_version":1,"next_ids":{"fact":1,"measurement":1,"obligation":1}}\n' +
        '{"kind":"wormhole","row":{}}\n';
      let threw = false;
      try {
        decodeSnapshot(text);
      } catch {
        threw = true;
      }
      assert(threw, "unknown entity kind was accepted");
    },
  },
];

export const ALL_CASES: readonly Case[] = [...CASES, ...HOSTILE_CASES];

export function runSuite(factory: StoreFactory): SuiteReport {
  const results: CaseResult[] = [];
  for (const c of ALL_CASES) {
    try {
      c.run(factory);
      results.push({ name: c.name, passed: true, detail: "" });
    } catch (e) {
      results.push({
        name: c.name,
        passed: false,
        detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  }
  const failed = results.filter((r) => !r.passed).length;
  return {
    results,
    passed: results.length - failed,
    failed,
    ok: failed === 0,
  };
}

export function formatReport(report: SuiteReport): string {
  const lines = report.results
    .filter((r) => !r.passed)
    .map((r) => `  FAIL ${r.name}: ${r.detail}`);
  return `${report.passed} passed, ${report.failed} failed\n${lines.join("\n")}`;
}
