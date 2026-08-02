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

Foreman SHALL maintain `evidence/package-matrix.tsv` for every OpenSpec package
named by the frozen v0.2.9.0 release manifest.
The manifest SHALL reconcile active packages, archived shipped packages, and
preserved deferred or residual destinations.

A `v029-implemented` row SHALL name the owner requirement, consuming code, verification command, and result artifact.
A `v030-deferred`, `parked`, `withdrawn`, or `split` row SHALL name a destination package or preservation file.
Foreman SHALL reject missing, duplicate, or unknown package rows.
Foreman SHALL reject a package that appears as both active and archived.
Foreman SHALL reject a shipped package that is absent from the frozen manifest.

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

#### Scenario: archive movement cannot erase release scope

- WHEN a shipped package moves from the active directory to the archive
- THEN its frozen manifest identity remains unchanged
- AND the matrix resolves the archived package
- AND its deferred or residual destinations remain present.

### Requirement: every shipped package has immutable audit evidence

Foreman SHALL preserve each source auditor verdict as byte-identical evidence.
Foreman SHALL build one versioned package audit for every shipped package.
The package audit SHALL bind to the matrix row, candidate base and head, tree,
diff content, complete audited scope, verification records, worker model
family, auditor model family, source verdict path, and source verdict digest.

The worker and auditor model families SHALL differ.
An aggregate index SHALL NOT rewrite or replace a source verdict.
Missing, stale, malformed, same-family, blocked, unverified, or unresolved
audit evidence SHALL fail release convergence.

#### Scenario: aggregation cannot erase dissent

- WHEN a source verdict contains a release-grade finding
- AND no descendant correction and fresh verification resolve that finding
- THEN the package audit remains unresolved
- AND the aggregate index fails.

### Requirement: positive controls bind to the frozen gate set

Foreman SHALL finalize the release gate inventory, matrix predicate, archive
predicate, and package-audit-index predicate before positive-control capture.
Each `kind: gate` control record SHALL bind to the demonstrated source commit,
the predicate digest, and the known-bad and known-good input digests.
The evidence commit SHALL descend from the demonstrated source commit.
The current candidate SHALL contain the same predicate and input bytes.
The control SHALL show the same real predicate rejecting the known-bad arm and
accepting the known-good arm.

#### Scenario: a later gate edit invalidates control evidence

- WHEN a release gate predicate changes after control capture
- THEN the prior control record is stale
- AND Foreman recaptures the affected control before release.

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

Foreman SHALL run `tools/ci-local.sh` at the final candidate commit.
Foreman SHALL run `merge-gate.sh check` with the recorded release run, lane,
and branch identities.
Foreman SHALL refresh quoted measurements at that commit.
Foreman SHALL record all residuals and deferred scope before the tag.
Foreman SHALL require the final typed Council outcome `approved`.
The outcomes `insufficient_evidence`, `judge_unstable`, and `outcome_unknown`
SHALL fail closed.

#### Scenario: one final gate fails

- WHEN any final gate returns nonzero
- THEN Foreman does not create the release tag
- AND the failure enters a new Grok and Council rework loop.
