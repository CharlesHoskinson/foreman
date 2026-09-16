# OpenBao production implementation contracts

Status: Production requirements with accepted private store foundations. Manager interfaces remain future implementation, not completed qualification.

## Authority and scope

This contract supersedes the raw removal interface in the earlier authority plan.
OpenBao is the sole durable credential and lifecycle authority. WSL and Linux are equal production targets.
Use Node.js 24, strict TypeScript, and Effect. Keep pure validation free from effects.
Do not add dependencies, a daemon, a scheduler, a local lifecycle database, or managed fallback.
Do not perform live operations, installations, host interruptions, commits, index writes, or installed runtime updates during these tasks.
Preserve native-login source changes and historical evidence. Keep credential values outside PEL, receipts, models, logs, and command arguments.

## Shared types

Import `Effect` and `Redacted` from `effect`. Import `CredentialBackendIdentity` from `credential-backend-identity.ts`.
Define shared provider contracts in `packages/providers/src/credential-lifecycle.ts`.

```typescript
export type Provider = 'agy' | 'codex' | 'claude' | 'grok';
export type FailureCode = 'InvalidInput' | 'Denied' | 'NotFound' | 'Conflict' |
  'Unavailable' | 'Timeout' | 'Unsupported' | 'Quarantined' | 'MigrationRequired' |
  'NotReady' | 'ReconciliationRequired';
export interface ManagedFailure {
  readonly _tag: 'ManagedFailure';
  readonly code: FailureCode;
}
export type Result<A> = { readonly ok: true; readonly value: A } |
  { readonly ok: false; readonly error: ManagedFailure };
export interface AccountKey {
  readonly provider: Provider;
  readonly account: string;
}
export type Material = Redacted.Redacted<Readonly<Record<string, string>>>;
export type Envelope = AccountKey & { readonly schemaVersion: 2; readonly generation: number } &
  ({ readonly state: 'active'; readonly material: Material } |
   { readonly state: 'tombstoned' });
export interface CurrentMetadata {
  readonly currentVersion: number;
  readonly deleted: boolean;
  readonly destroyed: boolean;
  readonly deletionScheduled: boolean;
}
export type CurrentObservation =
  { readonly kind: 'absent'; readonly metadataAbsent: true } |
  { readonly kind: 'present'; readonly metadata: CurrentMetadata; readonly envelope: Envelope };
export type Transition =
  { readonly kind: 'import'; readonly material: Material } |
  { readonly kind: 'remove'; readonly expectedGeneration: number } |
  { readonly kind: 'recover'; readonly expectedGeneration: number; readonly material: Material } |
  { readonly kind: 'refreshCommit'; readonly expectedGeneration: number; readonly material: Material };
export interface CasWrite {
  readonly expectedVersion: number;
  readonly envelope: Envelope;
}
export declare function validateEnvelope(input: unknown, key: AccountKey, metadata: CurrentMetadata): Result<Envelope>;
export declare function planTransition(key: AccountKey, current: CurrentObservation, transition: Transition): Result<CasWrite>;
```

Validate account names with `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` using full-string comparison.
Require positive safe integers for existing generations. Reject overflow before increment.
Reject unknown envelope fields, wrong identities, plaintext material, empty material, and non-string or empty material values.
Require 1 to 32 material entries. Material keys follow the same full-string component grammar and length limit as account names.
Require ordinary own data properties in the unwrapped material record. Snapshot those values into a new frozen record before wrapping it.
Use the existing store material limits when serializing. Redaction is a host boundary, not an on-wire JSON wrapper.
Reject schema 1 with `MigrationRequired`. Reject all other schema violations with `Quarantined`.
Require data version, metadata current version, and envelope generation to match.
Reject deletion, destruction, scheduled deletion, and inconsistent observations with `Quarantined`.
The store must obtain fresh metadata and data. A data `NotFound` does not establish `kind: 'absent'`.
Explicit metadata absence is necessary but insufficient for manager import authority.
Require an intact provisioned OpenBao control authority and an exclusive new-identity reservation before create-only import.
Known managed references with absent credential authority require quarantine. Missing control authority blocks the backend.

`import` requires absence and produces generation 1 with CAS 0. Any existing key returns `Conflict`.
`remove` requires the exact active generation and produces a material-free tombstone at generation plus one.
`recover` requires the exact tombstone generation and separately authorized fresh material.
`refreshCommit` requires the exact active generation. A tombstone never permits refresh.
Every existing-state transition uses the observed version as CAS and increments the envelope generation.
Wrong generation returns `Conflict`. Wrong state returns `Quarantined`.
Pure transition planning grants no authority and proves no provider ownership.

