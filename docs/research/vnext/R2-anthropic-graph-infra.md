# R2 — Anthropic Graph + Workflow Infrastructure (primary sources)

Research lane R2 for the Foreman vNext "graph engineering systems" swarm.
Fetched 2026-07-28. Local Claude Code build inspected: `@anthropic-ai/claude-code@2.1.220`.

**Verification convention.** `VERIFIED` = I retrieved the artifact and am quoting it. `INFERRED` = my reading, not the source's words. Anything the background note (`SOURCE-karpathy-graph-engineering.txt`) asserts that I could not confirm is called out explicitly in the *Corrections* subsections.

---

## 1. Sources fetched

| URL | Status | Date of source | Notes |
|---|---|---|---|
| `https://github.com/anthropics/claude-cookbooks` → `capabilities/knowledge_graph/guide.ipynb` (raw) | VERIFIED 200 | added 2026-03-23 `cd217ebc`, last touched 2026-03-25 `ef99c70e` | 31 cells; fetched via `raw.githubusercontent.com/anthropics/claude-cookbooks/main/...` |
| `.../capabilities/knowledge_graph/README.md` | VERIFIED 200 | 2026-03 | 459 bytes |
| `.../capabilities/knowledge_graph/evaluation/eval_extraction.py` | VERIFIED 200 | 2026-03 | 4687 bytes, full P/R/F1 harness |
| `.../capabilities/knowledge_graph/evaluation/README.md` | VERIFIED 200 | 2026-03 | baseline score table |
| `.../capabilities/knowledge_graph/data/sample_triples.json` | VERIFIED 200 | 2026-03 | gold set, 2 articles |
| `.../capabilities/knowledge_graph/data/alias_map.json` | VERIFIED 200 | 2026-03 | surface-form → canonical |
| `https://code.claude.com/docs/en/workflows.md` | VERIFIED 200 | current (refs v2.1.219) | Dynamic Workflows user doc |
| `https://code.claude.com/docs/en/agent-sdk/typescript.md` | VERIFIED 200 | current | `Workflow` tool I/O types |
| `https://code.claude.com/docs/en/sub-agents.md` | VERIFIED 200 | current, 91,917 B | grew ~83% vs repo copy |
| `https://code.claude.com/docs/en/agent-teams.md` | VERIFIED 200 | current | |
| `https://code.claude.com/docs/en/agents.md` | VERIFIED 200 | current | comparison page (new) |
| `https://code.claude.com/docs/en/agent-sdk/structured-outputs.md` | VERIFIED 200 | current | JSON Schema draft-07 |
| `https://code.claude.com/docs/llms.txt` / `llms-full.txt` | VERIFIED 200 | current | full 6.4 MB doc corpus |
| `https://www.anthropic.com/engineering/building-effective-agents` | VERIFIED 200 | **Published Dec 19, 2024**, silently refreshed (cites Haiku 4.5 / Sonnet 4.5) | Schluntz & Zhang |
| `https://www.anthropic.com/engineering/managed-agents` | VERIFIED 200 | **Published Apr 08, 2026** | "Scaling Managed Agents: Decoupling the brain from the hands", Martin / Cemaj / Cohen |
| `https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents` | VERIFIED 200 | Nov 26, 2025 | |
| `https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents` | VERIFIED 200 | Jan 09, 2026 | |
| `https://www.anthropic.com/engineering/multi-agent-research-system` | VERIFIED 200 | Jun 13, 2025 | |
| `https://platform.claude.com/docs/en/build-with-claude/citations` | VERIFIED 200 | current | Citations API |
| Claude Code bundle `@anthropic-ai/claude-code@2.1.220/bin/claude.exe` | VERIFIED (binary string extraction) | installed 2026-07-27 | **primary source for the workflow script API and the bundled `/deep-research` + `/code-review` workflow scripts, none of which appear in the public docs** |
| `https://www.anthropic.com/engineering/scaling-managed-agents` | **404 — does not exist** | — | the note's reference [8] title is right, slug is `managed-agents` |
| `https://docs.claude.com/en/docs/claude-code/dynamic-workflows` | **404 — redirects to a dead path** | — | correct path is `code.claude.com/docs/en/workflows` |
| Anthropic page on graph-provenance contracts for agent output | **NOT FOUND** | — | no such publication exists; see §6 |

---

## 2. Knowledge-graph cookbook: verified pipeline + real schemas

Path: `anthropics/claude-cookbooks` → `capabilities/knowledge_graph/{README.md, guide.ipynb, data/, evaluation/}`.
Stated framing (cell 0, verbatim): *"Building one used to mean training a named-entity recognizer on your domain, training a relation classifier, writing entity-resolution heuristics, and maintaining all three as your data shifts. With Claude, each of those stages becomes a prompt."*

### 2.1 Model split (VERIFIED, cell 3)

```python
EXTRACTION_MODEL = "claude-haiku-4-5"
SYNTHESIS_MODEL  = "claude-sonnet-4-6"
```

Rationale, verbatim (cell 4): *"Haiku handles the high-volume, schema-constrained extraction work where speed and cost matter more than nuance. Sonnet handles entity resolution and summarization, where the model needs to weigh conflicting evidence across documents."*

### 2.2 Extraction schemas + prompt (VERIFIED, cell 8 — exact)

```python
EntityType = Literal["PERSON", "ORGANIZATION", "LOCATION", "EVENT", "ARTIFACT"]
ENTITY_TYPES = ["PERSON", "ORGANIZATION", "LOCATION", "EVENT", "ARTIFACT"]


class Entity(BaseModel):
    name: str
    type: EntityType
    description: str


class Relation(BaseModel):
    source: str
    predicate: str
    target: str


class ExtractedGraph(BaseModel):
    entities: list[Entity]
    relations: list[Relation]


EXTRACTION_PROMPT = """Extract a knowledge graph from the document below.

<document>
{text}
</document>

Guidelines:
- Extract only entities that are central to what this document is about — skip incidental mentions.
- For each entity, write a one-sentence description grounded in this document. These descriptions are used later to disambiguate entities with similar names.
- Predicates should be short verb phrases ("commanded", "launched from", "part of").
- Every relation must connect two entities you extracted."""


def extract(text: str) -> ExtractedGraph:
    response = client.messages.parse(
        model=EXTRACTION_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": EXTRACTION_PROMPT.format(text=text)}],
        output_format=ExtractedGraph,
    )
    return response.parsed_output
```

Three design points worth transferring, all stated in the source:
1. **The one-sentence `description` is not decoration — it is the entity-resolution feature.** The prompt says so explicitly ("These descriptions are used later to disambiguate…"). Extraction and resolution are coupled through it.
2. **Predicates are constrained to short verb phrases** by prompt, not by enum. Relation types are open-vocabulary.
3. **Closure invariant**: "Every relation must connect two entities you extracted." Enforced only by prompt; the assembly step re-enforces it by dropping unresolvable endpoints.

`client.messages.parse(..., output_format=...)` — note the repo migrated *away* from `tool_choice` to structured outputs on 2026-03-25 (`5b1c896e feat(knowledge_graph): migrate tool_choice to structured outputs, fix source_docs init`). Structured outputs are now the sanctioned extraction mechanism.

### 2.3 Entity resolution (VERIFIED, cell 13 — exact)

