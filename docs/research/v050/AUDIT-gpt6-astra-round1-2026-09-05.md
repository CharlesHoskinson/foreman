# GPT-6 Astra audit, round 1

Requested model: `gpt-6-astra` via `codex exec --sandbox read-only -c model_reasoning_effort=high` on 2026-09-05. Observed model id: unknown (the Codex event stream carried no model field; the self-report below is not identity evidence). Audited commit: `5bd4e1e`.

# GPT-6 Astra audit of the v0.5 release plan

## Verdict

BLOCKED

The release plan contains contradictory requirements, incomplete runtime assumptions, and deferrals that block active owners. The release theme is coherent, but implementation should wait for corrected admission contracts, reconciled dependencies, and executable acceptance predicates.

## Blocking findings

1. **build-determinism — [specs/runtime-build/spec.md:36](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:36).** The requirement unconditionally demands `bound_exceeded` whenever scanning starts, then demands `Clean`. It also combines path selection and failure reporting in one sentence. **Fix:** separate requirements for scan selection, bound violations, and successful completion. Define `Clean` against a specified clean candidate and preserve secret-file detection when excluding ignored build artifacts.

2. **v050-release-program / three-outcome-verdicts — [design.md:67](/home/charl/foreman/openspec/changes/v050-release-program/design.md:67).** Predicate 4 says “the schema” accepts `UNVERIFIED` and `UNCOMPUTABLE`. The owner explicitly restricts the model-facing schema to three judgments and assigns `UNVERIFIED` through the harness. Uncomputable evidence produces `UNVERIFIED`, not another audit verdict. See [audit-verdict/spec.md:24](/home/charl/foreman/openspec/changes/three-outcome-verdicts/specs/audit-verdict/spec.md:24) and [tasks.md:60](/home/charl/foreman/openspec/changes/three-outcome-verdicts/tasks.md:60). **Fix:** name separate model-verdict, harness-result, and predicate-measurement schemas. Specify each vocabulary and conversion.

3. **v050-release-program — [specs/release-program/spec.md:151](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:151).** Publication stops when remote `main` differs from the candidate, although an ordinary fast-forward starts with different commits. The failure scenario instead tests ancestry. Predicate 8 requires the tag before task 8.5 creates it. **Fix:** separate pre-publication admission from post-publication verification. Bind the expected remote predecessor, compare-and-set the push, then verify the annotated tag’s target and release body. Preserve the v0.4 publication journal and interruption recovery, or explicitly specify their replacement.

4. **lane-runtime-typescript — “Round ownership in the runtime,” [spec.md:23](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:23).** The required missing-Node diagnostic is `lane-run: node is required`, but the mandated bundle is `lane-round.js`. The closed adapter grammar derives the diagnostic prefix from the bundle basename. See [architecture-adapter.ts:251](/home/charl/foreman/packages/policy/src/architecture-adapter.ts:251). **Fix:** require `lane-round: node is required`, or explicitly authorize and test a narrow grammar change. The present requirements cannot both pass.

5. **v050-release-program — [tasks.md:4](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:4).** Changing the three named modules does not enable v050 admission. Additional fixed authorities include `PROGRAM` and bootstrap owner in [release-coverage-cli.ts:50](/home/charl/foreman/packages/orchestration/src/release-coverage-cli.ts:50), receipt program types in [release-authority.ts:12](/home/charl/foreman/packages/policy/src/release-authority.ts:12), and CLI rejection in [release-admission-cli.ts:135](/home/charl/foreman/packages/policy/src/release-admission-cli.ts:135). Coverage also validates the v0.4 baseline, roadmap rows, and disposition combinations. **Fix:** inventory and parameterize every parser, receipt, evaluator, and CLI boundary. Define v2 register cross-field rules, roadmap handling, bootstrap ownership, and unknown-program diagnostics. Add end-to-end admission tests while retaining v040 behavior.

