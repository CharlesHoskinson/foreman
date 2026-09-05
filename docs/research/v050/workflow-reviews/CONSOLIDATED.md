# Workflow weight review: consolidation

Four independent reviewers, 2026-09-05, commit `07f4569`. Two Fable 5.1
subagents (round latency, architect weight) and two GPT-6 Astra runs through
the Codex CLI in read-only mode (gates and tests, orchestration ceremony).
Each had one lens and the same baseline. The four reviews sit beside this
file. Model identities are requested ids and self-reports, not verified.

## The measurement that matters

| Measure | Value | Source |
|---|---|---|
| Model working time per round, median (218 rounds) | 4.1 min | `~/.foreman/runs/*/events.jsonl`, `prompt` to `round_done` |
| Ceremony gap between rounds, median (209 gaps) | 5.5 min, mean 14.9 | `round_done` to next `prompt` |
| Today's round family (pueue 1455 to 1466), wall clock | 279 min | round-latency review |
| Of which a model was running | 104 min (37%) | same |
| Of which a gate was running | 5.5 min (2%) | same |
| Of which nothing was running | 169 min (61%) | same |
| Commits in the last 90 days at or under 3 files and 150 lines | 477 of 1,069 (45%) | `git log --shortstat` |
| Architect cold read before the first action | 26.4k tokens (83.7k mandated) | architect-weight review |
| `npm run verify` executions per change today | up to 4 | round-latency review |
| `npm test` | 213 s | baseline |
| One Bats file (39 cases) under the mutex | 111 s, about 36 min for 771 cases | baseline |
| typecheck, build, verify-runtime, policy check | 4.9 s, 3.5 s, 8.1 s, 0.8 s | baseline |

The compiler and the launcher are not the weight. The harness is idle more
than the model works, the same verification runs up to four times per
change, and the architect reads 26k tokens of doctrine before typing a
14-flag dispatch line by hand.

## Where the reviewers converged

| # | Proposal | Reviewers | Expected effect |
|---|---|---|---|
| 1 | Verify once per candidate tree. A host-written, content-addressed verification receipt is reused by the architect, the merge gate, and the landing step. Worker reports never populate it. | round-latency 1, gates 1, ceremony 1 | Two of four `npm run verify` runs removed, about 400 s per change |
| 2 | One command per round. A bound change descriptor derives root, family, child, profile, base, report path, and queue group from registered authority; `lane-round dispatch` and `lane-round wait` replace six manual steps and a 1,100-character argv. | round-latency 3, ceremony 2, architect-weight | 5 to 15 min of idle per round removed |
| 3 | Tiered gate plan with a small-change tier. Machine-readable plan, entry by affected-property closure, pre-commit verdict under 60 s, full verdict under 10 min, full tier still required before landing executable code. | architect-weight 1 and 3, gates 3, ceremony light lane, round-latency 5 | One-file change from 45 to 60 min down to about 15 min; per-round gate from minutes to under 30 s |
| 4 | The watchdog survives the gate phase and reports terminal state immediately; one runtime owner for execute, observe, and recover. | round-latency 2, ceremony 4 | Removes a false `AGENT_ABANDONED` in 4 of 4 gate phases and about 7.5 s mean detection delay |
| 5 | Audit pipelined automatically on the passing checks receipt (the release policy order is unchanged), and bounded automatic rework on a failed gate. | round-latency 4 and 6 | The human step between gate and audit removed |
| 6 | Test suite partition: deterministic TypeScript shards in parallel, one exclusive phase for load-sensitive Bats, the mutex kept until isolation is proven. | gates 2 | Up to 2.5x on the parallel fraction |
| 7 | Doctrine compression and task-specific doctrine. A 150-line SKILL core with a rule-id inventory, Endstop grammar moved to `--help`, history split from doctrine, stale instructions fixed. | architect-weight 2, ceremony 7 | Cold read from 26.4k to about 12k tokens |
| 8 | Landing transaction: freeze, verify, audit, recheck, apply, archive, clean up as one step. | ceremony 5 | Removes the `wt-merge.sh:120` ordering hazard and three manual steps |
| 9 | Queue admission does four subprocess calls instead of twelve; profile defaults; incremental docs and OpenSpec checks; one runtime rebuild on the routine path; secret scan separated from the unit suite. | ceremony 3 and 6, gates 4, 5, 6 | Seconds each, fewer retries |
| 10 | Instrument the round before and after: `queue_wait_s` is never recorded today. | round-latency 8 and 9 | Makes every other number measurable |

## What must not be cut (union)

Exact candidate and dependency identity. Protection against concurrent
writers. Real process and containment tests. Timeouts, cancellation, and
lock ownership. Positive and negative controls. Non-empty test selection
and complete result accounting. Skip budgets and capability evidence.
Source-to-bundle comparison and copied-install smoke tests. Secret
traversal boundaries. Durable Endstop budgets and absorbing terminal
states. Attempt-bound deliverables. Independent host verification and
cross-vendor audit. A full integration gate for non-trivial code before
landing. Bounded exclusive recovery. Queue quoting and measured caps.
Archive before delete. The existing Bats mutex while tests remain
load-sensitive. The Node.js 24 and TypeScript rule.

## Defects found on the way

- `CLAUDE.md` and `RESUME.md` order `fm-session.py recover`, a file that does not exist.
- `docs-check.sh` is red on a clean checkout (1,668 markdownlint findings in a raw vendor capture, codespell on a `.qnt` file).
- `AGENT_TRAPS.md` says "read in full" and nothing enforces or names the read.
- `wt-new.sh` installs no dependencies, which cost a lost round on 2026-09-05.
- `round_done.phases.queue_wait_s` is always null because nothing writes `LANE_QUEUED_AT`.
- `watch.sh` exits 5 with a false `AGENT_ABANDONED` about 13 s after `state: verifying`.
- `tools/ci-local.sh:262` converts `RESULT SHADOW` into `GATE PASS`.

## Targets adopted by `workflow-weight-reduction`

| Target | Now | Goal |
|---|---|---|
| Idle share of a round family | 61% | at most 25% |
| One-file change, end to end | 45 to 60 min | at most 15 min |
| Pre-commit verdict | minutes | at most 60 s |
| Full verdict | about 40 min with Bats | at most 10 min |
| `npm run verify` per candidate tree | up to 4 | 1 |
| Architect cold read | 26.4k tokens | at most 12k tokens |
| Manual steps per round | 28 | at most 6 |
