# OpenBao WSL and Linux Production Sprint Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after design review and task-brief approval.

**Goal:** Deliver the production credential foundation and a gated import/readback beta on both WSL and Linux.

**Architecture:** OpenBao owns durable managed credentials and lifecycle state. One host-only manager serves the existing Foreman commands and provider composition. Platform profiles share security gates and have separate service-lifecycle qualification.

**Tech Stack:** Node.js 24, strict TypeScript, Effect, OpenBao with Raft storage, systemd, OpenSpec, and the existing PEL owner.

## Global constraints

- WSL and Linux are both production targets.
- No production profile may use the synthetic dev server.
- OpenBao is the sole durable authority for managed credentials and lifecycle state.
- No managed fallback to native files, environment credentials, cached material, or another account is permitted.
- Keep bootstrap authority outside its own OpenBao dependency cycle.
- Keep credential material out of PEL, model prompts, logs, receipts, command arguments, and the Obsidian vault.
- Preserve concurrent native-login changes. Coordinate ownership before editing shared files.
- Do not install services, interrupt hosts, import accounts, refresh tokens, revoke accounts, or publish during planning.
- Do not make commits without separate authorization.
- Treat historical test counts as historical measurements. Re-run candidate-scoped checks during execution.

## Planning status and approval boundary

This is a sprint backlog and acceptance plan, not a code-complete task implementation brief.
Review the [platform design](../specs/2026-09-15-openbao-production-platforms-design.md) before dispatching implementation.
The user's platform decision supersedes the earlier suggestion that WSL is beta-only.
Task 0 produces reviewed interface contracts and bounded TDD implementation briefs for each subsystem.
No worker may infer an unreviewed interface or execute the entire sprint from this backlog alone.

## Schedule and dependencies

| Window | Track A | Track B | Gate |
| --- | --- | --- | --- |
| Days 1–2 | Task 0 architecture and contract reconciliation | Read-only platform and provider capability inventory | Approved task interfaces and host test scope |
| Days 3–4 | Task 1 platform service and trust qualification | Task 2 lifecycle manager | Independent task tests and review |
| Days 5–6 | Task 3 operator commands | Task 4 provider ownership and adapter controls | Accepted manager dependency |
| Days 7–8 | Task 5 Foreman integration and full pilot | Platform failure and backup rehearsal fixtures | Complete synthetic evidence |
| Days 9–10 | Task 6 candidate review and controlled readback | Operational runbooks and qualification receipts | Account-specific live admission |

Two implementation tracks and an independent reviewer are the capacity assumption.
Run one reviewable task per worker. Do not allocate the same writable files to parallel workers.
If capacity or provider support is insufficient, defer live qualification before reducing security requirements.
Preserve the all-provider release blocker for any deferred provider.

## Task 0: Reconcile specifications and executable task contracts

Owner: Architect. Dependencies: User review of the platform design.

Files to reconcile:

- `openspec/changes/foredi-08-credential-manager/{design.md,tasks.md,specs/foredi-08-credential-manager/spec.md}`
- `openspec/changes/foredi-09-native-credential-lifecycle/{design.md,tasks.md,specs/foredi-09-native-credential-lifecycle/spec.md}`
- `openspec/changes/openbao-credential-pilot/{design.md,tasks.md,specs/openbao-credential-pilot/spec.md}`
- `openspec/changes/foredi-10-release-closure/specs/foredi-10-release-closure/spec.md`
- `openspec/changes/foredi-11-pel-release-loop/specs/foredi-11-pel-release-loop/spec.md`
- `docs/superpowers/plans/2026-09-15-openbao-authority.md`

- [ ] Map PROD01–PROD12 to existing requirement IDs and exact test targets.
- [ ] Replace the old manager brief's raw-version removal contract with the approved managed lifecycle contract.
- [ ] Specify schema-version migration without silently interpreting existing schema 1 records as managed schema 2 accounts.
- [ ] Define typed ports for current metadata, lifecycle mutation, operation authorization, readiness, and sanitized evidence.
- [ ] Define separate command semantics for readback, lifecycle recovery, provider revocation, and historical maintenance.
- [ ] Define platform-specific startup ownership, backup custody, and recovery objectives before service configuration.
- [ ] Record exact source account selection and capability requirements without reading credential values.
- [ ] Write one bounded implementation brief per accepted subsystem, including interfaces, failing tests, implementation steps, and verification commands.

Acceptance: Strict OpenSpec validation passes. Each requirement has a test owner. Contradictory legacy contracts cannot be dispatched.

## Task 1: Persistent service, bootstrap, and platform qualification

Owner: Track A. Dependencies: Task 0.

Planned files:

- Create `packages/orchestration/src/openbao-deployment.ts` and `openbao-deployment.test.ts`.
- Create `packages/orchestration/src/openbao-readiness.ts` and `openbao-readiness.test.ts`.
- Create `deployment/openbao/openbao.hcl.example` and `deployment/openbao/openbao.service`.
- Create `docs/guides/pel/openbao-production-platforms.md`.
- Extend `packages/providers/src/credential-backend-identity.ts` only if the reviewed readiness contract requires it.

