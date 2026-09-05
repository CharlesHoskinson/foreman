# Workflow weight reduction specification

## ADDED Requirements

### Requirement: Verification receipts

WHEN a host-run gate completes on a frozen candidate tree, the harness SHALL
write one verification receipt outside worker authority, keyed by the
candidate tree digest, the base commit, the exact command, the selected
tests, the tool versions, the dependency identity, and the platform
capabilities, with the result and output digest.

#### Scenario: Receipt written

- **WHEN** `checks-run.sh` completes on a pristine archive
- **THEN** a receipt exists under `$FOREMAN_HOME/receipts/` with the tree digest and result

### Requirement: Receipts are reused

WHEN a later stage needs the same gate on the same receipt key, the harness
SHALL reuse the receipt and SHALL NOT run the gate again. IF any key
component differs, THEN the harness SHALL run the gate.

#### Scenario: Architect re-verification reuses

- **WHEN** the architect verifies a candidate whose receipt key matches
- **THEN** the stage reports the receipt and runs nothing

#### Scenario: Dependency changed

- **WHEN** the lockfile digest differs from the receipt key
- **THEN** the gate runs again

### Requirement: Workers cannot write receipts

A worker process SHALL NOT be able to create or modify a verification
receipt. IF a receipt file is written by a process outside the harness,
THEN the harness SHALL ignore it and SHALL record `receipt_untrusted`.

#### Scenario: Worker plants a receipt

- **WHEN** a lane writes a file under `$FOREMAN_HOME/receipts/`
- **THEN** the next stage ignores it and records `receipt_untrusted`

### Requirement: Bound change descriptor

WHEN `lane-round dispatch CHANGE_ID` runs, the runtime SHALL resolve the
root contract, family, child, credential profile, base commit, candidate,
gate command, report path, and queue group from registered authority and
SHALL print the resolved descriptor before it reserves an action. The
descriptor SHALL NOT expand the allowed paths or the action set of the
registered child.

#### Scenario: Descriptor resolved

- **WHEN** `lane-round dispatch v050-build-determinism` runs
- **THEN** the printed descriptor names the child, the profile, the base, and the gate command
- **AND** one reservation is made

#### Scenario: Descriptor cannot widen scope

- **WHEN** the descriptor is asked for a path outside the child's allowed paths
- **THEN** dispatch refuses with `scope_exceeded`

### Requirement: One wait per round

WHEN `lane-round wait RUN_ID` runs, the runtime SHALL block until the round
reaches a terminal state and SHALL print one result line with the phase
durations, including `queue_wait_s`.

#### Scenario: Wait returns on round done

- **WHEN** the round emits `round_done`
- **THEN** `wait` exits with the round's exit code within one second

### Requirement: Tiered gate plan

The harness SHALL keep one machine-readable gate plan in
`packages/policy/src/gate-plan.ts`. WHEN a change is classified, the plan
SHALL select the pre-commit tier from the closure of affected properties.
IF the classification is unknown, THEN the plan SHALL select the full tier.

#### Scenario: Docs-only change

- **WHEN** a change touches only `docs/**`
- **THEN** the pre-commit tier selects markdownlint, codespell, and the docs link check only

#### Scenario: Unknown path

- **WHEN** a change touches a path with no property mapping
- **THEN** the full tier is selected

### Requirement: Tier budgets

WHILE running on the reference host, the pre-commit tier SHALL complete in
at most 60 seconds and the full tier in at most 600 seconds. IF a tier
exceeds its budget, THEN the result SHALL be `incomplete` and SHALL NOT be
a pass.

#### Scenario: Budget exceeded

- **WHEN** the full tier runs past 600 seconds
- **THEN** the result is `incomplete`

### Requirement: Full tier before landing

WHEN a change contains executable code, the landing step SHALL require a
full-tier receipt on the exact candidate tree. A pre-commit receipt SHALL
NOT satisfy landing.

#### Scenario: Pre-commit receipt only

- **WHEN** landing is requested with only a pre-commit receipt
- **THEN** landing refuses with `full_tier_required`

### Requirement: Small-change tier

