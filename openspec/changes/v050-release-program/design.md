# Design: Foreman v0.5 release program

## Design objective

Reuse the v0.4 release loop without change. Add only what v0.5 needs: a
program-parameterized runtime, a new coverage register, eight predicates, and
eight children.

## Authority model

Git objects, then approved OpenSpec text, then source and tests, then durable
event logs and SessionDB, then derived artifacts. `docs/superpowers/specs/`
holds design narrative only.

## Program dependency graph

```text
t1 bootstrap ──► t2 lane runtime ──► t3 launcher retirement ──► t8 release
                     │                                          ▲
                     ├──► t4 verdict honesty ───────────────────┤
                     ├──► t5 exploratory route ─────────────────┤
                     ├──► t6 host truth ────────────────────────┤
                     └──► t7 doctrine ──────────────────────────┘
```

t4 through t7 depend on t2 because each needs the TypeScript round runtime
as its integration point. t3 depends on t2 because the launcher consumer
switch lives in the round runtime.

## Package map

| Tranche | Owner | Reconciliation |
|---|---|---|
| t1 | `v050-release-program` | new |
| t2 | `lane-runtime-typescript` | new |
| t3 | `launcher-node-port` | required: tick the consumer switch and cascade proofs with the 2026-09-05 evidence, keep Windows parity and Bun retirement open |
| t4 | `three-outcome-verdicts`, `audit-groundedness-gate`, `evidence-contracts` | required: every task that names `gate-ground.sh`, `audit-run.sh`, or `wt-consolidate.sh` as a product target moves to `packages/orchestration` or `packages/policy` |
| t5 | `spec-triage-gate`, `foreman-discover-lane` | required: `spec-triage.sh` becomes `packages/orchestration/src/spec-triage.ts` with a thin adapter |
| t6 | `session-store-recovery`, `build-determinism`, `wsl-preflight`, `wsl-tool-path-persistence` | two new, two required: `wsl-preflight.sh` becomes TypeScript |
| t7 | `doctrine-reality-drift` | required: `doctrine-check.sh` becomes `packages/policy/src/doctrine-check.ts` |
| t8 | `v050-release-program` | new |

## Runtime changes owned by t1

`packages/orchestration/src/release-policy.ts` line 55 types `program` as the
literal `"v040"`. `packages/policy/src/release-admission.ts` line 192 and
`packages/policy/src/release-coverage.ts` lines 76 to 132 repeat the literal.
t1 replaces each literal with `ReleaseProgram = "v040" | "v050"` and a
per-program table that maps a program to its register path, its disposition
enum, and its predicate list. Existing v040 tests stay unchanged and pass.

## Coverage register

`coverage.toml` follows the v0.4 shape. `schema_version = 2` adds the
`v060` disposition and renames `v040_owner` to `v050_owner`. The inventory
digest is the SHA-256 of the sorted active package names joined by newlines.
The roadmap digest is the SHA-256 of
`docs/superpowers/specs/2026-09-05-v050-release-design.md`.

## Exit predicates

| # | Command | Expected |
|---|---|---|
| 1 | `node skills/foreman/runtime/dist/architecture-policy.js check --base 00c342b` | `_tag: Pass`, no digest pin for `lane-run.sh` or `watch.sh` in `architecture-adapter.ts` |
| 2 | `test ! -e launcher && grep -c foreman-launch env/reference-manifest.toml` | directory absent, count 0 |
| 3 | `bats tests/lane-run.bats` and `npx tsx scripts/run-tests.ts "packages/orchestration/src/round*.test.ts"` | all pass, ownership carries `containment` |
| 4 | `npx tsx scripts/run-tests.ts "packages/policy/src/verdict*.test.ts" "packages/orchestration/src/evidence-contract*.test.ts"` | all pass, schema accepts `UNVERIFIED` and `UNCOMPUTABLE` |
| 5 | `node skills/foreman/runtime/dist/spec-triage.js --help` and `test -f agents/foreman-discover.md` | exit 0, file present |
| 6 | `node skills/foreman/runtime/dist/fm-session.js recover` on a fresh clone and after `repair`; `npm run verify-runtime` with a symlinked `node_modules`; `secret-scan.test.ts` | recover exit 0 twice, verify-runtime refuses, scan Clean |
| 7 | `node skills/foreman/runtime/dist/doctrine-check.js` | exit 0 |
| 8 | `tools/ci-local.sh` on the candidate, then `git tag --verify` is not required, `git tag -l v0.5.0` | all gates pass, tag present |

## Failure and rollback behavior

A failed tranche stops the family at that child. Rollback is a revert of the
tranche's integration commit. No tranche changes the on-disk formats of
`events.jsonl`, the heartbeat file, or the session sidecar, so a revert needs
no data migration.

## Rejected alternatives

- Keep `v040` hardcoded and copy the runtime for v0.5. Two copies drift.
- Ship the knowledge plane in v0.5. Deferred, see the design doc.
- Skip reconciliation and dispatch existing Bash-targeted tasks. The Iron
  Rule forbids the files they would create.
