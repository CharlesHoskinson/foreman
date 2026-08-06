# Spec delta: v0.3.0 release program

## ADDED Requirements

### Requirement: the program uses one complete baseline

WHEN the architect creates or revises a v0.3.0 specification, Foreman SHALL
compare it with the canonical accomplishment ledger and the program coverage
matrix.

The coverage matrix SHALL contain 7 `RT-*` rows and 37 `CW-*` rows. The
baseline count SHALL be 44.

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
one item result for every baseline ID.

Item results SHALL be sorted by UTF-8 byte order of item ID. The exact
canonical sequence SHALL be `CW-001` through `CW-037`, then `RT-001` through
`RT-007`.

The closed item-result disposition set SHALL be `mapped`, `evidenced_defer`,
`omitted`, `contradiction`, and `unevidenced_defer`.

Duplicate, unknown, or missing IDs SHALL make the response invalid.

The five disposition counts SHALL be host-derived from those mutually exclusive
item results. Their sum SHALL equal 44. `mapped_item_count` SHALL count only
`mapped`. `evidenced_defer_count` SHALL count only `evidenced_defer`.
`omitted_item_count` SHALL count only `omitted`. `contradiction_count` SHALL
count only `contradiction`. `unevidenced_defer_count` SHALL count only
`unevidenced_defer`.

An `evidenced_defer` disposition SHALL name nonblank reason, owner, target
release, blocking dependency, and acceptance evidence. An `evidenced_defer`
SHALL NOT be a defect. An `unevidenced_defer` SHALL be a defect.

Every `mapped` result SHALL contain nonblank sprint, requirement, acceptance
evidence, and status.

Invented completions SHALL be a separate sorted set of `InventedCompletionV1`
records. `invented_completion_count` SHALL equal the set size. Duplicate
invention-record digests SHALL make the response invalid.

An `InventedCompletionV1` record SHALL be an actionable source-located record.
After a reviewer detects an invented completion, the host SHALL select a
whole-line byte range that contains the claim. The range SHALL start at byte
zero or immediately after LF. The range SHALL end at EOF or include a
terminating LF. The range SHALL be nonempty valid UTF-8. The host SHALL
verify artifact, range, exact-slice, and record digests against immutable
artifact bytes. The record SHALL include artifact alias, artifact SHA-256,
zero-based start byte, exclusive end byte, exact-slice SHA-256, short
summary, and corrective action. Invention records SHALL be sorted by digest
byte order. The record digest SHALL be SHA-256 over artifact digest, NUL,
decimal start, NUL, decimal end, NUL, and the exact source bytes. The host
SHALL NOT use free-form claim IDs.

Canonical encoding SHALL be UTF-8 JSON with recursively sorted object keys, no
insignificant whitespace, and one trailing LF. Counts SHALL be derived from
arrays and SHALL NOT be accepted as independent model claims.

The outcome SHALL be `accept` only when `mapped + evidenced_defer = 44`, every
defect count is zero, invented completions are zero, every bound identity
matches, and the response is valid. Defect counts SHALL be
`omitted_item_count`, `contradiction_count`, and `unevidenced_defer_count`.
Otherwise the outcome SHALL be `changes_requested`, except that a reviewer can
use `abstain` only for a named evidence gap under the existing Council rules.

#### Scenario: a reviewer omits one baseline ID

- WHEN the response lacks one baseline item result
- THEN the response is invalid
- AND Council requests changes.

#### Scenario: all baseline items are mapped or evidenced-deferred with zero defects

- WHEN the sum of `mapped` and `evidenced_defer` item results is 44
- AND every defect count is zero
- AND invented completions are zero
- AND every bound identity matches
- AND the response is valid
- THEN the outcome is `accept`.

#### Scenario: an evidenced defer is not a defect

- WHEN one baseline item result is `evidenced_defer`
- AND that result names reason, owner, target release, blocking dependency,
  and acceptance evidence
- AND the remaining items are `mapped`
- AND every defect count is zero
- AND invented completions are zero
- AND every bound identity matches
- AND the response is valid
- THEN the outcome is `accept`.

#### Scenario: an unevidenced defer is a defect

