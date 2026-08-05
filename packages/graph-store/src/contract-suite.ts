/**
 * Backend-agnostic GraphStore port conformance suite.
 * Port of skills/foreman/graph_store/contract_suite.py behavioral cases.
 */

import {
  CapabilityUnavailableError,
  SchemaNotRegisteredError,
  SchemaValidationError,
  UnexpectedEmptyError,
  UnexpectedNonEmptyError,
  VersionReferenceError,
} from "./failures.js";
import { openFilesOnly, type FilesOnlyGraphStore } from "./files-only.js";
import {
  CAP_TIME_TRAVEL,
  LINEAGE_QUERIES,
  OPTIONAL_CAPABILITIES,
  runPortQuery,
  type GraphStore,
  type JsonObject,
  type QueryResult,
} from "./port.js";
import { defaultSchemaPayload } from "./schema.js";

export type StoreFactory = () => GraphStore;

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

function caseResult(
  name: string,
  passed: boolean,
  detail = "",
): CaseResult {
  return { name, passed, detail };
}

function runCase(name: string, fn: () => void): CaseResult {
  try {
    fn();
    return caseResult(name, true);
  } catch (e) {
    if (e instanceof Error && e.name === "AssertionError") {
      return caseResult(name, false, e.message || "assertion failed");
    }
    if (e instanceof Error) {
      return caseResult(name, false, `${e.name}: ${e.message}`);
    }
    return caseResult(name, false, String(e));
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    const err = new Error(msg);
    err.name = "AssertionError";
    throw err;
  }
}

/**
 * R8 §6.1 fixture. Claim statuses use closed ClaimStatus enum (live).
 */
export function seedLineageFixture(store: GraphStore): void {
  store.registerSchema(defaultSchemaPayload(), {
    author: "contract",
    message: "fixture",
  });
  store.upsertDocument({
    "@type": "Task",
    task_key: "T7",
    title: "lineage fixture",
  });
  store.upsertDocument({
    "@type": "Round",
    task_key: "T7",
    index: 1,
    has_attempt: ["Attempt/A1", "Attempt/A2"],
  });
  store.upsertDocument({
    "@type": "Round",
    task_key: "T7",
    index: 2,
    has_attempt: ["Attempt/A3", "Attempt/A4"],
  });
  for (const [key, rnd] of [
    ["A1", "Round/T7+1"],
    ["A2", "Round/T7+1"],
    ["A3", "Round/T7+2"],
    ["A4", "Round/T7+2"],
  ] as const) {
    const doc: JsonObject = {
      "@type": "Attempt",
      attempt_key: key,
      lane: `lane-${key}`,
      round: rnd,
    };
    if (key === "A4") {
      doc["derived_from"] = ["Attempt/A3"];
    }
    store.upsertDocument(doc);
  }
  store.upsertDocument({
    "@type": "Evaluation",
    evaluation_id: "E1",
    verdict: "approved",
    evaluates_attempt: "Attempt/A1",
  });
  store.upsertDocument({
    "@type": "Evaluation",
    evaluation_id: "E2",
    verdict: "needs_changes",
    evaluates_attempt: "Attempt/A3",
  });
  store.upsertDocument({
    "@type": "Claim",
    claim_key: "C1",
    text: "TerminusDB is maintained",
    status: "live",
    confidence: "medium",
  });
  store.upsertDocument({
    "@type": "Claim",
    claim_key: "C2",
    text: "TerminusDB is abandoned",
    status: "live",
    confidence: "low",
    contradicts: ["Claim/C1"],
  });
  store.upsertDocument({
    "@type": "Claim",
    claim_key: "C3",
    text: "TerminusDB ships releases",
    status: "live",
    confidence: "high",
    supports: ["Claim/C1"],
  });
}

export function caseSchemaRequiredBeforeWrite(
  factory: StoreFactory,
): CaseResult {
  return runCase("schema_required_before_write", () => {
    const store = factory();
    try {
      store.upsertDocument({
        "@type": "Task",
        task_key: "X",
        title: "no schema",
      });
    } catch (e) {
      if (e instanceof SchemaNotRegisteredError) return;
      throw e;
    }
    assert(false, "expected SchemaNotRegisteredError before register_schema");
  });
}

