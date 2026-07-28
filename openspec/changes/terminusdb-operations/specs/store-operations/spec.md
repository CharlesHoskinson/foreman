# Spec delta -- store operations

EARS-phrased. See `skills/foreman/references/five-part-spec.md`. This delta uses the
header shape the OpenSpec CLI parses (`## ADDED Requirements` -> `### Requirement:` ->
`#### Scenario:`), matching `graph-store-port`'s `specs/store/spec.md`.

## ADDED Requirements

### Requirement: Docker deployment pins version and image digest

The deployment SHALL run TerminusDB as a single Docker container whose image
reference is pinned to both a server version tag and a content-addressed image
digest, from a checked-in, reproducible compose or run definition.

WHEN the container is started, the deployment script SHALL verify the running
image's digest against the digest pinned in the deployment definition.
IF the running image digest does not match the pinned digest, THEN the deployment
script SHALL refuse to start the container and SHALL report both digests.
The deployment definition SHALL source `TERMINUSDB_ADMIN_PASS` from an environment
variable or secret store, and SHALL NOT hardcode a credential in the checked-in
definition.
The deployment definition SHALL set `TERMINUSDB_SERVER_WORKERS` above its default of
eight whenever more than eight concurrent lanes are configured, matching the
concurrency contract `graph-store-port` defines.
WHEN the pinned version or digest is bumped, the deployment script SHALL require a
completed stop-and-tar backup of the current data directory before starting the new
image, because cross-version store-directory compatibility is undocumented upstream.

#### Scenario: an unpinned or mismatched digest blocks startup

- WHEN the deployment script starts the container and the pulled image's digest does
  not equal the digest recorded in the deployment definition
- THEN the script refuses to start the container
- AND the reported error names both the pinned digest and the digest that was pulled.

#### Scenario: a version bump requires a backup first

- WHEN the operator changes the pinned version or digest in the deployment definition
- THEN the deployment script requires a completed stop-and-tar backup of the current
  data directory before it will start the new image
- AND the script refuses to proceed without one.

### Requirement: the store's data directory lives on a native filesystem, never under /mnt/*

The store's data directory SHALL be located on a native filesystem -- the WSL ext4
root or a Windows-native path under Git Bash -- and SHALL NOT be located under
`/mnt/*`, for the same fsync-integrity reason `events.jsonl` and `stream.ndjson`
already exclude `/mnt/*` per `skills/foreman/references/durable-lanes.md`.

The deployment definition SHALL bind-mount the container's storage path to a host
path that resolves off `/mnt/*`.
IF the configured host bind-mount path resolves under `/mnt/*`, THEN the deployment
script SHALL refuse to start and SHALL name the offending path.
The deployment definition SHALL keep the store's data directory on the same side of
the WSL/Windows boundary as the process writing to it, matching the durable-lanes WSL
note for the `nats-server` `store_dir`.

#### Scenario: a /mnt/* bind mount is refused

- WHEN the deployment definition configures the data-directory bind mount under
  `/mnt/c/...` or any other `/mnt/*` path
- THEN the deployment script refuses to start the container
- AND the error names the configured path and the fsync-integrity reason.

#### Scenario: the data directory survives a container restart on the correct filesystem

- WHEN the container is stopped and restarted with the same native-filesystem bind
  mount
- THEN every document and commit present before the restart is present after it.

### Requirement: backup is rehearsed on a cadence, not merely documented

Backup SHALL be performed by stopping the server and archiving the data directory,
and the restore path SHALL be exercised on a documented cadence rather than left as
an unexercised procedure.

The backup procedure SHALL run before every version or digest change and,
additionally, on a fixed cadence no less frequent than weekly while the store holds
data Foreman depends on operationally.
WHEN a restore drill runs, the operator SHALL restore the archived data directory
into a fresh container and SHALL confirm the named query-layer regression suite
returns the same results it returned before the archive was taken.
The restore drill SHALL run at least once before the store is relied upon in normal
operation, and at least once per quarter thereafter, on the same cadence as the
health re-check `graph-store-port` defines.
IF a restore drill fails to reproduce the pre-archive query results, THEN the
failure SHALL be recorded and the backup procedure SHALL be treated as broken until
fixed and re-drilled.

#### Scenario: a restore drill reproduces the pre-backup state

- WHEN the most recent stop-and-tar archive is restored into a fresh container
- THEN every named query in the regression suite returns the same result set it
  returned immediately before the archive was taken.

#### Scenario: a failed drill blocks trust in the backup

- WHEN a restore drill's query results diverge from the pre-archive results
- THEN the drill is recorded as failed
- AND the backup procedure is marked broken until a subsequent drill passes.

### Requirement: schema migration follows a dry-run-then-backup-then-apply runbook, with rebuild-from-source for inheritance changes

WHEN the ontology changes after data already exists in the store, the operator SHALL
apply the change through TerminusDB's migration API using a dry run before any live
run, and SHALL take a stop-and-tar backup immediately before the live run.

