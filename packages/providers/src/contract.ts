import { Context } from "effect";
import type { Effect, Redacted, Scope } from "effect";
import type {
  AuthoringPolicyV1,
  HostFunctionDescriptorSpecV1,
  JsonValue,
  PelDataSchemaV1,
  SourceSpan,
} from "@foreman/pel";
import type { ProviderControlsV1 } from "./controls.js";
import type { ProviderFailure } from "./errors.js";
import type { ProviderIdentityV1 } from "./identity.js";
import type { ProviderUsageV1 } from "./usage.js";

export type GenerationGrammarMode = "auto" | "grammar-required" | "envelope";
export type GenerationAttempt = 0 | 1 | 2;
export interface GenerationLimitsV1 {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostUnits: number;
  readonly maxSourceBytes: number;
  readonly timeoutMs: number;
  readonly deadline: number;
}
export interface GenerationArtifactV1 {
  readonly id: string;
  readonly sourceDigest: string;
  readonly content: JsonValue;
}
export interface GenerationRequest {
  readonly generationId: string;
  readonly effectId: string;
  readonly modelProfileId: string;
  readonly transportId: string;
  readonly controls: ProviderControlsV1;
  readonly credentialProfileRef: string;
  readonly prompt: string;
  readonly trustedTemplateId: string;
  readonly registryCatalog: readonly HostFunctionDescriptorSpecV1[];
  readonly capabilitySnapshot: AuthoringPolicyV1;
  readonly artifacts: readonly GenerationArtifactV1[];
  readonly outputSchema: {
    readonly id: "schema:pel-source-v1";
    readonly content: PelDataSchemaV1;
  };
  readonly grammarMode: GenerationGrammarMode;
  readonly resolvedGrammarMode: "grammar" | "envelope";
  readonly limits: GenerationLimitsV1;
  readonly generationBudgetReservationRef: string;
  readonly attempt: GenerationAttempt;
  readonly repair?: {
    readonly previousSource: string;
    readonly diagnostics: readonly {
      readonly code: string;
      readonly span: SourceSpan;
      readonly message: string;
      readonly signature?: string;
    }[];
    readonly snapshotDigest: string;
    readonly applicableSignatures: readonly HostFunctionDescriptorSpecV1[];
  };
}
export interface GenerationResponse {
  readonly pelSource: string;
  readonly providerIdentity: ProviderIdentityV1;
  readonly providerRequestId: string;
  readonly usage: ProviderUsageV1;
  /** A complete refusal observation is terminal and is never a repair candidate. */
  readonly refusal?: { readonly message: string };
}
export class ProviderGenerationPort extends Context.Tag(
  "@foreman/providers/ProviderGenerationPort",
)<
  ProviderGenerationPort,
  {
    readonly generate: (
      request: GenerationRequest,
    ) => Effect.Effect<GenerationResponse, ProviderFailure>;
  }
>() {}

export interface CredentialMaterialV1 {
  readonly headers?: Readonly<Record<string, Redacted.Redacted<string>>>;
  readonly environment?: Readonly<Record<string, Redacted.Redacted<string>>>;
  readonly nativeProfileDirectory?: string;
}
export class CredentialPort extends Context.Tag(
  "@foreman/providers/CredentialPort",
)<
  CredentialPort,
  {
    readonly resolve: (
      credentialProfileRef: string,
    ) => Effect.Effect<CredentialMaterialV1, ProviderFailure, Scope.Scope>;
  }
>() {}
