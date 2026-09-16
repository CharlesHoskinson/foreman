# ForeDi credential manager and OpenBao operations

Status: Approved direction for implementation on 2026-09-15. Implementation and release evidence remain incomplete.

## Architecture

OpenBao is the sole durable credential authority for managed accounts, not an optional cache of native profiles.
Setup, qualification, and execution must share the same selected reference and manager.
Credential observations bind the backend identity, mount, namespace, provider, account, and KV version.
Use the implemented makeCredentialBackendIdentity validator and readonly CredentialBackendIdentity
type. Use makeOpenBaoCredentialBackend to construct identity and store from one immutable snapshot.
Use separate least-privilege runtime and maintenance instances with matching identities and separate
token callbacks. This composition does not implement manager authorization.
The trust digest represents explicit CA configuration or the named host system-trust policy;
it is not deployment attestation or proof of equal OS trust stores. Raw PEM and tokens never
enter readiness metadata. Changed backend identity invalidates the previous readiness binding.
A stored credential is not proof of provider authentication or capability qualification.
Legacy native references remain explicit unmanaged routes until an approved cutover.
Missing, revoked, denied, sealed, or deleted managed credentials never cause fallback to those routes.
Transient worker access material is not a second durable authority.
OpenBao bootstrap authentication remains outside its own credential dependency cycle.

Extend the existing provider composition root and CLI router. Use the private managed observation and write ports for schema 2 lifecycle operations.
Keep the raw CredentialStorePort pilot separate. Add a host-only CredentialManagerPort for lifecycle operations.
Pel receives references and sanitized receipts, never credential bytes. Use the existing Effect owner and typed errors.
Do not create another daemon, scheduler, or local lifecycle authority.

Proposed CLI forms include `foreman credentials status`, `list`, `import`, `readback`, `remove`, `recover`, `migrate-schema1`, `history-prune`, `refresh`, and `revoke`.
Use the exact selection flags and typed interfaces in the production contracts. Managed removal takes `--generation`, not historical versions.
These forms are requirements, not available commands. Import reads one bounded private input stream. No command prints credential material.

Host configuration selects an explicit HTTPS endpoint, KV v2 mount, namespace, CA trust, and bootstrap-token service. The bootstrap credential must not reside inside the store that requires it. The deployment selects OpenBao Agent or an approved host authentication source. No implicit environment or profile fallback is permitted.
An interim resolver that does not recognize a bao: reference must refuse before fallback reads
or worker launch. Its integration test remains planned and must use populated fallback canaries.
After managed deletion, the current envelope remains a readable tombstone and CAS0 import conflicts.
Recovery requires distinct maintenance authority, the current tombstone generation, and new material.
Raw current-version deletion requires quarantine, not ordinary lifecycle recovery.
No automatic metadata deletion, undelete, or refresh-token replay is permitted.
The experiment's conditional KV write does not prove maintenance authorization: ordinary updates
have the same ACL capability. Add selected-account metadata observation for current KV generation,
deletion/destruction state and lifecycle generation under explicit metadata-read authority.
All managed writers must use durable OpenBao lifecycle state and cross-process serialization with
atomic or fenced stale-owner refusal. Soft deletion does not advance KV generation, so CAS and a
read-before-write check cannot prevent resurrection. Prove refresh-versus-delete and recovery-versus-
stale-owner races, including crashes, before manager implementation can satisfy this design gate.
No local lifecycle database may become a second durable credential authority.

## Proposed CM08 implementation candidate

This candidate is a future manager design and test gate. The current raw store does not implement it.
Use one KV v2 key for each account's lifecycle envelope and credential material.
Use a new strict schema with `schemaVersion: 2`, provider, account, state, and lifecycle generation.
An active envelope requires validated material. A tombstoned envelope forbids material.
Reject unknown fields, invalid state combinations, identity mismatches, and unsafe generation integers.
The lifecycle generation must equal the containing KV version. Each successful mutation advances both generations.

Managed deletion writes a tombstoned envelope with CAS against the observed active version.
It does not call the raw selected-version `remove` operation.
A refresh commit writes an active envelope with CAS against its observed active version.
If deletion wins, the version advances and the stale refresh CAS fails.
The losing refresh must neither persist nor deliver its returned material.
If refresh wins first, deletion must observe the new active version before an authorized retry.
Do not report deletion success until the tombstone write succeeds.

Recovery requires a distinct operation authorized for the exact backend, account, and current tombstone generation.
Recovery writes fresh material and active state with CAS against that tombstone version.
Stale recovery and stale refresh cannot overwrite the newer version.
After restart, read current data and exact-account metadata from OpenBao before granting operation authority.
Require consistent data version, current metadata version, lifecycle generation, and deletion/destruction status.
Refuse delivery or mutation when observations disagree. A bounded fresh observation may resolve a concurrent transition.
An absent, soft-deleted, destroyed, or malformed known managed envelope requires quarantine and explicit reconciliation.
An unreadable observation blocks use without asserting erasure. Its scope depends on the failed authority boundary.
Never infer permission to create or recover a managed account from `NotFound`.

## Approved erasure policy

