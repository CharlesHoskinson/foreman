import * as Schema from "effect/Schema";

export const AuthorityClass = Schema.Literal(
  "trusted_instruction",
  "approved_contract",
  "user_data",
  "tool_metadata",
  "untrusted_evidence",
);
export type AuthorityClass = typeof AuthorityClass.Type;

export const ValidationStatus = Schema.Literal(
  "valid",
  "invalid",
  "untrusted",
  "unknown",
  "inaccessible",
  "incomplete",
);
export type ValidationStatus = typeof ValidationStatus.Type;

export const ClaimSupportStatus = Schema.Literal(
  "verified",
  "disputed",
  "unsupported",
  "unverifiable",
);
export type ClaimSupportStatus = typeof ClaimSupportStatus.Type;
