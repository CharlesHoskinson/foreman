# Spec delta — round ownership

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: round-owned dispatch is the default, and it is enforced in code

A lane round SHALL be owned end to end by `lane-run.sh --round GATE_CMD
REPORT_PATH`, which runs CMD, then the gate, then asserts the report is
attempt-fresh, and only then emits `round_done`.

WHILE `durable.enabled` resolves to true, `lane-run.sh` SHALL refuse to start a
round that was invoked without `--round`.
The refusal SHALL name the missing owner and SHALL occur before any child
process is spawned and before any vendor CLI is invoked.
IF `durable.enabled` resolves to false, THEN unowned invocation SHALL remain
available unchanged, preserving the pre-change behaviour for repos that have
opted out explicitly.
`durable.enabled` SHALL default to true in `config/foreman.toml.example` and in
the shared configuration loader's default table.

#### Scenario: an unowned dispatch is refused while durable is enabled

- WHEN `lane-run.sh RUN LANE WORKTREE -- CMD...` is invoked without `--round`
  on a repo whose resolved `durable.enabled` is true
- THEN the invocation exits non-zero before spawning CMD
- AND the error names round ownership as the unmet requirement
- AND no vendor CLI process is started.

#### Scenario: an owned dispatch is never refused

- WHEN `lane-run.sh --round GATE_CMD REPORT_PATH RUN LANE WORKTREE -- CMD...`
  is invoked on the same repo
- THEN the ownership check passes silently
- AND the round proceeds exactly as it does today.

#### Scenario: an explicit opt-out preserves the old path

- WHEN `durable.enabled` resolves to false because the repo's
  `.foreman/config.toml` sets it so
- THEN an unowned invocation runs as it did before this change
- AND no refusal is emitted.

### Requirement: `durable.enabled` has a consumer in code

The `durable.enabled` configuration key SHALL be read by executable code at the
dispatch boundary, not evaluated by a reader of documentation.

WHEN `durable.enabled` is resolved, it SHALL be resolved through the shared
loader's precedence chain (`DURABLE_ENABLED` env var, then TOML, then default),
identically to every other `[durable]` key.
The "Used by" column for `durable.enabled` in
`skills/foreman/references/durable-lanes.md` SHALL name the real consumer, and
SHALL NOT read `(documented gate; soft-mode routing)`.
The suite SHALL contain a test that fails IF no executable code path reads the
key, so the flag cannot silently return to being inert.

#### Scenario: the env-var override reaches the enforcement point

- WHEN `DURABLE_ENABLED=false` is exported and an unowned round is dispatched
  against a repo whose TOML says true
- THEN the round is not refused
- AND the precedence chain behaved identically to `durable.stall_warn`.

#### Scenario: an inert flag fails the suite

- WHEN the enforcement read is removed from the dispatch path
- THEN the consumer test fails and names `durable.enabled` as unconsumed.

### Requirement: a round requires an explicit gate command

Round mode SHALL require a gate command supplied by the caller.

`lane-run.sh` SHALL NOT supply a default gate command, and SHALL NOT accept a
gate command that is empty or whitespace-only.
IF round mode is requested with no gate command, THEN the round SHALL be
refused before CMD is spawned, with the missing gate named.
The exit status of the worker process SHALL NOT be treated as evidence that the
round succeeded; `round_done` SHALL continue to require both a passing gate and
an attempt-fresh report, as it does today.

#### Scenario: an empty gate command is refused, not defaulted

- WHEN round mode is requested with an empty gate command
- THEN the round is refused with the missing gate named
- AND no `round_done` event is written for that attempt.

#### Scenario: a green worker exit with a failing gate never completes the round

- WHEN CMD exits 0 but the gate command exits non-zero
- THEN `waiting_child` and `alert{kind:"round_incomplete"}` are emitted
- AND no `round_done` event is written
- AND `lane-run.sh` exits non-zero.

### Requirement: completion is defined by artifacts, never by an agent's turn

A lane SHALL be treated as complete only WHEN a `round_done` event exists for
its current attempt AND its report artifact is attempt-fresh.

An agent's conversational state — a final message, a returned result, a stopped
turn, or a completion notification — SHALL NOT be an input to the completion
predicate at any layer of the system.
WHERE tooling reports lane status to an operator or an architect, it SHALL
derive that status from the event log, and SHALL NOT infer it from process
liveness or from filesystem mtime alone.

#### Scenario: a stopped wrapper with no round_done is incomplete

- WHEN the agent that dispatched a round ends its turn while the round's
  `round_done` event is absent
- THEN the lane's reported status is incomplete
- AND the status names the absent `round_done` as the reason.

#### Scenario: a prior round's report does not satisfy the predicate

- WHEN a report artifact exists in the worktree but predates the current
  attempt's prompt event
- THEN the report is not attempt-fresh
- AND `round_done` is not emitted for that attempt.

### Requirement: unowned dispatch is possible, explicit, and recorded

WHERE a target's buildable and verifiable unit is not the git worktree — for
example a runtime whose installed dependencies and live services sit outside
the checkout — an operator SHALL be able to dispatch a round without round
ownership.

IF unowned dispatch is used while `durable.enabled` is true, THEN the operator
SHALL state a reason, and the system SHALL record an `alert` event carrying
that reason.
The system SHALL NOT downgrade an owned dispatch to an unowned one silently
under any condition, including a missing launcher, a missing queue daemon, or a
missing gate command.

#### Scenario: the escape hatch leaves a trace

- WHEN an operator dispatches an unowned round with a stated reason while
  `durable.enabled` is true
