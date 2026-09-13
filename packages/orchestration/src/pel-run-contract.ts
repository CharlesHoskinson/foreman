/** Shared durable Pel execution contracts. Persist data; inject host services. */
import { Context } from 'effect';
import type { Effect, Scope } from 'effect';
import { isCoreFailure, parseJsonRejectDuplicateKeys } from '@foreman/core';
import { isAbsolute, normalize } from 'node:path';
import { validateLimits, validateRunOptions, hashAuthoringContent } from '@foreman/pel';
import { decodeAttemptId, decodeLaneId } from '@foreman/event-log';
import { decodeExecutionLimitsV1, isExecutionContractFailure, executionMilestones } from './execution-contract.js';
import type { AuthoringModelSelectionV1, AuthoringSnapshotV1, CheckedProgramV1, HostEffectFailure, HostFunctionDescriptorV1, HostReceiptV1, HostRegistryV1, HostRequestV1, JsonValue, PelContinuationV1, PelCounters, PelDataValue, PelLimitsV1, PelPredicateSelectionV1, PelRunOptionsV1, PelStep, Result, SourceSpan, } from '@foreman/pel';
import { decodeRunId } from '@foreman/event-log';
import type { AttemptIdentity, RunId, RunJournal } from '@foreman/event-log';
import type { AdmittedCellV1, CancellationObservationV1, ContinuationV1, HostPermissionPort, ProviderFailure, ProviderIdentityV1, ProviderRequestV1, ProviderTransport, ProviderUsageV1, ToolResultV1, RemoteObservationV1, } from '@foreman/providers';
import type { ReleaseActionV1, ReleaseCandidateIdentityV1 } from '@foreman/policy';
import type { ExecutionContractV1, ExecutionLimitsV1, ExecutionMilestone } from './execution-contract.js';
import type { EndstopLedger } from './execution-ledger.js';
import type { ExecutionActionKind, ExecutionV2ChildOperationV1 } from './execution-terminal-policy.js';
import type { RunLease } from './supervisor.js';
export interface PelArtifactRefV1 {
    readonly artifactId: string;
    readonly byteLength: number;
    readonly sha256: string;
}
export interface PelReceiptRefV1 {
    readonly effectId: string;
    readonly sequence: number;
    readonly sha256: string;
}
export interface PelRepositoryIdentityV1 {
    readonly gitCommonDir: string;
    readonly identitySha256: string;
}
export interface PelWorkspaceGrantV1 {
    readonly grantId: string;
    readonly repository: PelRepositoryIdentityV1;
    readonly worktreeId: string;
    readonly canonicalRoot: string;
    readonly directoryIdentity: string;
    readonly immutableBase: string;
    readonly writablePaths: readonly string[];
}
export interface ResourceSetV1 {
    readonly reads: readonly string[];
    readonly writes: readonly string[];
    readonly unknownScope?: string;
}
/** Existing authority references, never an authority-creation request. */
export type PelAuthorityBindingV1 = {
    readonly kind: 'v1';
    readonly authoritySha256: string;
    readonly authorityRef: PelArtifactRefV1;
} | {
    readonly kind: 'v2-child';
    readonly authoritySha256: string;
    readonly authorityRef: PelArtifactRefV1;
    readonly rootContractId: string;
    readonly rootContractSha256: string;
    readonly familySha256: string;
    readonly childId: string;
    readonly originReservationId: string;
    readonly taskPlanSha256: string;
    readonly authorityBundleSha256: string;
};
export interface PelResultContractV1 {
    readonly schemaId: string;
    readonly schemaSha256: string;
    readonly classification: 'generic' | 'delivery-v1';
}
export const pelDeliverySchemaIds = ['schema:task-result-v1', 'schema:verify-result-v1', 'schema:review-result-v1', 'schema:publish-result-v1', 'schema:delivery-result-v1', 'schema:delivery-needs-action-v1', 'schema:delivery-final-v1'] as const;
export interface PelRunLimitsV1 {
    readonly execution: ExecutionLimitsV1;
    readonly pel: PelLimitsV1;
    readonly deadline: number;
    readonly maxConcurrentEffects: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxToolCalls: number;
    readonly maxOutputBytes: number;
    /** Explicit host USD bound. Never inferred from M2 abstract cost units. */
    readonly maxCostUsd: number;
    readonly cancellationObservationMs: number;
    readonly maxReplayReductions: number;
}
export interface PelGateBindingV1 {
    readonly argv: readonly [
        string,
        ...string[]
    ];
    readonly environmentRefs: readonly string[];
    readonly environmentSha256: string;
    readonly maxOutputBytes: number;
    readonly timeoutMs: number;
}
export interface PelDestinationBindingV1 {
    readonly operation: 'integrate' | 'publish';
    readonly repositoryIdentitySha256: string;
    readonly remoteIdentity: string;
    readonly ref: string;
    readonly expectedOldObject: {
        readonly kind: 'absent';
    } | {
        readonly kind: 'exact';
        readonly oid: string;
    };
    readonly authorityRef: PelArtifactRefV1;
}
/** Stored at <canonical Git common directory>/foreman/project.json. */
export interface ForemanProjectV1 {
    readonly schemaVersion: 1;
    readonly projectId: string;
    readonly repository: PelRepositoryIdentityV1;
    readonly stateRoot: string;
    readonly authorityRefs: readonly PelAuthorityBindingV1[];
    readonly executionContractTemplate: PelArtifactRefV1;
    readonly authoringSnapshot: PelArtifactRefV1;
    readonly runtimeHandlerVersion: string;
    readonly limits: Omit<PelRunLimitsV1, 'deadline'>;
    readonly requiredMilestones: readonly ExecutionMilestone[];
    readonly workspaces: {
        readonly poolRoot: string;
        readonly immutableBase: string;
        readonly grants: readonly PelWorkspaceGrantV1[];
        readonly maxWorktrees: number;
        readonly maxRaceContenders: number;
    };
    readonly gates: Readonly<Record<string, PelGateBindingV1>>;
    readonly destinations: Readonly<Record<string, PelDestinationBindingV1>>;
    readonly roleBindings: Readonly<Record<string, AuthoringModelSelectionV1>>;
    readonly taskActions: Readonly<Record<string, 'implement' | 'correct'>>;
    readonly nlConditionProfile: PelPredicateSelectionV1 | null;
    readonly dependencyMode: PelRunOptionsV1['dependencyMode'];
    readonly resultContract: PelResultContractV1;
}
export interface ExecutionBindingV1 {
    readonly schemaVersion: 1;
    readonly evidenceKind: 'product' | 'test-fixture';
    readonly runId: RunId;
    readonly attempt: AttemptIdentity;
    readonly contractId: string;
    readonly contractSha256: string;
    readonly authority: PelAuthorityBindingV1;
    readonly authoritySha256: string;
    readonly checkedProgramDigest: string;
    readonly revisionDigest: string;
    readonly sourceDigest: string;
    readonly snapshotDigest: string;
    readonly registryDigest: string;
    readonly configurationDigest: string;
    readonly runtimeVersion: string;
    readonly languageProfileId: string;
    readonly languageProfileDigest: string;
    readonly runtimeHandlerVersion: string;
    readonly stateRoot: string;
    readonly ownerLeaseRef: string;
    readonly repository: PelRepositoryIdentityV1;
    readonly artifacts: {
        readonly source: PelArtifactRefV1;
        readonly snapshot: PelArtifactRefV1;
        readonly registry: PelArtifactRefV1;
        readonly configuration: PelArtifactRefV1;
    };
    readonly options: PelRunOptionsV1;
    readonly optionsDigest: string;
    readonly resultContract: PelResultContractV1;
    readonly limits: PelRunLimitsV1;
    readonly requiredMilestones: readonly ExecutionMilestone[];
}
export const runFailureCodes = [
    'binding-mismatch', 'owner-busy', 'journal-corrupt', 'journal-write-failed',
    'continuation-incompatible', 'budget-exhausted', 'terminal-run',
] as const;
export type RunFailureCode = typeof runFailureCodes[number];
export const hostEffectFailureCodes = [
    'capability-denied', 'resource-denied', 'timeout', 'provider-failure', 'provider-refused',
    'cancelled', 'unknown-external-outcome', 'reconciliation-required',
    'task-output-invalid', 'artifact-missing', 'candidate-out-of-scope', 'candidate-changed',
    'verification-unavailable', 'review-not-independent', 'review-invalid',
    'publication-authority-invalid', 'publication-destination-unsupported',
    'final-result-invalid', 'reconciliation-abandoned',
] as const;
export type HostEffectFailureCode = typeof hostEffectFailureCodes[number];
export type PelHostEffectFailureV1 = Omit<HostEffectFailure, 'code'> & {
    readonly code: HostEffectFailureCode;
};
/** Encode as bounded ordinary JSON when placed in HostEffectFailure.cause. */
export interface PelProviderFailureCauseV1 {
    readonly providerFailure: ProviderFailure;
    readonly cancellation?: CancellationObservationV1;
}
export interface PelRunDiagnosticV1 {
    readonly code: string;
    readonly message: string;
    readonly sourceSpan: SourceSpan | null;
    readonly effectId: string | null;
    readonly retryable: boolean;
    readonly nextAction: string;
    readonly evidenceRefs: readonly PelArtifactRefV1[];
}
export interface RunFailure {
    readonly _tag: 'PelRunFailure';
    readonly code: RunFailureCode;
    readonly diagnostic: PelRunDiagnosticV1;
}
export type ExternalOutcomeV1 = 'none' | 'pending' | 'confirmed-complete' | 'confirmed-cancelled' | 'unknown';
export type RunStatusV1 = {
    readonly schemaVersion: 1;
    readonly runId: RunId;
    readonly externalOutcome: ExternalOutcomeV1;
    readonly updatedAt: number;
} & ({
    readonly state: 'running' | 'suspended' | 'cancel-requested' | 'cancelled' | 'succeeded' | 'failed';
} | {
    readonly state: 'needs-action';
    readonly resumeMode: 'pending-effect' | 'final-value';
});
export interface PelUsageBoundsV1 {
    readonly observed: ProviderUsageV1;
    readonly reservedCostUsd: number;
    readonly unresolvedEffectIds: readonly string[];
    readonly counters: PelCounters;
}
export type RunResultV1 = RunStatusV1 & {
    readonly programDigest: string;
    readonly attempt: AttemptIdentity;
    readonly finalValue: PelDataValue | null;
    readonly artifacts: readonly PelArtifactRefV1[];
    readonly receipts: readonly PelReceiptRefV1[];
    readonly outputs: readonly PelArtifactRefV1[];
    readonly usage: PelUsageBoundsV1;
    readonly diagnostics: readonly PelRunDiagnosticV1[];
};
export interface PelEffectIdentityV1 {
    readonly runId: RunId;
    readonly revisionDigest: string;
    readonly attempt: AttemptIdentity;
    readonly requestId: string;
    readonly retryOrdinal: number;
    readonly effectId: string;
    readonly priorEffectId?: string;
}
export interface PelRetryContextV1 {
    readonly parentRequestId: string;
    readonly attemptIndex: number;
    readonly logicalOperationKey: string;
}
/** In-memory host context. The checked snapshot and request have separately encoded durable forms. */
export interface HostContextV1 {
    readonly checked: CheckedProgramV1;
    readonly binding: ExecutionBindingV1;
    readonly project: ForemanProjectV1;
    readonly effect: PelEffectIdentityV1;
    readonly workspace: PelWorkspaceGrantV1;
    readonly retryContext?: PelRetryContextV1;
    readonly parentRequestId?: string;
    readonly childInvocationId?: string;
}
export type PelLedgerActionV1 = ExecutionActionKind | ReleaseActionV1;
export interface PelProviderUsageReservationV1 {
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxCostUsd: number;
}
export type PreparedHostEffectV1 = {
    readonly kind: 'reuse';
    readonly originalReceipt: PelReceiptRefV1;
    readonly value: PelDataValue;
} | {
    readonly kind: 'read-result';
    readonly value: PelDataValue;
    readonly sources: readonly PelArtifactRefV1[];
} | {
    readonly kind: 'needs-action';
    readonly reason: HostEffectFailureCode;
    readonly diagnostic: PelRunDiagnosticV1;
    readonly observationRef: PelArtifactRefV1;
    readonly preview?: PelDataValue;
} | {
    readonly kind: 'dispatch';
    readonly operationDigest: string;
    readonly resources: ResourceSetV1;
    readonly action: PelLedgerActionV1;
    readonly inputs: PelArtifactRefV1;
    readonly candidate: ReleaseCandidateIdentityV1 | null;
    readonly usageReservation?: PelProviderUsageReservationV1;
};
export type PelReservationTokenV1 = {
    readonly schemaVersion: 1;
    readonly effect: PelEffectIdentityV1;
    readonly preparationDigest: string;
    readonly operationDigest: string;
    readonly authoritySha256: string;
    readonly reservationId: string;
    readonly candidate: ReleaseCandidateIdentityV1 | null;
} & ({
    readonly kind: 'v1';
    readonly contractId: string;
    readonly contractSha256: string;
    readonly action: ExecutionActionKind;
} | {
    readonly kind: 'v2-child';
    readonly rootContractId: string;
    readonly rootContractSha256: string;
    readonly familySha256: string;
    readonly childId: string;
    readonly operation: Extract<ExecutionV2ChildOperationV1, {
        readonly _tag: 'ReserveAction';
    }>;
});
export type HostDispatchOutcomeV1 = {
    readonly kind: 'settled';
    readonly receipt: HostReceiptV1;
    readonly receiptRef: PelReceiptRefV1;
} | {
    readonly kind: 'waiting';
    readonly pendingRequestId: string;
    readonly reason: 'unknown-external-outcome' | 'reconciliation-required' | 'timeout' | 'authority-required';
    readonly observationRef: PelArtifactRefV1;
    readonly preview?: PelDataValue;
};
export interface PelPendingEffectV1 {
    readonly effect: PelEffectIdentityV1;
    readonly argumentsRef: PelArtifactRefV1;
    readonly expectedResultSchemaId: string;
    readonly reservation: PelReservationTokenV1 | null;
    readonly observationRef: PelArtifactRefV1 | null;
    readonly providerIdentity: ProviderIdentityV1 | null;
}
export interface PelChildStateV1 {
    readonly resultRef?: PelArtifactRefV1;
    readonly schemaVersion: 1;
    readonly parentRequestId: string;
    readonly parentEffectId: string;
    readonly childInvocationId: string;
    readonly childKind: 'retry' | 'race';
    readonly index: number;
    readonly phase: 'active' | 'done' | 'abandoned';
    readonly closureArgumentDigest: string;
    readonly continuationRef: PelArtifactRefV1;
    readonly optionsDigest: string;
    readonly allocatedLimits: PelLimitsV1;
    readonly consumed: PelCounters;
    readonly trancheOrdinal: number;
    readonly lastCounterChargeSequence: number;
    readonly pending: readonly PelPendingEffectV1[];
    readonly workspaceGrant: PelWorkspaceGrantV1;
    readonly immutableBase: string;
    readonly winnerDecisionRef: PelReceiptRefV1 | null;
    readonly retryContext?: PelRetryContextV1;
}
export interface PelSuspensionV1 {
    readonly continuationRef: PelArtifactRefV1;
    readonly options: PelRunOptionsV1;
    readonly optionsDigest: string;
    readonly committedCounters: PelCounters;
    readonly pending: readonly PelPendingEffectV1[];
    readonly childRecordSequences: readonly number[];
}
export interface PelRaceDecisionV1 {
    readonly parentRequestId: string;
    readonly eligible: readonly {
        readonly index: number;
        readonly receipt: PelReceiptRefV1;
        readonly workspaceGrantId: string;
    }[];
    readonly winnerIndex: number;
}
export interface PelRecoveryDecisionV1 {
    readonly schemaVersion: 1;
    readonly runId: RunId;
    readonly effectId: string;
    readonly checkedDigest: string;
    readonly decision: 'accept-result' | 'confirm-no-dispatch' | 'abandon';
    readonly evidenceRefs: readonly PelArtifactRefV1[];
    readonly authorityReceipt: PelReceiptRefV1;
    /** Required for accept-result. Contains an original-schema-validated Pel value. */
    readonly resultRef?: PelArtifactRefV1;
}
export interface PelRevisionDecisionV1 {
    readonly schemaVersion: 1;
    readonly runId: RunId;
    readonly parentSourceDigest: string;
    readonly revisedSourceDigest: string;
    readonly completedPrefixDigest: string;
    readonly completedTopLevelCount: number;
    readonly pendingSuffixBoundary: number;
    readonly authorityReceipt: PelReceiptRefV1;
}
export interface PelRevisionMappingV1 {
    readonly schemaVersion: 1;
    readonly decisionRef: PelArtifactRefV1;
    readonly oldCheckedDigest: string;
    readonly newCheckedDigest: string;
    readonly completedTopLevelCount: number;
    readonly normalizedPrefixAstDigest: string;
    readonly calls: readonly {
        readonly oldRequestId: string;
        readonly oldEffectId: string;
        readonly revisedNodeId: string;
        readonly revisedInvocationPath: string;
        readonly newRequestId: string;
        readonly argumentDigest: string;
        readonly resultSchemaId: string;
        readonly resultReceipt: PelReceiptRefV1;
    }[];
}
export interface PelStoredProviderContinuationV1 extends Omit<ContinuationV1, 'bytes'> {
    readonly artifact: PelArtifactRefV1;
}
export interface PelStoredToolResultV1 extends Omit<ToolResultV1, 'content'> {
    readonly contentRef: PelArtifactRefV1;
}
export const pelRecordTypes = [
    'pel.run-result.v1',
    'pel.run.v1', 'pel.suspension.v1', 'pel.effect.intent.v1', 'pel.effect.observed.v1',
    'pel.effect.result.v1', 'pel.checkpoint.v1', 'pel.cancel.v1', 'pel.tool.intent.v1',
    'pel.tool.result.v1', 'pel.provider.cursor.v1', 'pel.child-suspension.v1',
    'pel.revision.v1', 'pel.revision-mapping.v1', 'pel.recovery-decision.v1', 'pel.operator-decision.v1',
    'pel.output.v1', 'pel.failed-step.v1', 'pel.race.decision.v1', 'pel.authority-observed.v1',
] as const;
export type PelRecordTypeV1 = typeof pelRecordTypes[number];
/** Common metadata inside StoredEvent.payload. Per-record unions belong to pel-journal.ts. */
export interface PelRecordBindingV1 {
    readonly schemaVersion: 1;
    readonly checkedDigest: string;
    readonly runtimeVersion: string;
    readonly languageProfileId: string;
    readonly languageProfileDigest: string;
    readonly attempt: AttemptIdentity;
    readonly authoritySha256: string;
}
// Injectable runtime seams. These are not persisted contracts or independent owners.
/** Admission-time inputs resolve through registered project/authority references, before run allocation. */
export interface PelProjectInputPort {
    readonly read: (context: {
        readonly projectId: string;
        readonly repository: PelRepositoryIdentityV1;
        readonly stateRoot: string;
    }, ref: PelArtifactRefV1, maxBytes: number) => Effect.Effect<Uint8Array, RunFailure>;
}
/** Run-owned copies use <stateRoot>/runs/<runId>/artifacts after allocation. */
export interface PelArtifactPort {
    /** Flush bytes and directory before returning. Same hash with different bytes is a failure. */
    readonly put: (runId: RunId, bytes: Uint8Array, maxBytes: number, protection: 'ordinary' | 'provider-opaque') => Effect.Effect<PelArtifactRefV1, RunFailure>;
    readonly get: (runId: RunId, ref: PelArtifactRefV1, maxBytes: number) => Effect.Effect<Uint8Array, RunFailure>;
}
export interface PelResourcePort {
    readonly resolve: (descriptor: HostFunctionDescriptorV1, request: HostRequestV1, context: HostContextV1) => Effect.Effect<ResourceSetV1, PelHostEffectFailureV1>;
    /** Acquire the complete sorted set and revalidate identities. Release with this scope. */
    readonly acquire: (resources: ResourceSetV1, context: HostContextV1) => Effect.Effect<void, PelHostEffectFailureV1, Scope.Scope>;
    readonly acquireConcurrency: (context: HostContextV1) => Effect.Effect<void, PelHostEffectFailureV1, Scope.Scope>;
    readonly allocateContenders: (context: HostContextV1, count: number) => Effect.Effect<readonly PelWorkspaceGrantV1[], PelHostEffectFailureV1, Scope.Scope>;
}
export interface PelPreparedHandlerV1 {
    /** Bounded reads and immutable preparation records only. No providers, gates, publication, worktree mutation, or reservations. */
    readonly prepare: (request: HostRequestV1, context: HostContextV1) => Effect.Effect<PreparedHostEffectV1, PelHostEffectFailureV1 | RunFailure, PelRuntime | RunJournal>;
    /** The dispatcher reserved once. A handler checks this token and never reserves again. */
    readonly dispatch: (prepared: Extract<PreparedHostEffectV1, {
        readonly kind: 'dispatch';
    }>, token: PelReservationTokenV1, context: HostContextV1) => Effect.Effect<PelHandlerOutcomeV1, PelHostEffectFailureV1 | RunFailure, Scope.Scope | PelRuntime | RunJournal>;
}
/** The dispatcher validates and journals a handler outcome before creating a settled receiptRef. */
export type PelHandlerOutcomeV1 = {
    readonly kind: 'settled';
    readonly outcome: HostReceiptV1['outcome'];
} | Extract<HostDispatchOutcomeV1, {
    readonly kind: 'waiting';
}>;
export interface PelControlHandlerV1 {
    /** Runs in the same owner. The wrapper holds no external-effect concurrency permit. */
    readonly execute: (request: HostRequestV1, context: HostContextV1, parent: PelContinuationV1, driver: PelRunDriver) => Effect.Effect<HostDispatchOutcomeV1 & { readonly continuation?: PelContinuationV1 }, RunFailure, RunServices | Scope.Scope>;
}
export interface PelProviderPort {
    readonly observe: (identity: ProviderIdentityV1, context: HostContextV1) => Effect.Effect<RemoteObservationV1, RunFailure, Scope.Scope>;
    readonly resolve: (request: ProviderRequestV1, context: HostContextV1) => Effect.Effect<{
        readonly admitted: AdmittedCellV1;
        readonly transport: ProviderTransport;
    }, RunFailure | ProviderFailure, Scope.Scope>;
    readonly permissions: HostPermissionPort;
}
export interface PelClockPort {
    readonly now: Effect.Effect<number>;
    readonly sleep: (milliseconds: number) => Effect.Effect<void>;
}
export interface PelRuntimePorts {
    /** Resolve existing registered authority. Model and print receipts confer no authority. */
    readonly validateDecisionAuthority: (receipt: PelReceiptRefV1, binding: ExecutionBindingV1, kind: 'recovery' | 'revision', decision: PelRecoveryDecisionV1 | PelRevisionDecisionV1) => Effect.Effect<void, RunFailure, RunJournal | PelRuntime>;
    readonly hostEvidence: (binding: ExecutionBindingV1) => Effect.Effect<{ readonly milestones: readonly ExecutionMilestone[]; readonly receiptRefs: readonly string[]; readonly receiptCandidates?: Readonly<Record<string, string>> }, RunFailure>;
    readonly loadRunInputs: (binding: ExecutionBindingV1) => Effect.Effect<Omit<PelOwnedRunContextV1, 'owner'>, RunFailure>;
    readonly artifacts: PelArtifactPort;
    readonly resources: PelResourcePort;
    readonly providers: PelProviderPort;
    readonly clock: PelClockPort;
    readonly handlers: ReadonlyMap<string, PelPreparedHandlerV1>;
    readonly controls: ReadonlyMap<string, PelControlHandlerV1>;
    readonly output: (ref: PelArtifactRefV1, text: string) => Effect.Effect<void, RunFailure>;
}
export class PelRuntime extends Context.Tag('@foreman/orchestration/PelRuntime')<PelRuntime, PelRuntimePorts>() {
}
export type RunServices = RunJournal | EndstopLedger | RunLease | PelRuntime;
/** The sole driver receives already-admitted, already-owned state. */
export type PelActivationV1 = {
    readonly kind: 'evaluated';
    readonly checked: CheckedProgramV1;
    readonly binding: ExecutionBindingV1;
    readonly step: PelStep;
    readonly children: readonly PelChildStateV1[];
} | {
    readonly kind: 'fresh';
    readonly checked: CheckedProgramV1;
    readonly binding: ExecutionBindingV1;
} | {
    readonly kind: 'recovered';
    readonly checked: CheckedProgramV1;
    readonly binding: ExecutionBindingV1;
    readonly continuation: PelContinuationV1;
    readonly receipts: readonly HostReceiptV1[];
    readonly children: readonly PelChildStateV1[];
};
export interface PelOwnedRunContextV1 {
    readonly binding: ExecutionBindingV1;
    readonly project: ForemanProjectV1;
    readonly contract: ExecutionContractV1;
    readonly snapshot: AuthoringSnapshotV1;
    readonly registry: HostRegistryV1;
    /** Runtime-only proof that caller owns the existing RunLease scope. Never serialize. */
    readonly owner: {
        readonly runId: RunId;
        readonly release: () => Effect.Effect<void>;
    };
}
export interface PelRunDriver {
    readonly children: readonly PelChildStateV1[];
    readonly updateChild: (child: PelChildStateV1) => void;
    readonly drive: (activation: PelActivationV1, context: PelOwnedRunContextV1) => Effect.Effect<RunResultV1, RunFailure, RunServices | Scope.Scope>;
    readonly dispatch: (request: HostRequestV1, context: HostContextV1) => Effect.Effect<HostDispatchOutcomeV1, RunFailure, RunServices | Scope.Scope>;
    readonly evaluateChild: (step: PelStep, child: PelChildStateV1, context: HostContextV1) => Effect.Effect<{ readonly outcome: HostDispatchOutcomeV1; readonly child: PelChildStateV1; readonly counters: PelCounters }, RunFailure, RunServices | Scope.Scope>;
}
// Complete pure closed decoders for the small shared leaf/decision/status contracts.
export interface PelContractDecodeFailureV1 {
    readonly code: 'invalid-contract';
    readonly fieldPath: string;
}
type Decode<T> = Result<T, PelContractDecodeFailureV1>;
const bad = (fieldPath: string): Decode<never> => ({ ok: false, error: { code: 'invalid-contract', fieldPath } });
function record(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
        return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
}
function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
    return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.isWellFormed() && Buffer.byteLength(value) <= 4096;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const array = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 10000 && Object.keys(value).length === value.length;
