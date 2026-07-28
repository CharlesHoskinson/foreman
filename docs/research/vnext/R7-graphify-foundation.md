# R7 — graphify as the Foundational Substrate

**Lane:** R7 (Foreman v0.2.9 vnext research swarm)
**Scope:** the graphify *tool* — its documented surface, its real schema, its capabilities, its limits, and the export/ingest seam to a versioned store.
**Date:** 2026-07-28
**Out of scope (owned elsewhere):** R5 owns this repo's committed `graphify-out/` artifacts + event-log join; R4 owns graph-memory SOTA + gap analysis; R8 owns TerminusDB.

Every claim below is labelled **VERIFIED-code** (read from the installed source), **VERIFIED-docs** (read from graphify.net / GitHub / the shipped SKILL.md), or **INFERRED**.

---

## 0. Executive summary

graphify is a **local, deterministic-first extraction engine** that turns a folder into `graphify-out/graph.json` (a NetworkX `node_link_data` document) plus a community partition, a markdown report, and an MCP server. It is *not* a database. It has no transactions, no history, no branches, no multi-writer story, and no plugin API. Its extraction layer is genuinely strong (25+ language tree-sitter AST pass, EXTRACTED/INFERRED/AMBIGUOUS provenance on every edge, path-derived deterministic node IDs). Its persistence layer is a single JSON file protected by an atomic rename and a shrink guard.

That split maps exactly onto the two-layer architecture the swarm is converging on: **graphify = extraction layer; versioned store = store layer.** The two highest-value findings for that decision are:

1. **Node IDs are stable across rebuilds** (path+symbol derived, content-independent) — external references survive re-extraction. See §9.
2. **Provenance survives to GraphML in full, survives to a live Neo4j/FalkorDB push only partially, and is largely DESTROYED by the file-based `cypher.txt` export.** A naive `graphify → cypher.txt → store` pipeline silently loses the entire audit trail. See §8. **This is the critical finding.**

---

## 1. Sources fetched

### 1.1 Local installation (VERIFIED-code)

| Artifact | Path | Version |
|---|---|---|
| Package under `python3` | `/usr/local/lib/python3.14/dist-packages/graphify/` | **graphifyy 0.9.18** |
| `graphify` binary on PATH | `/root/.local/bin/graphify` → `/root/.local/share/uv/tools/graphifyy/bin/python` | **0.9.16** |
| Installed skill (global) | `/root/.claude/skills/graphify/SKILL.md` (38 220 B) | **0.9.15** (`.graphify_version`) |
| Installed skill (repo copy) | `/root/foreman/skills/graphify/SKILL.md` | byte-identical to global (`diff` clean) |
| Skill references | `references/{extraction-spec,query,update,exports,hooks,github-and-merge,add-watch,transcribe}.md` | read in full |
| Live graph sample | `/root/foreman/graphify-out/graph.json` (2 761 285 B, 3 579 nodes / 3 668 links / 6 hyperedges) | schema-sampled only (R5 owns analysis) |

### 1.2 Upstream (VERIFIED-docs)

| Source | Status |
|---|---|
| `pip show graphifyy` — homepage `https://github.com/safishamsi/graphify`, MIT, © 2026 Safi Shamsi | OK |
| `raw.githubusercontent.com/safishamsi/graphify/main/README.md` | OK (7 106 B) |
| `raw.githubusercontent.com/safishamsi/graphify/main/CHANGELOG.md` | OK (HTTP 200) |
| `gh api repos/safishamsi/graphify` — 97 520 stars, 674 open issues, pushed 2026-07-28T09:52:46Z | OK |
| 26 referenced upstream issues resolved by number via `gh api` (see §7.3) | OK — all 26 **closed** |

### 1.3 graphify.net — full crawl

Crawled from `sitemap.xml` (429 URLs total). Excluded by design: 200+ `/repo/<owner>-<repo>/` generated pages, `/mcpservers/`, `/ai-coding-tools/`, `/compare/`, `/authors/`, `/page/N` paginators, and the five i18n mirrors (`/hk/ /kr/ /tw/ /vn/ /zh/` — verbatim translations of the six English `.html` docs). **153 English pages fetched, 153 OK, 0 failures.** Saved under `/tmp/graphify-docs/pages/`, manifest at `/tmp/graphify-docs/manifest.tsv`.

The six canonical product-doc pages are:

- `https://graphify.net/graphify-cli-commands.html`
- `https://graphify.net/knowledge-graph-for-ai-coding-assistants.html`
- `https://graphify.net/tree-sitter-ast-extraction.html`
- `https://graphify.net/leiden-community-detection.html`
- `https://graphify.net/graphify-claude-code-integration.html`
- `https://graphify.net/graphify-vs-alternatives.html`
- (plus `https://graphify.net/skills/graphify/` — the skill directory entry)

**Material finding about the site:** graphify.net is overwhelmingly an SEO content farm for AI-coding tooling (~140 of 153 pages are blog/comparison articles), not a product documentation site. The actual product docs are seven thin pages totalling ~50 KB. **The site is not a usable source of truth** — see §3 for the drift it carries. The full 153-row manifest is appended in §13.

---

## 2. Documented capability surface

### 2.1 Pipeline shape (VERIFIED-docs, SKILL.md)

`detect → (transcribe) → extract [AST ∥ semantic] → build → cluster → analyze → report → export`, with a `graph-health` read-only gate between build and label.

The skill is **agent-driven, not CLI-driven** on the default path: `/graphify` makes the *host agent* orchestrate ~9 shell steps, dispatching `general-purpose` subagents for semantic extraction. `graphify extract` is the headless CI equivalent.

### 2.2 CLI surface (VERIFIED-code, `graphify --help` on 0.9.16)

Verbatim command groups:

```
install / uninstall [--platform P] [--purge]
path "A" "B"                 --graph
explain "X"                  --graph
diagnose multigraph          --graph --json --max-examples N --directed --undirected --extract-path
clone <github-url>           --branch --out
merge-driver <base> <current> <other>          # git merge driver for graph.json
merge-graphs <g1> <g2> ...   --out
add <url>                    --author --contributor --dir
watch <path>
update <path>                --force (or GRAPHIFY_FORCE=1) --no-cluster
cluster-only <path>          --no-viz --graph --no-label --backend --model
                             --max-concurrency N (default 4) --batch-size N (default 100)
label <path>                 --missing-only --backend --model --max-concurrency --batch-size
query "<question>"           --dfs --context C (repeatable) --budget N (default 2000) --graph
affected "X"                 --relation R (repeatable) --depth N (default 2) --graph
save-result                  --question --answer --type query|path_query|explain
                             --nodes ... --outcome useful|dead_end|corrected --correction --memory-dir
reflect                      --memory-dir --out --graph --analysis --labels
                             --half-life-days N (30) --min-corroboration N (2)
check-update <path>
tree                         --graph --output --max-children N (200) --top-k-edges N (12) --label
extract <path>               --backend gemini|kimi|claude|openai|deepseek|ollama
                             --model --mode deep --max-workers N (cpu_count)
                             --token-budget N (60000) --max-concurrency N (4) --api-timeout S (600)
                             --out DIR --google-workspace --no-cluster --code-only
                             --postgres DSN --cargo --global --as <tag>
global add|remove|list|path
benchmark [graph.json]
export html|callflow-html|obsidian|wiki|svg|graphml|neo4j|falkordb
hook install|uninstall|status
<platform> install|uninstall   # claude, codebuddy, codex, opencode, kilo, aider, copilot,
                               # vscode, claw, droid, trae, trae-cn, gemini, cursor,
                               # antigravity, hermes, kiro, pi, devin  (19 platforms)
```

**There is no `graphify mcp` subcommand.** The `--mcp` flag in the skill's Usage block maps to `python -m graphify.serve` (VERIFIED-code: `serve._main`, and `references/exports.md` Step 7d). This is a documented-surface-vs-real-surface gap.

### 2.3 Extraction model

**Structural (free, deterministic, offline).** VERIFIED-code, `detect.CODE_EXTENSIONS`:

```python
CODE_EXTENSIONS = {'.py', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.ejs',
 '.ets', '.go', '.rs', '.java', '.groovy', '.gradle', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
 '.cu', '.cuh', '.metal', '.rb', '.rake', '.swift', '.kt', '.kts', '.cs', '.scala', '.php',
 '.lua', '.luau', '.toc', '.zig', '.ps1', '.psm1', '.psd1', '.ex', '.exs', '.m', '.mm', '.jl',
 '.vue', '.svelte', '.astro', '.dart', '.v', '.sv', '.svh', '.sql', '.r', '.f', '.F', '.f90',
 '.F90', '.f95', '.F95', '.f03', '.F03', '.f08', '.F08', '.pas', '.pp', '.dpr', '.dpk', '.lpr',
 '.inc', '.dfm', '.lfm', '.lpk', '.sh', '.bash', '.json', '.tf', '.tfvars', '.hcl', '.dm',
 '.dme', '.dmi', '.dmm', '.dmf', '.sln', '.slnx', '.csproj', '.fsproj', '.vbproj', '.xaml',
 '.razor', '.cshtml', '.cls', '.trigger'}
```

Dedicated extractor modules ship for: apex, bash, blade, csharp, dart, dm (BYOND), elixir, fortran, go, json_config, julia, markdown, objc, pascal (+pascal_forms), powershell, razor, rust, sln, sql, terraform, verilog, zig, plus the 4 559-line generic tree-sitter `engine.py`. Additional structural ingesters: `scip_ingest` (SCIP index), `manifest_ingest` (pyproject/go.mod/pom/apm), `pg_introspect` (live Postgres via `--postgres DSN`), `cargo_introspect` (`--cargo`), `mcp_ingest`, `google_workspace`.

**Semantic (LLM, costs tokens).** Only for `document | paper | image` file types. Backends (VERIFIED-code, `llm.BACKENDS`):

