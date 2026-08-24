# Design: deterministic work-DAG projection

## Boundary

The v0.4 work DAG is a pure projection:

```text
worklog.jsonl = project(run-id, events.jsonl)
```

It is not a database, a knowledge-graph extension, or release authority. It
does not call a model, read prompts, infer missing values, or write the event
log.

## Input

The command requires a run identifier. The event path defaults to the run's
durable `events.jsonl` and can be supplied explicitly. Every input line must be
valid JSON and must end with LF or CRLF. A malformed line, an empty line, or a
torn final line refuses the projection.

Unknown event types are ignored. This keeps the projection additive as the
event vocabulary grows. Known event types without the fields needed for a
record produce an explicit incomplete record when possible.

## Output

The projector emits canonical compact JSONL in a byte-wise total order. The
v0.4 records are:

- attempt nodes;
- audit-verdict, gate-decision, and finding nodes;
- `produced`, `evaluated_by`, `gated_by`, `descends_from`, and `supersedes`
  edges;
- incomplete records for known events missing required identity fields; and
- one coverage record with consumed sequence, event count, projected attempts,
  incomplete count, and durable-event availability.

Attempt identifiers use
`foreman:run/<RUN>/lane/<LANE>/attempt/<N>`. Finding identifiers use the
recorded stable identifier or a SHA-256 digest of file, line, and summary.
Vendor, model, usage, outcome, and time fields are copied from events. No
projector-generated timestamp is emitted.

## Determinism and publication

`LC_ALL=C` fixes collation. Records are keyed and sorted independent of event
traversal order. Two projections of identical event content are byte-identical,
including from different checkout directories.

Without `--out`, bytes go to stdout. With `--out`, the projector validates and
projects to a sibling temporary file, then renames it over the destination.
Failure before rename leaves the prior output unchanged. `--check` projects to
a temporary file and compares bytes without modifying the destination.

## Safety

The projector uses only local `jq` and SHA-256 tooling. It does not invoke
Graphify, a model, a network client, or a release command. It takes no event-log
lock because it never writes an event. Projection failure cannot affect a
worker, gate, merge, or source file.

## Deferred work

v0.4 does not claim:

- checkpoint-to-file or symbol attribution;
- Graphify node identifiers, version stamps, or rename chains;
- cross-run aggregation or a committed global worklog;
- causal links between a finding and a later correction;
- repair or partial acceptance of a torn event log; or
- automatic projection from the maintenance workflow.

Those features require a separate input and storage design. Direct event-log
inspection remains the fallback.
