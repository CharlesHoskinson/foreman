# Change: lane-ownership-and-reaping

## Why

**Eight lanes stranded in a single S1 session on 2026-07-29, across three
vendors and the orchestrator itself, and not one was detected by the mechanism
responsible for detecting it.** Full record:
`docs/incidents/2026-07-29-lane-strandings.md`.

Three defects in Foreman's own lane supervision are responsible.

**1. Existence is treated as liveness.** A grok round sat at `STAT=Tl` with
`TIME=00:00:00` for eleven minutes — suspended by `SIGTTIN` after the CLI
self-updated 0.2.112 -> 0.2.114 and attempted terminal interaction from a
background job. The watchdog armed against exactly this polled `pgrep`, which
matches a stopped process, and would have waited its full budget reporting the
lane alive. `pgrep` cannot distinguish `STAT=T` from `STAT=S`; nothing in the
harness inspects process state or CPU consumption.

**2. Lanes carry no ownership, so cleanup is unsafe.** A `lane-watchdog5.sh`
was found running 40+ minutes. Attributing it required reading
`/proc/<pid>/cwd` and grepping the script for a harness session path — it
belonged to a *different* Claude session. The safe action for an
unattributable wedged process is to leave it running, so untagged lanes
accumulate. On a box running concurrent sessions there is currently **no way to
ask "which of these are mine?"**

**3. A never-launched lane is indistinguishable from a working one.** An audit
lane sat twenty-one minutes having never started its vendor CLI: no error, no
notification, no artifact, no process. It was recovered only by a human-style
question ("have you launched codex yet?"). Absence of a vendor process is a
first-class stall signal and nothing watches for it.

Two further data points bear on the fix rather than the problem. The
prohibition on backgrounding a round and ending the turn was stated **verbatim**
in the lane brief and violated twice, which is consistent with
`round-ownership-default`'s claim that the failure is prompt-immune. And two
successive attempts at a CPU-delta "hang" predicate produced a false positive on
every run — first against a live interactive session, then against a healthy
lane blocked on a model response — so the sound predicate set is narrower than
it first appears.

## What changes

- `tools/lanectl.sh`: every lane and watchdog is launched with `FM_LANE_OWNER`
  and `FM_LANE_LABEL` in its environment (inherited by children) **and**
  recorded in a per-owner PID registry. `ps` and `reap` operate on the calling
  owner's lanes only; a foreign session's processes are visible but never
  actionable.
- `tools/reap-stale-lanes.sh`: liveness judged on **process state** and
  **CPU-since-start**, never on existence. Only `STAT=T` (suspended, cannot
  self-recover) and zero-CPU-after-grace are treated as wedged, and only for
  processes with a `timeout` ancestor so interactive sessions are structurally
  excluded.
- `adopt` claims a whole process subtree, because a lane is a `timeout` wrapper
  plus a vendor child and claiming only the named pid leaves the child foreign.
- A stall taxonomy the supervisor can act on: `SUSPENDED`, `NEVER_LAUNCHED`,
  `NO_OUTPUT`, `WEDGED`, distinguished by evidence rather than collapsed into
  "not responding".
- Headless vendor rounds launch with `stdin < /dev/null` so an interactive
  prompt fails fast instead of suspending the process.

## Impact

- Affected: new `tools/lanectl.sh`, new `tools/reap-stale-lanes.sh`,
  `skills/foreman/scripts/watch.sh` (state-based liveness),
  `lane-supervise.sh` (stall taxonomy), `lane-run.sh` (owner tagging at
  dispatch, stdin detachment), new `tests/lane-ownership.bats`.
- Complements `round-ownership-default` rather than duplicating it: that package
  keeps a round owned by its launcher; this one makes a stranded or foreign lane
  **observable and safely actionable** after the fact. Neither subsumes the
  other — S-3/S-4 show ownership failing, S-1/S-2/S-5 show detection failing.
- Belongs in S4. Should land after `round-ownership-default`.
- Evidence: `docs/incidents/2026-07-29-lane-strandings.md`.