- WHEN one baseline item result is `unevidenced_defer`
- THEN `SpecCorrectnessV1` reports one unevidenced defer
- AND Council requests changes.

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

### Requirement: specification correctness has a separate admission command

WHEN Foreman admits a `SpecCorrectnessV1` result, Foreman SHALL use the
Node.js 24 TypeScript command `council-spec-correctness`.

The command SHALL keep filesystem paths outside the application input. The
application SHALL use Effect and typed ports to read artifacts and to compute
SHA-256 and fatal UTF-8 results. The command SHALL NOT change the existing
`council-preflight` command or its bundle.

The admission identity SHALL contain these exact fields:
`candidateCommitSha`, `candidateTreeSha`, `baseCommitSha`, `diffSha256`,
`ledgerSha256`, `coverageMatrixSha256`, `specSetSha256`, `reviewerId`,
`providerFamily`, `providerReceiptHash`, `readyTokenHash`, `contractHash`,
`promptHash`, and `responseSchemaVariantHash`.

The host SHALL compare the expected, observed, and provider-submitted identity
records field for field. The host SHALL also bind the candidate commit, base
commit, diff digest, reviewer, ready token, contract, and prompt to the
existing review-attempt identity.

The host SHALL read each artifact once with a 1,048,576-byte per-artifact
limit, a 16,777,216-byte total limit, and a 128-artifact count limit. The host
SHALL verify every descriptor digest and byte length. Artifact IDs and aliases
SHALL be unique. The coverage-matrix, ledger, and specification-set roles SHALL
name the complete descriptor set.

The specification-set digest SHALL use descriptor records sorted by artifact
alias in UTF-8 byte order. Each record SHALL contain `alias`, `artifactId`,
`sha256`, and `byteLength`. The host SHALL hash recursively key-sorted compact
UTF-8 JSON with exactly one trailing LF.

The command SHALL emit recursively key-sorted compact JSON with exactly one
trailing LF. It SHALL return exit code 0 only for a valid `accept` result that
matches approved final advice. It SHALL return exit code 1 for changes,
abstention, invalid output, identity mismatch, or typed infrastructure
failure. It SHALL return exit code 64 for invalid command-line usage.

#### Scenario: approved advice disagrees with the correctness result

- WHEN `SpecCorrectnessV1` returns `changes_requested`
- AND the final review advice says `approved`
- THEN Foreman rejects the result from admission
- AND the candidate receives `changes_requested`.

#### Scenario: an artifact changes after identity observation

- WHEN the recomputed artifact digest or byte length differs from its
  descriptor
- THEN Foreman records an infrastructure failure
- AND the candidate receives `changes_requested`
- AND the result is not an abstention.

#### Scenario: a named abstention is valid

- WHEN `SpecCorrectnessV1` returns a valid named abstention
- AND the final review classification is a completed abstention
- THEN Foreman preserves the abstention
- AND the abstention does not count toward quorum
- AND the command returns exit code 1.

#### Scenario: output contains operational secrets

- WHEN a result would contain a filesystem path, raw provider output, raw
  process error, environment value, or secret text
- THEN the result schema rejects that output
- AND the command emits only a typed secret-safe failure.

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

### Requirement: the migration package inventory includes policy

WHEN the program records the TypeScript package inventory, Foreman SHALL list
nine package families and SHALL include `@foreman/policy` as its own package
family.

The program SHALL use the Sprint 0-through-17 order in this package for
cross-package work. `openspec/changes/node-typescript-runtime/` SHALL retain
detailed module contracts. The program SHALL NOT keep a contradictory
0-through-9 migration-only sprint table as current authority.

#### Scenario: policy is not a separate package family

- WHEN a candidate lists eight package families and omits `@foreman/policy`
- THEN `SpecCorrectnessV1` reports a contradiction for CW-023
- AND Council requests changes.

#### Scenario: a stale migration sprint table remains current

- WHEN a candidate keeps a 0-through-9 migration sprint table as current
  authority
- AND that table contradicts the Sprint 0-through-17 release-program order
- THEN `SpecCorrectnessV1` reports a contradiction for CW-023
- AND Council requests changes.

### Requirement: graph-project belongs to knowledge

WHEN the program maps work-DAG projection ownership, Foreman SHALL assign
`graph-project` to `@foreman/knowledge`.

