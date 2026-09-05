# Design: Foreman v0.5 release program

## Design objective

Reuse the v0.4 release loop, its publication journal, and its Endstop
family mechanics. Change only what v0.5 needs: a program-parameterized
runtime, a version 2 register, package-level children, and eleven
predicates.

## Authority model

Git objects, then approved OpenSpec text, then source and tests, then durable
event logs and SessionDB, then derived artifacts. `docs/superpowers/specs/`
holds design narrative only.

## Precedent

v0.4 ran nine tranches: one bootstrap tranche under the root contract plus
eight post-bootstrap children `v040-t2` through `v040-t9`, each bound to
one package. v0.5 keeps both rules: bootstrap runs under the root contract
before activation, and every child binds one distinct package.

## Program dependency graph

```text
t1 bootstrap (root contract): session-store-recovery, runtime authorities, register, fixtures, family
   └─► t2 lane-runtime-typescript ─► t3 launcher-node-port ──────────────────────────────────────┐
            ├─► t4 three-outcome-verdicts ─► audit-groundedness-gate ─► evidence-contracts ─┐      │
            │                                                                              └─► t7 doctrine-reality-drift ─┤
            ├─► t5 spec-triage-gate, foreman-discover-lane, workflow-weight-reduction ─────────────┤
            └─► t6 build-determinism, wsl-preflight ───────────────────────────────────────────────┴─► t8 release
```

Recovery runs first because bootstrap records facts in SessionDB and the
store on the reference host is half-migrated. Tranches 4 through 6 run
concurrently after tranche 2. Tranche 7 waits for `evidence-contracts`
because doctrine adopts its regression-injection mechanism.

## Runtime authorities owned by bootstrap

| File | Current constant | Change |
|---|---|---|
| `packages/orchestration/src/release-policy.ts:55` | `program: "v040"` | `ReleaseProgram` |
| `packages/orchestration/src/release-coverage-cli.ts:50` | `PROGRAM`, `TRACK1_OWNER` | per-program table |
| `packages/orchestration/src/execution-contract.ts:315` | `tranche: 2..9` | tranche range per program |
| `packages/policy/src/release-admission.ts:192` | `bundle.program !== "v040"` | `ReleaseProgram` |
| `packages/policy/src/release-admission-cli.ts:135` | `args[2] !== "v040"` | `ReleaseProgram` |
| `packages/policy/src/release-authority.ts:12` | `PROGRAM`, `EVAL_CHILD` | per-program table |
| `packages/policy/src/release-coverage.ts:76` | disposition enum | version 2 enum, cross-field rules, roadmap rows |
| `packages/orchestration/src/execution-guard-cli.ts:134` and `:167` | `value.program === "v040"` in both family receipt validators | validate against the selected family's program |

The v0.4 behavioral tests are the regression control. Two of them read the
live `openspec/changes/v040-release-program/coverage.toml` and assert the
baseline inventory digest (`release-coverage.test.ts` near lines 2417 and
2436). Bootstrap freezes those inputs under
`packages/policy/src/fixtures/v040/` and changes only the fixture-loading
lines. New v0.5 integration cases read the live repository.

## Endstop family

Bootstrap runs under the root contract before activation, exactly like the
v0.4 bootstrap exception. `session-store-recovery` is executed there as a
dependency of the governor, so it has no child. The family then holds
twelve children with twelve distinct package identifiers:
`v050-lane-runtime-typescript`, `v050-launcher-node-port`,
`v050-three-outcome-verdicts`, `v050-audit-groundedness-gate`,
`v050-evidence-contracts`, `v050-spec-triage-gate`,
`v050-foreman-discover-lane`, `v050-workflow-weight-reduction`,
`v050-build-determinism`, `v050-wsl-preflight`,
`v050-doctrine-reality-drift`, and `v050-release`
(package `v050-release-program`). Each brief carries `dependencyChildIds`,
`allowedPaths` equal to the package's declared file scope in the registered
path grammar (exact paths or a terminal `/**`), and the package's
acceptance list. Budgets follow the v0.4 defaults. The family validator
already rejects duplicate package identifiers and requires one child per
selected owner, so the register's owner set and the family must agree.

