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

v0.4 ran nine tranches: one bootstrap tranche plus eight post-bootstrap
children `v040-t2` through `v040-t9`, each bound to one package. v0.5 keeps
the one-package-per-child rule and drops the tranche-numbered identifiers.

## Program dependency graph

```text
t1 session-store-recovery ─► t1 bootstrap ─► t2 lane-runtime-typescript ─► t3 launcher-node-port ─┐
                                                   │                                                │
                                                   ├─► t4 three-outcome-verdicts ─► audit-groundedness-gate ─► evidence-contracts ─┤
                                                   ├─► t5 spec-triage-gate, foreman-discover-lane ─────────────────────────────────┤
                                                   ├─► t6 build-determinism, wsl-preflight ────────────────────────────────────────┤
                                                   └─► t7 doctrine-reality-drift ──────────────────────────────────────────────────┴─► t8 release
```

Recovery runs first because bootstrap records facts in SessionDB and the
store on the reference host is half-migrated. Tranches 4 through 7 run
concurrently after tranche 2.

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

The v0.4 test suites for these files are the regression control. They must
pass unchanged.

## Endstop family

Thirteen children: `v050-session-store-recovery`,
`v050-release-program-bootstrap`, `v050-lane-runtime-typescript`,
`v050-launcher-node-port`, `v050-three-outcome-verdicts`,
`v050-audit-groundedness-gate`, `v050-evidence-contracts`,
`v050-spec-triage-gate`, `v050-foreman-discover-lane`,
`v050-build-determinism`, `v050-wsl-preflight`,
`v050-doctrine-reality-drift`, `v050-release`. Each brief carries
`dependencyChildIds`, `allowedPaths` equal to the package's declared file
scope, and the package's acceptance list. Budgets follow the v0.4 defaults.

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

## Windows decision

The Node launcher reports `windows_job_object_unavailable` and uses the
`taskkill` boundary. v0.5 retires the Bun POSIX build only. The Windows
Bun executable stays until a Node Job Object binding is qualified, which is
a v0.6 item. `launcher-node-port` reconciliation records this.

## Exit predicates

| # | Command | Expected |
|---|---|---|
| P1 | `npm run build && node skills/foreman/runtime/dist/architecture-policy.js check --base 00c342bd449948ab2ea5ca0b9d0c890614dd81d6` | `_tag: Pass`; `grep -c LANE_RUN_BODY_SHA256 packages/policy/src/architecture-adapter.ts` prints `0` |
| P2 | `! grep -q '^id = "foreman-launch"' env/reference-manifest.toml && test ! -e launcher/src/posix-bootstrap.ts` | exit 0; the WSL build row and the POSIX Bun source are gone |
| P3 | `bats tests/lane-run.bats tests/round-ownership.bats tests/watch.bats && npx tsx scripts/run-tests.ts "packages/orchestration/src/lane-runtime/*.test.ts"` | all pass; one strong-round receipt and one refused-round receipt exist under `docs/research/v050/` and name the candidate commit |
| P4 | `npx tsx scripts/run-tests.ts "packages/policy/src/verdict*.test.ts"` | pass; the model-facing schema rejects `UNVERIFIED`; a harness result fixture with an absent CLI records `UNVERIFIED` |
| P5 | `npx tsx scripts/run-tests.ts "packages/policy/src/gate-ground*.test.ts"` | pass; an ungrounded audit fixture is refused |
| P6 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/evidence-contract*.test.ts"` | pass; a lane that exits 0 with no attempt-fresh deliverable is `round_incomplete` |
| P7 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/spec-triage*.test.ts"` | pass; an underdetermined spec is refused before spawn and a determined spec dispatches; `test -f agents/foreman-discover.md` |
| P8 | `node skills/foreman/runtime/dist/fm-session.js repair && node skills/foreman/runtime/dist/fm-session.js recover` on the reference host, then `recover` on a fresh clone | both exit 0 |
| P9 | `npm run verify-runtime` in a worktree created with `git worktree add` and `ln -s` for `node_modules`, then in one created with `npm ci` | first exits 1 with `node_modules_symlink`; second exits 0 |
| P10 | `npx tsx scripts/run-tests.ts "packages/orchestration/src/secret-scan.test.ts" "packages/orchestration/src/wsl-preflight*.test.ts"` | pass; the checkout scans `Clean` |
| P11 | `node skills/foreman/runtime/dist/doctrine-check.js` | exit 0; the claims inventory has at least eleven claims; the mutation control reports every claim protected |

Publication is not a predicate. It is gated by the eleven predicates, the
cold audit, and the journal.

## Failure and rollback behavior

A failed child stops the family at that child. Rollback is a revert of the
child's integration commit. No child changes the on-disk formats of
`events.jsonl`, the heartbeat file, or the session sidecar.

## Largest schedule risk

Windows launcher parity. The decision above removes it from the v0.5
critical path. The second risk is the size of `lane-runtime-typescript`.
Its tasks are ordered so Bats parity is proven before the pins are retired.

## Rejected alternatives

- Keep `v040` hardcoded and copy the runtime for v0.5. Two copies drift.
- Ship the knowledge plane in v0.5. Deferred, see the design doc.
- Dispatch existing Bash-targeted tasks. The Iron Rule forbids the files.
- One child per tranche with several packages. The contract binds one
  package per child.
