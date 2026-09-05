# v0.5 release program specification

## ADDED Requirements

### Requirement: Release baseline

The v0.5 program SHALL use commit
`00c342bd449948ab2ea5ca0b9d0c890614dd81d6` as its immutable baseline.
WHEN the program starts or resumes, the host SHALL verify that the baseline
object exists and has its recorded tree identity.

#### Scenario: Baseline identity matches

- **WHEN** the release program starts or resumes
- **THEN** the host verifies the baseline object and its expected tree

#### Scenario: Baseline object is absent

- **WHEN** the baseline object cannot be resolved in the repository
- **THEN** the program refuses to start with `baseline_missing`

### Requirement: Baseline identity is recorded

WHEN the baseline verification passes, the host SHALL record the baseline
commit and tree identity in SessionDB as one durable fact. IF SessionDB
cannot be opened, THEN the host SHALL run `fm-session repair` before it
retries the record, and SHALL NOT continue without the fact.

#### Scenario: Fact is recorded

- **WHEN** the baseline verification passes
- **THEN** `fm-session recover` lists the baseline fact

#### Scenario: Store needs repair first

- **WHEN** SessionDB refuses to open because of a half-migrated store
- **THEN** the host runs `fm-session repair` and records the fact afterward

### Requirement: Derived data yields to source

IF a derived artifact conflicts with a Git object, an approved OpenSpec
requirement, or a deterministic test result, THEN the host SHALL use the
authoritative source.

#### Scenario: Derived data conflicts with source

- **WHEN** a graph or context artifact conflicts with an authoritative source
- **THEN** the host uses the authoritative source

### Requirement: Conflicting derived data is marked

WHEN the host uses an authoritative source over a conflicting derived
artifact, it SHALL mark that artifact stale.

#### Scenario: Stale mark applied

- **WHEN** a context pack is overridden by source
- **THEN** the pack carries a stale mark

### Requirement: Program-parameterized release runtime

The release runtime SHALL define one closed type
`ReleaseProgram = "v040" | "v050"` and SHALL use it at every program
authority: `packages/orchestration/src/release-policy.ts`,
`packages/orchestration/src/release-coverage-cli.ts` (`PROGRAM` and the
bootstrap owner), `packages/orchestration/src/execution-contract.ts` (the
child brief tranche range), `packages/policy/src/release-admission.ts`,
`packages/policy/src/release-admission-cli.ts`,
`packages/policy/src/release-authority.ts` (`PROGRAM` and the evaluation
child), `packages/policy/src/release-coverage.ts`, and
`packages/orchestration/src/execution-guard-cli.ts` (the family audit and
user receipt validators). IF a release block, evidence bundle, receipt,
family receipt, or CLI argument names any other program, THEN the runtime
SHALL refuse with `wrong_program` or `invalid_family_authority`.

#### Scenario: Unknown program is refused at every boundary

- **WHEN** `v041` is presented as a release block program, an evidence bundle program, a receipt program, or a CLI `--program` value
- **THEN** each boundary refuses with `wrong_program`

#### Scenario: v050 family registers

- **WHEN** `register-family-authority` receives audit and user receipts naming program `v050`
- **THEN** registration succeeds

#### Scenario: Cross-program receipt refused

- **WHEN** a `v050` family registration receives a receipt naming program `v040`
- **THEN** registration fails with `invalid_family_authority`

#### Scenario: v040 behavior is unchanged

- **WHEN** the v0.4 behavioral cases for policy, admission, authority, and coverage run against frozen fixtures
- **THEN** every case passes with the same result as at the baseline

### Requirement: Frozen v040 fixtures

WHEN bootstrap changes the runtime, it SHALL first copy the v0.4 register,
the v0.4 active-inventory snapshot, and `ROADMAP.md` at the baseline into
`packages/policy/src/fixtures/v040/`. The v0.4 behavioral tests SHALL read
those fixtures instead of the live `openspec/changes/v040-release-program`
path. WHEN the fixture-backed tests pass, the v0.4 package MAY move to
`archive/`. WHILE they do not pass, the v0.4 package SHALL stay in place.

#### Scenario: Fixture-backed v040 tests

- **WHEN** `openspec/changes/v040-release-program` is moved to `archive/`
- **THEN** the v0.4 register test still passes from the fixture copy

#### Scenario: v050 repository integration

- **WHEN** the v0.5 register test runs against the live repository
- **THEN** it passes with the current inventory digest and roadmap digest

### Requirement: Per-program release table

WHEN the runtime resolves program `v050`, it SHALL read one table entry that
names the register path, the disposition enum, the bootstrap owner
`v050-release-program`, the child identifier prefix `v050-`, and the
predicate list. WHEN the runtime resolves program `v040`, the table entry
SHALL reproduce the current constants.

#### Scenario: v050 release block is admitted

- **WHEN** `lane-queue.sh add` carries `--release-program v050` and a valid v0.5 register
- **THEN** release policy evaluates the v0.5 register
- **AND** the reservation records program `v050`

