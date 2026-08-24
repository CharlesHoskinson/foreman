# Tasks: deterministic work-DAG projection

## 1. Reconcile the release scope

- [x] Remove the unimplemented checkpoint-to-symbol and rename-migration scope.
- [x] Keep the event log as the only v0.4 projection authority.
- [x] Record the deferred query and aggregation work explicitly.

## 2. Qualify the projector

- [x] Project attempts, verdicts, gates, findings, lineage edges, and coverage.
- [x] Use stable work and finding identifiers.
- [x] Preserve unknown event-type additivity.
- [x] Mark missing known fields instead of inferring them.
- [x] Produce byte-identical output for identical event content and reordered
  equivalent events.
- [x] Detect hand edits through `--check`.
- [x] Publish through a temporary file and atomic rename.
- [x] Leave the event log unchanged.

## 3. Gate

- [x] Run `tests/graph-project.bats`.
- [x] Run `shellcheck` on the projector.
- [x] Run strict OpenSpec validation.
- [x] Run the full repository verifier.
- [x] Add the release brief and mark the package coverage rows complete.