## Dependency slices carried from v0.6 packages

Four deferred packages own something a v0.5 owner needs. Each slice is
assigned to the v0.5 owner and recorded in the register reason.

| Deferred package | Slice needed | v0.5 owner |
|---|---|---|
| `lock-primitive-hardening` | the `mkdir` mutex atomicity evidence that `round-ownership-default` T3 requires | `lane-runtime-typescript` |
| `test-infrastructure-hardening` | the regression-injection mechanism that `evidence-contracts` and `doctrine-reality-drift` adopt | `evidence-contracts` |
| `vendor-preflight` | the vendor currency check that `lane-ownership-and-reaping` settles before dispatch | `lane-runtime-typescript` |
| `decision-lineage-and-telemetry` | the event contracts that `audit-groundedness-gate` reads | `audit-groundedness-gate` |

`profile-use-leasing` stays deferred. The two packages that named it
(`credential-profile-authority`, `profile-bound-setup-preflight`) move
their leasing tasks to it and close.

## Windows decision and the retirement boundary

The Node launcher reports `windows_job_object_unavailable` and uses the
`taskkill` boundary. v0.5 retires the POSIX *build and selection* paths
only: the `build:posix` script, the WSL `foreman-launch` manifest row, the
Setup build step, and the runtime's `FOREMAN_LAUNCH_IMPL=bun` fallback on
POSIX. The Bun source tree stays, because `launch.ts` and `supervise.ts`
import `./posix` and `build.ps1` compiles that entry point for Windows.
Retirement includes a Windows rebuild check through `build.ps1`. Source
deletion and Job Object parity are v0.6 items.

## Exit predicates

