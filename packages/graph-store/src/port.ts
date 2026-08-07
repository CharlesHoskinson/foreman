/**
 * GraphStore port: operation set and contracts every backend must satisfy.
 */

import {
  CapabilityUnavailableError,
  UnexpectedEmptyError,
  UnexpectedNonEmptyError,
  VersionReferenceError,
  type GraphStoreFailure,
} from "./failures.js";

// ---------------------------------------------------------------------------
// Optional capability names — closed set
// ---------------------------------------------------------------------------

export const CAP_TIME_TRAVEL = "time_travel" as const;
export const CAP_BRANCH_MERGE = "branch_merge" as const;
export const CAP_CROSS_RUN_QUERY = "cross_run_query" as const;

export type OptionalCapability =
  | typeof CAP_TIME_TRAVEL
  | typeof CAP_BRANCH_MERGE
  | typeof CAP_CROSS_RUN_QUERY;

export const OPTIONAL_CAPABILITIES: ReadonlySet<OptionalCapability> = new Set([
  CAP_TIME_TRAVEL,
  CAP_BRANCH_MERGE,
  CAP_CROSS_RUN_QUERY,
]);

export const LINEAGE_QUERIES = new Set([
  "attempts_from_round",
  "unevaluated_leaves",
  "claims_contradicting",
] as const);

export type LineageQueryName =
  | "attempts_from_round"
  | "unevaluated_leaves"
  | "claims_contradicting";

export const DOCUMENT_TYPES = new Set([
  "Task",
  "Round",
  "Attempt",
  "AgentRun",
  "Agent",
  "Artifact",
  "Spec",
  "Commit",
  "Source",
  "Evaluation",
  "Claim",
  "Entity",
  "Metric",
  "Measurement",
  "Finding",
] as const);

export type DocumentType =
  | "Task"
  | "Round"
  | "Attempt"
  | "AgentRun"
  | "Agent"
  | "Artifact"
  | "Spec"
  | "Commit"
  | "Source"
  | "Evaluation"
  | "Claim"
  | "Entity"
  | "Metric"
  | "Measurement"
  | "Finding";

export type JsonObject = Record<string, unknown>;

export type QueryResult = {
  readonly rows: readonly unknown[];
  readonly queryName: string;
  readonly expectedEmpty: boolean;
  readonly capabilityDegraded: readonly string[];
  readonly isEmpty: boolean;
};

export function makeQueryResult(args: {
  readonly rows: readonly unknown[];
  readonly queryName: string;
  readonly expectedEmpty: boolean;
  readonly capabilityDegraded?: readonly string[];
}): QueryResult {
  return {
    rows: args.rows,
    queryName: args.queryName,
    expectedEmpty: args.expectedEmpty,
    capabilityDegraded: args.capabilityDegraded ?? [],
    isEmpty: args.rows.length === 0,
  };
}

export type SchemaRegistration = {
  readonly payload: unknown;
  readonly author?: string;
  readonly message?: string;
};

/**
 * Build a deterministic lexical document id: `Type/part1+part2+...`.
 */
export function documentId(docType: string, ...keyParts: string[]): string {
  if (!docType) {
    throw new Error("doc_type is required");
  }
  if (keyParts.length === 0 || keyParts.some((p) => p === "" || p == null)) {
    throw new Error("key_parts must be non-empty strings");
  }
  return `${docType}/${keyParts.join("+")}`;
}

/**
 * Normalise a version reference; reject the silent-empty prefix form.
 *
 * Accepted: bare branch name, or `commit:<id>`.
 * Rejected: `branch:<id>`, empty, full path `admin/.../branch/...`, unknown prefix.
 */