```python
class Cluster(BaseModel):
    canonical: str
    aliases: list[str]


class ResolvedClusters(BaseModel):
    clusters: list[Cluster]


RESOLVE_PROMPT = """Below are {entity_type} entities extracted from several documents. Some are different surface forms of the same real-world entity.

<entities>
{entity_list}
</entities>

Cluster them. Each input name must appear in exactly one cluster's aliases list. Entities that are genuinely distinct get their own single-element cluster. Use the descriptions to avoid merging entities that merely share a name. The canonical name should be the most complete, unambiguous form."""


def resolve(entity_type: str, entities: list[dict]) -> list[Cluster]:
    unique = {}
    for e in entities:
        unique.setdefault(e["name"], e["description"])
    entity_list = "\n".join(f"- {name}: {desc}" for name, desc in unique.items())

    response = client.messages.parse(
        model=SYNTHESIS_MODEL,
        max_tokens=2048,
        messages=[{"role": "user",
                   "content": RESOLVE_PROMPT.format(entity_type=entity_type, entity_list=entity_list)}],
        output_format=ResolvedClusters,
    )
    return response.parsed_output.clusters
```

**Blocking**: the notebook blocks by `entity_type` only (cell 15 loops `for etype in ENTITY_TYPES`). Cheap-signal blocking is deferred to the scaling section (cell 29, verbatim): *"Feeding ten thousand PERSON entities to Claude in one prompt doesn't work. Block first: group candidates by cheap signals (same last name, overlapping tokens, embedding similarity) so Claude only arbitrates within small blocks. The resolution prompt above works unchanged on blocks of 50–100."*

**Arbitration model**: Sonnet 4.6 (`SYNTHESIS_MODEL`). Extraction is Haiku. So the cookbook's real pattern is *cheap extractor + expensive arbiter*, not one model throughout.

**Stated failure modes (cell 14, verbatim)** — this is the most transferable paragraph in the notebook:
> "Two failure modes to watch for. First, any raw name Claude leaves out of every cluster silently disappears from the graph, because `alias_to_canonical` has no entry for it — a production resolver should fall back to a single-element cluster for unmatched names so nothing is lost. Second, the resolver can **over-merge**: a specific mission like 'Gemini 12' may get folded into the broader 'Project Gemini' because the descriptions overlap. The first loses nodes, the second loses precision."

**Degradation path (cell 15, verified)** — on API error the resolver degrades to identity, it does not abort:

```python
    except anthropic.APIError as e:
        print(f"Resolve failed for {etype}: {e}; treating each name as its own cluster")
        clusters = [Cluster(canonical=n, aliases=[n]) for n in {x["name"] for x in entities_of_type}]
```

### 2.4 NetworkX assembly (VERIFIED, cell 17 — exact)

```python
G = nx.MultiDiGraph()

for e in raw_entities:
    canonical = alias_to_canonical.get(e["name"])
    if canonical is None:
        continue
    if canonical not in G:
        G.add_node(
            canonical,
            type=canonical_info[canonical]["type"],
            description=e["description"],
            source_docs=[],
            mentions=0,
        )
    G.nodes[canonical]["source_docs"].append(e["source_doc"])
    G.nodes[canonical]["mentions"] += 1

for r in raw_relations:
    src = alias_to_canonical.get(r["source"])
    tgt = alias_to_canonical.get(r["target"])
    if src and tgt and src != tgt:
        G.add_edge(src, tgt, predicate=r["predicate"], source_doc=r["source_doc"])

for n in G.nodes:
    G.nodes[n]["source_docs"] = sorted(set(G.nodes[n]["source_docs"]))
```

`MultiDiGraph` justification, verbatim (cell 16): *"two entities can be connected by several distinct predicates … and direction matters."*
Provenance carried: **node** → `source_docs` (list), `mentions` (count); **edge** → `predicate`, `source_doc`. That's it.

### 2.5 Node enrichment (VERIFIED, cell 21)

```python
class TimeRange(BaseModel):
    start: str   # YYYY or YYYY-MM, or "unknown"
    end: str     # YYYY or YYYY-MM, or "ongoing"


class EntityProfile(BaseModel):
    summary: str
    key_facts: list[str]
    time_range: TimeRange
```

Prompt constraint, verbatim: *"resolving any contradictions by preferring the most specific claim. Include 3-5 atomic key facts, each traceable to the sources. … Do not invent facts not supported by the excerpts."* The profile agent is fed *both* raw excerpts and the node's in/out edges — graph structure is context for summarization, not just an output.

Applied selectively: `hub_nodes = [n for n, _ in sorted(G.degree(), key=lambda x: -x[1])[:3]]` — only top-3 by degree. Enrichment is degree-gated, not universal.

### 2.6 Querying / serialization (VERIFIED, cell 24 — exact)

```python
def serialize_subgraph(center: str, hops: int = 2) -> str:
    nodes = {center}
    frontier = {center}
    for _ in range(hops):
        nxt = set()
        for n in frontier:
            nxt |= set(G.successors(n)) | set(G.predecessors(n))
        frontier = nxt - nodes
        nodes |= frontier
    sub = G.subgraph(nodes)
    lines = [f"({s}) --[{d['predicate']}]--> ({t})" for s, t, d in sub.edges(data=True)]
    return "\n".join(sorted(set(lines)))
```

The query prompt is one line and does all the provenance work:

```python
prompt = f"""Answer using only the knowledge graph below. Cite the specific edges that support your answer.

<graph>
{graph_context}
</graph>

Question: {question}"""
```

Notable: BFS is **frontier-only** (a deliberate fix, commit `57d13918 fix(knowledge_graph): frontier-only BFS`), edges are **deduplicated and sorted** before serialization (determinism), and the notebook runs the same question with and without graph context as an A/B. Cell 26, verbatim: *"the grounded answer is **traceable**: every claim cites an edge we extracted from a specific document. On a private corpus where Claude has no prior knowledge, only the grounded answer works at all."*

### 2.7 Evaluation (VERIFIED — `evaluation/eval_extraction.py` + cell 28)

```python
def prf(predicted: set, gold: set) -> tuple[float, float, float]:
    tp = len(predicted & gold)
    p = tp / len(predicted) if predicted else 0.0
    r = tp / len(gold) if gold else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return p, r, f1
```

Relation scoring — **predicate wording ignored** (verbatim, `evaluation/README.md`):
> "a relation counts as a true positive if both canonicalized endpoints match a gold (source, target) pair. **Predicate wording is ignored**: 'commanded' and 'was commander of' both count, but so would a semantically wrong predicate like 'destroyed' between the same two entities. This makes the reported relation recall an upper bound … For stricter scoring you would add a predicate-similarity check (e.g. a Claude judge call per candidate pair)."

Published baseline with `claude-haiku-4-5`:

| Metric | P | R | F1 |
|---|---|---|---|
| Entities | 0.80–0.90 | 0.70–0.85 | 0.75–0.85 |
| Relations | 0.70–0.85 | 0.55–0.70 | 0.60–0.75 |

And the honest caveat about scoring resolved output (cell 27, verbatim): *"When it picks a verbose form the alias map doesn't cover — say 'Neil Alden Armstrong' — resolved recall can *drop*… That's not a resolver bug; it's a scoring artifact."*

The eval harness is presented as the point of the exercise (cell 30): *"The evaluation harness in `evaluation/` gives you a feedback loop: change the extraction prompt, rerun the scorer, watch the F1 move. That loop is what turns a demo into a production system."*

### 2.8 Storage / scale guidance (VERIFIED, cell 29)

Verbatim: *"NetworkX is fine to a few hundred thousand edges. Beyond that, the schema maps directly onto a property graph (Neo4j, Neptune) or three Postgres tables: `entities(id, name, type, summary)`, `relations(source_id, target_id, predicate)`, `aliases(entity_id, alias)`. The extraction and resolution code doesn't change — only the persistence layer does."*
Incremental updates: *"extract its entities, resolve them against the existing canonical set (not against each other), and add only the new edges. Re-summarize an entity only when its source-document set changes materially."*
Cost: prompt caching for the fixed schema/instructions; Message Batches API for 50% off ≤24h jobs.