Apply lifecycle failure precedence consistently.
First validate the account key and transition shape, including supplied material and expected-generation arguments. Malformed caller arguments return `InvalidInput`.
Next validate the current observation shape and metadata. Corrupt observations return `Quarantined`.
For a present plain-data envelope, recognize schema 1 before schema 2 field validation and return `MigrationRequired`.
Then validate schema 2 identity, state, generation, and material. Invalid schema 2 state returns `Quarantined`.
Only after current state validates, apply existing-import conflict, expected-generation conflict, and wrong-state refusal, in that order.
A public-boundary exception always returns the closed `InvalidInput` failure without exception details.
Thus an import against valid existing state returns `Conflict`, but corrupt or legacy current state retains its more specific refusal.

## Effect ports

Define these ports in `packages/providers/src/credential-manager.ts`. Use Effect Context.Tag for `CredentialManagerPort`.

```typescript
export type Operation = 'metadata' | 'status' | 'list' | 'import' | 'resolve' |
  'remove' | 'recover' | 'refresh' | 'revoke' | 'historyPrune' | 'migrateSchema1' | 'readback';
export interface Binding extends AccountKey {
  readonly backend: CredentialBackendIdentity;
  readonly reference: string;
  readonly generation: number;
}
export type AuthorizationRequest =
  { readonly operation: 'list'; readonly backend: CredentialBackendIdentity; readonly provider: Provider } |
  { readonly operation: 'metadata'; readonly backend: CredentialBackendIdentity; readonly key: AccountKey } |
  { readonly operation: 'import'; readonly backend: CredentialBackendIdentity; readonly key: AccountKey; readonly observedAbsent: true } |
  { readonly operation: Exclude<Operation, 'list' | 'metadata' | 'import' | 'historyPrune'>; readonly binding: Binding } |
  { readonly operation: 'historyPrune'; readonly binding: Binding; readonly versions: readonly number[] };
export interface AuthorizationPort {
  readonly authorize: (request: AuthorizationRequest, deadline: number) => Effect.Effect<void, ManagedFailure>;
}
export interface ManagedStorePort {
  readonly observeMetadata: (key: AccountKey, deadline: number) => Effect.Effect<MetadataObservation, ManagedFailure>;
  readonly observeData: (key: AccountKey, observed: CurrentMetadata, deadline: number) => Effect.Effect<DataObservation, ManagedFailure>;
  readonly write: (key: AccountKey, change: CasWrite, deadline: number) => Effect.Effect<number, ManagedFailure>;
}
export interface ManagedListingPort {
  readonly list: (provider: Provider, deadline: number) => Effect.Effect<readonly string[], ManagedFailure>;
}
export interface ManagedHistoryPort {
  readonly pruneHistory: (key: AccountKey, versions: readonly number[], currentGeneration: number, deadline: number) => Effect.Effect<void, ManagedFailure>;
}
export interface SanitizedReceipt {
  readonly binding: Binding;
  readonly operation: Operation;
  readonly outcome: 'passed' | 'refused';
  readonly code?: FailureCode;
  readonly compared?: boolean;
  readonly evidence: 'synthetic' | 'live';
}
export interface ManagedStatus {
  readonly binding: Binding;
  readonly state: 'active' | 'tombstoned';
  readonly providerQualification: 'unverified' | 'qualified';
}
export interface CredentialManagerService {
  readonly status: (reference: string, deadline: number) => Effect.Effect<ManagedStatus, ManagedFailure>;
  readonly list: (provider: Provider, deadline: number) => Effect.Effect<readonly string[], ManagedFailure>;
  readonly import: (reference: string, material: Material, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly resolve: (reference: string, deadline: number) => Effect.Effect<{ readonly binding: Binding; readonly material: Material }, ManagedFailure>;
  readonly remove: (reference: string, generation: number, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly recover: (reference: string, generation: number, freshMaterial: Material, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly refresh: (reference: string, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly revoke: (reference: string, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly readback: (reference: string, comparisonMaterial: Material, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly migrateSchema1: (reference: string, legacyGeneration: number, material: Material, deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
  readonly historyPrune: (reference: string, generation: number, versions: readonly number[], deadline: number) => Effect.Effect<SanitizedReceipt, ManagedFailure>;
}
```