export function caseSchemaAcceptsConforming(
  factory: StoreFactory,
): CaseResult {
  return runCase("schema_accepts_conforming_document", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    const docId = store.upsertDocument({
      "@type": "Task",
      task_key: "T-ok",
      title: "conforming",
    });
    assert(docId === "Task/T-ok", `unexpected id ${docId}`);
    const got = store.getDocument("Task", "T-ok");
    assert(got !== null, "lookup returned null");
    assert(got["@type"] === "Task", "type");
    assert(got["task_key"] === "T-ok", "key");
  });
}

export function caseRejectFreeFloatConfidence(
  factory: StoreFactory,
): CaseResult {
  return runCase("reject_free_float_confidence", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    try {
      store.upsertDocument({
        "@type": "Claim",
        claim_key: "bad-conf",
        text: "x",
        status: "live",
        confidence: 0.87,
      });
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        assert(
          e.field === "confidence" ||
            e.message.toLowerCase().includes("confidence"),
          String(e),
        );
        return;
      }
      throw e;
    }
    assert(false, "free-float confidence must be rejected");
  });
}

export function caseRejectMentionDocument(factory: StoreFactory): CaseResult {
  return runCase("reject_mention_document", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    try {
      store.upsertDocument({
        "@type": "Mention",
        mention_id: "m1",
      });
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        assert(
          e.message.toLowerCase().includes("mention") || e.field === "@type",
          String(e),
        );
        return;
      }
      throw e;
    }
    assert(false, "Mention document must be rejected");
  });
}

export function caseRejectEvaluationTwoTargets(
  factory: StoreFactory,
): CaseResult {
  return runCase("reject_evaluation_two_targets", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    store.upsertDocument({
      "@type": "Attempt",
      attempt_key: "Ax",
      lane: "L",
    });
    store.upsertDocument({
      "@type": "Artifact",
      path: "a.txt",
      content_hash: "h1",
    });
    try {
      store.upsertDocument({
        "@type": "Evaluation",
        evaluation_id: "E-two",
        verdict: "approved",
        evaluates_attempt: "Attempt/Ax",
        evaluates_artifact: "Artifact/a.txt+h1",
      });
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        assert(
          e.message.toLowerCase().includes("exactly one") ||
            e.message.toLowerCase().includes("evaluates"),
          String(e),
        );
        return;
      }
      throw e;
    }
    assert(false, "Evaluation with two targets must be rejected");
  });
}

export function caseUpsertIdempotent(factory: StoreFactory): CaseResult {
  return runCase("upsert_idempotent_same_key", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    const id1 = store.upsertDocument({
      "@type": "Task",
      task_key: "idem",
      title: "first",
    });
    const id2 = store.upsertDocument({
      "@type": "Task",
      task_key: "idem",
      title: "second",
    });
    assert(id1 === id2 && id1 === "Task/idem", "ids");
    const got = store.getDocumentById("Task/idem");
    assert(got !== null && got["title"] === "second", "title");
    const tasks = store.listDocuments("Task");
    assert(
      tasks.filter((t) => t["task_key"] === "idem").length === 1,
      "single",
    );
  });
}

export function caseOptionalCapabilitiesClosedSet(
  factory: StoreFactory,
): CaseResult {
  return runCase("optional_capabilities_closed_set", () => {
    const store = factory();
    const caps = store.capabilities();
    for (const c of caps) {
      assert(
        OPTIONAL_CAPABILITIES.has(c as never),
        `backend reported unknown capability ${c}`,
      );
    }
    for (const name of OPTIONAL_CAPABILITIES) {
      store.hasCapability(name);
    }
    try {
      store.hasCapability("not_a_real_cap");
      assert(false, "unknown capability must raise");
    } catch (e) {
      assert(e instanceof Error, "Error");
    }
  });
}