| backend | default model | key env | pricing in/out USD/1M | vision |
|---|---|---|---|---|
| `claude` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` (+`ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL`) | 3.0 / 15.0 | yes |
| `kimi` | `kimi-k2.6` | `MOONSHOT_API_KEY` | 0.74 / 4.66 | yes |
| `gemini` | `gemini-3-flash-preview` | `GEMINI_API_KEY` \| `GOOGLE_API_KEY` | 0.50 / 3.00 | yes |
| `openai` | `gpt-4.1-mini` | `OPENAI_API_KEY` (+`OPENAI_BASE_URL` → vLLM/llama.cpp/LM Studio) | 0.40 / 1.60 | yes |
| `deepseek` | `deepseek-v4-flash` | `DEEPSEEK_API_KEY` | 0.14 / 0.28 | no |
| `ollama` | `qwen2.5-coder:7b` | `OLLAMA_API_KEY` (local) | 0 / 0 | opt-in `GRAPHIFY_OLLAMA_VISION=1` |
| `azure` | `AZURE_OPENAI_DEPLOYMENT` \| `gpt-4o` | `AZURE_OPENAI_API_KEY` | 2.50 / 10.00 | no |
| `bedrock` | `anthropic.claude-3-5-sonnet-20241022-v2:0` | AWS creds | 3.0 / 15.0 | yes |
| `claude-cli` | `claude-code-plan` (routes through local `claude -p`) | none — uses Pro/Max subscription | 0 / 0 | yes |

Critically for Foreman (VERIFIED-docs, SKILL.md Step 3, verbatim):

> **graphify needs no API key. Never ask the user for one, and never block on one.** Code is extracted structurally (AST) with no LLM and no key at all — a code-only corpus (the common `/graphify .` on a repo) skips semantic extraction entirely… graphify does **not** read `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any other provider key.

(That last sentence describes the *skill* path only; the headless `graphify extract --backend claude` path in `llm.py` does read `ANTHROPIC_API_KEY`. Minor internal inconsistency, VERIFIED-code.)

---

## 3. Real installed version vs documented version — DRIFT

**Three coexisting versions on this machine (VERIFIED-code):**

| Identity | Version |
|---|---|
| `graphify` on PATH (uv tool, py3.13) | **0.9.16** |
| `python3 -c "import graphify"` (dist-packages, py3.14) | **0.9.18** |
| installed SKILL.md | **0.9.15** |

`graphify --help` itself emits, twice: `warning: skill is from graphify 0.9.15, package is 0.9.16. Run 'graphify install' to update.`

**Consequence for Foreman:** the SKILL.md interpreter-resolution block (Step 1) prefers the uv tool interpreter, so **the skill pipeline runs 0.9.16 while any bare `python3 -c "import graphify"` runs 0.9.18.** Two different code paths in one repo. `diff -rq` between the two trees shows `__main__.py` differs (help text) — the rest is pycache noise. **Action: pin one interpreter (`GRAPHIFY_PYTHON` / `graphify-out/.graphify_python`) and re-run `graphify install` to sync the skill.**

**Doc drift on graphify.net (VERIFIED-docs vs VERIFIED-code):**

| Claim | Where | Reality |
|---|---|---|
| "19 languages" | `/tree-sitter-ast-extraction.html` | 25+ extractor modules, 90+ extensions |
| "25 programming languages" | `/skills/graphify/` | closer, still approximate |
| repo = `Graphify-Labs/graphify` | `/skills/graphify/`, site footer | PyPI homepage + working raw fetches = `safishamsi/graphify` (probable org rename; both referenced) |
| install = `npx skills add Graphify-Labs/graphify` | `/skills/graphify/` | canonical is `pip install graphifyy` (landing page) |
| `--mcp` starts an MCP server | CLI reference page | no `mcp` subcommand exists; it is `python -m graphify.serve` |
| MCP exposes 7 tools | `references/exports.md` | **10 tools** ship (§4) |
| "Neo4j export" | CLI page, exports.md | two *different-fidelity* paths behind one name (§8) |

The site documents **zero** of: `affected`, `save-result`, `reflect`, `label`, `global`, `merge-graphs`, `merge-driver`, `diagnose multigraph`, `tree`, `export callflow-html`, `--postgres`, `--cargo`, `--code-only`, HTTP MCP transport. **Treat graphify.net as marketing; treat the source and SKILL.md as the specification.**

---

## 4. MCP server contract (the mechanism Foreman lanes will use)

VERIFIED-code, `graphify/serve.py`. Server name is `"graphify"` (`Server("graphify")`).

### 4.1 Transports

| Transport | Invocation | Notes |
|---|---|---|
| **stdio** (default) | `python -m graphify.serve [graph.json] [--graph PATH]` | per-developer; `serve()` |
| **Streamable HTTP** (MCP spec 2025-03-26) | `python -m graphify.serve --transport http --host H --port P --path /mcp` | shared team/fleet server; Starlette + uvicorn; `serve_http()` |

HTTP flags: `--api-key` (env `GRAPHIFY_API_KEY`), `--path` (default `/mcp`), `--json-response` (plain JSON instead of SSE), `--stateless` (load-balanced/CI), `--session-timeout` (default 3600 s, 0 disables). Install: `pip install "graphifyy[mcp]"`.

Auth is a **single shared static key**, constant-time compared, accepted as `X-API-Key: <key>` or `Authorization: Bearer <key>`:

```python
if provided is None or not hmac.compare_digest(provided, self._expected):
    body = b'{"error": "unauthorized"}'   # 401
```

DNS-rebinding protection: wildcard bind (`0.0.0.0`/`::`) disables Host checking and prints a warning if no api-key; a specific bind allowlists `{host, localhost, 127.0.0.1}` ± port.

### 4.2 Tools — all 10, verbatim schemas

Every tool additionally receives an injected optional `project_path` (multi-project support):

```python
for _t in _tools:
    _t.inputSchema.setdefault("properties", {})["project_path"] = {
        "type": "string",
        "description": ("Absolute path to a project directory containing "
                        "graphify-out/graph.json. Optional — defaults to the graph "
                        "this server was started with."),
    }
```

`project_path` resolves to `<project_path>/<GRAPHIFY_OUT>/graph.json`, honouring the `GRAPHIFY_OUT` env override.

| # | tool | required | optional |
|---|---|---|---|
| 1 | `query_graph` | `question` | `mode` (`bfs`\|`dfs`, default `bfs`), `depth` (int, default 3, **hard-capped at 6**), `token_budget` (int, default 2000), `context_filter` (array of string, e.g. `["call","field"]`), `project_path` |
| 2 | `get_node` | `label` | `project_path` |
| 3 | `get_neighbors` | `label` | `relation_filter`, `project_path` |
| 4 | `get_community` | `community_id` (int) | `project_path` |
| 5 | `god_nodes` | — | `top_n` (default 10), `project_path` |
| 6 | `graph_stats` | — | `project_path` |
| 7 | `shortest_path` | `source`, `target` | `max_hops` (default 8), `project_path` |
| 8 | `list_prs` | — | `base`, `repo`, `project_path` |
| 9 | `get_pr_impact` | `pr_number` (int) | `repo`, `project_path` |
| 10 | `triage_prs` | — | `base`, `repo`, `project_path` |

Verbatim descriptions worth quoting for Foreman routing:

- `query_graph` — *"Search the knowledge graph using BFS or DFS. Returns relevant nodes and edges as text context."* / `"bfs=broad context, dfs=trace a specific path"`
- `graph_stats` — *"Return summary statistics: node count, edge count, communities, confidence breakdown."*
- `list_prs` — *"List open GitHub PRs with CI status, review state, and graph impact (which communities each PR touches, blast radius). Use this before starting work to check if a PR already covers the area you're about to change."*
- `get_pr_impact` — *"…which files it changes, which knowledge-graph communities are affected, and how many nodes are touched. Use this to assess merge risk or check for overlap with your current work."*
- `triage_prs` — *"Return all actionable open PRs (correct base, not stale) with full graph impact data so you can reason about review priority, merge order, and conflict risk."*

**All tool results are plain text strings, not structured JSON.** (VERIFIED-code: the `_tool_*` dispatch table returns `str`.) An agent consuming them must parse prose. This is a real limitation for machine consumption — see §11.

### 4.3 Resources — all 6

```python
types.Resource(uri="graphify://report",    name="Graph Report",              mimeType="text/markdown")
types.Resource(uri="graphify://stats",     name="Graph Stats",               mimeType="text/plain")
types.Resource(uri="graphify://god-nodes", name="God Nodes",                 mimeType="text/plain")
types.Resource(uri="graphify://surprises", name="Surprising Connections",    mimeType="text/plain")
types.Resource(uri="graphify://audit",     name="Confidence Audit",          mimeType="text/plain")
types.Resource(uri="graphify://questions", name="Suggested Questions",       mimeType="text/plain")
```

`graphify://audit` returns the honesty ledger verbatim:

```
Total edges: {total}
EXTRACTED: {n} ({pct}%)
INFERRED: {n} ({pct}%)
AMBIGUOUS: {n} ({pct}%)
```

**Resources always read the server's DEFAULT graph** — `read_resource` calls `_select_graph(None)`. Resources are *not* multi-project. (VERIFIED-code.)

### 4.4 Hot-reload and caching

Per-graph context cache keyed on `(st_mtime_ns, st_size)`; a changed `graph.json` is transparently reloaded inside the tool handler, under `threading.Lock`, and the trigram index is warmed before the graph is exposed. A missing/corrupt `project_path` graph raises a **tool error** rather than killing the server. If the default graph is absent at startup the server still boots as a pure multi-project server.

### 4.5 How a Foreman lane calls it (INFERRED, from the code + exports.md)

