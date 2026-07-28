# Spec delta — graphify integration

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: the knowledge graph refreshes automatically, AST-only, per merge

Foreman SHALL refresh `graphify-out/graph.json` automatically rather than by
hand, and the automatic path SHALL be deterministic and free of LLM cost.

WHEN a merge lands on the default branch, Foreman SHALL run
`skills/foreman/scripts/graph-refresh.sh --cadence merge`.
WHILE running the merge cadence, the refresh SHALL invoke only graphify's
incremental AST update and SHALL NOT invoke semantic extraction, clustering or
community labelling.
The refresh SHALL read `graphify-out/cost.json` before and after the update and
SHALL assert that both the input-token and output-token deltas are zero.
IF the merge cadence records a non-zero token delta, THEN the refresh SHALL fail,
SHALL NOT publish the resulting graph, and SHALL name the files that triggered
semantic extraction.
IF `graphify-out/cost.json` is absent, THEN the refresh SHALL treat the baseline
as zero and create the file, and SHALL NOT skip the assertion.

#### Scenario: a code-only merge refreshes at zero cost

- WHEN a merge changes only files graphify classifies as code
- THEN `graph-refresh.sh --cadence merge` completes
- AND the recorded input-token and output-token deltas are both zero
- AND `graphify-out/graph.json` is republished with the new `built_at_commit`.

#### Scenario: an accidental LLM pass on the merge cadence fails the refresh

- WHEN the merge cadence completes with a non-zero token delta in `cost.json`
- THEN the refresh fails without publishing
- AND the failure names the files that triggered semantic extraction.

### Requirement: every refresh runs directed, and a collapsed-edge build is refused

The knowledge plane SHALL be built as a directed graph so that parallel typed
edges between the same pair of nodes survive.

The refresh SHALL pass `--directed` to every graphify invocation that builds or
diagnoses the graph.
WHEN the refresh runs the health diagnostic, it SHALL read the
`directed_same_endpoint_collapsed_edges` and
`undirected_same_endpoint_collapsed_edges` counters.
IF either collapsed-edge counter is non-zero, THEN the refresh SHALL refuse to
publish and SHALL report that the directed mandate was not in force, because a
non-zero counter is proof that parallel edges were discarded rather than a
quality signal to be weighed.
The refresh SHALL record the `directed` flag of the published document in
`graphify-out/refresh-meta.json`.

#### Scenario: an undirected build never reaches the artifact

- WHEN a refresh produces a document whose `directed` field is `false`
- THEN the refresh refuses to publish
- AND the previous `graphify-out/graph.json` is left unchanged
- AND the refusal names the collapsed-edge counters it observed.

#### Scenario: parallel typed edges survive a directed refresh

- WHEN two edges with different relations connect the same ordered pair of nodes
- THEN both edges are present in the published `graph.json`
- AND the collapsed-edge counters are zero.

### Requirement: one pinned interpreter and one pinned graphify version, stamped into the output

Foreman SHALL resolve exactly one Python interpreter and exactly one graphify
version for every graph operation, and SHALL record which ones it used.

The refresh SHALL resolve the interpreter from `graphify-out/.graphify_python`
when present, and SHALL otherwise resolve it from the `[graphify]` block of
`env/reference-manifest.toml`.
The refresh SHALL NOT select an interpreter by trying candidates in order until
one imports graphify.
WHEN the refresh starts, it SHALL read the resolved graphify version and compare
it to the pinned version in `env/reference-manifest.toml`.
IF the resolved version differs from the pin, THEN the refresh SHALL refuse to
run and SHALL report both versions and the resolved interpreter path.
The refresh SHALL write `graphify_version`, the absolute interpreter path,
`built_at_commit`, the cadence, and the refresh timestamp into
`graphify-out/refresh-meta.json`, because `graph.json` records `built_at_commit`
and carries no version field of its own.

#### Scenario: three coexisting graphify installations are a refusal, not a coin toss

- WHEN the host has graphify 0.9.16 on `PATH`, 0.9.18 importable under `python3`,
  and a 0.9.15 skill, and the pin names one of them
- THEN the refresh uses only the pinned interpreter
- AND a resolved version that differs from the pin causes a refusal naming both
  versions and the interpreter path.

#### Scenario: the producing version is recoverable from the artifact

- WHEN a consumer reads a published graph
- THEN `graphify-out/refresh-meta.json` states the graphify version and
  interpreter that produced it
- AND that record is committed alongside `graph.json`.

### Requirement: every graphify write is serialised by a Foreman-owned lock

Foreman SHALL serialise all writes to `graphify-out/` through its own lock,
because graphify's advisory lock covers only three of its own call sites.