6. **v050-release-program — “One Endstop family,” [spec.md:101](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:101).** Eight tranche children cannot directly represent the proposed multiple owners per tranche under the existing contract. Each child binds one `packageId`, and policy rejects another owner with `wrong_package`. See [execution-contract.ts:315](/home/charl/foreman/packages/orchestration/src/execution-contract.ts:315) and [release-policy.ts:311](/home/charl/foreman/packages/orchestration/src/release-policy.ts:311). The family also hardcodes v040 and tranches 2–9. **Fix:** specify package-level children or a tested multi-package child contract. Define bootstrap-before-activation, immutable child identities, budgets, milestones, and allowed paths. Do not describe this as an unchanged v0.4 topology.

7. **All four new packages — workflow admission and task scope.** None contains `.openspec.yaml`, although coverage reads that file and rejects missing workflow metadata. See [release-coverage-cli.ts:1188](/home/charl/foreman/packages/orchestration/src/release-coverage-cli.ts:1188) and [release-coverage.ts:1034](/home/charl/foreman/packages/policy/src/release-coverage.ts:1034). The governor has no allowed-file scope. The lane scope excludes its required research receipts and generated runtime manifest. **Fix:** declare architectural workflows for the governor and lane runtime, bounded workflows for recovery and build determinism, and complete their allowed scopes. Supply exact verification commands and registered family briefs before dispatch.

8. **v050-release-program — deferred dependency conflicts in coverage.toml.** Several v0.6 assignments block v0.5 obligations:
   - Lock hardening is an explicit prerequisite of [round-ownership-default/tasks.md:6](/home/charl/foreman/openspec/changes/round-ownership-default/tasks.md:6).
   - Evidence contracts require test infrastructure beyond their own planted-write control at [spec.md:370](/home/charl/foreman/openspec/changes/evidence-contracts/specs/evidence-contracts/spec.md:370).
   - Doctrine requires that infrastructure’s mutation mechanism at [spec.md:90](/home/charl/foreman/openspec/changes/doctrine-reality-drift/specs/doctrine-integrity/spec.md:90).
   - Lane reaping assigns currency checking to vendor preflight at [tasks.md:50](/home/charl/foreman/openspec/changes/lane-ownership-and-reaping/tasks.md:50).
   - Credential and setup dependencies retain profile-use leasing at [credential-profile-authority/tasks.md:36](/home/charl/foreman/openspec/changes/credential-profile-authority/tasks.md:36) and [profile-bound-setup-preflight/tasks.md:34](/home/charl/foreman/openspec/changes/profile-bound-setup-preflight/tasks.md:34).

   **Fix:** assign each necessary slice to a v0.5 owner or reconcile the dependent requirement with evidence that the slice is unnecessary. Task-count reasons do not resolve these dependencies.

9. **v050-release-program — [tasks.md:13](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:13).** Tranche 2 reconciles three dependencies but leaves `node-typescript-runtime` and `vendor-adapter-contract` marked `required` under the same owner. Correct coverage enforcement therefore refuses dispatch. Other register promises lack execution tasks, including closing credential/setup obligations during bootstrap and reconciling v040 publication. **Fix:** add an explicit reconciliation task for every required entry and map each carried obligation to a task and receipt. Rewrite affected specifications as well as Bash-targeted task lists. Keep new logic and tests in TypeScript, including vendor-adapter and worker-dispatch integration.

10. **v050-release-program / lane-runtime-typescript / launcher-node-port — acceptance evidence.** The governor dispatches lane tasks 1–6, omitting live task 7 at [tasks.md:14](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:14). Predicate 3’s `round*.test.ts` glob excludes the new nested `lane-runtime` tests. Launcher verification assumes `tests/launcher.bats` targets Node, but that suite builds Bun and selects Bun binaries at [launcher.bats:36](/home/charl/foreman/tests/launcher.bats:36) and [launcher.bats:57](/home/charl/foreman/tests/launcher.bats:57). **Fix:** include live task 7, select the new tests explicitly, and provide TypeScript launcher compatibility tests against the compiled Node bundle. Require executed strong-containment cases, with candidate-bound receipts and explicit skip accounting. Historical receipts cannot prove the rewritten runtime.

## Non-blocking findings

