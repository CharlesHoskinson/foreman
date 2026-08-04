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
  explicitly defer with a reason and a later owner.
- `negative_boundary`: capability that the prior release did not ship.
- `destruction_constraint`: material that cannot be removed until its recovery
  or replacement condition passes.

The review result contains these integer fields:

- `baseline_item_count`
- `mapped_item_count`
- `omitted_item_count`
- `contradiction_count`
- `invented_completion_count`
- `unevidenced_defer_count`

The coverage ratio is `mapped_item_count / baseline_item_count`. The ratio is
reported as a fraction and is not rounded. Counts have priority over the
ratio.

Council requests changes when any of these conditions is true:

- `omitted_item_count` is not zero.
- `contradiction_count` is not zero.
- `invented_completion_count` is not zero.
- `unevidenced_defer_count` is not zero.
- The candidate or ledger digest does not match the reviewed bundle.

Council can abstain only when the supplied evidence cannot classify an item.
A missing provider result, an invalid response, or an unavailable tool is an
infrastructure failure. It is not an abstention. Actionable dissent requires a
new candidate and a new review round. A majority cannot override dissent.

## Program structure

The program has four dependency bands:

```text
authority and immutable baseline
          |
Node workspace, core, policy, runtime-state boundary
          |
product ports and Council runtime slices
          |
cleanup, knowledge convergence, dogfood, release
```

Focused packages keep their detailed acceptance tests. This release package
owns cross-package order, scope coverage, exact-candidate convergence, and the
final destruction record.

## State and cleanup

Runtime state moves outside target worktrees. Project identity, run identity,
attempt identity, and credential-profile identity are explicit. A target
worktree contains product changes only.

The destruction log records the path or ref, reason, recovery method, owner,
precondition, evidence digest, disposition, and timestamp. The team deletes no
material item when recovery ownership is unknown.

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
