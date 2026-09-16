# OpenBao production credentials on WSL and Linux

Status: Proposed sprint design for review. The user selected WSL and Linux as production environments.
This document does not authorize installation, account migration, refresh, revocation, or publication.

## Outcome

Provide one production credential manager for Foreman on both platforms.
OpenBao is the sole durable authority for managed credentials and lifecycle state.
WSL is not a development-only profile. Both platforms must pass the same security and recovery gates.
Platform-specific qualification must establish service lifecycle and host storage behavior.
Neither a WSL installation nor a single Linux node implies high availability.

The provider scope includes Codex, Claude, AGY, and provisionally Grok.
The earlier duplicated Claude entry does not authorize selecting an additional account.
Confirm each provider and account before any live operation.

## Design decisions

Use the existing Node.js 24, strict TypeScript, and Effect implementation.
Extend the existing provider composition and command router. Do not introduce another Foreman daemon or scheduler.
Use a non-dev OpenBao service with persistent Raft storage and verified TLS.
Use systemd service management for both supported profiles. Refuse unsupported host prerequisites rather than silently selecting a weaker profile.
Qualify the actual WSL version, distribution, kernel, init system, and Windows host integration.
Qualify the Linux distribution, kernel, filesystem, init system, and service identity separately.

For WSL, place live service data on the distribution's Linux filesystem.
Reject Windows-mounted and synchronized directories for live secret-bearing state in the supported profile.
Qualify permissions, host-volume encryption, free space, and backup protection on each platform.
Treat Windows administrators, Linux root, and the credential-service owner as privileged trust boundaries.
Do not claim that Linux file permissions protect against Windows host administrators.

Use explicit CA configuration for the initial production profile.
Bind readiness to the authenticated backend, CA digest, mount, namespace, platform, candidate, and selected account generation.
Do not accept a caller-supplied trust label as backend qualification.
Keep runtime, maintenance, backup, and bootstrap permissions separate.
Do not give workers OpenBao credentials, refresh credentials, or manager mutation authority.

## Lifecycle authority

Implement the CM08 single-key active/tombstoned envelope before managed recovery.
Managed deletion writes a tombstone with CAS. It does not use raw KV soft deletion.
Recovery requires fresh material and authorization for the exact backend, account, and current tombstone generation.
Resolve current state afresh before delivery. Denied, missing, sealed, changed, or inconsistent state causes refusal.
No managed failure may select a native file, environment credential, cached record, or alternate account.

Qualify effective CAS enforcement, retention, automatic deletion, and current-version deletion schedules.
Require current active and tombstoned records to remain free from automatic expiration.
Historical pruning must not break current authority or recovery authorization.
Configuration changes invalidate qualification. Administrative bypass remains a deployment trust boundary.

KV CAS fences durable commits. It does not fence a remote provider's refresh side effects.
Each provider needs verified refresh ownership and ambiguous-result reconciliation before managed execution.
If another native process can rotate the same credential outside that ownership protocol, refuse cutover.
An expired lease alone cannot prove that an earlier refresh request has stopped.

## Three recovery operations

1. Readback verification imports a selected record and compares recovered material privately.
   It returns a Boolean result and sanitized identity receipt, not material or a reusable credential digest.
2. Lifecycle recovery changes a current tombstone to active state with separately authorized fresh material.
   Ordinary import remains create-only and cannot serve as recovery.
3. Disaster recovery restores protected OpenBao state into an isolated service.
   Restored credential generations may be stale relative to the provider and other clients.
   Block provider traffic and managed delivery until reconciliation establishes current authority.

Initial live readback preserves the source login files and does not refresh or invoke the provider.
Those files remain explicitly unmanaged sources during the experiment, not managed fallback authority.
Do not describe this readback experiment as completed cutover.
Managed cutover requires separate approval and verified exclusion of competing refresh writers.

## Platform qualification