1. **All new specifications — requirement atomicity.** Several EARS-shaped sentences hide independently testable obligations: baseline verification and recording, register and predicate selection, adapter forwarding operations, recovery and summary output, and dependency checks. Examples: [release-program/spec.md:9](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:9), [lane-runtime/spec.md:9](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:9), and [session-store/spec.md:7](/home/charl/foreman/openspec/changes/session-store-recovery/specs/session-store/spec.md:7). **Fix:** give each observable response its own requirement sentence and scenario. Rewrite the nested `WHILE … IF … THEN` containment clause as one explicit Boolean condition.

2. **lane-runtime-typescript — [tasks.md:12](/home/charl/foreman/openspec/changes/lane-runtime-typescript/tasks.md:12).** A newly written report with the wrong attempt can pass the baseline freshness rule through its modification time. The code accepts fresh mtime **or** a matching attempt at [lane-run.sh:1532](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:1532). **Fix:** specify an old mtime in the parity fixture, or explicitly assign stricter attempt binding to the verdict tranche.

3. **lane-runtime-typescript — “Containment policy in the runtime,” [spec.md:46](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:46).** The plan omits important remedy details: approval recording, spawn-time strong enforcement, and treatment of missing launchers or malformed probe output. It also changes the explicit `FOREMAN_CONTAINMENT_REQUIRE=any` behavior when `LANE_VENDOR` is set. See [lane-run.sh:1172](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:1172). **Fix:** specify the complete decision table and distinguish intentional tightening from parity. Preserve spawn-time enforcement, not only a preliminary probe.

4. **session-store-recovery — [tasks.md:11](/home/charl/foreman/openspec/changes/session-store-recovery/tasks.md:11).** The proposed missing-store RED case already has an implementation: [session-sqlite-bootstrap.ts:154](/home/charl/foreman/packages/orchestration/src/session-sqlite-bootstrap.ts:154) creates the store and rehydrates it. **Fix:** retain this as a regression check. Target new failing cases at `repair`, absent source refusal, and actionable diagnostics. Add repair failure and backup-collision cases.

5. **build-determinism — “Dependency tree identity” and [tasks.md:10](/home/charl/foreman/openspec/changes/build-determinism/tasks.md:10).** “Matches” is undefined. The installed hidden lockfile differs structurally from the repository lockfile, including omission of the root package. Also, verification already builds into two temporary output directories, while `buildTo` keeps the repository source root fixed. No esbuild metafile is enabled. See [verify-runtime.ts:202](/home/charl/foreman/scripts/verify-runtime.ts:202) and [build-runtime.ts:270](/home/charl/foreman/scripts/build-runtime.ts:270). **Fix:** define semantic dependency comparison and mismatch controls. Test two independent source checkouts and identify the actual differing bundle bytes before prescribing metadata stripping.

6. **v050-release-program — ordering and schedule risk, [design.md:18](/home/charl/foreman/openspec/changes/v050-release-program/design.md:18).** Runtime-first integration is sensible, but Windows Job Object parity is the single largest schedule risk. The Node package currently exposes only `windows_job_object_unavailable` at [capability.ts:9](/home/charl/foreman/packages/launcher/src/capability.ts:9). No replacement binding or native qualification plan is specified. **Fix:** resolve that design during bootstrap and begin qualification early. Move recovery ahead of SessionDB-dependent bootstrap if the documented corrupt store remains the authority source. Reconcile strict tranche ordering with the parallel dependency graph. The scope is plausible as one release after these boundaries are fixed, but it is not presently a bounded shipping plan.

7. **v050-release-program — [coverage.toml:339](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml:339).** “Closes at release verification” understates some work. Regression-harness completion requires live-model seeded-spec qualification at [tasks.md:76](/home/charl/foreman/openspec/changes/regression-harness-tiers/tasks.md:76). Workload-fit accounting still needs doctrine and ledger work. **Fix:** schedule these explicitly or defer them. Reconcile `ROADMAP.md` assignments that still place Council and formal work in v0.5.

8. **v050-release-program — historical claims.** The narrative describes eight tranches as the v0.4 shape, but v0.4 had nine tranches with eight post-bootstrap children. It also states that this audit and rework already exist at [release-design.md:74](/home/charl/foreman/docs/superpowers/specs/2026-09-05-v050-release-design.md:74). No audit artifact was present there during this review. **Fix:** correct the precedent description and record audit completion only after its artifact exists.

