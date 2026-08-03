# Spec delta — work plane

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

Scope note: `decision-lineage-and-telemetry` owns the event types and payload
keys this plane projects. `knowledge-plane-refresh` owns the graphify refresh,
the pinned version, the `--directed` mandate and the rename map. This delta
consumes them and redefines none of them.

## ADDED Requirements

### Requirement: the work plane is a deterministic projection of the event log

Foreman SHALL materialise the work DAG by projecting the recorded event log,
checkpoint commits and run-directory decision artifacts into
`graphify-out/worklog.jsonl`.

The projector SHALL derive every output field from a recorded input by copying it
or by a mechanical transformation of it.
The projector SHALL NOT invoke a language model, SHALL NOT call a network
service, and SHALL NOT accept model-authored input.
The projection SHALL NOT pass through graphify's extraction, semantic or
clustering passes.
WHEN a value the projection needs is absent from its inputs, the projector SHALL
mark the affected record incomplete with the named missing input, and SHALL NOT
infer the value.

#### Scenario: the projection is authored by no model

- WHEN the projector runs
- THEN no model invocation and no network call is made
- AND the output is derived only from the event log, the checkpoint commits, the
  run-directory artifacts, and the current local graph artifact with its
  recorded source commit.

#### Scenario: a missing input is marked, not filled in

- WHEN a round ends without a `round_done` event
- THEN the attempt's record is marked incomplete naming the missing event
- AND no outcome is inferred for it.

### Requirement: the projection is reproducible and diffable

Re-running the projection over identical inputs SHALL produce a byte-identical
`worklog.jsonl`.

The projector SHALL emit no timestamp of its own; every timestamp SHALL be copied
from a recorded event.
Record ordering SHALL be a total order over the record key, evaluated byte-wise
under a fixed collation, and SHALL NOT depend on traversal or map iteration
order.
Records SHALL NOT contain absolute paths, home directories, worktree paths or
hostnames; paths SHALL be repository-relative.
The projector SHALL provide a check mode that re-projects and reports any
difference from the current file.
WHEN the check mode reports a difference, THEN either the inputs changed or the
file was edited outside the projector, and the difference SHALL be reported
rather than silently reconciled.

#### Scenario: two runs of the projector agree byte for byte

- WHEN the projector is run twice over the same event log, checkpoints and graph
- THEN the two outputs are byte-identical.

#### Scenario: a hand edit is detected

- WHEN `worklog.jsonl` is edited by hand and the check mode runs
- THEN the difference is reported
- AND the projection is not silently overwritten to hide it.

#### Scenario: the same log projects identically on another machine

- WHEN the projector runs on a different host with a different checkout
  directory over the same recorded inputs
- THEN the output is byte-identical to the first host's.

### Requirement: the projection records what it consumed

Every projected record SHALL carry the highest event sequence number it consumed
from the run's event log.

The projection SHALL carry the run identifier, the projected coverage of that
run, and the identifier of the graph build it resolved node ids against.
WHEN the event log has advanced beyond the highest consumed sequence, the
projection SHALL be reported as stale.
IF the event log read stopped at a malformed or torn line, THEN the projector
SHALL project the valid prefix, SHALL mark the record set incomplete, and SHALL
NOT fail the run that produced the log.

#### Scenario: staleness is a computed answer, not a guess

- WHEN new events are appended after a projection
- THEN comparing the log's highest sequence with the projection's consumed
  sequence reports the projection as stale.

#### Scenario: a torn tail yields a partial, marked projection

- WHEN the event log's last line is a partial append
- THEN the projector emits records for the valid prefix
- AND marks the record set incomplete
- AND exits without failing the run.

### Requirement: the work plane is a sibling of the knowledge graph, never rows inside it

The projection SHALL be written to a file separate from `graphify-out/graph.json`.

The projector SHALL NOT write, modify or delete `graph.json`, and SHALL NOT write
any other graphify-owned artifact.
The projector SHALL open `graph.json` and `graphify-out/refresh-meta.json` for
reading only.
WHERE a graphify refresh rebuilds `graph.json` from the filesystem, the
projection SHALL be unaffected.
The projector SHALL NOT take the event log's locks, because it never writes an
event.

#### Scenario: a graphify refresh cannot destroy lineage

- WHEN a graphify refresh rebuilds `graph.json` from the filesystem
- THEN `worklog.jsonl` is unchanged
- AND every projected record remains readable.

#### Scenario: the projector is a pure reader

- WHEN the projector runs to completion
- THEN `graph.json` and the run's event log are byte-identical to their
  pre-run contents.

### Requirement: work entities carry the canonical identifier scheme

Every projected work entity SHALL be identified by the canonical work id
`foreman:run/<RUN>/lane/<LANE>/attempt/<N>`.

Verdicts and gate decisions SHALL be identified relative to the attempt they
belong to.
Findings SHALL be identified by a content-derived identifier so that the same
finding reported in different runs carries the same id, and the raw finding text
SHALL be retained alongside the id.
Vendor and model SHALL be projected from recorded event payload keys, and SHALL
NOT be inferred from a configuration value or from a filesystem path.
IF an event carries no attempt identifier, THEN the projector SHALL mark the
record incomplete rather than assuming an attempt number.

#### Scenario: a finding that recurs across runs is one query

- WHEN the same finding is reported in two different runs
- THEN both projected records carry the same finding id
- AND the runs are joinable on that id.

#### Scenario: vendor attribution is never inferred from a path

