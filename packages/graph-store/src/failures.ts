/**
 * Named GraphStore failure vocabulary.
 * Failures are branded so ordinary JSON cannot masquerade as them.
 */

export const GRAPH_STORE_FAILURE_BRAND = Symbol(
  "@foreman/graph-store/GraphStoreFailure",
);

type Branded = { readonly [GRAPH_STORE_FAILURE_BRAND]: true };

export type GraphStoreFailureReason =
  | "schema_not_registered"
  | "schema_validation"
  | "document_not_found"
  | "unexpected_empty"
  | "unexpected_non_empty"
  | "capability_unavailable"
  | "version_reference"
  | "unknown_query"
  | "unknown_capability"
  | "invalid_path"
  | "symlink_rejected"
  | "hard_link_rejected"
  | "path_escape"
  | "corrupt_state"
  | "torn_generation"
  | "missing_generation"
  | "duplicate_json_key"
  | "invalid_json"
  | "malformed_utf8"
  | "oversize_input"
  | "limit_exceeded"
  | "store_busy"
  | "identity_changed"
  | "backend_misconfiguration"
  | "ungrounded_write"
  | "invalid_argument";

export type GraphStoreFailure = Branded & {
  readonly _tag: "GraphStoreFailure";
  readonly reason: GraphStoreFailureReason;
  readonly message: string;
  readonly field?: string;
  readonly detail?: string;
  readonly queryName?: string;
  readonly capability?: string;
  readonly ref?: string;
  readonly count?: number;
};

export function graphStoreFailure(
  reason: GraphStoreFailureReason,
  message: string,
  extra?: {
    readonly field?: string;
    readonly detail?: string;
    readonly queryName?: string;
    readonly capability?: string;
    readonly ref?: string;
    readonly count?: number;
  },
): GraphStoreFailure {
  const base: GraphStoreFailure = {
    [GRAPH_STORE_FAILURE_BRAND]: true,
    _tag: "GraphStoreFailure",
    reason,
    message,
  };
  if (extra?.field !== undefined) {
    return { ...base, field: extra.field, ...(extra.detail !== undefined ? { detail: extra.detail } : {}), ...(extra.queryName !== undefined ? { queryName: extra.queryName } : {}), ...(extra.capability !== undefined ? { capability: extra.capability } : {}), ...(extra.ref !== undefined ? { ref: extra.ref } : {}), ...(extra.count !== undefined ? { count: extra.count } : {}) };
  }
  if (extra?.detail !== undefined) {
    return {
      ...base,
      detail: extra.detail,
      ...(extra.queryName !== undefined ? { queryName: extra.queryName } : {}),
      ...(extra.capability !== undefined ? { capability: extra.capability } : {}),
      ...(extra.ref !== undefined ? { ref: extra.ref } : {}),
      ...(extra.count !== undefined ? { count: extra.count } : {}),
    };
  }
  if (extra?.queryName !== undefined) {
    return {
      ...base,
      queryName: extra.queryName,
      ...(extra.capability !== undefined ? { capability: extra.capability } : {}),
      ...(extra.ref !== undefined ? { ref: extra.ref } : {}),
      ...(extra.count !== undefined ? { count: extra.count } : {}),
    };
  }
  if (extra?.capability !== undefined) {
    return {
      ...base,
      capability: extra.capability,
      ...(extra.ref !== undefined ? { ref: extra.ref } : {}),
      ...(extra.count !== undefined ? { count: extra.count } : {}),
    };
  }
  if (extra?.ref !== undefined) {
    return {
      ...base,
      ref: extra.ref,
      ...(extra.count !== undefined ? { count: extra.count } : {}),
    };
  }
  if (extra?.count !== undefined) {
    return { ...base, count: extra.count };
  }
  return base;
}

export function isGraphStoreFailure(v: unknown): v is GraphStoreFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [GRAPH_STORE_FAILURE_BRAND]?: unknown })[
      GRAPH_STORE_FAILURE_BRAND
    ] === true &&
    (v as { _tag?: unknown })._tag === "GraphStoreFailure"
  );
}

export function schemaNotRegistered(
  message = "register_schema must be called before upsert_document",
): GraphStoreFailure {
  return graphStoreFailure("schema_not_registered", message);
}

export function schemaValidation(
  message: string,
  opts?: { readonly field?: string; readonly detail?: string },
): GraphStoreFailure {
  return graphStoreFailure("schema_validation", message, opts);
}

