# v0.2.5 — orchestration hardening Implementation Plan

> **For agentic workers:** this plan executes through the **foreman skill** —
> each task becomes a five-part spec routed to an implementer lane in an
> isolated worktree, architect-verified, cross-vendor audited. A plan-time
> audit of task specs precedes implementation (as durable-lanes did).

**Goal:** eliminate the F1–F6 failure classes recorded in `bugeventlog.md` by
adopting the targeted primitives recommended by the orchestration deep-research
report (`docs/research/orchestration-deep-research-report.md`): native Windows
process ownership, queue-based lane admission, typed phase-aware lane states,
vendor config isolation, and merge-freshness gates — while keeping the
event-log + git-checkpoint core (validated by the report as sound).

**Decision (user-ratified 2026-07-16):** keep Foreman in-house; adopt Job
Objects launcher + pueue; adapt event schema to durable-execution best
practice; **defer** Prefect (unless the control plane moves to Python next
quarter), Temporal (unless multi-host), Hatchet/Windmill (Docker-shaped),
LangGraph-as-core (no process ownership).

## What we already have vs what the report adds

| Layer | Have (v0.2.0) | v0.2.5 adds |
|---|---|---|
| Source of truth | events.jsonl (el_emit/el_read, cursors) | attempt entity, ownership + merge-base fields, compaction policy |
| Checkpoints | refs/checkpoints CAS (ckpt_snapshot/latest) | unchanged (validated) |
| Lane entry | lane-run.sh (stream tee, heartbeat/checkpoint loop, round_done) | spawns CLIs through the native launcher; WAITING_CHILD terminal rule |
| Process ownership | bash + GNU timeout (fails: F1, F2) | **foreman-launch**: Job Object, KILL_ON_JOB_CLOSE, graded stop |
| Admission control | none (F3: grok lanes serialized blind) | **pueue** per-vendor groups (grok cap 1 until proven) |
| Liveness | watch.sh 3-state, event-ts age | typed states QUEUED…WAITING_CHILD…, phase-aware thresholds, heartbeat-carried PID/JobID/byte counters |
| Vendor isolation | shared ~/.grok, ~/.codex | per-lane GROK_HOME / CODEX_HOME (UNVERIFIED as concurrency remedy — destructive test) |
| Merge safety | none (F6: parallel-history branch) | dispatch merge-base recorded + pre-merge freshness gate; wt-merge gitignore fix |

## Tasks

### Task 0: pueue adoption — install, groups, doctrine
Install pueue (user-local, Windows binary; Apache/MIT). Create groups
`grok` (parallel 1), `codex` (parallel 1), `claude` (parallel 3), `misc`.
Wrapper `scripts/lane-queue.sh add|status|kill` (JSON status via pueue).
Doctrine: implement/audit lanes enqueue instead of direct-spawn when pueue
present; degrade gracefully to direct spawn when absent.
Test: bats — enqueue two grok-group tasks, assert serial execution; JSON
status parse; absent-pueue fallback.

### Task 1: foreman-launch — native Windows launcher (Job Objects)
Single-file compiled launcher (language decided at plan-time audit; C# .NET
single-file AOT or Go — no runtime install may be required on the host).
Contract: `foreman-launch --timeout SECS --heartbeat-file F --grace 10 -- CMD...`
- Creates a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; child +
  descendants assigned; closing the last handle kills the tree by construction.
- Forwards stdio unbuffered; heartbeat line every 15–30s to F (JSON: pid,
  job id, alive, stdout_bytes, stderr_bytes, elapsed).
- Graded stop on timeout/cancel: CTRL_BREAK → 10s grace → close job handle →
  TerminateJobObject fallback. Exit codes: child's; 124 timeout; 125 launcher
  error (documented).
- POSIX fallback path (WSL/CI): setsid + kill -PGID with the same contract so
  lane-run stays portable.
Test: bats (via a child that spawns grandchildren): timeout kills the WHOLE
tree (no survivor PIDs); exit-code passthrough; heartbeat file grows.

### Task 2: lane-run.sh launcher integration + WAITING_CHILD rule
lane-run.sh spawns CMD via foreman-launch (when present; direct spawn
fallback logged as degraded). Emits ownership event at spawn: {pid, job_id,
worktree, config_dir, launcher:true}. Terminal rule (kills F2): lane-run may
emit round_done ONLY after launcher reports child exit AND the report
artifact exists; otherwise emits `waiting_child` state events.
Folds in the four Round B audit fixes for lane-run (prompt-emit failure must
not abort CMD; reap background loop before final checkpoint; signal
forwarding — now delegated to the launcher; stream-activity check scoped to
current round).

