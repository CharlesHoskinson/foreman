# Foreman roadmap

Architect-maintained release roadmap. Each release links its design/plan docs;
per-lane raw reports live under `docs/research/`. Workflow failures that drive
enhancements are logged in `bugeventlog.md`.

## v0.1.0 — released 2026-07-15

Combined skill: soft/hard modes, five-part specs, cross-vendor lanes
(Grok implement / Codex Sol audit / Claude advisor), worktree fan-out,
docs gate, release-triggered maintenance. Tag `v0.1.0`.

## v0.2.0 — durable lanes (in flight, this branch)

Crash-safe, observable agent rounds: append-only event log as source of truth,
git-plumbing checkpoints, NATS/JetStream one-way transport, stall watchdog,
resume-from-checkpoint.

- Spec: `docs/superpowers/specs/2026-07-15-durable-lanes-design.md`
- Plan: `docs/superpowers/plans/2026-07-15-durable-lanes.md`
- Status: T0-T2 merged; shared-lib hardening (CAS checkpoints, explicit
  failure contracts, CR-safe reads) merged 2026-07-16; T3-T6 implementing in
  parallel worktrees; T7 (config loader + doctrine) next; tag on completion.

## v0.3.0 — session transport (remote branch `dev/foreman-v1`)

Subscription-session workers (zero API keys): codex mcp-server threadId
continuity, Claude `-p/--resume`, Grok headless login auth; model-family
decorrelation; cockpit viewers. Implemented remotely; needs architect review,
rebase onto post-v0.2.0 main, and audit before merge.

- Spec/plan: on the branch (`docs: design spec for session transport`,
  `docs: session transport implementation plan`)

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

- wt-merge fix: auto-commit aborts when FOREMAN_REPORT files are gitignored
  (see bugeventlog 2026-07-16); workaround is manual squash-apply.
- tool-check portability: WSL CRLF failure; Git Bash-aware Windows probes.
- Verdict-to-action merge-gate policy in config (WARNING semantics), so the
  ship gate is defined ahead of time instead of per-round.
