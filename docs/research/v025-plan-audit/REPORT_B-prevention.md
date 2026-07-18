# Prevention-Gap Audit — v0.2.5 vs. the background-and-stop attractor

**Scope of what the planned primitives actually own.** `lane-run.sh RUN LANE
WT -- CMD` wraps the *vendor CLI* as `CMD`, checkpoints the worktree, and
emits `round_done` the instant `CMD` exits. It does **not** run the gate and
does **not** write `FOREMAN_REPORT.md` — those happen afterward,
conversationally, in the **agent's** turn. `foreman-launch` (T1) owns `CMD`'s
process *tree*; it sits *below* `lane-run.sh`, which sits *below* the agent.
**No planned primitive owns the agent, and none owns the finish/verify/report
phase.** That single fact drives every verdict below: v0.2.5 hardens the
*implement* phase and leaves the *finish* phase — where the attractor
actually strikes — agent-owned.

## Q1 — The 12 attractor occurrences under foreman-launch (T1) + lane-run T2 + watch T4

Verdict key: **Impossible** = the specific loss cannot recur by construction ·
**Detected-only** = state is now correctly named/paged but work still needs a
manual resume · **Unchanged** = the plan's primitives never see this phase, so
the loss recurs as before.

| # | Occurrence (log) | Phase / what was stranded | Verdict (current plan) | Mechanism & residual gap |
|---|---|---|---|---|
| 1 | T4 Grok wrapper backgrounded its CLI call, ended turn ("wrapper stopped while CLI kept running") | **Implement**; ambiguous state, manual verify | **Detected-only** | CLI is `CMD`; lane-run checkpoints + emits `round_done` on CLI exit, WAITING_CHILD names the state. But verify+report are agent-owned → still a manual resume. |
| 2 | Same T4 Grok wrapper, **repeated after an explicit resume** | Implement | **Detected-only** | Identical. Proves prompt discipline fails; typed state helps, ownership of the finish phase does not exist. |
| 3 | T3 Sonnet finisher backgrounded the **full-suite gate**, "paused" | **Verify/gate**; orphaned suite, no report | **Unchanged** | The gate is a bare agent `bats` call, not routed through lane-run → no ownership event, no heartbeat, no WAITING_CHILD. watch keys on lane events that never appear; the earlier implement round's `round_done` may even make the lane read **done**. |
| 4 | T6 Sonnet rework lane stopped to "wait for the background test run" | Verify/gate | **Unchanged** | Same as #3. |
| 5 | T5 Sonnet rework lane backgrounded its bats gate (#5) | Verify/gate | **Unchanged** | Same as #3. Caught only because the architect had armed an ad-hoc watch — session practice, not a plan guarantee. |
| 6 | T3 Sonnet rework lane backgrounded gate, polled, stopped (#6) | Verify/gate | **Unchanged** | Same as #3. |
| 7 | T7 Round-C Sonnet lane backgrounded **final full-suite gate**; 11 files done, **report unwritten** (#7) | Verify/gate + report | **Detected-only** | This is the one T2 partially helps: the "AND report artifact exists" clause **withholds** a false `round_done`, so watch shows the lane never completing and pages correctly. Work still not finished without a resume. |
| 8 | Perf agent A backgrounded `time bats`, orphaned it (#8) | **Investigation** (non-lane) | **Unchanged** | Read-only agents never touch lane-run/launch/pueue-lane path. T0's pueue `gate` group mitigates *contention* only if the agent enqueues (prompt-dependent); the orphaned/lost run itself is unaddressed. |
| 9–11 | VTICK implementer hit the attractor **3×** ("stashing/thrashing instead of a clean after-gate") | Implement (safe) + **after-gate** (agent-owned) | **Detected-only** | Implement work is checkpointed (loss-impossible for the code); the after-gate is agent-owned → still a manual resume. |
| 12 | Round-2 el_emit auditor backgrounded `bats`, orphaned it, blocked the release gate ~1 hr (#12) | **Audit-verification** (non-lane) | **Unchanged** | Same class as #8. pueue `gate` group would cap contention *if enqueued*; the orphan + lost hour is unaddressed. |

**Adjacent lost-work class (the "12+")** — the same prevention gap,
non-attractor triggers, which any real fix must also cover:

| Case | Verdict |
|---|---|
| A — Grok CLI 600s timeout swallowed the worker's closing summary | **Detected-only** — stream tee (v0.2.0) preserves the transcript; the report is still the agent's job. |
| B — Unreaped grok blocked the T3 lane ~70 min; 18 shells wedged on the dead pipe | **Impossible** — this is exactly what T1's Job Object + KILL_ON_JOB_CLOSE + graded stop kill by construction. The single clean win. |
| C — Lane died to a mid-response API error with zero progress signal | **Detected-only** — heartbeats/checkpoints bound the loss to since-last-checkpoint; nothing re-dispatches. |

**Tally under the current plan: 0 Impossible (attractor) / 5 Detected-only /
7 Unchanged.** The checkpoint's verdict is confirmed by construction — the
plan *detects* the attractor (typed states, withheld `round_done`) but
*prevents lost work* only in the implement phase, never in the finish phase
where 9 of 12 occurrences actually landed.

## Q2 — Contract amendment so "agent stopped early" cannot lose work

The mandate is that the launcher owns a **round**, not a **process**. The
three candidates evaluate as:

- **`--post CMD`** — rejected. A round has ≥3 post-phases (check, audit-gate,
  report-write) with ordering and a freshness assertion; folding them into
  launcher flags leaks round semantics into a process supervisor and still
  leaves each phase singly-owned.
- **Naked round-script** (`foreman-launch -- bash round.sh`) — necessary but
  insufficient alone: a *foreground* round-script is a child of the agent's
  turn, so a turn-kill (occurrence C's shape) propagates and
  KILL_ON_JOB_CLOSE then reaps the round it was meant to protect.
- **lane-run.sh becomes the launched unit + a detach owner** — recommended.

### Amendment A (the one contract change): round-script ownership

The launched/enqueued unit becomes **`lane-run.sh` running the entire round**,
submitted through **pueue (already T0)** so the *daemon* — never the agent's
turn — owns it end to end; `foreman-launch` wraps each child for tree-kill and
gains exactly **one** optional flag, `--detach`, for the pueue-absent degrade
path. This is the smallest launcher-contract delta (one flag, no change to the
`-- CMD...` positional contract); the substance is lane-run's scope.

**Exact plan text:**

*In `2026-07-16-foreman-launch.md` → Global Constraints, change the
frozen-contract line:*

> `foreman-launch [--timeout SECS] [--grace SECS=10] [--heartbeat-file F] [--heartbeat-interval SECS=15] -- CMD [ARGS...]`

**to**

> `foreman-launch [--timeout SECS] [--grace SECS=10] [--heartbeat-file F] [--heartbeat-interval SECS=15] [--detach] -- CMD [ARGS...]`
> `--detach`: re-parent the supervisor off the caller's console/turn (Windows:
> `DETACHED_PROCESS` + a Job Object not tied to the console; POSIX: `setsid`),
> write `{pid,job_id}` to the heartbeat/ownership file, and return 0 **before**
> the round completes, so the supervised round survives the caller ending its
> turn. Exit-code contract (child's / 124 / 125) and the `-- CMD...`
> positional contract are unchanged.

*In `2026-07-16-v025-orchestration-hardening.md` → Task 2, add as the first
paragraph:*

> **Round ownership (v0.2.5 core).** The launched/enqueued unit is
> `lane-run.sh` running the WHOLE round — implement (vendor CLI via
> `foreman-launch`) → check → audit-gate → write `FOREMAN_REPORT` →
> `round_done` — NOT the bare vendor CLI. `lane-run.sh` gains a
> `--round GATE_CMD REPORT_PATH` mode: after the CLI child exits, it runs
> `GATE_CMD` (itself launched through `foreman-launch` for tree-kill), asserts
> `REPORT_PATH` is attempt-fresh, then emits `round_done`. The round is
> submitted to pueue (T0); the pueue daemon owns it for its full lifetime.
> Because the supervisor is never the agent's turn, an agent that
> backgrounds-and-stops cannot strand the round — it completes, writes its
> report, and emits `round_done` under the daemon. `--detach` (foreman-launch)
> is the degrade path when pueue is absent.

**Rationale:** the Job Object already reaps the whole tree (B above); making
the tree equal the whole *round* means the whole round is owned, and making
the owner the pueue daemon (or a detached launcher) means agent-stop cannot
reap it. This is the minimum change that turns every "Detected-only" and
finish-phase "Unchanged" row into "Impossible."

## Q3 — Auto-resume primitive (bounded) — new plan task

Nothing in the plan acts on `watch.sh`'s DEAD hint; `watch.sh` only *prints*
a kill+retry line and exits 3, and `resume.sh` only *restores the tree* —
neither re-dispatches. The primitive is the missing link, and every piece of
state it needs already exists.

### Amendment B: add Task 8 — auto-resume supervisor

**Exact plan text (new task in the v025 plan):**

> ### Task 8: auto-resume supervisor (bounded)
>
> New `scripts/lane-supervise.sh`, run by the **pueue daemon** on a fixed
> interval (degrade: `maintenance.sh`). It owns **no** new state store — it
> reads the v0.2.0 event log + checkpoint refs + T1 heartbeats. For each
> active lane/attempt it classifies **ABANDONED** iff: the launcher reported
> child exit (or the Job Object is gone) **AND** no `round_done` exists for
> this attempt **AND** no attempt-fresh report exists. On ABANDONED: run
> `resume.sh RUN LANE WT` (restore last checkpoint + recover the prompt
> payload — both already implemented), emit a `resume` event incrementing the
> attempt's `resume_count` (on the T3 attempt entity), then re-enqueue the
> Amendment-A round-script with the recovered prompt and re-arm `watch.sh` on
> the new attempt.
>
> **Bound:** `[resume] max_attempts` (default **2**). `resume_count` lives on
> the T3 attempt entity. On exhaustion, emit a terminal `abandoned` alert and
> STOP.
>
> **It must NEVER:**
>
> - respawn while the prior attempt's Job Object/CLI is alive or the worktree
>   `lane.lock` is held (concurrent-writer hazard — logged twice);
> - exceed `max_attempts` — no (N+1)th respawn; a crash-looping round must
>   trip the bound, not loop forever;
> - respawn a lane that actually completed (`round_done` + attempt-fresh
>   report) — idempotency guard;
> - bypass `resume.sh`'s `--force` pre-resume backup;
> - count a no-progress resume as healthy (the bound is on attempts, not on
>   successes).
>
> **Test (bats):** an abandoned lane (child exited, no `round_done`, only a
> stale report) is resumed once and completes; a round that never completes
> stops after exactly `max_attempts` `resume` events + one `abandoned` alert
> (assert no (N+1)th); a lane with a live Job Object is not resumed.

**Why a host-level daemon sweep and not `watch.sh`:** `watch.sh` is itself
dispatched by the agent and can be abandoned by the same attractor. The resume
owner must be the one process guaranteed not to be an agent turn — the pueue
daemon (T0). This is the auto-resume the checkpoint calls for ("12 manual
SendMessage resumes today").

## Q4 — Does the WAITING_CHILD terminal rule fully close "done while child runs"?

**It closes one narrow class and leaves three holes — two of them exactly the
agent-stop case.**

Closed: `lane-run.sh` can no longer emit `round_done` while the *wrapped
vendor CLI* is still alive, because `round_done` now requires
launcher-confirmed child exit. That kills the F2 "lane-run races ahead of its
own CLI" shape.

**Hole 1 — the agent, not the CLI, is what stopped (the dominant case).**
`round_done` is emitted **by `lane-run.sh`**. If the finish phase is
agent-conversational (occurrences #3–#7), `lane-run.sh` has already returned
to the agent — so when the agent stops, **nothing is left to emit
`round_done`**. The lane never reaches a terminal state:
WAITING_CHILD/STALLED forever. That is *detected*, not *prevented* —
precisely the checkpoint's complaint. Amendment A closes it by keeping
`lane-run.sh` (under the daemon) alive through the finish phase so it, not
the agent, emits `round_done`.

**Hole 2 — "report artifact exists" is satisfiable by a stale report.** The
log already recorded a watchdog false-firing on a prior round's report. If
"exists" means mere presence, `lane-run.sh` could emit `round_done` against
last round's report while *this* round's agent stopped early. The predicate
must be **attempt-fresh** (report carries the current attempt id, or
`mtime > attempt-start ts`).

**Hole 3 — "child exit" of the CLI ≠ round complete.** The CLI can exit 0
while the real remaining work (gate + report) never runs. "Child exit" must
mean exit of the **whole round-script** (Amendment A), not the vendor CLI
alone.

### Amendment C: harden the terminal predicate (edit T2 + T4)

**Exact plan text:**

*In Task 2, change the terminal rule from:*

> lane-run may emit round_done ONLY after launcher reports child exit AND the
> report artifact exists

**to**

> lane-run may emit `round_done` ONLY after the launcher reports exit of the
> **whole round-script** (not merely the vendor CLI) AND an **attempt-fresh**
> report artifact exists (report carries the current attempt id, or `mtime`
> newer than the attempt-start ts). A prior round's report never satisfies
> the predicate.

*In Task 4, add to the state list / thresholds:*

> **AGENT-ABANDONED** — child exit confirmed, but no `round_done` and no
> attempt-fresh report for the current attempt — is a first-class alertable
> state that triggers the Task 8 supervisor. It is never classified SUCCEEDED
> and never a silent false-stall during the gate phase.

## Q5 — Are the success criteria sufficient to prove *prevention*? No.

The plan's five criteria prove: no orphan CLIs (B), no premature `round_done`
while the *CLI* runs, admission-control queuing, merge safety, and no
regression. **None exercises an agent stopping during the finish phase — the
actual dominant failure.** The missing criteria, as testable statements to
add to the plan's Success criteria:

- **SC-A — agent-stop survivability:** A round whose dispatching agent ends
  its turn immediately after launch still reaches `round_done` with an
  attempt-fresh report and a passing gate, with **zero manual resume**.
  (Launch detached/via pueue; kill the parent shell; assert the completed
  round from the event log alone.)
- **SC-B — whole-round ownership:** `kill -9` of the launcher/parent **during
  the gate/report phase** (not only during the CLI) leaves zero orphan
  gate/test processes **and** classifies the lane
  WAITING_CHILD/AGENT-ABANDONED, never SUCCEEDED. (Extends the existing
  orphan test past the CLI into the finish phase.)
- **SC-C — bounded auto-resume:** An abandoned lane (child exited, no
  `round_done`, only a stale report) is auto-resumed from its last checkpoint
  and completes; a round that never completes stops after **exactly**
  `[resume] max_attempts` re-dispatches, then emits one terminal `abandoned`
  alert — assert **no (N+1)th** respawn.
- **SC-D — stale-report immunity:** `round_done` is **not** emitted when only
  a prior round's report is present; the terminal predicate requires an
  attempt-fresh report. (Directly tests Hole 2.)
- **SC-E — no concurrent writers on resume:** Auto-resume refuses to
  re-dispatch while a live Job Object or `lane.lock` exists for the prior
  attempt; the single-writer-per-worktree invariant holds across a resume.
- **SC-F — completion provable without the agent:** A lane's completion is
  decidable from the event log + refs alone with the dispatching agent
  absent; "agent gone + no `round_done`" never reads as done and never as a
  false stall during the gate phase.

SC-A and SC-B are the load-bearing pair: they are the only criteria that fail
today and that the amendments are designed to pass. If the plan cannot state
and test SC-A, it has not proven prevention — only detection.

## One-line summary for the planner

The plan hardens the *implement* phase (Job Objects, typed states, withheld
`round_done`) but leaves the *finish/verify/report* phase agent-owned — so 9
of 12 attractor occurrences remain Unchanged or Detected-only. Three
amendments close the gap with a **one-flag** launcher-contract delta
(`--detach`) plus a scope change (lane-run owns the whole round, run under
the pueue daemon), a bounded auto-resume Task 8, and an attempt-fresh
terminal predicate; six added success criteria (SC-A…SC-F) make prevention
testable rather than assumed.