WHEN a change has at most three files and 150 changed lines, touches no
forbidden or security path, touches only TypeScript or documentation, and
has a determined spec, the harness SHALL admit it to the small-change tier.
The tier SHALL skip the search and plan fan-out and the separate audit
round. It SHALL keep host verification and, for executable code, the
cross-vendor audit run beside the gate.

#### Scenario: Qualifying change

- **WHEN** a one-file TypeScript change with a determined spec is dispatched
- **THEN** no search or plan worktree is created
- **AND** the audit runs beside the gate

### Requirement: Post-diff recheck

WHEN a small-change round produces its diff, the harness SHALL re-classify
the diff. IF the diff no longer qualifies, THEN the harness SHALL upgrade
the round to the full tier before landing.

#### Scenario: Diff grew

- **WHEN** the produced diff touches five files
- **THEN** the round is upgraded and the full tier runs

### Requirement: Audit beside the gate

WHEN the gate phase starts, the harness SHALL start the cross-vendor audit
on the same frozen candidate concurrently. The round SHALL NOT complete
until both have a result.

#### Scenario: Concurrent audit

- **WHEN** the gate starts
- **THEN** the audit's `prompt` event timestamp precedes the gate's `round_done`

### Requirement: Bounded automatic rework

IF the gate fails and the failure output is attributable to the change,
THEN the harness SHALL dispatch one rework round with the failure output as
the corrected spec, at most `max_rework_rounds` times, and SHALL record
each rework as an attempt.

#### Scenario: One automatic rework

- **WHEN** the gate fails once
- **THEN** a second attempt runs with the failure output in its spec
- **AND** the attempt count is 2

### Requirement: Landing transaction

WHEN `lane-round land RUN_ID` runs, the harness SHALL freeze pending edits,
require the full-tier receipt and the audit result, recheck the branch and
target immediately before applying, apply, archive evidence, and clean up
disposable worktrees in one step. IF the branch or target changed, THEN
landing SHALL refuse with `target_moved`.

#### Scenario: Target moved

- **WHEN** `main` advances between verification and apply
- **THEN** landing refuses with `target_moved`

### Requirement: Test suite partition

The test runner SHALL classify each test file as deterministic or
load-sensitive. WHEN isolation of the deterministic set is proven by a
recorded run with shared-state detection, the runner MAY run deterministic
files in bounded parallel shards. WHILE isolation is unproven, the runner
SHALL keep the existing mutex and serial order.

#### Scenario: Isolation unproven

- **WHEN** no isolation record exists
- **THEN** the runner runs serially under the mutex

### Requirement: Doctrine core

`skills/foreman/SKILL.md` SHALL be at most 150 lines and SHALL carry every
standing rule with a stable rule id. Endstop and release CLI grammar SHALL
move to the runtime's `--help`. Each reference SHALL be marked `doctrine`
or `history`.

#### Scenario: Rule inventory preserved

- **WHEN** the rule-id inventory before and after compression is compared
- **THEN** no rule id is missing

### Requirement: Task-specific doctrine

WHEN a lane is dispatched, the harness SHALL generate the worker context
from the descriptor, the five-part spec, and the traps whose paths match
the allowed paths. It SHALL NOT include the full trap archive.

#### Scenario: Matching traps only

- **WHEN** a lane's allowed paths are under `packages/launcher/`
- **THEN** the worker context includes launcher traps and excludes Windows interop traps

### Requirement: Round instrumentation

WHEN a round completes, the `round_done` payload SHALL carry
`queue_wait_s`, `preamble_s`, `implement_s`, `gate_s`, `audit_s`, and
`land_s`. The release check SHALL compute the idle share of the last twenty
rounds from these fields.

#### Scenario: Queue wait recorded

- **WHEN** a round waited in the queue
- **THEN** `queue_wait_s` is a number, not null

### Requirement: Stale instructions corrected

The doctrine SHALL name only commands that exist. IF a doctrine file names
a path that does not exist in the repository, THEN `doctrine-check` SHALL
fail.

#### Scenario: fm-session.py

- **WHEN** `doctrine-check` runs on the candidate
- **THEN** no doctrine file names `fm-session.py`
