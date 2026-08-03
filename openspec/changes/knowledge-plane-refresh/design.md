# Design — knowledge-plane-refresh

## The shape: one entry point, two cadences, one lock

Everything that writes `graphify-out/` goes through `graph-refresh.sh`. That is
the whole design; the rest is the discipline it enforces.

```
                     graph-refresh.sh
                            │
        ┌───────────────────┴───────────────────┐
        │ --cadence merge                       │ --cadence slow
        │ (post-merge, per-release checkpoint)  │ (nightly / pre-release)
        ▼                                       ▼
  resolve pin (interpreter + version)     resolve pin
  acquire fm graph lock                   acquire fm graph lock
  graphify update (AST only, undirected)  graphify extract / cluster / label
  assert 0 input + 0 output tokens        record token cost, mark advisory
  collapse counters over the pre-build    collapse counters over the cadence's
  AST-cache union (gate)                  extraction dict (gate)
  dangling/missing/non-object over the    same three counters over the
  candidate artifact (gate)               candidate artifact (gate)
  endpoint-order count (gate)             endpoint-order count (gate)
  publish or refuse                       publish or refuse
  lift cohesion sidecar                   lift cohesion sidecar
  write refresh-meta.json                 write refresh-meta.json
```

The two cadences differ in exactly one way that matters: the merge cadence is
**deterministic and evidential**; the slow cadence is **LLM-priced and
advisory**. Community labels, cluster membership and semantic concept nodes are
never allowed to be evidence for a gate decision, because they are produced by a
model whose self-explanations are measured unstable. The merge cadence's output
is allowed to be evidence, because it is an AST parse.

## Why direction is a load-time property, not a field to gate on

The first draft of this package mandated `--directed` on every invocation and
gated publication on `graph.json`'s `directed` field. Both halves were measured
false against the pinned graphify 0.9.16:

- `graphify update` rejects `--directed` (`cli.py:1250`, exit 2) and builds via
  `build_from_json(result)` with no keyword (`watch.py:1050`);
  `graphify extract` calls `build([merged], …)` with no keyword
  (`cli.py:2551`). `--directed` exists only on `diagnose multigraph`
  (`cli.py:831`), where it simulates direction over an already-built document.
  **No CLI cadence can emit `"directed": true`**, so the gate refused every
  merge — the two requirements were jointly unsatisfiable.
- Even when it is `true`, it does not entail edge survival:
  `build_from_json(..., directed=True)` returns a `DiGraph`, not a
  `MultiDiGraph` (`build.py:490`), and the two-parallel-edge fixture yields one
  edge.

What is actually true is better: **direction is in the data regardless of the
field.** The build stashes producer endpoints as `_src`/`_tgt` and `to_json`
restores them into every link (`export.py:305-311`). Measured — an undirected
build of `zeta → alpha` exports as `zeta → alpha`; the historical baseline
graph built at `d4af3a92` has 1,465 of 3,668 links whose `source` sorts after
its `target`, and a re-extracted 208-file subset has 1,041 of 2,531. A
canonicalising writer would produce
exactly zero. So the gate that replaces the `directed` field is the
**endpoint-order count**: zero-with-links is a refusal, and it is the shape of
failure the old gate was reaching for.

Consumers get direction the way graphify's own readers get it: load with
`build_from_json(raw, directed=True)`, exactly as `path`, `explain`, `serve` and
`affected` do by forcing `{"directed": True}`. Verified on the committed
artifact: a `DiGraph` of 3,579 nodes and 3,668 edges with `has_edge(u, v)` true
and `has_edge(v, u)` false on sampled descending pairs.

Parallel typed edges — `SUPPORTS` and `CONTRADICTS` between the same ordered
pair — are therefore store-native and never round-trip through `graph.json`.

## Why the version stamp lives in a sidecar and not in `graph.json`

Graphify rebuilds `graph.json` from the filesystem. `graphify update .` handles
code-only changes to an existing semantic corpus; `graphify extract .` handles
documentation or mixed changes. Anything Foreman injects into the graph is
unspecified under the next refresh — this is the same mechanism that keeps the
work-DAG out of `graph.json` (GP-4). So the stamp goes in a sibling file that
Graphify does not own.

The stamp matters because node IDs are path-derived and **a graphify upgrade can
migrate the whole ID space**. That has already happened once upstream: #1504
widened the file stem from immediate-parent to full path, which changed every
colliding ID in the corpus. If a downstream consumer's foreign keys break, the
first question is "which version produced this graph", and today the artifact
cannot answer it. `built_at_commit` gives git lineage for free; nothing gives
tool lineage.

