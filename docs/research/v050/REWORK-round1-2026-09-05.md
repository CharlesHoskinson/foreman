# Rework after GPT-6 Astra audit round 1

Every finding was verified against the cited file and line before any change.
All ten blocking findings reproduced. All eight non-blocking findings reproduced.

| Finding | Verified where | Change |
|---|---|---|
| B1 scan requirement contradicts itself | `build-determinism/specs/runtime-build/spec.md` | Split into selection, bound violation, and clean-checkout requirements. Untracked non-ignored secrets stay detected. |
| B2 predicate 4 misnames the schema | `three-outcome-verdicts/specs/audit-verdict/spec.md:24` | New requirement "Verdict vocabularies are separate". Predicates P4 to P6 test each vocabulary in its own schema. |
| B3 publication contradicts fast-forward | `v050-release-program/specs/release-program/spec.md` | Split into pre-publication admission (compare-and-set against a recorded predecessor, v0.4 journal reused) and post-publication verification. Publication is no longer a predicate. |
| B4 adapter diagnostic prefix | `architecture-adapter.ts:251` | Diagnostics are `lane-round: node is required` and `lane-watch: node is required`. |
| B5 more `v040` authorities | `release-coverage-cli.ts:50`, `release-authority.ts:12`, `release-admission-cli.ts:135`, `execution-contract.ts:315` | Requirement lists every authority. Bootstrap tasks add RED cases at each boundary. |
| B6 children per tranche | `execution-contract.ts:315`, `release-policy.ts:311` | Thirteen package-level children, one `packageId` each, dependency child ids, allowed paths, bootstrap-before-activation. |
| B7 no `.openspec.yaml`, no governor scope | `release-coverage-cli.ts:1188`, `release-coverage.ts:1034` | Added `.openspec.yaml` to all four packages, an allowed file scope to the governor, and a "Workflow declaration" requirement. |
| B8 deferrals block owners | six task and spec lines | Four deferred packages now carry one slice each into a v0.5 owner. Two credential packages move their leasing tasks to `profile-use-leasing` and close. Three packages with unscheduled work move to v0.6. |
| B9 reconciliation gaps | `v050-release-program/tasks.md` | Task 1.6 enumerates every `reconcile = "required"` entry. Tranche 2 reconciles `node-typescript-runtime` and `vendor-adapter-contract`. Task 1.7 ticks v0.4 publication. |
| B10 acceptance evidence | `tests/launcher.bats:36`, task globs | Lane task 7 is dispatched and produces candidate-bound receipts. P3 names the `lane-runtime` tests. Launcher retirement adds TypeScript compatibility tests against the Node bundle before deleting the POSIX Bun source. |
| N1 requirement atomicity | three spec files | Compound requirements split. The containment clause is a decision table. |
| N2 freshness fixture | `lane-run.sh` freshness rule | The parity fixture sets an old modification time. |
| N3 containment table incomplete | `lane-run.sh:1172` | Full decision table, spawn-time enforcement, missing launcher and malformed record cases, explicit `any` honored. |
| N4 recover already rehydrates | `session-sqlite-bootstrap.ts:154` | Task 1 is a regression check. New RED cases target repair, collision, failure, and refusal text. |
| N5 "matches" undefined, drift cause unknown | `verify-runtime.ts:202` | Tuple comparison defined. A measurement task precedes the fix. |
| N6 Windows risk, recovery order | `capability.ts:9` | Windows parity moved to v0.6 with the Bun executable retained on Windows. Recovery moved to tranche 1. Tranches 4 to 7 run concurrently. |
| N7 understated dependencies | register reasons | `regression-harness-tiers` and `workload-fit-accounting` moved to v0.6. |
| N8 wrong precedent and premature audit claim | design doc | v0.4 described as nine tranches with eight children. Audit sentence now states the process, not a completed artifact. |

Register disagreements from the audit: nine of ten accepted as above. The
tenth, `decision-lineage-and-telemetry`, became a dependency with one slice
owned by `audit-groundedness-gate`.