| Gate | WSL production | Linux production |
| --- | --- | --- |
| Persistent service | Non-dev OpenBao, persistent Linux-filesystem state, systemd | Non-dev OpenBao, persistent local state, systemd |
| Startup | Explicit Windows host startup policy and distribution/service readiness | Boot-enabled service and service readiness |
| Recovery tests | Windows reboot, selected distribution shutdown, sleep/resume, service crash | Host reboot, service crash, suspend/resume where supported |
| Network | Endpoint and certificate checks after host networking changes | Endpoint and certificate checks after interface changes |
| Resource faults | Full filesystem, unavailable volume, clock change, audit failure | Full filesystem, unavailable volume, clock change, audit failure |
| Backup | Protected off-host copy and isolated restore | Protected off-host copy and isolated restore |
| Credential gates | Same authorization, lifecycle, no-fallback, and leakage tests | Same authorization, lifecycle, no-fallback, and leakage tests |

WSL service supervision does not establish host uptime.
Microsoft states that systemd services do not keep a WSL instance alive.
The supported WSL deployment must document and test its Windows host lifecycle policy.
Do not shut down a user's distribution or reboot either host without a scheduled test window.
An unavailable host or missing test window leaves platform qualification incomplete.

## EARS acceptance requirements

| ID | Requirement | Evidence |
| --- | --- | --- |
| PROD01 | WHEN either production profile starts, Foreman SHALL reject dev mode, unverified TLS, and unqualified bootstrap configuration. | Startup negative controls on both platforms |
| PROD02 | WHEN the host restarts, the service SHALL retain committed credential and lifecycle state. | Synthetic restart and readback receipt |
| PROD03 | IF managed state is unavailable or inconsistent, THEN Foreman SHALL refuse delivery without fallback. | Populated fallback canaries and zero worker launches |
| PROD04 | WHEN deletion wins a CAS race, the manager SHALL refuse the stale refresh commit and its delivery. | Cross-process race and restart tests |
| PROD05 | WHEN an account is imported, the manager SHALL preserve existing records through create-only semantics. | Duplicate-import conflict and unchanged-material assertion |
| PROD06 | WHEN readback verification completes, the command SHALL emit only sanitized identity metadata and a comparison result. | Process, journal, log, and file leakage controls |
| PROD07 | WHEN lifecycle recovery executes, the manager SHALL require fresh material and exact-generation maintenance authority. | Denial, stale generation, and valid recovery tests |
| PROD08 | WHEN backup restoration completes, Foreman SHALL block managed use until provider freshness and backend identity are reconciled. | Isolated restore with zero provider traffic |
| PROD09 | IF effective retention, trust, or authorization policy changes, THEN Foreman SHALL invalidate affected readiness. | Policy-drift and trust-change controls |
| PROD10 | IF refresh ownership cannot exclude competing writers, THEN Foreman SHALL refuse managed provider cutover. | Provider-specific capability and ownership evidence |
| PROD11 | WHEN platform qualification runs, the verifier SHALL bind results to the actual platform and checked candidate. | Separate WSL and Linux receipts |
| PROD12 | IF required evidence is missing, THEN the PEL workflow SHALL stop without live effects or publication. | Missing-authority, missing-evidence, and stale-candidate controls |

Map these requirements into the existing CM, NL, pilot, release-closure, and PEL changes during specification reconciliation.
This sprint document does not create a competing runtime policy or a second lifecycle authority.

## Capacity and acceptance

Plan a ten-working-day sprint with two implementation tracks and independent review.
Commit to the production foundation, manager, operator interface, and synthetic dual-platform evidence.
Treat live provider qualification as gate-dependent work, not a guaranteed calendar outcome.
All four providers remain required for the complete product release.
An unsupported provider does not prevent accepting an isolated foundation task, but it blocks the all-provider release claim.

Exact Fable 5.1 review must cover the final checked package.
Previous reviews do not approve this future implementation.
Keep critical and high findings blocking. Disposition every other finding with evidence and an accountable decision.

## References

- [Current manager design](../../../openspec/changes/foredi-08-credential-manager/design.md)
- [Native lifecycle tasks](../../../openspec/changes/foredi-09-native-credential-lifecycle/tasks.md)
- [Latest correction evidence](../../releases/return-of-the-foredi/openbao-low-findings-2026-09-15.md)
- [Microsoft WSL systemd guidance](https://learn.microsoft.com/en-us/windows/wsl/systemd)
- [OpenBao Raft storage](https://openbao.org/docs/configuration/storage/raft/)
- [OpenBao Raft operations](https://openbao.org/docs/commands/operator/raft/)