export function caseMissingCapabilityDegrades(
  factory: StoreFactory,
): CaseResult {
  return runCase("missing_capability_degrades_and_prefix_rejected", () => {
    const store = factory();
    if (!store.hasCapability(CAP_TIME_TRAVEL)) {
      try {
        store.asOf("main");
        assert(false, "as_of must raise when time_travel absent");
      } catch (e) {
        assert(e instanceof CapabilityUnavailableError, String(e));
        assert(e.capability === CAP_TIME_TRAVEL, "cap");
      }
      try {
        store.asOf("branch:main");
        assert(false, "branch: prefix must raise VersionReferenceError");
      } catch (e) {
        if (e instanceof CapabilityUnavailableError) {
          assert(
            false,
            "branch: prefix must be VersionReferenceError, not CapabilityUnavailableError",
          );
        }
        assert(e instanceof VersionReferenceError, String(e));
      }
    } else {
      try {
        store.asOf("branch:main");
        assert(false, "branch: prefix must raise VersionReferenceError");
      } catch (e) {
        assert(e instanceof VersionReferenceError, String(e));
      }
    }
  });
}

export function caseLineageAttemptsFromRound(
  factory: StoreFactory,
): CaseResult {
  return runCase("lineage_attempts_from_round", () => {
    const store = factory();
    seedLineageFixture(store);
    const result = store.query("attempts_from_round", {
      expectEmpty: false,
      params: { round_id: "Round/T7+1" },
    });
    const rows = new Set(result.rows);
    assert(rows.has("Attempt/A1") && rows.has("Attempt/A2"), String([...rows]));
    assert(
      !rows.has("Attempt/A3") && !rows.has("Attempt/A4"),
      String([...rows]),
    );
    const r2 = store.query("attempts_from_round", {
      expectEmpty: false,
      params: { task_key: "T7", index: 2 },
    });
    const rows2 = new Set(r2.rows);
    assert(
      rows2.has("Attempt/A3") && rows2.has("Attempt/A4"),
      String([...rows2]),
    );
    assert(rows2.size >= 2, "size");
  });
}

export function caseLineageUnevaluatedLeaves(
  factory: StoreFactory,
): CaseResult {
  return runCase("lineage_unevaluated_leaves", () => {
    const store = factory();
    seedLineageFixture(store);
    const result = store.query("unevaluated_leaves", { expectEmpty: false });
    const rows = new Set(result.rows);
    assert(
      rows.size === 2 && rows.has("Attempt/A2") && rows.has("Attempt/A4"),
      String([...rows]),
    );
  });
}

export function caseLineageClaimsContradicting(
  factory: StoreFactory,
): CaseResult {
  return runCase("lineage_claims_contradicting", () => {
    const store = factory();
    seedLineageFixture(store);
    const result = store.query("claims_contradicting", {
      expectEmpty: false,
      params: { claim_id: "Claim/C1" },
    });
    assert(
      result.rows.length === 1 && result.rows[0] === "Claim/C2",
      String(result.rows),
    );
  });
}

export function caseUnexpectedEmptyRaises(factory: StoreFactory): CaseResult {
  return runCase("unexpected_empty_raises", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    try {
      store.query("unevaluated_leaves", { expectEmpty: false });
    } catch (e) {
      if (e instanceof UnexpectedEmptyError) {
        assert(e.queryName === "unevaluated_leaves", "name");
        return;
      }
      throw e;
    }
    assert(false, "expected UnexpectedEmptyError");
  });
}

export function caseExpectedEmptyTrueNegative(
  factory: StoreFactory,
): CaseResult {
  return runCase("expected_empty_true_negative", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    const result = store.query("claims_contradicting", {
      expectEmpty: true,
      params: { claim_key: "nope" },
    });
    assert(result.isEmpty, "empty");
    assert(result.expectedEmpty === true, "flag");
  });
}

