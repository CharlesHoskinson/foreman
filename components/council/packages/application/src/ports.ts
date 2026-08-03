import type {
  CanaryChallengeV1,
  ContentHash,
  ProviderFamilyV1,
  ReviewArtifactDescriptorV1,
  ReviewBundleIdentityV1,
  Sha256Digest,
  TerminalObservationV1,
  UtcTimestamp,
} from "@council/schema";
import { Context, type Effect, type Scope } from "effect";
import type {
  ArtifactLimitExceeded,
  ArtifactMissing,
  ArtifactReadError,
  BundleVerificationError,
  CanonicalSchemaInvalid,
  CanaryMaterializerError,
  ConstraintWeakeningError,
  DigestError,
  PreflightIdentityError,
  PromptMaterializationError,
  ProviderCanaryAdapterError,
  ProviderProcessError,
  ProviderVersionProbeError,
  SchemaLoweringError,
} from "./errors.js";

export type ArtifactBytes = Uint8Array;

export type ArtifactReadRequest = {
  readonly descriptor: ReviewArtifactDescriptorV1;
  /** Inclusive maximum number of bytes the adapter may return. */
  readonly maxBytes: number;
};

export interface ArtifactReaderService {
  readonly read: (
    request: ArtifactReadRequest,
  ) => Effect.Effect<
    ArtifactBytes,
    ArtifactMissing | ArtifactReadError | ArtifactLimitExceeded
  >;
}

export class ArtifactReader extends Context.Tag(
  "@council/application/ArtifactReader",
)<ArtifactReader, ArtifactReaderService>() {}

export interface BundleVerifierService {
  readonly verify: (
    bundle: ReviewBundleIdentityV1,
  ) => Effect.Effect<void, BundleVerificationError>;
}

export class BundleVerifier extends Context.Tag(
  "@council/application/BundleVerifier",
)<BundleVerifier, BundleVerifierService>() {}

export interface DigestService {
  readonly sha256: (
    bytes: Uint8Array,
  ) => Effect.Effect<Sha256Digest, DigestError>;
}

export class Digest extends Context.Tag("@council/application/Digest")<
  Digest,
  DigestService
>() {}

/**
 * Materializer input is the structured prompt envelope before canonical JSON
 * encoding. Contract descriptor order is authoritative for evidence.
 */
export type UntrustedEvidenceItem = {
  readonly alias: string;
  readonly artifactId: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentEncoding: "utf8" | "base64";
  readonly content: string;
};

export type PromptMaterializerInput = {
  readonly format: "council-prompt-v1";
  readonly trustedAuthority: {
    readonly profile: "council-ace-1";
    readonly aceText: string;
  };
  readonly taskData: {
    readonly candidateId: string;
    readonly bundle: ReviewBundleIdentityV1;
    readonly limits: {
      readonly maxPromptBytes: number;
      readonly maxArtifactBytes: number;
      readonly maxTurns: number;
      readonly maxWallTimeMs: number;
      readonly maxRetries: number;
    };
  };
  readonly untrustedEvidence: UntrustedEvidenceItem[];
  readonly responseSchema: unknown;
};

export interface PromptMaterializerService {
  readonly materialize: (
    input: PromptMaterializerInput,
  ) => Effect.Effect<Uint8Array, PromptMaterializationError>;
}

export class PromptMaterializer extends Context.Tag(
  "@council/application/PromptMaterializer",
)<PromptMaterializer, PromptMaterializerService>() {}

export type SchemaTransformation = {
  readonly path: string;
  readonly kind:
    "annotation_removed" | "const_to_enum" | "key_order_canonicalized";
  readonly keyword: string;
  readonly detail: string;
};

/**
 * Host-side validation that restores a constraint the provider dialect cannot
 * enforce. Version 1 requires this list to be empty — no executable host
 * validator exists yet.
 */
export type ConstraintReceipt = {
  readonly path: string;
  readonly weakenedConstraint: string;
  readonly hostValidation: string;
};

export type SchemaLoweringReceipt = {
  readonly providerFamily: ProviderFamilyV1;
  readonly transformations: readonly SchemaTransformation[];
  readonly constraintReceipts: readonly ConstraintReceipt[];
  readonly canonicalSchemaBytes: Uint8Array;
  readonly loweredSchemaBytes: Uint8Array;
};

export type ProviderSchemaLowererInput = {
  readonly providerFamily: ProviderFamilyV1;
  readonly canonicalSchema: unknown;
  readonly canonicalSchemaBytes: Uint8Array;
};

export interface ProviderSchemaLowererService {
  readonly lower: (input: ProviderSchemaLowererInput) => Effect.Effect<
    {
      readonly loweredSchema: unknown;
      readonly loweredSchemaBytes: Uint8Array;
      readonly transformations: readonly SchemaTransformation[];
      readonly constraintReceipts: readonly ConstraintReceipt[];
    },
    SchemaLoweringError | ConstraintWeakeningError | CanonicalSchemaInvalid
  >;
}

