# GPT-6 Astra audit, round 2

Requested model: `gpt-6-astra` via `codex exec --sandbox read-only -c model_reasoning_effort=high` on 2026-09-05. Observed model id: unknown (self-report only). Audited commit: `4501423`.

# GPT-6 Astra audit of the v0.5 release plan, round 2

## Verdict

BLOCKED

The rework resolves several round-1 defects, including verdict vocabularies, adapter diagnostics, and the pre-publication predicate cycle. The plan still contains incompatible family requirements, insufficient file scopes, and build assumptions that prevent execution as written.

## Blocking findings

1. **v050-release-program — [“Package-level Endstop children”](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:167).** Recovery must run before bootstrap, but family activation during bootstrap must precede every other child action. There are also twelve owner packages and thirteen children, while the scenario requires thirteen distinct package identifiers. Bootstrap and release both belong to `v050-release-program`. Existing coverage rejects duplicate package identifiers at [release-coverage-cli.ts:1062](/home/charl/foreman/packages/orchestration/src/release-coverage-cli.ts:1062) and requires exactly one child per owner at [line 1252](/home/charl/foreman/packages/orchestration/src/release-coverage-cli.ts:1252). **Fix:** explicitly authorize recovery and authority bootstrap under the root contract before activation, as the v0.4 bootstrap exception did. Register only subsequent children, or specify and test storage and lookup for multiple children belonging to one package.

2. **v050-release-program / lane-runtime-typescript / session-store-recovery — allowed file scopes.** The governor permits reconciliation of `tasks.md`, but excludes the dependent specifications whose Bash ownership requirements must change. It also excludes other packages’ `release-brief.json` files and the archive destination required by task 1.7. The lane owner adds `lane-watch.js` but cannot edit `scripts/verify-runtime.ts`, whose exact artifact list rejects that addition at [line 196](/home/charl/foreman/scripts/verify-runtime.ts:196). Recovery requires rebuilt artifacts but excludes runtime outputs from its [scope](/home/charl/foreman/openspec/changes/session-store-recovery/tasks.md:1). Finally, the declared scopes contain globs such as `round-*.ts`, while the family path grammar accepts exact paths and terminal `/**` prefixes only at [execution-contract.ts:632](/home/charl/foreman/packages/orchestration/src/execution-contract.ts:632). **Fix:** complete each owner’s scope before approval. Include normative reconciliation, registered briefs, required generated artifacts, and verifier changes. Expand filename globs into exact registered paths.

3. **v050-release-program — [design.md:49](/home/charl/foreman/openspec/changes/v050-release-program/design.md:49) and [task 1.7](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:20).** The v0.4 suites cannot pass unchanged against the proposed repository. The authored-register test reads the live v040 package path at [release-coverage.test.ts:2417](/home/charl/foreman/packages/policy/src/release-coverage.test.ts:2417) and asserts a fixed active-inventory digest at [line 2436](/home/charl/foreman/packages/policy/src/release-coverage.test.ts:2436). The four new packages invalidate that digest. Archiving v040 then removes the file the test reads. **Fix:** preserve v040 behavioral cases against frozen historical authority inputs. Explicitly permit fixture-loading changes and add separate v050 repository-integration cases. Reconcile the register and inventory digest when archiving.

4. **build-determinism — [“Installed tree matches the lockfile”](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:17).** Excluding only the root tuple does not make the two lockfiles comparable. On this Linux x64 checkout, 75 of the repository’s 161 non-root entries are absent from the installed lockfile. The repository includes optional packages for other platforms, such as [AIX esbuild](/home/charl/foreman/package-lock.json:77). Every tuple present in both lockfiles matched in my comparison. The proposed rule therefore rejects legitimate platform-specific installations and prevents P9’s successful arm. **Fix:** define the expected installed dependency set for the recorded platform and install configuration, including optional dependencies and workspace links. Test legitimate omissions separately from missing required packages and changed tuples.

