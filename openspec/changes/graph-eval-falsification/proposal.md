# Change: Ship the graph evaluation boundary

## Why

The graph-context builder is opt-in because the repository has no completed,
cost-matched evaluation that proves it improves release work. The release must
not convert absent measurements into a passing claim.

The existing change described a large future research program. It required
telemetry, model runs, and observation windows that do not exist in v0.4. That
scope cannot be completed honestly during release closeout.

## What changes

- Add a canonical run-set format with 2,000 planned paired observations.
- Validate every recorded baseline or graph observation deterministically.
- Account for completed, unavailable, and not-run slots exactly.
- Promote graph context only when all 2,000 observations exist and the graph
  arm has more passing outcomes than the baseline arm.
- Keep graph context off for a loss, tie, unavailable run, or missing run.
- Publish the v0.4 run set and report. The report records zero completed runs
  and returns `GRAPH_OFF_UNCOMPUTABLE`.
- Ship the evaluator as a copied Node 24 runtime.

## Impact

The release gains an executable falsification boundary without inventing model
results. Graph context remains available through its explicit command, but it
does not become the default. Future work can fill the same run-set format with
real paired observations and obtain a measured verdict.
