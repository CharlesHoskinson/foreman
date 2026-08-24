# Tasks: graph evaluation boundary

## 1. Reconcile scope

- [x] Remove unmeasured model-quality claims from the v0.4 scope.
- [x] Keep graph context opt-in unless a complete paired run set promotes it.
- [x] Defer telemetry, cost, variance, vendor, and serializer studies.

## 2. Build the evaluator

- [x] Define the canonical 2,000-slot paired run set.
- [x] Reject duplicate, unordered, malformed, and oversized run sets.
- [x] Account for completed, unavailable, and not-run slots.
- [x] Return the four closed release evaluation verdicts.
- [x] Keep the graph default off for every result except `PROMOTE`.
- [x] Keep the public evaluator total for hostile runtime input.

## 3. Ship the command and evidence

- [x] Add the exact absolute-path report command.
- [x] Add the copied Node 24 runtime and manifest entry.
- [x] Publish the canonical v0.4 run set without fabricated observations.
- [x] Publish the generated `GRAPH_OFF_UNCOMPUTABLE` report.
- [x] Prove source and copied runtime output equality.

## 4. Gate

- [x] Run the focused graph-evaluation tests.
- [x] Run strict OpenSpec validation.
- [x] Run runtime verification and type checks.
- [x] Run bootstrap release coverage.
- [x] Run the full repository verifier.
- [x] Add the release brief and mark the package coverage row complete.
