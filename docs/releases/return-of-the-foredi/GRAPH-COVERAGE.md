# Graph coverage for the Return of the ForeDi

Status: advisory research graph. Code baseline: `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`. Research parent commit: `bbbdb7d670bd4b3e649866664f1e4aa83b38882d`. New source hashes identify the uncommitted planning additions.

The graph inventories all 1,917 tracked baseline files and 268 captured or authored research files.
It contains 22,945 nodes and 53,969 directed edges across 1937 communities.
The HTML uses an aggregated community view because the graph exceeds 5,000 nodes.

## Coverage

| Layer | Coverage | Meaning |
| --- | --- | --- |
| First-party code | 522 files | AST extraction, including one intentionally invalid fixture with partial coverage. |
| Vendored code | 62 files | Separate AST extraction, including extensionless Bash scripts. |
| Unsupported first-party code | 77 files | Inventory only: Bats, Quint, HTML, CSS, and Dockerfiles. |
| Unsupported vendored code | 2 files | Inventory only: HTML and CMD. |
| Generated bundles | 27 files | Inventory only. Generated code is not source authority. |
| Baseline Markdown | 807 files | Headings and explicit links. Claims were not all semantically reviewed. |
| Baseline text documents | 40 files | Inventory only unless selected by a semantic research fragment. |
| Newly captured sources | All files present under `docs/research/pel-release/sources/` at build time | Hash-bound file nodes. Selected claims link to their source files. |
| New Markdown | 106 files | Structural extraction and exact source-path mentions. |
| ForeDi catalog | 36 features, 125 requirements, 127 planned tests | Exact declared traceability edges and future test location references. |
| Pel research | `pel-semantic.json` | Selected source-grounded semantic claims. |
| Model research | `models-semantic.json` | Selected source-grounded semantic claims with availability limits. |

The source inventory includes plugin README, manifest, release metadata, and installation receipt.
A file node establishes coverage of that file's identity. It does not establish full semantic understanding.
The source capture set is bounded to the selected paper and provider documentation pages.
It is not an exhaustive crawl of every provider documentation page.

## Integrity and authority

The first-party raw AST emitted 1,554 dangling import edges.
The graph preserves these references with explicit unresolved-reference nodes.
Such a node does not assert that its target declaration exists or that an import resolves.
The combined build added 447 further unresolved-reference nodes from other fragments.

The raw aggregate contains 65 duplicate node records across 64 IDs.
Graphify reports 717 exact duplicate edges, 42 self-loops, and 1,306 directed edge collapses.
After reference preservation, dangling endpoints: 0. Missing endpoints: 0.
The rendered graph combines repeated node IDs and edges with identical endpoints.
The compressed raw extraction preserves every producer record for inspection.

Do not infer dependency absence from this graph. Confirm deletion decisions with direct source searches and tests.
Architecture edges from new plans represent explicit file mentions. They are not runtime dependency claims.
Historical source content remains historical even when it connects to current code.

The canonical `graphify-out/graph.json` and `refresh-meta.json` remain unchanged.
Their qualifier requires Graphify 0.9.48. This graph uses 0.9.61 and is not qualified publication evidence.

## Token accounting

Host semantic extraction token usage is unknown because the host did not expose per-fragment metering.
Deterministic AST extraction and graph construction make no model calls.
Do not report the full build as zero-cost or zero-token semantic extraction.

## Artifacts

- `graphify-out/foredi-release/graph.json`: combined advisory graph.
- `graphify-out/foredi-release/graph.html`: aggregated interactive graph.
- `graphify-out/foredi-release/GRAPH_REPORT.md`: graph analysis.
- `graphify-out/foredi-release/raw-extraction.json.gz`: complete producer extraction before graph collapse.
- `graphify-out/foredi-release/source-files.json`: source file hashes and coverage classes.
- `graphify-out/foredi-release/health.json`: integrity diagnostics.
- `graphify-out/foredi-release/duplicate-node-ids.json`: repeated node identities.
- `graphify-out/foredi-release/research-meta.json`: build identity, counts, and token limitations.