### Requirement: Coverage register completeness

The program SHALL keep one register at
`openspec/changes/v050-release-program/coverage.toml` with
`schema_version = 2`. The register SHALL contain one entry for every
directory under `openspec/changes/` outside `archive/` and one entry for
every row of the `ROADMAP.md` assignment table. IF a package or roadmap row
has no entry, THEN the bootstrap check SHALL fail with
`inventory_mismatch` (the checker's existing name for a register that does
not match the active inventory).

#### Scenario: Register is complete

- **WHEN** the bootstrap check runs
- **THEN** every active package and every roadmap row has one entry
- **AND** the recorded inventory digest and roadmap digest match the current files

#### Scenario: A package has no entry

- **WHEN** a new directory appears under `openspec/changes/`
- **THEN** the bootstrap check fails with `inventory_mismatch`

### Requirement: Coverage register dispositions

Each entry SHALL carry one disposition from `v050_owner`,
`v050_dependency`, `released_reference`, `superseded`, or `v060`, one
`reconcile` value from `complete`, `required`, or `not_required`, and one
reason. A package entry with disposition `v050_owner` or `v050_dependency`
SHALL name an owner whose own entry is `v050_owner`. A package entry with
disposition `v060` SHALL name `v050-release-program` as owner. A roadmap
entry SHALL name the owner and release that its `ROADMAP.md` row names.

#### Scenario: Cross-field rule is violated

- **WHEN** a `v050_dependency` package entry names an owner that is itself `v060`
- **THEN** the bootstrap check fails with `register_cross_field`

#### Scenario: Roadmap entry mirrors its row

- **WHEN** a roadmap entry's owner differs from the row's owner column
- **THEN** the bootstrap check fails with `roadmap_mismatch`

### Requirement: Reconciliation gates dispatch