### 2.9 CORRECTIONS to the background note

The synthesis note's code excerpts are **paraphrases with invented fields**, not the cookbook. Concretely:

| Note claims | Cookbook actually has |
|---|---|
| `add_relation(...)` carries `confidence=relation.confidence` | `Relation` has **no `confidence` field**. Edges carry `predicate` + `source_doc` only. |
| `add_entity(entity, source_doc)` with `entity.canonical_id`, `aliases=set(...)`, `source_docs={source_doc}` | Nodes keyed by canonical **name string**; attrs are `type`, `description`, `source_docs` (list, later `sorted(set(...))`), `mentions`. No `canonical_id`, no `aliases` on the node. |
| `EXTRACTION` model `claude-haiku-4-5` ✓ | correct |
| resolution model "Sonnet" ✓ | `claude-sonnet-4-6` |
| "cheap blocking signals should narrow the candidate set before model arbitration" ✓ | correct — but it's the *scaling* recommendation, not implemented in the notebook |
| "A canonical entity should retain its aliases, source documents, resolution rationale, confidence, and the run that created the merge" | **Not in the cookbook.** `Cluster` has `canonical` + `aliases` only. No rationale, no confidence, no run id. This is the note's own proposal. |

Also: the note's `Entity(BaseModel)` omits nothing, but its `def extract(text, client)` signature and `PROMPT` differ from both the notebook (`extract(text)`, `EXTRACTION_PROMPT` with 4 guidelines) and the standalone scorer (`extract(client, text)`, a 2-sentence `PROMPT`). Use the notebook's, and note the scorer deliberately uses a *shorter* prompt.

---

## 3. Dynamic Workflows: verified contract + limits

Two source tiers. The public doc (`code.claude.com/docs/en/workflows`) is user-facing. The **real contract** is the `Workflow` tool description embedded in the CC 2.1.220 bundle, which is what Claude actually reads when authoring a script. Everything in §3.2–§3.5 is VERIFIED by extraction from that bundle.

### 3.1 Public-doc facts (VERIFIED)

- Requires Claude Code **v2.1.154+**; all paid plans, Anthropic API, Bedrock, Google Agent Platform, Microsoft Foundry.
- A workflow is *"a JavaScript script that orchestrates subagents at scale. Claude writes the script … and a runtime executes it in the background while your session stays responsive."*
- The pitch, verbatim: *"A workflow script holds the loop, the branching, and the intermediate results itself, so Claude's context holds only the final answer."*
- Triggers: keyword `ultracode` in a **human-typed** prompt, `/effort ultracode` session mode, natural-language ask ("use a workflow"), a skill/command that calls it, or a named saved workflow. Explicitly **not** triggered by `-p`, an SDK prompt lacking `origin: {kind:"human"}`, a scheduled task, or a webhook/PR-comment relay (since v2.1.210).
- Subagents spawned by a workflow **always run in `acceptEdits`** and inherit the session tool allowlist regardless of the session's permission mode. File edits auto-approved; non-allowlisted shell/web/MCP calls can still prompt mid-run.
- Storage: `.claude/workflows/` (project, monorepo-aware since v2.1.178 — nearest `.claude/workflows/` wins) or `~/.claude/workflows/` (personal, honours `CLAUDE_CONFIG_DIR`). Project beats personal on name collision. Plugin workflows are namespaced `/<plugin>:<name>`.
- Size guideline (advice to the *author*, not a runtime cap): `small` <5 agents, `medium` <15 (**default since v2.1.219**), `large` <50, `unrestricted`. Settable via `workflowSizeGuideline` in any settings file (takes precedence over `/config`).
- Cost warning: a run scheduling >25 agents **or** projected >1.5M tokens shows a `Large workflow` advisory (v2.1.203+). Advisory only — it does not pause the run. Suppressed under ultracode.
- Kill switches: `/config` toggle, `"disableWorkflows": true` (user or managed settings), `CLAUDE_CODE_DISABLE_WORKFLOWS=1`.

### 3.2 Script API surface — VERBATIM from the bundle

> **`agent(prompt: string, opts?: {label?, phase?, schema?, model?, effort?, isolation?: 'worktree', agentType?}): Promise<any>`** — spawn a subagent. Without schema, returns its final text as a string. With schema (a JSON Schema), the subagent is forced to call a StructuredOutput tool and `agent()` returns the validated object — no parsing needed. Returns `null` if the user skips the agent mid-run or the subagent dies on a terminal API error after retries (filter with `.filter(Boolean)`).
> `opts.phase` explicitly assigns this agent to a progress group (use this inside `pipeline()`/`parallel()` stages to avoid races on the global `phase()` state).
> `opts.model` — *"Default to omitting it — the agent inherits the main-loop model … Only set it when you're highly confident a different tier fits the task; when unsure, omit."*
> `opts.effort` — `'low' | 'medium' | 'high' | 'xhigh' | 'max'`; *"use 'low' for cheap mechanical stages and higher tiers only for the hardest verify/judge stages."*
> `opts.isolation: 'worktree'` — *"EXPENSIVE (~200-500ms setup + disk per agent), use ONLY when agents mutate files in parallel and would otherwise conflict; the worktree is auto-removed if unchanged."*
> `opts.agentType` — a custom subagent type, *"resolved from the same registry as the Agent tool; composes with schema (the custom agent's system prompt gets a StructuredOutput instruction appended)."*

> **`pipeline(items, stage1, stage2, ...): Promise<any[]>`** — run each item through all stages independently, **NO barrier between stages**. Item A can be in stage 3 while item B is still in stage 1. *"This is the DEFAULT for multi-stage work. Wall-clock = slowest single-item chain, not sum-of-slowest-per-stage."* Every stage callback receives `(prevResult, originalItem, index)`. *"A stage that throws drops that item to `null` and skips its remaining stages."*

> **`parallel(thunks: Array<() => Promise<any>>): Promise<any[]>`** — *"This is a BARRIER. … A thunk that throws (or whose agent errors) resolves to `null` in the result array — the call itself never rejects, so `.filter(Boolean)` before using the results. Use ONLY when you genuinely need all results together."*

> **`log(message: string): void`** — emit a progress message (narrator line above the progress tree).
> **`phase(title: string): void`** — start a new phase; subsequent `agent()` calls group under it.
> **`args: any`** — the `Workflow` tool's `args` input, verbatim; `undefined` if absent.

> **`budget: {total: number|null, spent(): number, remaining(): number}`** — *"the turn's token target from the user's '+500k'-style directive. `budget.total` is null if no target was set. `budget.spent()` returns output tokens spent this turn across the main loop and all workflows — **the pool is shared, not per-workflow**. `budget.remaining()` returns `max(0, total - spent())`, or `Infinity` if no target. The target is a HARD ceiling, not advisory: once `spent()` reaches `total`, further `agent()` calls throw."*

> **`workflow(nameOrRef: string | {scriptPath: string}, args?): Promise<any>`** — run another workflow inline. *"The child shares this run's concurrency cap, agent counter, abort signal, and token budget… **Nesting is one level only: `workflow()` inside a child throws.**"*

**This `workflow()` primitive is absent from the public docs.** It is the composition primitive Foreman would need for phase chaining.

### 3.3 Hard limits — VERBATIM

> "Concurrent `agent()` calls are capped at **min(16, cpu cores - 2)** per workflow — excess calls queue and run as slots free up. You can still pass 100 items to `parallel()`/`pipeline()` and they all complete; only ~10 run at any moment. Total agent count across a workflow's lifetime is capped at **1000** — a runaway-loop backstop set far above any real workflow. A single `parallel()`/`pipeline()` call accepts **at most 4096 items**; passing more is an explicit error, not a silent truncation."

