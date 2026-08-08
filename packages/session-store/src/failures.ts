/**
 * Named SessionStore failure vocabulary.
 * Failures are branded so ordinary JSON cannot masquerade as them.
 * Mirrors the shape already established by @foreman/graph-store.
 */

export const SESSION_STORE_FAILURE_BRAND = Symbol(
  "@foreman/session-store/SessionStoreFailure",
);

type Branded = { readonly [SESSION_STORE_FAILURE_BRAND]: true };

export type SessionStoreFailureReason =
  | "unknown_entity_kind"
  | "unknown_field"
  | "missing_field"
  | "field_type"
  | "enum_value"
  | "null_violation"
  | "identity_conflict"
  | "ordering_violation"
  | "model_version_unsupported"
  | "sidecar_format"
  | "sidecar_malformed"
  | "supersession_cycle"
  | "supersession_dangling"
  | "supersession_incomplete"
  | "store_not_empty"
  | "backend_mismatch"
  | "invalid_argument";

export type SessionStoreFailure = Branded & {
  readonly _tag: "SessionStoreFailure";
  readonly reason: SessionStoreFailureReason;
  readonly message: string;
  readonly kind?: string;
  readonly field?: string;
  readonly detail?: string;
};

export function sessionStoreFailure(
  reason: SessionStoreFailureReason,
  message: string,
  extra?: {
    readonly kind?: string;
    readonly field?: string;
    readonly detail?: string;
  },
): SessionStoreFailure {
  return {
    [SESSION_STORE_FAILURE_BRAND]: true,
    _tag: "SessionStoreFailure",
    reason,
    message,
    ...(extra?.kind !== undefined ? { kind: extra.kind } : {}),
    ...(extra?.field !== undefined ? { field: extra.field } : {}),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
  };
}

export function isSessionStoreFailure(v: unknown): v is SessionStoreFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<PropertyKey, unknown>)[SESSION_STORE_FAILURE_BRAND] === true
  );
}

/** Error carrier so failures can cross a throw boundary without losing shape. */
export class SessionStoreError extends Error {
  readonly failure: SessionStoreFailure;

  constructor(failure: SessionStoreFailure) {
    super(failure.message);
    this.name = "SessionStoreError";
    this.failure = failure;
  }
}

export function raise(
  reason: SessionStoreFailureReason,
  message: string,
  extra?: {
    readonly kind?: string;
    readonly field?: string;
    readonly detail?: string;
  },
): never {
  throw new SessionStoreError(sessionStoreFailure(reason, message, extra));
}

export function reasonOf(e: unknown): SessionStoreFailureReason | null {
  if (e instanceof SessionStoreError) return e.failure.reason;
  if (isSessionStoreFailure(e)) return e.reason;
  return null;
}
