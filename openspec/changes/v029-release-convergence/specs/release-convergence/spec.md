# Spec delta: v0.2.9.0 release convergence

## ADDED Requirements

### Requirement: release scope follows the canonical decision record

Foreman SHALL use SessionDB decisions as the release-scope authority.

Foreman SHALL move `graph-context-builder`, `graph-dogfood`, `graph-eval-falsification`, and `work-dag-projection` to v0.3.0.
Foreman SHALL preserve their specifications, kill criteria, and off-switch contract.
v0.2.9.0 SHALL NOT enable a default graph-context path.

#### Scenario: stale checklist scope cannot restore deferred work

- WHEN `checklist.md` includes a deferred graph requirement
- THEN the release process rejects that checklist claim
- AND the process uses the SessionDB decision
- AND the graph package remains available for v0.3.0 work.

### Requirement: every package disposition has executable evidence

Foreman SHALL maintain `evidence/package-matrix.tsv` for every active OpenSpec package.

A `v029-implemented` row SHALL name the owner requirement, consuming code, verification command, and result artifact.
A `v030-deferred`, `parked`, `withdrawn`, or `split` row SHALL name a destination package or preservation file.
Foreman SHALL reject missing, duplicate, or unknown package rows.

#### Scenario: an unticked task does not prove missing implementation

- WHEN an OpenSpec task is unticked
- AND consuming code and a fail-capable test prove delivery
- THEN the architect classifies the task as record debt
- AND the architect updates the task record with the evidence.

#### Scenario: an existing file does not prove implementation

- WHEN a named deliverable file exists
- AND no consuming path or fail-capable test proves its behavior
- THEN the package remains `v029-gap`
- AND Grok receives a bounded implementation specification.

### Requirement: Grok implementation uses Foreman ownership

Foreman SHALL dispatch Grok from an isolated worktree with a five-part specification file.

Grok SHALL write a failing test before implementation.
The architect SHALL verify the diff independently.
The architect SHALL commit only verified changes.

#### Scenario: worker narration conflicts with the worktree

- WHEN Grok reports success
- AND the worktree or focused tests do not prove the requested behavior
- THEN Foreman rejects the round
- AND Foreman dispatches a corrected specification.

### Requirement: Council review remains advisory and dissent-bound

Foreman SHALL build Council bundles from committed base and head commits.
The base and head commits SHALL differ.
Each admissible verdict SHALL bind to the exact diff content hash.

Council SHALL require three admissible verdicts from at least two model-family domains.
One admissible `changes_requested` verdict SHALL force a new implementation round.
Council SHALL NOT write release or merge gate artifacts.

#### Scenario: majority approval cannot override dissent

- WHEN two reviewers approve
- AND one admissible reviewer requests changes
- THEN the architect fixes the finding
- AND Foreman builds a new immutable bundle
- AND the prior majority does not authorize merge.

### Requirement: AFK execution records hourly checkpoints

The AFK loop SHALL write a SessionDB checkpoint at least once per hour.
The checkpoint SHALL record commit identities and state hashes.
The checkpoint SHALL NOT record process liveness as a fact.

#### Scenario: the session stops between work packages

- WHEN the host restarts after an hourly checkpoint
- THEN recovery identifies the last recorded commits and state hashes
- AND the architect resumes from Git and SessionDB without trusting `/tmp` artifacts.

### Requirement: the release tag fails closed

Foreman SHALL refuse tag `v0.2.9` while any release condition remains unproved.

Foreman SHALL run the full local release gate at the final candidate commit.
Foreman SHALL refresh quoted measurements at that commit.
Foreman SHALL record all residuals and deferred scope before the tag.

#### Scenario: one final gate fails

- WHEN any final gate returns nonzero
- THEN Foreman does not create the release tag
- AND the failure enters a new Grok and Council rework loop.