- THEN the round runs
- AND an `alert` event records the reason verbatim
- AND the event is visible to the same replay that reads every other event.

#### Scenario: a missing launcher degrades but does not disown

- WHEN a round is dispatched with `--round` on a host where `foreman-launch`
  does not resolve
- THEN the round still runs under `lane-run.sh`'s ownership
- AND `alert{kind:"degraded",reason:"launcher_absent"}` is emitted
- AND the round is not converted to an unowned dispatch.


### Requirement: round ownership is recorded in the event log

The `prompt` event payload SHALL record the round's ownership parameters, so
that a round can be reconstructed from the event log alone.

WHEN a round is dispatched with `--round GATE_CMD REPORT_PATH`, the `prompt`
event for that attempt SHALL carry `gate_cmd` and `report_path` in its payload,
together with a field naming the dispatch mode.
WHEN a round is dispatched unowned under the recorded escape hatch, the
`prompt` event SHALL record the plain mode explicitly, rather than leaving it
to be inferred from the absence of fields.
The change SHALL be additive to the event payload only. `el_emit` treats `type`
opaquely and the event schema is additive, so no event-log library change is
required and none SHALL be made by this package -- it is the same additive
payload move `decision-lineage-and-telemetry` already makes.
Any consumer reading a `prompt` event written before this change SHALL treat
absent ownership fields as unknown, and SHALL NOT infer plain mode from their
absence.

#### Scenario: a round-owned prompt event carries its gate

- WHEN a round is dispatched with `--round GATE_CMD REPORT_PATH`
- THEN the `prompt` event for that attempt records `gate_cmd` equal to GATE_CMD
  and `report_path` equal to REPORT_PATH
- AND the dispatch mode is recorded as round-owned.

#### Scenario: the event log alone is sufficient to re-dispatch

- WHEN a supervisor reads only the event log for a lane's current attempt
- THEN it can reconstruct that round's `--round` invocation without reading any
  other file.

#### Scenario: a legacy event is unknown, not plain

- WHEN a `prompt` event written before this change is read
- THEN its dispatch mode is reported as unknown
- AND it is not treated as a round that was dispatched in plain mode.

### Requirement: auto-resume refuses to downgrade a round-owned round to plain mode

The auto-resume supervisor SHALL NOT re-dispatch a round in plain mode when the
round it is resuming was dispatched round-owned.

WHERE the ownership parameters are present in the `prompt` event payload, the
supervisor SHALL re-dispatch in `--round` mode using exactly those recorded
values, and SHALL NOT substitute a default gate command.
IF the supervisor cannot determine the resumed round's `gate_cmd` and
`report_path`, THEN it SHALL refuse to re-dispatch, SHALL emit an `alert`
naming the missing ownership parameters, and SHALL leave the lane in a state an
operator can resume manually.
A warning followed by a plain re-dispatch -- the shipped behaviour at
`lane-supervise.sh:343-345`, which logs that the resumed round "loses gate-phase
automation" and then calls `ls_reenqueue` with a bare command -- SHALL NOT be a
permitted outcome. Warn-and-proceed is what allowed a recovery path to reopen
the failure class it exists to recover from.
A refusal SHALL be counted against `durable.resume_max_attempts` in the same way
as any other failed resume, so that a lane cannot loop on refusals.

#### Scenario: a resumed round keeps its gate

- WHEN a round dispatched with `--round GATE_CMD REPORT_PATH` stalls and the
  supervisor resumes it
- THEN the resumed round is dispatched with `--round` using the recorded
  GATE_CMD and REPORT_PATH
- AND the resumed round's completion still requires a passing gate and an
  attempt-fresh report.

#### Scenario: missing ownership parameters cause a refusal, not a plain re-dispatch

- WHEN the supervisor resumes a round whose prior attempt was round-owned but
  whose ownership parameters cannot be read
- THEN no re-dispatch occurs
- AND an `alert` records the missing `gate_cmd` and `report_path`
- AND the lane is not left running in plain mode.

#### Scenario: the supervisor never invents a gate command

- WHEN the supervisor re-dispatches a resumed round
- THEN the gate command it uses is the one recorded for the prior round
- AND no default gate command is supplied by `lane-supervise.sh`.

#### Scenario: refusals are bounded

- WHEN the supervisor refuses to resume a lane repeatedly
- THEN each refusal is counted against `durable.resume_max_attempts`
- AND the lane stops being resumed once that budget is exhausted.

## MODIFIED Requirements

### Requirement: shipped configuration defaults to round ownership, and migration reports rather than rewrites

The shipped example configuration and the loader default for
`durable.enabled` SHALL be true.

WHEN Setup runs against a repo whose `.foreman/config.toml` sets
`durable.enabled = false` explicitly, it SHALL report that the setting differs
from the shipped default and SHALL name the failure class the default protects
against.
Setup SHALL NOT modify the user's `.foreman/config.toml`.
WHERE `durable.enabled` becomes true for a repo, `durable.resume_max_attempts`
SHALL be set to an explicit, conservative value rather than left to an unstated
default, because bounded auto-resume becomes reachable for the first time.

#### Scenario: an explicit opt-out is reported, not overwritten

- WHEN Setup runs on a repo with `durable.enabled = false` written in its
  config
- THEN Setup reports the divergence from the shipped default
- AND the file's bytes are unchanged after Setup completes.

#### Scenario: a repo with no `[durable]` section adopts the new default

- WHEN Setup runs on a repo whose `.foreman/config.toml` has no `[durable]`
  section
- THEN `durable.enabled` resolves to true
- AND round-owned dispatch is enforced for that repo.
