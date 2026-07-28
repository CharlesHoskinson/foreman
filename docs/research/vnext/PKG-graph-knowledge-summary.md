# PKG summary — knowledge plane and its consumption (GP-3, GP-5)

**Written:** 2026-07-28. **Branch:** `plan/v029-graph-multivendor`.
**Packages:** `openspec/changes/knowledge-plane-refresh/`,
`openspec/changes/graph-context-builder/`.
Both validate: `openspec validate <change> --strict` → *is valid*.
Format follows `lock-primitive-hardening` (`## ADDED Requirements` →
`### Requirement:` → `#### Scenario:`), which is the shape the CLI parses.

---

## GP-3 `knowledge-plane-refresh` — capability `graphify-integration`

Automates the AST refresh of `graphify-out/graph.json` and makes the artifact
self-describing. Ten added requirements plus one modified:

1. Automatic AST-only refresh per merge, with a **zero-token assertion** read
   from `cost.json` before and after (the committed graph was built at
   `0 input · 0 output`; the GraphRAG-family community-refresh analogue is
   ~14M tokens, so nothing LLM-priced may enter the per-commit path).
2. **`--directed` mandatory.** The committed graph is
   `directed: false, multigraph: false` with 0 duplicate `(source, target)`
   pairs across 3,668 links. A non-zero collapsed-edge counter is treated as
   proof the mandate was bypassed, and the refresh refuses to publish.
3. **One pinned interpreter, one pinned version, stamped into the output.**
   Three graphify versions coexist on the reference box (0.9.16 on `PATH`,
   0.9.18 under `python3`, 0.9.15 in the skill), and `maintenance.sh:249-289`
   currently picks whichever it finds first. `graph.json` records
   `built_at_commit` and no version, so the stamp goes in a new committed
   sidecar `graphify-out/refresh-meta.json`.
4. **Single-writer rule.** graphify has exactly one lock (`watch._rebuild_lock`,
   POSIX-only) which `extract`, the skill pipeline and every export ignore.
   Concurrent writers are last-writer-wins, and the shrink guard only fires when
   the loser's graph is *smaller* — two lanes adding disjoint nodes both pass.
   Foreman owns the mutex via `lib/lock.sh`.
5. **Health gate** on `diagnose multigraph --json --directed`, run against the
   published artifact rather than the pre-build extraction dict; publish-or-
   refuse, leaving the previous graph intact.
6. **Cohesion captured before cleanup** — it exists only in
   `.graphify_analysis.json`, which the skill's Step 9 deletes.
7. **Freshness contract**, checkable with git + `jq` alone so CI can enforce it
   on a host that cannot run graphify (`maintenance.yml:23` already says CI
   lacks it). Today: 3 commits behind, 26 files entirely unrepresented.
8. **Rename-with-lineage** from `git diff --find-renames`, because a file move
   re-IDs the file node and every symbol in it.
9. **Slow cadence** for semantic/cluster/label work, marked advisory and barred
   from grounding any gate decision.
10. **The cypher/neo4j/falkordb path is banned** — `to_cypher` emits five values
    and drops the entire audit trail. `graph.json` is the only supported source.
11. *(MODIFIED)* `maintenance.sh run_graph` delegates to the new
    `graph-refresh.sh` and loses its candidate-interpreter loop.

Depends on `lock-primitive-hardening`. Consumed by GP-4 and GP-5. Touches no
store.

---

## GP-5 `graph-context-builder` — capability `consumption`

The pre-serialized, hashed, budgeted context block. Twelve added requirements:

1. **Pre-serialized host-side, not traversal** (89.80 vs 82.6 WebQSP Hit at
   1/6–1/8 the calls, and a traversal is unhashable).
2. **Edge identity minted by the builder** — `graph.json` edges have no `id`.
   Durable `edge_key` = truncated sha256 over source/target/relation/
   source_file/source_location, plus a short in-block alias; the alias table is
   inside the content hash.
3. **2-hop bounded candidates over a role-scoped allowlist, then ranked.** Never
   the k-hop closure; no PPR ("fails to reliably yield improvements"), no GNN
   ("performance degradation compared to their MLP counterparts").
4. **Budget** 2,000 tokens ≈ 145 edges, floor 40, hard cap 4,000/290; zero seeds
   → `NO GRAPH CONTEXT` with no fallback subgraph.
5. **Fixed layout** — task first and last, subject grouping, best group last,
   conflicts in a separately headed labelled block of ≤10 outside the budget.
6. **Citation contract in-context at generation time** with a worked demo
   (post-hoc attachment collapses recall 73.6 → 26.7).
7. **Never summarise the served edges** (−8 to −15 citation precision).
8. **Deterministic post-verification** — `HALLUCINATED_EDGE_ID`,
   `OUT_OF_CONTEXT_CITATION`, `UNSUPPORTED_CLAIM`, exact lookups only.
9. **Absence by query, never by model reading** (disconnected-node accuracy
   0.5% zero-shot, ≈0.0% otherwise).
10. **Content-hashed, persisted, replayable**; the auditor is served the same
    bytes.
11. **MCP as a bounded read-only escape hatch** behind a wrapper that does the
    mandatory vocabulary expansion, returns JSON not prose, caps at ~40 edges,
    and fails loudly on zero recall.
12. **Files only — `graph.json` + `worklog.jsonl` + run-dir JSON.** No store
    dependency; the boundary is a deliverable, checked in the gate task.

Depends on GP-3 and GP-4, explicitly **not** GP-6. Feeds GP-7's sweeps.
Claims citation precision and multi-hop outcomes; does not claim reduced
hallucination.

---

## The three most challengeable requirements

1. **GP-3: a refresh that runs and fails BLOCKS the merge gate.** A structural
   health counter now stops merges. The counter-argument is that graph health is
   not code health and should warn. The package's answer: a refresh that was
   working and now fails is a real defect, whereas a host that cannot refresh at
   all records `SKIPPED` with the measured drift and does not block. Reviewers
   will want that asymmetry re-argued.
2. **GP-3: `--directed` as a hard refusal, landing as a large one-off diff.**
   The first directed refresh changes the committed artifact substantially, and
   every downstream consumer keyed on the undirected shape sees new edges. The
   justification (parallel typed edges are silently collapsed today) is sound,
   but the migration cost is real and lands in one commit.
3. **GP-5: 2,000 tokens / 145 edges as the default budget.** The knee it is
   derived from was measured on Freebase KGQA with short triples; Foreman edges
   carry longer free-text objects, so our knee is almost certainly at fewer
   edges. The design says so and attaches a sweep, but shipping an inherited
   number as a default is the single most attackable choice in either package.

Runners-up, in case review goes deeper: minting `edge_key` ourselves rather than
asking upstream for stable edge IDs; and the claim that `truncated == true`
predicts when the escape hatch helps, which is untested and instrumented rather
than assumed.
