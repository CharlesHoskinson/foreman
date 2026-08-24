# Design: Graphify 0.9.48 qualification

## Boundary

Tranche 5 qualifies one external producer. It does not make Graphify a source
of truth and does not add a graph database. Source files, Git, the event log,
and release evidence remain authoritative. A missing, stale, disabled, or
invalid graph selects direct-source mode.

All new executable behavior is Node 24 TypeScript. Existing Bash maintenance
code may invoke the installed runtime, but it does not implement qualification.
The broad `lock-primitive-hardening` prerequisite is removed. This package owns
one narrow advisory lock in TypeScript, as required by the v0.4 governor.

## Measured concurrency defect

On 2026-08-24, two Graphify 0.9.48 container processes wrote disjoint one-file
corpora to the same output. Both exited zero. The final graph contained only
the second writer's `beta` nodes; the first writer's `alpha` nodes were absent.
The shrink guard did not fire. Therefore every Foreman publication uses one
repository-wide lock. Qualification reads remain lock-free.

## Pin and execution

`env/reference-manifest.toml` records Graphify 0.9.48 and the reference
interpreter. `graphify-out/.graphify_python`, when present, selects an explicit
local interpreter; otherwise the manifest value is used. The resolved path
must be absolute, regular, executable, and outside the candidate repository.
The child environment is closed and the observed version must equal the pin.

The live CLI builds into temporary directories. It runs code-only extraction
with one AST worker and no network or semantic backend. One raw extraction is
used for pre-build checks. Two complete candidates are then built from the same
commit and settings. The CLI normalizes ordered object keys and sorts nodes,
links, and hyperedges by their stable identities before byte comparison.

## Qualification

The pure qualifier checks:

- the exact producer version and source commit;
- zero input and output model tokens;
- identical normalized candidate bytes and health reports;
- closed graph shape and unique node identifiers;
- nonempty, repository-relative source locations on every source-backed node
  and link;
- explicit counts for Graphify external/import placeholder nodes and
  unlocated `dynamic_import` links, which 0.9.48 does not source-locate;
- endpoints that resolve to nodes;
- at least one descending ordered endpoint when links exist, which detects a
  writer that canonicalizes away producer direction;
- no duplicate ordered endpoint/relation tuple;
- no Graphify-reported dangling, missing, or non-object edges; and
- an explicit rename map derived from Git's rename records.

The graph's `directed` field is an observation, not a gate. Graphify 0.9.48
publishes a simple undirected NetworkX document but retains producer direction
in each link's source and target order. Parallel decision edges remain native
to Foreman's GraphStore and do not round-trip through this derived file.

## Publication and freshness

After qualification, the CLI acquires a lock under the common Git directory,
revalidates the candidate identity, and atomically replaces `graph.json` and
`refresh-meta.json`. A refusal leaves the previous pair unchanged. Metadata is
canonical JSON and binds the Graphify version, interpreter, commit, graph
digest, normalized digest, health digest, zero token counts, endpoint-order
count, source-file count, rename records, cadence, and timestamp.

Freshness does not require Graphify. The TypeScript freshness command reads Git,
the graph, and metadata. It distinguishes fresh, stale, unrelated, missing,
invalid, and last-refresh-failed states. Maintenance and CI may report this
result, but Graphify absence does not block ordinary Foreman operation.

## Deferred work

Semantic extraction, clustering labels, cohesion scoring, slow/nightly
cadences, and Neo4j/FalkorDB export are not v0.4 release requirements. They may
return only under a later package with explicit cost and evidence authority.