export function normaliseVersionRef(ref: string): string {
  if (ref == null || !String(ref).trim()) {
    throw new VersionReferenceError(
      String(ref),
      "version reference must be non-empty",
    );
  }
  const s = String(ref).trim();
  if (s.startsWith("branch:")) {
    throw new VersionReferenceError(s);
  }
  if (s.startsWith("admin/") && s.includes("/branch/")) {
    throw new VersionReferenceError(
      s,
      `invalid version reference ${JSON.stringify(s)}: full path form is rejected; use a bare branch name or commit:<id>`,
    );
  }
  if (s.startsWith("commit:")) {
    if (s.length <= "commit:".length || !s.slice("commit:".length).trim()) {
      throw new VersionReferenceError(
        s,
        `commit reference ${JSON.stringify(s)} has empty id`,
      );
    }
    return s;
  }
  if (s.includes(":")) {
    throw new VersionReferenceError(
      s,
      `invalid version reference ${JSON.stringify(s)}: unknown prefix; accepted forms are bare branch name or commit:<id>`,
    );
  }
  return s;
}

/**
 * Result form for fallible pure helpers that avoid throw.
 */
export type Result<A, E> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Err"; readonly error: E };

export function ok<A>(value: A): Result<A, never> {
  return { _tag: "Ok", value };
}

export function err<E>(error: E): Result<never, E> {
  return { _tag: "Err", error };
}

/**
 * Abstract GraphStore port surface.
 * Implementations: FilesOnlyGraphStore (this package); adapters deferred.
 */
export interface GraphStore {
  capabilities(): ReadonlySet<string>;
  hasCapability(name: string): boolean;
  requireCapability(name: string): void;
  registerSchema(
    schema: unknown,
    opts?: { readonly author?: string; readonly message?: string },
  ): void;
  upsertDocument(doc: JsonObject): string;
  getDocument(
    docType: string,
    key: string | JsonObject,
  ): JsonObject | null;
  getDocumentById(docId: string): JsonObject | null;
  listDocuments(docType?: string | null): JsonObject[];
  query(
    name: string,
    opts: {
      readonly expectEmpty: boolean;
      readonly params?: JsonObject | null;
    },
  ): QueryResult;
  asOf(versionRef: string): GraphStore;
  /** Backend-specific query body; do not apply expected-emptiness. */
  runQuery(name: string, params: JsonObject): readonly unknown[];
}

/**
 * Shared query wrapper: closed name set, dedupe, expected-emptiness.
 */
export function runPortQuery(
  store: Pick<GraphStore, "runQuery">,
  name: string,
  opts: {
    readonly expectEmpty: boolean;
    readonly params?: JsonObject | null;
  },
): QueryResult {
  if (!LINEAGE_QUERIES.has(name as LineageQueryName)) {
    throw new Error(
      `unknown query ${JSON.stringify(name)}; known: ${[...LINEAGE_QUERIES].sort().join(", ")}`,
    );
  }
  const raw = store.runQuery(name, { ...(opts.params ?? {}) });
  const seen = new Set<string>();
  const rows: unknown[] = [];
  for (const r of raw) {
    const key = typeof r === "string" ? r : JSON.stringify(r);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  if (opts.expectEmpty && rows.length > 0) {
    throw new UnexpectedNonEmptyError(name, rows.length);
  }
  if (!opts.expectEmpty && rows.length === 0) {
    throw new UnexpectedEmptyError(name);
  }
  return makeQueryResult({
    rows,
    queryName: name,
    expectedEmpty: opts.expectEmpty,
  });
}

export function checkHasCapability(
  caps: ReadonlySet<string>,
  name: string,
): boolean {
  if (!OPTIONAL_CAPABILITIES.has(name as OptionalCapability)) {
    throw new Error(
      `unknown capability ${JSON.stringify(name)}; known: ${[...OPTIONAL_CAPABILITIES].sort().join(", ")}`,
    );
  }
  return caps.has(name);
}

export function checkRequireCapability(
  caps: ReadonlySet<string>,
  name: string,
): void {
  if (!checkHasCapability(caps, name)) {
    throw new CapabilityUnavailableError(name);
  }
}

export function defaultAsOf(
  versionRef: string,
  capability: string = CAP_TIME_TRAVEL,
): never {
  normaliseVersionRef(versionRef);
  throw new CapabilityUnavailableError(capability);
}

/** Type guard helper re-export for failure consumers. */
export type { GraphStoreFailure };