Bundle constants confirm: `s6y=16` (concurrency), `WSd=1000` (agent cap), size map `{small:5, medium:15, large:50}`, default `"medium"`.

Two error classes are named in the binary:

```
WorkflowAgentCapError:
  "Workflow agent() call cap reached (1000). This usually means a loop using budget.remaining()
   never terminates because no token budget was set — remaining() returns Infinity when
   budget.total is null. Add a hard iteration cap to the loop, or pass a token budget."

WorkflowBudgetExceededError:
  "Workflow token budget exceeded (N / M output tokens). Stopping further agent() calls.
   In-flight agents will complete; their results are preserved."
```

Budget-dropped slots resolve to `null` and are **counted and logged**, not silently swallowed: `"parallel: N slots dropped — token budget exceeded"`.

### 3.4 Determinism constraints (VERBATIM) — this is the resume contract

> "Scripts are plain JavaScript, NOT TypeScript — type annotations (`: string[]`), interfaces, and generics fail to parse. … Standard JS built-ins (JSON, Math, Array, etc.) are available — **EXCEPT `Date.now()`/`Math.random()`/argless `new Date()`, which throw (they would break resume)**; pass timestamps in via `args`, stamp results after the workflow returns, and for randomness vary the agent prompt/label by index. **No filesystem or Node.js API access.**"

The `meta` block must be a **pure literal** — no variables, calls, spreads, or template interpolation. Required `name`, `description`; optional `whenToUse`, `phases`. Phase titles are matched **exactly** against `phase()` calls.

The deep-research script notes the sandbox is *"a bare ECMAScript realm — no URL global"* — even `URL` is absent, forcing a hand-written host-parsing regex.

### 3.5 Resume / journal semantics (VERBATIM)

> "The tool result includes a `runId`. To resume after a pause, kill, or script edit, relaunch with `Workflow({scriptPath, resumeFromRunId})` — **the longest unchanged prefix of `agent()` calls returns cached results instantly; the first edited/new call and everything after it runs live. Same script + same args → 100% cache hit.** Before diagnosing why a completed workflow returned an empty or unexpected result, **Read `<transcriptDir>/journal.jsonl` — it records each agent's actual return value; do not assume cached results are non-empty.** … Fallback when no journal is available: Read `agent-<id>.jsonl` files in the transcript directory and hand-author a continuation script."

Public doc adds: an agent still running when you stop is **not** saved and restarts on resume — *"a workflow that fans work out across many small agents preserves more progress than one long agent."* Resume is same-session only; exiting Claude Code loses it. There is also a checkpoint-adoption path that pins `scriptSha256` and refuses to resume if the script content changed since approval.

`WorkflowOutput` (SDK v0.3.149+):

```typescript
type WorkflowOutput = {
  status: "async_launched";
  taskId: string;
  runId?: string;
  summary?: string;
  transcriptDir?: string;
  scriptPath?: string;
  error?: string;
};
```

> "Check `error` before treating the run as started: a script that fails its syntax check returns `status: "async_launched"` with `error` set, and never runs."

### 3.6 Structured-output forcing

- In a workflow: `opts.schema` (JSON Schema) forces the subagent into a `StructuredOutput` tool call. The subagent's system prompt is replaced with a variant whose first line is: *"CRITICAL: You MUST call the StructuredOutput tool exactly once to return your final answer. … Do NOT put your answer in a text response. The script reads ONLY the StructuredOutput tool call. If the schema validation fails, read the error and call it again with a corrected shape."* Validation happens at the tool-call layer, so retries are automatic.
- Without a schema, the subagent gets a different prompt: *"Your final text response is returned **verbatim** as a string to the calling script — it is your return value, not a message to a human. … If asked for JSON, return ONLY the raw JSON — no code fences, no prose, no markdown."*
- Agent SDK (out-of-workflow): `outputFormat` / `output_format` with `{type: "json_schema", schema}`, validated against **JSON Schema draft-07** (Zod needs `z.toJSONSchema(X, {target: "draft-7"})`; newer declared drafts are rejected). Retry-then-error on persistent mismatch; terminal reason `structured_output_retry_exhausted`.

### 3.7 CORRECTIONS to the background note

- Note: *"up to 16 concurrent sub-agents"* → actual cap is **`min(16, cpu_cores - 2)`**, and the bundle's own example says "only ~10 run at any moment". On a 12-core box you get 10, not 16.
- Note's example uses `gather(..., {concurrency: 16})` and `spawn("auditor", {...})`. **No such API exists.** The real primitives are `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, plus the `args`/`budget` globals. Concurrency is not a per-call parameter — it is a global runtime cap you cannot raise.
- Note: *"trigger via word 'workflow' or ultracode mode"* → the literal keyword was `workflow` only **before v2.1.160**; it is `ultracode` now (natural-language asks work in both).
- Note: *"intermediate state in script variables"* ✓ correct and load-bearing.
- The note's "Dynamic Workflows are expensive" section is directionally right; the concrete anchor is the 25-agent / 1.5M-token advisory threshold and the shared token pool.

---

## 4. Workflow patterns and their stated failure modes

### 4.1 Building Effective Agents (Schluntz & Zhang, Dec 19 2024 — page silently refreshed; now cites Haiku 4.5 / Sonnet 4.5)

The five patterns plus the augmented-LLM building block plus autonomous agents. What matters for Foreman is the **anti-structure guidance**, verbatim:

> "When building applications with LLMs, we recommend finding the simplest solution possible, and only increasing complexity when needed. This might mean not building agentic systems at all. **Agentic systems often trade latency and cost for better task performance**, and you should consider when this tradeoff makes sense."

> "workflows offer predictability and consistency for well-defined tasks, whereas agents are the better option when flexibility and model-driven decision-making are needed at scale. For many applications, however, optimizing single LLM calls with retrieval and in-context examples is usually enough."

> "[Frameworks] often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug. They can also make it tempting to add complexity when a simpler setup would suffice. … **Incorrect assumptions about what's under the hood are a common source of customer error.**"

> "you should consider adding complexity *only* when it demonstrably improves outcomes."

> "The autonomous nature of agents means higher costs, and the potential for **compounding errors**. We recommend extensive testing in sandboxed environments, along with the appropriate guardrails."

Per-pattern fit conditions (verbatim fragments):
- **Prompt chaining** — *"ideal for situations where the task can be easily and cleanly decomposed into fixed subtasks. The main goal is to trade off latency for higher accuracy."* Programmatic "gate" checks on intermediate steps.
- **Routing** — *"works well … where classification can be handled accurately."* Failure mode is implicit: inaccurate classification poisons everything downstream. Stated benefit: *"Without this workflow, optimizing for one kind of input can hurt performance on other inputs."*
- **Parallelization** — sectioning vs voting. *"For complex tasks with multiple considerations, LLMs generally perform better when each consideration is handled by a separate LLM call."* Guardrail example is explicit that splitting beats combining: *"This tends to perform better than having the same LLM call handle both guardrails and the core response."*
- **Orchestrator-workers** — *"well-suited for complex tasks where you can't predict the subtasks needed."* Distinguished from parallelization by subtasks not being pre-defined.
- **Evaluator-optimizer** — two stated fit signals: *"first, that LLM responses can be demonstrably improved when a human articulates their feedback; and second, that the LLM can provide such feedback."* If either fails, don't build the loop.

Three closing principles: **simplicity**, **transparency** (*"explicitly showing the agent's planning steps"*), and a carefully crafted **agent-computer interface (ACI)** with tool docs and testing.

