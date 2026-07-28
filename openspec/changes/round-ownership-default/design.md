# Design — round-ownership-default

## What is actually broken, precisely

Two separate things, and conflating them is why the fix has not landed already.

**(1) The default is wrong.** `.foreman/config.toml:29` and
`config/foreman.toml.example:34` both ship `durable.enabled = false`, so the
structural fix for the release's dominant failure class is opt-in.

**(2) The switch is not connected to anything.** `DURABLE_ENABLED` occurs twice
in the whole codebase, both inside `lib/config.sh` — the env-var mapping table
at `:66` and the parser's allow-list at `:148`. There is no third occurrence.
`references/durable-lanes.md:71` is candid about it, listing the key's consumer
as `(documented gate; soft-mode routing)` where every other row in that table
names a script.

So the enforcement path today is: a human or a model reads `SKILL.md:174`
(*"When `.foreman/config.toml` has `[durable] enabled = true`"*), evaluates that
condition, and chooses a dispatch form. That is prose enforcement of a rule
whose entire justification is that prose enforcement does not hold. Fixing (1)
without fixing (2) ships a flag that is true and still means nothing.

## The dispatch boundary is the only place this can be enforced

`lane-run.sh` is already the funnel: it owns the child pid, the ownership event,
the heartbeat file, the checkpoint loop, the vendor-home export, and the cleanup
trap. `--round` is a mode flag on that same script (`ROUND_MODE`,
`lane-run.sh:1143`). The enforcement point is therefore inside `lane-run.sh`,
before anything spawns: read `durable.enabled` through `cfg_get`, and IF it is
true AND `ROUND_MODE` is 0, refuse.

This is deliberately not a new script and not a wrapper. A new admission binary
would be a fifth thing a dispatcher could forget to call. The rule has to sit on
the path that already cannot be bypassed.

## Why the gate command cannot have a default

The obvious convenience — default `GATE_CMD` to `true` so existing callers work
unchanged — is the one thing this package must not do.

Two entries in the log say why, independently:

