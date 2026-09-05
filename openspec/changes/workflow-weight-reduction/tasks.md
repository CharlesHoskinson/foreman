## Allowed file scope

Exact paths or terminal `/**` prefixes.

- `packages/orchestration/src/verification-receipt.ts`, `packages/orchestration/src/verification-receipt.test.ts`
- `packages/orchestration/src/change-descriptor.ts`, `packages/orchestration/src/change-descriptor.test.ts`
- `packages/orchestration/src/landing-transaction.ts`, `packages/orchestration/src/landing-transaction.test.ts`
- `packages/orchestration/src/lane-runtime/**`
- `packages/orchestration/src/queue-admission.ts`, `packages/orchestration/src/queue-admission.test.ts`
- `packages/orchestration/src/round-cli.ts`, `packages/orchestration/src/round-cli.test.ts`
- `packages/policy/src/gate-plan.ts`, `packages/policy/src/gate-plan.test.ts`
- `packages/policy/src/small-change.ts`, `packages/policy/src/small-change.test.ts`
- `packages/policy/src/doctrine-check.ts`, `packages/policy/src/doctrine-check.test.ts`
- `scripts/run-tests.ts`, `scripts/run-tests.test.ts`
- `scripts/build-runtime.ts`, `scripts/verify-runtime.ts`, `scripts/verify-runtime.test.ts` (register `gate-plan.js` and `lane-watch.js` in the build and the exact artifact inventory)
- `packages/policy/src/gate-plan-main.ts`, `packages/policy/src/documentation-check.ts`, `packages/policy/src/documentation-check.test.ts`
- `packages/policy/src/architecture-adapter.ts`, `packages/policy/src/architecture-adapter.test.ts` (retire the `merge-gate.sh` and `gate-eval.sh` digest pins when they become thin adapters)
- `skills/foreman/scripts/checks-run.sh`, `skills/foreman/scripts/merge-gate.sh`, `skills/foreman/scripts/wt-merge.sh`, `skills/foreman/scripts/foreman-cleanup.sh`, `skills/foreman/scripts/wt-cleanup.sh`, `skills/foreman/scripts/docs-check.sh`
- `tools/ci-local.sh`, `tests/run.sh`
- `skills/foreman/SKILL.md`, `skills/foreman/references/**`, `CLAUDE.md`, `RESUME.md`, `AGENT_TRAPS.md`
- `plugins/foreman-qa/**`
- `docs/doctrine-claims.tsv`, `docs/research/v050/**`
- `skills/foreman/runtime/dist/**`, `skills/foreman/runtime/manifest.json`
- `.foreman/config.toml`

## Tasks

