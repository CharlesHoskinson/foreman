# M1 — Foreman lane lifecycle and round ownership

## What was modelled

This lane models one logical Foreman lane across several rounds. The lane moves
through queue/dispatch, implementation, opaque gate evaluation, report
production, and either `round_done` or an incomplete/abandoned recovery path.
The event log is an ordered, reliable input, as required by the Lane 1 scope;
there is no append tearing or lock model. The gate is a three-valued oracle
(absent/green/red), as required by the Lane 3 boundary.

The real watchdog thresholds are loaded in
`watch.sh:359-369`: starting 90 s, implementation 300 s, verification 600 s,
shared dead 900 s, and phase-entry grace 10 s. The model scales these to
3/10/20/30/1 logical ticks. This preserves
`grace < starting < implementation < verification < dead` and preserves the
code's strict boundary tests: age below warn is healthy, age from warn through
dead-1 is stalled, and age at least dead is dead (`watch.sh:568-576`).

The model distinguishes agent-owned pre-fix rounds, daemon-owned
`lane-run.sh --round` rounds, and the currently shipped supervisor's
plain-mode re-enqueue after resume. It tracks logical time, lifecycle phase,
the ten v2 watch labels, ownership/pid and heartbeat facts, gate/report
artifacts, the current attempt, checkpoint marker, run- and round-scoped
resume counts, dirty refusal, and emitted terminal/incomplete alerts.

There are two Quint state variables: `now` and one `LaneState` record. The
record's finite domains include 8 lifecycle phases, 3 owner modes, the exact
10 watch labels, 3 gate results, 3 wrapper-exit values, bounded time 0–34,
rounds 0–3, attempt ids/counters 0–8, resume counts 0–2, retry sweeps 0–3,
and Boolean artifacts. Multiplying all field domains without respecting any
transition guard gives a deliberately loose upper bound of about
`7.0 × 10^21` record/clock combinations. Almost all are unreachable; for
example, enqueue resets all terminal artifacts together.

## Invariants and witnesses in plain English

### `inv_round_done_requires_fresh_report`

A `round_done` state is legal only when the gate result is recorded green and
the report exists and is fresh for the current attempt. Freshness is the real
disjunction from `lane-run.sh:1204-1219`: report mtime is strictly newer than
the round prompt epoch, or its structured abstraction carries the current
attempt id. The pre-fix completion transition intentionally violates this.

### `inv_no_completion_from_exit_code`

Wrapper exit zero, by itself, may never produce the watcher's successful
terminal classification when gate/report artifacts are missing. This states
directly that process exit is not completion evidence, even if the
representation of `round_done` later changes.

### `inv_no_silent_limbo`

Once a dispatched lane has remained nonterminal for more than the scaled
shared dead bound plus grace (31 ticks), its typed watch label must be stalled,
dead, agent-abandoned, waiting-child, or failed. A healthy label beyond that
bound is the bounded counterexample surrogate for eventual termination. The
H3 detached-child action violates it by refreshing heartbeats without round
progress.

### `inv_model_bounds`

The logical clock, round, attempt, resume, and retry counters stay inside the
declared finite bounds. This is a model-integrity check, not a Foreman product
guarantee; it catches accidental unbounded transitions.

### `eventually_terminal`

Every dispatched behavior should eventually produce either `round_done` or
the terminal `abandoned` alert. This is the true temporal claim, but the
unqualified property has no fairness assumption and is therefore
stuttering-falsifiable: TLC may stop taking steps even while useful actions
remain enabled. The model now warns against citing that raw result and adds
separate weakly fair postfix and shipped variants. Until a fair temporal run
completes, `inv_no_silent_limbo` is the operative liveness check; it is a
bounded safety surrogate, not a proof of eventual termination.

### `witness_round_done`

This negated goal is violated when a daemon-owned round reaches a green gate,
writes an attempt-fresh report, and emits `round_done`. Its violation shows
the completion invariant is not vacuous.

### `witness_waiting_child`

This negated goal is violated when an agent backgrounds work and exits zero
inside a daemon-owned round, after which the daemon's gate/report assertion
emits `waiting_child` and `round_incomplete` rather than `round_done`.

### `witness_agent_abandoned`