WHILE an owner's entry has `reconcile = "required"`, the lane check SHALL
refuse that owner with `unreconciled` (the checker's existing name). WHEN an owner's
`tasks.md` names a new `.sh`, `.py`, `.ps1`, `.mjs`, or `.cjs` product file
as a creation target, the lane check SHALL refuse with
`iron_rule_violation`.

#### Scenario: Owner still needs reconciliation

- **WHEN** a lane check runs for an owner with `reconcile = "required"`
- **THEN** the check fails with `unreconciled`
- **AND** no lane starts

#### Scenario: Bash-targeted task is dispatched

- **WHEN** a reconciled owner's `tasks.md` names `skills/foreman/scripts/spec-triage.sh` as a file to create
- **THEN** the lane check fails with `iron_rule_violation`

### Requirement: Deferred packages stay frozen

WHEN a directory of a `v060` package changes between the baseline and the
candidate, the bootstrap check SHALL fail with `deferred_package_changed`
unless that package's register entry changed in the same commit.

#### Scenario: Deferred package is edited

- **WHEN** `openspec/changes/graph-store-port/tasks.md` changes
- **AND** the register entry for `graph-store-port` is unchanged
- **THEN** the bootstrap check fails with `deferred_package_changed`

### Requirement: Workflow declaration

Every `v050_owner` package SHALL contain `.openspec.yaml` naming
`foreman-architectural` or `foreman-bounded`. Every `v050_owner` package
with a `tasks.md` SHALL declare an allowed file scope. IF the declaration is
absent, THEN the lane check SHALL refuse with `workflow_mismatch`.

#### Scenario: Missing workflow file

- **WHEN** an owner package has no `.openspec.yaml`
- **THEN** the lane check refuses with `workflow_mismatch`

### Requirement: Bootstrap under the root contract

WHEN the program starts, the bootstrap work (session-store recovery, the
runtime authorities, the register checks, and the fixture freeze) SHALL run
under the root Endstop contract before family activation, as the v0.4
bootstrap exception did. The bootstrap SHALL NOT reserve a family child.

#### Scenario: Bootstrap precedes activation

- **WHEN** `activate-family` runs
- **THEN** the bootstrap integration commit is an ancestor of the activation candidate

### Requirement: Package-level Endstop children

The family SHALL contain exactly twelve children: one per `v050_owner`
package other than the governor, plus one release child bound to
`v050-release-program`. Each child SHALL be bound to exactly one
`packageId`, and no two children SHALL share a `packageId`. Child
identifiers SHALL be immutable and SHALL follow `v050-<package-name>`, with
the release child named `v050-release`. Each child brief SHALL declare its
dependency child identifiers, its allowed paths as exact repository paths
or terminal `/**` prefixes, and its acceptance list.

#### Scenario: Family is activated

- **WHEN** `execution-guard.js activate-family` completes
- **THEN** `family-status` lists twelve children with twelve distinct package identifiers

#### Scenario: Wrong package for a child

- **WHEN** a queue request binds child `v050-lane-runtime-typescript` to owner `build-determinism`
- **THEN** policy refuses with `wrong_package`

#### Scenario: Dependency child incomplete

- **WHEN** a queue request cites a child whose dependency child has no integration milestone
- **THEN** policy refuses with `dependency_milestone_missing`

#### Scenario: Terminal child is retried

- **WHEN** a queue request cites an exhausted child
- **THEN** the queue refuses
- **AND** no vendor process starts

### Requirement: Dependency-bound tranches

The program SHALL order work by dependency depth: tranche 1 is the
bootstrap under the root contract (session-store recovery first), tranche 2
`lane-runtime-typescript`, tranche 3 `launcher-node-port`, tranche 4
`three-outcome-verdicts` then `audit-groundedness-gate` then
`evidence-contracts`, tranche 5 `spec-triage-gate` and `foreman-discover-lane`, tranche 6
`build-determinism` and `wsl-preflight`, tranche 7 `doctrine-reality-drift`
then `workflow-weight-reduction`, tranche 8 the release child. Children
in tranches 4 through 6 MAY run concurrently once tranche 2 has its
integration milestone. Tranche 7 SHALL wait for the `evidence-contracts`
milestone, because doctrine adopts its regression-injection mechanism.

#### Scenario: Concurrent tranches after the runtime lands

- **WHEN** `v050-lane-runtime-typescript` has its integration milestone
- **THEN** `v050-three-outcome-verdicts` and `v050-wsl-preflight` can both reserve actions

### Requirement: Exit predicates

The program SHALL define fifteen exit predicates, P1 through P15. Each
predicate SHALL name one command, its executed-case count where it runs
tests, and one expected observable result. WHEN the release check runs, the
host SHALL measure every predicate on the unchanged candidate commit and
SHALL record each command's output digest and executed-case count. IF a
predicate runs and fails, THEN the release check SHALL record `FAILED` for
it. IF a predicate cannot run, THEN the release check SHALL record
`UNCOMPUTABLE` for it. Either value SHALL refuse publication.

#### Scenario: All predicates pass

- **WHEN** the release check runs on the candidate
- **THEN** fifteen passes are recorded with their output digests and executed-case counts

#### Scenario: A predicate fails

- **WHEN** a predicate command exits non-zero
- **THEN** the release check records `FAILED` for that predicate
- **AND** publication is refused

#### Scenario: A predicate cannot run

- **WHEN** a predicate command is absent on the release host
- **THEN** the release check records `UNCOMPUTABLE` for that predicate
- **AND** publication is refused

### Requirement: Verdict vocabularies are separate

The program SHALL keep three vocabularies distinct. The model-facing audit
verdict SHALL stay `APPROVED | WARNING | BLOCKED`. The harness result SHALL
add `UNVERIFIED`, assigned only by the harness. Evidence and predicate
measurements SHALL use `UNCOMPUTABLE` for a value that cannot be measured.
IF any artifact mixes the vocabularies, THEN the release check SHALL fail
with `vocabulary_mixed`.

#### Scenario: Model selects UNVERIFIED

- **WHEN** an auditor output contains `verdict: UNVERIFIED`
- **THEN** the harness rejects the output as schema-invalid

### Requirement: Pre-publication admission

WHEN every predicate passes and the cold audit is `APPROVED` with no
findings on one commit, the host SHALL record the expected remote
predecessor, enter the publication journal at `prepared`, and push `main`
with a compare-and-set against that predecessor. IF the remote predecessor
differs, THEN the push SHALL NOT happen and the journal SHALL record
`remote_diverged`. The program SHALL reuse the v0.4 publication journal
stages `prepared`, `local_integrated`, `main_published`, `tag_pushed`,
`release_created`, and `verified`, with the v0.4 interruption recovery. The
`image_pushed` stage SHALL be excluded because v0.5 changes no appliance
image. The tag SHALL be annotated. A signature is not required.

#### Scenario: Compare-and-set push succeeds

- **WHEN** `origin/main` equals the recorded predecessor
- **THEN** the push lands and the journal advances to `main_published`

#### Scenario: Remote diverged

- **WHEN** `origin/main` differs from the recorded predecessor
- **THEN** no push happens
- **AND** the journal records `remote_diverged`

### Requirement: Post-publication verification

WHEN the journal reaches `main_published`, the host SHALL create annotated
tag `v0.5.0` on the candidate, publish the GitHub release from
`docs/releases/v0.5.0-notes.md`, and then verify that the tag target equals
the candidate and the release body equals the notes file. IF either check
fails, THEN the journal SHALL record `publication_mismatch`.

#### Scenario: Publication verified

- **WHEN** the post-publication gate runs
- **THEN** `git rev-parse v0.5.0^{commit}` equals the candidate
- **AND** the release body digest equals the notes digest

### Requirement: Explicit deferrals

The program SHALL record every package and roadmap row moved to v0.6 with a
reason, and `ROADMAP.md` SHALL show `v0.6` for each moved row.

#### Scenario: Roadmap and register agree

- **WHEN** the bootstrap check compares `ROADMAP.md` rows with register entries
- **THEN** every row marked `v0.6` has a `v060` entry