- [ ] 0. Feasibility. Run the complete Bats suite once under the mutex and record wall clock and the exclusive phase under `docs/research/v050/full-gate-measured.md`. IF the exclusive phase exceeds 600 s, renegotiate the full-tier budget in the register before task 9. Commit.
- [ ] 1. Instrumentation first. RED: a round-cli test asserts `queue_wait_s`, `preamble_s`, `implement_s`, `gate_s`, `audit_s`, and `land_s` in `round_done`. Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/round-cli.test.ts"`. Expected: fail. GREEN: record the phases in the runtime. Expected: pass. Commit. Record the idle share of the last twenty rounds as the "before" number in `docs/research/v050/weight-before-after.md`.
- [ ] 2. Verification receipts. RED: `verification-receipt.test.ts` covers write with a `receipt` event, reuse on an identical key, re-run on each differing key component, and `receipt_untrusted` for three forgeries: a well-formed receipt with no registration event, a replaced file whose digest differs from the event, and a registration event that follows the current `prompt`. Expected: fail. GREEN: implement. Expected: pass. Make `checks-run.sh` a thin adapter that calls the runtime. Commit.
- [ ] 3. Change descriptor. RED: `change-descriptor.test.ts` resolves a fixture authority to a descriptor, refuses `scope_exceeded`, and refuses an unregistered change id. Expected: fail. GREEN: implement and add `lane-round dispatch` and `lane-round wait` to `round-cli.ts`. Expected: pass. Commit.
- [ ] 4. Gate plan and tiers. RED: `gate-plan.test.ts` selects tiers for docs-only (including `doctrine-check` for normative documentation), adapter-only, TypeScript, runtime bundle, launcher, and unknown paths, and marks a budget overrun `incomplete`. Expected: fail. GREEN: implement `gate-plan.ts` and `gate-plan-main.ts`, register `gate-plan.js` in `build-runtime.ts` and the `verify-runtime.ts` inventory, make `tools/ci-local.sh` and `tests/run.sh` thin adapters over the plan, and retire the `merge-gate.sh` and `gate-eval.sh` pins when those become adapters. Fix `ci-local.sh:262` so `RESULT SHADOW` is never `GATE PASS`. Expected: pass, `npm run verify-runtime` passes with the new bundle. Commit.
- [ ] 5. Small-change tier. RED: `small-change.test.ts` classifies fixtures by file count, line count, forbidden paths, file types, and spec determination, and upgrades on a post-diff recheck. Expected: fail. GREEN: implement and wire the classification into `lane-round dispatch`. Expected: pass. Commit.
- [ ] 6. Pipelined audit and bounded rework. RED: a round-cli test asserts the audit `prompt` follows the passing checks `receipt` event within ten seconds with no operator command, that an audit reservation before a checks receipt is refused, and that a failing gate whose output names a diff path produces exactly one rework attempt under `max_rework_rounds = 1`. Expected: fail. GREEN: implement in the runtime with Effect scopes. Expected: pass. Commit.
- [ ] 7. Landing transaction. RED: `landing-transaction.test.ts` covers freeze, full-tier receipt required, `target_moved`, archive before delete, and dirty-worktree preservation. Expected: fail. GREEN: implement; make `merge-gate.sh`, `wt-merge.sh`, `foreman-cleanup.sh`, and `wt-cleanup.sh` thin adapters or delete them. Expected: pass. Commit.
- [ ] 8. Queue admission. RED: `queue-admission.test.ts` asserts a warm `add` makes four subprocess calls. Expected: fail at twelve. GREEN: configure the requested group on admission. Expected: pass. Commit.
- [ ] 9. Test partition, step one. Classify every test file as deterministic or load-sensitive in `scripts/run-tests.ts`, run the deterministic set twice with a shared-state detector, and record the isolation result under `docs/research/v050/`. Do not remove the mutex in this task. Commit.
- [ ] 10. Test partition, step two. WHERE the isolation record is clean, run deterministic files in four shards. RED: a `run-tests.test.ts` case asserts serial order when the record is absent and sharded order when present. Expected: fail. GREEN: implement. Expected: pass and `npm test` under 120 s on the reference host. Commit.
- [ ] 11. Doctrine compression, after the `doctrine-reality-drift` milestone. Write the rule-id inventory from the current SKILL.md, CLAUDE.md, AGENT_TRAPS.md, and references into `docs/doctrine-read-set.txt`. Rewrite SKILL.md to at most 150 lines with every rule id. Move the Endstop and release grammar to `--help`. Mark each reference `doctrine` or `history`. Fix `fm-session.py` in CLAUDE.md and RESUME.md. Move `docs-check.sh` logic to `packages/policy/src/documentation-check.ts` with a thin adapter, and make a clean checkout green. RED: `doctrine-check.test.ts` fails on a missing rule id and on a doctrine path that does not exist. GREEN: pass. Commit.
- [ ] 12. Task-specific doctrine. RED: a change-descriptor test asserts the worker context includes only traps whose paths match the allowed paths. Expected: fail. GREEN: implement. Expected: pass. Commit.
- [ ] 13. Measure after. Run `lane-round bench --workload docs/research/v050/bench/` against four pinned disposable fixture repositories (three one-file changes, one three-package change) through `lane-round dispatch` and `lane-round wait`. The command records wall clock, idle share, receipts reused, manual steps, and the read floor (bytes divided by four over `docs/doctrine-read-set.txt`) to `$FOREMAN_HOME/endstop/v050/receipts/bench-<candidate>.json`, outside the repository. Expected: every target in the consolidation met or the shortfall named in the release notes.

## Verification

```bash
npm run typecheck
npx tsx scripts/run-tests.ts "packages/orchestration/src/**/*.test.ts" "packages/policy/src/**/*.test.ts" "scripts/**/*.test.ts"
bats tests/lane-run.bats tests/round-ownership.bats tests/watch.bats
node skills/foreman/runtime/dist/doctrine-check.js
npm run build && npm run verify-runtime
```
