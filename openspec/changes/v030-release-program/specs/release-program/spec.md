# Spec delta: v0.3.0 release program

## ADDED Requirements

### Requirement: the program uses one complete baseline

WHEN the architect creates or revises a v0.3.0 specification, Foreman SHALL
compare it with the canonical accomplishment ledger and the program coverage
matrix.

#### Scenario: a prior release fact changes in a proposed spec

- WHEN a candidate says that v0.2.9.0 shipped Gemini dispatch
- AND the canonical ledger records Gemini dispatch as unfinished
- THEN `SpecCorrectnessV1` reports one contradiction
- AND Council requests changes.

#### Scenario: a residual is not assigned

- WHEN a carried-work item has no sprint mapping and no evidenced defer record
- THEN `SpecCorrectnessV1` reports one omitted item
- AND Council requests changes.

### Requirement: the correctness result is typed and bundle-bound

WHEN Council reviews a release specification, Foreman SHALL bind the
`SpecCorrectnessV1` result to the candidate commit, candidate tree, ledger
digest, coverage-matrix digest, spec-set digest, reviewer identity, provider
receipt, and ready token.

#### Scenario: the candidate changes after review

- WHEN a file in the reviewed spec set changes after Council creates a result
- THEN the stored spec-set digest does not match
- AND Foreman excludes the result from admission.

#### Scenario: a provider does not return a usable result

- WHEN a provider is unavailable or returns an invalid result
- THEN Foreman records an infrastructure failure
- AND Foreman does not record an abstention for that provider.

### Requirement: actionable dissent cannot be overridden

WHEN one admissible reviewer reports a contradiction, invention, omission, or
unevidenced defer, Council SHALL return `changes_requested` for the candidate.

#### Scenario: two reviewers accept and one reviewer finds an omission

- WHEN two admissible reviewers accept a candidate
- AND one admissible reviewer identifies one omitted baseline item
- THEN Council returns `changes_requested`
- AND the architect creates a new candidate before another review.

### Requirement: all new implementation uses Node.js TypeScript

WHEN a v0.3.0 sprint adds executable source or tests, Foreman SHALL accept only
strict TypeScript that targets Node.js 24.

#### Scenario: a sprint proposes a new shell implementation

- WHEN a candidate adds product logic to a shell file
- THEN the architecture gate fails
- AND the sprint cannot close.

### Requirement: Effect owns fallible runtime behavior

WHEN a TypeScript module owns resources, cancellation, retries, timeouts, or
concurrent work, Foreman SHALL implement that ownership with Effect and typed
failures.

#### Scenario: an interrupted process owns temporary state

- WHEN interruption occurs during a bounded process
- THEN the Effect scope closes the process and its owned temporary state
- AND the caller receives a typed interruption result.

### Requirement: cleanup is logged before destruction

WHEN the program proposes deletion of a tracked file, branch, worktree,
artifact, or stale authority record, Foreman SHALL add a destruction-log entry
before the destructive action.

#### Scenario: recovery ownership is unknown

- WHEN a worktree contains untracked material and has no recovery owner
- THEN Foreman records a blocked disposition
- AND Foreman does not remove the worktree.

### Requirement: sprint order follows dependencies

WHEN the program starts a sprint, Foreman SHALL verify that every required
earlier sprint has an immutable accepted commit and no unresolved actionable
dissent.

#### Scenario: Council runtime starts before the event foundation

- WHEN a Council persistence task depends on an unfinished event-log contract
- THEN Foreman refuses that task admission
- AND reports the missing predecessor.

### Requirement: release evidence uses one exact candidate

WHEN v0.3.0 enters release convergence, Foreman SHALL bind every gate and
review result to one unchanged pushed commit and tree.

#### Scenario: documentation changes after hosted gates

- WHEN a tracked documentation file changes after the hosted gates complete
- THEN the exact-candidate identity changes
- AND Foreman reruns the affected gates and reviews.