This negated goal is violated when an owner that has already produced a
heartbeat dies without completion or a newer waiting-child event. That
reaches the classifier's pid-dead `AGENT_ABANDONED` branch.

### `witness_successful_resume`

This negated goal is violated when a clean abandoned lane has a checkpoint,
is below the cap, restores successfully, emits the abstract `resume` event,
and is requeued. It proves recovery is reachable, not merely its failures.

### `witness_h1_later_round_budget_exhausted`

This negated goal is violated at a third-round abandonment after two prior
run-wide resumes but zero resumes in the current round. It is the executable
counterexample to the intended per-round budget.

### `witness_h2_dirty_retry_uncapped`

This negated goal is violated after three dirty refusals, one deduplicated
alert, no resume-count advance, and no terminal state. It demonstrates that
repeated exit 5 never approaches the nominal cap.

### `witness_h3_live_unproductive_limbo`

This negated goal is violated when detached-child heartbeats keep the
classifier healthy after more than 31 ticks without completion.

### `witness_h4_disabled_prefix_attractor`

This negated goal is violated when bad pre-fix completion remains reachable
while the nominal durable switch is false, proving the switch has no modeled
enforcement effect.

### `witness_shipped_resume_loses_round_ownership`

Successful resume first records `resumeWillBePlain` while the old daemon
owner remains current. This negated goal is violated when the queued resumed
task dispatches and installs `PLAIN_RESUME`.

## Counterexample trace

Command:

```text
quint run specs/lane_lifecycle.qnt --init=init_prefix --step=step_prefix_bug --invariant=inv_round_done_requires_fresh_report --max-steps=4 --max-samples=1 --verbosity=3 --seed=0x1
```

Verbatim Quint output:

```text
An example execution:

[State 0]
{
  lane:
    {
      abandonedAlert: false,
      agentStopped: false,
      attempt: 0,
      attemptAllocationFailed: false,
      attemptCounter: 0,
      checkpoint: 0,
      dirty: false,
      dirtyAlert: false,
      dispatchAt: 0,
      dispatched: false,
      durableEnabled: true,
      gateResult: GATE_ABSENT,
      heartbeatSeen: false,
      lastActivity: 0,
      lifecycle: NOT_DISPATCHED,
      owner: AGENT_WRAPPER,
      phaseEntered: 0,
      pidAlive: false,
      previousWatch: QUEUED,
      queued: false,
      reportAttempt: 0,
      reportExists: false,
      reportMtime: 0,
      resumeCountRound: 0,
      resumeCountRun: 0,
      resumeSucceeded: false,
      retrySweeps: 0,
      round: 0,
      roundDone: false,
      roundIncompleteAlert: false,
      verifying: false,
      waitingAt: 0,
      waitingChild: false,
      wrapperExit: EXIT_ABSENT
    },
  now: 0
}

[State 1]
{
  lane:
    {
      abandonedAlert: false,
      agentStopped: false,
      attempt: 0,
      attemptAllocationFailed: false,
      attemptCounter: 0,
      checkpoint: 0,
      dirty: false,
      dirtyAlert: false,
      dispatchAt: 0,
      dispatched: true,
      durableEnabled: true,
      gateResult: GATE_ABSENT,
      heartbeatSeen: false,
      lastActivity: 0,
      lifecycle: DISPATCHED,
      owner: AGENT_WRAPPER,
      phaseEntered: 0,
      pidAlive: false,
      previousWatch: QUEUED,
      queued: true,
      reportAttempt: 0,
      reportExists: false,
      reportMtime: 0,
      resumeCountRound: 0,
      resumeCountRun: 0,
      resumeSucceeded: false,
      retrySweeps: 0,
      round: 1,
      roundDone: false,
      roundIncompleteAlert: false,
      verifying: false,
      waitingAt: 0,
      waitingChild: false,
      wrapperExit: EXIT_ABSENT
    },
  now: 0
}

[State 2]
{
  lane:
    {
      abandonedAlert: false,
      agentStopped: false,
      attempt: 1,
      attemptAllocationFailed: false,
      attemptCounter: 1,
      checkpoint: 0,
      dirty: false,
      dirtyAlert: false,
      dispatchAt: 0,
      dispatched: true,
      durableEnabled: true,
      gateResult: GATE_ABSENT,
      heartbeatSeen: false,
      lastActivity: 0,
      lifecycle: IMPLEMENTING,
      owner: AGENT_WRAPPER,
      phaseEntered: 0,
      pidAlive: true,
      previousWatch: QUEUED,
      queued: false,
      reportAttempt: 0,
      reportExists: false,
      reportMtime: 0,
      resumeCountRound: 0,
      resumeCountRun: 0,
      resumeSucceeded: false,
      retrySweeps: 0,
      round: 1,
      roundDone: false,
      roundIncompleteAlert: false,
      verifying: false,
      waitingAt: 0,
      waitingChild: false,
      wrapperExit: EXIT_ABSENT
    },
  now: 0
}

[State 3]
{
  lane:
    {
      abandonedAlert: false,
      agentStopped: true,
      attempt: 1,
      attemptAllocationFailed: false,
      attemptCounter: 1,
      checkpoint: 0,
      dirty: false,
      dirtyAlert: false,
      dispatchAt: 0,
      dispatched: true,
      durableEnabled: true,
      gateResult: GATE_ABSENT,
      heartbeatSeen: false,
      lastActivity: 0,
      lifecycle: ROUND_DONE_PHASE,
      owner: AGENT_WRAPPER,
      phaseEntered: 0,
      pidAlive: false,
      previousWatch: QUEUED,
      queued: false,
      reportAttempt: 0,
      reportExists: false,
      reportMtime: 0,
      resumeCountRound: 0,
      resumeCountRun: 0,
      resumeSucceeded: false,
      retrySweeps: 0,
      round: 1,
      roundDone: true,
      roundIncompleteAlert: false,
      verifying: false,
      waitingAt: 0,
      waitingChild: false,
      wrapperExit: EXIT_ZERO
    },
  now: 0
}

[violation] Found an issue (25ms at 40 traces/second).
Use --verbosity=3 to show executions.
Use --seed=0x1 --backend=rust to reproduce.
error: Invariant violated
```

