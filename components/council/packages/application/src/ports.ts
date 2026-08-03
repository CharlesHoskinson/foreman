import type {
  ProviderFamilyV1,
  ReviewArtifactDescriptorV1,
  ReviewBundleIdentityV1,
  Sha256Digest,
} from "@council/schema";
import { Context, type Effect } from "effect";
import type {
  ArtifactLimitExceeded,
  ArtifactMissing,
  ArtifactReadError,
  BundleVerificationError,
  CanonicalSchemaInvalid,
  ConstraintWeakeningError,
  DigestError,
  PromptMaterializationError,
  ProviderProcessError,
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
 * never a shell command string.
 */
export type ProviderProcessRequest = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
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
