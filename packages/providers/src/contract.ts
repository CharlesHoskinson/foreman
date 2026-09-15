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
  /** Host-only capability. Never serialize it or expose its source to a worker. */
  readonly chatgpt?: {
    readonly tokens: (input: {
      readonly refresh: boolean;
      readonly previousAccountId?: string;
      readonly deadline: number;
    }) => Effect.Effect<{
      readonly accessToken: Redacted.Redacted<string>;
      readonly chatgptAccountId: string;
      readonly chatgptPlanType?: string;
    }, ProviderFailure, Scope.Scope>;
  };
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

export type { ProviderIdentityV1 } from "./identity.js";
export type { ProviderControlsV1 } from "./controls.js";
export type { ProviderUsageV1 } from "./usage.js";
export type TransportId =
  | "xai-responses"
  | "anthropic-messages"
  | "openai-responses"
  | "google-interactions"
  | "grok-acp"
  | "claude-code"
  | "codex-app-server"
  | "gemini-cli";
export type ProfileId =
  | "grok-4.6"
  | "claude-opus-5"
  | "claude-fable-5-1"
  | "gpt-6-astra"
  | "gpt-5.6-sol"
  | "gemini-3.8-flash";
export type ProviderFamily = "xai" | "anthropic" | "openai" | "google";
export type Capability =
  | "generation"
  | "review"
  | "codingTask"
  | "structuredOutput"
  | "grammar"
  | "tools"
  | "permissionBoundary"
  | "workspaceBoundary"
  | "toolPolicyNone"
  | "continuation"
  | "cursorReplay"
  | "remoteCancellation"
  | "reconcile"
  | "background"
  | "store"
  | "promptChannel";
export interface ProviderLimitsV1 {
  readonly deadline: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxToolCalls: number;
  readonly maxCostUsd: number;
  readonly maxOutputBytes: number;
  readonly spendReservationRef: string;
}
export interface ProviderArtifactV1 {
  readonly id: string;
  readonly contentRef: string;
  readonly sha256: string;
  readonly content?: JsonValue;
}
export type ToolPolicyV1 =
  | { readonly mode: "none" }
  | {
      readonly mode: "native-coding";
      readonly workspaceGrantId: string;
      readonly permissionGrantIds: readonly string[];
      readonly hostPermissionPortRef: string;
    };
export interface OutputSchemaV1 {
  readonly id: string;
  readonly content: PelDataSchemaV1;
}
export interface RetentionV1 {
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly policy: string;
}
export interface ContinuationV1 {
  readonly schemaVersion: 1;
  readonly providerIdentity: ProviderIdentityV1;
  readonly transportVersion: string;
  readonly formatVersion: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly prefixHash: string;
  readonly retention: RetentionV1;
  readonly cursor?: string;
}
export interface ProviderRequestV1 {
  readonly schemaVersion: 1;
  readonly effectId: string;
  readonly profileId: ProfileId;
  readonly transportId: TransportId;
  readonly trustedInstructions: string;
  readonly artifacts: readonly ProviderArtifactV1[];
  readonly toolPolicy: ToolPolicyV1;
  readonly outputSchema: OutputSchemaV1;
  readonly controls: ProviderControlsV1;
  readonly limits: ProviderLimitsV1;
  readonly credentialProfileRef: string;
  readonly profileHash: string;
  readonly sourceManifestHash: string;
  readonly transportVersion: string;
  readonly continuation?: ContinuationV1;
  readonly generation?: {
    readonly grammarMode: GenerationGrammarMode;
    readonly resolvedGrammarMode: "grammar" | "envelope";
    readonly attempt: GenerationAttempt;
    readonly trustedTemplateId: string;
  };
}
export interface ToolRequestV1 {
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonValue;
  readonly authorizationBinding: string;
}
export type ToolContentV1 =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "json"; readonly value: JsonValue };
export interface ToolResultV1 {
  readonly effectId: string;
  readonly providerIdentity: ProviderIdentityV1;
  readonly callId: string;
  readonly authorizationBinding: string;
  readonly receiptRef: string;
  readonly content: ToolContentV1;
  readonly isError: boolean;
  readonly contentSha256: string;
  readonly maxBytes: number;
}
export interface HostPermissionPort {
  readonly submit: (
    identity: ProviderIdentityV1,
    result: ToolResultV1,
    send: () => Effect.Effect<void, ProviderFailure>,
  ) => Effect.Effect<void, ProviderFailure>;
  readonly authorize: (
    identity: ProviderIdentityV1,
    request: ToolRequestV1,
    policy: ToolPolicyV1,
  ) => Effect.Effect<string, ProviderFailure>;
}
export interface ProviderResultV1 {
  readonly value: import("@foreman/pel").PelDataValue;
  readonly json: JsonValue;
  readonly schemaId: string;
  readonly schemaSha256: string;
  readonly byteLength: number;
}
export interface CancellationObservationV1 {
  readonly requested: boolean;
  readonly acknowledged: boolean;
  readonly localCleanup: "complete" | "pending" | "not-required" | "unknown";
  readonly remoteOutcome:
    "pending" | "cancelled" | "completed" | "unknown" | "unsupported";
}
export type RemoteObservationV1 =
  | {
      readonly status: "pending" | "cancelled";
      readonly providerIdentity: ProviderIdentityV1;
      readonly cursor?: string;
    }
  | {
      readonly status: "completed";
      readonly providerIdentity: ProviderIdentityV1;
      readonly cursor: string;
      readonly result: ProviderResultV1;
    }
  | {
      readonly status: "not-found";
      readonly providerIdentity: ProviderIdentityV1;
      readonly evidence: string;
    }
  | {
      readonly status: "unsupported";
      readonly providerIdentity: ProviderIdentityV1;
      readonly reason: string;
    };