Per-step commentary:

1. State 0 is idle, with the conversational agent wrapper owning completion.
2. State 1 is queue admission/dispatch; no completion artifact exists.
3. State 2 allocates attempt 1 and starts implementation. Gate and report are
   still absent.
4. State 3 is the attractor: the worker detached its real work, stopped, and
   returned zero. The pre-fix orchestrator converted that exit into
   `roundDone=true` even though the gate is absent and no report exists.

The same trace violated `inv_no_completion_from_exit_code` with seed `0x1`.
A separate 40-step live-child trace (`step_prefix_live`, seed `0x1`) violated
`inv_no_silent_limbo` after detached work kept its pid and heartbeat fresh
beyond tick 31.

## What the fix changes

The transition-level difference is narrow. In the pre-fix relation,
`agentBackgroundsAndStops` may set `roundDone` from wrapper exit zero while
gate and report are absent. In the daemon-owned relation, that transition is
unavailable. `daemonComplete` is the only action that can set `roundDone`, and
its guards require `GATE_GREEN` plus the current attempt's freshness
predicate. The matching background-and-stop action instead records exit zero,
emits the abstract `waiting_child` and `round_incomplete` artifacts, ends
ownership, and leaves `roundDone=false`.

Against `init_postfix`/`step_postfix`, each safety invariant was run for
10,000 Rust-simulator samples of up to 40 steps. Every run printed
`[ok] No violation found`. Seeds were:

- fresh report: `0xf843ca260f2d43c1`;
- exit-code isolation: `0x73ef90c98224c631`;
- loud limbo: `0xe9531ce27a49e5c5`;
- model bounds: `0xfbcf26bde72f6b65`.

This result applies to the daemon-owned **core**, not the entire shipped
recovery integration. With `step_shipped`, successful recovery changes
ownership to plain mode. On the accepted round-1 relation, the supplied
Apalache run proved the resulting safety violation reachable within 12
steps, upgrading the simulation-observed result to a symbolic bounded
counterexample. Round 2 preserves that path in the corrected relation and
reaches it in simulation, but its symbolic rerun was sandbox-blocked. **The
shipped structural fix holds only until the first auto-resume.** It would be
false to claim end-to-end restoration without persisting and replaying
`GATE_CMD` and `REPORT_PATH`.

