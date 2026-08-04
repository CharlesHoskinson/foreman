# Design: v0.3.0 release program

## Sources of truth

The program uses these sources in descending authority order:

1. Immutable release tags and their tracked evidence.
2. `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`.
3. Current source and tests at the reviewed program baseline.
4. Strict OpenSpec packages and reconciled task ledgers.
5. The current Graphify generation and its retained warnings.
6. Historical notes and branches as discovery inputs only.

The canonical accomplishment ledger records both shipped capability and
explicit release limits. The Council review bundle includes the ledger bytes,
its SHA-256 digest, this package, the focused spec set, and the candidate Git
identity.

## SpecCorrectnessV1

`SpecCorrectnessV1` measures whether a candidate specification represents the
recorded project state without loss or invention. Each baseline item has a
stable ID in `coverage-matrix.md` and one of these classes:

- `released_truth`: a shipped fact that the candidate must not contradict.
- `carried_work`: unfinished work that the candidate must map to a sprint or
  record as `evidenced_defer` with reason, owner, target release, blocking
  dependency, and acceptance evidence.
- `negative_boundary`: capability that the prior release did not ship.
- `destruction_constraint`: material that cannot be removed until its recovery
  or replacement condition passes.

The baseline contains 7 `RT-*` rows and 37 `CW-*` rows. The baseline count is
44.

### Closed item-result dispositions

A reviewer emits exactly one item result for every baseline ID. Sort item
results by UTF-8 byte order of item ID. The exact canonical sequence is
`CW-001` through `CW-037`, then `RT-001` through `RT-007`.

The closed disposition set is:

- `mapped`
- `evidenced_defer`
- `omitted`
- `contradiction`
- `unevidenced_defer`

Duplicate, unknown, or missing IDs make the response invalid. The five
disposition counts are host-derived from those mutually exclusive item
results. Their sum equals 44.

- `mapped_item_count` counts only `mapped`.
- `evidenced_defer_count` counts only `evidenced_defer`.
- `omitted_item_count` counts only `omitted`.
- `contradiction_count` counts only `contradiction`.
- `unevidenced_defer_count` counts only `unevidenced_defer`.

An `evidenced_defer` disposition names nonblank reason, owner, target release,
blocking dependency, and acceptance evidence. An `evidenced_defer` is not a
defect. An `unevidenced_defer` is a defect.

Every `mapped` result contains nonblank sprint, requirement, acceptance
evidence, and status.

### InventedCompletionV1

Invented completions are a separate sorted set of `InventedCompletionV1`
records. `invented_completion_count` equals the set size.

An `InventedCompletionV1` record is an actionable source-located record. After
a reviewer detects an invented completion, the host selects a whole-line byte
range that contains the claim. The range starts at byte zero or immediately
after LF. The range ends at EOF or includes a terminating LF. The range is
nonempty valid UTF-8. The host verifies artifact, range, exact-slice, and
record digests against immutable artifact bytes.

The record fields are:

- artifact alias
- artifact SHA-256
- zero-based start byte
- exclusive end byte
- exact-slice SHA-256
- short summary
- corrective action

Sort invention records by digest byte order. The record digest is SHA-256 over
artifact digest, NUL, decimal start, NUL, decimal end, NUL, and the exact
source bytes. Do not use free-form claim IDs. Duplicate invention-record
digests make the response invalid.

### Canonical encoding and derived counts

Canonical encoding is recursively key-sorted UTF-8 JSON with no insignificant
whitespace and one trailing LF. Baseline item results are sorted by item ID.
Invention records are sorted by digest byte order. Counts are derived from
arrays. Counts are not accepted as independent model claims.

The coverage ratio is
`(mapped_item_count + evidenced_defer_count) / baseline_item_count`. The ratio
is reported as a fraction and is not rounded. Counts have priority over the
ratio.

### Outcome rule