### Task 3: event schema v2 — attempt entity, ownership, freshness, compaction
Additive schema: events carry {run, lane, attempt, seq, ts, type, state?,
pid?, job_id?, worktree?, config_dir?, merge_base?, checkpoint?}. New helper
`el_attempt_new` (monotonic attempt id per lane). Cursor semantics extended:
replay "after attempt X checkpoint Y". Compaction: `el_compact` keeps
structural milestones (prompt/state transitions/checkpoint/round_done)
immutable, drops heartbeat chatter older than N days into a rollup line.
gate-eval/watch/resume/bridge read v1 and v2 (additive, no breakage).

### Task 4: watch.sh v2 — typed states, phase-aware thresholds, heartbeats
States: QUEUED, STARTING, RUNNING_IMPL, RUNNING_AUDIT, VERIFYING,
WAITING_CHILD, STALLED, DEAD, SUCCEEDED, FAILED. Liveness from launcher
heartbeats + phase events, NOT file writes. Default thresholds (config-
overridable, tuned later from traces): STARTING stale 90s; RUNNING_IMPL 5m;
RUNNING_AUDIT 15m; VERIFYING 10m; grace 10s. Principle (non-negotiable):
queued is not running; verifying is not stalled; silence alone never
classifies a lane. Folds in the three Round B T5 audit fixes (malformed-ts
must not reset age; alert emission foreground/reaped; restart-safe
completion check).

### Task 5: vendor config isolation + destructive concurrency test
Per-lane GROK_HOME / CODEX_HOME (and redirected Claude project memory where
applicable) provisioned by wt-new/lane-run; recorded in the ownership event.
Destructive test protocol (documented, run manually once per vendor): N=2,3
same-vendor lanes on throwaway specs; observe serialization vs true
parallelism; record results in docs/research/vendor-concurrency-results.md;
pueue caps raised ONLY on green results. Until then: grok=1, codex=1 (report:
UNVERIFIED beyond that).

### Task 6: merge-freshness gate + wt-merge repair
`scripts/merge-gate.sh RUN LANE`: at dispatch, record merge-base with
origin/main in the lane's events; at pre-merge, re-verify (a) merge-base
still exists, (b) lane branch contains it, (c) base not stale beyond
configured commits/days. No common ancestor → non-mergeable verdict +
respawn-from-fresh-base recommendation (never salvage automation). Fix the
wt-merge gitignored-FOREMAN_REPORT bug (build add-list from status
--porcelain; bats case with gitignored reports). Remote-lane preflight
doctrine: reject dispatch when merge-base fails.

### Task 7: docs, doctrine, config, .gitattributes
references/orchestration-hardening.md (launcher contract, state machine
diagram, pueue groups, isolation, freshness gate); SKILL.md doctrine updates;
config keys ([launcher], [queue], [freshness], threshold overrides);
`.gitattributes` `*.sh text eol=lf` + renormalize (kills the WSL CRLF
failure); verdict-to-action merge-gate policy keys ([audit.policy]:
warning_low_resolved=merge, warning_medium=ask, blocked=never) — closes the
gate-semantics bugeventlog item.

## Ordering & parallelism
T0, T1 first (T1 is the critical path; T0 independent). T2–T4 after T1
(T2 needs launcher; T3 schema before T4 consumes it — T3 ∥ T2). T5, T6 ∥
after T0/T1. T7 last. Every implement round through worktree lanes; plan-time
audit of T1/T2/T3 specs before building (they are the dangerous layer).

## Sequencing vs other releases
- v0.2.0 durable-lanes finishes first (Round B rework + merge + T7 + tag).
- v0.2.5 then hardens the layer under it (this plan).
- v0.3.0 session-transport re-port lands ON TOP of the launcher (its adapters
  spawn through foreman-launch; port the group_timeout reaping fix's intent).
- v0.4.0 fast-audit consumes v0.2.5's schema v2 for its telemetry (T10).

## Success criteria
- A kill -9 of any wrapper leaves ZERO orphan CLI processes (launcher test).
- A lane cannot report done while its child runs (WAITING_CHILD test).
- Four concurrent grok-group submissions execute serially via pueue with
  queue state visible as QUEUED, not STALLED.
- A parallel-history branch is rejected by merge-gate with a clear verdict.
- Full suite + docs-check green; all v0.2.0 behavior unregressed.