## Abstractions and their limits

**One lane, several rounds.** One lane is sufficient for ownership,
freshness, watchdog priority, and run-versus-round resume counting. It is not
safe for claims about cross-lane interference, locks, or event append
ordering; those belong to Lane 2.

**Reliable ordered event facts.** Events are Boolean/enum/int markers rather
than a JSON sequence. This preserves latest-round predicates and first-match
priority under the task's reliable-log assumption. It is not safe for torn
tails, duplicates, sequence allocation, or concurrent append races.

**Opaque gate.** Gate evaluation is absent/green/red and has no audit verdict,
rework policy, or merge decision. That is sufficient for whether `gate_rc`
exists and equals zero, but establishes no Lane 3 audit correctness property.

**Report content.** Quint strings are opaque, so mtime is an integer and the
textual `attempt: N` branch is an integer marker. Equality with the current
attempt preserves the terminal predicate. This omits regex false positives,
timestamp resolution, clock skew, and non-atomic report writes; those could
matter in a filesystem-level model.

**Checkpoint plumbing.** A positive integer denotes a usable checkpoint. It
preserves “none versus latest snapshot” and recovery guards, but not checkout
failure, overlay/exact deletion, missing commit objects, CAS contention, or
snapshot content fidelity.

**Logical clock and thresholds.** Only logical tick actions advance time.
Scaling preserves threshold order and strict comparisons, but not scheduler
jitter or sub-tick events. Loop grace and the v2 STALLED-before-DEAD bridge are
included; `--once` is the raw classifier. Frozen v1 is not duplicated in full.

**Supervisor abandonment.** The model uses dispatched/prompt, no
`round_done`, and pid-dead. It omits the lane-lock alternative. This is safe
for the selected pid-death/dirty-recovery traces, but not the Lane 2 lock-leak
variant: a stale lock can make the real supervisor report ALIVE after death.

**Productivity.** Detached-child heartbeats deliberately refresh liveness
without semantic round progress to expose H3. The model does not judge
arbitrary worker output; it distinguishes protocol artifacts from heartbeat
activity.

## New defects or races found

### H1 — run-scoped resume budget

**Confirmed in code.** `lane-supervise.sh:244-250` counts every `resume` event
for the lane in the full run event stream passed as `$events`; it does not use
the latest-round suffix `$round_events`. Therefore two successful resumes in
earlier rounds consume the cap for a later round whose own resume count is
zero. The model includes both counters so this difference is observable.

Round 2 corrected the model's structural-round boundary. A successful
`resume.sh` plus `lane-queue.sh add` does not itself emit a prompt, so
`round` correctly remains unchanged while the recovered task is merely
queued. When that task actually starts, `lane-run.sh:843-853` emits the new
prompt that starts a new structural round; both dispatch actions now advance
`round` and reset the round-local ghost counter at that point. The H1 witness
still violates after this correction, so the finding does **not** depend on
the old weaker round model and is not downgraded.

The consecutive-resume trace is faithful, not a missing model guard.
`lane-supervise.sh` is single-pass but is invoked repeatedly by an external
timer. `ls_reenqueue` submits a pueue task without appending a prompt,
ownership event, or event-log queue marker. Until the task starts, a second
sweep still sees the same latest prompt, dead owner, no lock, and no
`round_done`; the earlier re-enqueue is therefore **not** a no-op. The second
sweep may restore and enqueue again, consuming another run-scoped resume.

The action label did expose a step-relation scoping defect: shipped executions
should not take the daemon-preserving `successfulResumeCore` branch. The
corrected `step_shipped` excludes that branch, uses
`successfulResumePlain`, and delays the `PLAIN_RESUME` owner change until the
queued task actually starts. Thus two pre-dispatch sweeps remain possible and
faithful, but they are no longer represented as core resumes on the shipped
relation. The post-fix core relation intentionally retains
`successfulResumeCore`; two core sweeps before redispatch are possible for
the same queue-observability reason.

### H2 — dirty-refusal retry loop

**Confirmed in code.** `lane-supervise.sh:280-305` treats exit 5 specially:
the `resume_refused_dirty` alert is existence-deduplicated, but the code
explicitly retries `resume.sh` every sweep and explicitly does not increment
`resume_count`. `resume.sh:257-266` is the deciding dirty-tree check and exit
5. A permanently dirty lane therefore remains nonterminal forever and never
reaches the nominal cap.