5. **launcher-node-port — governor [task 3.2](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:34).** Deleting `launcher/src/posix*.ts` breaks the retained Windows launcher’s source dependency graph. [launch.ts:20](/home/charl/foreman/launcher/src/launch.ts:20) imports `./posix`, and [supervise.ts:24](/home/charl/foreman/launcher/src/supervise.ts:24) does likewise. The Windows build compiles that entry point at [build.ps1:28](/home/charl/foreman/launcher/build.ps1:28). **Fix:** retire POSIX build and selection paths while retaining shared source required by Windows, or specify deletion-only dependency cleanup. Require a Windows rebuild check. Adjust P2 to measure the chosen retirement boundary.

## Non-blocking findings

1. **All four new specifications — EARS atomicity and conditions.** Several sentences still combine independent responses. Examples include source selection and stale marking in [release-program/spec.md:41](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:41), probe execution and record reading in [lane-runtime/spec.md:80](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:80), and rename and rebuild in [session-store/spec.md:40](/home/charl/foreman/openspec/changes/session-store-recovery/specs/session-store/spec.md:40). “WHEN the measured drift cause is removed” makes [path independence](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:49) conditional on declaring the fix complete. **Fix:** split observable responses. Trigger reproducibility on two builds with identical declared inputs. Qualify sidecar recovery with source availability and `Clean` scanning with an uncontaminated checkout.

2. **v050-release-program — coverage owner semantics.** All sixteen roadmap keys exist, but twelve register owner fields differ from their roadmap rows. For example, [ROADMAP.md:101](/home/charl/foreman/ROADMAP.md:101) names `council-review-plane`, while its register row names the governor. The current checker requires equality at [release-coverage.ts:975](/home/charl/foreman/packages/policy/src/release-coverage.ts:975). **Fix:** distinguish package ownership from release-disposition stewardship, or align the fields. Add a positive test using the actual v050 register and roadmap, beyond missing-row tests.

3. **v050-release-program / dependency packages — carried obligations and ordering.** The four assigned slices improve ownership, but their completion contracts remain incomplete. Evidence contracts still adopt broader positive-control requirements at [spec.md:370](/home/charl/foreman/openspec/changes/evidence-contracts/specs/evidence-contracts/spec.md:370). Doctrine requires the shared mutation mechanism at [spec.md:90](/home/charl/foreman/openspec/changes/doctrine-reality-drift/specs/doctrine-integrity/spec.md:90), yet the [dependency graph](/home/charl/foreman/openspec/changes/v050-release-program/design.md:25) permits doctrine without an evidence-contracts milestone. The two resume dependency entries promise automatic closure without scheduling their hosted verification. **Fix:** map each retained obligation to a task and receipt. Add the evidence-contracts dependency to doctrine verification. Reconcile specifications as well as ledgers.

4. **v050-release-program — [exit predicates](/home/charl/foreman/openspec/changes/v050-release-program/design.md:89).** P8 and P9 remain procedures rather than complete reproducible commands. P8 can exercise only a healthy-store no-op after bootstrap repairs the reference host. P3 does not specify how final-candidate live evidence replaces earlier tranche receipts. P10’s live scan can skip through [secret-scan.test.ts:75](/home/charl/foreman/packages/orchestration/src/secret-scan.test.ts:75). P11 does not specify an invocation for its mutation result. **Fix:** provide bounded TypeScript measurement commands with fixtures, explicit executed-case counts, skip accounting, candidate identity, and external receipts. Supply the required family and repository arguments for task 8.4’s release command.

5. **v050-release-program — [predicate result vocabulary](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:221).** A measured failure is labeled `UNCOMPUTABLE`, although [line 240](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:240) reserves that value for measurements that cannot be made. **Fix:** record measured failures separately. Both failure classes must refuse publication.

6. **lane-runtime-typescript — [containment decision table](/home/charl/foreman/openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md:100).** `any` appears as both an input value and an apparent wildcard. The table does not explicitly cover `strong=true, require=strong`, or use its declared `record` input to distinguish absent launchers from missing records. The baseline skips containment admission entirely when no launcher resolves at [lane-run.sh:1152](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:1152). **Fix:** enumerate these cases and label intentional changes to baseline behavior. Specify malformed-record treatment for spawn flags.