The migration runbook SHALL classify each proposed schema change as weakening (no
instance-data transformation required) or strengthening (instance data must change),
per the migration API's documented behavior, and SHALL require an explicit default or
transform for every strengthening change before it is applied.
IF a proposed schema change would restructure the class inheritance hierarchy, THEN
the operator SHALL NOT attempt it through the migration API, because `ChangeParents`
is unimplemented upstream, and SHALL instead perform a drop-and-rebuild from
`events.jsonl`, `graph.json`, `worklog.jsonl`, and the run JSON records
under the new schema.
The dry run's report SHALL be inspected for unexpected instance-data impact before
the live run is authorized.
IF the live migration run fails, or produces query results inconsistent with the dry
run's report, THEN the operator SHALL restore the pre-migration backup rather than
attempt a partial recovery in place.
The migration runbook SHALL record, for every applied migration, the operation list,
the dry-run report, the backup reference taken before it, and the query-layer
regression-suite result immediately after.

#### Scenario: a weakening change applies with no data loss

- WHEN a migration adds an optional field or a new class
- THEN the dry run reports no instance-data change
- AND the live run applies with the query-layer regression suite unaffected.

#### Scenario: a strengthening change without a default is refused

- WHEN a migration would add a required field or narrow a type with no explicit
  default or transform supplied
- THEN the migration is refused before the live run
- AND the runbook records the missing default as the blocking reason.

#### Scenario: an inheritance restructuring is rebuilt, not migrated

- WHEN a proposed schema change reparents a class
- THEN the operator performs a drop-and-rebuild from source artifacts under the new
  schema instead of calling the migration API
- AND the rebuild's query-layer regression-suite result is recorded alongside the
  schema change.

### Requirement: the query layer answers every N2 competency question as a named, regression-tested query

The query layer SHALL provide one named, version-controlled, regression-tested query
for every competency question enumerated in N2 section 9 (24 total), and each named
query SHALL declare its non-emptiness contract per the store's assert-non-empty
wrapper.

Every named query SHALL be issued through the store's expected-emptiness contract,
declaring itself as expecting results, expecting possible true-negative emptiness, or
expecting emptiness, and SHALL NOT be issued unwrapped.
Every named query built on a `Path` expression SHALL apply the store's deduplication
operator, because an unwrapped `Path` query returns one row per traversed path rather
than one row per answer.
The competency questions requiring negation-as-failure SHALL be implemented using the
negation construct verified live against the store, and SHALL NOT be attempted
through the auto-generated query surface that exposes only forward properties.
The regression suite SHALL run against a fixture with a known, hand-computed answer
for every named query, and SHALL run in CI on every change to the schema or the query
layer.
IF a named query references a class or relation that no longer exists in the frozen
schema, THEN the regression suite SHALL fail, naming the missing element, rather than
the query silently returning nothing.
The query layer SHALL publish a manifest mapping each of the 24 competency questions
to its named query identifier, its plane (work-DAG, knowledge, cross-plane), its
formalism requirement (negation, recursion, aggregation), and its non-emptiness
contract.
WHERE a competency question is recorded as a schema-frozen gap by the
schema package, this package's manifest SHALL record the identical
disposition rather than independently re-deriving or contradicting it.

#### Scenario: a negation query returns the correct closed-world answer

- WHEN the named query for "which specs have no passing evaluation" runs against a
  fixture with a known set of unevaluated specs
- THEN it returns exactly that known set
- AND it is implemented via the negation construct, not the auto-generated filter
  surface.

#### Scenario: a path query is deduplicated

- WHEN the named query for "which attempts descend transitively from round X" runs
- THEN the result contains exactly one row per descendant attempt
- AND the query wrapper's deduplication operator was applied.

#### Scenario: a schema drift breaks the suite loudly

- WHEN a class or relation referenced by a named query is removed from the frozen
  schema
- THEN the regression suite fails, naming the missing element
- AND no named query silently returns an empty result instead.

#### Scenario: the manifest accounts for all 24 questions, gaps included

- WHEN the query-layer manifest is checked against N2 section 9
- THEN every one of the 24 competency questions maps to exactly one named
  query OR is recorded as an explicit gap matching the schema package's own
  disposition for that question
- AND none is silently absent from the manifest -- a recorded gap is not
  the same as an omission.

### Requirement: the store is monitored without Prometheus

The deployment SHALL be monitored without relying on TerminusDB's Prometheus
`/api/metrics` endpoint, because that endpoint is Enterprise-gated and absent from
the OSS server.

The monitoring script SHALL poll `/api/info` for liveness and reported version, SHALL
record container RSS and data-directory size via the container runtime, and SHALL
record a typed-document count via the store's own document-listing endpoint, on a
cadence no less frequent than hourly while the store is in use.
The monitoring script SHALL NOT call `/api/log` for any monitoring signal, because
that endpoint is banned from all query paths.
WHEN measured idle RSS or on-disk size exceeds three times the R8-measured baseline
(idle RSS 38 MB; 9.7 MB on disk per ~5,500 documents) for the current document count,
the monitoring script SHALL emit a named alert for investigation rather than
continuing silently.
IF `/api/info` does not respond within a bounded timeout, THEN the monitoring script
SHALL treat the store as unavailable and SHALL trigger the degrade-to-files-only
reporting path `graph-store-port` defines.
The monitoring script SHALL be exercised on the same cadence as the drop-and-rebuild
job, so it is not aspirational shelfware.

