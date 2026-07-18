# Foreman roadmap

Architect-maintained release roadmap. Each release links its design/plan docs;
per-lane raw reports live under `docs/research/`. Workflow failures that drive
enhancements are logged in `bugeventlog.md`.

## v0.1.0 — released 2026-07-15

Combined skill: soft/hard modes, five-part specs, cross-vendor lanes
(Grok implement / Codex Sol audit / Claude advisor), worktree fan-out,
docs gate, release-triggered maintenance. Tag `v0.1.0`.

## v0.2.0 — durable lanes (released 2026-07-17)

Crash-safe, observable agent rounds: append-only event log as source of truth,
git-plumbing checkpoints, NATS/JetStream one-way transport, stall watchdog,
resume-from-checkpoint.

- Spec: `docs/superpowers/specs/2026-07-15-durable-lanes-design.md`
- Plan: `docs/superpowers/plans/2026-07-15-durable-lanes.md`
- Status: shipped — T0-T7 + perf bundle (el-emit spawn reduction,
  test-harness fork-tax) merged; deferred merge gate closed green on main
  (full suite 127/127 + docs-check) at `f24057c`. Tag `v0.2.0` (Nightwatch).
  WATCH_VTICK and remaining perf items deferred to v0.2.5 by design.

## v0.2.5 — orchestration hardening (released 2026-07-18)

Eliminated the F1–F6 workflow failure classes (see `bugeventlog.md`) with
the primitives the orchestration deep-research report recommended, keeping
the event-log and checkpoint core: foreman-launch (Bun/Job Objects —
orphans impossible by construction, POSIX build from the same source),
pueue lane admission with per-vendor groups + the host-wide `gate` mutex
and a per-shell quote-preserving submit layer, round ownership (lane-run
--round: the daemon owns implement→gate→report→round_done; attempt-fresh
terminal predicate), event schema v2 (attempt entity, replay, atomic
compaction), VTICK injectable clock + the 10-state watch v2 (heartbeat
liveness, phase thresholds), vendor config isolation plumbing (normalized
vendor-home paths), merge-freshness gate + wt-merge/wt-cleanup repairs,
and the bounded auto-resume supervisor. Six prevention criteria proven
(SC-A live; SC-B..F by permanent tests) — see
`docs/notes/2026-07-18-v025-sc-proof.md`. Suite 127→245 tests; four
product defects caught pre-push by the gate discipline. Tag `v0.2.5` (Beacon).

Honest residuals: T5b real-vendor concurrency verdict UNVERIFIED (grok
CLI absent; caps stay grok=1 codex=1); `[audit.policy]` keys wired but
consumed only from v0.3.0; launcher-absent lanes outside auto-resume
scope; WATCH_VTICK's `bats --jobs` parallelism still deferred.

- Plan: `docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md`
  (as amended by the 2026-07-18 4-lens audit, recorded in the plan itself)
- Reference: `skills/foreman/references/orchestration-hardening.md`
- Depends on: v0.2.0. Feeds: v0.3.0 (adapters spawn via the launcher),
  v0.4.0 (schema v2 telemetry).

## v0.3.0 — session transport (remote branch `dev/foreman-v1`)

Subscription-session workers (zero API keys): codex mcp-server threadId
continuity, Claude `-p/--resume`, Grok headless login auth; model-family
decorrelation; cockpit viewers. Implemented remotely.

- Spec/plan: on the branch (`docs: design spec for session transport`,
  `docs: session transport implementation plan`)
- **Reviewed 2026-07-16 (Codex GPT-5.6 Sol): BLOCKED for direct merge** —
  full report: `docs/research/v030-review/codex-review.md`. Engineering
  quality is good (fail-closed MCP parsing, correct process-group reaping,
  honest security posture, no bats regressions); blockers are structural:
  1. The branch shares NO git ancestry with main (parallel 55-commit
     history), and main has evolved past the architecture the series splices
     into (main's `worker-run.sh` is a stub, no `adapters/` dir, divergent
     `lib/common.sh`). Cherry-pick/`git am` will fail or silently resurrect a
     deprecated hard-mode architecture. Required: deliberate file-by-file
     content-diff re-port onto main's current soft-mode shape — an architect
     decision (revive hard mode vs port into soft-mode path) with advisor
     consult before starting.
  2. The plan's own live-acceptance step (Task 11, `docs/demo-log.md`) was
     never executed — the real `codex mcp-server` tool schema used by
     `adapters/codex.sh` is unverified against a live install; all 46 plan
     checkboxes are unchecked.
- Landing order: after v0.2.0 tags; before v0.4.0's session-reuse tasks (T7).

## v0.4.0 — fast audit (planned 2026-07-16)

Cut audit wall-clock from 27-35 min to <10 min median without losing
cross-vendor rigor. Three-lane planning fan-out complete (search / plan /
scrapling-backed research); architecture: tiered screen→deep audit with an
always-deep floor, sharded parallel audit + mandatory structural pass above a
file threshold, incremental checkpoint-stream audit (flagship, builds on
v0.2.0), audit bundle pre-packaging (no auditor recon), hunk-hash verdict
cache for scoped re-audits, session-thread reuse (builds on v0.3.0), and a
config-driven risk-class → (model, effort, scope) routing table. The
vendor≠worker invariant is centralized in one shared `lib/audit-call.sh` and
enforced at every tier. Verdict schema v2 is additive; `gate-eval.sh`
dual-reads v1/v2 during migration.

Measured levers behind the target (see research citations): effort xhigh→high
(largest single win), parallel shard+consolidate, pre-packaged context
(~19% of Codex wall time is harness/tool-call residual), schema-constrained
terse output, thread reuse + cache-stable prefixes. Combined sanity math:
4-6x → 5-9 min typical.

- Task breakdown (T0-T12): `docs/research/v040/plan-report.md`
- Audit-path map: `docs/research/v040/search-report.md`
- External research: `docs/research/v040/research-summary.md` (+ citations in
  `research-citations.md`)
- Ordering constraint: `audit-run.sh` is owned serially by T3 → T8 → T9.
- Open questions for the architect are listed at the end of the plan report;
  advisor consult on final scope happens before implementation starts.
- Depends on: v0.2.0 (checkpoint stream), v0.3.0 (session transport).

## Later / unscheduled

- tool-check portability: Git Bash-aware Windows probes (WSL CRLF failure is
  fixed by v0.2.5's .gitattributes task).
- (wt-merge gitignore fix and verdict-to-action gate policy moved into
  v0.2.5 Tasks 6–7.)