WHERE an operation writes `graphify-out/graph.json`, `GRAPH_REPORT.md` or
`graphify-out/refresh-meta.json`, it SHALL acquire the Foreman graph lock via
`skills/foreman/scripts/lib/lock.sh` before starting and SHALL release it
exactly once on every exit path.
WHERE an operation only reads the graph, it SHALL NOT acquire the lock.
IF the lock cannot be acquired within the configured timeout, THEN the operation
SHALL exit non-zero with a named error and SHALL NOT write.
The refresh SHALL NOT treat graphify's shrink guard as a concurrency control,
because the guard fires only when the incoming graph has fewer nodes and
therefore does not detect two writers adding disjoint nodes.

#### Scenario: two concurrent refreshes serialise instead of clobbering

- WHEN two refresh processes start against the same `graphify-out/` and each adds
  nodes the other does not
- THEN the second waits for the first to release the lock
- AND the published graph contains both sets of nodes
- AND neither writer's work is discarded.

#### Scenario: readers are not blocked

- WHEN the context builder reads `graph.json` while a refresh holds the lock
- THEN the read proceeds without acquiring the lock
- AND the reader observes either the previous or the newly published document,
  never a partial one.

### Requirement: a refresh publishes only after the health diagnostic passes

The refresh SHALL gate publication on graphify's structural health diagnostic,
run against the artifact consumers will read.

WHEN a refresh has produced a candidate graph, it SHALL run
`graphify diagnose multigraph --json --directed` against that candidate.
The refresh SHALL record `dangling_endpoint_edges`, `missing_endpoint_edges`,
`self_loop_edges`, `non_object_edges`, both collapsed-edge counters,
`unverified_node_count`, and the fraction of non-isolated nodes in
`graphify-out/refresh-meta.json`.
IF any of `dangling_endpoint_edges`, `missing_endpoint_edges` or
`non_object_edges` is non-zero, THEN the refresh SHALL refuse to publish and
SHALL leave the previously published graph in place.
The refresh SHALL NOT rely on the skill pipeline's Step 4.5 health line as the
gate, because that check runs pre-build against the extraction dictionary rather
than against `graph.json`.

#### Scenario: a corrupt candidate never replaces a good graph

- WHEN a refresh produces a candidate graph with dangling endpoint edges
- THEN nothing is published
- AND `graphify-out/graph.json` still contains the previous build
- AND `refresh-meta.json` records the failing counters and marks the last
  refresh as failed.

### Requirement: cohesion and community labels are captured before cleanup destroys them

Foreman SHALL retain the derived analysis that graphify writes to a sidecar and
then deletes.

WHEN a refresh completes its analysis step, it SHALL copy the community cohesion
map and community labels out of `graphify-out/.graphify_analysis.json` into
`graphify-out/refresh-meta.json` before any cleanup step removes the sidecar.
IF the sidecar is absent at capture time, THEN the refresh SHALL record cohesion
as unavailable with the reason, and SHALL NOT reconstruct it from report prose.

#### Scenario: cohesion survives the pipeline's cleanup step

- WHEN a full refresh runs to completion and the analysis sidecar is deleted
- THEN the cohesion map for every community is present in
  `graphify-out/refresh-meta.json`
- AND each entry carries the raw numeric score.

### Requirement: graph freshness is measured, reported, and checkable without graphify

Foreman SHALL make knowledge-plane staleness visible on every host, including
hosts that cannot run graphify.

`skills/foreman/scripts/graph-freshness.sh` SHALL compute, using only git and
`jq`, whether `built_at_commit` is an ancestor of `HEAD`, how many commits of
drift exist, and how many tracked files are absent from the graph's
`source_file` set.
WHEN the merge gate runs, it SHALL attempt a merge-cadence refresh.
IF the refresh runs and fails, THEN the merge gate SHALL BLOCK and SHALL name the
failing health counter or assertion.
IF graphify is unavailable on the host, THEN the merge gate SHALL record the
refresh as `SKIPPED` together with the measured drift, and SHALL NOT block.
IF `built_at_commit` is not an ancestor of `HEAD`, THEN the freshness check SHALL
report the graph as unrelated rather than stale, because a non-ancestor build
cannot be interpreted as drift.
The measured drift SHALL be stamped into every artifact derived from the graph,
so that a consumer can judge staleness without re-deriving it.

#### Scenario: a stale graph on a host without graphify does not block the merge

- WHEN the merge gate runs on a host where graphify is not importable and the
  graph is three commits behind with 26 unrepresented files
