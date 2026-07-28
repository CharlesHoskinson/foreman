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
incremental AST update — `graphify update` under the pinned interpreter — and
SHALL NOT invoke semantic extraction, clustering or community labelling.
Verified against graphify 0.9.16: `graphify update` builds through
`watch._rebuild_code` → `build_from_json(result)` (`watch.py:1050`) with no
`directed` keyword, so the artifact this cadence publishes carries
`"directed": false`. That is the defined output of the cadence and SHALL NOT be
treated as a failure; the direction requirement below governs what is gated.
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
- AND `graphify-out/graph.json` is republished with the new `built_at_commit`
- AND the republished artifact carries `"directed": false`, which is not a
  failure.

#### Scenario: an accidental LLM pass on the merge cadence fails the refresh

- WHEN the merge cadence completes with a non-zero token delta in `cost.json`
- THEN the refresh fails without publishing
- AND the failure names the files that triggered semantic extraction.

### Requirement: direction survives as endpoint order and is reconstructed at load

The knowledge plane SHALL preserve edge DIRECTION. Direction SHALL be carried by
the ordered endpoints of every published link and SHALL be reconstructed by the
consumer at load time. Publication SHALL NOT be gated on the `directed` field of
`graph.json`.

Established by execution against the pinned graphify 0.9.16
(`/root/.local/share/uv/tools/graphifyy`, `graphify --version` → `graphify
0.9.16`):

- **No shipped CLI entry point builds a directed graph.** `graphify update`
  rejects `--directed` with exit 2 (`cli.py:1250`, *"unknown update option"*)
  and builds through `watch._rebuild_code` → `build_from_json(result)`
  (`watch.py:1050`) with no keyword, publishing `"directed": false`;
  `graphify extract` — the slow cadence's build — calls `build([merged], …)`
  (`cli.py:2551`), also with no keyword, publishing `"directed": false`;
  `--directed` exists only on `diagnose multigraph` (`cli.py:831`), where it
  simulates direction over an already-built document. Neither cadence can
  produce `"directed": true`, so a gate requiring it refuses every merge.
  `"directed": true` is reachable only from the Python API
  (`build_from_json(..., directed=True)`), which no CLI cadence calls.
- **Direction is nevertheless preserved in the artifact.** The build stashes the
  producer endpoints as `_src`/`_tgt` and `to_json` restores them into every
  link (`export.py:305-311`), so endpoint order in `graph.json` is the
  producer's order, not a canonicalisation. Measured: an undirected build of a
  single `zeta → alpha` `calls` edge exports as `zeta → alpha`; the committed
  `graphify-out/graph.json` carries 1,465 of 3,668 links whose `source` sorts
  strictly after its `target`, and a re-extracted 208-file subset carries 1,041
  of 2,531.
- **Direction is recoverable by the consumer.** Loading the committed
  `"directed": false` artifact with `build_from_json(raw, directed=True)` yields
  a `DiGraph` of 3,579 nodes and 3,668 edges in which `has_edge(u, v)` is true
  and `has_edge(v, u)` is false for the sampled descending pairs. This is what
  graphify's own readers do: `path`, `explain`, `serve` and `affected` force
  `{"directed": True}` at load.

The refresh SHALL NOT refuse to publish because the published `directed` field
is `false`, on either cadence.
The refresh SHALL record the observed `directed` field in
`graphify-out/refresh-meta.json` as an observation of the artifact, and SHALL
NOT present it as a gate result.
WHEN the refresh has produced a candidate artifact, it SHALL count the links
whose `source` sorts strictly after its `target`, and SHALL record that count.
IF that count is zero while the candidate contains at least one link, THEN the
refresh SHALL refuse to publish and SHALL report that endpoint order was
canonicalised — a writer that discards `_src`/`_tgt` produces exactly zero such
links, where both measured corpora produce roughly forty per cent.
Every Foreman consumer of `graph.json` SHALL reconstruct direction at load with
`build_from_json(raw, directed=True)` and SHALL NOT branch on the artifact's
`directed` field.
Parallel typed edges between the same ordered pair — the `SUPPORTS` /
`CONTRADICTS` case the claim graph requires — SHALL remain **store-native and
SHALL NOT round-trip through `graph.json`**, because
`build_from_json(..., directed=True)` returns an `nx.DiGraph` whose
`is_multigraph()` is false (`build.py:490`) and silently collapses the pair to
one edge. This requirement governs direction only.

