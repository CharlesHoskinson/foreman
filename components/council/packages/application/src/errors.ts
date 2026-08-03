import { Data } from "effect";

/**
 * Closed tagged errors for ACE prompt compilation.
 * Every error preserves a stage and an actionable reason.
 * The pipeline stops at the first failure.
 */

export type PromptCompileStage =
  | "contract_decode"
  | "ace_parse"
  | "ace_canonicalize"
  | "semantic_lint"
  | "bundle_verify"
  | "diff_artifact"
  | "artifact_limit"
  | "artifact_read"
  | "artifact_length"
  | "artifact_digest"
  | "artifact_encoding"
  | "canonical_schema"
  | "schema_lowering"
  | "constraint_verify"
  | "prompt_materialize"
  | "prompt_limit"
  | "digest";

export class ContractDecodeError extends Data.TaggedError(
  "ContractDecodeError",
)<{
  readonly stage: "contract_decode";
  readonly reason: string;
}> {}

export class AceParseError extends Data.TaggedError("AceParseError")<{
  readonly stage: "ace_parse";
  readonly reason: string;
  readonly offset: number;
  readonly length: number;
}> {}

export class AceSemanticError extends Data.TaggedError("AceSemanticError")<{
  readonly stage: "semantic_lint";
  readonly reason: string;
  readonly offset: number;
  readonly length: number;
}> {}

export class BundleVerificationError extends Data.TaggedError(
  "BundleVerificationError",
)<{
  readonly stage: "bundle_verify";
  readonly reason: string;
  readonly field: "baseSha" | "headSha" | "diffSha256" | "bundle";
}> {}

export class DiffArtifactError extends Data.TaggedError("DiffArtifactError")<{
  readonly stage: "diff_artifact";
  readonly reason: string;
  readonly matchCount: number;
}> {}

export class ArtifactLimitExceeded extends Data.TaggedError(
  "ArtifactLimitExceeded",
)<{
  readonly stage: "artifact_limit";
  readonly reason: string;
  readonly artifactId: string;
  readonly maxArtifactBytes: number;
  readonly observedBytes: number;
}> {}

export class ArtifactMissing extends Data.TaggedError("ArtifactMissing")<{
  readonly stage: "artifact_read";
  readonly reason: string;
  readonly artifactId: string;
}> {}

export class ArtifactReadError extends Data.TaggedError("ArtifactReadError")<{
  readonly stage: "artifact_read";
  readonly reason: string;
  readonly artifactId: string;
  readonly category?: "not_found" | "permission" | "io" | "limit" | "unknown";
}> {}

export class ArtifactLengthMismatch extends Data.TaggedError(
  "ArtifactLengthMismatch",
)<{
  readonly stage: "artifact_length";
  readonly reason: string;
  readonly artifactId: string;
  readonly expected: number;
  readonly actual: number;
}> {}

export class ArtifactDigestMismatch extends Data.TaggedError(
  "ArtifactDigestMismatch",
)<{
  readonly stage: "artifact_digest";
  readonly reason: string;
  readonly artifactId: string;
  readonly expected: string;
  readonly actual: string;
}> {}

export class ArtifactEncodingInvalid extends Data.TaggedError(
  "ArtifactEncodingInvalid",
)<{
  readonly stage: "artifact_encoding";
  readonly reason: string;
  readonly artifactId: string;
}> {}

export class CanonicalSchemaInvalid extends Data.TaggedError(
  "CanonicalSchemaInvalid",
)<{
  readonly stage: "canonical_schema";
  readonly reason: string;
}> {}

export class SchemaLoweringError extends Data.TaggedError(
  "SchemaLoweringError",
)<{
  readonly stage: "schema_lowering";
  readonly reason: string;
  readonly path: string;
  readonly keyword?: string;
}> {}

export class ConstraintWeakeningError extends Data.TaggedError(
  "ConstraintWeakeningError",
)<{
  readonly stage: "constraint_verify";
  readonly reason: string;
  readonly path: string;
}> {}

export class PromptMaterializationError extends Data.TaggedError(
  "PromptMaterializationError",
)<{
  readonly stage: "prompt_materialize";
  readonly reason: string;
}> {}

export class PromptLimitExceeded extends Data.TaggedError(
  "PromptLimitExceeded",
)<{
  readonly stage: "prompt_limit";
  readonly reason: string;
  readonly maxPromptBytes: number;
  readonly actualBytes: number;
}> {}

export class DigestError extends Data.TaggedError("DigestError")<{
  readonly stage: "digest";
  readonly reason: string;
}> {}

/**
 * Closed process-transport failure. Only a stable category and a secret-safe
 * reason are allowed. Never include environment values, raw output, cwd, or
 * home paths.
 */
export type ProviderProcessErrorCategory = "start_failed" | "internal";

export class ProviderProcessError extends Data.TaggedError(
  "ProviderProcessError",
)<{
  readonly category: ProviderProcessErrorCategory;
  readonly reason: string;
}> {}

export type PromptCompileError =
  | ContractDecodeError
  | AceParseError
  | AceSemanticError
  | BundleVerificationError
  | DiffArtifactError
  | ArtifactLimitExceeded
  | ArtifactMissing
  | ArtifactReadError
  | ArtifactLengthMismatch
  | ArtifactDigestMismatch
  | ArtifactEncodingInvalid
  | CanonicalSchemaInvalid
  | SchemaLoweringError
  | ConstraintWeakeningError
  | PromptMaterializationError
  | PromptLimitExceeded
  | DigestError;