export function unexpectedEmpty(queryName: string): GraphStoreFailure {
  return graphStoreFailure(
    "unexpected_empty",
    `query ${JSON.stringify(queryName)} returned empty but expected results`,
    { queryName },
  );
}

export function unexpectedNonEmpty(
  queryName: string,
  count: number,
): GraphStoreFailure {
  return graphStoreFailure(
    "unexpected_non_empty",
    `query ${JSON.stringify(queryName)} returned ${count} row(s) but expected empty`,
    { queryName, count },
  );
}

export function capabilityUnavailable(capability: string): GraphStoreFailure {
  return graphStoreFailure(
    "capability_unavailable",
    `optional capability ${JSON.stringify(capability)} is unavailable on this backend`,
    { capability },
  );
}

export function versionReference(
  ref: string,
  message?: string,
): GraphStoreFailure {
  return graphStoreFailure(
    "version_reference",
    message ??
      `invalid version reference ${JSON.stringify(ref)}: accepted forms are bare branch name or commit:<id>; the response-header prefix form branch:<id> is rejected`,
    { ref },
  );
}

/**
 * Error class wrappers for call sites that prefer throw/catch (contract suite).
 * Carry the branded failure as `.failure`.
 */
export class GraphStoreError extends Error {
  readonly failure: GraphStoreFailure;
  constructor(failure: GraphStoreFailure) {
    super(failure.message);
    this.name = "GraphStoreError";
    this.failure = failure;
  }
}

export class SchemaNotRegisteredError extends GraphStoreError {
  constructor(message?: string) {
    super(schemaNotRegistered(message));
    this.name = "SchemaNotRegisteredError";
  }
}

export class SchemaValidationError extends GraphStoreError {
  readonly field: string | undefined;
  readonly detail: string | undefined;
  constructor(
    message: string,
    opts?: { readonly field?: string; readonly detail?: string },
  ) {
    super(schemaValidation(message, opts));
    this.name = "SchemaValidationError";
    this.field = opts?.field;
    this.detail = opts?.detail;
  }
}

export class UnexpectedEmptyError extends GraphStoreError {
  readonly queryName: string;
  constructor(queryName: string) {
    super(unexpectedEmpty(queryName));
    this.name = "UnexpectedEmptyError";
    this.queryName = queryName;
  }
}

export class UnexpectedNonEmptyError extends GraphStoreError {
  readonly queryName: string;
  readonly count: number;
  constructor(queryName: string, count: number) {
    super(unexpectedNonEmpty(queryName, count));
    this.name = "UnexpectedNonEmptyError";
    this.queryName = queryName;
    this.count = count;
  }
}

export class CapabilityUnavailableError extends GraphStoreError {
  readonly capability: string;
  constructor(capability: string) {
    super(capabilityUnavailable(capability));
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
  }
}

export class VersionReferenceError extends GraphStoreError {
  readonly ref: string;
  constructor(ref: string, message?: string) {
    super(versionReference(ref, message));
    this.name = "VersionReferenceError";
    this.ref = ref;
  }
}

export class DocumentNotFoundError extends GraphStoreError {
  constructor(message = "document not found") {
    super(graphStoreFailure("document_not_found", message));
    this.name = "DocumentNotFoundError";
  }
}

export function throwFailure(failure: GraphStoreFailure): never {
  switch (failure.reason) {
    case "schema_not_registered":
      throw new SchemaNotRegisteredError(failure.message);
    case "schema_validation":
      throw new SchemaValidationError(failure.message, {
        ...(failure.field !== undefined ? { field: failure.field } : {}),
        ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
      });
    case "unexpected_empty":
      throw new UnexpectedEmptyError(failure.queryName ?? "unknown");
    case "unexpected_non_empty":
      throw new UnexpectedNonEmptyError(
        failure.queryName ?? "unknown",
        failure.count ?? 0,
      );
    case "capability_unavailable":
      throw new CapabilityUnavailableError(failure.capability ?? "unknown");
    case "version_reference":
      throw new VersionReferenceError(failure.ref ?? "", failure.message);
    case "document_not_found":
      throw new DocumentNotFoundError(failure.message);
    case "unknown_query":
    case "unknown_capability":
    case "invalid_argument":
      throw new Error(failure.message);
    default:
      throw new GraphStoreError(failure);
  }
}