Import `MetadataObservation`, `DataObservation`, and `ManagedStorePort` from the accepted private `openbao-managed-store.ts` source.
The store interface above documents that source contract. Do not define a second competing store interface in the manager.
Keep future listing and history capabilities separate. The accepted store does not implement them.
`metadataAbsent` is a current observation only. `schema1` data classification contains no validated migration material.
Convert validated managed metadata and data into `CurrentObservation` only for pure transition planning.

Authorize metadata separately from data read and list. Authorize mutations against the exact fresh binding and operation.
Authorize exact-account metadata before observation. Its subject contains no generation.
Authorize provider-scoped list without an account. Authorize absent import only after metadata absence and current control reservation, without an invented existing generation.
The `observedAbsent` request field describes a precondition. It is not proof of first import or permission to create.
Use generation zero only for the CAS create precondition. Reject metadata leakage on denial.
Snapshot inputs before asynchronous authorization. Validate deadlines at execution. Cap complete operations at five seconds.
Preserve interruption. Map unknown callback failures, synchronous throws, and defects to closed `Unavailable` without causes or payloads.
Do not return material through receipts. Reject extra receipt fields at serialization.
Keep refresh and revoke `Unsupported` until qualified adapters implement their remote behavior.
Revalidate authority immediately before delivery. A status receipt is never a delivery grant.
CAS prevents stale durable commits. It cannot retract access already delivered before a deletion.

## Administrative erasure and control authority

The [erasure policy decision](2026-09-15-openbao-erasure-policy-decision.md) controls quarantine scope and reconciliation.
The [executable PEL policy](../../../examples/pel/openbao-erasure-policy.pel) classifies normalized observations without granting authority.
Its `import-candidate` and `active-candidate` outputs require additional current authorization and readiness checks.
Do not accept PEL arguments or outputs as evidence that OpenBao was observed.

Require a separately protected installation epoch and material-free lifecycle control records inside OpenBao.
The manager must not provision a missing epoch automatically. Missing or inconsistent control authority blocks delivery and mutation backend-wide.
Unavailable or denied observations block use without asserting that administrative erasure occurred.
Account-only quarantine requires intact control evidence that identifies the account and preserves independent sibling authority.
Missing material for a known account never permits ordinary import. Pending, tombstoned, and quarantined identities are not new identities.

First import requires an exclusive identity reservation within an intact installation epoch.
The production control-state contract must bind backend, epoch, account, operation identity, and the exact selected object and generation.
That contract must fence delayed writers across crashes, reconciliation, retirement, and epoch changes.
Two KV keys do not constitute a transaction. Do not activate an ambiguous pending operation merely because a lease expired.
A CAS conflict alone is contention, not evidence of erasure.

Reconciliation is a distinct administrative operation, not ordinary recovery from an intact tombstone.
Require current OpenBao-backed administrative authority for the affected backend, epoch, scope, and control revision.
Keep reconciliation authorization records outside paths writable by ordinary manager credentials.
Do not assume ordinary KV update permission restricts individual JSON state transitions.
After reconciliation, confirm the recorded repair or retirement and all affected account dispositions before clearing the block.
An empty replacement registry cannot authorize adoption of surviving material or erase unresolved obligations.
Diagnostics and specifically authorized reconciliation remain available while ordinary delivery and mutation are blocked.

The manager must authorize successor-generation confirmation separately through the existing exact-binding `readback` operation.
Confirmation requires exact metadata, envelope, operation binding, and private proposal/material comparison, not metadata alone.
A write acknowledgement is not a success receipt. Unknown post-write outcomes require reconciliation, without automatic mutation retry.
Final delivery requires a fresh authorization and readiness check for the selected generation and current control authority.
Import readiness binds the provisioned backend and current new-identity reservation, not an invented existing account generation.
Host, trust, policy, candidate, and control evidence must come from the host's observed readiness service, not caller declarations.

If an administrator removes or forges all same-authority evidence, reliable historical detection is impossible under this trust model.
Missing installation evidence still blocks use. Explicit reprovisioning establishes a new epoch, not proof of a previously unused backend.
Storage readiness remains separate from provider validity, remote refresh ownership, and production host qualification.

The control store, fencing protocol, observed readiness service, and reconciliation interface require a reviewed implementation contract.
They are not implemented by the private store or pure PEL classification. Their release tasks remain open.

## Deployment policy and readiness

Define deployment types in `packages/orchestration/src/openbao-deployment.ts`.