Consumes: Explicit host configuration and the existing immutable backend identity/store composition.
Produces: Closed readiness results bound to platform, candidate, trust, backend, mount, and effective policy.

- [ ] Test refusal of dev mode, untrusted TLS, unsafe storage paths, wrong ownership, and incomplete bootstrap configuration.
- [ ] Test separate runtime, maintenance, audit, and backup permissions using synthetic records.
- [ ] Test effective CAS, retention, expiration, and current deletion schedules.
- [ ] Test service restart and protected snapshot restore with synthetic material.
- [ ] Test audit-sink failure, full disk, expired bootstrap access, and unavailable storage without secret leakage.
- [ ] Produce separate WSL and Linux lifecycle receipts using approved interruption windows.

Acceptance: Both profiles pass security and durability gates. Missing host access leaves that platform unqualified.
Never emulate Linux production qualification solely inside WSL and label it a separate Linux-host test.

## Task 2: Authoritative lifecycle manager

Owner: Track B. Dependencies: Task 0. Real-server acceptance also depends on Task 1.

Planned files:

- Create `packages/providers/src/credential-manager.ts` and `credential-manager.test.ts`.
- Create `packages/providers/src/credential-lifecycle.ts` and `credential-lifecycle.test.ts`.
- Create `packages/providers/src/openbao-managed-store.ts` and `openbao-managed-store.test.ts`.
- Modify `packages/providers/src/index.ts` for reviewed production exports.

Consumes: Reviewed managed-store and authorization ports, exact backend identity, and readiness evidence.
Produces: `CredentialManagerPort` with create-only import, sanitized status, fresh resolve, managed deletion, and authorized lifecycle recovery.

- [ ] Prove schema rejection, account isolation, lazy authorization, deadline enforcement, and closed failures before integration.
- [ ] Prove active-to-tombstoned and authorized tombstoned-to-active CAS transitions across separate processes.
- [ ] Prove deletion-first, refresh-first, stale recovery, crash/restart, and administrative-deletion quarantine.
- [ ] Prove historical pruning does not change current lifecycle authority.
- [ ] Prove denied and unavailable operations trigger no native fallback or cached delivery.
- [ ] Keep refresh and revocation explicitly unsupported until a qualified adapter supplies their actual behavior.

Acceptance: Lifecycle state survives restart. No test substitutes raw soft deletion for managed deletion.

## Task 3: Safe operator commands

Owner: Track A. Dependencies: Task 2 interface acceptance and Task 1 trust configuration.

Planned files:

- Create `packages/orchestration/src/credential-cli.ts` and `credential-cli.test.ts`.
- Integrate the existing command dispatcher identified during Task 0. Do not create a parallel router.
- Modify `docs/guides/pel/openbao-credentials.md` after commands exist.

Consumes: Manager operations and private bounded input streams.
Produces: Candidate-bound sanitized command receipts with distinct refusal and completed-readback outcomes.

- [ ] Test status and list without credential material or refresh side effects.
- [ ] Test create-only import and private byte-for-byte readback comparison.
- [ ] Test oversized input, malformed records, wrong identity, duplicate import, denied maintenance, and interrupted input.
- [ ] Test that console output, error causes, journals, and command arguments contain no secret canaries.
- [ ] Test failures during evidence writing. Do not infer success from output-file existence.
- [ ] Test compiled commands from an unrelated directory against current-source artifacts.

Acceptance: Readback leaves source login files unchanged and emits no material or public credential digest.

## Task 4: Provider capabilities and refresh ownership

Owner: Track B. Dependencies: Task 0 contracts and Task 2 lifecycle authority.

Planned files:

- Create `packages/providers/src/credentials/codex.ts` and `codex.test.ts`.
- Create `packages/providers/src/credentials/claude.ts` and `claude.test.ts`.
- Create `packages/providers/src/credentials/agy.ts` and `agy.test.ts`.
- Create `packages/providers/src/credentials/grok.ts` and `grok.test.ts`.
- Create `packages/orchestration/src/credential-refresh-owner.ts` and `credential-refresh-owner.test.ts`.
- Create `packages/orchestration/src/credential-migration.ts` and `credential-migration.test.ts`.

Consumes: Provider-documented interfaces, exact selected accounts, and manager lifecycle capabilities.
Produces: Per-provider capability results and explicit migration eligibility.

- [ ] Inventory supported native authentication interfaces without assuming logged-in status implies export or refresh support.
- [ ] Test account identity, credential expiry, private delivery, and unsupported operations independently for each provider.
- [ ] Prove cross-process ownership before provider refresh begins.
- [ ] Test an owner crash after remote refresh but before durable commit.
- [ ] Require reconciliation for ambiguous refresh outcomes. Do not retry blindly after lease expiry.
- [ ] Refuse cutover when ordinary native sessions can remain competing refresh writers.
- [ ] Keep readback success separate from provider authentication and managed execution qualification.