## Coverage register review

All **52 directories have exactly one entry**. Both recorded SHA-256 digests match. “Agree” below concerns assignment, not implementation completion.

| Package | Disposition | Agree or disagree | Reason |
|---|---|---|---|
| agy-lane-activation | v060 | Agree | Separate vendor expansion. |
| audit-groundedness-gate | v050_owner | Agree | Core verdict objective. Reconcile event dependencies. |
| bounded-execution-terminal-policy | released_reference | Agree | Completed ledger supports reference status. |
| build-determinism | v050_owner | Agree | Required host-evidence work. |
| captured-facts-convergence | v050_dependency | Agree | Recovery can supply the worked example. |
| council-review-plane | v060 | Agree | Separate runtime expansion. Update roadmap assignments. |
| council-v029-preflight-release | released_reference | Agree | Protected reference is correctly identified. |
| credential-profile-authority | v050_dependency | Disagree | Open leasing work conflicts with its deferral. |
| crlf-extensionless-hardening | v050_dependency | Agree | Verification carry-over is bounded. Add its task. |
| decision-lineage-and-telemetry | v060 | Disagree | Groundedness consumes its event contracts. Define the retained slice first. |
| doctrine-reality-drift | v050_owner | Agree | Fits release objective, subject to prerequisite reconciliation. |
| evidence-contracts | v050_owner | Agree | Central to honest lane results. |
| external-memory-index | released_reference | Agree | Completed ledger supports reference status. |
| foreman-discover-lane | v050_owner | Agree | Documentation scope is bounded. |
| formal-model-suite | v060 | Agree | Broad expansion can wait. Existing formal gates remain required. |
| graph-context-builder | released_reference | Agree | Completed ledger supports reference status. |
| graph-eval-falsification | released_reference | Agree | Completed ledger supports reference status. |
| graph-store-port | v060 | Agree | Broader storage work is separable. |
| grok-secret-scan-typescript | v050_dependency | Disagree | “Port remaining shell product modules” exceeds the scan-bound fix. |
| hermetic-foreman-appliance | released_reference | Agree | Completed ledger supports reference status. |
| knowledge-plane-refresh | released_reference | Agree | Completed ledger supports reference status. |
| lane-ownership-and-reaping | v050_dependency | Agree | Runtime owner is appropriate. Resolve currency-check dependency. |
| lane-runtime-typescript | v050_owner | Agree | Correct owner for process migration. |
| launcher-node-port | v050_owner | Agree | Correct owner, but follow-on scope needs a real design. |
| lock-primitive-hardening | v060 | Disagree | Explicit prerequisite of round ownership. |
| node-typescript-runtime | v050_dependency | Agree | Partial release assignment is reasonable after task-level reconciliation. |
| openspec-superpowers-convergence | released_reference | Agree | Completed workflow precedent. |
| profile-bound-lane-admission | released_reference | Agree | Completed ledger supports reference status. |
| profile-bound-setup-preflight | v050_dependency | Disagree | Remaining leasing task contradicts v0.6 deferral. |
| profile-use-leasing | v060 | Disagree | Claimed bootstrap completions still require it. |
| project-registry | released_reference | Agree | Completed ledger supports reference status. |
| regression-harness-tiers | v050_dependency | Disagree | Live qualification is unscheduled, not routine verification. |
| resume-count-events-typescript | v050_dependency | Agree | Runtime integration is the appropriate reconciliation point. |
| resume-safety-services-typescript | v050_dependency | Agree | Runtime integration is the appropriate reconciliation point. |
| resume-supervisor-typescript | v050_dependency | Agree | Needs explicit audit and hosted evidence tasks. |
| round-ownership-default | v050_dependency | Agree | Appropriate owner, unresolved lock prerequisite. |
| round-resume-typescript | v050_dependency | Agree | Must integrate with the new round entry point. |
| session-store-recovery | v050_owner | Agree | Bounded recovery responsibility. |
| spec-triage-gate | v050_owner | Agree | Appropriate exploratory-route owner. |
| test-infrastructure-hardening | v060 | Disagree | Evidence and doctrine require portions of it. |
| three-outcome-verdicts | v050_owner | Agree | Correct vocabulary owner. |
| v030-release-program | superseded | Agree | Supersession is explicit. |
| v040-release-program | released_reference | Agree | Publication reconciliation remains required. |
| v050-release-program | v050_owner | Agree | Correct release governor. |
| vendor-adapter-contract | v050_dependency | Agree | Required interface owner, currently omitted from tranche-2 reconciliation. |
| vendor-concurrency-and-quota | v060 | Agree | Broader quota policy is separable. |
| vendor-preflight | v060 | Disagree | Lane-reaping currency checks still depend on it. |
| work-dag-projection | released_reference | Agree | Completed ledger supports reference status. |
| workload-fit-accounting | v050_dependency | Disagree | Remaining authoring work has no scheduled owner task. |
| wsl-launcher-shipped | v050_dependency | Agree | Superseded verification must be replaced with Node evidence. |
| wsl-preflight | v050_owner | Agree | Fits host-truth scope. |
| wsl-tool-path-persistence | v050_dependency | Agree | Appropriate preflight dependency. |

