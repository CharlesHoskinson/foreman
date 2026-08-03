# Change: knowledge-plane-refresh

## Why

The knowledge plane already exists in this repo, and it is refreshed by hand.

`graphify-out/graph.json` is 2.63 MiB — 3,579 nodes, 3,668 links, 6 hyperedges —
stamped `built_at_commit: d4af3a92`, built 2026-07-19. `GRAPH_REPORT.md:10`
records the cost of that build: **`Token cost: 0 input · 0 output`**. 3,499 of
3,579 nodes carry `_origin: "ast"`. The knowledge plane is, today, a
deterministic, zero-token artifact. That is the property this package exists to
protect and to automate.

**It is stale, and the staleness is invisible.** HEAD is three commits past
`d4af3a92`. `git diff --stat d4af3a92..HEAD` is 34 files changed, of which
**26 files are brand new and therefore entirely absent from the graph** —
including all six v0.2.9 WSL change packages and both v0.2.9 planning documents.
Coverage is 358 of 471 tracked files. Nothing in the repo notices.

The only automation is `skills/foreman/scripts/maintenance.sh:249-289`
(`run_graph`), and it has four defects that this package fixes:

1. **It picks whichever graphify it finds.** It loops `python3`, then `python`,
   takes the first that can `import graphify`, but prefers a bare `graphify` on
   `PATH` if one exists. On the reference box those are **different packages**:
   `graphify` on `PATH` is **0.9.16** (uv tool, py3.13), `python3 -c "import
   graphify"` is **0.9.18** (dist-packages, py3.14), and the installed
   `SKILL.md` is **0.9.15**. `graphify --help` emits the mismatch warning
   itself, twice. Three code paths, one repo, and the artifact records none of
   them: `graph.json` carries `built_at_commit` and **no `graphify_version`**.
2. **Nothing checks that direction survived, and nothing can check it where
   the old draft looked.** The committed graph is
   `"directed": false, "multigraph": false`. Measured against the pinned
   graphify 0.9.16, no CLI cadence can change that field: `graphify update`
   rejects `--directed` (exit 2) and `graphify extract` never passes the
   keyword, so gating on `"directed": true` would refuse every merge. Direction
   is nonetheless in the artifact — `to_json` restores the producer endpoints,
   and 1,465 of 3,668 links are in descending endpoint order — so the check
   that belongs on the artifact is the endpoint-order count, and consumers
   reconstruct direction at load with `build_from_json(raw, directed=True)`.
   graphify's collapse counters
   (`directed_same_endpoint_collapsed_edges` /
   `undirected_same_endpoint_collapsed_edges`) still matter for the
   silent-corruption class, but only over the **pre-build extraction**: on a
   post-build `graph.json` they measured 0 on a file where an edge had already
   been discarded. Nothing runs them anywhere today.
