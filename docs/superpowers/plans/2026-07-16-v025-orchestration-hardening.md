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
practice; **defer** Prefect (only if the control plane ever moves to Python),
Temporal (only if multi-host), Hatchet/Windmill (Docker-shaped),
LangGraph-as-core (no process ownership). Lanes implement the tasks —
scheduling is by task order and gate results, not calendar estimates.

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

### Bun adoption (stack decision, user-directed 2026-07-16)

Bun (v1.3.x, MIT, maintained by Anthropic — bun.com) joins the stack, scoped:

- **In scope for v0.2.5:** foreman-launch is written in TypeScript on Bun and
  shipped as a `bun build --compile` self-contained executable; `bun` is a
  DEV-profile tool in env/reference-manifest.toml + bootstrap scripts (users
  of the compiled launcher need nothing). Launcher unit tests use `bun test`;
  the harness-level bats suite still exercises the compiled binary.
- **Why Bun over Go/C# here:** identical capability for the Job-Objects FFI
  surface; single language for launcher + its tests; cross-compilation +
  code signing built in; Anthropic stewardship aligns with the stack; and
  Bun Shell offers a credible escape hatch from the bash-on-Windows failure
  class (CRLF, mkdir mutexes, PIPESTATUS, no flock) that produced several
  bugeventlog entries.
- **Explicitly OUT of v0.2.5 scope:** rewriting existing audited bash libs
  (eventlog/checkpoint/watch/resume/bridge) in Bun. A separate
  "Bun Shell migration assessment" happens after T1 ships, using the
  launcher experience as evidence; candidate for v0.3.x+ only if it clearly
  reduces the portability defect rate.

### Task 0: pueue adoption — install, groups, doctrine

Install pueue (user-local, Windows binary; Apache/MIT — v4.0.4 binaries
staged at `~/.foreman/tools/pueue/` 2026-07-18; no package-manager route
exists on Windows). Create groups `grok` (parallel 1), `codex` (parallel 1),
`claude` (parallel 3), `misc`, **and `gate` (parallel 1)** — the host-wide
bats mutex: ANY bats invocation (lane, auditor, architect) enqueues in
`gate`, making gate serialization structural instead of discipline
(2026-07-18 audit, lens D; checkpoint calls this mandatory).
Wrapper `scripts/lane-queue.sh add|status|kill` (JSON status via pueue) with
a `LANE_QUEUE_FORCE_MISSING` test hook mirroring the
`DOCS_CHECK_FORCE_MISSING` precedent in docs-check.sh.
Doctrine: implement/audit lanes enqueue instead of direct-spawn when pueue
present; degrade gracefully to direct spawn when absent. Decide + document
pueued autostart on Windows (undocumented upstream): empirically test client
auto-spawn first; fall back to a logon Scheduled Task.
Test: bats — enqueue two grok-group tasks via a PATH-shim `grok`, assert
serial execution; JSON status parse; absent-pueue fallback forced via
`LANE_QUEUE_FORCE_MISSING` (shim needed for the present branch, force-hook
for the absent branch — both deterministic).

### Task 1: foreman-launch — native Windows launcher (Job Objects)