#### Scenario: the merge cadence publishes an undirected artifact and the gate accepts it

- WHEN a merge-cadence refresh publishes an artifact whose `directed` field is
  `false`
- THEN the refresh publishes
- AND `refresh-meta.json` records `directed: false` as an observation
- AND no gate cites the `directed` field.

#### Scenario: a canonicalising writer is refused

- WHEN a candidate artifact contains links but none whose `source` sorts
  strictly after its `target`
- THEN the refresh refuses to publish
- AND the refusal reports the endpoint-order count it observed
- AND the previous `graphify-out/graph.json` is left unchanged.

#### Scenario: a consumer reads direction without trusting the field

- WHEN a consumer loads a `"directed": false` artifact
- THEN it builds with `build_from_json(raw, directed=True)`
- AND an edge `u → v` is present while `v → u` is absent.

#### Scenario: parallel typed edges are not expected from graphify

- WHEN two edges with different relations connect the same ordered pair of nodes
  in the extraction input
- THEN the published `graph.json` is permitted to contain only one of them,
  because the builder produces a simple directed graph
- AND the refresh SHALL NOT report that parallel typed edges were preserved
- AND the decision edges that require both SHALL be present store-native rather
  than sourced from `graph.json`.

### Requirement: a refresh that fails blocks, a refresh that cannot run does not

A refresh that runs and fails SHALL block the merge gate. A host that cannot
run a refresh at all SHALL record `SKIPPED` and SHALL NOT block.

The asymmetry is deliberate and SHALL be documented where it is enforced. A
failed refresh is evidence about the graph: the tooling ran, observed the
corpus, and reported that the artifact is wrong. An absent refresh is evidence
only about the host, and blocking on it would make every contributor without
the graph toolchain unable to merge — which converts an advisory quality
signal into an availability requirement nobody agreed to.
IF a host records `SKIPPED`, THEN the refresh SHALL name the missing
prerequisite, and the staleness of the published graph SHALL continue to be
measured by the freshness contract rather than silently forgiven.
IF `SKIPPED` is recorded on a host that is expected to be able to refresh —
CI, or a host whose inventory reports the toolchain present — THEN it SHALL be
treated as a failure, not a skip.

#### Scenario: a broken graph blocks the gate

- WHEN a refresh runs to completion and the pre-build extraction diagnostic
  reports a non-zero `directed_same_endpoint_collapsed_edges`
- THEN the merge gate is blocked
- AND the refusal names the counter and the stage it was computed at.

#### Scenario: a host without the toolchain does not block

- WHEN a refresh cannot run because the pinned interpreter or graphify version
  is absent
- THEN the refresh records `SKIPPED` naming the missing prerequisite
- AND the merge gate is not blocked
- AND the freshness contract still reports the graph's staleness.

#### Scenario: a skip in CI is a failure

- WHEN `SKIPPED` is recorded in CI, or on a host whose inventory reports the
  toolchain present
- THEN it is treated as a failure and blocks
- AND the report distinguishes it from a legitimate skip.

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

### Requirement: each health counter is gated at the only stage where it can fail

The refresh SHALL gate publication on graphify's structural health diagnostic,
and SHALL run each counter at the stage where that counter can observe the
property it names. A counter SHALL NOT be gated at a stage where its value is
fixed by construction.