- 2026-07-18, pueue argv quoting: *"EVERY task in the real daemon's persisted
  history (~40 from tonight's gates) is Failed(1) … exit codes and event streams
  passed while the actual workload failed 100% of the time."*
- 2026-07-28, the grok lane: *"Lane B exited 'success' (ExecMainStatus=0) with a
  RED BUILD — the worker's exit status is not evidence."*

A `true` gate produces a `round_done` event, an attempt-fresh report, and a
green round for a lane that did nothing. It would make the round-ownership
machinery *manufacture* the false completion signal it exists to prevent, and it
would do so with the full authority of a structural artifact rather than an
agent's claim. Refusing to start is strictly better than starting without
evidence.

For the migration, `checks-run.sh TASK_ID` is the ready-made gate for hard-mode
tasks and the recommended starting point for soft-mode rounds. It is a
recommendation in docs, not a default in code.

## Alternatives considered and REJECTED

**Prompt harder.** Rejected on measurement, not taste. The countermeasures
escalated across eleven occurrences — from an instruction, to a capitalized
prohibition, to a capitalized prohibition plus an artifacts-define-completion
clause — and the failure rate did not fall. Occurrence N+1 landed on the lane
implementing the structural fix, with the prohibition in its brief
(`bugeventlog.md:648-676`). The correct reading is that no design may *depend*
on the instruction holding; the log itself already says this
(`:318-322`). The instruction stays as defence in depth and is load-bearing for
nothing.

**Detect and recover: keep it opt-in, lean on watchdogs.** Rejected. This is
exactly the current state, and its cost is a manual `SendMessage` resume per
occurrence plus the architect's attention. Worse, the detector is unreliable in
its own right: failure class #2 in the taxonomy is six distinct watchdog
false-signal modes — read-heavy lanes (`:96-113`), already-completed lanes,
stale report artifacts (`:355-382`), missing dispatch grace (`:383-393`), and
bats writing its scratch to `/tmp` rather than the worktree (`:452-478`). A
control loop whose sensor has six documented failure modes cannot be the primary
control for the system's dominant failure class.

**Make round mode mandatory, with no escape hatch.** Rejected. The 2026-07-19
entry documents a target where the doctrine genuinely does not apply: the
Midnight runtime's SDK lives in a pinned sub-repo's `node_modules` and its
verification needs a proof server on `:6300` and live testnet endpoints — none
of which a git worktree carries. The log's own conclusion is that *"foreman's
parallel-worktrees doctrine assumes the buildable/verifiable unit == the git
worktree"* and that a stateful/live-target profile is needed. An absolute rule
would have been violated that day and would have taught the operator that the
rule is advisory.

**Silent auto-downgrade when `--round` is absent.** Rejected, and it is the most
tempting option because it breaks nothing. It is also failure class #8 in
miniature: the release's own record contains a push made on a misread exit code
(`:707-729`) and a force-merge without a clean gate (`:677-706`). R2's P6 states
the general rule — *"if a workflow bounds coverage … log what was dropped;
silent truncation reads as 'covered everything' when it didn't."* A downgrade
that is not in the record is a downgrade nobody will ever count.

**Flip the default and leave the flag inert (docs-only change).** Rejected: it
is the null change dressed as a fix, and it would let the release claim the
dominant failure class was addressed while the enforcement path remained a
sentence in `SKILL.md`.

## Migration: what actually breaks, and why it is safe

- **Callers that pass no gate.** They now fail loudly at dispatch instead of
  running unowned. This is the intended break. It is a startup-time refusal with
  a named reason, before any vendor CLI is billed.
- **Repos with an explicit `enabled = false`.** Nothing changes for them. Setup
  reports that their setting now differs from the shipped default and names the
  failure class it protects against. **Setup does not rewrite the file.** A tool
  that silently edits a user's committed configuration to change its own
  behaviour is a worse defect than the one being fixed.
- **Hosts without `launcher/dist`.** The round still runs; it degrades and
  emits `alert{kind:"degraded",reason:"launcher_absent"}` (`lane-run.sh:966`).
  Degraded-and-owned beats undegraded-and-unowned. `wsl-launcher-shipped` closes
  the gap; until it lands, the alert is the honest signal.
- **Auto-resume becomes reachable.** With durable on, `lane-supervise.sh`'s
  bounded resume applies. `resume_max_attempts` is currently commented out in
  both config files. The migration SHALL set it explicitly and conservatively
  rather than letting an unstated default govern a newly-reachable path.
- **Emit volume rises.** Heartbeats at `heartbeat_interval = 30` plus a
  checkpoint every `checkpoint_interval = 20` seconds, for every lane, become
  universal. `el_compact` already rolls heartbeats up (`lib/eventlog.sh:374`,
  `is_collapsible` matches `heartbeat` only), so growth is bounded. The lock
  contention this creates is the reason for the ordering constraint below.

## Ordering

**After `lock-primitive-hardening`.** Universal durable dispatch is a
multiplier on `el_emit` contention, and `el_emit`'s mutex is measured broken on
the reference host. Landing this first would make a corrupted event log the
normal case rather than the contended case — and the event log is what defines
completion under this very change.

**After `test-infrastructure-hardening`,** or at least alongside it. This
package changes the default path every other package is verified on; a suite
that cannot tell an environment failure from a product failure cannot tell
whether the flip broke anything.

**Alongside `wsl-launcher-shipped`.** Not blocking, but the two together are
what make the default path also the good path.

## Risks

- **Blast radius is every round.** Mitigated by keeping the change to two
  mechanisms — a default value and one refusal at one call site — each
  revertable independently, and by the escape hatch existing from day one.
- **The escape hatch becomes the road.** If supplying a gate command is
  annoying, operators will reach for the opt-out and the release will report
  success while nothing changed. This is measurable and MUST be measured: the
  round-owned share of dispatches, and the count of recorded escape-hatch
  alerts with their stated reasons. If the escape hatch exceeds a stated
  fraction of dispatches, the finding is that the gate ergonomics are wrong,
  not that operators are undisciplined.
- **Queue exposure.** Round-mode doctrine dispatches through `lane-queue.sh`,
  and pueue-on-Windows argv quoting was broken as recently as v0.2.5 T0
  (`bugeventlog.md:743-771`). The fix shipped with a real-daemon assertion; this
  package inherits it and adds no new quoting surface, but a reviewer should
  know that raising queue traffic raises exposure to that class.
- **A refusal at dispatch is a new way for a run to fail before it starts.** It
  must never fire on a correctly-formed round. The regression test asserts both
  directions: the refusal fires on an unowned dispatch, and does not fire on an
  owned one.

## Formal verification, 2026-07-28: the fix is abandoned at the first auto-resume

`formal/specs/lane_lifecycle.qnt` models the lane lifecycle in a pre-fix and a
post-fix configuration. Verified with Apalache 0.56.1; see
`formal/reports/M1-lane-lifecycle.md` and
`formal/reports/VERIFY-quint-architect.md`.

### The package's premise is formally reproduced

The background-and-stop attractor this change exists to close is reachable in
the model, and the change closes it:

| configuration | invariant | result |
|---|---|---|
| `init_prefix` / `step_prefix` | `inv_round_done_requires_fresh_report` | **VIOLATED** |
| `init_prefix` / `step_prefix` | `inv_no_completion_from_exit_code` | **VIOLATED** |
| `init_postfix` / `step_postfix_without_resume` | `inv_round_done_requires_fresh_report` | holds |

Note the third row's entrypoint: `step_postfix_without_resume`. That
qualification is the whole finding.

### The defect nobody was looking for

| configuration | predicate | depth | result |
|---|---|---|---|
| `init_postfix` / `step_postfix` | `witness_shipped_resume_loses_round_ownership` | 12 | not reachable |
| `init_postfix` / `step_shipped_resume_bug` | same witness | 12 | **REACHABLE** |

The two configurations differ by exactly one action,
`successfulResumePlain`, which models `lane-supervise.sh`'s re-dispatch. So the
result is only as good as that action's fidelity to the code -- which is
checkable. `skills/foreman/scripts/lane-supervise.sh:343-345` logs, in shipped
code:

> `prior rounds used --round mode, but GATE_CMD/REPORT_PATH are never recorded
> in any event payload in the currently shipped schema -- re-dispatching PLAIN
> mode (not --round); the resumed round loses gate-phase automation until
> re-dispatched manually with --round`

and then calls `ls_reenqueue` with a bare `cmd`. The header notes at `:79-83`
confirm that no event payload records `--round GATE_CMD REPORT_PATH` mode.

The model is faithful and the defect is real. **The auto-resume supervisor,
whose entire purpose is recovery, reopens the exact failure class it recovers
from.** This package turns on the durable round loop to close failure class #1,
and the loop is abandoned at the first auto-resume.

### Why the remedy is small

Two independent mechanisms, both bounded:

1. **Record what the round owns.** `gate_cmd` and `report_path` go into the
   `prompt` event payload. The event schema is additive and `el_emit` treats
   `type` opaquely, so this needs no library change -- it is the same additive
   payload move `decision-lineage-and-telemetry` already makes, and the two
   should agree on field names rather than each inventing their own.
2. **Refuse rather than warn.** The shipped code is honest about the mechanism;
   it warns. Nothing connects that warning to its consequence, and the run
   proceeds. Warn-and-proceed is precisely what let a known-lossy path survive
   in shipped code with an accurate description of its own defect sitting in
   the log line. It is also the same anti-pattern
   `lock-primitive-hardening` now removes from `wt-new.sh:203`; both packages
   are converting a warning into a refusal for the same reason.

This is consistent with the requirement already in this delta that the system
"SHALL NOT downgrade an owned dispatch to an unowned one silently under any
condition" -- the supervisor's plain re-dispatch is exactly such a downgrade,
and it survived because that requirement had no enforcement point in the
resume path.

### Standing limits of this evidence

Apalache bounded to depth 12: reachability is established, and non-reachability
under `step_postfix` holds only within 12 steps. M1's `eventually_terminal`
temporal property "fails" solely as a no-fairness stuttering artifact and
SHALL NOT be cited as a liveness bug. Re-run with:

```
quint verify formal/specs/lane_lifecycle.qnt --main=lane_lifecycle \
  --init=init_postfix --step=step_shipped_resume_bug \
  --invariant=witness_shipped_resume_loses_round_ownership \
  --max-steps=12 --apalache-version=0.56.1
```