**No 2026 successor exists** under a new URL. `/engineering/` currently lists 24 posts; the successors in spirit are `effective-harnesses-for-long-running-agents` (Nov 2025), `demystifying-evals-for-ai-agents` (Jan 2026), and `managed-agents` (Apr 2026). The note's reference [11] "Building Effective AI Agents: Architecture Patterns, 2026" does **not** resolve to anything on anthropic.com — treat as unverifiable.

### 4.2 The bundle's own pattern catalogue (VERBATIM, CC 2.1.220) — newer and far more prescriptive

This is the strongest find in the lane. Anthropic ships an opinionated pattern library inside the `Workflow` tool description:

> - **Adversarial verify**: spawn N independent skeptics per finding, each prompted to REFUTE. Kill if ≥majority refute. Prevents plausible-but-wrong findings from surviving.
> - **Perspective-diverse verify**: when a finding can fail in more than one way, give each verifier a distinct lens (correctness, security, perf, does-it-reproduce) instead of N identical refuters — **diversity catches failure modes redundancy can't**.
> - **Judge panel**: generate N independent attempts from different angles (e.g. MVP-first, risk-first, user-first), score with parallel judges, synthesize from the winner while grafting the best ideas from runners-up. **Beats one-attempt-iterated when the solution space is wide.**
> - **Loop-until-dry**: for unknown-size discovery, keep spawning finders until K consecutive rounds return nothing new. **Simple counters (`while count < N`) miss the tail.**
> - **Multi-modal sweep**: parallel agents each searching a different way (by-container, by-content, by-entity, by-time). Each is blind to what the others surface.
> - **Completeness critic**: a final agent that asks "what's missing — modality not run, claim unverified, source unread?" What it finds becomes the next round of work.
> - **No silent caps**: if a workflow bounds coverage (top-N, no-retry, sampling), `log()` what was dropped — **silent truncation reads as "covered everything" when it didn't**.

And the anti-barrier discipline, verbatim:

> "A barrier is correct ONLY when stage N needs cross-item context from all of stage N-1: dedup/merge across the full result set…; early-exit if the total count is zero…; stage N's prompt references 'the other findings'.
> A barrier is NOT justified by: 'I need to flatten/map/filter first' … 'The stages are conceptually separate' — that's what `pipeline()` models. Separate stages ≠ synchronized stages. 'It's cleaner code' — **barrier latency is real. If 5 finders run and the slowest takes 3× the fastest, a barrier wastes 2/3 of the fast finders' idle time.**"

Plus a convergence bug named explicitly in the composed example:

> "dedup vs `seen`, NOT `confirmed` — else judge-rejected findings reappear every round and it never converges."

And a scale rule: *"'find any bugs' → a few finders, single-vote verify. 'thoroughly audit this' or 'be comprehensive' → larger finder pool, 3–5 vote adversarial pass, synthesis stage."*

Finally, the tool description's own gate on when *not* to orchestrate: *"ONLY call this tool when the user has explicitly opted into multi-agent orchestration. … For any other task — even one that would clearly benefit from parallelism — do NOT call this tool."* That is Building-Effective-Agents' "don't add structure" principle re-encoded as a runtime permission rule.

---

## 5. Provenance / evidence-contract practice

### 5.1 The bundled `/deep-research` workflow — the reference evidence contract (VERIFIED, extracted from CC 2.1.220)

Header comment, verbatim: `// deep-research: Scope → pipeline(Search → URL-dedup → Fetch+Extract) → 3-vote Verify → Synthesize`. Constants:

```javascript
const VOTES_PER_CLAIM = 3
const REFUTATIONS_REQUIRED = 2
const MAX_FETCH = 15
const MAX_VERIFY_CLAIMS = 25
```

The claim schema is the evidence contract — **a claim is not text, it is a tuple of (statement, verbatim quote, source, source-quality, importance)**:

```javascript
const EXTRACT_SCHEMA = {
  type: "object", required: ["claims", "sourceQuality"],
  properties: {
    sourceQuality: { enum: ["primary", "secondary", "blog", "forum", "unreliable"] },
    publishDate: { type: "string" },
    claims: { type: "array", maxItems: 5, items: {
      type: "object", required: ["claim", "quote", "importance"],
      properties: {
        claim:      { type: "string" },
        quote:      { type: "string" },
        importance: { enum: ["central", "supporting", "tangential"] },
      },
    }},
  },
}

const VERDICT_SCHEMA = {
  type: "object", required: ["refuted", "evidence", "confidence"],
  properties: {
    refuted:       { type: "boolean" },
    evidence:      { type: "string" },
    confidence:    { enum: ["high", "medium", "low"] },
    counterSource: { type: "string" },
  },
}

const REPORT_SCHEMA = {
  type: "object", required: ["summary", "findings", "caveats"],
  properties: {
    summary: { type: "string" },
    findings: { type: "array", items: {
      type: "object", required: ["claim", "confidence", "sources", "evidence"],
      properties: {
        claim:      { type: "string" },
        confidence: { enum: ["high", "medium", "low"] },
        sources:    { type: "array", items: { type: "string" } },
        evidence:   { type: "string" },
        vote:       { type: "string" },
      },
    }},
    caveats:       { type: "string" },
    openQuestions: { type: "array", items: { type: "string" } },
  },
}
```

Extraction prompt requires **falsifiable** claims, verbatim: *"Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must: be a concrete, checkable statement (not vague generalities); include a direct quote from the source as support; be rated central/supporting/tangential."* Fetch failure → `claims: []` and `sourceQuality: "unreliable"`, not an error.

The adversarial verifier prompt has a **five-item checklist and a default-deny rule**, verbatim:

> "Be SKEPTICAL. Try to REFUTE this claim. ≥2/3 refutations kill it. …
> 1. Is the claim actually supported by the quote, or is it an overreach/misread?
> 2. WebSearch for contradicting evidence — does any credible source dispute or heavily qualify this?
> 3. Is the source quality sufficient for the claim's strength? (extraordinary claims need primary sources)
> 4. Is the claim outdated? (check dates — old claims about fast-moving fields are suspect)
> 5. Is this a marketing claim / press release / cherry-picked benchmark / forum speculation?
> **refuted=true** if: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.
> **refuted=false** ONLY if: claim is well-supported, current, and source quality matches claim strength.
> **Default to refuted=true if uncertain.** … Evidence MUST be specific."

**The three-outcome adjudication is the single most transferable idea in this lane** — infra failure must not read as refutation:

```javascript
// Three outcomes (infra failure must not read as "refuted"):
//   survives  — quorum of valid votes AND fewer than REFUTATIONS_REQUIRED refuting
//   isRefuted — ≥REFUTATIONS_REQUIRED refute votes (adjudicated against on merit)
//   otherwise — unverified: too few valid votes to adjudicate (verifier agents errored)
const valid     = verdicts.filter(Boolean)
const refuted   = valid.filter(v => v.refuted).length
const errored   = VOTES_PER_CLAIM - valid.length
const survives  = valid.length >= REFUTATIONS_REQUIRED && refuted < REFUTATIONS_REQUIRED
const isRefuted = refuted >= REFUTATIONS_REQUIRED
```

The public doc confirms this shipped as a bugfix: *"As of v2.1.196, when the verifier agents can't check a claim, such as after a rate limit or API error, the report lists that claim as unverified instead of counting it as refuted."*

The returned artifact carries the full audit trail — surviving findings, **refuted claims with vote counts (published for transparency)**, unverified claims with error counts, every source with its quality rating and claim count, and a `stats` block including `urlDupes`, `budgetDropped`, and a computed `agentCalls`. There is also a salvage path: if synthesis fails, it returns the verified claims raw rather than throwing.

