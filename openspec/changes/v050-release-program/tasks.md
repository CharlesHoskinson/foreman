## Allowed file scope

`openspec/changes/v050-release-program/**`, `openspec/changes/*/tasks.md`
(reconciliation edits only), `openspec/changes/*/.openspec.yaml`,
`ROADMAP.md`, `packages/orchestration/src/release-*.ts`,
`packages/orchestration/src/execution-contract.ts`,
`packages/policy/src/release-*.ts`, their `.test.ts` siblings,
`skills/foreman/runtime/dist/**`, `skills/foreman/runtime/manifest.json`,
`docs/releases/v0.5.0-notes.md`, `docs/research/v050/**`, `package.json`,
`package-lock.json`, `packages/*/package.json`.

## 1. Bootstrap (child v050-release-program-bootstrap)

- [ ] 1.1 Run `session-store-recovery` first. Verify P8 on the reference host.
- [ ] 1.2 RED: add cases to `release-policy.test.ts`, `release-admission.test.ts`, `release-admission-cli.test.ts`, `release-authority.test.ts`, `release-coverage.test.ts`, `release-coverage-cli.test.ts`, and `execution-contract.test.ts` that expect `v050` accepted and `v041` refused with `wrong_program` at each boundary. Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/release-*.test.ts" "packages/policy/src/release-*.test.ts" "packages/orchestration/src/execution-contract.test.ts"`. Expected: the new cases fail.
- [ ] 1.3 GREEN: add `ReleaseProgram` and the per-program table. Expected: the new cases and every existing v040 case pass.
- [ ] 1.4 RED: register version 2 cases for `unreconciled_package`, `register_cross_field`, `reconciliation_required`, `iron_rule_violation`, `deferred_package_changed`, `workflow_mismatch`, `vocabulary_mixed`, and roadmap row coverage. Expected: fail. GREEN: implement. Expected: pass.
- [ ] 1.5 Reconcile `ROADMAP.md`: move the Council sprints 8 through 11, sprint 12, and sprint 16 dogfood rows to `v0.6`, add rows `roadmap:v050-lane-runtime`, `roadmap:v050-verdict-honesty`, `roadmap:v050-host-truth`, and `roadmap:v050-publication`. Update `roadmap_sha256` in the register.
- [ ] 1.6 Reconcile every entry with `reconcile = "required"` (task 2.1, 3.1, 4.1, 5.1, 6.1, 7.1 below, plus `node-typescript-runtime`, `vendor-adapter-contract`, `wsl-launcher-shipped`, `credential-profile-authority`, `profile-bound-setup-preflight`, and `v040-release-program`). Each reconciliation edits that package's `tasks.md` and sets the register entry to `complete`.
- [ ] 1.7 Tick `v040-release-program` tasks 6.1 to 6.3 with the tag `v0.4.0` evidence and move the package to `archive/`.
- [ ] 1.8 Verify: `node skills/foreman/runtime/dist/release-coverage.js check --program v050 --phase bootstrap --owner v050-release-program --register $PWD/openspec/changes/v050-release-program/coverage.toml`. Expected: exit 0.
- [ ] 1.9 Create the root contract, write thirteen child briefs, register the family authority with the audit and user receipts, and activate the family. Record the contract id and digests as SessionDB facts.
- [ ] 1.10 `npm run build`, `npm run verify-runtime`, `npm run typecheck`. Expected: all exit 0. Commit.

## 2. Lane runtime (child v050-lane-runtime-typescript)

- [ ] 2.1 Reconcile `round-ownership-default`, `lane-ownership-and-reaping`, `round-resume-typescript`, `vendor-adapter-contract`, and `node-typescript-runtime` against `lane-runtime-typescript`. Assign the `lock-primitive-hardening` atomicity slice and the `vendor-preflight` currency slice as tasks of this owner. Set each entry to `complete`.
- [ ] 2.2 Dispatch `lane-runtime-typescript` tasks 1 through 7, including the live receipts task.
- [ ] 2.3 Verify P1 and P3. Record the integration milestone.

## 3. Launcher retirement (child v050-launcher-node-port)

- [ ] 3.1 Reconcile `launcher-node-port`: tick the consumer switch and the two cascade proofs with the 2026-09-05 receipts, restate Bun retirement as POSIX-only, and move Windows Job Object parity to v0.6. Reconcile `wsl-launcher-shipped` as superseded by this entry.
- [ ] 3.2 Add TypeScript compatibility tests that run the compiled Node bundle through every `tests/launcher.bats` POSIX case, then delete `launcher/src/posix*.ts`, the WSL build row, and the POSIX bats setup.
- [ ] 3.3 Verify P2. Record the milestone.

## 4. Verdict honesty (children v050-three-outcome-verdicts, v050-audit-groundedness-gate, v050-evidence-contracts)

- [ ] 4.1 Reconcile the three packages. Every product task that names a `.sh` target moves to `packages/policy` or `packages/orchestration`. Assign the `test-infrastructure-hardening` regression-injection slice to `evidence-contracts` and the `decision-lineage-and-telemetry` event-contract slice to `audit-groundedness-gate`.
- [ ] 4.2 Dispatch in dependency order. Verify P4, P5, and P6. Record each milestone.

## 5. Exploratory route (children v050-spec-triage-gate, v050-foreman-discover-lane)

- [ ] 5.1 Reconcile `spec-triage-gate`: the checker is `packages/orchestration/src/spec-triage.ts` bundled to `skills/foreman/runtime/dist/spec-triage.js`, and the runtime refuses an underdetermined spec before spawn. Reconcile `foreman-discover-lane` wording only.
- [ ] 5.2 Dispatch both. Verify P7. Record the milestones.

## 6. Host truth (children v050-build-determinism, v050-wsl-preflight)

- [ ] 6.1 Reconcile `wsl-preflight`: the preflight is `packages/orchestration/src/wsl-preflight.ts`. Fold the four `wsl-tool-path-persistence` tasks into it.
- [ ] 6.2 Dispatch both. Verify P9 and P10. Record the milestones.

## 7. Doctrine (child v050-doctrine-reality-drift)

- [ ] 7.1 Reconcile `doctrine-reality-drift`: the checker is `packages/policy/src/doctrine-check.ts`. The claims registry stays `docs/doctrine-claims.tsv` and starts with the eleven claims from `docs/research/vnext/R5-internal-attachment-map.md` section 8.2 plus the three corrected on 2026-09-05.
- [ ] 7.2 Dispatch. Verify P11. Record the milestone.

## 8. Release (child v050-release)

- [ ] 8.1 Set every workspace package version to 0.5.0 and regenerate the lockfile.
- [ ] 8.2 Write `docs/releases/v0.5.0-notes.md` from the eleven predicate results and the register.
- [ ] 8.3 Run `tools/ci-local.sh` on the candidate. Run the cold audit through `codex-auditor`. Expected: `APPROVED` with no findings.
- [ ] 8.4 Measure all eleven predicates with `release-coverage.js check --program v050 --phase release`. Expected: eleven passes with output digests.
- [ ] 8.5 Enter the journal at `prepared` with the recorded remote predecessor, push `main` with compare-and-set, then create tag `v0.5.0` and publish the release. Run the post-publication gate. Expected: tag target equals the candidate and the release body digest equals the notes digest.