export function caseUnexpectedNonemptyRaises(
  factory: StoreFactory,
): CaseResult {
  return runCase("unexpected_nonempty_raises", () => {
    const store = factory();
    seedLineageFixture(store);
    try {
      store.query("claims_contradicting", {
        expectEmpty: true,
        params: { claim_id: "Claim/C1" },
      });
    } catch (e) {
      if (e instanceof UnexpectedNonEmptyError) {
        assert(e.queryName === "claims_contradicting", "name");
        assert(e.count >= 1, "count");
        return;
      }
      throw e;
    }
    assert(false, "expected UnexpectedNonEmptyError");
  });
}

export function caseUnknownQueryRejected(factory: StoreFactory): CaseResult {
  return runCase("unknown_query_rejected", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    try {
      store.query("not_a_lineage_query", { expectEmpty: true });
    } catch (e) {
      if (e instanceof Error) return;
      throw e;
    }
    assert(false, "unknown query name must raise");
  });
}

export function caseLineageQueryNamesComplete(
  factory: StoreFactory,
): CaseResult {
  return runCase("lineage_query_names_complete", () => {
    assert(
      LINEAGE_QUERIES.size === 3 &&
        LINEAGE_QUERIES.has("attempts_from_round") &&
        LINEAGE_QUERIES.has("unevaluated_leaves") &&
        LINEAGE_QUERIES.has("claims_contradicting"),
      "query set",
    );
    const store = factory();
    assert(store !== null, "store");
  });
}

export function caseDependsOnCycleRejected(factory: StoreFactory): CaseResult {
  return runCase("depends_on_cycle_rejected", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    store.upsertDocument({
      "@type": "Task",
      task_key: "c1",
      title: "c1",
    });
    store.upsertDocument({
      "@type": "Task",
      task_key: "c2",
      title: "c2",
      depends_on: ["Task/c1"],
    });
    try {
      store.upsertDocument({
        "@type": "Task",
        task_key: "c1",
        title: "c1-cycle",
        depends_on: ["Task/c2"],
      });
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        assert(e.message.toLowerCase().includes("cycle"), String(e));
        return;
      }
      throw e;
    }
    assert(false, "DEPENDS_ON cycle must be rejected");
  });
}

export function caseResolvedToRequiresReviewer(
  factory: StoreFactory,
): CaseResult {
  return runCase("resolved_to_requires_reviewer", () => {
    const store = factory();
    store.registerSchema(defaultSchemaPayload());
    store.upsertDocument({
      "@type": "Entity",
      canonical_name: "foreman",
      entity_type: "project",
    });
    store.upsertDocument({
      "@type": "Entity",
      canonical_name: "Foreman",
      entity_type: "project",
    });
    try {
      store.upsertDocument({
        "@type": "Entity",
        canonical_name: "Foreman",
        entity_type: "project",
        resolved_to: "Entity/foreman+project",
      });
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        assert(
          e.message.toLowerCase().includes("reviewer") ||
            e.field === "resolved_to_reviewer",
          String(e),
        );
        return;
      }
      throw e;
    }
    assert(false, "RESOLVED_TO without reviewer must be rejected");
  });
}

export const ALL_CASES: readonly ((f: StoreFactory) => CaseResult)[] = [
  caseSchemaRequiredBeforeWrite,
  caseSchemaAcceptsConforming,
  caseRejectFreeFloatConfidence,
  caseRejectMentionDocument,
  caseRejectEvaluationTwoTargets,
  caseUpsertIdempotent,
  caseOptionalCapabilitiesClosedSet,
  caseMissingCapabilityDegrades,
  caseLineageAttemptsFromRound,
  caseLineageUnevaluatedLeaves,
  caseLineageClaimsContradicting,
  caseUnexpectedEmptyRaises,
  caseExpectedEmptyTrueNegative,
  caseUnexpectedNonemptyRaises,
  caseUnknownQueryRejected,
  caseLineageQueryNamesComplete,
  caseDependsOnCycleRejected,
  caseResolvedToRequiresReviewer,
];

export function runSuite(factory: StoreFactory): SuiteReport {
  const results = ALL_CASES.map((c) => c(factory));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return {
    results,
    passed,
    failed,
    ok: failed === 0 && results.length > 0,
  };
}