### H3 — live-but-unproductive lane

**Confirmed for the pre-fix/unowned topology.** The v2 classifier reaches
`AGENT_ABANDONED` only after the owning pid check fails
(`watch.sh:953-958`). Its running/stalled/dead age is measured from the newest
heartbeat or liveness event (`watch.sh:961-992`). Thus a surviving child that
keeps the owning pid alive and heartbeats current remains
`RUNNING_IMPL`/`VERIFYING` regardless of total round age. This matches the
recorded systemd case at `bugeventlog.md:845-866`: the unit outlived its agent,
no report was produced, and `ExecMainStatus=0` hid a red build.

### H4 — `durable.enabled` is inert

**Semantically confirmed; the literal-count premise is refuted.** Executable
code has one literal `DURABLE_ENABLED` mapping at `lib/config.sh:66` and one
allow-list occurrence of the TOML spelling `durable.enabled` at line 148.
There is no `cfg_get durable enabled` consumer in the scripts. Consequently
the setting cannot gate either ownership mode. The model's configuration bit
is deliberately ignored by transition guards, allowing the pre-fix attractor
even after the bit is set false.

### H5 — exit-code collision

**Refuted as a terminal-classification collision, with a more serious adjacent
finding.** `lane-run.sh:29-40` documents that Windows NTSTATUS byte masking can
make `round_done.exit_code` look like a benign small code. The v2 terminal
classifier never interprets that field: `watch.sh:891-897` decides success
from `round_done` plus `gate_rc` absent/zero, and failure from an `abandoned`
alert. Therefore no small-number collision changes that branch. However,
`gate_rc` absence is itself accepted as success for compatibility, so a plain
round's `round_done` is classified successful even when its recorded child
exit was nonzero.

### New defect — successful recovery drops round ownership

`lane-supervise.sh:343-347` detects that earlier rounds used `--round`, then
explicitly re-enqueues `lane-run.sh` in **plain mode** because `GATE_CMD` and
`REPORT_PATH` are absent from the event schema. The recovered round therefore
loses gate/report automation. This composes with the previous finding:
plain-mode `lane-run.sh` emits `round_done` at `lane-run.sh:1241-1249`
regardless of report freshness, while the watcher accepts absent `gate_rc`.
The model gives this shipped handoff its own step relation so it can be checked
without pretending that the daemon-owned core itself has this transition.
The supplied Apalache run symbolically proved the unsafe state reachable
within 12 steps on the accepted round-1 relation. The round-2 corrections
preserve the path and reproduce it in simulation; a completed symbolic rerun
of the corrected artifact remains outstanding. **The shipped structural fix
holds only until the first auto-resume.**

### New classifier edge — death before the first heartbeat is never labelled abandoned

`STARTING` precedes the pid-dead branch in the first-match cascade
(`watch.sh:903-929` versus `953-958`). If ownership was recorded but the
owner dies before `$hb` contains a parseable line, repeated classifications
remain in the STARTING age bucket and escalate to `STALLED`/`DEAD`; they
never say `AGENT_ABANDONED`. The supervisor can still recover it from its
separate pid/lock predicate, but operators and exit-code consumers see the
wrong diagnosis. The required `AGENT_ABANDONED` witness therefore models the
reachable intended path in which at least one heartbeat was observed before
the owner died.

### Source/spec mismatch — v2 is not generally one-tick debounced

The task hypothesis says the typed v2 labels have a one-stale-tick debounce.
The source says otherwise: `watch.sh:552-560` calls `wd_state_v2` direct and
explicitly says it has no debounce counter. Loop mode only inserts a
`STALLED` bridge when a raw classification jumps directly to `DEAD`
(`watch.sh:1195-1207`). The full two-observation debounce is in frozen v1
(`watch.sh:35-70`, `444-459`). The model follows the actual v2 behavior:
direct warn-boundary `STALLED`, plus the loop-mode `STALLED` bridge before
`DEAD`.

## Verification honesty