```typescript
export interface DeploymentPolicy {
  readonly platform: 'wsl' | 'linux';
  readonly devMode: boolean;
  readonly endpoint: string;
  readonly caSha256: string;
  readonly storageClass: 'linux-local' | 'windows-mounted' | 'synchronized' | 'unknown';
  readonly init: 'systemd' | 'other';
  readonly bootstrapOutsideBao: boolean;
  readonly distinctRoles: boolean;
  readonly serviceOwner: string;
  readonly startupOwner: string;
  readonly startupPolicy: string;
  readonly unsealOwner: string;
  readonly backupCustodian: string;
  readonly backupDestinationClass: 'protected-off-host' | 'other';
  readonly recoveryOwner: string;
  readonly recoveryTimeObjectiveSeconds: number;
  readonly recoveryPointObjectiveSeconds: number;
}
export type PolicyFailure = 'InvalidConfiguration' | 'MissingOperatorInput' | 'UnsafeConfiguration';
export type PolicyResult = { readonly status: 'valid-policy'; readonly platform: 'wsl' | 'linux' } |
  { readonly status: 'refused'; readonly code: PolicyFailure };
export declare function validateDeploymentPolicy(input: unknown): PolicyResult;
```

This pure function validates declared policy only. It never emits ready, authenticated, or qualified.
Use no filesystem, environment, process, network, clock, or token access.
Require all fields and reject unknown fields. Missing operator ownership or recovery objectives returns `MissingOperatorInput`.
Require ownership and policy strings of 1 to 256 ASCII characters from U+0020 through U+007E.
Require full-string validation and equality with the trimmed value. Whitespace-only values are missing operator inputs.
Require positive safe-integer recovery time and nonnegative safe-integer recovery point objectives.
Do not invent defaults for owners, Windows startup policy, backup custody, or recovery objectives.
Require a canonical HTTPS origin and exactly 64 lowercase hexadecimal CA digest characters.
Reject dev mode, non-systemd init, unsafe storage, bootstrap cycles, shared roles, and unprotected backups with `UnsafeConfiguration`.
Malformed types, enums, URL, digest, ranges, unknown fields, or non-object input return `InvalidConfiguration`.
Validate object shape and supplied field types first. Then test missing operator fields. Then test unsafe policy.
Accept only ordinary own data properties. Reject accessors, symbol fields, inherited fields, and non-plain object prototypes.
Catch descriptor, prototype, proxy, and Redacted extraction failures at each public validator boundary.
Deployment validation returns only `InvalidConfiguration` for these failures. Lifecycle validation returns only `InvalidInput` for boundary exceptions.
Never serialize the rejected input or caught exception. Apply boundary protection to all pure functions and receipt serializers.
Receipt serialization returns `Result<SanitizedReceipt>` and uses `ManagedFailure` with `InvalidInput` for rejected objects or boundary exceptions.
An unrelated degraded systemd unit alone does not establish OpenBao failure.

Define observed readiness in `packages/orchestration/src/openbao-readiness.ts`.

```typescript
export interface ReadinessBinding {
  readonly account: Binding;
  readonly candidateSha256: string;
  readonly platform: 'wsl' | 'linux';
  readonly hostEvidenceSha256: string;
  readonly authenticatedBackendId: string;
  readonly effectiveCaSha256: string;
  readonly effectivePolicySha256: string;
}
export interface ReadinessPort {
  readonly requireCurrent: (binding: ReadinessBinding, deadline: number) => Effect.Effect<void, ManagedFailure>;
}
```

Require observed TLS, authenticated backend identity, mount, namespace, CAS enforcement, retention, and current deletion schedule evidence.
Resolve mount and key policy inheritance for the deployed OpenBao version. Unknown effective policy returns `NotReady`.
Require current active and tombstone records to have no automatic expiration. Historical pruning cannot remove current authority.
Any candidate, host, account generation, trust, backend, or policy drift invalidates readiness.
A caller-provided digest or trust label cannot establish observed qualification.
Missing Linux host evidence cannot be replaced with WSL evidence. Missing Windows interruption authority leaves WSL lifecycle qualification incomplete.

## Schema 1 migration and operator commands

Schema 1 records remain raw-pilot or unmanaged records until explicit migration. Do not silently reinterpret or overwrite them.
Use a separate `migrateSchema1` authorization bound to backend, provider, account, and observed schema 1 KV version.
Block provider traffic during migration. Validate selected identity and supplied material privately.
Write schema 2 active state with CAS against that exact version and generation equal to the next KV version.
Reread exact metadata and envelope before recording migration success. Conflict, deletion, uncertain completion, or mismatch requires reconciliation.
Do not use CAS 0 import, metadata deletion, historical undelete, or token replay as migration.
Migration of schema is not account cutover or provider qualification.