Shared fleet server:
```bash
GRAPHIFY_API_KEY=<key> python -m graphify.serve --transport http \
  --host 127.0.0.1 --port 8080 --path /mcp --session-timeout 3600 \
  /root/foreman/graphify-out/graph.json
```
Per-lane stdio (Claude Desktop / any MCP client) — note the absolute interpreter path requirement (VERIFIED-docs, exports.md):
```json
{"mcpServers": {"graphify": {
  "command": "<absolute path from: cat graphify-out/.graphify_python>",
  "args": ["-m", "graphify.serve", "/absolute/path/to/graphify-out/graph.json"]}}}
```
One HTTP server can serve **every worktree at once** via `project_path` — this is the single most important MCP fact for a worktree-based agent fleet.

---

## 5. Node / edge / hyperedge schema

### 5.1 Contract (VERIFIED-code, `validate.py`, verbatim)

```python
VALID_FILE_TYPES = {"code", "document", "paper", "image", "rationale", "concept"}
VALID_CONFIDENCES = {"EXTRACTED", "INFERRED", "AMBIGUOUS"}
REQUIRED_NODE_FIELDS = {"id", "label", "file_type", "source_file"}
REQUIRED_EDGE_FIELDS = {"source", "target", "relation", "confidence", "source_file"}
```

Validation is **advisory, not enforcing**: `build_from_json` filters out `"does not match any node id"` errors and merely prints `[graphify] Extraction warning (N issues): …` for the rest. Nothing aborts. (VERIFIED-code.)

Relation vocabulary the LLM is instructed to use (VERIFIED-docs, `extraction-spec.md`, verbatim):
`calls | implements | references | cites | conceptually_related_to | shares_data_with | semantically_similar_to | rationale_for`. Hyperedge relations: `participate_in | implement | form`. **The AST pass emits additional relations not in this list** (e.g. `imports`) — the vocabulary is open, not closed.

### 5.2 Real emitted records (VERIFIED-code, sampled from `/root/foreman/graphify-out/graph.json`)

Top-level document:
```json
{"directed": false, "multigraph": false, "graph": {...}, "nodes": [...], "links": [...],
 "hyperedges": [...], "built_at_commit": "d4af3a92d487151666398f38c13d2e46aaf1823b"}
```

AST node — every one of 3 579 nodes carries `label, file_type, source_file, source_location, _origin, id, community, norm_label`; 472 additionally carry `metadata`:
```json
{"label": "fetch-index.json", "file_type": "code",
 "source_file": "docs/research/fetch-index.json", "source_location": "L1",
 "_origin": "ast", "id": "research_fetch_index",
 "community": 299, "norm_label": "fetch-index.json"}
```

Semantic node — carries the full frontmatter-provenance block plus `rationale`:
```json
{"label": "Foreman Architect Doctrine", "file_type": "concept",
 "source_file": "CLAUDE.md", "source_location": null, "source_url": null,
 "captured_at": null, "author": null, "contributor": null,
 "rationale": "Architect runs the highest-judgment model (Fable preferred) and minimizes its own token volume; …",
 "community": 0, "norm_label": "foreman architect doctrine", "id": "claude_foreman_architect"}
```

Edge:
```json
{"relation": "rationale_for", "confidence": "EXTRACTED",
 "source_file": "docs/research/fetch_frontier_docs.py", "source_location": "L1",
 "weight": 1.0, "confidence_score": 1.0,
 "source": "research_fetch_frontier_docs_rationale_1", "target": "research_fetch_frontier_docs"}
```
Optional edge fields observed: `context` (368/3000 sampled), `_origin` (2/3000).

Hyperedge (first-class, top-level array):
```json
{"id": "default_soft_pipeline",
 "label": "Default Soft Pipeline (architect -> grok -> verify -> codex audit -> advisor)",
 "nodes": ["claude_foreman_architect", "agents_grok_implementer_grok_implementer",
           "agents_codex_auditor_codex_auditor", "agents_foreman_advisor_foreman_advisor"],
 "relation": "participate_in", "confidence": "EXTRACTED",
 "confidence_score": 1.0, "source_file": "README.md"}
```

### 5.3 Provenance / audit fields, complete list

