## Allowed file scope

`packages/orchestration/src/lane-runtime/**`, `packages/orchestration/src/round-*.ts`,
`packages/policy/src/architecture-adapter.ts`, `skills/foreman/scripts/lane-run.sh`,
`skills/foreman/scripts/watch.sh`, `scripts/build-runtime.ts`, `tests/lane-run.bats`,
`tests/watch.bats`, `tests/round-ownership.bats`, `skills/foreman/runtime/dist/**`,
`skills/foreman/runtime/manifest.json`, `docs/research/v050/**`,
`openspec/changes/lock-primitive-hardening/tasks.md` and
`openspec/changes/vendor-preflight/tasks.md` (slice reassignment only).

## Tasks

- [ ] 0. Slices. Add to this package the `mkdir` mutex atomicity evidence task from `lock-primitive-hardening` that `round-ownership-default` T3 requires, and the vendor currency check task from `vendor-preflight` that `lane-ownership-and-reaping` requires. Each becomes one TypeScript test in `lane-runtime/`. Record the reassignment in both source packages' `tasks.md`.
- [ ] 1. Pure planning modules. RED: `lane-runtime/resolve-launcher.test.ts`, `containment.test.ts`, `ownership.test.ts`, `kill-plan.test.ts` assert the shapes in the design. Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/lane-runtime/*.test.ts"`. Expected: fail. GREEN: implement the pure functions. Expected: pass. Commit.
- [ ] 2. Spawn and mirror. RED: a test spawns `sh -c 'echo x'` through an injected fake launcher and asserts the `prompt`, `ownership`, `heartbeat`, `checkpoint`, and `round_done` sequence. Expected: fail. GREEN: implement `spawn.ts` and `mirror.ts` with Effect scopes. Expected: pass. Commit.
- [ ] 3. Gate and report freshness. RED: a test runs a gate command that writes a report with `attempt: 2` while the current attempt is 1, sets the file's modification time to one hour before the round start, and asserts `round_incomplete`. Expected: fail. GREEN: implement `gate.ts` and `report-fresh.ts` with the baseline rule (fresh mtime or matching attempt). Expected: pass. Commit.
- [ ] 4. Cleanup ladder. RED: a test injects SIGTERM during a strong round and asserts one `SIGKILL` to the launcher pid and no group signal. A second test does the same for a degraded round and asserts the group signal first. Expected: fail. GREEN: implement `cleanup.ts`. Expected: pass. Commit.
- [ ] 5. Entry points and adapters. Extend `round-main.ts`, add `watch-main.ts`, add both to `scripts/build-runtime.ts`, and rewrite `lane-run.sh` and `watch.sh` as thin adapters. RED: `bats tests/lane-run.bats tests/round-ownership.bats tests/watch.bats`. Expected: fail before the adapters exist. GREEN: same command. Expected: every case that passed at the baseline passes. Commit.
- [ ] 6. Retire the pins. Delete `LANE_RUN_BODY_SHA256`, `inspectLaneRunMigrationAdapter`, and the `watch.sh` map entry. Run `node skills/foreman/runtime/dist/architecture-policy.js check --base 00c342bd449948ab2ea5ca0b9d0c890614dd81d6`. Expected: `Pass`. Commit.
- [ ] 7. Live checks on WSL as an unprivileged user, each receipt naming the candidate commit: one strong round with a `setsid sleep` descendant and SIGTERM to the adapter, one refused round with `FOREMAN_LAUNCH_IMPL=bun` and `LANE_VENDOR=grok`, one approved degraded round. Store receipts under `docs/research/v050/`. Expected: zero survivors, exit 2 with `containment_refused`, and an ownership payload carrying the approval.

## Verification

```bash
npm run typecheck
npx tsx scripts/run-tests.ts "packages/orchestration/src/**/*.test.ts"
bats tests/lane-run.bats tests/round-ownership.bats tests/watch.bats
node skills/foreman/runtime/dist/architecture-policy.js check --base 00c342bd449948ab2ea5ca0b9d0c890614dd81d6
npm run build && npm run verify-runtime
```