const strings = (value: unknown): value is string[] => array(value) && value.every(text) && new Set(value).size === value.length;
function runId(value: unknown): value is RunId { return typeof value === "string" && typeof decodeRunId(value) === 'string'; }
export function decodePelArtifactRefV1(value: unknown): Decode<PelArtifactRefV1> {
    return record(value) && keys(value, ['artifactId', 'byteLength', 'sha256']) && text(value.artifactId) && natural(value.byteLength) && digest(value.sha256)
        ? { ok: true, value: { artifactId: value.artifactId, byteLength: value.byteLength, sha256: value.sha256 } } : bad('artifact');
}
export function decodePelReceiptRefV1(value: unknown): Decode<PelReceiptRefV1> {
    return record(value) && keys(value, ['effectId', 'sequence', 'sha256']) && text(value.effectId) && natural(value.sequence) && value.sequence > 0 && digest(value.sha256)
        ? { ok: true, value: { effectId: value.effectId, sequence: value.sequence, sha256: value.sha256 } } : bad('receipt');
}
export function decodeResourceSetV1(value: unknown): Decode<ResourceSetV1> {
    if (!record(value) || !keys(value, ['reads', 'writes'], ['unknownScope']) || !strings(value.reads) || !strings(value.writes) || Object.hasOwn(value, 'unknownScope') && !text(value.unknownScope))
        return bad('resources');
    return { ok: true, value: { reads: [...value.reads], writes: [...value.writes], ...(typeof value.unknownScope === 'string' ? { unknownScope: value.unknownScope } : {}) } };
}
export function decodeRunStatusV1(value: unknown): Decode<RunStatusV1> {
    if (!record(value) || !keys(value, ['schemaVersion', 'runId', 'state', 'externalOutcome', 'updatedAt'], value.state === 'needs-action' ? ['resumeMode'] : []) || value.schemaVersion !== 1 || !runId(value.runId) || !natural(value.updatedAt))
        return bad('status');
    if (typeof value.externalOutcome !== "string" || !['none', 'pending', 'confirmed-complete', 'confirmed-cancelled', 'unknown'].includes(value.externalOutcome))
        return bad('status.externalOutcome');
    if (typeof value.state !== "string" || !['running', 'suspended', 'cancel-requested', 'cancelled', 'needs-action', 'succeeded', 'failed'].includes(value.state))
        return bad('status.state');
    if (value.state === 'needs-action' && value.resumeMode !== 'pending-effect' && value.resumeMode !== 'final-value')
        return bad('status.resumeMode');
    if (value.state === 'cancelled' && value.externalOutcome !== 'none' && value.externalOutcome !== 'confirmed-cancelled')
        return bad('status.externalOutcome');
    if (value.state === 'succeeded' && (value.externalOutcome === 'unknown' || value.externalOutcome === 'pending'))
        return bad('status.externalOutcome');
    return { ok: true, value: structuredClone(value) as RunStatusV1 };
}
export function decodePelRecoveryDecisionV1(value: unknown): Decode<PelRecoveryDecisionV1> {
    if (!record(value) || !keys(value, ['schemaVersion', 'runId', 'effectId', 'checkedDigest', 'decision', 'evidenceRefs', 'authorityReceipt'], value.decision === 'accept-result' ? ['resultRef'] : []) || value.schemaVersion !== 1 || !runId(value.runId) || !text(value.effectId) || !digest(value.checkedDigest))
        return bad('recovery');
    if (typeof value.decision !== "string" || !['accept-result', 'confirm-no-dispatch', 'abandon'].includes(value.decision))
        return bad('recovery.decision');
    if (!array(value.evidenceRefs) || !value.evidenceRefs.every(ref => decodePelArtifactRefV1(ref).ok) || !decodePelReceiptRefV1(value.authorityReceipt).ok)
        return bad('recovery.evidence');
    if (value.decision === 'accept-result' && !decodePelArtifactRefV1(value.resultRef).ok)
        return bad('recovery.resultRef');
    return { ok: true, value: structuredClone(value) as unknown as PelRecoveryDecisionV1 };
}
export function decodePelRevisionDecisionV1(value: unknown): Decode<PelRevisionDecisionV1> {
    if (!record(value) || !keys(value, ['schemaVersion', 'runId', 'parentSourceDigest', 'revisedSourceDigest', 'completedPrefixDigest', 'completedTopLevelCount', 'pendingSuffixBoundary', 'authorityReceipt']) || value.schemaVersion !== 1 || !runId(value.runId) || !digest(value.parentSourceDigest) || !digest(value.revisedSourceDigest) || !digest(value.completedPrefixDigest) || !natural(value.completedTopLevelCount) || !natural(value.pendingSuffixBoundary) || value.pendingSuffixBoundary !== value.completedTopLevelCount || !decodePelReceiptRefV1(value.authorityReceipt).ok)
        return bad('revision');
    return { ok: true, value: structuredClone(value) as unknown as PelRevisionDecisionV1 };
}
/** Parse bounded JSON with duplicate-key rejection before a specific closed decoder. */
export function decodePelContractJson<T>(bytes: Uint8Array, decode: (value: unknown) => Decode<T>): Decode<T> {
    if (bytes.byteLength > 1048576)
        return bad('bytes');
    try {
        const value = parseJsonRejectDuplicateKeys(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        return isCoreFailure(value) ? bad('json') : decode(value);
    }
    catch {
        return bad('json');
    }
}

const absolutePath = (value: unknown): value is string => text(value) && !/[\u0000-\u001f\u007f]/.test(value) && isAbsolute(value) && normalize(value) === value;
export function decodePelRepositoryIdentityV1(value: unknown): Decode<PelRepositoryIdentityV1> {
    return record(value) && keys(value, ['gitCommonDir', 'identitySha256']) && absolutePath(value.gitCommonDir) && digest(value.identitySha256)
        ? { ok: true, value: structuredClone(value) as unknown as PelRepositoryIdentityV1 } : bad('repository');
}
export function decodePelAuthorityBindingV1(value: unknown): Decode<PelAuthorityBindingV1> {
    if (!record(value) || (value.kind !== 'v1' && value.kind !== 'v2-child')) return bad('authority.kind');
    const childKeys = ['rootContractId', 'rootContractSha256', 'familySha256', 'childId', 'originReservationId', 'taskPlanSha256', 'authorityBundleSha256'];
    if (!keys(value, ['kind', 'authoritySha256', 'authorityRef', ...(value.kind === 'v2-child' ? childKeys : [])]) || !digest(value.authoritySha256) || !decodePelArtifactRefV1(value.authorityRef).ok) return bad('authority');
    if (value.kind === 'v2-child' && (!['rootContractId', 'childId', 'originReservationId'].every(k => text(value[k])) || !['rootContractSha256', 'familySha256', 'taskPlanSha256', 'authorityBundleSha256'].every(k => digest(value[k])))) return bad('authority.child');
    return { ok: true, value: structuredClone(value) as unknown as PelAuthorityBindingV1 };
}
export function decodePelWorkspaceGrantV1(value: unknown): Decode<PelWorkspaceGrantV1> {
    if (!record(value) || !keys(value, ['grantId', 'repository', 'worktreeId', 'canonicalRoot', 'directoryIdentity', 'immutableBase', 'writablePaths']) || !text(value.grantId) || !decodePelRepositoryIdentityV1(value.repository).ok || !text(value.worktreeId) || !absolutePath(value.canonicalRoot) || !text(value.directoryIdentity) || typeof value.immutableBase !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.immutableBase) || !strings(value.writablePaths)) return bad('workspace');
    for (const path of value.writablePaths) if (isAbsolute(path) || /[\u0000-\u001f\u007f\\]/.test(path) || path.split('/').some(part => part === '..') || normalize(path) !== path) return bad('workspace.writablePaths');
    return { ok: true, value: structuredClone(value) as unknown as PelWorkspaceGrantV1 };
}
export function decodePelResultContractV1(value: unknown): Decode<PelResultContractV1> {
    return record(value) && keys(value, ['schemaId', 'schemaSha256', 'classification']) && text(value.schemaId) && digest(value.schemaSha256) && (value.classification === 'generic' || value.classification === 'delivery-v1' && (pelDeliverySchemaIds as readonly string[]).includes(value.schemaId))
        ? { ok: true, value: structuredClone(value) as unknown as PelResultContractV1 } : bad('resultContract');
}
export function decodePelRunLimitsV1(value: unknown): Decode<PelRunLimitsV1>;
export function decodePelRunLimitsV1(value: unknown, withoutDeadline: true): Decode<Omit<PelRunLimitsV1, 'deadline'>>;
export function decodePelRunLimitsV1(value: unknown, withoutDeadline = false): Decode<PelRunLimitsV1 | Omit<PelRunLimitsV1, 'deadline'>> {
    const fields = ['execution', 'pel', 'maxConcurrentEffects', 'maxInputTokens', 'maxOutputTokens', 'maxToolCalls', 'maxOutputBytes', 'maxCostUsd', 'cancellationObservationMs', 'maxReplayReductions'];
    if (!record(value) || !keys(value, [...fields, ...(withoutDeadline ? [] : ['deadline'])])) return bad('limits');
    const execution = decodeExecutionLimitsV1(value.execution);
    if (isExecutionContractFailure(execution) || !validateLimits(value.pel).ok) return bad('limits.execution');
    for (const key of ['maxConcurrentEffects', 'maxInputTokens', 'maxOutputTokens', 'maxOutputBytes', 'cancellationObservationMs', 'maxReplayReductions']) if (!natural(value[key]) || value[key] === 0) return bad(`limits.${key}`);
    if (!natural(value.maxToolCalls) || typeof value.maxCostUsd !== 'number' || !Number.isFinite(value.maxCostUsd) || value.maxCostUsd < 0 || (!withoutDeadline && (!natural(value.deadline) || value.deadline === 0))) return bad('limits.bounds');
    if ((value.maxConcurrentEffects as number) > execution.totalActions || (value.cancellationObservationMs as number) > execution.wallTimeMs || (value.maxOutputBytes as number) > 64 * 1024 * 1024) return bad('limits.bounds');
    return { ok: true, value: structuredClone(value) as unknown as PelRunLimitsV1 };
}
export function decodeExecutionBindingV1(value: unknown): Decode<ExecutionBindingV1> {
    const fields = ['schemaVersion', 'evidenceKind', 'runId', 'attempt', 'contractId', 'contractSha256', 'authority', 'authoritySha256', 'checkedProgramDigest', 'revisionDigest', 'sourceDigest', 'snapshotDigest', 'registryDigest', 'configurationDigest', 'runtimeVersion', 'languageProfileId', 'languageProfileDigest', 'runtimeHandlerVersion', 'stateRoot', 'ownerLeaseRef', 'repository', 'artifacts', 'options', 'optionsDigest', 'resultContract', 'limits', 'requiredMilestones'];
    if (!record(value) || !keys(value, fields) || value.schemaVersion !== 1 || !['product', 'test-fixture'].includes(value.evidenceKind as string) || !runId(value.runId)) return bad('binding');
    if (!record(value.attempt) || !keys(value.attempt, ['runId', 'laneId', 'attemptId']) || value.attempt.runId !== value.runId || typeof value.attempt.laneId !== 'string' || typeof decodeLaneId(value.attempt.laneId) !== 'string' || typeof value.attempt.attemptId !== 'number' || typeof decodeAttemptId(value.attempt.attemptId) !== 'number') return bad('binding.attempt');
    for (const key of ['contractSha256', 'authoritySha256', 'checkedProgramDigest', 'revisionDigest', 'sourceDigest', 'snapshotDigest', 'registryDigest', 'configurationDigest', 'languageProfileDigest', 'optionsDigest']) if (!digest(value[key])) return bad(`binding.${key}`);
    for (const key of ['contractId', 'runtimeVersion', 'languageProfileId', 'runtimeHandlerVersion', 'ownerLeaseRef']) if (!text(value[key])) return bad(`binding.${key}`);
    const authority = decodePelAuthorityBindingV1(value.authority);
    if (!authority.ok || authority.value.authoritySha256 !== value.authoritySha256 || !absolutePath(value.stateRoot) || !decodePelRepositoryIdentityV1(value.repository).ok) return bad('binding.authority');
    if (!record(value.artifacts) || !keys(value.artifacts, ['source', 'snapshot', 'registry', 'configuration']) || !Object.values(value.artifacts).every(ref => decodePelArtifactRefV1(ref).ok)) return bad('binding.artifacts');
    const options = validateRunOptions(value.options);
    if (!options.ok || hashAuthoringContent(options.value) !== value.optionsDigest || !decodePelResultContractV1(value.resultContract).ok || !decodePelRunLimitsV1(value.limits).ok) return bad('binding.options');
    if (!strings(value.requiredMilestones) || !value.requiredMilestones.every(m => (executionMilestones as readonly string[]).includes(m))) return bad('binding.requiredMilestones');
    return { ok: true, value: structuredClone(value) as unknown as ExecutionBindingV1 };
}