3. **It takes no lock.** graphify contains exactly one lock in the entire
   package — `watch._rebuild_lock`, a POSIX-only `fcntl.flock` taken by
   `graphify watch`, the git hooks, and interactive `graphify update`. It is
   **not** taken by `graphify extract`, by the skill pipeline (which writes
   `graph.json` through raw `to_json`), by `cluster-only`, by `label`, or by any
   `export`. Two writers are last-writer-wins: `write_json_atomic` guarantees no
   torn file and no more. The shrink guard (#479) is the only remaining
   protection, and **it only fires when the loser's graph has fewer nodes** — so
   two lanes each adding disjoint nodes both produce larger graphs, both pass
   the guard, and the second silently discards the first's work with no warning.
4. **It runs in CI only as a no-op.** `.github/workflows/maintenance.yml:23`
   runs `maintenance.sh --stage upstream` only, with the in-file comment *"CI
   lacks Graphify and developer CLIs, so only upstream drift is meaningful
   here."* The graph stage never runs in CI, so no automated surface ever
   observes the drift.

Two more findings shape the design rather than motivating it:

- **The `cypher.txt` export path destroys the audit trail.** `to_cypher` — what
  `graphify export neo4j` and `graphify export falkordb` write — emits **five
  values total**: node `id`, node `label`, node `:file_type` label, edge
  relation, edge `confidence`. It drops `source_file`, `source_location`,
  `confidence_score`, `weight`, `context`, `rationale`, `verification`,
  `metadata`, every hyperedge, `community`, and `built_at_commit`. `graph.json`
  is strictly the highest-fidelity artifact graphify produces.
- **Cohesion scores escape every path.** They exist only in
  `graphify-out/.graphify_analysis.json`, which the skill's Step 9 deletes at
  the end of every run. Confirmed on this box: `graphify-out/` holds
  `graph.json` and `GRAPH_REPORT.md` and nothing else.

And the cadence is settled by cost. The GraphRAG-family analogue of a community
re-summarisation on a corpus change is measured at **~14M tokens** (1,399
communities × 2 × ~5,000). A repository changes on every commit. The per-commit
path must stay AST-only, forever.

## What changes

- **New `skills/foreman/scripts/graph-refresh.sh`** — the single supported entry
  point for every write to `graphify-out/`. It resolves one pinned interpreter
  and one pinned graphify version, takes the Foreman graph lock, runs the
  AST-only incremental update (`graphify update`), runs the health diagnostic,
  publishes only on a pass, and writes the metadata sidecar. Two modes:
  `--cadence merge` (AST only, asserted zero-token) and `--cadence slow`
  (semantic extraction, clustering and community labels).
- **Interpreter and version pinning.** `graphify-out/.graphify_python` (already
  graphify's own convention) plus a `[graphify]` block in
  `env/reference-manifest.toml` naming the required version. A resolved version
  outside the pin is a refusal, not a warning.
- **`graphify-out/refresh-meta.json`** — a new committed sidecar carrying
  `graphify_version`, the resolved interpreter, `built_at_commit`, the observed
  `directed` field and endpoint-order count, the cadence, the health counters
  stamped with the stage each was computed at, the cohesion map lifted out of
  `.graphify_analysis.json` before cleanup, and the refresh timestamp.
  `graph.json` cannot carry these: `graphify update .` rebuilds it from the
  filesystem and would destroy anything injected.
- **Single-writer discipline.** Every graphify write acquires the Foreman graph
  lock through `lib/lock.sh` (from `lock-primitive-hardening`). Readers — the
  MCP server, `query`, `path`, `explain`, the context builder — do not.
- **Health gate, staged so every check can fail.** `graphify diagnose
  multigraph --json` runs on every refresh against the candidate artifact, where
  `dangling`, `missing` and `non-object` are gate signals. The collapse counters
  run against the **pre-build extraction** — the AST-cache union on the merge
  cadence — because on a post-build `graph.json` they are 0 by construction; a
  non-zero `directed_same_endpoint_collapsed_edges` there is a hard failure. The
  candidate is additionally refused if no link is in descending endpoint order,
  which is what a canonicalising writer produces.
- **Freshness contract.** `built_at_commit` must be an ancestor of `HEAD`, and
  the drift (commits behind, files unrepresented) is measured and reported by a
  check that needs no graphify installed — so CI can enforce the contract on a
  host that cannot perform the refresh.
- **Rename-with-lineage.** graphify node IDs are path-derived, so a file move
  re-IDs the file node and every symbol in it. The refresh emits an explicit
  `renames` map from `git diff --find-renames` so downstream consumers see a
  rename, not a delete plus a create.
- **The `export neo4j` / `export falkordb` / `cypher.txt` path is banned** in
  Foreman code, docs and CI. `graph.json` is the only supported source of truth
  for downstream consumers.
- **`maintenance.sh run_graph` is rewritten to delegate** to
  `graph-refresh.sh`; its ad-hoc interpreter loop is deleted.
- **`.github/workflows/maintenance.yml`** gains the freshness check (which does
  not require graphify) while continuing not to attempt the refresh itself.

## Impact

- Affected: `skills/foreman/scripts/maintenance.sh` (`run_graph`, `:249-289`),
  `env/reference-manifest.toml`, `.github/workflows/maintenance.yml`,
  `.gitignore` (so `refresh-meta.json` is tracked while `.graphify_*` stays
  ignored), `skills/foreman/SKILL.md:87-91` and `README.md:595-605` (both state
  the graph doctrine and both must name the refresh command that now exists).
- New: `skills/foreman/scripts/graph-refresh.sh`,
  `skills/foreman/scripts/graph-freshness.sh`, `tests/graph-refresh.bats`,
  `graphify-out/refresh-meta.json`.
- **Depends on `lock-primitive-hardening`.** The single-writer rule is built on
  `lib/lock.sh`; building it on the current `mkdir` primitive would inherit a
  mutex measured to admit 57 occupancy violations in 15 rounds of 8 racers.
- **Consumed by `work-dag-projection` (GP-4)** — the join keys are graphify node
  IDs, and the projection is only sound if the IDs it references were produced
  by a known graphify version at a known commit.
- **Consumed by `graph-context-builder` (GP-5)** — the context builder reads
  `graph.json` and stamps `refresh-meta.json`'s freshness into every block.
- **Does not depend on `graph-store-port` (GP-6).** Nothing here reads or writes
  the SQLite ontology. Changes to its adapter do not affect this package.
- Behaviour change: a refresh that fails its health gate publishes nothing and
  leaves the previous `graph.json` in place. Today a failing extraction can
  still overwrite the artifact, guarded only by the shrink guard.
- Out of scope, deliberately: writing work-DAG records into `graph.json` (they
  would be destroyed by the next `--update`; that is GP-4's `worklog.jsonl`),
  ingesting `graph.json` into any database (GP-6), and any change to graphify
  itself. Every seam used here is external — read `graph.json`, do not fork.