The outcome is `accept` only when `mapped + evidenced_defer = 44`, every
defect count is zero, invented completions are zero, every bound identity
matches, and the response is valid. Defect counts are `omitted_item_count`,
`contradiction_count`, and `unevidenced_defer_count`. Otherwise the outcome is
`changes_requested`, except that a reviewer can use `abstain` only for a named
evidence gap under the existing Council rules.

Council requests changes when any of these conditions is true:

- `omitted_item_count` is not zero.
- `contradiction_count` is not zero.
- `invented_completion_count` is not zero.
- `unevidenced_defer_count` is not zero.
- `mapped + evidenced_defer` is not 44.
- Any bound identity is missing or mismatched.
- The response is invalid.

### Complete bundle-identity failure rule

Council requires `changes_requested` when any bound identity is missing or
mismatched. Bound identities include candidate commit, candidate tree, base
commit, diff digest, ledger digest, coverage-matrix digest, spec-set digest,
reviewer identity, provider-family identity, provider receipt, ready token,
contract hash, prompt hash, and response-schema variant hash.

An identity mismatch is not an abstention. The result is excluded from
admission and the candidate receives `changes_requested`.

A missing provider result, an invalid response, or an unavailable tool is an
infrastructure failure. It is not an abstention. Actionable dissent requires a
new candidate and a new review round. A majority cannot override dissent.

## Program structure

The program has four dependency bands:

```text
authority and immutable baseline
          |
Node workspace, core, policy, and event-log foundation
          |
product ports and Council runtime slices
          |
cleanup, knowledge convergence, dogfood, Windows boundary, release
```

Sprint order is dependency-correct:

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

Sprint 3 depends on the accepted Sprint 2 event-log commit.

Focused packages keep their detailed acceptance tests. This release package
owns cross-package order, scope coverage, exact-candidate convergence, and the
final destruction record. `openspec/changes/node-typescript-runtime/` retains
detailed module contracts and package-level acceptance tests. It does not
define release order.

## Package inventory and ownership

The TypeScript migration uses nine package families:

1. `@foreman/core`
2. `@foreman/policy`
3. `@foreman/event-log`
4. `@foreman/session`
5. `@foreman/graph-store`
6. `@foreman/launcher`
7. `@foreman/release`
8. `@foreman/knowledge`
9. `@foreman/orchestration`

`@foreman/policy` is its own package family. It is not a side module of
`@foreman/core`.

`graph-project` is owned by `@foreman/knowledge`. It consumes typed
`@foreman/event-log` inputs. It does not become the event-log system of
record. `@foreman/event-log` remains the system of record for run events.

These ownership decisions supply the CW-023 and CW-024 mappings for Council
review. Sprint 0 tasks 0.7 and 0.8 remain open until the reviewed candidate is
published and verified.

## State and cleanup

Runtime state moves outside target worktrees. Project identity, run identity,
attempt identity, and credential-profile identity are explicit. A target
worktree contains product changes only.

The destruction log records the path or ref, reason, recovery method, owner,
precondition, evidence digest, disposition, and timestamp. The team deletes no
material item when recovery ownership is unknown. A proposed action with
incomplete evidence says `pending` and remains unauthorized.

Historical process incidents remain in history. They do not authorize current
actions and do not satisfy the pre-registration rule.

## Review boundaries

Council reviews these immutable boundaries:

1. Program baseline and coverage matrix.
2. Each sprint candidate after deterministic acceptance passes.
3. The complete exact-candidate release bundle.

Foreman assigns implementation to Grok in isolated worktrees. Codex performs a
cold, different-family audit of each complete diff. The architect reruns all
deterministic checks and owns commits, merges, and publication.

## Release rule

One unchanged pushed commit must pass clean install, type checks, tests,
deterministic builds, runtime-manifest checks, compatibility checks, strict
OpenSpec, documentation checks, Graphify checks, hosted Linux and Windows
gates, cold audit, Council review, and release-record verification. No later
edit can reuse an earlier result.