WHEN a refresh has produced a candidate graph, it SHALL run
`graphify diagnose multigraph --json --graph <candidate>` against that candidate
and SHALL gate on `dangling_endpoint_edges`, `missing_endpoint_edges` and
`non_object_edges`.
IF any of those three is non-zero, THEN the refresh SHALL refuse to publish and
SHALL leave the previously published graph in place.
Those three are gateable on the artifact because the incremental prune and merge
paths can leave edges whose endpoints are no longer nodes — measured: zero on a
freshly published artifact, two after removing one node and keeping its edges,
which is the corruption `export.prune_dangling_edges` exists to repair.
The refresh SHALL NOT gate on `directed_same_endpoint_collapsed_edges` or
`undirected_same_endpoint_collapsed_edges` computed over `graph.json`, because
neither can be non-zero there: the build has already discarded the duplicate
producer edge before the file is written, and graphify states it directly —
*"A normal graph.json is already post-build and cannot recover raw producer
edges"* (`diagnostics.py`, `format_diagnostic_json`). Measured: a **directed**
build of the two-parallel-edge fixture that dropped one edge reports
`directed_same_endpoint_collapsed_edges: 0` on the published file. A check that
cannot fail SHALL NOT be written as a gate.
WHERE the collapse counters are required, the refresh SHALL compute them over
the **pre-build extraction** rather than over the artifact: on the merge cadence,
the union of the per-file AST extraction records graphify persists under
`graphify-out/cache/ast/v<pinned-version>/*.json` (`cache.py:340-360`); on the
slow cadence, an extraction document the refresh itself writes to
`graphify-out/.refresh-extraction.json` before the build. The refresh SHALL NOT
assume graphify persists a pre-build extraction of its own — `graphify extract`
writes `graph.json` directly and materialises no such document — so the slow
cadence SHALL create that input or SHALL NOT claim the collapse counter for
that cadence.
The refresh SHALL gate on `directed_same_endpoint_collapsed_edges` over that
pre-build extraction and SHALL refuse to publish when it is non-zero, naming the
ordered pair and the relations involved. Measured: zero on a healthy 208-file
corpus, and one after seeding a single parallel typed edge — the check fires.
The refresh SHALL NOT gate on `undirected_same_endpoint_collapsed_edges` over
the pre-build extraction, because it counts legitimate `u → v` plus `v → u`
pairs — measured 1 on that same healthy corpus — and SHALL record it as an
observation.
The refresh SHALL NOT gate on `dangling_endpoint_edges` over the pre-build
extraction, because cross-file endpoints are resolved when the per-file records
are merged and are therefore absent from those records — measured 76 on that
same healthy corpus — and SHALL record it as an observation.
The AST-cache layout is private to graphify; the version pin is what makes
reading it safe, and a pin bump SHALL re-verify the layout before the gate is
trusted again.
The refresh SHALL record `dangling_endpoint_edges`, `missing_endpoint_edges`,
`self_loop_edges`, `non_object_edges`, both collapse counters **with the stage
each was computed at**, `unverified_node_count`, the endpoint-order count, and
the fraction of non-isolated nodes in `graphify-out/refresh-meta.json`.
The refresh SHALL NOT rely on the skill pipeline's Step 4.5 health line as the
gate, because it runs against an extraction document that cadence does not
produce.

#### Scenario: a corrupt candidate never replaces a good graph

- WHEN a refresh produces a candidate graph with dangling endpoint edges
- THEN nothing is published
- AND `graphify-out/graph.json` still contains the previous build
- AND `refresh-meta.json` records the failing counters and marks the last
  refresh as failed.

#### Scenario: a collapsed producer edge is caught where it can still be seen

- WHEN the pre-build extraction contains two edges with different relations
  between the same ordered pair
- THEN `directed_same_endpoint_collapsed_edges` over that extraction is non-zero
- AND the refresh refuses to publish, naming the pair and the relations.

#### Scenario: the collapse counter is not gated where it cannot fail

- WHEN the candidate `graph.json` is diagnosed
- THEN no gate reads a collapse counter computed over that file
- AND `refresh-meta.json` records the stage at which each collapse counter was
  computed.

#### Scenario: a legitimate bidirectional pair does not block a merge

- WHEN the pre-build extraction contains both `u → v` and `v → u`
- THEN `undirected_same_endpoint_collapsed_edges` is non-zero and is recorded as
  an observation
- AND the refresh publishes.

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
with no lock, no health gate, no version stamp and no check that the artifact it
publishes preserved endpoint order.

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
