## Allowed file scope

Exact paths or terminal `/**` prefixes, as the family path grammar requires.

- `openspec/changes/**` (reconciliation edits to `tasks.md`, `specs/**`, `release-brief.json`, and `.openspec.yaml` of registered packages, and the `archive/` destination)
- `ROADMAP.md`
- `packages/orchestration/src/release-policy.ts`, `packages/orchestration/src/release-policy.test.ts`
- `packages/orchestration/src/release-coverage-cli.ts`, `packages/orchestration/src/release-coverage-cli.test.ts`
- `packages/orchestration/src/release-authority-main.ts`, `packages/orchestration/src/release-policy-main.ts`
- `packages/orchestration/src/execution-contract.ts`, `packages/orchestration/src/execution-contract.test.ts`
- `packages/orchestration/src/execution-guard-cli.ts`, `packages/orchestration/src/execution-guard-cli.test.ts`
- `packages/policy/src/release-admission.ts`, `packages/policy/src/release-admission.test.ts`
- `packages/policy/src/release-admission-cli.ts`, `packages/policy/src/release-admission-cli.test.ts`
- `packages/policy/src/release-authority.ts`, `packages/policy/src/release-authority.test.ts`
- `packages/policy/src/release-coverage.ts`, `packages/policy/src/release-coverage.test.ts`
- `packages/policy/src/fixtures/v040/**`
- `skills/foreman/runtime/dist/**`, `skills/foreman/runtime/manifest.json`
- `docs/releases/v0.5.0-notes.md`, `docs/research/v050/**`
- `package.json`, `package-lock.json`, `packages/core/package.json`, `packages/event-log/package.json`, `packages/graph-store/package.json`, `packages/launcher/package.json`, `packages/memory/package.json`, `packages/orchestration/package.json`, `packages/policy/package.json`, `packages/session-store/package.json`

## 1. Bootstrap (root contract, before family activation)

- [ ] 1.0 Create the root Endstop contract with `execution-guard.js create` and record its id and digest as SessionDB facts after task 1.1 succeeds. Every later bootstrap task runs under this root.
- [ ] 1.1 Run `session-store-recovery` under the root contract as a dependency of this package. Verify P8, then run `repair` and `recover` on the reference host. Expected: both exit 0.
- [ ] 1.1a Freeze the v0.4 inputs: copy the v0.4 register, the baseline active-inventory list, and the baseline `ROADMAP.md` into `packages/policy/src/fixtures/v040/`. Change the fixture-loading lines of `release-coverage.test.ts` (near 2417 and 2436) to read them. Run the policy tests. Expected: pass unchanged.
- [ ] 1.2 RED: add cases to `release-policy.test.ts`, `release-admission.test.ts`, `release-admission-cli.test.ts`, `release-authority.test.ts`, `release-coverage.test.ts`, `release-coverage-cli.test.ts`, `execution-contract.test.ts`, and `execution-guard-cli.test.ts` that expect `v050` accepted, `v041` refused with `wrong_program`, and a cross-program family receipt refused with `invalid_family_authority`. Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/release-*.test.ts" "packages/policy/src/release-*.test.ts" "packages/orchestration/src/execution-contract.test.ts" "packages/orchestration/src/execution-guard-cli.test.ts"`. Expected: the new cases fail.
- [ ] 1.3 GREEN: add `ReleaseProgram` and the per-program table. Expected: the new cases and every existing v040 case pass.
- [ ] 1.4 RED: register version 2 cases for `unreconciled_package`, `register_cross_field`, `reconciliation_required`, `iron_rule_violation`, `deferred_package_changed`, `workflow_mismatch`, `vocabulary_mixed`, and roadmap row coverage. Expected: fail. GREEN: implement. Expected: pass.
- [ ] 1.5 Reconcile `ROADMAP.md`: move the Council sprints 8 through 11, sprint 12, and sprint 16 dogfood rows to `v0.6`, add rows `roadmap:v050-lane-runtime`, `roadmap:v050-verdict-honesty`, `roadmap:v050-host-truth`, and `roadmap:v050-publication`. Update `roadmap_sha256` in the register.
- [ ] 1.6 Reconcile every entry with `reconcile = "required"` (task 2.1, 3.1, 4.1, 5.1, 6.1, 7.1 below, plus `node-typescript-runtime`, `vendor-adapter-contract`, `wsl-launcher-shipped`, `credential-profile-authority`, `profile-bound-setup-preflight`, `resume-supervisor-typescript`, `crlf-extensionless-hardening`, `captured-facts-convergence` (its task 4 worked-example review with a receipt path), and `v040-release-program`). Each reconciliation edits that package's `tasks.md` and, where a requirement names a Bash owner or a deferred mechanism, its `specs/**` too. Each carried obligation gets one task and one receipt path. Set the register entry to `complete`.
- [ ] 1.7 Tick `v040-release-program` tasks 6.1 and 6.2 with `git rev-parse v0.4.0^{commit}` and the GitHub release record, and task 6.3 with a `git branch -r` listing showing no merged release branch. Move the package to `archive/2026-09-05-v040-release-program/` and re-run the policy tests against the frozen fixtures. Expected: pass.
- [ ] 1.8 `npm run build`, `npm run verify-runtime`, `npm run typecheck`. Expected: all exit 0. Commit the bootstrap authorities.
- [ ] 1.9 Verify with the rebuilt runtime: `node skills/foreman/runtime/dist/release-coverage.js check --program v050 --phase bootstrap --owner v050-release-program --register $PWD/openspec/changes/v050-release-program/coverage.toml`. Expected: exit 0. Commit any register correction and rebuild.
- [ ] 1.10 Write twelve child briefs with exact-path or `/**` allowed paths equal to each package's declared scope, register the family authority with the audit and user receipts, and activate the family on the committed bootstrap candidate. Record the family digest as a SessionDB fact.