Security detail worth stealing: the script hand-rolls a WHATWG-conformant URL host regex because the sandbox has no `URL` global, and strips C0/C1 controls, bidi overrides, zero-width chars, and the entire double-quote lookalike family from any label built from fetched web content before it reaches a terminal.

### 5.2 The bundled `/code-review` workflow (VERIFIED, same bundle)

Phases: `Scope → Find → Verify → Sweep → Synthesize`. One finder per correctness angle plus one covering all cleanup angles; **one independent verifier per distinct `(file, line)` location** across the pooled candidates; verdicts `CONFIRMED / PLAUSIBLE / REFUTED`; a fresh gap-hunting "Sweep" finder at xhigh/max only.

Synthesis is done **by index, never by re-emitting text**: *"Return decisions about findings BY INDEX — never re-emit finding text."* This prevents the synthesizer from silently rewriting evidence. Explicit assembler invariants in the script:

```
// Assembler invariants:
//   1. No silent drops while there is room: every verified finding either appears
//      (as primary or merge note) or is omitted only because the cap is full.
//   2. The displayed primary is the synthesizer's choice (d.index) — it picks the
//      best-described representative; we only escalate the verdict label when a
//      merged member is CONFIRMED.
//   3. The summary describes the report actually returned.
```

Plus a backfill loop so findings the synthesizer failed to claim still reach the report, and a summary suffix that discloses it (`"(N additional verified finding(s) appended unmerged.)"`).

### 5.3 Citations API (VERIFIED)

`https://platform.claude.com/docs/en/build-with-claude/citations`. Set `citations.enabled=true` per document (all-or-none within a request); documents are chunked to define citation granularity; responses come back as multiple text blocks, each a claim plus the list of citations supporting it, with `cited_text` extracted by the API. Stated advantages over prompting for citations, verbatim: *"Because the API parses citations into the response formats … and extracts `cited_text` directly, citations are guaranteed to contain valid pointers to the provided documents"* and *"In Anthropic's evaluations, the citations feature is significantly more likely to cite the most relevant quotes from documents than purely prompt-based approaches."* Text only — image citations unsupported.

### 5.4 Subagent output scanning (VERIFIED, sub-agents doc)

A provenance mechanism I did not expect. Claude Code scans every subagent's final report **before the parent reads it** (v2.1.210+). It never rewords; it (a) backslash-escapes text imitating harness output (`<system-reminder>`, `Human:`, `Assistant:`) and (b) prepends `[harness: subagent output matched instruction-shaped pattern(s): …]` when a report imitates a tag or mentions `bypassPermissions` / `--dangerously-skip-permissions`. Explicit caveat: *"The scan doesn't judge whether content is malicious, and it doesn't change what an instruction in a report can do."* This is a **taint marker on the handoff boundary**, not a filter.

### 5.5 What Anthropic does NOT publish

There is no Anthropic publication on graph-structured provenance for agent outputs. The background note's Table (`Node types: Entity, Claim, Source, Artifact, AgentRun, Evaluation, Task, Commit, Metric`; `Edge types: MENTIONS, SUPPORTS, CONTRADICTS, DERIVED_FROM, PRODUCED, EVALUATES, REVISES, SUPERSEDES, DEPENDS_ON, PARENT_OF, RESOLVED_TO`) and the four graph-write invariants are **the note's own synthesis, not Anthropic's**. They are good — but they must not be cited as Anthropic guidance in Foreman docs. The nearest real Anthropic artifacts are: the cookbook's node/edge attrs (§2.4), `/deep-research`'s claim tuple (§5.1), and the Citations API (§5.3).

---

## 6. Scaling Managed Agents / subagents / agent teams (2026)

### 6.1 "Scaling Managed Agents: Decoupling the brain from the hands" — Apr 08 2026, Martin / Cemaj / Cohen (VERIFIED)

Correct URL: `https://www.anthropic.com/engineering/managed-agents` (not `/scaling-managed-agents`, which 404s).

Thesis, verbatim: *"harnesses encode assumptions about what Claude can't do on its own. However, those assumptions need to be frequently questioned because they can go stale as models improve."* The worked example is deletion of a feature: context resets added to fight Sonnet 4.5's "context anxiety" *"had become dead weight"* on Opus 4.5.

Three virtualized interfaces:
- **session** — the append-only event log, living *outside* the harness and outside the context window. Interfaces: `getSession(id)`, `getEvents()`, `emitEvent(id, event)`, `wake(sessionId)`.
- **harness** — the loop calling Claude and routing tool calls. Stateless, disposable: *"nothing in the harness needs to survive a crash."*
- **sandbox** — `execute(name, input) → string`, `provision({resources})`.

The pets-vs-cattle framing is the design argument, verbatim: *"if a container failed, the session was lost … an engineer had to open a shell inside the container, but because that container often also held user data, that approach essentially meant we lacked the ability to debug."*

On context, verbatim and directly relevant to graph memory:
> "irreversible decisions to selectively retain or discard context can lead to failures. It is difficult to know which tokens the future turns will need. … the session provides this same benefit, serving as a context object that lives outside Claude's context window. … The interface, `getEvents()`, allows the brain to interrogate context by selecting positional slices of the event stream … picking up from wherever it last stopped reading, rewinding a few events before a specific moment to see the lead up, or rereading context before a specific action."

Separation of concerns, verbatim: *"We separated the concerns of recoverable context storage in the session and arbitrary context management in the harness because we can't predict what specific context engineering will be required in future models."*

Security: credentials are never reachable from the sandbox — repo tokens are used at sandbox-init to wire the git remote, MCP OAuth tokens live in a vault behind a proxy keyed by session. *"The harness is never made aware of any credentials."* Rationale, verbatim: *"Narrow scoping is an obvious mitigation, but this encodes an assumption about what Claude can't do with a limited token — and Claude is getting increasingly smart. The structural fix is to make sure the tokens are never reachable from the sandbox."*

Measured result: decoupling dropped **p50 TTFT ~60%, p95 >90%** because containers are provisioned lazily by tool call.

### 6.2 Subagents (VERIFIED, current doc — grew from 50 KB to 92 KB vs the repo copy)

- Context isolation, verbatim: *"Each subagent starts with a fresh, isolated context window. It doesn't see your conversation history, the skills you've already invoked, or the files Claude has already read. Claude composes a delegation message that summarizes the task, and the subagent works from there."*
- **Forks** are the documented exception — inherit the full conversation, dropping input isolation but keeping output isolation: *"The fork's own tool calls still stay out of your conversation and only its final result comes back."*
- **Nesting depth 3** (new since June 2026, `whats-new/2026-w24`): *"a subagent can spawn subagents of its own, up to three layers below the main conversation. At the depth limit, Claude Code withholds the `Agent` tool from every subagent except a fork, so a subagent at the limit does its delegated work itself and returns one summary."*
- **Background subagents are the default since v2.1 week 27**, and background runs get a *narrower tool set*: only `Read, Grep, Glob, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill, ToolSearch, EnterWorktree, ExitWorktree, Monitor, TaskStop, SendMessage, Artifact` (+ all MCP). Everything else is stripped silently. **This means the same subagent definition resolves to different tools in foreground vs background** — a real Foreman hazard.
- `isolation: worktree` frontmatter branches from the **default branch**, not the parent session's HEAD, and auto-cleans if unchanged.
- Full frontmatter set: `description, prompt, tools, disallowedTools, model, permissionMode, mcpServers, hooks, maxTurns, skills, initialPrompt, memory, effort, background, isolation, color`.
- Artifact contract guidance is thin and stays at the level of *"The work is self-contained and can return a summary."* Anthropic does **not** publish a structured artifact contract for subagents — the only structured handoff is the workflow `schema` option (§3.6) or the SDK's `outputFormat`.