- THEN the gate records `SKIPPED` with those two numbers
- AND the merge is not blocked
- AND the drift appears in the gate output.

#### Scenario: a refresh that runs and fails blocks the merge

- WHEN graphify is available and a merge-cadence refresh fails its health gate
- THEN the merge gate blocks
- AND the block names the failing counter.

### Requirement: file moves are refreshed as rename-with-lineage

The refresh SHALL preserve identity across file moves, because graphify node IDs
are path-derived and a move re-identifies the file node and every symbol in it.

WHEN a refresh follows a commit range containing renames, it SHALL compute the
rename set with `git diff --find-renames` over that range.
The refresh SHALL write a `renames` map from prior node ID to new node ID into
`graphify-out/refresh-meta.json` for the file node and every symbol node derived
from a renamed file.
The refresh SHALL NOT present a rename as a deletion plus a creation.
WHERE a symbol cannot be mapped across the rename, the refresh SHALL record it as
unmapped with its old and new source paths, and SHALL NOT guess a mapping.

#### Scenario: moving a file preserves the identity of its symbols

- WHEN a commit moves `skills/foreman/scripts/lib/eventlog.sh` to a new path and
  a refresh runs over that commit
- THEN `refresh-meta.json` maps the old file node ID and each old symbol node ID
  to its new ID
- AND no deletion is recorded for those nodes.

### Requirement: LLM extraction runs only on the slow cadence and is never evidential

Foreman SHALL keep every LLM-priced graph operation off the per-commit path and
SHALL mark its outputs as advisory.

WHERE semantic extraction, clustering or community labelling is required, it
SHALL run under `graph-refresh.sh --cadence slow` on a nightly or per-release
schedule.
The slow cadence SHALL record its token cost in `graphify-out/refresh-meta.json`.
Nodes and edges produced by the slow cadence SHALL remain distinguishable from
AST-produced records by their `_origin` field, and community labels, cluster
membership and cohesion SHALL be marked advisory.
IF a gate or verdict cites an advisory record as evidence, THEN the citation
SHALL be rejected.

#### Scenario: community labels cannot ground a gate decision

- WHEN a gate check cites a community label as its evidence
- THEN the check is rejected as ungrounded
- AND the rejection names the advisory class of the cited record.

### Requirement: the cypher and graph-database export paths are banned

Foreman SHALL NOT consume any graphify export as a source of graph data.
`graphify-out/graph.json` SHALL be the only supported source of truth for
downstream consumers.

Foreman code, scripts, CI and documentation SHALL NOT invoke
`graphify export neo4j`, `graphify export falkordb`, or any path that produces
`cypher.txt`, because that exporter emits five values and discards
`source_file`, `source_location`, `confidence_score`, `weight`, `context`,
`rationale`, `verification`, `metadata`, hyperedges, community assignment and
`built_at_commit`.
The docs gate SHALL fail on any occurrence of those invocations outside a
paragraph that documents the ban.
WHERE a downstream consumer needs graph data, it SHALL read `graph.json`
directly.

#### Scenario: the banned export path fails the gate

- WHEN a change introduces a call to `graphify export neo4j`
- THEN the docs gate fails and cites this requirement
- AND the failure states that `graph.json` is the supported source.

## MODIFIED Requirements

### Requirement: maintenance runs the graph stage through the pinned refresh

`skills/foreman/scripts/maintenance.sh` currently implements its own graph stage
at `:249-289`: it selects the first of `python3` or `python` that can import
graphify, prefers a bare `graphify` on `PATH`, and runs `graphify . --update`
with no `--directed`, no lock, no health gate and no version stamp.

`run_graph` SHALL delegate to `skills/foreman/scripts/graph-refresh.sh` and SHALL
NOT resolve an interpreter itself.
`run_graph` SHALL continue to report `GRAPH_STATUS` as `ok`, `stale` or
`skipped`, and SHALL additionally distinguish a refresh that ran and failed from
a graph that is merely out of date.
WHEN the graph stage is skipped because graphify is unavailable, `run_graph`
SHALL report the measured freshness drift alongside the skip reason rather than
the bare string `graphify not importable`.

#### Scenario: maintenance no longer chooses its own interpreter

- WHEN `maintenance.sh --stage graph` runs on a host with several graphify
  installations
- THEN the interpreter used is the pinned one
- AND `run_graph` contains no candidate-interpreter loop.

#### Scenario: a failed refresh is distinguishable from a stale graph

- WHEN a refresh runs and fails its health gate during maintenance
- THEN `GRAPH_STATUS` distinguishes that outcome from a graph that is simply
  behind `HEAD`
- AND the detail names the failing counter.
