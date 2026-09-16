# Return of the ForeDi: remaining release roadmap

Date: 2026-09-15.
Status: Integration checkpoint, not production release acceptance.

## Consolidated scope

The integration branch preserves the native-login work, OpenBao storage foundations, pilot sources, policy requirements, audits, and release documentation.
It also includes the executable PEL erasure-policy specification and its classification tests.
Ignored scratch, credential files, external experiment runtimes, and unrelated worktrees are outside the snapshot.
Historical evidence remains bound to its original source and binary hashes.

## What exists

- Native ChatGPT login support and Grok native transport changes are in the candidate worktree.
- The raw OpenBao store, backend identity, strict HTTP handling, schema 2 lifecycle planner, and private managed store exist in source.
- Synthetic same-process managed-write evidence demonstrates CAS conflict and a material-free tombstone against OpenBao 2.6.2.
- The erasure policy is decided. OpenBao remains the sole durable credential and lifecycle authority.
- EARS/OpenSpec requirements and a pure PEL specification cover evidence-bounded quarantine and refusal classification.

These facts do not establish complete manager integration, remote refresh ownership, production deployment, or release readiness.

## Delivery sequence

| Priority | Work package | Deliverable | Exit evidence |
| --- | --- | --- | --- |
| P0 | Stabilize the consolidated candidate | One branch, source/runtime provenance, current regression results, policy package review | Clean independent checkout, matching runtime manifest, reviewed diff, explicit open failures |
| P1 | Implement durable control and manager authority | Protected installation epoch, account reservations, operation fencing, reconciliation, CredentialManagerPort | Real OpenBao ACL denial tests, transition crash tests, exact readback, no stale activation, no caller-authority shortcut |
| P2 | Complete concurrency and persistence experiments | Separate-process CAS race, fresh-client observation, graceful and forced Raft restart, administrative-erasure cases | Compiled synthetic probes, source-bound reports, verified cleanup, no skipped negative controls |
| P3 | Connect commands and provider consumers | Managed reference resolution, operator commands, shared Setup/qualification/execution manager | Packaged CLI tests, zero fallback reads, sanitized outputs, same reference and current generation across consumers |
| P4 | Qualify provider lifecycle and account cutover | AGY, Codex, Claude, and Grok delivery, refresh ownership, recovery and revocation capability | One provider/account qualification matrix, explicit unsupported results, ambiguous-rotation refusal, approved migration receipts |
| P5 | Qualify WSL and Linux production operations | TLS, systemd lifecycle, bootstrap/unseal ownership, retention, audit, backup and restore | Separate WSL and Linux host evidence, reboot/interruption tests, restore reconciliation, measured RTO/RPO |
| P6 | Close and publish the release | Final exact-source Fable 5.1 audit, independent regression checks, packaged archive and release notes | All required gates satisfied, source/archive hashes, declared version, separately authorized publication |

P1 is the critical path. P2 can start with accepted private store sources while P1 proceeds.
P3 depends on the manager authority contract. P4 depends on P3 and provider-specific refresh ownership.
P5 preparation can proceed independently. Disruptive host tests require the selected host and maintenance authority.
P6 waits for every required gate. An integration commit is not release approval.

## P0: consolidation and current verification

1. Preserve current source and generated runtime together on an integration branch.
2. Run typecheck, changed native transport tests, managed-store tests, PEL tests, and strict OpenSpec validation.
3. Review the complete policy closure package. Preserve the final Fable audit as a separate release gate.
4. Resolve native-route admission discrepancies without copying credentials or treating an unrelated profile as the selected account.
5. Freeze the candidate and build packaged consumers with current-source provenance in the normal release build workspace.

The bounded integration review found one nonblocking policy reason ambiguity.
The pure PEL example returns `recovery-required` for every tombstoned account, including missing or inconsistent material.
Refine that reason to require administrative reconciliation for damaged tombstones before production consumption.
All those cases already return `account-blocked` and grant no authority.

Do not confuse a working native advisory session with qualified OpenBao-managed execution.
The installed Grok `--no-memory` option remains a hidden compatibility flag. Its removal was not the cause established by investigation.

