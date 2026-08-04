# Spec delta: v0.3.0 release program

## ADDED Requirements

### Requirement: the program uses one complete baseline

WHEN the architect creates or revises a v0.3.0 specification, Foreman SHALL
compare it with the canonical accomplishment ledger and the program coverage
matrix.

The coverage matrix SHALL contain 7 `RT-*` rows and 32 `CW-*` rows. The
baseline count SHALL be 39.

#### Scenario: a prior release fact changes in a proposed spec

- WHEN a candidate says that v0.2.9.0 shipped Gemini dispatch
- AND the canonical ledger records Gemini dispatch as unfinished
- THEN `SpecCorrectnessV1` reports one contradiction
- AND Council requests changes.

#### Scenario: a residual is not assigned

- WHEN a carried-work item has no sprint mapping and no evidenced defer record
- THEN `SpecCorrectnessV1` reports one omitted item
- AND Council requests changes.

### Requirement: SpecCorrectnessV1 uses a deterministic item-result algorithm

WHEN Council reviews a release specification, the reviewer SHALL emit exactly
one item result for every sorted baseline ID.

The closed item-result disposition set SHALL be `mapped`, `omitted`,
`contradiction`, and `unevidenced_defer`.

Duplicate, unknown, or missing IDs SHALL make the response invalid.

The four disposition counts SHALL be computed from those mutually exclusive
item results. Their sum SHALL equal 39. `mapped_item_count` SHALL count only
`mapped`. The other three item counts SHALL count their matching dispositions.

Invented completions SHALL be a separate sorted set of canonical claim SHA-256
digests. `invented_completion_count` SHALL equal the set size. Duplicate claim
digests SHALL make the response invalid.

Canonical encoding SHALL be UTF-8 JSON with recursively sorted object keys,
baseline item results sorted by item ID, claim digests sorted by byte order,
no insignificant whitespace, and one trailing LF. Counts SHALL be derived from
arrays and SHALL NOT be accepted as independent model claims.

The outcome SHALL be `accept` only when all 39 items are `mapped`, every defect
count is zero, every bound identity matches, and the response is valid.
Otherwise the outcome SHALL be `changes_requested`, except that a reviewer can
use `abstain` only for a named evidence gap under the existing Council rules.

#### Scenario: a reviewer omits one baseline ID

- WHEN the response lacks one baseline item result
- THEN the response is invalid
- AND Council requests changes.

#### Scenario: all baseline items are mapped with zero defects

- WHEN all 39 item results are `mapped`
- AND every defect count is zero
- AND every bound identity matches
- AND the response is valid
- THEN the outcome is `accept`.

### Requirement: the correctness result is typed and bundle-bound

WHEN Council reviews a release specification, Foreman SHALL bind the
`SpecCorrectnessV1` result to the candidate commit, candidate tree, base
commit, diff digest, ledger digest, coverage-matrix digest, spec-set digest,
reviewer identity, provider-family identity, provider receipt, ready token,
contract hash, prompt hash, and response-schema variant hash.

#### Scenario: the candidate changes after review

- WHEN a file in the reviewed spec set changes after Council creates a result
- THEN the stored spec-set digest does not match
- AND Foreman excludes the result from admission
- AND the candidate receives `changes_requested`.

#### Scenario: any bound identity is missing or mismatched

- WHEN any bound identity is missing or mismatched
- THEN the identity mismatch is not an abstention
- AND Foreman excludes the result from admission
- AND the candidate receives `changes_requested`.

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

The destruction log SHALL record owner, evidence or digest, and recorded-at
fields for every row. A proposed action with incomplete evidence SHALL say
`pending` and SHALL remain unauthorized.

#### Scenario: recovery ownership is unknown

- WHEN a worktree contains untracked material and has no recovery owner
- THEN Foreman records a blocked disposition
- AND Foreman does not remove the worktree.

#### Scenario: DST-0039 remains blocked

- WHEN the register records worktree head
  `04f369541febf648ef39dcb8fedd930e8b600d3f`
- AND untracked `SPEC.md` SHA-256
  `3c8abfe4e70751b5f08e1cb51bcbea3c776ccb5470a80e0d527c34fb20d8b9dd`
- THEN the state is `blocked`
- AND no removal is authorized.

### Requirement: sprint order follows dependencies

WHEN the program starts a sprint, Foreman SHALL verify that every required
earlier sprint has an immutable accepted commit and no unresolved actionable
dissent.

The program SHALL use this sprint order:

0. authority, baseline, reconciliation, and destruction inventory
1. Node workspace, core, and policy
2. typed event-log foundation
3. queue, attempt identity, report freshness, resume, external runtime state,
   credentials, and fixture-aware scans
4. GraphStore
5. launcher
6. SessionDB and project registry
7. current-main session transport
8. minimal Council advisory plane
9. durable Council runtime and security
10. Gemini, aggregate readiness, and full deliberation
11. Council MCP, host plugins, and package-publication decision
12. release evidence
13. knowledge and Graphify convergence
14. orchestration
15. zero-Python and residual cleanup
16. external dogfood and Windows boundary
17. exact-candidate convergence

Sprint 3 SHALL depend on the accepted Sprint 2 event-log commit.

#### Scenario: queue work starts before the event foundation

- WHEN a Sprint 3 queue task depends on an unfinished Sprint 2 event-log
  contract
- THEN Foreman refuses that task admission
- AND reports the missing predecessor.

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