| Command | Authority and result |
| --- | --- |
| `credentials import --provider P --account A --stdin` | Create-only new account, bounded private material, sanitized receipt |
| `credentials readback --provider P --account A --stdin` | Private comparison, Boolean and binding only, no provider invocation |
| `credentials remove --provider P --account A --generation G` | Exact active generation, CAS tombstone, no raw deletion |
| `credentials recover --provider P --account A --generation G --stdin` | Exact tombstone, distinct authority, newly supplied material |
| `credentials migrate-schema1 --provider P --account A --generation G --stdin` | Explicit schema migration authority, exact legacy version |
| `credentials revoke --provider P --account A` | Qualified provider revocation only, otherwise Unsupported |
| `credentials history-prune --provider P --account A --generation G --version V` | Distinct maintenance authority, only positive historical versions below current generation |

Readback cannot return a reusable credential digest. Recovered material never enters an argument or receipt.
Historical pruning tolerates already-pruned versions. It cannot qualify recovery or change current lifecycle state.
Provider revocation, OpenBao token revocation, lifecycle removal, and historical cleanup remain separate operations.
Disaster restore blocks delivery and provider traffic until backend and provider generation reconciliation completes.

## Provider and platform admission inputs

Require an explicit selection tuple: provider, named account, source reference, source context identifier, candidate digest, and platform.
Require account-specific authority for each live operation. Do not infer a second Claude account from duplicated prose.
Require native interface version, supported delivery channel, refresh ownership protocol, reconciliation procedure, and revocation capability evidence.
Preserve source login files during authorized readback. Classify them as unmanaged sources, never managed fallback.
Nonparticipating vendor refresh writers block cutover. Lease expiry alone cannot establish that an earlier remote request stopped.
After ambiguous provider rotation, refuse retries and delivery until provider-specific reconciliation establishes the current credential generation.
Pure and synthetic work can proceed while operator inputs and live evidence remain absent.

## Requirement and test ownership

All test paths below are exact planned targets. No entry claims a completed test.

| Production ID | Existing requirements | Task owner and test target |
| --- | --- | --- |
| PROD01 | CM06, pilot Production transport validation, Bounded bootstrap authentication | 1A/1B `packages/orchestration/src/openbao-deployment.test.ts`, `packages/orchestration/src/openbao-readiness.test.ts` |
| PROD02 | CM06, RC04 | 1B `packages/orchestration/src/openbao-platform-lifecycle.test.ts` |
| PROD03 | CM00, CM01, NL08 | 2B/5 `packages/providers/src/credential-manager.test.ts`, `packages/orchestration/src/pel-provider-live.test.ts` |
| PROD04 | CM08, NL03, NL04 | 2B/4 `packages/providers/src/openbao-managed-store.test.ts`, `packages/orchestration/src/credential-refresh-owner.test.ts` |
| PROD05 | CM03, pilot Safe repeated import | 2A/2B `packages/providers/src/credential-lifecycle.test.ts`, `packages/providers/src/credential-manager.test.ts` |
| PROD06 | CM04, PL06, pilot Sanitized evidence | 3 `packages/orchestration/src/credential-cli.test.ts` |
| PROD07 | CM05, CM08, NL06 | 2A/2B `packages/providers/src/credential-lifecycle.test.ts`, `packages/providers/src/credential-manager.test.ts` |
| PROD08 | CM06, RC04, NL04 | 1B/4 `packages/orchestration/src/openbao-platform-lifecycle.test.ts`, `packages/orchestration/src/credential-migration.test.ts` |
| PROD09 | CM00, CM06, CM08, NL08 | 1B `packages/orchestration/src/openbao-readiness.test.ts` |
| PROD10 | NL01, NL03, NL04, RC06 | 4 `packages/orchestration/src/credential-refresh-owner.test.ts`, `packages/providers/src/native-credential-qualification.test.ts` |
| PROD11 | RC01, RC05, pilot Bound executable provenance | 1B/6 `packages/orchestration/src/openbao-platform-lifecycle.test.ts`, `packages/orchestration/src/openbao-production-admission.test.ts` |
| PROD12 | PL04, PL05, PL06, PL07, PL08, RC05, RC07 | 5/6 `packages/orchestration/src/openbao-production-admission.test.ts` |

## Dispatch sequence

Review Task 0 before execution. Dispatch 1A and 2A independently after acceptance.
Use the bounded briefs under `docs/superpowers/plans/2026-09-15-openbao-production-*.md`.
Tasks 1B, 2B, 3, 4, 5, and 6 require dependency-specific briefs before implementation admission.
Do not dispatch a backlog heading as an executable task. Preserve all required release gates while accepting isolated pure work.
