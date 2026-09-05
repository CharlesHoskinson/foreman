## 1. Program bootstrap (child v050-t1-bootstrap)

- [ ] 1.1 RED: add `release-policy.test.ts` cases that expect program `v050` to validate and `v041` to fail with `wrong_program`. Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/release-policy*.test.ts"`. Expected: the new cases fail.
- [ ] 1.2 GREEN: introduce `ReleaseProgram = "v040" | "v050"` in `packages/orchestration/src/release-policy.ts`, `packages/policy/src/release-admission.ts`, and `packages/policy/src/release-coverage.ts`, with a per-program table for register path, disposition enum, and predicate list. Run the same command. Expected: all pass, v040 cases unchanged.
- [ ] 1.3 RED: add `release-coverage.test.ts` cases for `schema_version = 2`, the `v060` disposition, `unreconciled_package`, `reconciliation_required`, `iron_rule_violation`, and `deferred_package_changed`. Expected: fail.
- [ ] 1.4 GREEN: implement the checks. Expected: pass.
- [ ] 1.5 Verify the register: `node skills/foreman/runtime/dist/release-coverage.js check --program v050 --phase bootstrap --owner v050-release-program --register $PWD/openspec/changes/v050-release-program/coverage.toml`. Expected: exit 0.
- [ ] 1.6 Create the root Endstop contract and the eight-child family manifest with `execution-guard.js create` and `register-family-authority`. Record the contract id and digests in SessionDB with `fm-session.js fact`.
- [ ] 1.7 `npm run build`, `npm run verify-runtime`, `npm run typecheck`. Expected: all exit 0. Commit.

## 2. Lane runtime (child v050-t2-lane-runtime)

- [ ] 2.1 Reconcile `round-ownership-default`, `lane-ownership-and-reaping`, and `round-resume-typescript` against `lane-runtime-typescript`. Set `reconcile = "complete"` in the register.
- [ ] 2.2 Dispatch `lane-runtime-typescript` tasks 1 through 6 through the queue with `--release-program v050 --release-phase lane --release-owner lane-runtime-typescript`.
- [ ] 2.3 Verify predicates 1 and 3. Record the milestone with `execution-guard.js child-record-milestone`.

## 3. Launcher retirement (child v050-t3-launcher)

- [ ] 3.1 Reconcile `launcher-node-port`: tick the consumer switch, the live cascade proof, and the hostile escape closure with the evidence in `docs/research/foreman-pidns-degradation-2026-09-05-receipts/`. Keep Windows Job Object parity and Bun retirement open.
- [ ] 3.2 Dispatch the remaining `launcher-node-port` tasks. The Bun tree is deleted only after `tests/launcher.bats` passes against the Node bundle on Linux and native Windows.
- [ ] 3.3 Verify predicate 2. Record the milestone.

## 4. Verdict honesty (child v050-t4-verdicts)

- [ ] 4.1 Reconcile `three-outcome-verdicts`, `audit-groundedness-gate`, and `evidence-contracts`. Every product task that names a `.sh` file moves to `packages/policy` or `packages/orchestration`. The Bash scripts named in those tasks become thin adapters or are deleted.
- [ ] 4.2 Dispatch in this order: `three-outcome-verdicts`, then `audit-groundedness-gate`, then `evidence-contracts`.
- [ ] 4.3 Verify predicate 4. Record the milestone.

## 5. Exploratory route (child v050-t5-exploratory)

- [ ] 5.1 Reconcile `spec-triage-gate`: `spec-triage.sh` becomes `packages/orchestration/src/spec-triage.ts` bundled to `skills/foreman/runtime/dist/spec-triage.js`. Reconcile `foreman-discover-lane` unchanged, it is documentation and an agent definition.
- [ ] 5.2 Dispatch both. Verify predicate 5. Record the milestone.

## 6. Host truth (child v050-t6-host)

- [ ] 6.1 Reconcile `wsl-preflight`: `wsl-preflight.sh` becomes `packages/orchestration/src/wsl-preflight.ts`. Reconcile `wsl-tool-path-persistence`.
- [ ] 6.2 Dispatch `session-store-recovery`, `build-determinism`, `wsl-preflight`, `wsl-tool-path-persistence`.
- [ ] 6.3 Verify predicate 6. Record the milestone.

## 7. Doctrine (child v050-t7-doctrine)

- [ ] 7.1 Reconcile `doctrine-reality-drift`: `doctrine-check.sh` becomes `packages/policy/src/doctrine-check.ts`. The claims registry stays `docs/doctrine-claims.tsv`.
- [ ] 7.2 Dispatch. Verify predicate 7. Record the milestone.

## 8. Release (child v050-t8-release)

- [ ] 8.1 Set every workspace package version to 0.5.0 and regenerate the lockfile.
- [ ] 8.2 Write `docs/releases/v0.5.0-notes.md` from the eight predicate results and the register.
- [ ] 8.3 Run `tools/ci-local.sh` on the candidate. Run the cold audit through `codex-auditor`. Expected: `APPROVED` with no findings.
- [ ] 8.4 Measure all eight predicates on the unchanged candidate with `release-coverage.js check --program v050 --phase release`. Expected: eight passes.
- [ ] 8.5 Fast-forward `main`, push, create annotated tag `v0.5.0`, publish the GitHub release from the notes file. Delete only merged release branches.
