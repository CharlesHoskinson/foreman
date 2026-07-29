# Spec delta — lane ownership and reaping

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: lane liveness is judged on process state and CPU, never on existence

The supervisor SHALL determine whether a lane is alive from its process
**state** and its **CPU consumed since start**, and SHALL NOT treat the
existence of a matching process as evidence of liveness.

A process in a stopped state (`STAT` beginning `T`) SHALL be reported
`SUSPENDED` and SHALL NOT be counted as running. A dispatched vendor process
that has consumed zero CPU after a configured grace period SHALL be reported
`WEDGED`.

`pgrep`-style existence matching SHALL NOT be used as a liveness predicate,
because it matches a stopped process identically to a running one.

#### Scenario: a suspended lane is reported suspended, not alive

- WHEN a dispatched vendor process is stopped by `SIGTTIN` after attempting
  terminal interaction from a background job
- THEN the supervisor reports `SUSPENDED` naming the pid and its state
- AND it does not report the lane as running
- AND it does not wait out the lane's remaining time budget.

### Requirement: every lane and watchdog carries an owner tag

WHEN the harness launches a lane or a watchdog, it SHALL record ownership in
the process environment as `FM_LANE_OWNER` and `FM_LANE_LABEL`, so the tag is
inherited by every child, AND SHALL record the pid in a per-owner registry so
ownership survives argv rewriting or `exec`.

WHERE a process cannot be attributed to the calling owner, it SHALL be
reported as foreign and SHALL NOT be killed by that owner's reap operation.

Adoption of an already-running process SHALL claim its entire descendant
subtree, because a lane is a timeout wrapper plus its vendor child and claiming
only the named pid leaves the child unattributable.

#### Scenario: a concurrent session's watchdog is visible but never killed

- WHEN a reap runs on a host where another session's watchdog is also running
- THEN the foreign process is listed with owner reported as foreign or untagged
- AND the reap does not signal it
- AND the reap reports how many processes it acted on and for which owner.

#### Scenario: adopting a running lane claims its vendor child too

- WHEN an already-running lane consisting of a `timeout` wrapper and a vendor
  child is adopted by pid
- THEN both processes are recorded to the adopting owner
- AND a subsequent ownership listing shows neither as foreign.

### Requirement: a lane that never launched its vendor is a stall, not a silence

The supervisor SHALL treat the absence of a vendor process after a configured
grace period as the distinct stall state `NEVER_LAUNCHED`, and SHALL NOT treat
it as equivalent to a lane that is running without producing output.

Each stall state SHALL be distinguished by the evidence that produced it —
`SUSPENDED` by process state, `NEVER_LAUNCHED` by absence of the vendor
process, `NO_OUTPUT` by an unchanged deliverable set, `WEDGED` by zero CPU —
and the report SHALL name that evidence rather than reporting an undifferentiated
"not responding".

#### Scenario: a lane that never started its vendor is surfaced

- WHEN a dispatched audit lane has run past its grace period and no vendor
  process exists for it
- THEN the supervisor reports `NEVER_LAUNCHED` for that lane
- AND names the vendor process it searched for and did not find.

### Requirement: headless vendor rounds detach stdin

WHERE the harness launches a vendor CLI non-interactively, it SHALL redirect
stdin from `/dev/null`, so that any interactive prompt fails immediately rather
than suspending the process on `SIGTTIN`.

#### Scenario: a vendor prompting mid-round fails fast instead of suspending

- WHEN a vendor CLI attempts to prompt during a headless round
- THEN the round exits non-zero with the prompt visible in its captured output
- AND the process is not left in a stopped state.

### Requirement: a liveness predicate is demonstrated against both a wedged and a healthy lane

Every predicate the supervisor uses to declare a lane wedged SHALL be
demonstrated, before use, to report correctly against **both** a genuinely
wedged process and a healthy one — specifically including a lane blocked on a
model response and an idle interactive session, both of which consume no CPU
while being perfectly healthy.

A predicate that cannot distinguish network-blocked from wedged SHALL NOT be
used, and its removal SHALL be recorded where the predicate lived so it is not
reintroduced.

#### Scenario: a candidate predicate that flags a healthy lane is rejected

- WHEN a candidate liveness predicate is evaluated against a dispatched lane
  that is blocked awaiting a model response
- THEN the predicate reports that lane healthy
- AND IF it does not, the predicate is rejected and the rejection recorded.

#### Scenario: an idle interactive session is never a reap candidate

- WHEN a reap runs while an interactive vendor session sits idle at a prompt
- THEN that session is not reported as wedged
- AND it is not signalled.
