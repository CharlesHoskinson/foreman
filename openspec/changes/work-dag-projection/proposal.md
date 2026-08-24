# Change: Ship the deterministic work-DAG projection

## Why

Foreman's durable event log is the system of record for a run. It is useful for
recovery, but its per-run events are awkward to compare. The repository already
contains a deterministic projector that turns those events into stable attempt,
verdict, gate, finding, and edge records. v0.4 qualifies and documents that
projector as the work-DAG boundary.

The earlier change proposed a much larger graph-symbol bridge. It depended on
inputs that the current event vocabulary does not consistently record and would
have mixed release work with later query-plane research. That scope moves to a
future release.

## What changes

- Keep `events.jsonl` as the only authority.
- Qualify `skills/foreman/scripts/graph-project.sh` as a deterministic,
  model-free projection command.
- Freeze the v0.4 record set: attempts, audit verdicts, gate decisions,
  findings, lineage edges, incomplete records, and coverage.
- Keep `--check` as the byte-identity test for a previously published output.
- Fail closed on malformed or torn input without replacing an existing output.
- Document that v0.4 does not perform checkpoint-to-symbol attribution, graph
  rename migration, cross-run aggregation, or automatic maintenance writes.

## Impact

- No running lane or release gate depends on the projector.
- The projector reads an event file and writes only stdout or the explicit
  `--out` target.
- Graphify is not invoked and `graphify-out/graph.json` is not modified.
- A projection can always be regenerated from its event log.
