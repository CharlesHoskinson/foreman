import type { SourceSpan } from "./ast.js";
import type { HostRegistryV1 } from "./host-contract.js";
import type { PelProfileV1 } from "./profile.js";
import type {
  JsonValue,
  PelLimitsV1,
  PelPredicateSelectionV1,
  PelRunOptionsV1,
} from "./types.js";

export interface AuthoringDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly span: SourceSpan;
  readonly relatedSpans: readonly SourceSpan[];
  readonly message: string;
  readonly expectedForms: readonly string[];
  readonly signature?: string;
  readonly help?: string;
  readonly bound?: string;
  readonly consumed?: number;
}
export interface AuthoringProviderControlsV1 {
  readonly effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly thinking: {
    readonly mode: "provider-default" | "adaptive" | "enabled" | "disabled";
    readonly budgetTokens?: number;
  };
  readonly sampling: {
    readonly temperature?: number;
    readonly topP?: number;
    readonly topK?: number;
  };
  readonly toolChoice: "auto" | "none" | "required" | { readonly name: string };
  readonly execution: {
    readonly mode: "foreground" | "background";
    readonly store: "provider-default" | boolean;
  };
}
export interface AuthoringProviderProfileV1 {
  readonly profileId: string;
  readonly transportId: string;
  readonly evidenceKind: "documented" | "qualified" | "fixture";
  readonly supportedControls: {
    readonly efforts: readonly AuthoringProviderControlsV1["effort"][];
    readonly thinkingModes: readonly AuthoringProviderControlsV1["thinking"]["mode"][];
    readonly sampling: readonly ("temperature" | "topP" | "topK")[];
    readonly toolChoices: readonly ("auto" | "none" | "required" | "named")[];
    readonly executionModes: readonly ("foreground" | "background")[];
    readonly store: readonly ("provider-default" | boolean)[];
    readonly budgetTokens: boolean;
  };
  readonly applicationDefaults: AuthoringProviderControlsV1;
  readonly grammarSupport: "qualified" | "unsupported" | "unknown";
}
export interface AuthoringModelSelectionV1 {
  readonly profileId: string;
  readonly transportId: string;
  readonly controls: AuthoringProviderControlsV1;
  readonly credentialProfileRef: string;
}
export interface AuthoringBudgetsV1 {
  readonly maxEffects: number;
  readonly maxCostUnits: number;
  readonly maxElapsedMs: number;
}
export interface AuthoringPolicyV1 extends AuthoringBudgetsV1 {
  readonly allowedCapabilities: readonly string[];
  readonly allowedEffectKinds: readonly string[];
  readonly allowedModelTransports: readonly {
    readonly profileId: string;
    readonly transportId: string;
  }[];
  readonly resourceEnvelope: {
    readonly reads: readonly string[];
    readonly writes: readonly string[];
  };
  readonly allowedSchemaIds: readonly string[];
  readonly allowedGates: readonly string[];
  readonly allowedReviewPolicies: readonly string[];
  readonly allowedDestinations: readonly string[];
  readonly allowedCredentialProfileRefs: readonly string[];
  readonly artifactConstraints: {
    readonly allowedIds: readonly string[];
    readonly maxBytes: number;
  };
  readonly maxOutputBytes: number;
}
export interface AuthoringGenerationLimitsV1 {
  readonly maxSourceBytes: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostUnits: number;
  readonly attemptTimeoutMs: number;
  readonly maxElapsedMs: number;
  readonly maxRepairs: number;
}
export interface AuthoringArtifactDescriptorV1 {
  readonly id: string;
  readonly schemaId: string;
  readonly content: JsonValue;
}
export interface AuthoringArtifactDigestV1 {
  readonly id: string;
  readonly digest: string;
}
export interface AuthoringSnapshotV1 {
  readonly schemaVersion: 1;
  readonly languageProfile: PelProfileV1;
  readonly languageProfileDigest: string;
  readonly registry: HostRegistryV1;
  readonly registryDigest: string;
  readonly providerProfiles: readonly AuthoringProviderProfileV1[];
  readonly providerProfilesDigest: string;
  readonly policy: AuthoringPolicyV1;
  readonly policyDigest: string;
  readonly resourceResolvers: Readonly<Record<string, JsonValue>>;
  readonly roleBindings: Readonly<Record<string, AuthoringModelSelectionV1>>;
  readonly nlConditionProfile: PelPredicateSelectionV1 | null;
  readonly nlConditionProfileDigest: string | null;
  readonly artifactDescriptors: readonly AuthoringArtifactDescriptorV1[];
  readonly artifactDigests: readonly AuthoringArtifactDigestV1[];
  readonly limits: PelLimitsV1;
  readonly generationLimits: AuthoringGenerationLimitsV1;
  readonly defaultCredentialProfileRef: string;
  readonly dependencyMode: "ordered" | "automatic";
  readonly resultContract: string;
  readonly options: PelRunOptionsV1;
  readonly optionsDigest: string;
  readonly snapshotDigest: string;
}
export interface EffectiveAuthoringSelectionV1 {
  readonly roleBindings?: Readonly<Record<string, AuthoringModelSelectionV1>>;
  readonly nlConditionProfile?: PelPredicateSelectionV1 | null;
  readonly dependencyMode?: "ordered" | "automatic";
  readonly resultContract?: string;
  readonly narrowingLimits?: Partial<PelLimitsV1>;
  readonly narrowingBudgets?: Partial<AuthoringBudgetsV1>;
}
export type AuthoringSnapshotContentV1 = Omit<
  AuthoringSnapshotV1,
  | "schemaVersion"
  | "languageProfileDigest"
  | "registryDigest"
  | "providerProfilesDigest"
  | "policyDigest"
  | "nlConditionProfileDigest"
  | "artifactDigests"
  | "options"
  | "optionsDigest"
  | "snapshotDigest"
>;
export interface PlanBindingV1 {
  readonly schemaVersion: 1;
  readonly sourceDigest: string;
  readonly snapshotDigest: string;
  readonly languageProfileDigest: string;
  readonly registryDigest: string;
  readonly providerProfilesDigest: string;
  readonly policyDigest: string;
  readonly optionsDigest: string;
  readonly artifactDigests: readonly AuthoringArtifactDigestV1[];
}