Acceptance: Each provider has an evidence-backed capability result. Unsupported required capabilities block that provider's release admission.

## Task 5: Foreman integration and complete synthetic pilot

Owner: Assigned integration worker. Dependencies: Tasks 1–4 accepted interfaces.

Files:

- Modify `packages/orchestration/src/pel-provider-live.ts` and its focused tests after coordinating concurrent ownership.
- Modify `packages/orchestration/src/foreman-setup.ts` and `foreman-setup.test.ts` where shared manager selection requires it.
- Modify `scripts/openbao-pilot.ts`, `scripts/openbao-pilot.test.ts`, and `scripts/openbao-pilot-worker.ts`.
- Add focused TypeScript tests under `scripts/openbao-pilot/` for remaining P04/P07/P08/P09/P11 scenarios.
- Modify `examples/pel/foredi-release-completion.pel` only after host gate contracts are validated.

Consumes: Accepted manager, readiness, command, and provider capability contracts.
Produces: Full synthetic pilot evidence and managed setup/execution through one authority.

- [ ] Prove setup, qualification, and execution use the same backend, reference, and current generation.
- [ ] Populate alternate native files and environment tokens with canaries, then prove zero fallback reads and zero unauthorized launches.
- [ ] Integrate the compiled fake worker and test its success, refusal, crash, and leakage boundaries.
- [ ] Complete all eleven pilot scenarios without converting skips or not-run results into passes.
- [ ] Test stale packaged artifacts, changed candidates, malformed receipts, and incomplete evidence validation.
- [ ] Reuse the existing PEL owner, journal, and Endstop authority.
- [ ] Enforce two correction rounds, no-change stop, and missing-authority refusal across resume.

Acceptance: P01–P11 pass on the checked candidate. Production readiness still requires separate platform and account evidence.

## Task 6: Independent review, recovery rehearsal, and gated live readback

Owner: Independent reviewer and authorized operator. Dependencies: Tasks 1–5 accepted.

Records:

- Create `docs/releases/return-of-the-foredi/openbao-production-readiness.md`.
- Update `docs/releases/return-of-the-foredi/RELEASE-NOTES.md` only with measured capabilities.
- Update `dependencies/README.md` and `env/reference-manifest.toml` with qualified dependencies and platform requirements.

- [ ] Freeze the candidate and bind the final exact Fable 5.1 audit to its files and verification receipts.
- [ ] Preserve all findings. Do not substitute a model or treat standalone advisory review as admitted release authority.
- [ ] Rehearse protected backup restoration with synthetic credentials and blocked provider traffic.
- [ ] Record platform-specific recovery duration and data-loss bounds against the approved operational objectives.
- [ ] Obtain approval for exact live backend, provider, account, and readback operation.
- [ ] Import one approved account with create-only semantics, then compare recovered material privately.
- [ ] Stop on identity mismatch, stale source, conflict, changed backend, or missing readiness.
- [ ] Keep live refresh, source-file modification, provider revocation, and cutover outside readback authorization.

Acceptance: WSL and Linux have separate production-readiness results. Every tested account has a sanitized operation receipt.
No live operation is permitted solely because the sprint deadline has arrived.

## Verification commands and expected results

Use the repository root for these existing validation commands:

```text
npm run typecheck
openspec validate openbao-credential-pilot --strict
openspec validate foredi-08-credential-manager --strict
openspec validate foredi-09-native-credential-lifecycle --strict
openspec validate foredi-10-release-closure --strict
openspec validate foredi-11-pel-release-loop --strict
git diff --check
```

Expected result: Each command exits zero on the reviewed candidate.
Task implementation briefs must add exact focused and packaged test commands before dispatch.
Platform tests must record actual host identity and observed results. Unexecuted platform scenarios remain not-run.
Build into candidate-owned output paths. Do not overwrite the installed runtime to perform verification.

## Definition of done

- [ ] WSL and Linux pass the common production gates and their distinct lifecycle tests.
- [ ] Managed import, readback, deletion, and recovery satisfy reviewed authorization and lifecycle contracts.
- [ ] No secret canary reaches a worker boundary, model prompt, log, receipt, or vault note outside its approved private delivery channel.
- [ ] Full pilot and packaged consumer tests pass with candidate-bound evidence.
- [ ] Backup restoration succeeds without automatic stale-token use.
- [ ] Exact Fable 5.1 review and required Foreman release authority are recorded separately.
- [ ] Every unsupported provider or missing operational prerequisite remains an explicit release blocker.
- [ ] Operator commands, dependency records, and recovery runbooks match delivered behavior.

The sprint can deliver an accepted foundation without authorizing all-provider production cutover.
The complete product release cannot claim all-provider support until every required provider passes its native gates.