export class ProviderSchemaLowerer extends Context.Tag(
  "@council/application/ProviderSchemaLowerer",
)<ProviderSchemaLowerer, ProviderSchemaLowererService>() {}

/**
 * Shell-free provider process request. Arguments are an indexed array only;
 * never a shell command string. Stdin is null when the provider uses argv or
 * a prompt file; non-null bytes are written exactly and the stream is closed.
 */
export type ProviderProcessRequest = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
  /** Null when stdin is unused; exact bytes when the provider reads stdin. */
  readonly stdin: Uint8Array | null;
};

export type BoundedSpool = {
  readonly bytes: Uint8Array;
  readonly digest: Sha256Digest;
  readonly truncated: boolean;
};

export type ProviderProcessObservation = {
  readonly started: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdout: BoundedSpool;
  readonly stderr: BoundedSpool;
};

export interface ProviderProcessRunnerService {
  readonly run: (
    request: ProviderProcessRequest,
  ) => Effect.Effect<ProviderProcessObservation, ProviderProcessError>;
}

export class ProviderProcessRunner extends Context.Tag(
  "@council/application/ProviderProcessRunner",
)<ProviderProcessRunner, ProviderProcessRunnerService>() {}

/**
 * Provider-neutral canary prompt transport. File path for providers such as
 * Grok; stdin bytes for providers such as Claude and Codex. Immutable.
 */
export type ProviderCanaryPrompt =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "stdin"; readonly bytes: Uint8Array };

/**
 * Provider-neutral canary schema transport. Inline JSON for providers that
 * accept a schema string on argv; file path for providers that require a
 * materialized schema file. Immutable.
 */
export type ProviderCanarySchema =
  | { readonly kind: "inline"; readonly json: string }
  | { readonly kind: "file"; readonly path: string };

/**
 * Provider-neutral canary invocation input. Collections are readonly.
 * No Grok (or other provider) wire types are exposed here.
 */
export type ProviderCanaryBuildInput = {
  readonly providerFamily: ProviderFamilyV1;
  readonly executable: string;
  readonly model: string;
  readonly prompt: ProviderCanaryPrompt;
  readonly schema: ProviderCanarySchema;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
};

/**
 * Decoded provider-neutral terminal evidence plus the designated structured
 * output value, or null when absent/invalid at the adapter boundary.
 */
export type ProviderCanaryDecoded = {
  readonly terminal: TerminalObservationV1;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- designated value or null
  readonly structuredOutput: unknown | null;
};

/**
 * Provider-neutral canary adapter port. Builds a shell-free process request and
 * decodes a process observation into terminal evidence. Returns typed,
 * secret-safe adapter errors — never throws a defect for an invalid invocation
 * or a malformed provider result.
 */
export interface ProviderCanaryAdapterService {
  readonly buildRequest: (
    input: ProviderCanaryBuildInput,
  ) => Effect.Effect<ProviderProcessRequest, ProviderCanaryAdapterError>;
  readonly decodeObservation: (
    observation: ProviderProcessObservation,
  ) => Effect.Effect<ProviderCanaryDecoded, ProviderCanaryAdapterError>;
}

export class ProviderCanaryAdapter extends Context.Tag(
  "@council/application/ProviderCanaryAdapter",
)<ProviderCanaryAdapter, ProviderCanaryAdapterService>() {}

/**
 * Provider-neutral prepared canary material. Prompt and schema transports are
 * immutable. The canary schema hash is independent of the review schema hash.
 */
export type PreparedCanary = {
  readonly prompt: ProviderCanaryPrompt;
  readonly schema: ProviderCanarySchema;
  readonly canarySchemaVariantHash: ContentHash;
};

/**
 * Resolve the selected CLI executable version. Shell-free; never trusts a
 * caller-supplied version string.
 */
export interface ProviderVersionProbeService {
  readonly resolve: (
    executable: string,
    cwd: string,
    environment: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, ProviderVersionProbeError>;
}

export class ProviderVersionProbe extends Context.Tag(
  "@council/application/ProviderVersionProbe",
)<ProviderVersionProbe, ProviderVersionProbeService>() {}

/**
 * Materialize provider-neutral canary prompt/schema transports for one
 * challenge. Scoped so temporary files are released after the canary.
 */
export interface CanaryMaterializerService {
  readonly prepare: (
    challenge: CanaryChallengeV1,
    providerFamily: ProviderFamilyV1,
  ) => Effect.Effect<PreparedCanary, CanaryMaterializerError, Scope.Scope>;
}

export class CanaryMaterializer extends Context.Tag(
  "@council/application/CanaryMaterializer",
)<CanaryMaterializer, CanaryMaterializerService>() {}

/**
 * Nonce and clock source for preflight identity. Tests inject fixed values.
 */
export interface PreflightIdentitySourceService {
  readonly nonce: Effect.Effect<string, PreflightIdentityError>;
  readonly now: Effect.Effect<UtcTimestamp, PreflightIdentityError>;
}

export class PreflightIdentitySource extends Context.Tag(
  "@council/application/PreflightIdentitySource",
)<PreflightIdentitySource, PreflightIdentitySourceService>() {}