export function formatReport(report: SuiteReport): string {
  const lines = report.results.map((r) => {
    const flag = r.passed ? "PASS" : "FAIL";
    const extra = r.detail ? ` — ${r.detail}` : "";
    return `[${flag}] ${r.name}${extra}`;
  });
  lines.push("");
  lines.push(
    `${report.passed} passed, ${report.failed} failed, ${report.results.length} total`,
  );
  lines.push(report.ok ? "SUITE OK" : "SUITE FAILED");
  return lines.join("\n");
}

/**
 * Deliberately broken backend used to prove the suite is backend-agnostic.
 * Claims every optional capability, accepts writes without schema, returns
 * empty for every query, stores nothing, does not reject branch: prefix.
 */
export class StubEmptyBackend implements GraphStore {
  capabilities(): ReadonlySet<string> {
    return new Set(OPTIONAL_CAPABILITIES);
  }
  hasCapability(name: string): boolean {
    if (!OPTIONAL_CAPABILITIES.has(name as never)) {
      throw new Error(`unknown capability ${name}`);
    }
    return true;
  }
  requireCapability(): void {
    /* pretends available */
  }
  registerSchema(): void {
    /* pretend */
  }
  upsertDocument(doc: JsonObject): string {
    return `Stub/${String(doc["@type"] ?? "X")}`;
  }
  getDocument(): JsonObject | null {
    return null;
  }
  getDocumentById(): JsonObject | null {
    return null;
  }
  listDocuments(): JsonObject[] {
    return [];
  }
  query(
    name: string,
    opts: {
      readonly expectEmpty: boolean;
      readonly params?: JsonObject | null;
    },
  ): QueryResult {
    return runPortQuery(this, name, opts);
  }
  runQuery(): readonly unknown[] {
    return [];
  }
  asOf(): GraphStore {
    // Does not normalise / reject branch: prefix — another real failure.
    return this;
  }
}

export function filesOnlyFactory(): FilesOnlyGraphStore {
  return openFilesOnly({ root: null, autoSchema: false });
}

export function stubFactory(): GraphStore {
  return new StubEmptyBackend();
}

/**
 * CLI / process entry for the suite.
 * Exit 0 only when the outcome matches expectation.
 */
export function runContractMain(argv: readonly string[]): number {
  let backend: "files_only" | "stub" = "files_only";
  let expectFail = false;
  for (const a of argv) {
    if (
      a === "--backend=files_only" ||
      a === "--backend=files" ||
      a === "files_only" ||
      a === "files"
    ) {
      backend = "files_only";
    } else if (a === "--backend=stub" || a === "stub") {
      backend = "stub";
    } else if (a === "--expect-fail") {
      expectFail = true;
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(
        "Usage: graph-store contract [files_only|stub] [--expect-fail]\n" +
          "  files_only (default): must PASS\n" +
          "  stub: deliberately broken; must FAIL (use --expect-fail)\n",
      );
      return 0;
    } else {
      process.stderr.write(`unknown arg: ${a}\n`);
      return 2;
    }
  }

  const factory: StoreFactory =
    backend === "files_only" ? filesOnlyFactory : stubFactory;
  const report = runSuite(factory);
  process.stdout.write(formatReport(report) + "\n");
  process.stdout.write(`backend=${backend} expect_fail=${expectFail}\n`);

  if (expectFail) {
    if (report.ok) {
      process.stderr.write(
        "SOUNDNESS FAILURE: suite passed against the broken stub — the suite is not testing the contract\n",
      );
      return 1;
    }
    if (report.failed < 3) {
      process.stderr.write(
        `SOUNDNESS FAILURE: stub produced only ${report.failed} failure(s); expected several independent contract failures\n`,
      );
      return 1;
    }
    process.stdout.write(
      `SOUNDNESS OK: stub failed ${report.failed} cases as required\n`,
    );
    return 0;
  }
  return report.ok ? 0 : 1;
}