## P1: control state and manager

Select one concrete control storage layout before implementation. The advisory proposals are alternatives, not a finished protocol.
Bind control records to backend, installation epoch, provider, account, operation identity, selected object, and generation.
Keep administrative authorization on paths ordinary manager credentials cannot write.
Use explicit pending states and fencing across multi-key writes. Do not assume KV transactions or lease expiry establish exclusive ownership.

Implement metadata authorization, current observations, exact-generation operation authorization, private confirmation, and final delivery checks.
Import requires an intact provisioned authority and exclusive identity reservation. Metadata 404 alone is insufficient.
Require account quarantine only when control evidence bounds the damage. Otherwise block the affected backend.
Keep listing and historical pruning in separate capabilities from the accepted private read/write store.
Retain schema 1 as MigrationRequired until explicit migration succeeds.

## P2: experiments already specified

- [Cross-process CAS and fresh-client plan](../../superpowers/plans/2026-09-15-openbao-cross-process-experiment.md).
- [Raft restart plan](../../superpowers/plans/2026-09-15-openbao-raft-restart-experiment.md).
- [Erasure policy decision and acceptance cases](../../superpowers/specs/2026-09-15-openbao-erasure-policy-decision.md).

Execute controls before real-server attempts. Use synthetic material and the verified OpenBao binary.
Record conflicts, exact observations, process exits, listener closure, runtime removal, and proof limits.
Add real policy tests for metadata deletion, missing control state, prohibited clearance, and delayed writers after reconciliation.
Never claim detection of history after a privileged administrator destroys or forges all same-authority evidence.

## P3: public interface and consumer integration

Implement the planned status, list, import, readback, remove, recover, schema migration, historical pruning, refresh, and revoke commands.
Require private bounded input for material. Print identity and sanitized outcomes only.
Resolve `bao:<provider>:<account>` through the manager in every managed consumer.
Refuse unknown or unavailable managed references before native, environment, alternate-account, or worker access.
Keep refresh and revoke Unsupported until the selected provider implementation is qualified.

## P4: provider matrix

AGY means Antigravity CLI, not Gemini CLI. Qualify it separately.
For each provider, record the exact model-independent credential transport, native client version, account selection, and delivery channel.
Establish one refresh owner across broker processes and native CLI sessions.
Require provider-specific reconciliation after ambiguous remote rotation. Do not retry an uncertain refresh automatically.
Import and readback alone do not establish provider validity or safe migration.

## P5: production operations

Treat WSL as production, not as a weaker development profile.
Require Linux-local durable storage, verified TLS, explicit service ownership, bootstrap credentials outside their own dependency cycle, and separate roles.
Record startup, unseal, backup, and recovery ownership plus RTO/RPO before configuring production services.
Test mount/key CAS, retention, deletion schedules, trust drift, policy drift, restore, and generation reconciliation.
Obtain separate native Linux host evidence. WSL tests cannot stand in for it.

## P6: release closure

Run the final Fable 5.1 audit against the exact consolidated source and verification bundle.
Resolve every material finding. Preserve dissent and proof limits.
Run source-bound package, install, resolver, command, leakage, and recovery tests.
Update README, dependencies, interface guide, release notes, and the acceptance ledger from measured results.
Assign a release version and publish only through the release authority workflow.

## Authoritative task lists

- [Credential manager](../../../openspec/changes/foredi-08-credential-manager/tasks.md).
- [Native credential lifecycle](../../../openspec/changes/foredi-09-native-credential-lifecycle/tasks.md).
- [Release closure](../../../openspec/changes/foredi-10-release-closure/tasks.md).
- [Bounded PEL release loop](../../../openspec/changes/foredi-11-pel-release-loop/tasks.md).
- [Production contracts](../../superpowers/specs/2026-09-15-openbao-production-contracts.md).

WPP, Midnight Passport, Bitwarden mobile packaging, and their experiments remain a downstream project track.
This Foreman credential release does not claim to complete that integration.
