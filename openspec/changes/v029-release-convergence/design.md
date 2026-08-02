# Design: v0.2.9.0 release convergence

## Architecture

Use an evidence-first convergence loop.

Foreman owns execution, worktrees, verification, gates, and merge decisions.
Grok implements one bounded task per round.
Council reviews immutable committed bundles and preserves dissent.

The architect owns package classification and finding resolution.

## Package matrix

Store the matrix at `evidence/package-matrix.tsv`.

Use these columns:

1. `package`
2. `disposition`
3. `owner_requirement`
4. `consumer`
5. `verification`
6. `result_artifact`

Use only these disposition values:

- `v029-implemented`
- `v029-gap`
- `v030-deferred`
- `parked`
- `withdrawn`
- `split`

A `v029-implemented` row requires a consumer and a verification command.
A deferred row requires a destination package or preservation file.

## Work-package order

1. Recover the Council review plane and admit the `agy` Setup lane.
2. Reconcile release scope and every active package.
3. Implement safety controls and close Tier 2 firing gaps.
4. Implement per-package audit evidence and telemetry sigma.
5. Close documentation, plugin, and freshness tooling.
6. Run final gates, refresh measurements, write records, and tag.

Later work depends on the package matrix.
Do not dispatch a later package from the stale checklist alone.

## Review loop

Each Grok round produces a committed candidate after architect verification.
Foreman builds a bundle from different base and head commits.
The bundle records the diff content hash.

Council requires three admissible verdicts from at least two model-family domains.
One admissible `changes_requested` verdict forces rework.

## Checkpoints

Write a SessionDB checkpoint at least once per hour.
Write another checkpoint before each long provider dispatch.
Write another checkpoint after each accepted package.

Do not record process liveness as a fact.

## Release gate

Do not create tag `v0.2.9` until all conditions hold:

- Every v0.2.9.0 package has executable implementation evidence.
- Every deferred item has a preserved v0.3.x destination.
- No release-blocking obligation remains open.
- Every quoted measurement is fresh at the final candidate commit.
- Council has no unresolved admissible dissent for the final bundle.
- Foreman release gates pass.