7. **v050-release-program — publication precedent and closure evidence.** Reusing the v0.4 journal “unchanged” leaves its image-publication transition and signed-tag verification unresolved. Those appear at [v040 design.md:1012](/home/charl/foreman/openspec/changes/v040-release-program/design.md:1012). Also, tag existence cannot prove v040 task 6.3’s branch cleanup. **Fix:** explicitly retain or exclude each publication stage, preserve fast-forward and interruption guarantees, and require evidence appropriate to each completed task.

8. **v050-release-program — narrative and schedule.** The [narrative predicates](/home/charl/foreman/docs/superpowers/specs/2026-09-05-v050-release-design.md:46) still require full launcher-tree removal and mix verdict vocabularies. Its [package map](/home/charl/foreman/docs/superpowers/specs/2026-09-05-v050-release-design.md:60) still promises Windows parity. **Fix:** synchronize these with authoritative OpenSpec. Recovery-first and runtime-first ordering are sensible after the bootstrap defect is fixed. The single largest remaining schedule risk is migrating round ownership and the watchdog while preserving lifecycle behavior across platforms. The scope is plausible as one release after these execution boundaries are corrected.

## Coverage register review

[The register](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml) contains exactly 52 package entries and sixteen roadmap entries, without duplicate keys. Both recorded hashes match. Agreement below concerns disposition, not completed implementation.

