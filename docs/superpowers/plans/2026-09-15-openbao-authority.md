# Authoritative managed credential service implementation plan

> Use subagent-driven-development with one implementation and independent task review.

## Global constraints

The user approved the OpenBao source-of-truth direction and implementation on 2026-09-15.
Use the existing linked worktree. Preserve concurrent native-login work.
Run failing tests before implementation and report candidate-scoped verification.
Do not migrate live accounts, change installed runtimes, or publish this candidate.
The user requires a Fable 5.1 audit of the work package before acceptance.
Use the exact claude-fable-5-1 profile with a verified Claude Code route.
Bind the read-only audit to the verified package diff and preserve every finding.
An unavailable route leaves the audit pending. Another model cannot satisfy this requirement.

## Task 4: Authoritative managed credential service

Dispatch status: Superseded by the [production contracts](../specs/2026-09-15-openbao-production-contracts.md).
Use the reviewed production Task 2A brief first. Do not dispatch this earlier task independently.
The production contract governs metadata, schema migration, readiness, managed removal, and recovery.

## Objective

Implement the host-only credential manager over CredentialStoreService.
The user approved OpenBao as the sole durable credential authority for managed accounts.
This task implements the reusable service, not CLI wiring or native refresh adapters.
Do not introduce an alternate credential source or read native profile files.

## Files

- Create packages/providers/src/credential-manager.ts.
- Create packages/providers/src/credential-manager.test.ts.
- Modify packages/providers/src/index.ts only to export the new module.
- Do not modify native auth, transport, orchestration, or pilot files.
- Write .superpowers/sdd/task-4-report.md with red and green evidence.

## Interface

Use existing CredentialProvider, CredentialStoreFailure, StoredProviderCredential, and CredentialStoreService.
Consume the implemented CredentialBackendIdentity and makeCredentialBackendIdentity contract.
This remains a manager implementation plan; the correction package does not implement the manager.
Export these new types and functions:

```typescript
type CredentialManagerOperation = 'status' | 'list' | 'import' | 'resolve' | 'remove' | 'recover' | 'refresh' | 'revoke';
interface CredentialManagerFailure {
  readonly _tag: 'CredentialManagerFailure';
  readonly code: CredentialStoreFailure['code'] | 'Unsupported';
}
interface CredentialManagerAuthorization {
  readonly backendIdentity: CredentialBackendIdentity;
  readonly operation: CredentialManagerOperation;
  readonly provider: CredentialProvider;
  readonly account?: string;
  readonly generation?: number;
}
interface ManagedCredentialStatus {
  readonly backendIdentity: CredentialBackendIdentity;
  readonly source: 'openbao';
  readonly reference: string;
  readonly provider: CredentialProvider;
  readonly account: string;
  readonly version: number;
  readonly credentialState: 'stored';
  readonly providerQualification: 'unverified';
}
interface CredentialManagerConfig {
  readonly store: CredentialStoreService;
  readonly backendIdentity: CredentialBackendIdentity;
  readonly authorize: (request: CredentialManagerAuthorization) => Effect.Effect<void, CredentialManagerFailure>;
}
interface ManagedCredential extends StoredProviderCredential {
  readonly backendIdentity: CredentialBackendIdentity;
  readonly reference: string;
}
interface CredentialManagerService {
  readonly status: (reference: string, deadline: number) => Effect.Effect<ManagedCredentialStatus, CredentialManagerFailure>;
  readonly list: (provider: CredentialProvider, deadline: number) => Effect.Effect<readonly string[], CredentialManagerFailure>;
  readonly import: (reference: string, material: Redacted.Redacted<Readonly<Record<string, string>>>, deadline: number) => Effect.Effect<number, CredentialManagerFailure>;
  readonly resolve: (reference: string, deadline: number) => Effect.Effect<ManagedCredential, CredentialManagerFailure>;
  readonly remove: (reference: string, generation: number, deadline: number) => Effect.Effect<void, CredentialManagerFailure>;
  readonly recover: (reference: string, generation: number, material: Redacted.Redacted<Readonly<Record<string, string>>>, deadline: number) => Effect.Effect<void, CredentialManagerFailure>;
  readonly refresh: (reference: string, deadline: number) => Effect.Effect<never, CredentialManagerFailure>;
  readonly revoke: (reference: string, deadline: number) => Effect.Effect<never, CredentialManagerFailure>;
}
```

Export CredentialManagerPort as an Effect Context.Tag and makeCredentialManager(config): CredentialManagerService.
The typed factory is for composition with the existing OpenBao store.
It does not establish backend deployment identity or production readiness by itself.
The final host composition must bind backend identity, mount, namespace, and reference for readiness evidence.
Build the identity and production store from the same immutable endpoint/mount/namespace/trust
configuration using makeOpenBaoCredentialBackend. Separate runtime and maintenance instances use
distinct least-privilege token callbacks and the same identity configuration; manager authorization
must still distinguish their operations. Identity includes a SHA-256 digest of explicit CA configuration or an explicit system
trust-policy identity, not raw CA PEM or tokens. It identifies configuration, not deployment attestation
or equivalence of OS trust stores. Readiness and authorization bind identity.id, provider, account,
reference, and current KV version. Reject any mismatch before delivery and re-read the generation.
Do not permit synthetic factory selection in the production composition root.