### 6.3 Agent teams (VERIFIED)

Distinct architecture from subagents: *"Subagents only report results back to the main agent and never talk to each other. In agent teams, teammates share a task list, claim work, and communicate directly."* Concrete substrate:
- Mailboxes: `~/.claude/teams/{team}/inboxes/{agent}.json`, validated per entry; malformed entries are reported and removed while valid ones still deliver.
- Shared task list: `~/.claude/tasks/{team}/`, three states (pending / in progress / completed) with **dependencies** — *"a pending task with unresolved dependencies cannot be claimed until those dependencies are completed."* Persists across resumed sessions, never uploaded, retention under `cleanupPeriodDays`.

This is the closest thing Anthropic ships to a shared-memory coordination layer, and it is a **task DAG plus mailboxes**, not a knowledge graph.

### 6.4 Where each primitive holds the plan (VERIFIED, `workflows.md` table)

| | Subagents | Skills | Agent teams | Workflows |
|---|---|---|---|---|
| Who holds the plan | Claude, turn by turn | Claude | Claude + teammates | **the script** |
| Results land | main context | main context | main context | script variables |
| Interruption | restarts the turn | restarts the turn | teammates keep running | **resumable in-session** |

---

## 7. What is NEW vs the copies already in `/root/foreman/docs/research/`

The repo's five Anthropic copies were fetched by `fetch_frontier_docs.py` (index shows 17 entries, all single-line text dumps, repo HEAD `1e21a81` dated 2026-07-19). They cover: `sub-agents`, `best-practices`, `agent-teams`, `cli-reference`, `skills`, `advisor-tool`, `managed-agents/multi-agent`.

**Entirely absent from the repo — new in this lane:**
1. `code.claude.com/docs/en/workflows` — the Dynamic Workflows doc. Not fetched at all.
2. `code.claude.com/docs/en/agents` — the subagents-vs-teams-vs-workflows comparison page.
3. The `Workflow` tool I/O types from the Agent SDK TS reference.
4. `agent-sdk/structured-outputs` — draft-07 constraint, Zod/Pydantic path.
5. The **entire Knowledge Graph cookbook** (`capabilities/knowledge_graph/`), including the eval harness and gold set.
6. `engineering/building-effective-agents` — the repo has zero engineering-blog posts.
7. `engineering/managed-agents` (Apr 2026), `effective-harnesses-for-long-running-agents`, `demystifying-evals-for-ai-agents`, `multi-agent-research-system`.
8. `build-with-claude/citations`.
9. **The bundled `/deep-research` and `/code-review` workflow scripts and the full workflow authoring contract**, extractable only from the installed CC binary. Not documented anywhere public.

**Changed since the repo copies:**
- `sub-agents` went **50,288 B → 91,917 B** (+83%). Net-new since the repo snapshot: 3-level subagent nesting; background-by-default with a reduced tool set; subagent output scanning (v2.1.210); `isolation: worktree` branching from the default branch; `SendMessage` resume; the `--agents` JSON flag's full field list; `effort` and `memory` frontmatter.
- `agent-teams` 30,877 B → 33,191 B: mailbox entry validation (v2.1.207 fix), task dependencies, directory-retention semantics.
- `building-effective-agents` still carries its Dec 19 2024 byline but has been refreshed in place — it now recommends Haiku 4.5 / Sonnet 4.5 for routing. **Anyone diffing by date will miss this.**
- The repo's `anthropic_multi_agent.txt` points at `platform.claude.com/docs/en/managed-agents/multi-agent` (product docs). The 2026 *engineering* post `managed-agents` is a different, more useful artifact and is absent.

---

## 8. Transferable primitives for Foreman

Each tied to a source. `[V]` = the source states it; `[I]` = my inference from the source.

**P1. Two-tier model split with the expensive model reserved for arbitration.** `[V]` cookbook cells 3–4: Haiku for schema-constrained extraction, Sonnet for weighing conflicting evidence. Foreman already routes implementers by cost; the missing half is the *symmetric* rule — cheap for extraction/find, expensive for resolution/adjudication. Reinforced by the workflow API's `opts.effort` guidance `[V]`: *"'low' for cheap mechanical stages and higher tiers only for the hardest verify/judge stages."*

**P2. Three-outcome verdicts: CONFIRMED / REFUTED / UNVERIFIED.** `[V]` `/deep-research` verify block + the v2.1.196 changelog entry. Foreman's audit lanes currently return APPROVED/REJECTED. A codex-auditor that dies on a rate limit must produce `unverified`, not a rejection. **This is the highest-value single change in the lane** and it directly addresses the memory-note "Foreman audit tie-break" problem: an errored lane is not a dissenting lane.

**P3. Quorum-with-default-deny for adversarial audit.** `[V]` `VOTES_PER_CLAIM=3, REFUTATIONS_REQUIRED=2`, prompt says *"Default to refuted=true if uncertain."* Foreman's tie-break rule ("Fable decides") could be replaced or preceded by a quorum: N skeptics, kill on ≥⌈N/2⌉ refutations, escalate to Fable only when the quorum is unreachable.

**P4. Perspective-diverse verifiers over redundant ones.** `[V]` bundle pattern catalogue: *"diversity catches failure modes redundancy can't."* Foreman running 3× Codex on the same diff is redundancy. Running correctness / security / does-it-reproduce lenses is diversity. Cheap to adopt — it's a prompt change.

**P5. Synthesis by index, never by re-emission.** `[V]` `/code-review` script: *"Return decisions about findings BY INDEX — never re-emit finding text."* Foreman's consolidate step should merge `FOREMAN_REPORT.md` findings by id and let the synthesizer choose a representative + merge list, never rewrite evidence text. Pair with the published assembler invariants (§5.2) as acceptance criteria.

**P6. No silent caps.** `[V]` bundle: *"if a workflow bounds coverage (top-N, no-retry, sampling), `log()` what was dropped — silent truncation reads as 'covered everything' when it didn't."* Foreman reports should carry an explicit `dropped`/`stats` block. `/deep-research` returns `stats.{urlDupes, budgetDropped, agentCalls, unverified}` `[V]`.

**P7. `pipeline()` as the default, barrier only on genuine cross-item need.** `[V]` bundle, with the stated cost: *"If 5 finders run and the slowest takes 3× the fastest, a barrier wastes 2/3 of the fast finders' idle time."* Foreman's plan→implement→audit fan-outs currently barrier at every phase. Per-spec pipelining (spec A auditing while spec B still implements) is a direct win, and the three legitimate barrier conditions are a testable checklist.

**P8. Determinism as the price of resumability.** `[V]` bundle: `Date.now()`, `Math.random()`, argless `new Date()` **throw** in workflow scripts because they would break resume; resume replays the longest unchanged prefix. Foreman's orchestration layer should adopt the same rule if it wants cheap resume — and pass timestamps in via args.

**P9. A journal file as the debugging contract.** `[V]` bundle: *"Read `<transcriptDir>/journal.jsonl` — it records each agent's actual return value; do not assume cached results are non-empty."* Foreman already writes `FOREMAN_REPORT.md` per worktree (memory note: "Agent fleets: worktrees + file reports"). Adding an append-only `journal.jsonl` of every lane's actual return value makes post-hoc diagnosis and compaction-survival concrete. Matches Managed Agents' session-log-outside-the-harness principle `[V]`.

**P10. Session log outside the orchestrator's context window, sliced on demand.** `[V]` managed-agents: `getEvents()` positional slicing, *"rewinding a few events before a specific moment to see the lead up."* This is the concrete mechanism behind the note's "graph as shared memory" claim. Foreman's version: a queryable run log the architect *pulls from*, rather than lane reports *pushed into* its context.