| Package | Disposition | Agree or disagree | Reason |
|---|---|---|---|
| agy-lane-activation | v060 | Agree | Separate vendor expansion. |
| audit-groundedness-gate | v050_owner | Agree | Correct gate owner. |
| bounded-execution-terminal-policy | released_reference | Agree | No open checklist items. |
| build-determinism | v050_owner | Agree | Necessary host-evidence work. Correct the lockfile contract. |
| captured-facts-convergence | v050_dependency | Disagree | Worked-example verification is not explicitly scheduled. |
| council-review-plane | v060 | Agree | Roadmap release assignment now matches. |
| council-v029-preflight-release | released_reference | Agree | Protected historical reference. |
| credential-profile-authority | v050_dependency | Agree | Leasing can move. Other residual tasks need evidence before closure. |
| crlf-extensionless-hardening | v050_dependency | Agree | Bootstrap reconciliation owns remaining verification. |
| decision-lineage-and-telemetry | v050_dependency | Agree | Gate event-contract slice now has an owner. |
| doctrine-reality-drift | v050_owner | Agree | Add its shared-mechanism dependency. |
| evidence-contracts | v050_owner | Agree | Correct evidence owner. |
| external-memory-index | released_reference | Agree | No open checklist items. |
| foreman-discover-lane | v050_owner | Agree | Bounded exploratory-route documentation. |
| formal-model-suite | v060 | Agree | Expansion can wait. Existing formal gates remain required. |
| graph-context-builder | released_reference | Agree | No open checklist items. |
| graph-eval-falsification | released_reference | Agree | No open checklist items. |
| graph-store-port | v060 | Agree | Separable storage expansion. |
| grok-secret-scan-typescript | v060 | Agree | Broader shell migration exceeds the scan-bound fix. |
| hermetic-foreman-appliance | released_reference | Agree | No open checklist items. |
| knowledge-plane-refresh | released_reference | Agree | No open checklist items. |
| lane-ownership-and-reaping | v050_dependency | Agree | Runtime is the correct integration owner. |
| lane-runtime-typescript | v050_owner | Agree | Correct migration owner. |
| launcher-node-port | v050_owner | Agree | POSIX retirement fits, subject to Windows build preservation. |
| lock-primitive-hardening | v050_dependency | Agree | Narrow carry-over is defensible with explicit acceptance evidence. |
| node-typescript-runtime | v050_dependency | Agree | Partial migration assignment is explicit. |
| openspec-superpowers-convergence | released_reference | Agree | Established workflow authority. |
| profile-bound-lane-admission | released_reference | Agree | No open checklist items. |
| profile-bound-setup-preflight | v050_dependency | Agree | Leasing transfer is reasonable. Verify remaining admission closure. |
| profile-use-leasing | v060 | Agree | Defensible after dependent contracts are reconciled. |
| project-registry | released_reference | Agree | No open checklist items. |
| regression-harness-tiers | v060 | Agree | Unscheduled live-model qualification is now honestly deferred. |
| resume-count-events-typescript | v050_dependency | Disagree | `not_required` leaves hosted verification without an explicit task. |
| resume-safety-services-typescript | v050_dependency | Disagree | Same unresolved verification carry-over. |
| resume-supervisor-typescript | v050_dependency | Agree | Reconciliation is required. Add the promised hosted receipts. |
| round-ownership-default | v050_dependency | Agree | Runtime owner is appropriate after prerequisite reconciliation. |
| round-resume-typescript | v050_dependency | Agree | Must preserve round ownership through the new entry point. |
| session-store-recovery | v050_owner | Agree | Correct bounded recovery owner. |
| spec-triage-gate | v050_owner | Agree | Correct pre-dispatch admission owner. |
| test-infrastructure-hardening | v050_dependency | Disagree | Named mutation slice does not yet settle the broader adopted contract. |
| three-outcome-verdicts | v050_owner | Agree | Correct vocabulary owner. |
| v030-release-program | superseded | Agree | Supersession is explicit. |
| v040-release-program | released_reference | Agree | Publication reconciliation remains necessary before archive relocation. |
| v050-release-program | v050_owner | Agree | Correct governor. Family and scope defects remain. |
| vendor-adapter-contract | v050_dependency | Agree | Now explicitly included in reconciliation. |
| vendor-concurrency-and-quota | v060 | Agree | Broader quota policy is separable. |
| vendor-preflight | v050_dependency | Agree | Currency slice now has a runtime owner. |
| work-dag-projection | released_reference | Agree | No open checklist items. |
| workload-fit-accounting | v060 | Agree | Unscheduled authoring work is now deferred. |
| wsl-launcher-shipped | v050_dependency | Agree | Replace Bun verification with Node evidence. |
| wsl-preflight | v050_owner | Agree | Fits host-truth scope. |
| wsl-tool-path-persistence | v050_dependency | Agree | Explicitly folded into preflight. |

## Predicate review

“Yes” means the stated result can be falsified. It does not establish sufficient coverage or resistance to vacuous success.

| Predicate number | Falsifiable yes or no | Note |
|---|---|---|
| P1 | Yes | Build precedes policy. Explicitly assert both pin removals and adapter grammar acceptance. |
| P2 | Yes | Absence checks are measurable. Current deletion breaks the retained Windows build. |
| P3 | Yes | Correct nested tests are selected. Require final-candidate live execution and skip accounting. |
| P4 | Yes | Model rejection and harness-assigned `UNVERIFIED` are discriminating cases. |
| P5 | Yes | Ungrounded-audit refusal is measurable. |
| P6 | Yes | Empty successful process must produce `round_incomplete`. Cover each lane type. |
| P7 | Yes | Refusal before spawn and successful dispatch avoid the earlier help-text-only weakness. |
| P8 | No | Stateful procedure lacks fixed fixtures and complete commands. Healthy repair can pass without exercising repair. |
| P9 | No | Worktree setup and dependency installation are unspecified command fragments. Tuple contract also needs correction. |
| P10 | Yes | Scan assertion can fail, but live traversal can skip. Require an executed clean-checkout result. |
| P11 | Yes | Exit and claim count are observable. Mutation execution and the exact required inventory need explicit checks. |

## Round-1 findings status

1. **B1 — Resolved.** [Runtime-build specification](/home/charl/foreman/openspec/changes/build-determinism/specs/runtime-build/spec.md:57) separates “Scan selection,” “Bound violation report,” and “The checkout scans clean.” The unconditional bound-failure contradiction is removed.