`graph-project` SHALL consume typed `@foreman/event-log` inputs. It SHALL NOT
become the event-log system of record. `@foreman/event-log` SHALL remain the
event-log system of record.

#### Scenario: graph-project has no package owner

- WHEN a candidate omits package ownership for `graph-project`
- THEN `SpecCorrectnessV1` reports an omitted item for CW-024
- AND Council requests changes.

#### Scenario: graph-project becomes the event-log system of record

- WHEN a candidate assigns event-log system-of-record duty to `graph-project`
- THEN `SpecCorrectnessV1` reports a contradiction for CW-024
- AND Council requests changes.

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

Historical process incidents SHALL remain in history. They SHALL NOT authorize
current actions and SHALL NOT satisfy the pre-registration rule.

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

#### Scenario: a historical late-registration incident does not authorize action

- WHEN the historical process incident for `DST-0052` remains in history
- THEN that incident does not satisfy the pre-registration rule
- AND that incident does not authorize any current removal
- AND the current register is accepted only when no current action is
  authorized by that incident.

#### Scenario: DST-0059 remains unauthorized until the guard ships

- WHEN the current register records `DST-0059` with state `unauthorized`
- AND evidence and recorded-at remain pending
- THEN no later tracked authority, worktree, branch, or artifact removal is
  authorized by that row.

#### Scenario: the first guard use denies DST-0060

- WHEN the compiled Node.js 24 destruction guard reads the exact current
  `DST-0060` intent from the canonical register
- AND the entry state remains `blocked`
- THEN the guard returns `Denied`
- AND the source and recovery target remain unchanged
- AND this denial proves the operational guard path without authorizing the
  relocation.

#### Scenario: an executor does not exist for the requested action

- WHEN a register entry requests worktree removal, branch deletion,
  or artifact deletion
- AND no typed executor exists for that exact action kind
- THEN the guard denies the action even if the entry says `approved`
- AND no legacy shell command receives authority from the entry.

### Requirement: tracked_delete executor is fail-closed and exact

WHEN the compiled destruction guard executes `delete-tracked`, Foreman SHALL
authorize only one committed register entry whose action kind is
`tracked_delete`, bind a non-empty ordered list of exact repository-relative
targets (path, Git blob SHA-1, byte length, mode `100644` or `100755`), and
require the same single-row approval-delta, parent candidate commit/tree,
chronology, recovery readiness, and clean HEAD rules as `artifact_relocate`.

Before any mutation the executor SHALL verify every target as one complete
batch and SHALL refuse duplicates, globs, groups, absolute paths, empty or
dot segments, traversal, `.git` paths, the canonical destruction-register
path, directories, symlinks, hard links, submodules, untracked or missing
paths, wrong mode, wrong blob, wrong byte length, and changed working-tree
content. Mutation SHALL be all-or-rollback: capture verified bytes and modes,
delete only after the batch passes, restore every removed file with its mode
after an injected or host failure, and leave parent directories in place.
Success SHALL emit a closed receipt with register digest, recovery commit,
and ordered target identities and SHALL NOT emit absolute paths, raw errors,
environment values, or file contents. Stdin remains `{schemaVersion:1,entryId}`.

#### Scenario: exact approved tracked files are deleted

- WHEN one unexpired `approved` `tracked_delete` entry binds exact tracked
  regular-file identities and the live batch preflight passes
- THEN the Effect executor deletes only those files
- AND parent directories remain
- AND the command emits one canonical `Completed` receipt without absolute
  paths or file contents.

#### Scenario: mid-batch failure restores every removed file

- WHEN an injected or host error occurs after at least one approved file is
  removed and before the batch completes
- THEN every removed file is restored with its captured mode and bytes
- AND the command returns a closed failure result.

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
10. Gemini, aggregate readiness, full deliberation, supervised research
    gateway, and evidence provenance
11. Council MCP, host plugins, and package-publication decision
12. release evidence and formal-model plane reconciliation
13. knowledge and Graphify convergence
14. orchestration
15. zero-Python, Superpowers, and residual cleanup
16. external dogfood, Windows boundary, ready-token multi-domain Council
    closure, and Council evaluation program
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