#### Scenario: routine polling records the operational baseline

- WHEN the monitoring script runs its hourly poll
- THEN it records liveness, version, RSS, disk size, and document count without
  querying the commit log.

#### Scenario: a resource anomaly is flagged

- WHEN measured RSS or disk size exceeds three times the R8 baseline for the current
  document count
- THEN the monitoring script emits a named alert
- AND does not merely log the number without flagging it.

#### Scenario: an unreachable store is reported, not silently retried forever

- WHEN `/api/info` fails to respond within the bounded timeout
- THEN the monitoring script reports the store unavailable
- AND the reporting path matches the files-only degradation Foreman already defines.

### Requirement: drop-and-rebuild is timed and run on a schedule

The store SHALL be dropped and rebuilt from `events.jsonl`, `graph.json`,
`worklog.jsonl`, and the run JSON records on a fixed schedule, and the rebuild
SHALL be timed against a documented budget rather than run once and forgotten.

The rebuild job SHALL run no less frequently than monthly, and SHALL record
wall-clock duration, document count, and the query-layer regression-suite result
immediately after rebuild.
The duration budget SHALL be derived from the R8-measured ingest rate (~1,070
documents/second in batches of 500) and re-derived, not fixed forever, as the corpus
grows.
IF a scheduled rebuild's duration exceeds the current budget, or the post-rebuild
regression suite diverges from the pre-drop results, THEN the job SHALL fail loudly
and the failure SHALL be recorded in the release checklist, rather than the schedule
silently skipping a run.
The rebuild job SHALL be the same mechanism exercised by the destroy-and-rebuild
conformance test `graph-store-port` defines, run against the live operational data
directory rather than a synthetic fixture only.

#### Scenario: a scheduled rebuild completes inside budget

- WHEN the monthly rebuild job runs against the live data directory
- THEN it completes within the current documented time budget
- AND the post-rebuild regression suite matches the pre-drop results.

#### Scenario: a rebuild exceeding budget is a recorded failure

- WHEN a scheduled rebuild takes longer than the current budget
- THEN the job fails loudly
- AND the failure and the measured duration are recorded in the release checklist.

#### Scenario: the rebuild's source artifacts are ones a component actually produces

- WHEN the rebuild job is inspected for its declared source artifacts
- THEN every named artifact (events.jsonl, graph.json, worklog.jsonl, run
  JSON records) is produced by an existing, owned component
- AND no artifact named "the lane journals" or any other undefined journal
  appears in the source list.

### Requirement: the exit path to files-only is rehearsed and gated by named numeric tripwires

The exit path to the files-only implementation SHALL be gated by named, numeric
tripwire conditions, checked on the same quarterly cadence as `graph-store-port`'s
health re-check, and SHALL be rehearsed rather than left as a documented-only
procedure.

The tripwire conditions SHALL include, at minimum:
fewer than 50 commits to the upstream project in any rolling six-month window;
a single commit author's share of upstream commits remaining above 90% across two
consecutive quarterly checks;
any TerminusDB capability Foreman depends on operationally moving from the OSS
edition to the Enterprise edition;
any change in the upstream project's license away from Apache-2.0.
WHEN any tripwire condition is met, the operator SHALL execute the documented
fallback to the files-only implementation within one release, per `graph-store-port`'s
health re-check requirement, and SHALL record which tripwire fired and the evidence.
The exit path SHALL be rehearsed at least once before the store is relied upon in
normal operation, by running a full round on the files-only implementation with the
TerminusDB adapter stopped, and SHALL be re-rehearsed within one release of any
tripwire firing.
The quarterly check SHALL re-fetch live upstream commit-cadence, author-share, and
licensing data rather than relying on the R8 snapshot, because the snapshot ages.
IF the quarterly check cannot reach the upstream project's public commit history,
THEN the check SHALL report itself as inconclusive rather than silently reporting
green.

#### Scenario: a tripwire firing produces a dated decision record

- WHEN the quarterly check finds fewer than 50 upstream commits in the trailing six
  months
- THEN the check records the tripwire, the measured count, and the fallback action
- AND the finding is recorded in the release checklist.

#### Scenario: the exit path is proven before it is needed

- WHEN the exit-path rehearsal runs with the TerminusDB adapter stopped
- THEN a full round completes on the files-only implementation
- AND the rehearsal result is recorded before the store is relied upon operationally.

#### Scenario: a stale health check is never mistaken for a clean one

- WHEN the quarterly check cannot reach the upstream repository's commit history
- THEN the check reports itself inconclusive
- AND does not report the tripwires as un-fired.