2. **B2 — Resolved.** [“Verdict vocabularies are separate”](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:235) states `APPROVED | WARNING | BLOCKED`, harness-assigned `UNVERIFIED`, and measurement `UNCOMPUTABLE`. The narrative and measured-failure wording still need correction.

3. **B3 — Resolved.** [Design.md:103](/home/charl/foreman/openspec/changes/v050-release-program/design.md:103) states “Publication is not a predicate.” Separate admission and publication requirements now record the predecessor and use compare-and-set. Journal-stage clarification remains non-blocking.

4. **B4 — Resolved.** [Lane-runtime design.md:20](/home/charl/foreman/openspec/changes/lane-runtime-typescript/design.md:20) now requires `lane-round: node is required` and `lane-watch: node is required`, matching the grammar.

5. **B5 — Unresolved.** [“Program-parameterized release runtime”](/home/charl/foreman/openspec/changes/v050-release-program/specs/release-program/spec.md:51) now names the missing authorities. However, unchanged v040 repository-dependent tests remain incompatible with the new inventory and archive operation.

6. **B6 — Unresolved.** The new text requires children “bound to exactly one `packageId`.” It still creates a bootstrap cycle and demands thirteen distinct package identifiers from twelve owner packages.

7. **B7 — Unresolved.** All four `.openspec.yaml` files now exist with appropriate schemas. The new allowed scopes still exclude necessary artifacts and verifier changes, and contain patterns the registered grammar rejects.

8. **B8 — Unresolved.** [The slice table](/home/charl/foreman/openspec/changes/v050-release-program/design.md:69) assigns four retained dependencies, and leasing tasks are explicitly transferred. Broader adopted positive-control requirements and the doctrine dependency are not yet fully reconciled.

9. **B9 — Unresolved.** [Task 1.6](/home/charl/foreman/openspec/changes/v050-release-program/tasks.md:19) now says “Reconcile every entry with `reconcile = "required"`.” Task 2.1 also names both omitted runtime dependencies. However, reconciliation is limited to task ledgers, excluding normative specifications and some carried verification obligations.

10. **B10 — Unresolved.** Task 2.2 now dispatches tasks 1–7, P3 selects `lane-runtime/*.test.ts`, and task 3.2 adds compiled-Node compatibility tests. Final-candidate live requalification and explicit skip accounting remain unspecified.

## What I checked and found correct

- Read the round-1 audit and rework ledger first, then every requested plan file in full and all requested context sections.
- Audited plan files at commit `450142310aace0231e80aac26c69b823aa05e6b9`.
- Confirmed the baseline object and tree `a0c96ca2b45af293eb5dd7b1057fa91f2fb99894`.
- Independently verified all package identities, roadmap keys, and both hashes in [coverage.toml](/home/charl/foreman/openspec/changes/v050-release-program/coverage.toml).
- Confirmed appropriate workflow declarations against the [architectural](/home/charl/foreman/openspec/schemas/foreman-architectural/schema.yaml) and [bounded](/home/charl/foreman/openspec/schemas/foreman-bounded/schema.yaml) schemas.
- The [lane runtime design](/home/charl/foreman/openspec/changes/lane-runtime-typescript/design.md:15) correctly assigns process lifetimes and cancellation to Effect.
- Strong cleanup avoids signaling namespace-local process groups, consistent with [lane-run.sh:47](/home/charl/foreman/skills/foreman/scripts/lane-run.sh:47). Explicit `any`, approval recording, and spawn-time enforcement are substantially restored.
- The recovery plan now treats existing sidecar rehydration as a regression check and adds meaningful repair-failure and collision cases.
- No files were modified. I did not run builds, recovery, installations, or mutating test suites. The existing dirty-worktree entries remained unchanged.

## Model self-identification

GPT-6, running as Codex. This is a self-report, not identity evidence. I cannot independently verify the Astra variant from the session instructions.