| Field | Scope | Source |
|---|---|---|
| `source_file` | node, edge, hyperedge | required |
| `source_location` | node, edge | AST emits `f"L{start_row+1}"`; LLM often `null` |
| `confidence` | edge, hyperedge | `EXTRACTED` \| `INFERRED` \| `AMBIGUOUS` |
| `confidence_score` | edge, hyperedge | float; defaulted at export by `_CONFIDENCE_SCORE_DEFAULTS = {"EXTRACTED": 1.0, "INFERRED": 0.5, "AMBIGUOUS": 0.2}` |
| `_origin` | node, edge | `"ast"` marks canonical/deterministic origin; internal (underscore-prefixed) |
| `verification` | node | `"unverified"` downgrade for code-typed semantic nodes the extractor could not confirm against source (#1949) |
| `rationale` | node | WHY-text lifted onto the concept node |
| `source_url`, `captured_at`, `author`, `contributor` | node | copied from YAML frontmatter |
| `weight` | edge | numeric |
| `context` | edge | free text |
| `metadata` | node | arbitrary dict |
| `community`, `community_name`, `norm_label` | node | **added at export time by `to_json`**, not by extraction |
| `built_at_commit` | document | `git rev-parse HEAD` at write time |
| `_src` / `_tgt` | edge | internal true-direction stash (#563), popped by `to_json` |

**Cohesion scores are NOT in `graph.json`.** They live in `graphify-out/.graphify_analysis.json`, which **SKILL.md Step 9 deletes at the end of every run** (`rm -f … .graphify_analysis.json`). Confirmed on this machine: `/root/foreman/graphify-out/` contains only `graph.json` and `GRAPH_REPORT.md`. Cohesion is recoverable only from the report prose or by re-running `score_all`. (VERIFIED-code.)

The confidence-score rubric the LLM is held to (VERIFIED-docs, `extraction-spec.md`, verbatim):

> - EXTRACTED edges: confidence_score = 1.0 always
> - INFERRED edges: pick exactly ONE value from this set — never 0.5:
>     0.95 direct structural evidence … 0.85 strong inference … 0.75 reasonable inference … 0.65 weak inference … 0.55 speculative but plausible.
>   … If no value above fits, mark the edge AMBIGUOUS rather than picking 0.4 or below.
> - AMBIGUOUS edges: 0.1-0.3

---

## 6. Incremental update mechanics + cost

### 6.1 Change detection (VERIFIED-code, `detect.detect_incremental`)

Manifest at `graphify-out/manifest.json`, keys stored as **forward-slash paths relative to the scan root** (#1417 portability), values:
```json
{"<rel/path>": {"mtime": <float>, "ast_hash": "<md5>", "semantic_hash": "<md5>"}}
```
Two independent hash lanes: `kind="ast"` (used by `graphify update`) and `kind="semantic"` (used by `graphify extract`). Decision, verbatim:

> Fast path: mtime unchanged + hash matches → unchanged (free, no disk IO beyond stat). Slow path: mtime bumped → compare MD5 against the relevant hash field before re-extracting.

```python
if not stored_hash:
    changed = True          # "Missing semantic_hash means update ran but extract hasn't"
elif stored_mtime is None or current_mtime != stored_mtime:
    changed = _md5_file(Path(f)) != stored_hash
else:
    changed = False
```
`!=` not `>` (#1859): a `git checkout` to an older commit or a tar restore correctly re-extracts.

Manifest rows that left the corpus are split (#1908): file gone from disk → `deleted_files` (prune it); file alive but out of scan → `excluded_files` (do **not** prune).

A second cache layer — the **content cache** at `graphify-out/cache/{ast,semantic,semantic-<mode>}/` — is keyed by `cache.file_hash` = `SHA256(content ‖ 0x00 ‖ relative_path.lower())`, with a `(size, mtime_ns)` stat fastpath index. For `.md` files only the **body below YAML frontmatter** is hashed, so metadata-only edits are free. Since #1894 the mode is part of the namespace (`--mode deep` no longer shadows standard). Since #1939 the cache key includes a **prompt fingerprint**; pre-fingerprint entries still hit but emit:

> *"N semantic cache entries predate extraction-prompt fingerprinting … they were replayed as-is, so this graph may mix extraction vintages."*

### 6.2 Merge (VERIFIED-docs, `update.md` + VERIFIED-code `build.build_merge`)

`build_merge([new_extraction], graph_path='graphify-out/graph.json', prune_sources=deleted_or_None, root=INPUT_PATH, directed=IS_DIRECTED)`. Semantics: **replace-on-re-extract** — every `source_file` present in the new chunk is dropped from the base before merging (#1344). `prune_sources` is for genuinely *deleted* files only; passing changed files there deletes the re-extracted content (#1178). It reads `graph.json` directly rather than round-tripping through NetworkX, to preserve edge direction (#801). Hyperedges from base and new are combined.

### 6.3 Cost

- **Code-only change set → zero LLM cost.** `update.md` gates on a `code_only` check and prints `[graphify update] Code-only changes detected - skipping semantic extraction (no LLM needed)`. This is the common Foreman case.
- Docs/papers/images → `ceil(uncached_files / 22)` subagents, ~45 s per parallel batch, chunk token budget 60 000, max 4 concurrent.
- Every run appends to `graphify-out/cost.json`: `{runs: [{date, input_tokens, output_tokens, files}], total_input_tokens, total_output_tokens}`.
- `graphify benchmark` measures token reduction vs naive full-corpus (auto-runs when `total_words > 5000`).

### 6.4 Known failure modes (all upstream issues resolved by number, all CLOSED)

| # | Failure |
|---|---|
| **#479** | Partial-chunk overwrite in `--update`; origin of the shrink guard + `build_merge()` |
| **#563** | `calls` direction inversion + rationale fragments inflating god-node centrality → `_src`/`_tgt` |
| **#801** | Skill's inline merge bypassed the fixed `build_merge()`, re-hitting the direction-inversion bug |
| **#1059** | Post-commit hook lock-skip **dropped changes** on rapid commits → pending-queue drain |
| **#1145** | AST and semantic extractors minted different IDs for the same symbol → duplicated god nodes |
| **#1178** | `--update` performed a **destructive net-negative fuzzy node merge** on an already-current graph |
| **#1344** | `build_merge` accumulated stale edges instead of replacing re-extracted files |
| **#1361** | `build_merge` called without `root=` → `prune_sources` never matched, graph inflated on every update |
| **#1392** | 26 validated bugs in the generated Claude Code skill (interpreter, `--directed`, shrink-guard, cleanup ordering) |
| **#1417** | `graphify-out` used absolute paths, breaking portability across machines/directories |
| **#1504** | Same-named docs in different directories produced **colliding node IDs** → silent data loss |
| **#1553** | Cross-file `calls` dropped for any symbol with 2+ same-named defs (test mocks erased the real call graph) |
| **#1561** | Hyperedge `members`/`node_ids` alias keys silently dropped |
| **#1618** | `extract` crashed in `_semantic_id_remap` when `source_file` == scan root |
| **#1753** | Ghost-node merge picked winner by **set iteration order** — non-deterministic across process runs |
| **#1795** | `watch` evicted nodes without deletion evidence |
| **#1799** | md quick-scan + semantic minted duplicate doc nodes (`slug` vs `slug_doc`) |
| **#1831** | `to_graphml` crashed on dict/list attributes (node `metadata`, graph-level `hyperedges`) |
| **#1859** | `detect_incremental` missed backwards-moving mtimes |
| **#1894** | semantic cache key ignored `--mode`; `--mode deep` over a warm cache was a silent no-op |
| **#1908** | `save_manifest` retained scan-excluded files → permanent false `deleted_files` |
| **#1939** | semantic cache replayed stale extractions after upgrades (no prompt/skill-version in key) |
| **#1948** | `save_manifest` seeded stale `semantic_hash`, masking LLM-omitted docs |
| **#1949** | unverifiable code-typed semantic nodes downgraded to UNVERIFIED |

**Pattern to internalise:** the entire class is *silent* corruption of an incrementally-updated graph — wrong direction, ghost duplicates, stale survivors, non-deterministic winners, net-negative merges. **Every one of these is an argument for a versioned store with diffable commits rather than an in-place mutated JSON file.**

---

## 7. Integrity guards and honesty model

### 7.1 The shrink guard (#479) — VERIFIED-code, `export.to_json`

Verbatim warning:
```
[graphify] WARNING: new graph has {new_n} nodes but existing graph.json has {existing_n}
(net -{delta}). Refusing to overwrite. Possible causes: missing chunk files from a previous
session, or fuzzy dedup collapsed same-named symbols across files during an --update on an
already-current graph. Run a full rebuild (/graphify .) to be safe, or pass force=True only
if you have verified the reduction is legitimate.
```
`to_json` returns `False` and writes **nothing**. Fail-closed extensions: an unparseable existing `graph.json` also refuses (*"A fail-OPEN here (the prior behavior) is the silent data-loss path #479 exists to prevent"*); a `MALFORMED_GRAPH` sentinel forces the raw `--no-cluster` path to fail closed too; an oversized existing file (>cap) is allowed to be replaced because reading it to compare would be the DoS the cap guards against. Override: `--force` / `GRAPHIFY_FORCE=1`.

SKILL.md Step 4 hard-orders the writes so the report can never describe a graph `graph.json` doesn't contain: `to_json` first, and `GRAPH_REPORT.md` + the analysis sidecar only if `wrote` is True.

### 7.2 Graph health (Step 4.5) — VERIFIED-code, `diagnostics.diagnose_extraction`

Read-only, never aborts. Counters: `non_object_edges`, `missing_endpoint_edges`, `dangling_endpoint_edges`, `self_loop_edges`, `valid_candidate_edges`, `directed_same_endpoint_collapsed_edges`, `undirected_same_endpoint_collapsed_edges`, `unverified_node_count`. Output is either:
```
Graph health: OK (no dangling/missing/collapsed edges).
```
or
```
GRAPH HEALTH WARNING: N dangling-endpoint edges; M collapsed (undirected) edges - graph may be incomplete/corrupt.
```
Also exposed as `graphify diagnose multigraph --json` (machine-readable, `--max-examples N`).

### 7.3 Honesty Rules (VERIFIED-docs, SKILL.md, verbatim and complete)

> - Never invent an edge. If unsure, use AMBIGUOUS.
> - Never skip the corpus check warning.
> - Always show token cost in the report.
> - Never hide cohesion scores behind symbols - show the raw number.
> - Never run HTML viz on a graph with more than 5,000 nodes without warning the user.

Plus the empty-graph gate (`ERROR: Graph is empty - extraction produced no nodes.` → exit 1) and, notably, `Graph health: OK` is a *claim about the extraction dict*, not about `graph.json` — it runs pre-build on `.graphify_extract.json`.

### 7.4 Other safety machinery

`security.py`: SSRF-hardened fetcher (blocked IP ranges, redirect validation, 50 MB binary / 10 MB text caps), `validate_graph_path` (path-escape guard), `check_graph_file_size_cap` (512 MiB default, `GRAPHIFY_MAX_GRAPH_BYTES` override). `paths.write_json_atomic` (same-dir temp + `os.replace`, symlink-resolving, mode-preserving, Windows copy-fallback) — explicitly documented as **not** a power-loss durability guarantee (no fsync). Query logging is **opt-in only** (#1797): off unless `GRAPHIFY_QUERY_LOG` or `GRAPHIFY_QUERY_LOG_ENABLE=1`, rationale verbatim: *"A default-on record of proprietary queries contradicts graphify's on-device, no-telemetry posture."* `detect` skips sensitive files and reports `skipped_sensitive` counts (not names). `GRAPHIFY_ALLOW_LOCAL_PROVIDERS` gates loading project-local LLM provider configs.

---

## 8. ★ Export/ingest seam — the fidelity ceiling (coordinator questions 1–4)

### 8.1 What an "exporter" is (question 1)

There is **no exporter class, no interface, no ABC.** `graphify/exporters/base.py` is 14 lines and contains exactly one thing — a colour palette:

```python
"""Shared constants/helpers for the graphify exporters package.
Symbols used by more than one exporter live here so each exporter module can be
split out of graphify/export.py without a circular import…"""
COMMUNITY_COLORS = ["#4E79A7", "#F28E2B", …]
```

`graphify/exporters/__init__.py` is one line: `"""exporters package."""`.

An exporter is just a **module-level function**. Two shapes exist:

```python
# file-emitting
def to_graphml(G: nx.Graph, communities: dict[int, list[str]], output_path: str) -> None
def to_svg(G, communities, output_path, community_labels: dict[int,str] | None = None, figsize=(20,14)) -> None
def to_cypher(G: nx.Graph, output_path: str) -> None
def to_obsidian(G, communities, out_dir, *, community_labels=None, cohesion=None) -> int
def to_json(G, communities, output_path, *, force=False, built_at_commit=None, community_labels=None) -> bool

# live-push
def push_to_neo4j(G, uri, user, password, communities=None) -> dict[str,int]
def push_to_falkordb(G, uri, user=None, password=None, communities=None, graph_name="graphify") -> dict[str,int]
```

**What it receives:** the **NetworkX graph** (`Graph` or `DiGraph`, node/edge attributes carry everything from §5.2), plus `communities: {cid: [node_id,…]}`, and optionally `community_labels: {cid: str}` and `cohesion: {cid: float}`. Hyperedges ride on `G.graph["hyperedges"]` (set by `attach_hyperedges`). The caller (`cli.py`) assembles those inputs:

```python
G = _jg.node_link_graph(_raw, edges="links")
communities = {int(k): v for k, v in _an.get("communities", {}).items()}   # .graphify_analysis.json
cohesion    = {int(k): v for k, v in _an.get("cohesion", {}).items()}
labels      = {int(k): v for k, v in json.loads(labels_path…).items()}     # .graphify_labels.json
```
with a fallback that **reconstructs `communities` from the per-node `community` attribute** when the analysis sidecar is missing (which is the normal state after Step 9 cleanup).

**Generic vs Cypher-specific:** ~zero shared machinery. `to_cypher`, `push_to_neo4j`, `push_to_falkordb` each re-implement their own `_safe_rel` / `_safe_label` / `_cypher_escape` sanitizers — `push_to_neo4j` and `push_to_falkordb` are near-verbatim copies of each other (the FalkorDB docstring says so: *"the MERGE/SET upsert queries are identical to push_to_neo4j"*). Nothing about the input shape is Cypher-flavoured; a new exporter starts from `(G, communities)` and does whatever it wants.

**Cost of a new exporter (INFERRED from the dispatch code, high confidence):** ~4 files, ~120–200 LOC for a push-style backend.

| File | Change |
|---|---|
| `graphify/exporters/<name>.py` | new: one `push_to_<name>(G, …)` / `to_<name>(G, communities, path)` function (~100–180 LOC, modelled on `graphdb.py`'s 173) |
| `graphify/export.py` | one `from graphify.exporters.<name> import …  # noqa` re-export line |
| `graphify/cli.py` | add `"<name>"` to the allowlist tuple at L1736 + one `elif subcmd == "<name>":` branch at ~L2010 (~10 LOC) |
| `graphify/__main__.py` | one help line |
| *(optional)* `SKILL.md` + `references/exports.md` | flag documentation |

### 8.2 Is it a real extension point? (question 2) — **NO. Fork or PR required.**

The dispatch is a hardcoded allowlist + if/elif chain in `cli.py`:

```python
elif cmd == "export":
    subcmd = …
    if subcmd not in ("html", "callflow-html", "obsidian", "wiki", "svg", "graphml", "neo4j", "falkordb"):
        …error…
...
        elif subcmd == "graphml":
            from graphify.export import to_graphml as _to_graphml
            _to_graphml(G, communities, str(out_dir / "graph.graphml"))
```

There is no entry-point group, no `register_exporter()`, no config-declared backend. Contrast this with the *one* genuine registry graphify does ship — `resolver_registry.py`, for language resolution:

```python
"""Registry for cross-file, language-specific resolution passes.
… That pattern is the de-facto extension point for per-language resolution; this module
formalizes it so a new language plugs in by registering one ``LanguageResolver`` instead
of editing ``extract()``'s body."""
def register(resolver: LanguageResolver) -> LanguageResolver:
    _REGISTRY.append(resolver); return resolver
```
Even that registry is **populated by `extract.py` itself at import time** — there is no plugin discovery, so a third party still cannot register without editing the package.

**Conclusion:** adding a TerminusDB (or any) backend to graphify requires a fork or an upstream PR. **However — the exporter is not the only seam.** Because `graph.json` is a plain, fully-specified, atomically-written NetworkX document (§5.2), an **external** ingester that reads `graph.json` directly needs *no* graphify change at all, and gets strictly more fidelity than any built-in exporter (§8.3). **Recommendation: do not fork; read `graph.json`.**

### 8.3 ★★ Fidelity ceiling — what survives each export (question 3)

**This is the critical finding. The two "Neo4j" paths have wildly different fidelity, and the one the docs lead with is the lossy one.**

`to_cypher` — what `graphify export neo4j` / `export falkordb` writes to `cypher.txt` — **in its entirety**:

```python
def to_cypher(G: nx.Graph, output_path: str) -> None:
    lines = ["// Neo4j Cypher import - generated by /graphify", ""]
    for node_id, data in G.nodes(data=True):
        label = _cypher_escape(data.get("label", node_id))
        node_id_esc = _cypher_escape(node_id)
        ftype = _cypher_label((data.get("file_type", "unknown") or "unknown").capitalize(), "Entity")
        lines.append(f"MERGE (n:{ftype} {{id: '{node_id_esc}', label: '{label}'}});")
    lines.append("")
    for u, v, data in G.edges(data=True):
        rel  = _cypher_label((data.get("relation", "RELATES_TO") or "RELATES_TO").upper(), "RELATES_TO")
        conf = _cypher_escape(data.get("confidence", "EXTRACTED"))
        lines.append(f"MATCH (a {{id: '{u}'}}), (b {{id: '{v}'}}) "
                     f"MERGE (a)-[:{rel} {{confidence: '{conf}'}}]->(b);")
```

It emits **five values total**: node `id`, node `label`, node `:file_type` label, edge relation type, edge `confidence`.

| Field | `graph.json` | `to_cypher` (file) | `push_to_neo4j` / `push_to_falkordb` | `to_graphml` |
|---|---|---|---|---|
| `id`, `label` | ✅ | ✅ | ✅ | ✅ |
| `file_type` | ✅ | ✅ (as node label) | ✅ (as node label + prop) | ✅ |
| **`source_file`** (node) | ✅ | ❌ **DROPPED** | ✅ | ✅ |
| **`source_location`** (node) | ✅ | ❌ **DROPPED** | ✅ (if scalar) | ✅ |
| **`source_file`** (edge) | ✅ | ❌ **DROPPED** | ✅ | ✅ |
| **`source_location`** (edge) | ✅ | ❌ **DROPPED** | ✅ | ✅ |
| **`confidence`** (EXTRACTED/INFERRED/AMBIGUOUS) | ✅ | ✅ | ✅ | ✅ |
| **`confidence_score`** | ✅ | ❌ **DROPPED** | ✅ | ✅ |
| `weight`, `context` | ✅ | ❌ **DROPPED** | ✅ | ✅ |
| `rationale`, `author`, `contributor`, `source_url`, `captured_at` | ✅ | ❌ **DROPPED** | ✅ (scalars) | ✅ |
| `verification` (`unverified`) | ✅ | ❌ **DROPPED** | ✅ | ✅ |
| `metadata` (dict) | ✅ | ❌ | ❌ **DROPPED** (not scalar) | ✅ (JSON-stringified) |
| **`hyperedges`** | ✅ | ❌ **DROPPED** | ❌ **DROPPED** | ✅ (JSON string on graph attrs) |
| `community` (id) | ✅ | ❌ **DROPPED** | ✅ (injected prop) | ✅ (injected attr, default -1) |
| `community_name` | ✅ (if labelled) | ❌ | ❌ | ✅ if present on node |
| **cohesion scores** | ❌ (sidecar only) | ❌ | ❌ | ❌ |
| `built_at_commit` | ✅ | ❌ | ❌ | ✅ (graph-level attr) |
| `_origin` (`"ast"`) | ✅ | ❌ | ❌ (`_`-filtered) | ❌ (deliberately stripped) |
| true edge direction | ✅ (`_src`/`_tgt` restored) | ⚠️ see below | ⚠️ see below | ⚠️ see below |

The push path filter, verbatim (identical in both graph DBs):
```python
props = {k: v for k, v in data.items()
         if isinstance(v, (str, int, float, bool)) and not k.startswith("_")}
```

**Findings, stated loudly:**

1. **`graphify export neo4j`/`falkordb` → `cypher.txt` destroys the entire audit trail.** No `source_file`, no `source_location`, no `confidence_score`, no communities, no hyperedges, no rationale, no `built_at_commit`. It preserves the *categorical* confidence tag and nothing else. **A naive `graphify → cypher.txt → store` pipeline would silently lose exactly the provenance this whole effort exists to capture.** Do not use it.
2. **The direct-push path is far better but still lossy in three specific ways:** (a) **hyperedges are dropped entirely** — the push functions never touch `G.graph["hyperedges"]`; (b) any **non-scalar** attribute (notably the per-node `metadata` dict, present on 472/3579 nodes in the live graph) is dropped; (c) `_`-prefixed keys are filtered, which removes the `_src`/`_tgt` **true-direction markers** — so for an undirected build, `G.edges()` yields NetworkX's canonicalized endpoint order and the pushed `MERGE (a)-[r]->(b)` can be **direction-inverted**. This is bug #563 resurfacing on the push path: `to_json` fixes it (*"The build path stashes the true endpoints in `_src`/`_tgt` for exactly this purpose (#563)"*), and the exporters do not.
3. **GraphML is the highest-fidelity built-in export.** `to_graphml` copies *all* non-underscore node/edge/graph attributes and coerces non-scalars to JSON strings, so `metadata` and the **graph-level `hyperedges` list survive as a JSON string** (#1831). It still strips `_origin` deliberately and does not carry cohesion.
4. **`graph.json` itself is strictly the highest fidelity artifact available** — it is the only place `_origin`, hyperedges-as-objects, `built_at_commit`, and `community_name` all coexist. **The store layer should ingest `graph.json`, not any exporter output.**
5. **Cohesion scores escape every path.** They only exist in `.graphify_analysis.json`, which the skill deletes. To retain them the pipeline must be changed to copy the sidecar before Step 9 cleanup, or call `cluster.score_all(G, communities)` independently.

### 8.4 Incremental export? (question 4) — **NO. Every export is a full dump.**

`grep -rn "incremental" export.py exporters/*.py` → **zero matches** (VERIFIED-code). Every exporter iterates `G.nodes(data=True)` and `G.edges(data=True)` in full. There is no watermark, no since-token, no changed-set parameter, no per-export state file.

The only concession is **idempotence**: the push paths use `MERGE … SET n += $props`, so re-running upserts rather than duplicates. Consequences:

- Push cost is **O(V+E) round trips** — one `session.run` per node and one per edge, no batching, no `UNWIND`, no transaction. For the 3 579-node / 3 668-edge Foreman graph that is **7 247 sequential queries per export**. This will not scale to a per-commit loop without batching.
- **`MERGE` never deletes.** A node removed from the corpus is never removed from the target store. An incremental pipeline built on push would monotonically accumulate tombstones.
- **Change information exists but never reaches the exporter.** `detect_incremental` returns `new_files`, `unchanged_files`, `deleted_files`, `excluded_files`; `graphify.analyze.graph_diff(G_old, G_new)` returns `{summary, new_nodes, new_edges}` and `graphify/affected.py` does reverse-impact traversal. **The delta is computable inside graphify today — it is simply not plumbed to any exporter.** That is our seam: compute the diff ourselves from two `graph.json` snapshots (or from `graph_diff`) and hand the store a changeset.

### 8.5 ★★ Node-ID stability across rebuilds (question 5) — **YES, stable. Path+symbol derived, content-independent.**

Single source of truth, `graphify/ids.py`, verbatim:

```python
def normalize_id(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[^\w]+", "_", s, flags=re.UNICODE)
    s = re.sub(r"_+", "_", s)
    return s.strip("_").casefold()

def make_id(*parts: str) -> str:
    return normalize_id("_".join(p.strip("_.") for p in parts if p))
```
`normalize_id` is documented **idempotent**: `normalize_id(normalize_id(s)) == normalize_id(s)`.

The prefix, `extractors/base._file_stem`, verbatim:
```python
def _file_stem(path: Path) -> str:
    """… The full path (extension dropped) is preserved as path segments; ``make_id``
    later collapses the separators to underscores. Using every segment — not just the
    immediate parent dir (#1504) — means same-named files in different directories get
    distinct IDs instead of colliding into one last-writer-wins node:
        docs/v1/api/README.md -> docs/v1/api/README -> docs_v1_api_readme
        docs/v2/api/README.md -> docs/v2/api/README -> docs_v2_api_readme
    Top-level files keep a bare stem (``setup.py`` -> ``setup``)…"""
    return path.with_suffix("").as_posix()
```
So: `id = normalize(repo_relative_path_without_extension + "_" + symbol_name…)`.

**Stability properties (VERIFIED-code):**

| Change | ID effect |
|---|---|
| File content edited, path + symbol name unchanged | **ID unchanged** ✅ |
| Whitespace / formatting / comment churn | **ID unchanged** ✅ |
| Different machine, different checkout dir | **ID unchanged** ✅ (`#502` re-derives the repo-relative form from `source_file`; `#1417` made the manifest relative too) |
| Unicode composed vs decomposed, case, punctuation variance | **ID unchanged** ✅ (NFKC + casefold, `#811`) |
| Symbol renamed | ID changes (correct — it is a different entity) |
| **File moved or renamed** | **ID changes for the file node and every symbol in it** ⚠️ |
| Graphify version upgrade that changes the stem recipe | IDs migrate (this happened: `#1504` widened the stem from immediate-parent to full path) |

Three producers must agree on IDs (AST extractor, LLM subagents, graph builder). `ids.py` exists precisely because they historically diverged — the docstring names the bug class: *"#811 Unicode collapse, #550 same-filename collisions, #1033 AST-vs-LLM file-node mismatch, #1104"*. The builder additionally runs `_semantic_id_remap` (re-derives every non-AST id from its own `source_file` in code rather than trusting LLM prose), `_doc_twin_remap` (#1799), a ghost-merge pass where **AST always wins** (`_origin=="ast"` is the canonical signal, #1145/#1257/#1753), and a **pre-migration alias index** (#1504) mapping old-stem forms so stale edge endpoints resolve instead of dangling.

**Verdict for the two-layer architecture:** IDs are *sufficiently* stable to be the store's primary key **for content edits**, which is the dominant case. But **file moves are ID-churning renames**, and a **graphify upgrade can migrate the entire ID space**. The store must therefore (a) treat an ID change as a rename-with-lineage, not a delete+create, and (b) record the producing graphify version alongside every commit so an ID-space migration is diagnosable. `built_at_commit` gives us git lineage for free; there is **no `graphify_version` field in `graph.json` — we must add it ourselves at ingest.**

---

## 9. Limits, scale ceilings, and concurrency

### 9.1 Scale

| Limit | Value | Source |
|---|---|---|
| HTML viz hard threshold | `MAX_NODES_FOR_VIZ = 5_000` (`exporters/html.py`); `to_html` **raises `ValueError`** above it unless `node_limit` is set | VERIFIED-code |
| Over-cap HTML fallback | `graphify export html` forces `node_limit=5000` community-aggregation view instead of erroring (#1019) | VERIFIED-code |
| Corpus warning gate | `total_words > 2,000,000` **OR** `total_files > 500` → warn + ask user to narrow to a top-5 subdirectory | VERIFIED-docs (SKILL.md Step 2) |
| `graph.json` size cap | **512 MiB** (`_MAX_GRAPH_FILE_BYTES`), override `GRAPHIFY_MAX_GRAPH_BYTES`; hard error for every subcommand except `html` | VERIFIED-code |
| URL ingest caps | 50 MB binary / 10 MB text | VERIFIED-code |
| Benchmark auto-trigger | `total_words > 5,000` | VERIFIED-docs |
| Semantic chunking | 20–25 files/subagent; 1 image per chunk; 60 000-token per-chunk budget; max 4 concurrent | VERIFIED-docs/code |
| `god_nodes` degradation | `analyze.py:347` branches at `G.number_of_nodes() > 5000` | VERIFIED-code |
| callflow-html | verbose warning at `>= 5000` nodes; `--max-children 200`, `--top-k-edges 12` | VERIFIED-code |

### 9.2 Community detection at scale

`cluster._partition`: **Leiden via `graspologic`** when installed (`random_seed=42`, `trials=1`, `resolution` configurable), falling back to **NetworkX Louvain** (`seed=42, threshold=1e-4, resolution`, plus `max_level=10` when supported — the comment says it *"prevents hangs on large sparse graphs"*). Determinism is engineered: nodes added `sorted(key=str)` and edges added in a fully sorted order including a canonical JSON of the attribute dict, so the partition is reproducible run-to-run. `_MAX_COMMUNITY_FRACTION = 0.25` — any community larger than 25% of the graph is recursively split. Cohesion via `score_all`. **The live Foreman graph has 300+ communities for 3 579 nodes** (community id 299 observed), i.e. very fine-grained partitioning at this scale — worth noting for anyone planning to key store partitions on community id.

### 9.3 Query latency and matching

Query matching is **case-folded substring + IDF + a trigram candidate index** (`_get_trigram_index`, `_trigram_candidates(guard_frac=0.10)`), warmed eagerly on graph load. Depth is capped at 6 in the MCP tool; default token budget 2 000. `query.md` states the limitation plainly:

> graphify's `query` CLI matches nodes via case-folded substring + IDF — there is **no stemming, no synonyms, no cross-language match** inside the binary… If the user's question uses different language or different domain vocabulary than the graph's labels … the literal matcher returns 0 hits and the answer collapses to noise.

The prescribed mitigation is a **REQUIRED vocab-expansion pre-step**: dump the label token vocabulary to `graphify-out/.vocab.txt`, have the agent pick ≤12 tokens *from that exact list*, print the expansion for auditability, and query with the expanded string — with a hard rule to **stop and say so** rather than fabricate when nothing matches. **This is a per-query agent obligation, not something the binary does.** Any Foreman lane that calls `query_graph` over MCP without doing this will get silent zero-recall.

### 9.4 Multi-writer / concurrency (checked in the code, not the docs)

**There is exactly one lock in the entire package** — `watch._rebuild_lock` (VERIFIED-code, and `grep -rn "flock|FileLock|LOCK_EX|filelock"` finds nothing else):

```python
@contextlib.contextmanager
def _rebuild_lock(out_dir: Path, *, blocking: bool = False):
    """Per-repo advisory lock around a rebuild.
    Yields True if acquired, False if another rebuild is already running and ``blocking``
    is False. Uses fcntl.flock so the lock is released automatically if the process is
    killed (no stale-lock cleanup needed).
    While the lock is held, ``.rebuild.lock`` contains the owning PID…
    Falls back to a no-op yield(True) on platforms without fcntl (Windows)."""
```

Paired with a **pending-work queue** (#1059) so a lock-losing incremental rebuild does not drop its change set:

> *"incremental hooks must not drop their change set when another rebuild is already running. Queue before attempting the lock so a non-blocking failure still records the work; the lock-holder drains the queue and merges it in."*

**Who takes the lock:** only `watch._rebuild_code` — i.e. `graphify watch`, the git post-commit/post-checkout hooks, and the interactive `graphify update` (which passes `block_on_lock=True`).

**Who does NOT take the lock:**
- `graphify extract` (`cli.py` — `grep flock cli.py` → nothing)
- the entire **skill pipeline** (SKILL.md Steps 3–9 write `graph.json` through raw `to_json`)
- `graphify cluster-only`, `graphify label`, every `graphify export …`
- **Windows** — `fcntl` is absent, so `_rebuild_lock` degrades to an unconditional `yield True`, i.e. no locking at all.

**Answer: two processes CANNOT safely update one graph, except in the narrow `watch`/hook/`update` triangle on POSIX.** What actually happens on a concurrent write:

1. Both readers load the same `graph.json`.
2. Both build, both call `to_json`.
3. `write_json_atomic` guarantees no *torn* file (same-dir temp + `os.replace`) — but it is **last-writer-wins**: the second writer's document completely replaces the first's. The first writer's new nodes are gone.
4. The **shrink guard is the only thing standing between us and silent loss** — and it only fires when the loser's graph has *fewer* nodes. Two lanes each adding disjoint nodes to different areas both produce *larger* graphs, so both pass the guard, and **the second silently discards the first's work with no warning at all.**
5. There is no fsync, so this is not power-loss durable either (documented).

There *is* one nod to concurrent authorship: `graphify merge-driver <base> <current> <other>` — a **git merge driver that union-merges two `graph.json` files**, installed via `graphify hook install`. That is the upstream answer to concurrency: *let git do it*. It is a textual/structural union with no ontology awareness and no conflict semantics beyond union.

The MCP server is **read-only** with respect to `graph.json` (it only appends to the opt-in query log and, via `save-result`, to `graphify-out/memory/`), so **N reader lanes + 1 writer is safe**; readers hot-reload on `(mtime, size)` change. **N writers is not.**

**This is the single strongest technical argument for the store layer.** A versioned store with real commits, branches, and merge is precisely the missing component. graphify's own answer to "two agents edited the graph" is a git union merge driver.

---

## 10. Extension points

### Without forking (all VERIFIED-code)

| Want | How |
|---|---|
| **Custom node/edge types** | `file_type` is a closed set of 6 (`VALID_FILE_TYPES`) but validation is **advisory** — an unknown value is coerced to `"concept"` via `_FILE_TYPE_SYNONYMS` in `build_from_json`, not rejected. **Relations are an open vocabulary** — any string works; `to_cypher`/push sanitize it into an identifier. So custom *edge* types are free; custom *node* types are not (they collapse to `concept`). |
| **Custom provenance fields** | **Free.** Any extra key on a node/edge dict survives `build_from_json` (`G.add_node(id, **{k:v for k,v in node.items() if k != "id"})`), survives `to_json` (raw `node_link_data`), survives GraphML, and survives the push path if scalar. Prefix-with-`_` marks a field internal and it will be stripped by GraphML/push but kept in `graph.json`. **Recommended: write Foreman fields as plain scalars, not underscore-prefixed.** |
| **New export / store ingest** | Read `graph.json` directly from outside graphify. Highest fidelity, zero coupling, no fork. **This is the recommendation.** |
| **Change detection** | `detect.detect_incremental`, `analyze.graph_diff(G_old, G_new)`, `affected.py` reverse-impact — all importable as a library. |
| **Redirect output** | `GRAPHIFY_OUT` (relative name or absolute path) is honoured package-wide (#1423) — this is the worktree/shared-output mechanism. |
| **Multi-project MCP** | `project_path` on every tool. One server, N worktrees. |
| **Cross-repo graphs** | `graphify merge-graphs`, `graphify global add/remove/list`, `build.prefix_graph_for_global(G, repo_tag)`; merged nodes carry a `repo` attribute. |
| **Alternate LLM/self-hosted** | `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `KIMI_BASE_URL` / `GEMINI_BASE_URL` / `DEEPSEEK_BASE_URL` + custom-provider file behind `GRAPHIFY_ALLOW_LOCAL_PROVIDERS=1`. |
| **New language resolution** | `resolver_registry.register(LanguageResolver(name, suffixes, resolve))` — a real registry, but populated at `extract.py` import time, so third-party registration still needs a package edit. |

### Requires a fork or upstream PR

| Want | Why |
|---|---|
| A `graphify export terminusdb` subcommand | hardcoded allowlist tuple + if/elif in `cli.py` (§8.2) |
| **Incremental / delta export** | no such concept anywhere in `export.py` (§8.4) |
| **Hyperedges in any graph-DB export** | push paths never read `G.graph["hyperedges"]` |
| **Direction-correct push** | `_src`/`_tgt` are `_`-filtered out of the push property set |
| **Batched push** | one `session.run` per node and per edge; no `UNWIND`, no transaction |
| **Real multi-writer safety** | one advisory flock, POSIX-only, not taken by `extract`/skill/export |
| **Structured (JSON) MCP tool results** | all `_tool_*` handlers return `str` |
| **Enforcing validation** | `validate_extraction` errors are printed, never raised, on the build path |
| **Cohesion in `graph.json`** | written only to a sidecar that Step 9 deletes |
| **A `graphify_version` stamp in `graph.json`** | only `built_at_commit` is written |

---

## 11. Verdict for Foreman v0.2.9

### What graphify gives the graph plane FOR FREE

1. **A deterministic, offline, zero-cost extraction layer over 90+ file extensions / 25+ language extractors.** Code-only corpora — Foreman's dominant case — need **no API key and no LLM at all**. Plus live-Postgres (`--postgres`), Cargo, SCIP, and package-manifest ingesters.
2. **A first-class, machine-checkable audit trail.** Every edge carries `confidence ∈ {EXTRACTED, INFERRED, AMBIGUOUS}` + a rubric-bound `confidence_score`, and every node/edge carries `source_file` + `source_location`. AST-origin is distinguishable from LLM-origin (`_origin: "ast"`). This is exactly the evidence layer Foreman's verification-claim-discipline needs.
3. **A ready-made agent read path: 10 MCP tools + 6 resources over stdio or Streamable HTTP, with `project_path` multi-project routing and mtime hot-reload.** One HTTP server with an api-key can serve every worktree in a fleet. Lanes get `query_graph`, `shortest_path`, `get_neighbors`, `god_nodes`, plus PR-impact/blast-radius tools that are already shaped like a merge gate.
4. **Cheap incremental refresh with real change detection** — two-lane mtime+MD5 manifest, content cache keyed on SHA256(content‖relpath) with a prompt-version fingerprint, code-only fast path with zero LLM cost, `git` post-commit hook, `watch` with debounce + flock + pending-queue.
5. **Integrity machinery already built and battle-hardened by ~24 closed corruption bugs**: shrink guard (#479), fail-closed on unparseable graphs, atomic symlink-aware writes, the read-only graph-health diagnostic (dangling/missing/collapsed/self-loop/unverified), deterministic Leiden with seeded ordering, and five explicit Honesty Rules.
6. **Stable, path-derived node IDs** that survive content edits, machines, checkouts, and Unicode variance — good enough to be a store primary key.
7. **`built_at_commit`** stamped into every `graph.json` — free git lineage for a store commit.

### Top 5 things we MUST build on top of it

1. **A `graph.json → store` ingester that we own (NOT an exporter, NOT `cypher.txt`).** Read `graph.json` directly; it is strictly the highest-fidelity artifact and requires no fork. Preserve the full §5.3 provenance set — `source_file`, `source_location`, `confidence`, `confidence_score`, `_origin`, `verification`, `rationale`, hyperedges-as-objects, `community`/`community_name`, `built_at_commit`. **Explicitly reject the `export neo4j` path: it emits 5 fields and destroys the audit trail.** Also snapshot `.graphify_analysis.json` (cohesion) *before* the skill's Step 9 cleanup deletes it, and stamp the producing graphify version — graphify does not record it.
2. **A write-serialisation layer.** graphify has one POSIX-only advisory flock that `extract`, the skill pipeline, and every export ignore; concurrent writers are last-writer-wins and the shrink guard does **not** catch two lanes adding disjoint nodes. Foreman must own the mutex (or route every write through a single builder process), and make the store — not `graph.json` — the durable record. This is the single biggest correctness gap.
3. **A delta/changeset computer.** No exporter is incremental and every push is O(V+E) sequential queries (7 247 for today's Foreman graph). Build the diff ourselves from consecutive `graph.json` snapshots (or `analyze.graph_diff` + `detect_incremental`'s `deleted_files`), and feed the store a changeset per commit. Also model ID churn as **rename-with-lineage**: a file move re-IDs every symbol in it, and a graphify upgrade can migrate the whole ID space.
4. **A machine-readable query contract on top of MCP.** All 10 tools return prose strings, and `query_graph` matching is literal substring+IDF with *no* stemming or synonyms — `references/query.md` mandates a vocab-expansion pre-step or recall silently collapses to zero. Foreman needs a thin wrapper that (a) does the `.vocab.txt` expansion automatically and logs it for auditability, (b) returns structured JSON with node ids + `source_location` citations, and (c) fails loudly on empty expansion instead of answering from model memory.
5. **A graph-integrity gate wired into the Foreman merge gate.** Run `graphify diagnose multigraph --json` + the Step 4.5 health check on every rebuild, treat `dangling/missing/collapsed/self-loop/unverified` counts as gate signals, and pin one interpreter and one graphify version (today the machine runs **0.9.16 on PATH, 0.9.18 under `python3`, and a 0.9.15 skill** — three code paths in one repo, §3). Add `--force` discipline: never pass it without recording why.

---

## 12. Open questions / unreachable pages

- **Unreachable: none.** 153/153 crawled pages returned OK on the first `scrapling extract get`; no fetcher escalation was needed. `sitemap.xml`, README, and CHANGELOG all fetched.
- **Deliberately not crawled** (out of scope, ~276 URLs): 200+ `/repo/<owner>-<repo>/` generated repo-graph pages, `/mcpservers/*`, `/ai-coding-tools/*`, `/compare/*`, `/authors/evan/*`, `/page/N` paginators, and the 30 i18n mirror pages (`/hk/ /kr/ /tw/ /vn/ /zh/`). If the swarm wants graphify's *own* published output format for public repos, the `/repo/` pages are the sample set — say the word and I will pull a representative handful.
- **Open — `ARCHITECTURE.md`.** `/tree-sitter-ast-extraction.html` points at `ARCHITECTURE.md` in the repo for "how to add a language". Not fetched; would sharpen the fork-cost estimate in §8.1.
- **Open — org identity.** PyPI + working raw fetches say `safishamsi/graphify`; graphify.net says `Graphify-Labs/graphify` and `npx skills add Graphify-Labs/graphify`. Probably a rename with both live. Worth confirming before we file any upstream PR.
- **Open — 0.9.18 changelog delta.** I read the code at 0.9.18 and the shipped CHANGELOG head only reaches the 0.1.x entries in the fetched prefix; I have not diffed 0.9.16→0.9.18 behaviourally beyond `__main__.py`. Low risk, but if we pin 0.9.18 we should read that delta.
- **Open — MCP under concurrent HTTP load.** `_select_graph` rebinds a closure-level `G` with an explicit comment that no lock is needed *"since \_select\_graph and the handler run in one synchronous stretch of each call\_tool coroutine (no await between them)"*. That reasoning is sound for the current handlers but is a latent hazard if any handler ever awaits. Worth a load test before we put one HTTP server in front of a whole lane fleet.
- **Open — `graphify merge-driver` semantics.** It union-merges two `graph.json` files as a git merge driver. I read its CLI surface but not its conflict semantics. If the store ends up being the merge authority this is moot; if we ever merge graphs in git, it needs a read.
- **Not verified by execution.** Every claim here is from source reading and `--help` output. I did **not** run a full `graphify extract`, an MCP session, a Neo4j push, or a concurrent-write experiment. Per verification-claim-discipline: **the concurrency conclusion in §9.4 is code-derived, not experimentally reproduced.** A 20-minute two-process write race against a scratch corpus would convert it to measured fact and is the highest-value follow-up experiment.

---

## 13. Appendix — full graphify.net crawl manifest (153/153 OK)

| URL | Status | Size | Date |
|---|---|---|---|
| https://graphify.net/ | OK-get | 40700 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/ | OK-get | 12130 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agent-frameworks/ | OK-get | 8819 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agent-frameworks/tap-file-based-agent-collaboration/ | OK-get | 31559 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ | OK-get | 12086 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/agent-swarm-codebase-context/ | OK-get | 25871 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ai-agent-evaluation-framework-2026/ | OK-get | 27087 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/best-ai-coding-agents-2026/ | OK-get | 30504 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/codewhale-fleet-context-sharing/ | OK-get | 25850 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/multica-agent-context/ | OK-get | 25549 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/multica-large-codebase/ | OK-get | 25375 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/multica-multi-agent-context/ | OK-get | 25027 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/multiple-ralph-loops-shared-context/ | OK-get | 25381 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/opencode-context-engineering/ | OK-get | 25665 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/pi-claude-code-context-engineering/ | OK-get | 25560 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/pi-vs-claude-code-large-codebase/ | OK-get | 25566 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/qoder-subagent-context-codebases/ | OK-get | 27203 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ralph-code-search-problems/ | OK-get | 24979 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ralph-fresh-context/ | OK-get | 24616 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ralph-knowledge-graph/ | OK-get | 26163 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ralph-loop-large-codebase/ | OK-get | 25925 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/ralph-loop-memory/ | OK-get | 25439 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/rising-ai-agent-github-projects-2026/ | OK-get | 31971 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/share-context-across-coding-agents/ | OK-get | 26731 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/share-context-between-pi-and-claude-code/ | OK-get | 26376 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/stop-ralph-rereading-repository/ | OK-get | 26039 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/supacode-agent-context-optimization/ | OK-get | 24781 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/supacode-large-codebases/ | OK-get | 25441 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/supacode-shared-context-worktrees/ | OK-get | 25530 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/agents/verdent-review-2026/ | OK-get | 27970 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/ai-coding-cli-best-ai-coding-clis-2026/ | OK-get | 29591 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/ai-coding-graphify-ornith-1-0-code-knowledge-graph/ | OK-get | 27618 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/alternatives/ | OK-get | 8749 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/alternatives/graphify-vs-context7-toondex-repomix-deepwiki-serena/ | OK-get | 35981 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/anthropic-vs-nvidia-10-trillion-race/ | OK-get | 28884 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/boilerplates/ | OK-get | 8729 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/boilerplates/best-ai-coding-boilerplates-2026/ | OK-get | 25460 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/claude-code-loop-design/ | OK-get | 62756 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/ | OK-get | 11878 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claude-agent-sdk-vs-claude-code/ | OK-get | 26985 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claude-code-recipes-large-codebases/ | OK-get | 26047 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claude-code-repeated-repository-scanning/ | OK-get | 24887 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claude-code-repository-analysis-skill/ | OK-get | 26713 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claude-code-understand-repository/ | OK-get | 25333 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claude-code-vs-codex-cli/ | OK-get | 28477 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/claudex-context-engineering/ | OK-get | 27854 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/codewhale-context-optimization/ | OK-get | 25421 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/codewhale-large-codebases/ | OK-get | 26069 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/codex-cli-guide-2026/ | OK-get | 27032 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/qoder-cli-context-engineering/ | OK-get | 27925 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/qoder-cli-large-codebases/ | OK-get | 26898 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/cli/switch-codex-provider-context/ | OK-get | 26133 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/evaluation/ | OK-get | 8820 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/evaluation/databricks-ai-coding-agent-benchmark-cost/ | OK-get | 34709 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify-vs-graphifyy-vs-graphifylabs/ | OK-get | 27625 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/ | OK-get | 11528 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/1m-context-vs-knowledge-graph/ | OK-get | 27629 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/agents-md-vs-knowledge-graph/ | OK-get | 27221 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/cc-switch-knowledge-graph-workflow/ | OK-get | 25240 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/claude-code-recipes-vs-knowledge-graph/ | OK-get | 25625 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/claude-md-vs-knowledge-graph/ | OK-get | 25254 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/codewhale-constitution-vs-knowledge-graph/ | OK-get | 26291 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/compound-engineering-knowledge-graph/ | OK-get | 25537 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/compound-engineering-large-codebase/ | OK-get | 24552 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/compound-engineering-memory/ | OK-get | 24741 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/compound-engineering-token-usage/ | OK-get | 24621 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/git-worktree-vs-knowledge-graph/ | OK-get | 25047 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/kimi-k3-knowledge-graph/ | OK-get | 25385 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/macaron-context-vs-code-graph/ | OK-get | 27035 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/multica-skills-vs-code-knowledge-graph/ | OK-get | 25187 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/opencode-vs-code-knowledge-graph/ | OK-get | 26613 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/openspec-compound-engineering-code-graph/ | OK-get | 26826 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/ornith-1-0-agent-memory/ | OK-get | 24358 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/pi-skills-vs-claude-md/ | OK-get | 25401 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/pxpipe-code-context-graphify/ | OK-get | 25204 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/pxpipe-vs-graphify/ | OK-get | 25571 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/graphify/skill-zoo-code-knowledge-skills/ | OK-get | 24699 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/ | OK-get | 12318 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/best-llm-for-coding-2026/ | OK-get | 28542 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/claude-sonnet-5-large-codebases/ | OK-get | 24522 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/glm-5-2-context-window-vs-code-knowledge-graph/ | OK-get | 24485 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/gpt-5-6-sol-codebase-understanding/ | OK-get | 24631 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/gpt-5-6-sol-multi-file-refactoring/ | OK-get | 25343 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/inkling-model/ | OK-get | 40467 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/kimi-k3-codebase-understanding/ | OK-get | 25656 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/kimi-k3-context-engineering/ | OK-get | 26162 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/kimi-k3-context-window-vs-repo-structure/ | OK-get | 25727 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/kimi-k3/ | OK-get | 34943 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/macaron-context-engineering/ | OK-get | 26848 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/macaron-v1-large-codebase/ | OK-get | 26719 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/muse-spark-1-1-large-codebases/ | OK-get | 26511 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/muse-spark-vs-opus-repository-understanding/ | OK-get | 27095 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/llms/sonnet-5-vs-fable-5-repository/ | OK-get | 25383 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/ | OK-get | 13574 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/best-mcp-servers-for-ai-coding-2026/ | OK-get | 30155 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/browser-automation-mcp-servers/ | OK-get | 33772 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/chatgpt-openai-codex-mcp/ | OK-get | 32313 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/claude-mcp/ | OK-get | 37093 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/code-intelligence-mcp-servers/ | OK-get | 31296 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/database-vector-analytics-mcp-servers/ | OK-get | 35646 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/git-source-control-mcp-servers/ | OK-get | 36567 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/model-context-protocol/ | OK-get | 31882 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/repowise-codebase-intelligence-guide/ | OK-get | 31502 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/mcp/saas-workflow-productivity-mcp-servers/ | OK-get | 30343 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/news/ | OK-get | 10054 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/news/ai-news-roundup-july-2026/ | OK-get | 30904 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/news/gpt-5-6-sol-in-claude-code/ | OK-get | 28508 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/tools/ | OK-get | 11146 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/tools/cc-switch-codebase-context/ | OK-get | 25254 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/tools/comet-classic-spec-comet-any-eval-guide/ | OK-get | 26872 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/tools/orca-multi-agent-coding/ | OK-get | 39968 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/tools/trellis-agent-harness-guide/ | OK-get | 27772 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/tools/why-i-built-codux/ | OK-get | 28636 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/vibe-coding/ | OK-get | 8626 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/vibe-coding/what-is-vibe-coding-2026/ | OK-get | 22564 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/workflows/ | OK-get | 11847 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/workflows/ai-game-prototype-blender-mcp-fable-5-threejs/ | OK-get | 28495 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/workflows/authority-control-plane-ai-coding-agents/ | OK-get | 39155 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/workflows/claude-dynamic-workflows-on-codex/ | OK-get | 25247 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/workflows/openai-codex-team/ | OK-get | 37032 bytes | 2026-07-28 |
| https://graphify.net/ai-coding/workflows/superpowers-vs-grill-me-ai-planning/ | OK-get | 41725 bytes | 2026-07-28 |
| https://graphify.net/graphify-claude-code-integration.html | OK-get | 6922 bytes | 2026-07-28 |
| https://graphify.net/graphify-cli-commands.html | OK-get | 7578 bytes | 2026-07-28 |
| https://graphify.net/graphify-vs-alternatives.html | OK-get | 7050 bytes | 2026-07-28 |
| https://graphify.net/guides/ | OK-get | 17494 bytes | 2026-07-28 |
| https://graphify.net/knowledge-graph-for-ai-coding-assistants.html | OK-get | 7330 bytes | 2026-07-28 |
| https://graphify.net/leiden-community-detection.html | OK-get | 6741 bytes | 2026-07-28 |
| https://graphify.net/sitemap/ | OK-get | 33535 bytes | 2026-07-28 |
| https://graphify.net/skills/ | OK-get | 12428 bytes | 2026-07-28 |
| https://graphify.net/skills/agent-skills/ | OK-get | 8395 bytes | 2026-07-28 |
| https://graphify.net/skills/andrej-karpathy-skills/ | OK-get | 9064 bytes | 2026-07-28 |
| https://graphify.net/skills/android-reverse-engineering-skill/ | OK-get | 9738 bytes | 2026-07-28 |
| https://graphify.net/skills/anthropics-skills/ | OK-get | 7661 bytes | 2026-07-28 |
| https://graphify.net/skills/antigravity-awesome-skills/ | OK-get | 9064 bytes | 2026-07-28 |
| https://graphify.net/skills/awesome-agent-skills/ | OK-get | 8786 bytes | 2026-07-28 |
| https://graphify.net/skills/awesome-claude-skills/ | OK-get | 8847 bytes | 2026-07-28 |
| https://graphify.net/skills/awesome-codex-skills/ | OK-get | 9648 bytes | 2026-07-28 |
| https://graphify.net/skills/caveman/ | OK-get | 9861 bytes | 2026-07-28 |
| https://graphify.net/skills/claude-skills/ | OK-get | 11711 bytes | 2026-07-28 |
| https://graphify.net/skills/google-skills/ | OK-get | 8624 bytes | 2026-07-28 |
| https://graphify.net/skills/graphify/ | OK-get | 9371 bytes | 2026-07-28 |
| https://graphify.net/skills/guizang-ppt-skill/ | OK-get | 7897 bytes | 2026-07-28 |
| https://graphify.net/skills/huashu-design/ | OK-get | 9458 bytes | 2026-07-28 |
| https://graphify.net/skills/khazix-skills/ | OK-get | 8639 bytes | 2026-07-28 |
| https://graphify.net/skills/marketingskills/ | OK-get | 8550 bytes | 2026-07-28 |
| https://graphify.net/skills/mattpocock-skills/ | OK-get | 8362 bytes | 2026-07-28 |
| https://graphify.net/skills/nature-skills/ | OK-get | 9557 bytes | 2026-07-28 |
| https://graphify.net/skills/nuwa-skill/ | OK-get | 9279 bytes | 2026-07-28 |
| https://graphify.net/skills/skills-manage/ | OK-get | 9036 bytes | 2026-07-28 |
| https://graphify.net/skills/superpowers/ | OK-get | 8987 bytes | 2026-07-28 |
| https://graphify.net/skills/ui-ux-pro-max-skill/ | OK-get | 9232 bytes | 2026-07-28 |
| https://graphify.net/topics/ | OK-get | 12094 bytes | 2026-07-28 |
| https://graphify.net/tree-sitter-ast-extraction.html | OK-get | 6852 bytes | 2026-07-28 |