**P11. Structured artifacts by schema, not by prose convention.** `[V]` workflow `opts.schema` forces a `StructuredOutput` tool call with tool-layer validation and automatic retry; `[V]` SDK `outputFormat` with draft-07. Foreman's `FOREMAN_REPORT.md` is prose. A JSON Schema per lane type (search / plan / audit) with `agentType` + `schema` composed together `[V]` would make consolidation mechanical. Note the composition detail: `agentType` and `schema` compose — the custom agent's system prompt gets a StructuredOutput instruction appended `[V]`.

**P12. Falsifiable-claim tuples with mandatory verbatim quotes.** `[V]` `EXTRACT_SCHEMA`: `{claim, quote, importance}` + `sourceQuality ∈ {primary, secondary, blog, forum, unreliable}`. Foreman audit findings should carry the same shape: a claim, the exact diff hunk / file:line quoted, and a source-strength rating. This makes "verification claim discipline" (an existing memory note) enforceable by schema rather than by policy.

**P13. Entity resolution as a reversible, additive step with a named over-merge failure mode.** `[V]` cookbook cell 14: under-clustering silently drops nodes; over-merging silently loses precision; the API-error path degrades to identity clusters rather than aborting. If Foreman builds a graph over specs/commits/findings, both failure modes need explicit spot-checks, and resolution must never be able to abort a run.

**P14. Extraction-time descriptions as the resolution feature.** `[V]` cookbook: the one-sentence `description` exists solely to disambiguate later. Foreman's analogue: every artifact a lane emits should carry a one-line grounded description written at emit time, because that's what later dedup will actually match on.

**P15. Degree-gated enrichment.** `[V]` cookbook cell 22: only top-3 hub nodes get expensive profiles. Don't summarize every node; summarize the connectors.

**P16. Cheap blocking before model arbitration.** `[V]` cookbook cell 29: blocks of 50–100, grouped by cheap signals, before the arbiter call. Any Foreman dedup over findings must block first (same file / same symbol / same spec) — a single LLM call over all findings does not scale.

**P17. Evaluation harness with a gold set and a published baseline range.** `[V]` `evaluation/README.md` ships expected P/R/F1 bands and names the relation-recall figure as an upper bound because predicates are ignored. Foreman's graph or audit quality needs the same: a small hand-labeled set, a scorer, published baseline bands, and honesty about what the metric does not measure.

**P18. Taint-marking the handoff boundary.** `[V]` subagent output scanning: escape harness-imitating text, prepend a marker for permission-setting mentions, never reword, and state plainly that it is not a security control. Foreman consolidating cross-vendor (Grok / Codex) reports into an architect's context has exactly this exposure.

**P19. Explicit opt-in gate on fan-out.** `[V]` the `Workflow` tool description refuses to orchestrate without explicit user opt-in — *"For any other task — even one that would clearly benefit from parallelism — do NOT call this tool"* — and instead tells Claude to *"briefly describe what a multi-agent workflow could do and how much it would roughly cost, and ask."* This is Building Effective Agents' "don't add structure" `[V]` turned into an enforceable rule, and it is the right shape for Foreman's soft/hard mode boundary.

**P20. Budget as a hard ceiling with a shared pool, plus a mandatory iteration cap.** `[V]` `budget.remaining()` returns `Infinity` when no target is set, and the runtime ships a named error telling you a `while (budget.remaining() > X)` loop will run to the 1000-agent cap. Any Foreman budget-scaled loop needs **both** a budget guard and a hard iteration cap: `while (budget.total && budget.remaining() > 50_000)` `[V]`.

**P21. Delete harness scaffolding when the model outgrows it.** `[V]` managed-agents: context resets *"had become dead weight"* on a newer model. Foreman should date-stamp each workaround with the model it was added for and re-test on model upgrades.

**P22. Composition via one-level workflow nesting, phases as the unit of human re-entry.** `[V]` `workflow(nameOrRef, args)` shares concurrency cap, agent counter, abort signal and budget with its parent; nesting deeper throws. And `[V]`: *"For multi-phase work (understand → design → implement → review), that often means several workflows in sequence — one per phase — so you stay in the loop between them."* Also `[V]`: *"No mid-run user input … For sign-off between stages, run each stage as its own workflow."* That is precisely Foreman's commitment-boundary model, independently arrived at.

---

## 9. Open questions / unreachable sources

1. **Is the workflow script API stable/public?** It exists only inside the CC binary (2.1.220) and in the abbreviated SDK `Workflow` tool entry. `workflow()`, `budget`, `opts.effort`, `opts.agentType`, the 4096-item limit, and the `min(16, cores-2)` formula are **undocumented publicly**. Foreman should not hard-depend on them without pinning a CC version. Version-pin risk is real: the docs show behaviour changing at 2.1.154 / .160 / .178 / .186 / .196 / .202 / .203 / .208 / .210 / .216 / .218 / .219.
2. **`/root/foreman/docs/research/*.txt` are single-line HTML-to-text dumps** with no fetch timestamps in `fetch-index.json`. Any "what changed" claim rests on repo-commit dates (2026-07-19), not source dates. Recommend adding `fetched_at` to the fetcher.
3. **Note reference [11], "Building Effective AI Agents: Architecture Patterns," 2026** — no such page on anthropic.com/engineering (24 posts enumerated). Unverifiable; likely a duplicate of [5].
4. **Note reference [12], the Bun Zig→Rust port via Dynamic Workflows (~750k lines, 11 days, 99.8% tests passing)** — not fetched in this lane; it is a third-party claim, not an Anthropic publication. Should be verified before citing.
5. **No Anthropic publication on graph-structured provenance for agent outputs.** The note's node/edge type taxonomy and four graph-write invariants are its own contribution. Foreman may adopt them, but must attribute them to the note, not to Anthropic.
6. **Entity resolution at scale is unimplemented in the cookbook.** Blocking is prose guidance only; no code, no eval of blocked-vs-unblocked recall. If Foreman builds resolution over specs/findings, there is no reference implementation to copy.
7. **Relation-predicate correctness is unevaluated.** The cookbook's scorer ignores predicate wording by design and suggests *"a Claude judge call per candidate pair"* as the fix — untested, uncosted.
8. **Cookbook incremental-update path is prose only.** "Resolve against the existing canonical set, re-summarize when the source-document set changes materially" has no code and no definition of "materially".
9. **`https://www.anthropic.com/engineering/scaling-managed-agents` 404s** and `https://docs.claude.com/en/docs/claude-code/dynamic-workflows` 404s (redirects to a dead `code.claude.com` path). Correct slugs recorded in §1.
10. **Unresolved:** whether workflow subagents can themselves spawn subagents (the depth-3 rule is documented for the `Agent` tool; the workflow runtime's relationship to that limit is not stated), and whether `resumeFromRunId` survives a Claude Code restart in the SDK (the CLI doc says no; the SDK doc says "same session only" without defining session lifetime).
11. **Not investigated this lane:** `demystifying-evals-for-ai-agents` (Jan 2026) and `effective-harnesses-for-long-running-agents` (Nov 2025) were fetched but only skimmed — both are likely relevant to Foreman's gate design and deserve a follow-up read.

---

*Local artifacts from this lane (ephemeral, `/tmp/r2/`): `kg_notebook_source.md` (all 31 cookbook cells), `deep-research.js` (426-line extracted bundled workflow), `wf-api.txt` (30 KB workflow authoring contract), `cc-workflows.md`, `cc-sub-agents.md`, `cc-agent-teams.md`, `eng-*.md`, `bundle.strings` (429k lines).*