**Deep-researched and fully planned — see the dedicated implementation plan:
`docs/superpowers/plans/2026-07-16-foreman-launch.md`** (four research lanes,
all GO-WITH-CAUTIONS, with the complete Job Object chain empirically
validated on this host from a compiled Bun binary: reports under
`docs/research/bun025/`). Decisions locked there: Bun 1.3.14 pinned (Rust-core
1.4.x soak rule); Bun.spawn + immediate job assignment (suspended-start
CreateProcessW deferred as the escalation path for the microsecond grandchild
race); six-call kernel32 FFI surface; no hot FFI polling (#31941 tripwire);
graded stop = cooperative → grace → TerminateJobObject; signed x64 artifact +
CI FFI smoke; POSIX setsid/kill(-pgid) build from the same source.
Contract (frozen): `foreman-launch [--timeout SECS] [--grace SECS=10]
[--heartbeat-file F] [--heartbeat-interval SECS=15] -- CMD...` — exit codes:
child's, 124 timeout, 125 launcher error.

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

### Task 2: lane-run.sh launcher integration + round ownership + WAITING_CHILD rule

**Round ownership (v0.2.5 core; 2026-07-18 audit, lens B).** The
launched/enqueued unit is `lane-run.sh` running the WHOLE round — implement
(vendor CLI via `foreman-launch`) → check → audit-gate → write
`FOREMAN_REPORT` → `round_done` — NOT the bare vendor CLI. `lane-run.sh`
gains a `--round GATE_CMD REPORT_PATH` mode: after the CLI child exits, it
runs `GATE_CMD` (itself launched through `foreman-launch` for tree-kill, so
heartbeats continue through the gate phase), asserts `REPORT_PATH` is
attempt-fresh, then emits `round_done`. The round is submitted to pueue (T0);
the pueue daemon owns it for its full lifetime. Because the supervisor is
never the agent's turn, an agent that backgrounds-and-stops cannot strand the
round. `--detach` (foreman-launch) is the degrade path when pueue is absent.

lane-run.sh spawns CMD via foreman-launch (when present; direct spawn
fallback logged as degraded — the existing `kill_cmd_bounded` + taskkill
sweep is GATED to this launcher-absent path only, since Job-Object
KILL_ON_JOB_CLOSE supersedes it). Emits ownership event at spawn: {pid,
job_id, worktree, config_dir, launcher:true}. `round_done.exit_code` gains
documented launcher codes 124 (timeout) / 125 (launcher error); `cmd_pid`
semantics change (captures the launcher, not CMD) — the header CONTRACT
block is rewritten accordingly.
Terminal rule (kills F2; hardened per lens B): lane-run may emit `round_done`
ONLY after the launcher reports exit of the **whole round-script** (not
merely the vendor CLI) AND an **attempt-fresh** report artifact exists
(report carries the current attempt id, or mtime newer than the
attempt-start ts). A prior round's report never satisfies the predicate.
Otherwise it emits `waiting_child` state events.
NOTE (drift audit, lens A): the four Round B lane-run audit fixes named in
the original plan are ALREADY SHIPPED on main (v0.2.0) — do NOT re-implement
them; regressing audited code is the risk now.

### Task 3: event schema v2 — attempt entity, ownership, freshness, compaction

Additive schema — v2 fields NEST INSIDE `payload` (2026-07-18 drift audit:
`el_emit` is fixed 5-positional and writes `{seq,ts,type,lane,commit?,payload}`;
top-level additions are a signature migration, not additive). Payload gains
{attempt, state?, pid?, job_id?, worktree?, config_dir?, merge_base?}. The
checkpoint SHA stays in the existing top-level **`commit`** field — the
originally planned `checkpoint?` field collides with what `resume.sh:74`
actually reads and would silently break checkpoint recovery. The existing
`alert` event type joins the documented vocabulary. New helper
`el_attempt_new` (monotonic attempt id per lane). Cursor semantics: the
integer line-number cursor that `nats-bridge` depends on is UNCHANGED;
attempt/checkpoint replay ("after attempt X checkpoint Y") is layered on top
as a new read helper. Compaction: `el_compact` keeps structural milestones
(prompt/state transitions/checkpoint/round_done/alert) immutable, drops
heartbeat chatter older than N days into a rollup line — rollup lines written
atomically (tmp+rename), since `el_read` halts on the first malformed line.
PIPE_BUF is a non-issue (the `.seq.lock` mutex serializes appends).
Also folds in the el_emit F5/F6 spawn reductions (deferred from the v0.2.0
perf bundle) — same file, one gate.
gate-eval/watch/resume/bridge read v1 and v2 (additive, no breakage).

### Task 4: watch.sh v2 — SPLIT into T4a (VTICK) then T4b (typed states)

**T4a — VTICK first (2026-07-18 audit, lens D).** Injectable clock for
watch.sh: replace the EPOCHREALTIME/EPOCHSECONDS reads and
`wd_sleep_remainder` with a test-drivable clock source; fix the
`wd_sleep_remainder` fractional-tick integer-arithmetic crash; cover BOTH the
latched (`wd_sample`) and unlatched real-time paths. Built TEST-FIRST against
the existing wall-clock watch.bats integration tests (the checkpoint's
tests-18/23 class; renumbered since). The lost `foreman/dl2d/implement/vtick`
diff (~30 lines) is reconstructed from bugeventlog + the 2026-07-17
checkpoint's VTICK section, not recovered.

**T4b — typed states, on the injected clock.** States: QUEUED, STARTING,
RUNNING_IMPL, RUNNING_AUDIT, VERIFYING, WAITING_CHILD, **AGENT-ABANDONED**,
STALLED, DEAD, SUCCEEDED, FAILED. AGENT-ABANDONED (child exit confirmed, no
`round_done`, no attempt-fresh report for the current attempt) is a
first-class alertable state that triggers the Task 8 supervisor — never
SUCCEEDED, never a silent false-stall during the gate phase. Liveness from
launcher heartbeats + phase events, NOT file writes (bats gates write to
/tmp, not the worktree — mtime liveness false-stalls; the gate runs under
the launcher so heartbeats continue). Default thresholds (config-overridable
under the existing `[durable]` namespace): STARTING stale 90s; RUNNING_IMPL
5m; RUNNING_AUDIT 15m; VERIFYING 10m; grace 10s — integration-tested via the
T4a injected clock (impossible on a wall clock). Principle (non-negotiable):
queued is not running; verifying is not stalled; silence alone never
classifies a lane.
NOTE (drift audit, lens A): the three Round B T5 audit fixes named in the
original plan are ALREADY SHIPPED on main (v0.2.0) — do NOT re-implement.

### Task 5: vendor config isolation — SPLIT into T5a (plumbing) / T5b (verdict)

**T5a — isolation plumbing (now).** Per-lane GROK_HOME / CODEX_HOME (and
redirected Claude project memory where applicable) provisioned by
wt-new/lane-run; recorded in the ownership event. CAUTION (lens C): Bun issue
12970 — compiled exes strip `\` from env vars on Windows; T1's launcher must
pass these paths through verbatim (test with a backslashed Windows path).
Shim-based bats: PATH-shim vendor CLI proves pueue serialization (grok cap 1)
without the real CLI; provisioning asserted via env vars in the ownership
event.

**T5b — real-vendor destructive verdict (deferred; do NOT gate T5
completion on it).** Protocol documented, run manually once per vendor: N=2,3
same-vendor lanes on throwaway specs; observe serialization vs true
parallelism; record in docs/research/vendor-concurrency-results.md; pueue
caps raised ONLY on green results. The codex half can run now; the grok half
is BLOCKED (grok CLI missing on this host). Until then: grok=1, codex=1
(report: UNVERIFIED beyond that).

### Task 6: merge-freshness gate + wt-merge repair

`scripts/merge-gate.sh RUN LANE`: at dispatch, record merge-base with
origin/main in the lane's events; at pre-merge, re-verify (a) merge-base
still exists, (b) lane branch contains it, (c) base not stale beyond
configured commits/days. No common ancestor → non-mergeable verdict +
respawn-from-fresh-base recommendation (never salvage automation). Fix the
wt-merge gitignored-FOREMAN_REPORT bug — refined per the drift audit: the
shipped code already uses an exclude-pathspec and STILL aborts; the fix must
stop naming the report paths in ANY pathspec at BOTH wt-merge.sh:57 and :59
(build the add-list from `status --porcelain` file output; porcelain never
lists ignored files), and the bats case must use a genuinely gitignored tree.
Also fix the wt-cleanup report-archiver glob (2026-07-17 data loss: only
fixed FOREMAN_REPORT names archived, versioned audit reports V2/V3/V4
dropped) — archive `FOREMAN_REPORT*.*` + `DIFF_*.patch`.
Remote-lane preflight doctrine: reject dispatch when merge-base fails.

### Task 7: docs, doctrine, config

references/orchestration-hardening.md (launcher contract, state machine
diagram, pueue groups, isolation, freshness gate); SKILL.md doctrine updates;
config keys for [launcher], [queue], [audit.policy] and the T4b thresholds.
CRITICAL (drift audit, lens A): the shipped config loader
(`lib/config.sh`, v0.2.0 T7) is a CLOSED ALLOWLIST — every new key must be
added to BOTH the `_cfg_parse_toml` case allowlist AND the `_CFG_ENV_VAR`
table, and consumed via the shipped `cfg_load`/`cfg_get` interface, or it
silently no-ops. New thresholds go under the existing `[durable]` namespace
(no parallel `[freshness]` home); `[audit.policy]` needs its own allowlist
entry (dotted section parses but is currently skipped).
Verdict-to-action merge-gate policy keys ([audit.policy]:
warning_low_resolved=merge, warning_medium=ask, blocked=never) — closes the
gate-semantics bugeventlog item.
(`.gitattributes` moved OUT of this task to T-INFRA — it must land first,
not last; see the 2026-07-18 audit section.)

## Ordering & parallelism (REVISED 2026-07-18 — see audit section)

**T-INFRA first** (gate-speed foundation: .gitattributes/CRLF renormalize +
slow/fast test tagging + inline-setup consolidation; optional `bats --jobs`
on the fast subset only, off the critical path). Then T0 ∥ T1 (T1 is the
critical path). T2 after T1 (needs launcher; includes round ownership).
T3 ∥ T2 after T-INFRA (schema before T4b). T4a (VTICK) after T3, BEFORE T4b
(typed states are untestable without the injected clock). T5a, T6 ∥ after
T0/T1; T5b deferred. T8 (auto-resume) TRAILS T2+T3 (it consumes the
round-script and attempt-entity interfaces they define — advisor 2026-07-18).
T7 last. Every implement round through worktree lanes; plan-time audit of
T1/T2/T3 specs before building (they are the dangerous layer). Hard gate:
T-INFRA(a) renormalize commits to main BEFORE any lane worktree is cut, or
CRLF churn re-collides in every lane merge.

## Sequencing vs other releases

- v0.2.0 durable-lanes finishes first (Round B rework + merge + T7 + tag).
- v0.2.5 then hardens the layer under it (this plan).
- v0.3.0 session-transport re-port lands ON TOP of the launcher (its adapters
  spawn through foreman-launch; port the group_timeout reaping fix's intent).

- v0.4.0 fast-audit consumes v0.2.5's schema v2 for its telemetry (T10).

## Success criteria

- A kill of any wrapper leaves ZERO orphan CLI processes (launcher test —
  per-build phrasing: Windows = `taskkill /F` on the launcher winpid from the
  heartbeat file, tree observed via `tasklist`; POSIX = `kill -9` + pgid
  observation).
- A lane cannot report done while its child runs (WAITING_CHILD test).
- Four concurrent grok-group submissions execute serially via pueue with
  queue state visible as QUEUED, not STALLED.
- A parallel-history branch is rejected by merge-gate with a clear verdict.
- Full suite + docs-check green; all v0.2.0 behavior unregressed.

Prevention criteria (added 2026-07-18, lens B — SC-A/SC-B are load-bearing):

- **SC-A agent-stop survivability:** a round whose dispatching agent ends its
  turn immediately after launch still reaches `round_done` with an
  attempt-fresh report and a passing gate, zero manual resume (launch via
  pueue/detached; kill the parent shell; assert completion from the event
  log alone).
- **SC-B whole-round ownership:** killing the launcher/parent DURING the
  gate/report phase leaves zero orphan gate processes AND classifies the lane
  WAITING_CHILD/AGENT-ABANDONED, never SUCCEEDED.
- **SC-C bounded auto-resume:** an abandoned lane is auto-resumed from its
  last checkpoint and completes; a never-completing round stops after exactly
  `[resume] max_attempts` re-dispatches + one terminal `abandoned` alert —
  assert no (N+1)th respawn.
- **SC-D stale-report immunity:** `round_done` is NOT emitted when only a
  prior round's report is present (attempt-fresh predicate).
- **SC-E no concurrent writers on resume:** auto-resume refuses to
  re-dispatch while a live Job Object or `lane.lock` exists for the prior
  attempt.
- **SC-F completion provable without the agent:** a lane's completion is
  decidable from the event log + refs alone with the dispatching agent
  absent; "agent gone + no round_done" never reads as done and never as a
  false stall during the gate phase.

## Plan audit — 2026-07-18 (4-lens, pre-implementation)

Deep planning cycle before execution: four parallel read-only audit lanes
(drift, prevention-gap, environment, sequencing) under the Fable architect;
full reports in `docs/research/v025-plan-audit/`. Task texts above were
amended in place; this section records the NEW tasks and the standing
decisions the lanes must honor.

### NEW Task T-INFRA: gate-speed foundation (runs FIRST)

1. `.gitattributes` with `*.sh text eol=lf` + `git add --renormalize .`
   (architect-run; lane-run.sh is CRLF today and WSL lanes hit `pipefail\r`).
2. Slow/fast test tagging: `# bats test_tags=slow` on wall-clock tests
   (watch.bats, lane-run.bats timing cases; launcher timeout tests when they
   land); inner-loop lane rounds run `bats --filter-tags '!slow'`; full set
   at merge.
3. Inline-setup consolidation (perf B#2-half2) — lower per-test fork tax.
4. OPTIONAL, off critical path: `bats --jobs` on the fast subset only, only
   after VTICK (GNU parallel via GitHub mirror or WSL; host proxy strips
   gnu.org). Never on slow/wall-clock tests; never violates the `gate` mutex.

Rationale: the v0.2.0 force-merge was caused by a 40-min gate under time
pressure. Suite growth estimate for v0.2.5 is 127 → ~170-190 tests with
wall-clock minutes growing faster than count; without T-INFRA + T4a the gate
re-enters the regime that caused the failure this release exists to fix.

### NEW Task 8: auto-resume supervisor (bounded)

New `scripts/lane-supervise.sh`, run under the pueue daemon on a fixed
interval (degrade: maintenance.sh). No new state store — reads the v0.2.0
event log + checkpoint refs + T1 heartbeats. Classifies a lane/attempt
**ABANDONED** iff launcher reported child exit (or Job Object gone) AND no
`round_done` for this attempt AND no attempt-fresh report. On ABANDONED: run
`resume.sh RUN LANE WT`, emit a `resume` event incrementing the attempt's
`resume_count` (T3 attempt entity), re-enqueue the T2 round-script with the
recovered prompt, re-arm watch.sh on the new attempt.

Bound: `[resume] max_attempts` (default 2; under `[durable]` per the config
allowlist rule). On exhaustion: one terminal `abandoned` alert, then STOP.

It must NEVER: respawn while the prior attempt's Job Object/CLI is alive or
the worktree `lane.lock` is held; exceed max_attempts; respawn a lane that
completed (`round_done` + attempt-fresh report); bypass resume.sh's --force
pre-resume backup; count a no-progress resume as healthy.

Test (bats): abandoned lane resumed once and completes; never-completing
round stops after exactly max_attempts resumes + one `abandoned` alert (no
N+1th); a lane with a live Job Object is not resumed.

### foreman-launch contract delta (applies to 2026-07-16-foreman-launch.md)

The frozen contract gains exactly one flag and one clarification:

- `--detach`: re-parent the supervisor off the caller's console/turn
  (Windows: DETACHED_PROCESS + a Job Object not tied to the console; POSIX:
  setsid), write {pid, job_id} to the heartbeat/ownership file, return 0
  before the round completes. Exit-code contract (child's / 124 / 125) and
  the `-- CMD...` positional contract unchanged.
- stdin: the launcher forwards `/dev/null` to CMD (lane-run's non-interactive
  CMD contract must survive the insertion).
- Add a POSIX kill-shot crash-safety test to T1 (v0.3.0 runs the POSIX build
  on WSL2 — it must not inherit an unverified spawn primitive).
- NESTED JOB OBJECTS (advisor, 2026-07-18): round ownership creates
  `foreman-launch(--detach, job A) → lane-run.sh → foreman-launch(job B, CMD)
  → foreman-launch(job C, GATE)` — a launcher spawning further launchers.
  The bun025 chain validated one launcher → child → grandchildren only.
  Win8+ permits nested jobs and KILL_ON_JOB_CLOSE should cascade, but this
  is a NEW assumption: flag in the T1/T2 plan-time spec audit and add a
  nested-job tree-kill bats case (outer kill reaps inner launcher + its job).
- Global Constraints additions from the environment lens (9 carried-over
  bun025 caveats): #19916 icon/hide-console flags may no-op on Win11; #21560
  idle-RSS drift (24h soak note for a long-lived supervisor); use
  `Bun.main.includes("$bunfs")` not `Bun.isStandaloneExecutable` (undefined
  on 1.3.14); #12970 compiled exes strip backslashes from env vars (T5a
  passes Windows paths — test verbatim passthrough); #20013 static imports
  only; add `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` to
  the build for determinism; never set handle-inheritance on Bun.spawn (a
  duplicated job handle delays KILL_ON_JOB_CLOSE); read GetLastError()
  immediately after a failing FFI call (ordering rule, state it in code
  comments); the FFI surface is six kernel32 calls + GetLastError as
  diagnostics-only (fix the "EXACTLY six" wording).

### Gate policy (standing, all lanes)

- A lane round runs ONLY its own .bats file: fast subset in the inner loop,
  full file before round_done. Never the suite.
- ANY bats invocation goes through the pueue `gate` group (parallel=1).
- The architect runs the full suite once at merge, as sole gate holder.
- `bun test` (launcher/) runs out-of-band of bats but still respects the
  gate mutex; CI runs the FFI smoke separately.
- Auditor/investigation agents NEVER run bats — they reason from code; this
  is stated up front in every brief.

### Environment status (2026-07-18, HOMEOFFICE)

Bun 1.3.14 installed (winget, pinned at install; winget does not self-pin —
tool-check must verify the exact version). pueue/pueued 4.0.4 staged at
`~/.foreman/tools/pueue/` (no package-manager route). signtool present (SDK
10.0.26100.0). grok CLI absent → T5b grok half blocked; lanes this era are
Sonnet-implements / Opus-audits (stated substitution). CI build workflow for
the launcher is greenfield (windows-latest required; no code-signing cert
referenced anywhere — open question for the release step). Manifest needs
bun + pueue entries plus an exact-version-pin mechanism (new `pin_version`
field or bespoke branch in both tool-check scripts — T0/T7 decide).
Licensing note: shipping a compiled Bun launcher embeds JavaScriptCore
(LGPL) — the LGPL notice obligation is a deliberate, user-ratified
(2026-07-16) exception to the standing no-LGPL rule; document the notice in
the release artifacts.