## Alternatives REJECTED

**Pin nothing; keep `run_graph`'s "first interpreter that imports graphify".**
Rejected. On the reference box that resolves to three different packages
depending on which branch of the loop wins: 0.9.16 on `PATH`, 0.9.18 under
`python3`, 0.9.15 in the skill. The tool warns about the mismatch and the
current code ignores the warning. A knowledge plane whose producer is
nondeterministic cannot support the ID-stability claim that GP-4's join keys
rest on.

**Do the refresh in GitHub Actions.** Rejected, and the repo already knows why:
`maintenance.yml:23` carries the comment *"CI lacks Graphify and developer CLIs,
so only upstream drift is meaningful here."* Installing graphify in CI would
also mean pinning a Python toolchain in CI to match the host pin, and would put
an LLM-capable extractor one config error away from the per-commit path. The
division adopted instead: **the host refreshes, CI enforces the contract.** The
freshness check is `git merge-base --is-ancestor` plus a `git diff --name-only`
count against the graph's `source_file` set — pure git and `jq`, no graphify.

**Rely on graphify's own `watch._rebuild_lock`.** Rejected. It is real and it is
correct — a POSIX `fcntl.flock` with a pending-work queue (#1059) so a
lock-losing rebuild does not drop its change set — but it is taken by exactly
three call sites (`watch`, the git hooks, interactive `update`) and by nothing
else. `graphify extract`, the entire skill pipeline, `cluster-only`, `label` and
every `export` ignore it, and on Windows `fcntl` is absent so it degrades to an
unconditional `yield True`. Foreman must own the mutex because Foreman is the
one that knows when a lane is writing.

**Rely on the shrink guard as concurrency protection.** Rejected, and this is
the sharpest point in the package. The shrink guard (#479) refuses to overwrite
when the new graph has fewer nodes than the existing one. Two lanes each adding
disjoint nodes both produce *larger* graphs. Both pass. The second silently
replaces the first. The guard is a data-loss backstop for partial-chunk
overwrites, not a mutual-exclusion primitive, and treating it as one is the
failure this package removes.

**Use `graphify export neo4j` / `falkordb` as the downstream seam.** Rejected
outright and banned. `to_cypher` is twelve lines and emits five values. Every
provenance field this release exists to preserve — `source_file`,
`source_location`, `confidence_score`, hyperedges, communities, `rationale`,
`verification`, `built_at_commit` — is dropped. The direct-push variants are
better but still drop hyperedges entirely, drop any non-scalar attribute
(`metadata`, present on 472 of 3,579 nodes), and filter `_`-prefixed keys, which
removes the `_src`/`_tgt` true-direction markers and reintroduces the #563
direction inversion the JSON path fixes. GraphML is the highest-fidelity
built-in and still loses cohesion and `_origin`.

**Fork graphify to add a Foreman exporter.** Rejected. There is no exporter
interface: `graphify/exporters/base.py` is fourteen lines containing a colour
palette, and `export` dispatch is a hardcoded allowlist tuple plus an if/elif
chain in `cli.py`. Adding a backend requires a fork or an upstream PR. It is
also unnecessary — `graph.json` is a plain, fully-specified, atomically-written
NetworkX document, and reading it externally gets strictly more fidelity than
any built-in export at zero coupling.

**Run semantic extraction or community labelling per commit.** Rejected on
cost. The measured analogue is ~14M tokens to regenerate a community structure
on a corpus change (1,399 communities × 2 × ~5,000 tokens). Foreman's corpus
changes hourly. The merge cadence therefore asserts zero tokens rather than
merely intending them: `cost.json` is read before and after, and a non-zero
delta on the merge cadence is a failure.

**Block the merge gate whenever the graph is stale.** Rejected as specified,
adopted in a narrower form. Blocking on staleness would make every host without
graphify unable to merge, and the honest state today is that the graph has been
three commits stale for over a week with no consequence. The rule adopted is:
a refresh that *runs and fails* blocks (that is a real defect in a system that
was working); a refresh that *cannot run* records `SKIPPED` with the measured
drift and does not block; and the measured drift is stamped into every artifact
built from that graph, so a consumer can decide for itself. Staleness becomes
visible everywhere instead of blocking in one place.

**Model file moves as delete-plus-create.** Rejected. IDs are
`normalize(path_without_extension + "_" + symbol)`, stable across content edits,
machines, checkouts and Unicode variance — but a file move re-IDs the file node
*and every symbol in it*. Emitting that as deletions and creations destroys the
lineage that makes "which findings recur" answerable. `git diff --find-renames`
already computes the mapping; the refresh records it.

## What the health gate can and cannot tell you

`diagnose_extraction` is read-only and never aborts. It counts
`non_object_edges`, `missing_endpoint_edges`, `dangling_endpoint_edges`,
`self_loop_edges`, `valid_candidate_edges`,
`directed_same_endpoint_collapsed_edges`,
`undirected_same_endpoint_collapsed_edges` and `unverified_node_count`. Two
honest limits, both of which the spec accounts for:

- The counters do not all mean something at the same stage, and this is the
  defect that survived the first fix round. `dangling_endpoint_edges`,
  `missing_endpoint_edges` and `non_object_edges` are meaningful **on the
  artifact** (measured: 0 as published, 2 after removing a node and keeping its
  edges — the corruption `prune_dangling_edges` repairs). The collapse counters
  are **not**: the build discards the duplicate producer edge before the file is
  written, so `directed_same_endpoint_collapsed_edges` measured 0 on a file
  where an edge had just been dropped, and graphify says so itself — *"A normal
  graph.json is already post-build and cannot recover raw producer edges"*.
  They are therefore computed over the **pre-build extraction**: on the merge
  cadence, the union of `graphify-out/cache/ast/v<pin>/*.json`, where seeding one
  parallel typed edge moves the counter 0 → 1. Only the *directed* collapse
  counter is a gate there; the undirected one measured 1 on a healthy corpus
  (legitimate `u → v` + `v → u`) and the union's `dangling` measured 76
  (cross-file endpoints are resolved at merge time), so both are recorded, not
  gated.
- The counters detect structural corruption, not semantic error. A graph can be
  perfectly connected and completely wrong. The gate is a corruption detector
  and is documented as one; correctness of the corpus is not its job.

There is also a known caution worth writing down rather than discovering: richer
extraction is measured to produce *worse-connected* graphs (72.51% and 69.71%
non-isolated for the richest extractors versus ~90% for plain ones) because
richer extraction "inevitably introduces more noise". Connectivity is therefore
reported as a first-class number in `refresh-meta.json`, not inferred from the
node count.

## Risks

- **The pin will drift from upstream.** Pinning a version means a deliberate
  upgrade step, and upgrades can migrate the ID space (#1504). Mitigation: the
  version is in the manifest with the date and the reason; an upgrade runs a
  full rebuild and diffs the ID sets, and that diff is the upgrade's evidence.
- **The collapse gate reads a private cache layout.**
  `graphify-out/cache/ast/v<version>/` is graphify's own AST cache
  (`cache.py:340-360`), not a published interface. The version pin is what makes
  reading it safe; a pin bump has to re-verify the layout before the gate can be
  trusted again, and that step belongs in the upgrade procedure alongside the
  ID-space diff.
- **The endpoint-order gate is a heuristic with a measured margin.** It refuses
  when a candidate has links but none in descending endpoint order. Both
  measured corpora sit near forty per cent, so the margin is large, but a very
  small or unusually named corpus could in principle be all-ascending and be
  refused. The count is reported with the refusal so the operator can see it,
  and refusing is the safe direction.
- **The lock is on the hot path for lanes that touch the graph.** Mitigated by
  scope: only writes take it, and the merge cadence is one process per merge,
  not one per lane.
- **A refusal-to-publish leaves the previous graph in place.** That is the
  desired failure mode, but it means a persistently failing refresh looks like a
  merely stale graph. Mitigation: the failure is recorded in
  `refresh-meta.json` with its counters and the freshness check reports
  `last_refresh_failed` distinctly from `stale`.
- **Zero-token assertion depends on `cost.json`, which is gitignored** and does
  not exist in a fresh checkout. The refresh must treat an absent `cost.json` as
  a baseline of zero and create it, not as a reason to skip the assertion.
- **The concurrency conclusion is code-derived, not experimentally reproduced.**
  The upstream reading says two writers are last-writer-wins and the shrink
  guard does not catch disjoint additions; nobody has run the race. The tasks
  include running it, because a package whose central claim is unmeasured should
  measure it before it ships.