> **Critical shipped-path result:** Apalache found the shipped supervisor path can reach
> `roundDone = true` with no fresh report after a successful auto-resume. **The shipped
> structural fix holds only until the first auto-resume.**

The project checks were re-run outside the agent sandbox on the same host with Quint 0.32.0,
Apalache 0.56.1, and OpenJDK 21.0.11. Unlike the round-1 sandbox attempts, these checks ran
to completion. The supplied results are recorded below; round 2 separately records which
commands were executed inside the agent sandbox.

### Supplied same-host checks run outside the agent sandbox

These results were supplied by the project owner from completed runs outside
the agent sandbox on the same host. They are not presented as commands
executed by the round-2 agent. They were produced from the accepted round-1
artifact before the round-2 dispatch-boundary and shipped-step scoping
corrections. Those corrections preserve the violating plain-resume path, and
the corrected model reaches it in simulation, but the corrected artifact has
not received a completed in-sandbox symbolic rerun.

Apalache symbolic bounded checks for the post-fix daemon-owned core
(`--init=init_postfix --step=step_postfix`) all completed:

```text
inv_round_done_requires_fresh_report  --max-steps=12  [ok] 14425ms
inv_no_completion_from_exit_code      --max-steps=12  [ok] 18541ms
inv_no_silent_limbo                   --max-steps=12  [ok] 40177ms
inv_model_bounds                      --max-steps=12  [ok] 34819ms
```

The corresponding pre-fix symbolic run
(`--init=init_prefix --step=step_prefix_bug`,
`inv_round_done_requires_fresh_report`, `--max-steps=6`) found a
counterexample in 6447ms.

Most importantly, the shipped supervisor run
(`--init=init_postfix --step=step_shipped`,
`inv_round_done_requires_fresh_report`, `--max-steps=12`) found a
counterexample in 6315ms. Its violating State 7 was:

```text
owner: PLAIN_RESUME, roundDone: true, reportExists: false,
gateResult: GATE_ABSENT, resumeSucceeded: true, resumeCountRun: 1,
checkpoint: 1, agentStopped: true, wrapperExit: EXIT_ZERO,
lifecycle: ROUND_DONE_PHASE
```

That is a symbolic bounded reachability result, not merely a simulation
observation. **The shipped structural fix holds only until the first
auto-resume.**

The deterministic pre-fix counterexample was independently reproduced with
`--max-steps=4 --max-samples=1`. It violated at State 3 with
`roundDone: true`, `reportExists: false`, `gateResult: GATE_ABSENT`,
`owner: AGENT_WRAPPER`, `agentStopped: true`, and
`wrapperExit: EXIT_ZERO`.

The supplied nine-witness re-run used
`--init=init_postfix --step=step_shipped --max-steps=30
--max-samples=400 --backend=rust`. Eight of nine negated witnesses violated,
which is the expected reachability result:

- `witness_round_done`
- `witness_waiting_child`
- `witness_agent_abandoned`
- `witness_successful_resume`
- `witness_h1_later_round_budget_exhausted`
- `witness_h2_dirty_retry_uncapped`
- `witness_h4_disabled_prefix_attractor`
- `witness_shipped_resume_loses_round_ownership`

`witness_h3_live_unproductive_limbo` was **not** reachable under
`step_shipped`. It did violate under its documented
`--init=init_prefix --step=step_prefix_live --seed=0x1` recipe, and
`inv_no_silent_limbo` violated there as well. This is an important scope
boundary: H3's live-child limbo is reachable on the pre-fix/live-child step
relation, not on the shipped step relation.

### Temporal TLC result: ran, failed, but is not defect evidence

Apalache does not check temporal properties; Quint instructs the caller to
re-run with `--backend=tlc`. Both supplied TLC runs completed:

```text
step_postfix  eventually_terminal  --max-steps=10  Error: Temporal properties were violated. 4357ms
step_shipped  eventually_terminal  --max-steps=10  Error: Temporal properties were violated. 4266ms
```

The failure is a modelling artifact, not evidence of a Foreman liveness bug.
TLC explored 251,574 distinct states and ended the counterexample with the
literal line `State 13: Stuttering`. The preceding trace was healthy:

```text
enqueueRound → dispatchAttemptOk → takeCheckpoint → logicalTick →
disableDurable → daemonBackgroundAndStop → successfulResumeCore ×2 →
dispatchAttemptOk → implementationHeartbeat → sampleWatch
```