## Behavior

1. Validate references with full-string grammar bao:(agy|codex|claude|grok):ACCOUNT before authorization or store effects.
2. ACCOUNT is one to 64 ASCII alphanumeric, period, underscore, or hyphen characters and begins alphanumeric.
3. Validate a finite future absolute Unix-millisecond deadline at Effect execution, not Effect construction.
4. Cap the complete authorization and store operation at five seconds. Preserve caller interruption.
5. Snapshot configuration functions at construction and mutable method inputs at Effect execution before asynchronous authorization.
6. Authorization is lazy and operation-specific. Denial starts no store operation.
7. status and resolve read the selected record afresh on every execution. No cache, retry, fallback, or native filesystem imports.
8. Revalidate returned provider, account, positive safe-integer version, and redacted nonempty string-record material. Reject mismatches before return.
9. status projects only the exact metadata fields above. A stored record never implies a working native login.
10. list returns validated account names and no credential bytes. Reject malformed or duplicate account names.
11. import calls write with expectedVersion zero. It never overwrites or deletes an existing account.
12. remove requires an exact active generation and maintenance authorization. It writes a CAS-advancing schema 2 tombstone without material.
13. refresh and revoke return Unsupported without a store mutation. Native adapters are a later task. Do not simulate either operation.
14. All errors use only closed failure codes. Sanitize synchronous callback throws, failed Effects, and defects that contain secret canaries. Preserve interruption rather than converting it to success.
15. Do not return raw store errors, causes, payloads, or authorization objects in diagnostics.
16. Managed removal retains a readable schema 2 tombstone. Resolve refuses and create-only import returns Conflict.
    Recovery requires exact backend/account/generation authority and newly supplied material.
    Administrative raw deletion requires quarantine. Never infer recovery authority from NotFound.
17. Interim resolver integration must fail closed for unrecognized bao: references. It must not try
    a native profile, environment token, or another account, or launch a worker. This integration is
    deferred and cannot be inferred from store tests.
18. Before recovery or refresh implementation, add a separately authorized exact-account metadata
    observation capability for current KV generation, selected-version deletion/destruction state,
    and durable lifecycle generation. The present store does not expose metadata or NotFound versions.
    Grant the required metadata read path separately from listing and return no credential material.
19. Require all managed writers to serialize deletion, recovery and refresh across processes under
    durable lifecycle authority in OpenBao, with atomic or fenced stale-owner refusal. No local
    database is a second durable authority. Soft deletion does not advance KV version; matching CAS
    and a read-before-write check do not prevent resurrection. The protocol and crash behavior remain
    a design gate, not delivered manager functionality. Nonparticipating native writers block migration.

## Verification

Start with a failing test for the absent manager export, then behavioral red/green tests.
Use node:test and Effect. Test service ports can be deterministic fixtures, not live credentials.

Required cases:

- All four provider references resolve exactly the selected identity.
- status contains only metadata and never the access or refresh canary.
- A second resolve after a store generation change returns the new generation.
- A status observation followed by record deletion cannot authorize a later resolve. Status is metadata, not a reusable delivery grant.
- After a successful read, NotFound, Denied, and Unavailable each fail without stale credential reuse.
- Malformed references and expired deadlines cause zero authorization and store calls.
- Denied import/remove cause zero writes. Allowed repeated import propagates Conflict.
- A store identity mismatch fails, including another account in the same provider.
- Invalid store versions, plaintext instead of Redacted material, malformed list entries, and duplicate list entries fail.
- Mutation of material or generation inputs during authorization cannot change the authorized operation.
- Hanging authorization and hanging store calls terminate at the caller deadline.
- Cancellation interrupts the active Effect.
- Synchronous throws, Effect failures, and Effect defects containing a canary produce only closed sanitized failure data.
- An unknown failure code from a supplied port becomes Unavailable rather than being copied into the public error.
- refresh/revoke are explicit Unsupported with zero store mutations.
- A changed backend endpoint, mount, namespace, or trust identity invalidates readiness even if the
  provider/account/version match. Authorization and delivered metadata bind the configured identity.
- An unrecognized bao: reference with populated fallback canaries causes zero fallback reads and
  zero worker launches in the eventual resolver integration test.
- A tombstoned account remains a create-only import Conflict; separate future recovery requires the
  recorded generation, new material, and maintenance authority without metadata destruction or replay.
- Denied metadata observation returns neither version nor material; data-read/list authority alone
  cannot authorize it. Stale metadata or lifecycle generation refuses recovery before write.
- Cross-process refresh begun before deletion cannot commit after the tombstone, even with matching
  KV CAS. Crash/restart preserves the tombstone and fences the stale owner. Recovery competes under
  the same authority and never authorizes an ordinary refresh writer to resurrect the account.

Commands:

```bash
npm run build --workspace @foreman/providers
node --import tsx --test packages/providers/src/credential-manager.test.ts
node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/orchestration/src/openbao-pilot.test.ts
npm run typecheck
git diff --check
```

## Constraints

Use Node.js 24, strict TypeScript, Effect, and apply_patch.
No new dependencies. No commits, index writes, branch operations, installations, or live credential operations.
Another session owns native-login source files. Preserve all existing work.
This task may not claim CLI integration, live provider readiness, or completed release acceptance.