The [three-provider policy decision](../../../docs/superpowers/specs/2026-09-15-openbao-erasure-policy-decision.md) controls administrative-erasure handling.
CM09 through CM14 define the EARS requirements and acceptance scenarios.
Use separately protected installation and material-free control evidence inside OpenBao.
Use account quarantine only when intact control evidence proves isolation. Otherwise block affected backend delivery and mutation.
Require explicit provisioning, exclusive first-import reservation, and independently authorized reconciliation.
Do not create authority from native login state, local files, PEL values, or previous readiness receipts.

The single-key envelope still provides an atomic managed tombstone transition.
It does not retain evidence after administrative metadata deletion. Protected control records address that separate requirement.
The concrete control-state and stale-writer fencing protocol remains a production implementation gate.
The design cannot detect a privileged operator who destroys or forges every relevant record in the sole authority.

The [PEL policy specification](../../../examples/pel/openbao-erasure-policy.pel) returns refusal or candidate classifications only.
Its test is `packages/pel/test/openbao-erasure-policy.test.ts`.
Neither a policy candidate nor a passing pure test grants runtime authority or satisfies the production manager gate.

Restrict data-write authority to the manager's authorized mutation path. Require CAS for all managed writes.
Do not grant ordinary callers direct mutation, undelete, metadata deletion, or current-version soft-delete authority.
Use raw `remove` only for selected historical-version cleanup after the lifecycle transition.
Historical cleanup must tolerate versions that OpenBao has already pruned.
Current lifecycle decisions, recovery authorization, and reconciliation must not depend on retained historical credential material.
Use the latest envelope and qualified metadata as current authority. Missing required current evidence causes quarantine.

Qualify effective `cas_required`, `max_versions`, and `delete_version_after` policies before manager admission.
Resolve mount configuration and per-key inheritance for the deployed OpenBao version. A key-level zero or false value does not establish effective policy.
Require effective CAS enforcement for every managed key. Record the qualified retention bound and pruning behavior.
Require that the latest active envelope and latest tombstone cannot automatically expire.
Check the current version's deletion schedule as well as configuration for future writes.
Refuse admission when existing current state has a deletion schedule or when future writes can automatically expire.
Invalidate qualification after configuration drift. Refuse mutation and delivery when effective policy is unknown or differs from the qualified policy.
Restrict configuration changes to trusted administration. Repeated metadata checks cannot atomically fence concurrent administrative bypass.

OpenBao's [metadata command documentation](https://openbao.org/docs/commands/kv/metadata/) describes inherited settings, permanent oldest-version pruning, and deletion schedules for new versions.
These requirements need deployed-version policy controls and tests. The current raw store does not implement policy qualification or the manager.
Out-of-band administrative soft deletion must trigger quarantine when observed, not automatic recreation.
Administrative bypass of the restricted write policy cannot be fenced by KV CAS alone.
Admission must establish that managed writers cannot bypass this policy. A metadata precheck does not establish that guarantee.

This candidate fences durable store commits. It does not serialize provider-side refresh effects or revoke delivered access.
Provider ownership, ambiguous rotation, and provider-specific reconciliation remain NL03/NL04 gates.
Prove deletion-first, refresh-first, stale recovery, restart, malformed state, and administrative-deletion refusal before manager admission.

## Trust and packaged-consumer admission

`systemTrustIdentity` is a caller-declared policy label. It does not measure certificate anchors or grant readiness.
A label change conservatively invalidates configuration identity. Relabeling alone cannot authorize a backend.
Production readiness must bind an observed effective trust-store digest or explicit CA bundle, plus authenticated backend identity.
Refuse qualification when that evidence is absent. Invalidate readiness when effective anchors or authenticated backend identity change.
An unchanged label must not preserve readiness after an anchor change.

Compiled package exports remain the repository runtime contract.
Supported root npm test hooks rebuild providers before tests. Direct package imports can bypass those hooks.
Production build admission must bind each packaged consumer to current-source build provenance.
Refuse a stale artifact even when its package version matches. This broader release gate remains unimplemented.

## Verification mapping

| Requirement | Planned test target |
| --- | --- |
| CM00 | `credential-manager.test.ts` and `pel-provider-live.test.ts` |
| CM01 | `pel-provider-live.test.ts` |
| CM02 | `credential-manager.test.ts` |
| CM03 | `credential-cli.test.ts` |
| CM04 | `credential-cli.test.ts` |
| CM05 | `credential-manager.test.ts` |
| CM06 | `openbao-credential-store.test.ts` |
| CM07 | `scripts/openbao-pilot.test.ts` |
| CM08 | `credential-manager.test.ts` and `credential-refresh-owner.test.ts` |

Test filenames without a prefix are proposed targets under the owning providers or orchestration package.
The implementation brief must resolve each target before dispatch.

## Authority

Keep changes uncommitted until host integration is explicitly authorized.
Do not change installed runtimes or existing accounts during synthetic development.

## Production contract reconciliation

Use [the production contracts](../../../docs/superpowers/specs/2026-09-15-openbao-production-contracts.md) for production task interfaces and acceptance ownership.
WSL and Linux require separate production qualification with equal credential security gates.
Schema 1 requires explicit migration. Managed removal writes a schema 2 CAS tombstone.
Raw pilot soft deletion remains historical fixture behavior. It cannot implement managed removal or recovery authorization.
Accept pure Task 1A and Task 2A independently. Require dependency-specific briefs before later implementation.
Missing operator ownership, recovery objectives, host test authority, or provider ownership blocks the affected live qualification.
Keep existing unchecked tasks and historical receipts unchanged until candidate-scoped evidence satisfies them.