| # | Command | Expected |
|---|---|---|
| P1 | `npm run build && node skills/foreman/runtime/dist/architecture-policy.js check --base 00c342bd449948ab2ea5ca0b9d0c890614dd81d6 && npx tsx scripts/run-tests.ts "packages/policy/src/architecture-adapter.test.ts"` | `_tag: Pass`; neither `LANE_RUN_BODY_SHA256` nor a `watch.sh` map entry exists in `architecture-adapter.ts`; the adapter test case "lane-run.sh and watch.sh pass the thin-adapter grammar" executes and passes |
| P2 | `! grep -q '^id = "foreman-launch"' env/reference-manifest.toml && ! grep -q 'build:posix' launcher/package.json && ! grep -q 'FOREMAN_LAUNCH_IMPL' packages/orchestration/src/lane-runtime/resolve-launcher.ts && pwsh -File launcher/build.ps1` on a Windows host | exit 0; no WSL build row, no POSIX build script, no POSIX Bun fallback, Windows build still succeeds |
| P3 | `bats tests/lane-run.bats tests/round-ownership.bats tests/watch.bats && npx tsx scripts/run-tests.ts "packages/orchestration/src/lane-runtime/*.test.ts"` on the Linux release host, and the Windows-only cases (`taskkill` sweep, compiled exe) on the Windows host at the same commit | every case executes on its designated host per the host matrix in `docs/research/v050/bats-case-map.md`, none skipped on its designated host; the release child re-runs `lane-runtime-typescript` task 7 on the candidate and stores the three receipts under `$FOREMAN_HOME/endstop/v050/receipts/` naming the candidate commit |
| P4 | `npx tsx scripts/run-tests.ts "packages/policy/src/verdict*.test.ts"` | pass; the model-facing schema rejects `UNVERIFIED`; a harness result fixture with an absent CLI records `UNVERIFIED` |
| P5 | `npx tsx scripts/run-tests.ts "packages/policy/src/gate-ground*.test.ts"` | pass; an ungrounded audit fixture is refused |
| P6 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/evidence-contract*.test.ts"` | pass; a lane that exits 0 with no attempt-fresh deliverable is `round_incomplete` |
| P7 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/spec-triage*.test.ts"` | pass; an underdetermined spec is refused before spawn and a determined spec dispatches; `test -f agents/foreman-discover.md` |
| P8 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/session-sqlite-bootstrap.test.ts"` | pass with zero skipped; the half-migrated fixture case, the fresh-clone case, and the `no_session_source` case all execute |
| P9 | `npx tsx scripts/run-tests.ts "scripts/verify-runtime.test.ts"` | pass with zero skipped; the symlink fixture, the lockfile-mismatch fixture, and the two-path build fixture all execute |
| P10 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/secret-scan.test.ts" "packages/orchestration/src/wsl-preflight*.test.ts"` | pass; the live-traversal case executed (not skipped) on the Linux release host and reports `Clean` |
| P12 | `node skills/foreman/runtime/dist/lane-round.js stats --last 20` | idle share (wall clock minus model, gate, and audit time) at most 25 percent over the last twenty real rounds, with `queue_wait_s` non-null in each |
| P13 | `node skills/foreman/runtime/dist/gate-plan.js run --tier pre-commit` then `--tier full` on the candidate | pre-commit completes in at most 60 s and full in at most 600 s on the reference host, both `pass`, neither `incomplete` |
| P14 | three real one-file changes and one three-package change through `lane-round dispatch` and `lane-round wait`, recorded in `docs/research/v050/weight-before-after.md` | each one-file change lands in at most 15 minutes wall clock with at most six manual steps and one `npm run verify` per candidate tree |
| P15 | `node skills/foreman/runtime/dist/doctrine-check.js --read-floor` | the mandated cold read set is at most 12,000 tokens and the rule-id inventory is complete |
| P12 | `node skills/foreman/runtime/dist/lane-round.js stats --last 20` | idle share (wall clock minus model, gate, and audit time) at most 25 percent over the last twenty real rounds, with `queue_wait_s` non-null in each |
| P13 | `node skills/foreman/runtime/dist/gate-plan.js run --tier pre-commit` then `--tier full` on the candidate | pre-commit completes in at most 60 s and full in at most 600 s on the reference host, both `pass`, neither `incomplete` |
| P14 | three real one-file changes and one three-package change through `lane-round dispatch` and `lane-round wait`, recorded in `docs/research/v050/weight-before-after.md` | each one-file change lands in at most 15 minutes wall clock with at most six manual steps and one `npm run verify` per candidate tree |
| P15 | `node skills/foreman/runtime/dist/doctrine-check.js --read-floor` | the mandated cold read set is at most 12,000 tokens and the rule-id inventory is complete |
| P11 | `node skills/foreman/runtime/dist/doctrine-check.js && node skills/foreman/runtime/dist/doctrine-check.js --mutation-control` | both exit 0; the inventory contains the fourteen claim ids listed in `doctrine-reality-drift` task 7.1 (eleven from R5 section 8.2 plus `launcher-verified-unprivileged`, `systemd-scope-collect-kills`, `launcher-kills-group-on-exit`); the mutation control reports each of the fourteen protected |

Publication is not a predicate. It is gated by the fifteen predicates, the
cold audit, and the journal. Task 8.4 runs
`release-coverage.js check --program v050 --phase release --repo <abs> --state-root <abs> --contract-id <root> --contract-sha <sha> --family-sha <sha> --register <abs>`.

## Failure and rollback behavior

A failed child stops the family at that child. Rollback is a revert of the
child's integration commit. No child changes the on-disk formats of
`events.jsonl`, the heartbeat file, or the session sidecar.

## Largest schedule risk

Migrating round ownership and the watchdog while preserving lifecycle and
platform-specific contracts. `tests/watch.bats` sources `watch.sh` and
calls its functions, and `tests/lane-run.bats` extracts a Bash function by
name, so a thin adapter cannot satisfy those cases as written. Tranche 2
acceptance therefore includes `docs/research/v050/bats-case-map.md`: every
Bats case mapped to a TypeScript unit test with the same assertion or kept
as an adapter-contract case, with the host matrix for Windows-only cases.
Windows Job Object parity is deferred and off the critical path.

## Rejected alternatives

- Keep `v040` hardcoded and copy the runtime for v0.5. Two copies drift.
- Ship the knowledge plane in v0.5. Deferred, see the design doc.
- Dispatch existing Bash-targeted tasks. The Iron Rule forbids the files.
- One child per tranche with several packages. The contract binds one
  package per child.
