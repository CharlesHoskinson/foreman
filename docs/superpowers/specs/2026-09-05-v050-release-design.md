# v0.5.0 "One runtime, honest lanes" — design

Status: design, drafted 2026-09-05 by the architect from repository records.
This file is not an implementation plan. The active plans are the `tasks.md`
files of the OpenSpec packages named below.

v0.5.0 is one sentence: **the lane path runs in one runtime, and a lane can
only report what it proved.**

## How this design was decided

The brainstorming questions were answered from the repository, not from a
live dialogue. Each decision is listed so a reviewer can reject it.

| Question | Decision | Source |
|---|---|---|
| What is the release for? | Finish the TypeScript migration of the lane path and make lane verdicts honest. | Iron Rule in `AGENTS.md`, the 2026-09-05 pidns diagnosis, the open verdict packages |
| Why not the knowledge plane? | The v0.4 notes deferred the SQLite graph store, Council runtime, and MCP transport. They build on the lane path. Fix the path first. | `docs/releases/v0.4.0-notes.md` "Deferred work" |
| What is the baseline? | Commit `00c342bd449948ab2ea5ca0b9d0c890614dd81d6`, the post-v0.4.0 `main` that includes the containment remedy. | `git log` |
| How large? | Eight tranches, the same shape as v0.4. Four new packages, nine reconciled existing packages. | `openspec/changes/v040-release-program` |
| What is out? | Graph store SQLite, Council review plane, the Google lane, quota policy, test-infrastructure hardening, lock hardening, formal suite, telemetry, vendor preflight, profile leasing. All move to v0.6. | Open task counts, 21 to 61 each |
| What proves it shipped? | Eight exit predicates measured on one unchanged commit. | v0.3.1 and v0.4 precedent |

## Approaches considered

1. **Strangler first (chosen).** Move `lane-run.sh` and `watch.sh` into the
   TypeScript round runtime, retire the Bun launcher, and close the three
   verdict packages. Cost: one large architectural package. Benefit: the
   architecture policy stops needing digest pins, and every future lane
   feature has one home.
2. **Knowledge plane first.** Ship the SQLite graph store and the Council
   review plane on top of the pinned Bash path. Cost: every lane change
   during v0.5 needs a policy re-pin. Rejected because the pin is the debt.
3. **Both.** More than 150 open tasks. Rejected because v0.3 fragmented for
   exactly this reason.

## Exit predicates

Each predicate is falsifiable and measured on the exact release candidate.

| # | Predicate | Measurement |
|---|---|---|
| 1 | The lane path is TypeScript | `architecture-policy.js check --base 00c342b` passes. `LANE_RUN_BODY_SHA256` and the `watch.sh` pin no longer exist. Both scripts pass the thin-adapter grammar. |
| 2 | One launcher | The `launcher/` tree is absent. `env/reference-manifest.toml` has no `foreman-launch` build row. The Node launcher suite includes a live strong cascade and a hostile escape closure. |
| 3 | Containment is enforced in the runtime | The round runtime probes, records `containment` in `ownership`, refuses an implementation lane without an approval, and picks the kill target. `tests/lane-run.bats` passes through the thin adapter. |
| 4 | Verdicts have three outcomes | The verdict schema accepts `UNVERIFIED` and `UNCOMPUTABLE`. The gate refuses an ungrounded audit. Every lane type asserts attempt-fresh deliverables. |
| 5 | Exploratory work has a route | Spec triage runs in TypeScript before dispatch. The discover lane exists and is documented. |
| 6 | The host tells the truth | WSL preflight runs in TypeScript. `fm-session recover` works on a fresh clone and after `fm-session repair`. `verify-runtime` refuses a symlinked `node_modules`. `secret-scan` scans a clean checkout within bounds. |
| 7 | Doctrine matches code | `doctrine-check` runs offline on the candidate and passes. |
| 8 | Release converges | Every gate passes on the unchanged candidate. Tag `v0.5.0` exists. |

## Package map

| Tranche | OpenSpec owner | Status | Main result |
|---|---|---|---|
| 1 | `v050-release-program` | new | Coverage register, program-parameterized release runtime, Endstop family |
| 2 | `lane-runtime-typescript` | new | `lane-round` owns the round, thin `lane-run.sh` and `watch.sh` adapters, pins retired |
| 3 | `launcher-node-port` | reconcile | Bun tree retired, Windows Job Object parity, cascade proofs recorded |
| 4 | `three-outcome-verdicts`, `audit-groundedness-gate`, `evidence-contracts` | reconcile | Honest verdict vocabulary, grounded gate, attempt-fresh evidence |
| 5 | `spec-triage-gate`, `foreman-discover-lane` | reconcile to TypeScript | Exploratory route |
| 6 | `session-store-recovery`, `build-determinism`, `wsl-preflight`, `wsl-tool-path-persistence` | two new, two reconcile | Host truth |
| 7 | `doctrine-reality-drift` | reconcile to TypeScript | Doctrine claims registry and checker |
| 8 | `v050-release-program` | new | Candidate verification and publication |

## Deferred to v0.6

`graph-store-port`, `council-review-plane`, `agy-lane-activation`,
`vendor-concurrency-and-quota`, `test-infrastructure-hardening`,
`lock-primitive-hardening`, `formal-model-suite`,
`decision-lineage-and-telemetry`, `vendor-preflight`, `profile-use-leasing`.

## Review gate

The four new packages and this design were audited by GPT-6 Astra through the
Codex CLI in read-only mode. The audit record and the rework are in
`docs/research/v050/`.