## 2. Lane runtime (child v050-lane-runtime-typescript)

- [ ] 2.1 Reconcile `round-ownership-default`, `lane-ownership-and-reaping`, `round-resume-typescript`, `vendor-adapter-contract`, and `node-typescript-runtime` against `lane-runtime-typescript`. Assign the `lock-primitive-hardening` atomicity slice and the `vendor-preflight` currency slice as tasks of this owner. Set each entry to `complete`.
- [ ] 2.2 Dispatch `lane-runtime-typescript` tasks 1 through 7, including the live receipts task.
- [ ] 2.3 Verify P1 and P3. Record the integration milestone.

## 3. Launcher retirement (child v050-launcher-node-port)

- [ ] 3.1 Reconcile `launcher-node-port`: tick the consumer switch and the two cascade proofs with the 2026-09-05 receipts, restate Bun retirement as POSIX-only, and move Windows Job Object parity to v0.6. Reconcile `wsl-launcher-shipped` as superseded by this entry.
- [ ] 3.2 Add TypeScript compatibility tests that run the compiled Node bundle through every `tests/launcher.bats` POSIX case. Then remove the `build:posix` script, the WSL `foreman-launch` manifest row, the Setup build step, the POSIX bats setup, and the runtime's POSIX Bun fallback. Keep `launcher/src/**` because the Windows build imports it. Run `pwsh -File launcher/build.ps1` on a Windows host. Expected: the Windows executable still builds.
- [ ] 3.3 Verify P2. Record the milestone.

## 4. Verdict honesty (children v050-three-outcome-verdicts, v050-audit-groundedness-gate, v050-evidence-contracts)

- [ ] 4.1 Reconcile the three packages. Every product task that names a `.sh` target moves to `packages/policy` or `packages/orchestration`. Assign the `test-infrastructure-hardening` regression-injection slice to `evidence-contracts` and the `decision-lineage-and-telemetry` event-contract slice to `audit-groundedness-gate`.
- [ ] 4.2 Dispatch in dependency order. Verify P4, P5, and P6. Record each milestone.

## 5. Exploratory route (children v050-spec-triage-gate, v050-foreman-discover-lane)

- [ ] 5.1 Reconcile `spec-triage-gate`: the checker is `packages/orchestration/src/spec-triage.ts` bundled to `skills/foreman/runtime/dist/spec-triage.js`, and the runtime refuses an underdetermined spec before spawn. Reconcile `foreman-discover-lane` wording only.
- [ ] 5.2 Dispatch both. Verify P7. Record the milestones.
- [ ] 5.3 (moved to 7.3)

## 6. Host truth (children v050-build-determinism, v050-wsl-preflight)

- [ ] 6.1 Reconcile `wsl-preflight`: the preflight is `packages/orchestration/src/wsl-preflight.ts`. Fold the four `wsl-tool-path-persistence` tasks into it.
- [ ] 6.2 Dispatch both. Verify P9 and P10. Record the milestones.

## 7. Doctrine (child v050-doctrine-reality-drift)

- [ ] 7.0 Wait for the `evidence-contracts` milestone. Doctrine adopts its regression-injection mechanism.
- [ ] 7.1 Reconcile `doctrine-reality-drift`: the checker is `packages/policy/src/doctrine-check.ts`. The claims registry stays `docs/doctrine-claims.tsv` and starts with the eleven claims from `docs/research/vnext/R5-internal-attachment-map.md` section 8.2 plus the three corrected on 2026-09-05.
- [ ] 7.2 Dispatch. Verify P11. Record the milestone.
- [ ] 7.3 Dispatch `workflow-weight-reduction` tasks 0 through 13 in order after the doctrine milestone. Its watchdog and `queue_wait_s` requirements were landed by tranche 2. Verify P12 through P15. Record the milestone.

## 8. Release (child v050-release)

- [ ] 8.1 Set every workspace package version to 0.5.0 and regenerate the lockfile.
- [ ] 8.2 Write `docs/releases/v0.5.0-notes.md` from the fifteen predicate results and the register.
- [ ] 8.3 Run `tools/ci-local.sh` on the candidate. Run the cold audit through `codex-auditor`. Expected: `APPROVED` with no findings.
- [ ] 8.3a Re-run `lane-runtime-typescript` task 7 on the frozen candidate and store the three receipts under `$FOREMAN_HOME/endstop/v050/receipts/`, outside the repository, with the candidate commit in each. No tracked file changes after the candidate freezes.
- [ ] 8.4 Measure all fifteen predicates with `release-coverage.js check --program v050 --phase release --repo $PWD --state-root $FOREMAN_HOME/endstop/v050 --contract-id <root> --contract-sha <sha> --family-sha <sha> --register $PWD/openspec/changes/v050-release-program/coverage.toml`. Expected: fifteen `PASS` rows with output digests and executed-case counts, no `FAILED`, no `UNCOMPUTABLE`.
- [ ] 8.5 Enter the journal at `prepared` with the recorded remote predecessor, push `main` with compare-and-set (`local_integrated`, `main_published`), create annotated tag `v0.5.0` (`tag_pushed`), publish the release from the notes file (`release_created`), and run the post-publication gate (`verified`). Expected: tag target equals the candidate and the release body digest equals the notes digest.