- WHEN a lane's vendor is not present in any event payload
- THEN the projected record marks the vendor unrecorded
- AND no vendor is derived from the lane's configuration home path.

### Requirement: the checkpoint bridge joins an attempt to the code it touched

The projector SHALL derive the files an attempt touched from the checkpoint
commits recorded for that attempt.

The projector SHALL resolve each changed path to a knowledge-plane node by
equality against that node's source file.
The projector SHALL refine a file match to the symbol node whose recorded source
location is the greatest one at or before the first changed hunk line for that
file.
IF no symbol node matches, THEN the projector SHALL attribute the change to the
file node, and SHALL NOT select a different symbol.
IF the changed path is not represented in the graph at all, THEN the projector
SHALL emit a path-keyed record marked unrepresented and SHALL count it.
The projection SHALL record the changed line ranges as provenance only, and SHALL
NOT use line numbers as identifiers.

#### Scenario: an attempt is joined to the symbols it changed

- WHEN an attempt's checkpoint changes one function in a represented file
- THEN the projection records an edge from the attempt to that symbol's node
- AND the edge carries the checkpoint sha and the consumed event sequence.

#### Scenario: an unmatched hunk falls back to the file, never to a guess

- WHEN a changed hunk precedes every recorded symbol location in the file
- THEN the projection records the edge against the file node
- AND records that no symbol matched.

#### Scenario: an unrepresented file is counted, not dropped

- WHEN an attempt changes a file absent from the graph
- THEN a path-keyed record marked unrepresented is emitted
- AND the unrepresented count for the run is incremented.

### Requirement: an identifier change caused by a file move is a rename with lineage

WHEN a knowledge-plane identifier changes because the underlying file moved, the
projection SHALL record a rename carrying the prior identifier, the new
identifier and the commit that caused it.

The projector SHALL NOT record such a change as a deletion followed by a
creation.
Existing records SHALL retain the identifiers they were projected with, and SHALL
NOT be rewritten.
The projector SHALL consume the rename map produced by the knowledge-plane
refresh, and SHALL NOT compute its own rename detection.
WHERE a query spans a rename, it SHALL be able to traverse from the prior
identifier to the new one through the recorded rename.

#### Scenario: lineage survives a file move

- WHEN a file is moved and every symbol identifier in it changes
- THEN a rename record links each prior identifier to its new one with the
  causing commit
- AND records projected before the move still resolve through the rename.

#### Scenario: history is never rewritten

- WHEN a rename is projected
- THEN the bytes of previously projected records are unchanged.

### Requirement: every record is stamped with the graphify version that produced its ids

The projection SHALL record, for every record that references a knowledge-plane
identifier, the graphify version that produced that identifier.

The version SHALL be read from the knowledge-plane refresh metadata, because
`graph.json` does not record it.
IF the version is unavailable, THEN the projector SHALL mark the affected records
as having an unknown producing version, and SHALL NOT omit the field.
WHERE two records carry different producing versions, a consumer comparing their
identifiers SHALL be able to detect that an identifier-space migration may
separate them.

#### Scenario: an id-space migration is diagnosable

- WHEN the graphify version changes between two projections
- THEN the records carry different producing versions
- AND a comparison across them is detectable as spanning a migration.

#### Scenario: an unknown version is stated, not omitted

- WHEN the refresh metadata is absent
- THEN the affected records carry an explicit unknown producing version.

### Requirement: every attempt is projected, including the ones that failed

The projection SHALL record every attempt present in the event log, with its
outcome.

Attempts that were abandoned, timed out, degraded, or gated out SHALL be
projected with the recorded reason.
The projector SHALL NOT filter the record set to successful attempts.
Each record SHALL carry an outcome status so that a consumer can select
successes, failures, or both.

#### Scenario: a failed attempt is queryable

- WHEN an attempt times out and is later superseded
- THEN both attempts appear in the projection with their outcomes
- AND the supersedes relationship between them is recorded.

#### Scenario: the failures are not shunted elsewhere

- WHEN a run contains more failed attempts than successful ones
- THEN all of them are in the same projected record space with the same join
  keys.

### Requirement: the projection reports its own coverage

The projection SHALL report what share of the run it was able to project.

The report SHALL state the number of attempts projected, the number of records
marked incomplete, the number of changed paths unrepresented in the graph, and
whether the run used durable lanes.
WHERE a run did not use durable lanes, the projection SHALL state that its
coverage of that run is limited by the absence of events rather than reporting an
empty result as a complete one.
The projector SHALL NOT present partial coverage as full coverage.

#### Scenario: an empty log is reported as uncovered, not as clean

- WHEN a run dispatched without durable lanes is projected
- THEN the projection reports zero attempts projected and states the reason
- AND does not report the run as having no work.

### Requirement: a projection failure never affects a run, a gate or a merge

The projector SHALL be an offline reader whose failure is isolated from lane
execution.

IF the projector fails for any reason, THEN it SHALL exit non-zero with a named
error and SHALL leave the previous projection intact.
The projector SHALL write through a temporary file and an atomic rename.
A projection failure SHALL NOT change any lane's outcome, any gate decision, or
any merge.

#### Scenario: a crashed projection leaves the prior file intact

- WHEN the projector is killed mid-write
- THEN `worklog.jsonl` is byte-identical to its pre-run contents.

#### Scenario: the merge path does not depend on the projection

- WHEN the projector fails
- THEN gate evaluation and merge behaviour are unchanged.
