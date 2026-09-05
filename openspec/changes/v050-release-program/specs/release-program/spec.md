# v0.5 release program specification

## ADDED Requirements

### Requirement: Release baseline and authority

The v0.5 program SHALL use commit
`00c342bd449948ab2ea5ca0b9d0c890614dd81d6` as its immutable baseline.
WHEN the program starts or resumes, the host SHALL verify the baseline object
and record its identity in SessionDB. IF a derived artifact conflicts with an
authoritative source, THEN the authoritative source SHALL win and the host
SHALL mark the derived artifact stale.

#### Scenario: Baseline identity matches

- **WHEN** the release program starts or resumes
- **THEN** the host verifies the baseline object and its expected tree
- **AND** the host records the identity in SessionDB

#### Scenario: Baseline object is absent

- **WHEN** the baseline object cannot be resolved in the repository
- **THEN** the program refuses to start
- **AND** the refusal names the missing object

### Requirement: Program-parameterized release runtime

The release runtime SHALL accept a closed program enum of `v040` and `v050`.
WHEN a release block names program `v050`, the runtime SHALL apply the v0.5
coverage register and the v0.5 exit predicates. WHEN a release block names
program `v040`, the runtime SHALL keep the v0.4 behavior unchanged. IF a
release block names any other program, THEN the runtime SHALL refuse with
`wrong_program`.

#### Scenario: v050 release block is admitted

- **WHEN** `lane-queue.sh add` carries `--release-program v050`
- **THEN** release policy evaluates the v0.5 register
- **AND** the reservation records program `v050`

#### Scenario: Unknown program is refused

- **WHEN** a release block carries `--release-program v041`
- **THEN** the queue refuses before any process starts
- **AND** stderr contains `wrong_program`

#### Scenario: v040 evidence stays valid

- **WHEN** a v0.4 evidence bundle is checked against program `v040`
- **THEN** the check result equals the v0.4.0 result

### Requirement: Complete release-scope reconciliation

The program SHALL keep one coverage register at
`openspec/changes/v050-release-program/coverage.toml`. The register SHALL
contain one keyed entry for every active OpenSpec package. Each entry SHALL
carry one disposition from `v050_owner`, `v050_dependency`,
`released_reference`, `superseded`, or `v060`. WHILE an entry has
`reconcile = "required"`, the program SHALL NOT dispatch an implementation
lane for that owner. IF a package exists without an entry, THEN the bootstrap
check SHALL fail with `unreconciled_package`.

#### Scenario: Register is complete

- **WHEN** the bootstrap check runs
- **THEN** every directory under `openspec/changes/` outside `archive/` has one entry
- **AND** the recorded inventory digest equals the digest of the sorted directory names

#### Scenario: Owner still needs reconciliation

- **WHEN** a lane check runs for an owner whose entry says `reconcile = "required"`
- **THEN** the check fails with `reconciliation_required`
- **AND** no lane starts

#### Scenario: Bash-targeted task is dispatched

- **WHEN** a reconciled owner's `tasks.md` names a new `.sh` or `.py` product file
- **THEN** the reconciliation is invalid
- **AND** the lane check fails with `iron_rule_violation`

### Requirement: Dependency-bound release tranches

The program SHALL run eight tranches in this order: program bootstrap, lane
runtime, launcher retirement, verdict honesty, exploratory route, host truth,
doctrine, release. WHEN a tranche starts, every tranche it depends on SHALL
have a recorded milestone. IF a dependency milestone is absent, THEN the
tranche SHALL NOT start.

#### Scenario: Tranche starts in order

- **WHEN** the launcher-retirement tranche starts
- **THEN** the lane-runtime milestone exists in SessionDB

#### Scenario: Tranche starts out of order

- **WHEN** the verdict-honesty tranche is requested before the lane-runtime milestone
- **THEN** the request is refused with `dependency_milestone_missing`

### Requirement: One Endstop family

The program SHALL run under one root-anchored Endstop contract with eight
children named `v050-t1-bootstrap` through `v050-t8-release`. WHEN a child
reaches a terminal state, the program SHALL NOT create a replacement child
without an explicit user authorization that cites the terminal predecessor.

#### Scenario: Child completes

- **WHEN** child `v050-t2-lane-runtime` records its integration milestone
- **THEN** the family status shows that child complete
- **AND** the next child can reserve an action

#### Scenario: Terminal child is retried

- **WHEN** a queue request cites an exhausted child
- **THEN** the queue refuses
- **AND** no vendor process starts

### Requirement: Exit predicates

The program SHALL define eight exit predicates. Each predicate SHALL name one
command and one expected result. WHEN the release phase runs, the host SHALL
measure every predicate on the unchanged candidate commit. IF any predicate
fails or is uncomputable, THEN publication SHALL NOT proceed.

#### Scenario: All predicates pass

- **WHEN** the release check runs on the candidate
- **THEN** each of the eight predicates records a pass with its command output digest

#### Scenario: A predicate is uncomputable

- **WHEN** a predicate command cannot run on the release host
- **THEN** the release check records `UNCOMPUTABLE` for that predicate
- **AND** publication is refused

### Requirement: Explicit deferrals

The program SHALL record every package moved to v0.6 with a reason. WHEN a
deferred package's directory changes during v0.5, the bootstrap check SHALL
fail with `deferred_package_changed` unless the register entry is updated in
the same commit.

#### Scenario: Deferred package is edited

- **WHEN** `openspec/changes/graph-store-port/tasks.md` changes
- **AND** the register entry for `graph-store-port` is unchanged
- **THEN** the bootstrap check fails with `deferred_package_changed`

### Requirement: Exact-candidate publication

WHEN every gate and the cold audit pass on one commit, the host SHALL
fast-forward `main` to that commit, create annotated tag `v0.5.0`, and
publish the release from `docs/releases/v0.5.0-notes.md`. IF the remote
`main` differs from the local candidate, THEN publication SHALL stop.

#### Scenario: Candidate publishes

- **WHEN** the release phase reports every predicate passed
- **THEN** tag `v0.5.0` points at the candidate commit
- **AND** the GitHub release body equals the notes file

#### Scenario: Remote diverged

- **WHEN** `origin/main` is not an ancestor of the candidate
- **THEN** publication stops with `remote_diverged`