It then simply stopped taking steps. Without fairness, `eventually P` is
falsified by that stutter even when productive actions remain enabled. A
future reader must not cite this raw failure as a liveness defect.
The `successfulResumeCore ×2` label belongs to the supplied round-1
step-relation scope; the corrected shipped relation uses the plain-resume
branch for the same real pre-dispatch double-sweep window. That scoping
correction does not change why the displayed temporal failure is vacuous.

Quint 0.32.0 does support fairness constraints through
`action.weakFair(vars)`. The model now includes
`eventually_terminal_postfix_fair` and
`eventually_terminal_shipped_fair`, each applying weak fairness to its whole
selected step relation. These are deliberately labelled in the model as
anti-global-stutter experiments: `weakFair(step, vars)` prevents global
stuttering while some state-changing `step` remains continuously enabled,
but fairness of a disjunction does not prevent one changing branch from
starving a continuously enabled completion branch. They are therefore not
yet adequate fairness specifications for true terminal liveness. A round-2
TLC re-check of the postfix experiment was attempted, but this agent sandbox
again rejected the Apalache compilation server's local socket before TLC
could run. No fair temporal verdict or adequate branch-fairness formulation
was obtained in this round; the completed unqualified temporal numbers above
remain the externally supplied results.

`inv_no_silent_limbo` is consequently the **operative liveness property**.
As a bounded safety surrogate, it proves that any model state which is still
dispatched and nonterminal after `STALL_DEAD + GRACE` must already have an
alerting typed watcher label. It catches an old, silent nonterminal state in
a finite prefix and is checkable by Apalache. It does **not** prove that a
terminal state is eventually reached, that the scheduler ever selects an
enabled progress action, that alerts are acted on, or that no infinite
alerting/retry execution exists. It also says nothing beyond the model's
finite logical-time and transition bounds.

### Commands executed by the round-2 agent

The agent itself ran `quint typecheck` successfully after the model edits. It
also introduced `inv_redispatched_resume_starts_new_round`, observed it fail
against the old resumed-dispatch behavior, then observed it pass after the
round boundary was moved to the resumed prompt/dispatch transition. Finally,
the H1 witness was re-run after that correction and still violated, so H1
survives the stronger round semantics.

The agent then re-ran all nine witnesses against the corrected model with
`--init=init_postfix --step=step_shipped --max-steps=30
--max-samples=400 --backend=rust`. The same eight witnesses listed in the
supplied run violated; only `witness_h3_live_unproductive_limbo` reported no
violation. The H3 witness and `inv_no_silent_limbo` both separately violated
with `--init=init_prefix --step=step_prefix_live --max-steps=40
--max-samples=1 --backend=rust --seed=0x1`. Thus the H3 asymmetry survives
the round-boundary correction. The nine-witness run was repeated after
excluding `successfulResumeCore` from `step_shipped` and delaying plain-owner
installation until redispatch; the result remained 8/9 with the same H3-only
exception. A separate 5,000-sample shipped safety simulation still reached
the fresh-report violation within 12 steps, and the corrected redispatch
invariant reported no sampled violation.

Against the corrected daemon-core relation, the agent also ran 2,000 Rust
samples of up to 30 steps for the four original safety invariants plus
`inv_redispatched_resume_starts_new_round`; all five reported no sampled
violation. This is simulator evidence only and is not conflated with the
supplied Apalache proofs.

The required round-2 shipped-path command
`quint verify ... --init=init_postfix --step=step_shipped
--invariant=inv_round_done_requires_fresh_report --max-steps=12` was also
executed by the agent. It did not reach the checker: the sandbox rejected
Apalache's local server socket with `java.net.SocketException: Operation not
permitted`, followed by `channel not registered to an event loop`. This is
reported only as the outcome of the agent's own attempt; the completed 6315ms
same-host counterexample remains the separately attributed supplied result.

Round 1 could not run Apalache/TLC only because its sandbox rejected local
socket creation; that environmental aside does not negate the completed
same-host results above.

Random simulation proves reachability when it produces a witness
counterexample, while “no violation found” covers only sampled paths and is
not an invariant proof. The Apalache results above have the stronger,
symbolic bounded meaning stated for them.

---

## Architect verification of the corrected (post-round-2) artifact

The round-2 text records that a completed symbolic rerun of the corrected artifact "remains
outstanding" because `quint verify` was blocked inside the agent sandbox. That item is now
closed. All commands below were executed by the orchestrating architect on the same host,
outside the agent sandbox, against the final 928-line `specs/lane_lifecycle.qnt`
(Quint 0.32.0 / Apalache 0.56.1 / OpenJDK 21.0.11):

```text
quint typecheck specs/lane_lifecycle.qnt
  -> clean (exit 0)