## Predicate review

“Falsifiable” means an observable failure exists. It does not mean the measurement sufficiently proves the release claim.

| Predicate number | Falsifiable yes or no | Note |
|---|---|---|
| 1 | Yes | Policy and pin absence are measurable. Require explicit adapter-grammar checks and rebuild before checking compiled policy. |
| 2 | Yes | `grep -c` prints `0` but exits 1 when no match exists. Directory removal does not prove launcher parity. Add live Node evidence. |
| 3 | Yes | Existing tests can fail, but the glob excludes new runtime tests. Missing live task 7 leaves containment insufficiently measured. |
| 4 | Yes | Empty globs fail through `run-tests.ts`, so they do not silently pass. Schema ambiguity and missing groundedness checks make the predicate inadequate. |
| 5 | Yes | Help output and file existence can pass with no dispatch enforcement. Test refusal before spawn and successful determined-spec dispatch. |
| 6 | No | This is an incomplete procedure, not one specified command. Define fixtures, build prerequisites, bounds, and expected records. Add WSL, lock mismatch, and path-independence checks. |
| 7 | Yes | Exit status is measurable. Require a frozen, nonempty claims inventory and mutation evidence to exclude an ineffective checker. |
| 8 | Yes | Tag absence falsifies it, but it is circular before publication. Tag listing also succeeds when empty and does not bind the candidate. Separate publication verification. |

## What I checked and found correct

- Read every requested plan file in full, the specified context files, and containment sections D1 and D7.
- Audited commit `5bd4e1e8c54e3e91bb3d080486f3f3ef860589f9`. The declared baseline `00c342bd449948ab2ea5ca0b9d0c890614dd81d6` exists and includes the approved containment experiments.
- Verified all 52 register identities and both digests in [coverage.toml](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml).
- Confirmed that both policy pins and `inspectLaneRunMigrationAdapter` exist at [architecture-adapter.ts:64](/home/charl/foreman/packages/policy/src/architecture-adapter.ts:64).
- The proposed TypeScript runtime ownership and Effect scopes follow [AGENTS.md](/home/charl/foreman/AGENTS.md) and [lane-runtime/design.md:15](/home/charl/foreman/openspec/changes/lane-runtime-typescript/design.md:15).
- Strong-containment cleanup correctly avoids externally signaling namespace-local process groups. This matches [lane-run.sh:825](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:825) and the recorded [strong-round experiment](/home/charl/foreman/docs/research/foreman-pidns-degradation-2026-09-05.md:506).
- The design correctly retains `tasks.md` as the active implementation plan and rejects replacement Endstop children without authorization.
- All work was read-only. I did not modify files or run mutating build, recovery, or test commands.

## Model self-identification

GPT-6, running as Codex. This is a self-report, not identity evidence. I cannot independently verify the Astra variant from the session instructions.