export type ProviderEventPayloadV1 =
  | { readonly type: "started"; readonly observedToolPolicy?: "none" }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool-request"; readonly request: ToolRequestV1 }
  | { readonly type: "usage"; readonly usage: ProviderUsageV1 }
  | { readonly type: "checkpoint"; readonly checkpoint: ContinuationV1 }
  | {
      readonly type: "completed";
      readonly result: ProviderResultV1;
      readonly usage?: ProviderUsageV1;
    }
  | { readonly type: "refused"; readonly message: string }
  | { readonly type: "failed"; readonly failure: ProviderFailure }
  | {
      readonly type: "cancelled";
      readonly observation: CancellationObservationV1;
    };
export interface ProviderEventV1 {
  readonly schemaVersion: 1;
  readonly effectId: string;
  readonly providerIdentity: ProviderIdentityV1;
  readonly sourceEventId?: string;
  readonly cursor?: string;
  readonly payload: ProviderEventPayloadV1;
}
export type EvidenceState =
  | "unknown"
  | "unsupported"
  | "documented"
  | "fixture-tested"
  | "live-qualified";
export interface CapabilityEvidenceV1 {
  readonly capability: Capability;
  readonly state: EvidenceState;
  readonly profileId: string;
  readonly transportId: TransportId;
  readonly profileHash: string;
  readonly sourceManifestHash: string;
  readonly transportVersion: string;
  readonly controlsHash: string;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly observedIdentity?: ProviderIdentityV1;
  readonly evidenceRef: string;
  readonly fixtureManifestHash?: string;
  readonly endpointIdentity?: string;
}
export type AdmissionBindingV1 =
  | {
      readonly kind: "product";
      /** Expected endpointRevision (API) or protocolVersion (native), independently of adapter build version. */
      readonly expectedIdentityRevision: string;
      readonly now: number;
      readonly transportVersion: string;
      readonly controls: ProviderControlsV1;
      readonly credentialProfileRef: string;
    }
  | {
      readonly kind: "test-fixture";
      readonly expectedIdentityRevision: string;
      readonly now: number;
      readonly transportVersion: string;
      readonly controls: ProviderControlsV1;
      readonly credentialProfileRef: string;
      readonly fixtureManifestHash: string;
      readonly endpointIdentity: string;
    };
export interface ReadinessFactEvidenceV1 {
  readonly observedAt?: number;
  readonly evidenceKind?: "metadata" | "bounded-workload";
  readonly diagnostic?: string;
}
export interface ReadinessV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly transportId: TransportId;
  readonly checkedAt: number;
  readonly mode: "metadata-only" | "bounded-workload";
  readonly discovery: ReadinessFactEvidenceV1 & {
    readonly state: "available" | "missing" | "unknown";
    readonly installedVersion?: string;
  };
  readonly authentication: ReadinessFactEvidenceV1 & {
    readonly state: "authenticated" | "signed-out" | "unknown";
    readonly remediation?: string;
  };
  readonly currency: ReadinessFactEvidenceV1 & {
    readonly state: "current" | "stale" | "unknown";
    readonly sourceManifestHash?: string;
  };
  readonly identity: ReadinessFactEvidenceV1 & {
    readonly state: "exact" | "mismatch" | "unknown";
    readonly observed?: ProviderIdentityV1;
  };
  readonly capabilities: readonly CapabilityEvidenceV1[];
}
export interface ProbeInputV1 {
  readonly profileId: ProfileId;
  readonly transportId: TransportId;
  readonly credentialProfileRef: string;
  readonly mode: "metadata-only" | "bounded-workload";
  readonly limits?: ProviderLimitsV1;
}
export type ProbeFailure =
  | import("./errors.js").ProbeUnknown
  | import("./errors.js").AuthenticationRequired
  | import("./errors.js").ModelUnavailable
  | import("./errors.js").ModelMismatch
  | import("./errors.js").UnsupportedCapability;
export interface ProviderTransport {
  /** Installed CLI executable version, distinct from endpoint/protocol revision. */
  readonly installedVersion?: string | undefined;
  readonly id: TransportId;
  readonly version: string;
  readonly probe: (
    input: ProbeInputV1,
  ) => Effect.Effect<ReadinessV1, ProbeFailure>;
  readonly start: (
    request: ProviderRequestV1,
  ) => Effect.Effect<
    import("effect").Stream.Stream<ProviderEventV1, ProviderFailure>,
    ProviderFailure,
    Scope.Scope
  >;
  readonly sendToolResult: (
    identity: ProviderIdentityV1,
    result: ToolResultV1,
  ) => Effect.Effect<void, ProviderFailure>;
  readonly cancel: (
    identity: ProviderIdentityV1,
  ) => Effect.Effect<CancellationObservationV1, ProviderFailure>;
  readonly observe: (
    identity: ProviderIdentityV1,
  ) => Effect.Effect<RemoteObservationV1, ProviderFailure>;
  readonly resume: (
    request: ProviderRequestV1,
    identity: ProviderIdentityV1,
    cursor: string,
  ) => Effect.Effect<
    import("effect").Stream.Stream<ProviderEventV1, ProviderFailure>,
    ProviderFailure,
    Scope.Scope
  >;
}