# Headline: SHIPPED supervisor path still violates completion safety
quint verify --init=init_postfix --step=step_shipped \
  --invariant=inv_round_done_requires_fresh_report --max-steps=12
  -> [violation] found a counterexample (12109ms)

# Post-fix daemon-owned core: safety holds, symbolically, to depth 12
quint verify --init=init_postfix --step=step_postfix --invariant=inv_round_done_requires_fresh_report --max-steps=12
  -> [ok] No violation found (27869ms)
quint verify --init=init_postfix --step=step_postfix --invariant=inv_no_completion_from_exit_code --max-steps=12
  -> [ok] No violation found (31462ms)
quint verify --init=init_postfix --step=step_postfix --invariant=inv_no_silent_limbo --max-steps=12
  -> [ok] No violation found (50356ms)

# Pre-fix background-and-stop counterexample still fires
quint run --init=init_prefix --step=step_prefix_bug \
  --invariant=inv_round_done_requires_fresh_report --max-steps=4 --max-samples=1
  -> Invariant violated

# H3 silent limbo, own recipe
quint run --init=init_prefix --step=step_prefix_live \
  --invariant=inv_no_silent_limbo --max-steps=35 --max-samples=1 --seed=0x1
  -> Invariant violated

# Witnesses, --init=init_postfix --step=step_shipped --max-steps=30 --max-samples=400 --backend=rust
  8/9 violated (= reachable = good); witness_h3_live_unproductive_limbo unreachable here
  by design and violated under --step=prefix_live as documented above.
```

**Conclusion of the rerun:** the round-2 corrections (structural round advance on resume,
round-local resume counter reset, tightened `step_shipped`) did NOT remove the shipped-path
counterexample. The headline result is therefore established symbolically against the final
artifact, not merely by simulation: **on the shipped code path, the daemon-owned-round fix
holds only until the first auto-resume, after which the lane is re-dispatched in plain mode and
can reach `round_done` with no fresh report and no gate.**

Scope of that claim: bounded symbolic exhaustiveness to 12 transitions under this model's
abstractions. A clean `[ok]` above means "no violation within 12 steps", not a proof for all
executions. The temporal property `eventually_terminal` remains stuttering-falsifiable and must
not be cited as evidence of a liveness defect; `inv_no_silent_limbo` is the operative liveness
surrogate.

---

## Thin adapter port record (Sprint 3 R1 queue admission)

Queue admission product logic moved to the TypeScript package
`@foreman/orchestration` (`packages/orchestration/src/queue-admission.ts` and
`queue-services.ts`). The shell entry point
`skills/foreman/scripts/lane-queue.sh` is a thin adapter: it resolves `node`
and `exec`s the bundled runtime at
`skills/foreman/runtime/dist/lane-queue.js`. It does not implement topology,
daemon start, admission, status, or kill.

**Did the `lane_lifecycle` abstraction change?** No. The Quint model still
abstracts queue admission and re-enqueue as the same Boolean/enum markers on
the single-lane record. The port preserves fixed groups and capacities, the
one safe pre-accept retry, and the ensure-before-add ownership boundary that
the model treats as successful queue admission. Coverage still lists
`skills/foreman/scripts/lane-queue.sh` because that path remains the operator
and supervisor entry surface; the model does not need a new source-file row
for the TypeScript package while the admission contract is unchanged.

Live correction (2026-08-04): readiness probes use
`pueue status --json "last 1"` (reachability only; not a public status API
change), and `pueued -d` starts through an ignored-stdio process boundary so
the daemon cannot retain capture pipes. Neither change alters the
`lane_lifecycle` state machine.
