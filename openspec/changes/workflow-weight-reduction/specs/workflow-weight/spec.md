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

### Requirement: Receipt registration

WHEN the harness writes a receipt, it SHALL append a `receipt` event to the
run's `events.jsonl` carrying the receipt digest, the receipt key, and the
harness attempt id, before any later stage starts. In soft mode the lane
runs under the operator's own uid, so a file location is not a trust
boundary. Receipt trust SHALL equal event-log trust, the same authority
that `round_done` has today. The container profile of hard mode remains
the only principal boundary.

#### Scenario: Receipt registered

- **WHEN** `checks-run.sh` writes a receipt
- **THEN** a `receipt` event with the same digest exists in `events.jsonl`

### Requirement: Receipt reuse is verified

WHEN a stage considers reusing a receipt, it SHALL recompute the candidate
tree digest from the frozen archive the harness created, SHALL require a
`receipt` event whose digest equals the file's digest, and SHALL require
that event to precede the current stage's `prompt` event. IF any check
fails, THEN the stage SHALL record `receipt_untrusted` and run the gate.

#### Scenario: Forged receipt with a valid shape

- **WHEN** a receipt file has the accepted shape but no matching `receipt` event
- **THEN** the stage records `receipt_untrusted` and runs the gate

#### Scenario: Replaced receipt

- **WHEN** the receipt file's digest differs from the registered digest
- **THEN** the stage records `receipt_untrusted` and runs the gate

#### Scenario: Late registration

- **WHEN** the `receipt` event follows the current stage's `prompt` event
- **THEN** the stage records `receipt_untrusted` and runs the gate

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
path under `sandbox/`, `env/`, `packages/policy/`, `packages/launcher/`,
`skills/foreman/scripts/`, or the `forbidden_paths` list in
`.foreman/config.toml`, touches only `.ts` or `.md` files, and has a spec
whose five parts are all present, the harness SHALL admit it to the
small-change tier.
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

### Requirement: Audit pipelined after the checks receipt

WHEN the gate's checks receipt is registered with a passing result, the
harness SHALL reserve and start the cross-vendor `audit` action on the same
frozen candidate without a human step. The retained release policy order
(checks receipt before `audit`) SHALL NOT change. The round SHALL NOT
complete until the audit has a result.

#### Scenario: Audit starts on the checks receipt

- **WHEN** the passing checks receipt event is appended
- **THEN** the audit `prompt` event follows it within ten seconds
- **AND** no operator command was issued between them

#### Scenario: Audit refused without checks

- **WHEN** an audit reservation is requested before a passing checks receipt exists
- **THEN** release policy refuses it as today

### Requirement: Bounded automatic rework

IF the gate fails and the failure output names at least one path in the
candidate diff, THEN the harness SHALL dispatch one rework round with the failure output as
the corrected spec, at most `max_rework_rounds` times, and SHALL record
each rework as an attempt.

#### Scenario: One automatic rework

- **WHEN** the gate fails once
- **THEN** a second attempt runs with the failure output in its spec
- **AND** the attempt count is 2

### Requirement: Landing freezes first

WHEN `lane-round land RUN_ID` runs, the harness SHALL first commit any
pending worker edits host-side so the candidate is one commit.

#### Scenario: Pending edits frozen

- **WHEN** the worktree has uncommitted edits at landing
- **THEN** one host-side commit is created before any check runs

### Requirement: Landing requires receipts

WHEN the candidate is frozen, landing SHALL require a registered full-tier
receipt and an audit result for that exact candidate. IF either is absent,
THEN landing SHALL refuse with `full_tier_required` or `audit_required`.

#### Scenario: Audit missing

- **WHEN** no audit result exists for the candidate
- **THEN** landing refuses with `audit_required`

### Requirement: Landing rechecks the target

WHEN receipts are present, landing SHALL recheck the branch head and the
target head immediately before applying. IF either changed, THEN landing
SHALL refuse with `target_moved`.

#### Scenario: Target moved

- **WHEN** `main` advances between verification and apply
- **THEN** landing refuses with `target_moved`

### Requirement: Landing applies and archives

WHEN the recheck passes, landing SHALL apply the candidate, archive the
run's evidence, and remove clean disposable worktrees, in that order. A
dirty worktree SHALL be preserved. A `landed` event SHALL carry `land_s`.

#### Scenario: Dirty worktree preserved

- **WHEN** a disposable worktree has untracked files at cleanup
- **THEN** it is preserved and named in the landing result

### Requirement: Test suite partition

The test runner SHALL classify each test file as deterministic or
load-sensitive. WHEN isolation of the deterministic set is proven by a
recorded run with shared-state detection, the runner MAY run deterministic
files in bounded parallel shards. WHILE isolation is unproven, the runner
SHALL keep the existing mutex and serial order.

#### Scenario: Isolation unproven

- **WHEN** no isolation record exists
- **THEN** the runner runs serially under the mutex

### Requirement: Full gate feasibility measured first

WHEN this package starts, the harness SHALL run the complete Bats suite
once under the existing mutex and record the wall clock and the exclusive
phase duration. IF the exclusive phase alone exceeds 600 seconds, THEN the
full-tier budget SHALL be renegotiated in the register before any shard
work starts.

#### Scenario: Budget renegotiated

- **WHEN** the measured exclusive phase is 900 seconds
- **THEN** the register records the new full-tier budget and its reason

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

WHEN a round completes, the `round_done` payload SHALL carry the interval
timestamps `queued_at`, `prompt_at`, `implement_end_at`, `gate_start_at`,
`gate_end_at`, `audit_start_at`, and `audit_end_at`, plus the derived
`queue_wait_s`. The `landed` event SHALL carry `land_s`. The release check
SHALL compute idle time as the round's wall clock minus the union of the
model, gate, and audit intervals, over the twenty most recent rounds whose
`runtime_commit` equals the candidate. IF fewer than twenty such rounds
exist, THEN the predicate SHALL be `UNCOMPUTABLE`.

#### Scenario: Queue wait recorded

- **WHEN** a round waited in the queue
- **THEN** `queue_wait_s` is a number, not null

#### Scenario: Overlap not double-counted

- **WHEN** the gate and audit intervals overlap by 30 seconds
- **THEN** the idle computation subtracts their union, not their sum

### Requirement: Stale instructions corrected

The doctrine SHALL name only commands that exist. IF a doctrine file names
a path that does not exist in the repository, THEN `doctrine-check` SHALL
fail. The checker is owned by `doctrine-reality-drift`. This package
extends it only after that package's milestone.

#### Scenario: fm-session.py

- **WHEN** `doctrine-check` runs on the candidate
- **THEN** no doctrine file names `fm-session.py`
