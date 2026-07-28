# R8 — TerminusDB as the Store for Foreman's Graph Plane

**Lane:** R8 (store + ontology). **Date:** 2026-07-28. **Scope:** TerminusDB as the STORE for the v0.2.9 graph plane.
**Not in scope:** graphify internals (R7), graph SOTA / gap analysis (R4). `graphify` remains the extraction substrate.

**Evidence labels:** `VERIFIED-live` = I ran it against TerminusDB 12.0.6 in Docker on this WSL box today ·
`VERIFIED-docs` = verbatim from terminusdb.org/docs · `VERIFIED-code` = from the repo / GitHub API · `INFERRED` = my reasoning.

---

## 0. TL;DR

TerminusDB is **alive and actively developed, but it is a bus-factor-1 project under new commercial stewardship (DFRNT), with near-zero third-party adoption.** The technology genuinely delivers what it advertises — I verified git-for-data, path queries, schema enforcement, and optimistic concurrency live, not from the brochure. The Foreman ontology loaded and all three lineage queries returned correct answers on first attempt.

**Recommendation: ADOPT-WITH-GUARDRAILS**, scoped to the *knowledge graph* half of the graph plane, and only behind a storage-port abstraction. See §12.

---

## 1. Sources fetched

Full crawl of `terminusdb.org` via its sitemap (`https://terminusdb.org/sitemap-0.xml`, 296 URLs), scraped with `scrapling 0.4.11`.
Raw pages: `/tmp/terminusdb-docs/pages/` · JS-rendered re-fetches: `/tmp/terminusdb-docs/pages-js/` · manifest: `/tmp/terminusdb-docs/manifest.tsv`.

| Source | Status | Date |
|---|---|---|
| `https://terminusdb.org/sitemap.xml` → `sitemap-0.xml` (296 URLs enumerated) | 200 OK | 2026-07-28 |
| **All 278 `terminusdb.org/docs/*` pages** (full list in `manifest.tsv`) | **277 OK, 1 FAIL** | 2026-07-28 |
| — `https://terminusdb.org/docs/topics/` | FAIL on HTTP `get` (empty body); recovered via `fetch --network-idle` | 2026-07-28 |
| **All 16 `terminusdb.org/blog/*` pages** | 200 OK | 2026-07-28 |
| `https://terminusdb.org/` + `/404/` | 200 OK | 2026-07-28 |
| 9 pages re-fetched with JS rendering (code blocks render as `Loading…` in static HTML) — `version-control-operations`, `version-controlled-json`, `recovery-tutorial`, `first-15-minutes`, `get-started`, `explore-ecommerce-dataset`, `explore-a-real-dataset`, `commit-message-howto`, `audit-tutorial` | 200 OK | 2026-07-28 |
| `https://terminusdb.com/` , `/pricing/`, `/blog/`, `/docs/`, `/sitemap.xml` | **403 — DEAD, see §2.1** | 2026-07-28 |
| GitHub API: `terminusdb/terminusdb`, `-client-python`, `-client-js`, `-docs`, `-store` (metadata, releases, commits, contributors, issues, forks, LICENSE history) | OK via `gh` | 2026-07-28 |
| GitHub API: orgs `terminusdb-org`, `dfrnt-labs` | OK via `gh` | 2026-07-28 |
| PyPI `terminusdb-client` + `terminusdb`; pypistats; npm `terminusdb`, `@terminusdb/terminusdb-client` | 200 OK | 2026-07-28 |
| Docker Hub `terminusdb/terminusdb-server` (799,465 pulls; image updated 2026-07-28) | 200 OK | 2026-07-28 |
| Live public instance `https://data.terminusdb.org/api/info` → v12.0.5 | 200 OK | 2026-07-28 |
| **Local instance** `terminusdb/terminusdb-server:latest` → **v12.0.6** in Docker/WSL | running | 2026-07-28 |

**Crawl integrity: 295/296 OK, 1 recovered. Nothing silently skipped.**

---

## 2. PROJECT HEALTH VERDICT — **ALIVE, but bus-factor 1 and adoption-poor**

Lead finding: the "TerminusDB is dead" prior is **out of date, but it was true for about 14 months**, and the project that came back is not the same project.

### 2.1 The old company is gone — `terminusdb.com` is a decommissioned host `VERIFIED-live`

`https://terminusdb.com/` does not serve a website. It returns a bare Kubernetes API-server error:

```json
{ "kind": "Status", "apiVersion": "v1",
  "message": "forbidden: User \"system:anonymous\" cannot get path \"/\"",
  "reason": "Forbidden", "code": 403 }
```

Headers confirm it: `x-kubernetes-pf-flowschema-uid`, `server: cloudflare`. The domain points at an orphaned cluster with nothing deployed. Every `terminusdb.com` URL (`/`, `/docs/`, `/pricing/`, `/blog/`, `/sitemap.xml`) 403s identically. The project relocated to **`terminusdb.org`**, which is the homepage field on the GitHub repo. TerminusCMS is gone as a brand; the hosted product is now **DFRNT Hub**.

### 2.2 The death-and-revival timeline `VERIFIED-code`

Commits on `terminusdb/terminusdb` `main`:

| Period | Commits |
|---|---|
| 2023 (full year) | 283 |
| **2024 (full year)** | **27** |
| 2025 H1 | 217 |
| 2025 H2 | 434 |
| 2026 YTD (to Jul 28) | 429 |

Releases show the same shape — **a 12½-month gap** between `v11.1.12` (2024-03-13) and `v11.1.13` (2025-03-28). Then a steady cadence resumed: v11.1.14 (2025-04), v11.1.15 (2025-06), v11.1.17 (2025-10), **v12.0.0 (2025-12-02)**, and v12.0.1 → **v12.0.6 (2026-06-24)**. Six stable releases in the last 8 months.

**Most recent server release: v12.0.6, 2026-06-24.** Most recent commit to `main`: **2026-07-27** (the day before this report). The Docker image was rebuilt **2026-07-28**.

### 2.3 Who is doing it — this is the biggest risk `VERIFIED-code`

Distinct commit authors since 2025-07-01:

```
793  Philippe Höij          <- DFRNT
 27  dependabot[bot]
 16  Bump Version Bot
  8  Test  /  6 hoijnet  /  1 dfrnt-hoijnet  /  1 Philippe Höij (DFRNT)   <- same person, other identities
  3  Paul Bosse
  2  Luuk de Waal Malefijt  ·  2 Daniel Fahey  ·  2 Brian Stovall
  1  Roman Razilov  ·  1 dfrnt-brian
```

**One human wrote ~93% of the last year of commits.** The original creator, `GavinMendelGleason` (2,382 lifetime commits — the largest contributor by 3×), last committed **2025-04-22** and is gone. Outside contribution is a trickle of one-off bug fixes.

The docs state the transfer plainly (`docs/what-is-dfrnt/`) `VERIFIED-docs`:

> "DFRNT is the company that provides commercial hosting, enterprise support, and a comprehensive user interface for TerminusDB. **In 2025, DFRNT assumed stewardship of the open source TerminusDB project**, ensuring its continued development and maintenance in collaboration with the community."

And the README `VERIFIED-code`: *"Now with new maintainers and an enterprise version."*

### 2.4 Issue hygiene is genuinely good `VERIFIED-code`

**6 open issues / 1,046 closed.** 45 issues filed since 2025-07, only 3 still open. Recent issues get real engagement (comment counts of 3, 4, 5, 10, 11) and close within days. This is a well-tended tracker — but note many issues are filed *by the maintainer himself*, so it partly reflects a solo developer's worklog rather than a user community. **No "unmaintained"/archived notice on the repo.** One *feature* is marked dead in-docs: change-request workflows — *"Unmaintained feature — This feature is not actively maintained… no active development is planned."* `VERIFIED-docs`

### 2.5 Adoption is very weak — the real red flag `VERIFIED-live`

| Package | Downloads / month |
|---|---|
| PyPI `terminusdb-client` (old, last release **2023-11-17**, v10.2.6) | 3,546 |
| PyPI `terminusdb` (new v12 client, released 2026-02) | 3,141 |
| npm `@terminusdb/terminusdb-client` | 502 |
| **npm `terminusdb` (new v12 client)** | **105** |

For scale: mature graph/DB drivers do 10²–10³× these numbers. Docker Hub shows 799k *lifetime* pulls. GitHub: 3,367 stars, 143 forks — **not one fork has more than 1 star**, and no fork is a maintained divergence. There is no credible fork or successor project.

Community: Discord invite `discord.gg/yTJKAma` is the only forum (I did not join, so I cannot report activity — see §14). I found no recent independent third-party writeups; the docs' own blog is the primary content channel.

### 2.6 Licensing — clean, no rug-pull `VERIFIED-code`

LICENSE file history on the server repo:

- 2019-07-23 — **GPLv3** at project inception
- 2020-11-24 — **relicensed to Apache-2.0**
- 2020-12-04 → 2020-12-08 — a revert/re-revert flurry that **settled back on Apache-2.0**

Current LICENSE is Apache-2.0, and has been for 5½ years. `terminusdb`, `-client-python`, `-client-js`, `-store` are all Apache-2.0. **No recent license change, and no signal of one.** Note the docs repo has *no* license field, and the Enterprise edition's license is never stated anywhere.

### 2.7 OSS vs Enterprise — features ARE being withheld, and one of them matters to us

The README lists Enterprise as: *"Full JSON-LD, Turtle, and RDF/XML documents, enterprise features, **very fast commit history queries, higher write performance**, clustering, API for data product backup and restore (beyond command line tools)."* `VERIFIED-code`

Sorting marketing from mechanism:

| Capability | Status |
|---|---|
| Diff / patch / merge / rebase / squash / time-travel | **OSS.** Not gated. `VERIFIED-live` |
| GraphQL, WOQL, path queries, access control | **OSS.** `VERIFIED-live` |
| JSON-LD `@context`, Turtle, RDF/XML documents | **Enterprise.** Hard-gated — "return HTTP 400 on community editions" `VERIFIED-docs` |
| Prometheus `/api/metrics` | **Enterprise.** Fully specified, genuinely absent from OSS `VERIFIED-docs` |
| **Fast commit-history queries** | **Performance-paywalled.** The API is OSS; the speed is not. **I measured this and it is real — see §8.** |
| Binary bundle/unbundle backup **API** | Nominally Enterprise, **but the docs contradict themselves**: `enterprise.md` lists it, while `self-hosted-installation.md` says "the CLI bundle commands for **community use**" and the Apache-2.0 CLI reference lists `bundle`/`unbundle` unmarked. `VERIFIED-docs` |
| Clustering / HA / replication | **Does not exist in either edition.** "Single-node with delta compression". K8s manifest is `replicas: 1`. `VERIFIED-docs` |

There is **no pricing page and no edition-comparison matrix** anywhere in 296 pages.

### 2.8 Ecosystem fragmentation `VERIFIED-code`

Build dependencies do not point at the main org. `src/rust/Cargo.toml` patches to **`github.com/terminusdb-org/*`**:

```toml
tdb-succinct  = {git="https://github.com/terminusdb-org/tdb-succinct"}
terminus-store = {git="https://github.com/terminusdb-org/terminusdb-store"}
swipl         = {git="https://github.com/terminusdb-org/swipl-rs"}
```

So `terminusdb/terminusdb-store` (last commit **2024-03-11**) looks abandoned but is a **stale mirror** — the live storage engine is `terminusdb-org/terminusdb-store` (last commit 2026-02-23, active range-query work). Docs live in a third org, `dfrnt-labs/terminusdb-docs-static`. Three orgs, no signposting. Easy to misjudge this project as dead by reading the wrong repo.

### 2.9 Verdict

**ALIVE — actively and competently developed, shipping real engineering (arbitrary-precision decimals, Allen interval algebra, range queries over succinct structures, `@shared` documents).** But:

- it **died once already** (2024) and could again;
- **one person is the project**;
- adoption is ~100 npm installs/month — you will be an early adopter with no community to ask;
- the steward is a small company monetising the same product, and performance headroom is deliberately reserved for the paid tier.

Not moribund. **Fragile.**

---

## 3. Ontology / schema modelling

Schemas are **JSON documents** (JSON-LD-flavoured), not OWL and not Turtle-first. Storage is RDF triples underneath, but the authoring surface is JSON. `VERIFIED-docs`

Available constructs (all from `docs/schema-reference-guide/`) `VERIFIED-docs`:

| Need | Construct |
|---|---|
| Class / subdocument | `@type: "Class"`, `@subdocument: []` |
| Inheritance (incl. **multiple**) | `@inherits: [...]` |
| Abstract base | `@abstract: []` |
| Enum | `@type: "Enum"`, `@value: [...]` |
| Required vs optional | bare property = required; `{"@type":"Optional","@class":T}` |
| Collections | `Set`, `List` (ordered, dup-ok), `Array` (indexed, multi-dimensional) |
| Cardinality | `@cardinality`, `@min_cardinality`, `@max_cardinality` on `Set` |
| oneOf / disjoint unions | `@type: "TaggedUnion"`, or `@oneOf: [{...}]` on a Class |
| Identity strategy | `@key`: `Lexical` (from fields), `Hash` (SHA-256 of fields), `ValueHash` (content-addressed over the DAG), `Random` |
| External IRIs | `@type: "Foreign"` |
| Docs / i18n | `@documentation` with `@title`/`@description`/`@authors`/`@language` |
| Arbitrary metadata | `@metadata` |
| Unfolding for retrieval | `@unfoldable`, field-level `@unfold` |
| Shared-child lifecycle (12.0.6+) | `@shared` |

### 3.1 The one structural mismatch: **no edge properties** `VERIFIED-docs` / `INFERRED`

TerminusDB is a *document* graph, not a *property* graph. Edges are RDF predicates; **they cannot carry attributes.** The docs' own Neo4j comparison shows this by omission — Neo4j's `(p)-[:LIVES_IN {since: 2020}]->(c)` is rendered as `{"lives_in": "City/London"}`, and `since` silently disappears.

This matters because graphify's exporters put a `props` dict **on every edge** (`push_to_neo4j`: `MERGE (a)-[r:{rel}]->(b) SET r += $props`) `VERIFIED-code`. Any edge property must be **reified** into an intermediate document. That is a real, permanent modelling tax — see §3.2 and §10.

### 3.2 DRAFT Foreman schema — **`VERIFIED-live`: this exact file loaded into TerminusDB 12.0.6**

Design rules:

1. Abstract `GraphNode` carries provenance + the universal lineage edges (`derived_from`, `supersedes`, `revises`).
2. Abstract `WorkNode` adds work-DAG edges (`parent_of`, `depends_on`).
3. Structural edges are **direct properties** — one hop, cheap `Path` traversal.
4. **`MENTIONS` is reified** as a `Mention` document, because span + confidence are genuine edge attributes.
5. `Lexical` keys everywhere with a natural business key → **deterministic IDs, so re-ingest is idempotent**.

```json
[
{ "@type": "@context",
  "@base": "terminusdb:///foreman/data/",
  "@schema": "terminusdb:///foreman/schema#",
  "@documentation": { "@title": "Foreman Graph Plane",
    "@description": "Work-DAG (rounds, attempts, verdicts, commits, agent runs) plus knowledge graph (entities, claims, sources, provenance).",
    "@authors": ["Foreman v0.2.9"] } },

{ "@id": "RunStatus",   "@type": "Enum", "@value": ["pending","running","succeeded","failed","cancelled","timeout"] },
{ "@id": "VerdictKind", "@type": "Enum", "@value": ["approved","rejected","needs_changes","inconclusive"] },
{ "@id": "ClaimStatus", "@type": "Enum", "@value": ["proposed","supported","contradicted","retracted"] },
{ "@id": "SourceKind",  "@type": "Enum", "@value": ["file","url","commit","tool_output","agent_message","dataset"] },

{ "@id": "GraphNode", "@type": "Class", "@abstract": [],
  "@documentation": { "@comment": "Common base: every node is provenanced and lineage-linked." },
  "created_at":   "xsd:dateTime",
  "run_id":       { "@type": "Optional", "@class": "xsd:string" },
  "labels":       { "@type": "Set", "@class": "xsd:string" },
  "derived_from": { "@type": "Set", "@class": "GraphNode" },
  "supersedes":   { "@type": "Optional", "@class": "GraphNode" },
  "revises":      { "@type": "Optional", "@class": "GraphNode" } },

{ "@id": "WorkNode", "@type": "Class", "@abstract": [], "@inherits": ["GraphNode"],
  "parent_of":  { "@type": "Set", "@class": "WorkNode" },
  "depends_on": { "@type": "Set", "@class": "WorkNode" } },

{ "@id": "Task", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["task_key"] },
  "task_key": "xsd:string", "title": "xsd:string",
  "spec": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "Round", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["task_key","index"] },
  "task_key": "xsd:string", "index": "xsd:integer" },

{ "@id": "Attempt", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["attempt_key"] },
  "attempt_key": "xsd:string", "lane": "xsd:string" },

{ "@id": "AgentRun", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["agent_run_id"] },
  "agent_run_id": "xsd:string", "vendor": "xsd:string", "model": "xsd:string",
  "status": "RunStatus", "started_at": "xsd:dateTime",
  "ended_at": { "@type": "Optional", "@class": "xsd:dateTime" },
  "produced": { "@type": "Set", "@class": "Artifact" } },

{ "@id": "Evaluation", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["evaluation_id"] },
  "evaluation_id": "xsd:string", "verdict": "VerdictKind",
  "rationale": { "@type": "Optional", "@class": "xsd:string" },
  "evaluates": "WorkNode",
  "metrics": { "@type": "Set", "@class": "Metric" } },

{ "@id": "Commit", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["sha"] },
  "sha": "xsd:string", "repo": "xsd:string", "message": "xsd:string" },

{ "@id": "Artifact", "@type": "Class", "@inherits": ["WorkNode"],
  "@key": { "@type": "Lexical", "@fields": ["path","content_hash"] },
  "path": "xsd:string", "content_hash": "xsd:string",
  "media_type": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "Metric", "@type": "Class", "@inherits": ["GraphNode"],
  "@key": { "@type": "ValueHash" },
  "name": "xsd:string", "value": "xsd:decimal",
  "unit": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "Source", "@type": "Class", "@inherits": ["GraphNode"],
  "@key": { "@type": "Lexical", "@fields": ["uri"] },
  "uri": "xsd:string", "kind": "SourceKind",
  "excerpt": { "@type": "Optional", "@class": "xsd:string" } },

{ "@id": "Entity", "@type": "Class", "@inherits": ["GraphNode"],
  "@key": { "@type": "Lexical", "@fields": ["canonical_name","entity_type"] },
  "canonical_name": "xsd:string", "entity_type": "xsd:string",
  "aliases": { "@type": "Set", "@class": "xsd:string" },
  "resolved_to": { "@type": "Optional", "@class": "Entity" } },

{ "@id": "Claim", "@type": "Class", "@inherits": ["GraphNode"],
  "@key": { "@type": "Lexical", "@fields": ["claim_key"] },
  "claim_key": "xsd:string", "text": "xsd:string", "status": "ClaimStatus",
  "confidence": { "@type": "Optional", "@class": "xsd:decimal" },
  "about":        { "@type": "Set", "@class": "Entity" },
  "supports":     { "@type": "Set", "@class": "Claim" },
  "contradicts":  { "@type": "Set", "@class": "Claim" },
  "sourced_from": { "@type": "Set", "@class": "Source" } },

{ "@id": "Mention", "@type": "Class", "@inherits": ["GraphNode"],
  "@documentation": { "@comment": "Reified MENTIONS edge: carries span + confidence, which a plain property cannot." },
  "@key": { "@type": "ValueHash" },
  "mention_source": "Source", "mention_entity": "Entity",
  "span_start": { "@type": "Optional", "@class": "xsd:integer" },
  "span_end":   { "@type": "Optional", "@class": "xsd:integer" },
  "confidence": { "@type": "Optional", "@class": "xsd:decimal" } }
]
```

Loaded with:

```bash
curl -u admin:root -X POST \
  "http://localhost:6363/api/document/admin/foreman?graph_type=schema&full_replace=true&author=R8&message=initial+foreman+ontology" \
  -H "Content-Type: application/json" --data-binary @foreman-schema.json
```

→ all 18 classes/enums accepted. **`full_replace=true` is mandatory whenever the payload contains an `@context` object** — otherwise you get `api:message: "Inserting contexts is not allowed without using a 'full replace'."` `VERIFIED-live` (undocumented papercut; cost me a cycle).

### 3.3 Edge-type coverage

| Foreman edge | Realisation | Note |
|---|---|---|
| `PARENT_OF` | `parent_of: Set<WorkNode>` | direct |
| `DEPENDS_ON` | `depends_on: Set<WorkNode>` | direct |
| `DERIVED_FROM` | `derived_from: Set<GraphNode>` | direct, on every node |
| `SUPERSEDES` | `supersedes: Optional<GraphNode>` | direct |
| `REVISES` | `revises: Optional<GraphNode>` | direct |
| `PRODUCED` | `AgentRun.produced: Set<Artifact>` | direct |
| `EVALUATES` | `Evaluation.evaluates: WorkNode` | direct, required |
| `SUPPORTS` | `Claim.supports: Set<Claim>` | direct |
| `CONTRADICTS` | `Claim.contradicts: Set<Claim>` | direct |
| `RESOLVED_TO` | `Entity.resolved_to: Optional<Entity>` | direct |
| `MENTIONS` | **`Mention` document** | **reified** — needs span/confidence |

All eleven expressible. Only `MENTIONS` pays the reification tax. If `SUPPORTS`/`CONTRADICTS` later need per-edge confidence, they must be reified too — **plan for that now**, because reifying after data exists is a `MoveClassProperty` + backfill.

---

## 4. Schema evolution / migration

There is a **first-class migration API**: `POST /api/migration/{path}` taking an ordered operation list, with `?dry_run=true&verbose=true`. `VERIFIED-docs`

Operations: `CreateClass`, `DeleteClass`, `MoveClass`, `ReplaceClassMetadata`, `ReplaceClassDocumentation`, `ReplaceContext`, `ExpandEnum`, `CreateClassProperty`, `DeleteClassProperty`, `MoveClassProperty`, `UpcastClassProperty`, `CastClassProperty`, `ChangeKey`. **`ChangeParents` and `ChangeCollection` are documented as *unimplemented*.** `VERIFIED-docs`

> "Schema migration moves schema and instance data together automatically in a replayable fashion… TerminusDB can *infer* some migrations silently when they do not impact instance data. However, operations that require instance data to change must be specified explicitly."

**Weakening** (add optional field, add class, widen type) = no data change. **Strengthening** (add required field, delete class, narrow type) = data transformed, and **fails without an explicit default**.

Assessment: **better than most graph stores** — it is declarative, replayable, dry-runnable, and migrates instance data with the schema. Two real caveats:

- `ChangeParents` unimplemented means **you cannot restructure the inheritance hierarchy via migration**. My schema leans on `GraphNode`/`WorkNode` inheritance, so getting that hierarchy wrong is expensive to fix. `INFERRED` — mitigate by keeping the abstract bases thin and stable.
- One doc page contradicts the migration guide, claiming migration is *"Schema weakening (backward-compatible only)"* (`terminusdb-vs-neo4j`). The migration reference is newer and more detailed; I trust it, but the docs are not self-consistent.

---

## 5. Versioning model — **the headline claim, verified**

Every write is a commit. All of the following ran green against 12.0.6 `VERIFIED-live`:

| Operation | Call |
|---|---|
| Branch | `POST /api/branch/{org}/{db}/local/branch/{name}` body `{"origin":"admin/db/local/branch/main"}` |
| List branches | `GET /api/document/{org}/{db}/_meta?type=Branch&as_list=true` |
| "Checkout" | **no such thing** — you address the branch in the URL path |
| Commit | any write + `?author=…&message=…` |
| Log | `GET /api/log/{org}/{db}/local/branch/{name}?count=N&start=M` |
| Diff | `POST /api/diff/{org}/{db}` body `{"before_data_version":"main","after_data_version":"lane-b"}` |
| Merge | `POST /api/apply/{org}/{db}/local/branch/{target}` body `{before_commit, after_commit, commit_info}` |
| Rebase | `POST /api/rebase/{org}/{db}/local/branch/{target}` body `{author, rebase_from}` |
| Squash | `POST /api/squash/{org}/{db}/local/branch/{name}` body `{commit_info}` |
| Time-travel | `GET /api/document/{org}/{db}/local/commit/{commit_id}?type=T&as_list=true` |
| Reset | `POST /api/reset/{org}/{db}/local/branch/{name}` body `{commit_descriptor}` |
| Patch | `POST /api/patch/{org}/{db}/local/branch/{name}` |
| Clone/push/pull/fetch/remote | `/api/clone`, `/api/push`, `/api/pull`, `/api/fetch`, `/api/remote` |

**Time-travel proof** `VERIFIED-live` — same query, two commits:

```
GET /api/document/admin/foreman/local/commit/no67ylnviyn6je1jw94n261lx79x6zz?type=Evaluation&as_list=true
  -> []                                     # seed commit, before evaluations existed
GET /api/document/admin/foreman/local/branch/main?type=Evaluation&as_list=true
  -> [Evaluation/E1 (approved), Evaluation/E2 (rejected)]
```

**Diff proof** `VERIFIED-live` — after branching `lane-b` and adding one Attempt:

```json
[ {"@insert": {"@id":"Attempt/A5","@type":"Attempt","attempt_key":"A5",
               "created_at":"2026-07-22T10:00:00Z","lane":"fable"}, "@op":"Insert"} ]
```

### 5.1 ⚠️ Diff has a silent-wrong-answer footgun `VERIFIED-live`

The `*_data_version` fields accept **bare branch names** or `commit:<id>`. Passing the plausible-looking `branch:main` returns **`[]` with HTTP 200** — no error, just a silently empty diff:

| Form | Result |
|---|---|
| `{"before_data_version":"main","after_data_version":"lane-b"}` | ✅ correct diff |
| `{"before_data_version":"commit:<id>","after_data_version":"commit:<id>"}` | ✅ correct diff |
| `{"before_data_version":"branch:main",…}` | ❌ **`[]`, silently** |
| `{"before_data_version":"admin/foreman/local/branch/main",…}` | ✅ errors loudly (`api:NotValidRefError`) |

Galling, because `branch:<id>` is exactly the format the `Terminusdb-Data-Version` **response header returns**. Any Foreman diff wrapper must normalise this and assert non-empty. `INFERRED`: this is a latent source of "the audit says nothing changed" bugs.

### 5.2 Merge conflict semantics `VERIFIED-docs`

Three-way, field-level, fails loudly:

> "TerminusDB uses a three-way merge that detects conflicts at the field level. If both branches modified the same field on the same document, the merge fails with a precise conflict report — **no silent data loss**."

Conflict report carries `@after_left` / `@after_right`; **resolution is entirely manual** (PUT the winner, re-run apply). `--match-final-state` allows a conflicting patch through if the end state matches — the idempotency escape hatch. Rebase conflict behaviour is **undocumented** (`api:rebase_report` only ever shown as `[]`).

### 5.3 Limits

No documented branch-count limit. Branches are cheap (shared layers until divergence). Reset is destructive to branch reachability but commits survive in the immutable graph. Open issue **#2430 "Support multiple parents in a commit"** means the commit DAG is currently **single-parent** — merges do not record both ancestors, so the commit graph is a chain, not a true DAG. `VERIFIED-code` That weakens "git-like" for provenance-of-merge purposes.

---

## 6. Query surface

Two languages over the same store. **GraphQL is auto-generated from your schema**; WOQL is a JSON-LD datalog AST.

**Path-pattern grammar** (identical in both) `VERIFIED-docs`:

| Expr | Meaning |
|---|---|
| `A,B` | sequence |
| `A\|B` | alternation |
| `F+` / `F*` | one-or-more / zero-or-more |
| `F{n,m}` | bounded repetition |
| `.` | any predicate |
| `F>` / `<F` | forward / **backward** traversal |
| `(A)` | grouping |

**No shortest-path operator exists.** Depth is bounded with `{n,m}`; WOQL's `path()` can return the traversed edge list as a 4th argument (GraphQL's `_path_to_X` cannot). Path is documented as *"a regular graph expression which avoids cycles"* — cycle-safe by construction.

### 6.1 The three lineage queries — **all `VERIFIED-live`, all correct on first run**

Fixture: `Task/T7 → Round/T7+1 → {A1,A2}`, `Task/T7 → Round/T7+2 → {A3,A4}`, `A4 derived_from A3`; `E1 evaluates A1`, `E2 evaluates A3`; `C2 contradicts C1`, `C3 supports C1`.

**(a) All attempts transitively descending from a round**

```json
{"query":{
 "@type":"Select","variables":["Descendant"],
 "query":{"@type":"And","and":[
   {"@type":"Path",
    "subject":{"@type":"Value","node":"Round/T7+1"},
    "pattern":{"@type":"PathPlus","plus":{"@type":"PathOr","or":[
        {"@type":"PathPredicate","predicate":"parent_of"},
        {"@type":"PathPredicate","predicate":"derived_from"},
        {"@type":"InversePathPredicate","predicate":"derived_from"}]}},
    "object":{"@type":"Value","variable":"Descendant"}},
   {"@type":"IsA","element":{"@type":"NodeValue","variable":"Descendant"},
    "type":{"@type":"NodeValue","node":"Attempt"}}]}}}
```

→ `A1, A2, A3, A4` ✅ — **but returned 10 rows for 4 answers**, one row per distinct path. **`Distinct` is mandatory around any `Path`**, not optional hygiene. `VERIFIED-live`

**(b) Leaves with no evaluation**

```json
{"query":{
 "@type":"Select","variables":["Leaf"],
 "query":{"@type":"And","and":[
   {"@type":"IsA","element":{"@type":"NodeValue","variable":"Leaf"},
    "type":{"@type":"NodeValue","node":"Attempt"}},
   {"@type":"Not","query":{"@type":"Triple",
      "subject":{"@type":"NodeValue","variable":"Child"},
      "predicate":{"@type":"NodeValue","node":"derived_from"},
      "object":{"@type":"Value","variable":"Leaf"}}},
   {"@type":"Not","query":{"@type":"Triple",
      "subject":{"@type":"NodeValue","variable":"Eval"},
      "predicate":{"@type":"NodeValue","node":"evaluates"},
      "object":{"@type":"Value","variable":"Leaf"}}}]}}}
```

→ exactly `A2, A4` ✅ (A1/A3 have evaluations; A3 has a child). Ordering matters — `IsA` must bind `Leaf` **before** the `Not` clauses, since `Not` filters and does not generate. **GraphQL cannot express this** — generated `*_Filter` inputs expose forward properties only, never backlinks. Negation is a WOQL-only capability.

**(c) Claims contradicting a claim, both directions**

```json
{"query":{
 "@type":"Distinct","variables":["Other"],
 "query":{"@type":"Select","variables":["Other"],
 "query":{"@type":"Path",
    "subject":{"@type":"Value","node":"Claim/C1"},
    "pattern":{"@type":"PathOr","or":[
        {"@type":"PathPredicate","predicate":"contradicts"},
        {"@type":"InversePathPredicate","predicate":"contradicts"}]},
    "object":{"@type":"Value","variable":"Other"}}}}}
```

→ exactly `C2` ✅ (found via the **inverse** edge — C2 contradicts C1, not the reverse).

### 6.2 GraphQL equivalents `VERIFIED-live`

Auto-generated backlinks and path queries work exactly as documented:

```graphql
{ Claim(filter:{claim_key:{eq:"C1"}}) { claim_key text
    _contradicts_of_Claim { claim_key text } } }
```

→ `{"_contradicts_of_Claim":[{"claim_key":"C2","text":"TerminusDB is abandoned"}]}`

```graphql
{ Task(filter:{task_key:{eq:"T7"}}) { task_key
    _path_to_Attempt(path:"(parent_of)+") { attempt_key lane } } }
```

→ all four attempts, **already deduplicated** — cleaner than the WOQL equivalent. `_count(Attempt:{})` → `5458`.

Papercut: `Task(id:"Task/T7")` returns `[]`; the `id:` argument requires the **full IRI** `"terminusdb:///foreman/data/Task/T7"`. Use `filter:` on a business key instead. `VERIFIED-live`

### 6.3 Learning curve — honest read

The DSL is compact (`path("x","(parent>)+","v:Y")` beats a recursive CTE). The **JSON-LD wire format is brutally verbose** — the ~15-line query (c) above is a two-predicate lookup. Generate it; never hand-write it.

The documented top footgun, quoted from `docs/troubleshooting-queries/` `VERIFIED-docs`:

> "**Query returns 0 bindings silently — no error message, just empty results.** … TerminusDB stores foreign key references as `xsd:anyURI`… comparing a URI-typed value with a string literal using `eq/2` … unification fails silently. **This is the single most common WOQL debugging issue.**"

Combined with the §5.1 diff footgun, **the dominant failure mode of this database is a silent empty result, not an error.** Every Foreman query path needs an assertion on expected non-emptiness. Budget ~1 week to WOQL competence; GraphQL is near-zero.

---

## 7. Provenance

**Per-commit provenance is free and structured.** `VERIFIED-live` — real `/api/log` output:

```json
{ "@id": "ValidCommit/fjnenb785gixf6wrvpo2j5rqgs5pqtp",
  "@type": "ValidCommit",
  "author": "R8",
  "identifier": "fjnenb785gixf6wrvpo2j5rqgs5pqtp",
  "instance": "layer_data:Layer_630d5345…",
  "message": "add evaluations",
  "parent": "ValidCommit/qjnuoepmlmkvuyfq4b49t4aleih2gtw",
  "schema": "layer_data:Layer_025874ee…",
  "timestamp": 1785250056.7600417,
  "user": "terminusdb://system/data/User/admin" }
```

- `author` is an **arbitrary caller-supplied string** → this is where `run_id`/`agent_id` goes. I set `author=R8` and `author=lane-7` freely. ✅
- `user` is the **authenticated identity** — not spoofable by the caller. Good: you get both the claimed agent and the real credential.
- `timestamp`, `message`, `parent` chain, and separate instance/schema layer hashes all come for free.

**Limits:**

- **Per-commit only, not per-triple.** There is no per-edge provenance. To know which agent asserted a specific edge you must either (a) put one edge per commit — expensive, see §8 — or (b) carry `run_id` as a **field on the node** (my schema does this on `GraphNode`).
- **No structured commit metadata.** `author` and `message` are plain strings; there is no arbitrary JSON metadata field on a commit. Encoding `run_id` + `lane` + `attempt` means stuffing a delimited string into `author`/`message` and parsing it back. `VERIFIED-live` / `INFERRED`
- Commits are **single-parent** (issue #2430 open), so a merge does not record both ancestors.

**Recommendation:** treat the commit log as the *audit trail*, and model provenance **explicitly as documents** (`run_id` on `GraphNode`, `AgentRun`, `Evaluation`). Do not make the commit log load-bearing for lineage queries — §8 explains why.

---

## 8. Clients, deployment, concurrency, scale — measured

### 8.1 Deployment `VERIFIED-live`

| Metric | Measured |
|---|---|
| Image `terminusdb/terminusdb-server:latest` | **594 MB on disk** (docs claim *"Docker container, ~120 MB"* — **wrong by ~5×**) |
| Cold start to first healthy `/api/info` | **2.6 s** |
| Idle RSS | **38 MB** |
| RSS after 5,000 docs | 74 MB |
| RSS after ~5,500 docs + 478 commits | **101 MB** |
| On-disk store, ~5,500 docs / 478 commits | **9.7 MB** |

That is an outstandingly light footprint — far below the "in-memory database, allocate 4 GB" warning in the Windows docs. Single-node only; **no embedded/in-process mode exists** (the word never appears in 296 pages) — it is always a server on `:6363`. Data lives at `/app/terminusdb/storage`; the directory is portable via stop-and-tar, though **cross-version raw-directory compatibility is undocumented**.

Key env vars: `TERMINUSDB_SERVER_WORKERS` (default **8**), `TERMINUSDB_SERVER_MAX_TRANSACTION_RETRIES` (default **3**), `TERMINUSDB_DOC_WORK_LIMIT` (500,000), `TERMINUSDB_ADMIN_PASS` (required).

### 8.2 Concurrency — **better than the docs suggest, with a sharp edge**

The model is optimistic, lock-free, with automatic retry at **branch-head granularity** `VERIFIED-docs`:

> "Write transactions use optimistic concurrency: they proceed without acquiring locks, then check at commit time whether the branch head has moved… The server performs up to three retries by default."

**Test 1 — 12 concurrent writers, distinct documents, same branch** `VERIFIED-live`: **12/12 HTTP 200, all 12 documents landed, 12 serialized commits, zero errors.** The retry machinery works. This is the Foreman fan-in case and it passes.

**Test 2 — 10 concurrent writers contending on the SAME document** `VERIFIED-live`: **10/10 HTTP 200. Last writer silently wins** (`TITLE-FROM-LANE-9`). No conflict, no error, no warning. **Same-branch contention is last-write-wins, not conflict-detected.** Conflict detection only exists at *merge*, between *branches*.

**Test 3 — compare-and-swap** `VERIFIED-live`: this is the mitigation, and it is **not in the docs' concurrency page**. Every read and write returns a `Terminusdb-Data-Version` header. Send it back as a request header and you get a proper precondition:

```
PUT /api/document/... 
  -H "TerminusDB-Data-Version: branch:97slyhm3dqtqqjeq988v7wzr2pab3go"
→ HTTP 400
{"@type":"api:DataVersionMismatch",
 "api:actual_data_version":"branch:5uwitj3p6wms4jms1han6v7ygysqoqa",
 "api:requested_data_version":"branch:97slyhm3dqtqqjeq988v7wzr2pab3go"}
```

The stale write was **rejected and did not clobber**. ✅

⚠️ **But the precondition is branch-scoped, not document-scoped.** Under N concurrent lanes, *any* other commit invalidates your token — CAS would cause a retry storm. Practical rule for Foreman `INFERRED`:

- **Appends of distinct documents → no CAS.** Safe and serialized (Test 1).
- **Read-modify-write on a shared document → CAS required**, else silent clobber (Test 2).
- **Independent lane work → branch-per-lane + `/api/apply`**, which is the docs' own recommendation and the only path with real conflict detection.
- Raise `TERMINUSDB_SERVER_WORKERS` above 8 before running ~10 lanes.

### 8.3 Scale — the docs have **no real benchmarks**; here are mine

The entire corpus contains one performance table (a WOQL set-operation microbenchmark) and one uncited claim (*"benchmarks on billion-triple datasets show ~13 bytes per triple"* — no dataset, no machine, no link; treat as marketing). There is **no ingest rate, no query latency, no memory figure on any named dataset**, despite two full head-to-head comparison pages containing zero numbers.

Measured on this box (WSL2, Docker, 12.0.6, ~5,500 docs) `VERIFIED-live`:

| Operation | Result |
|---|---|
| Bulk insert, batches of 500 | **~1,070 docs/s** (10 × 500 in 4.66 s) |
| Single-doc commit latency | **p50 28 ms, p95 34 ms** → ~35 commits/s serial |
| List all 5,058 `Attempt` docs | 202 ms |
| WOQL negation scan over 5,056 docs | **~230 ms** |
| WOQL transitive `Path` (small subgraph) | **10–12 ms** |
| GraphQL `_count` over 5,458 | fast, sub-100 ms |

#### ⚠️ The commit log scales linearly — and this is the Enterprise paywall, measured

| Commits on branch | `/api/log` full scan |
|---|---|
| 178 | 459 ms |
| 278 | 680 ms |
| 378 | 932 ms |
| 478 | **1,152 ms** |

**~2.4 ms per commit, dead linear.** Extrapolated: 10,000 commits ≈ **24 s**; 100,000 ≈ **4 min**. `INFERRED` from a clean linear fit.

Bounded queries are fine, **but offset paging is O(offset)** `VERIFIED-live`:

```
count=1              ->  14 ms      count=10  start=0   ->  35 ms
count=10             ->  35 ms      count=10  start=200 -> 237 ms
count=100            -> 254 ms      count=10  start=400 -> 442 ms
count=500            -> 1172 ms
```

You can cheaply read the *head* of history. You **cannot** cheaply walk *back* through it.

This is precisely the capability the Enterprise edition sells — *"very fast commit history queries"*, *"query millions of commits with sub-second response times"*. **The OSS commit log is not a queryable audit index at Foreman's commit volume.** Since Foreman generates a commit per write, this is the single most load-bearing finding in this report.

**Mitigations** `INFERRED`: (1) model the work-DAG as **documents** — my schema's `Commit`/`AgentRun`/`Evaluation` classes make lineage a normal indexed document query at ~230 ms over 5k docs, independent of commit count; (2) `/api/squash` periodically; (3) never page deep with `start=`.

### 8.4 Clients

- **Python:** `terminusdb` (v12.0.5, Feb 2026) supersedes `terminusdb-client` (v10.2.6, **Nov 2023**). ⚠️ **The docs are inconsistent**: 21 code samples still `from terminusdb_client import Client` and 4 say `pip install terminusdb-client`, against only 2 saying `pip install terminusdb`. `VERIFIED-live` Real drift risk.
- **JS/TS:** `@terminusdb/terminusdb-client` (502 dl/mo) and `terminusdb` v12.0.5 (105 dl/mo).
- **Rust:** community-maintained, requires nightly, **not on crates.io**.
- **HTTP:** the real interface — complete, uniform, easy to drive from `curl`/`urllib`. Everything in this report was done over raw HTTP. **Recommend Foreman target the HTTP API directly** and skip the thin clients.
- Both client repos are in dependabot-only maintenance since ~Feb 2026. `VERIFIED-code`

---

## 9. Operational fit for Foreman on one WSL box

**Good:** 2.6 s start, 38 MB idle, 9.7 MB for 5.5k docs, single container, stop-and-tar backup, Apache-2.0, no JVM. It is a *pleasant* thing to run.

**Watch:** server-only (no embedded); single-node only (no HA in any edition); `bundle`/`unbundle` backup licensing is self-contradictory in the docs; the dashboard is *"now deprecated (buggy)"* and the modelling UI is DFRNT's commercial Studio.

---

## 10. graphify → TerminusDB ingest path

graphify holds a `networkx` graph and exports via ~90-line `push_to_X(G, uri, user, password, communities)` functions (`exporters/graphdb.py`), using Cypher `MERGE` for idempotent upsert. `VERIFIED-code`

A `push_to_terminusdb` is structurally similar but **not a drop-in**, for three reasons:

1. **Schema-first.** Neo4j/FalkorDB accept arbitrary labels and properties; TerminusDB rejects anything not in the schema. A migration/registration step must run before first insert.
2. **No edge properties.** graphify sets `SET r += $props` on every edge. TerminusDB has nowhere to put those. Options: drop them, fold them into the target node, or reify. `INFERRED` recommendation: reify only `MENTIONS`; drop cosmetic edge props.
3. **Upsert is `PUT ?create=true`, not `MERGE`.** `VERIFIED-live` — I confirmed `PUT …?create=true` creates when absent and replaces when present, and is idempotent across repeated runs. Combined with `Lexical` keys, re-ingest is naturally idempotent. Note `POST` is **insert-only** and returns `api:DocumentIdAlreadyExists` on a duplicate — useful as a strict-create mode.

**Sketch:**

```python
def push_to_terminusdb(G, uri, user, password, db, communities=None, batch=500):
    #  1. PUT schema with ?graph_type=schema&full_replace=true   (once)
    #  2. map node.file_type -> Foreman class; build @id from Lexical key fields
    #  3. batch docs 500 at a time -> PUT /api/document/{org}/{db}?create=true
    #     &author=graphify:{run_id}&message=ingest+{batch_n}
    #  4. second pass for link-valued properties (targets must exist first)
```

Two passes are needed because link properties reference documents that must already exist. `INFERRED`

**Work estimate:**

| Item | Estimate |
|---|---|
| `push_to_terminusdb` exporter (batching, 2-pass, retry) | 1–1.5 d |
| Foreman schema module + migration runner | 1 d |
| graphify node/edge type → Foreman class mapping + `MENTIONS` reification | 1 d |
| Idempotency + concurrency tests (CAS, parallel lanes) | 1 d |
| Query layer for the 3 lineage patterns + non-empty assertions | 1 d |
| **Total** | **~5 developer-days** |

Add ~2 d if per-edge properties on `SUPPORTS`/`CONTRADICTS` turn out to be required.

---

## 11. Comparison vs alternatives

Weighted for: versioning-for-free · ontology enforcement · provenance · single-box operational simplicity · longevity risk.

| Rank | Option | One-line tradeoff |
|---|---|---|
| **1** | **TerminusDB** | The only option where branch/diff/merge/time-travel is free and native — paid for with bus-factor-1 longevity risk, a linear-scan commit log, and WOQL's silent-empty-result failure mode. |
| **2** | **SQLite/Postgres + explicit tables** | Zero longevity risk and total operational familiarity; you hand-build versioning, lineage recursion (CTEs), and schema enforcement — more code, but code you control and can hire for. |
| **3** | **Postgres + Apache AGE / plain recursive CTEs** | Same safety as (2) with real graph traversal; still no versioning, and AGE itself is a thin-maintenance extension. |
| **4** | **Oxigraph / RDF stores** | Apache-2.0, embeddable, genuine SPARQL 1.1 with property paths; no versioning, no schema enforcement (SHACL is bolt-on), and RDF's ergonomics tax without TerminusDB's document layer. |
| **5** | **Neo4j** | Best-in-class traversal, Cypher, huge community and hiring pool; GPL/commercial, JVM-heavy for one WSL box, and version control is entirely your problem. |
| **6** | **FalkorDB** | Fast, tiny, Cypher-compatible, already a graphify exporter target; no versioning, no ontology enforcement, weak provenance — a query cache, not a system of record. |
| **7** | **DuckDB** | Superb analytics over graph-shaped tables and trivial to embed; recursive traversal is awkward, no ontology, no versioning, single-writer. |
| **8** | **git notes + JSONL** | Perfect provenance and versioning for free with zero new infrastructure; no query engine at all — every lineage question becomes a full scan in application code. |

**Honest framing:** TerminusDB ranks first *only because versioning and ontology are weighted heavily*. Drop those two and it falls behind Postgres and FalkorDB on every remaining axis, especially longevity.

---

## 12. Recommendation — **ADOPT-WITH-GUARDRAILS**

Adopt TerminusDB for the **knowledge-graph half** of the graph plane (Entity / Claim / Source / Mention / Artifact provenance), behind a **storage-port interface**, with the work-DAG modelled as documents rather than as commits.

**Strongest argument FOR:** Foreman's graph plane needs *versioned, provenanced, schema-enforced* knowledge — branch a hypothesis, diff two rounds' worth of claims, time-travel to what the agent believed at round 3, and get author/message/timestamp on every change for free. **Every other option on the list makes you build that yourself**, and I verified TerminusDB's version does work: schema loaded clean, all three lineage queries correct on first run, 12-way concurrent writes green, time-travel exact — in a 38 MB, 2.6-second container.

**Strongest argument AGAINST:** **One person writes 93% of the commits, the project already went dormant for 14 months in 2024, and npm adoption is 105 downloads/month.** If that person stops, Foreman's system of record is an unmaintained Prolog database with no community — and the measured linear commit-log scan means the paid tier is where the headroom lives.

**Guardrails (non-negotiable):**

1. **Storage port.** Never call TerminusDB from Foreman core; go through a `GraphStore` trait/protocol with a Postgres or JSONL fallback implementation. The 5-day estimate assumes this.
2. **Work-DAG as documents, not commits.** Lineage queries must not depend on `/api/log` (§8.3).
3. **Assert non-empty.** Wrap every diff and query; normalise the `branch:` prefix; treat empty as an error unless proven.
4. **Branch-per-lane** for independent work; CAS header for shared-document read-modify-write; plain appends otherwise.
5. **Pin the version and keep the store directory backed up** by stop-and-tar; cross-version portability is undocumented.
6. **Re-evaluate at v0.3.x.** Recheck commit cadence and whether a second maintainer has appeared.

Do **not** adopt it as the sole system of record for anything Foreman cannot regenerate.

---

## 13. Risks

| Risk | Severity | Evidence | Mitigation |
|---|---|---|---|
| **Bus factor 1** | **High** | 793/860 commits by one person; founder gone since 2025-04 | Storage port; Apache-2.0 means we *could* fork; re-evaluate quarterly |
| **Second dormancy** | **High** | Already happened: 27 commits in all of 2024, 12½-month release gap | Pin version; keep fallback impl warm |
| **Commit-log linear scan** | **High** | Measured 2.4 ms/commit, O(offset) paging (§8.3) | Model work-DAG as documents; squash; never deep-page |
| **Silent empty results** | **High** | `branch:` diff footgun (`VERIFIED-live`); `anyURI` vs `xsd:string` (docs call it *"the single most common WOQL debugging issue"*) | Assert non-empty everywhere; integration tests with known fixtures |
| **Silent last-write-wins** | Medium | 10/10 contending writes returned 200, last won (§8.2) | CAS header on all read-modify-write |
| **No edge properties** | Medium | Document graph, not property graph (§3.1) | Reify `MENTIONS` now; plan reification for `SUPPORTS`/`CONTRADICTS` |
| **`ChangeParents` unimplemented** | Medium | Migration reference | Keep `GraphNode`/`WorkNode` abstract bases thin and stable |
| **Enterprise creep** | Medium | Perf headroom + RDF formats + metrics already gated; no pricing page | Stay on OSS-only features; re-check each release |
| **Docs drift** | Low–Med | 21 samples use the 2023-era Python client; ~120 MB image claim is ~5× wrong; contradictory env-var names | Target the HTTP API; verify against a live instance |
| **WOQL learning curve** | Low–Med | Verbose JSON-LD AST; poor error messages | Generate queries; prefer GraphQL where negation isn't needed |
| **Ecosystem fragmentation** | Low | Three GitHub orgs (§2.8) | Document which repo is canonical |

---

## 14. Open questions / unreachable pages

1. **`terminusdb.com`** — 403 Kubernetes error, no archive fetched. Whether it is deliberately decommissioned or a misconfiguration is unconfirmed (§2.1).
2. **Discord activity** — `discord.gg/yTJKAma` is the only community forum; I did not join, so message volume and response times are **unmeasured**. This is the biggest remaining gap in the health picture.
3. **Retry-exhaustion error** — the docs never state what a client sees when the 3 retries are exhausted; I never triggered it at 12-way concurrency. Unknown at higher concurrency.
4. **Commit-log scaling beyond 478 commits** — my linear extrapolation to 10k/100k is `INFERRED`, not measured. Worth a dedicated test before committing.
5. **`bundle`/`unbundle` licensing** — docs contradict themselves; untested whether the OSS build returns 403.
6. **GraphQL time-travel to a commit** — branch-scoped GraphQL is documented and works; `…/local/commit/<id>` on the GraphQL endpoint is undocumented and **untested**.
7. **Cross-version store-directory compatibility** — `/api/info` reports `storage.version: "2"` but upgrade/downgrade rules are undocumented.
8. **Rebase conflict behaviour** — `api:rebase_report` only ever shown empty; unknown whether rebase aborts or halts mid-replay.
9. **`/docs/topics/`** — failed the plain HTTP fetch (empty body), recovered via JS rendering; the recovered page is a thin index, so nothing is believed lost.

---

## Appendix — reproducing the live verification

```bash
docker run -d --name tdb-test -p 6363:6363 \
  -e TERMINUSDB_ADMIN_PASS=root \
  -v /tmp/tdb-data:/app/terminusdb/storage \
  terminusdb/terminusdb-server:latest

curl -u admin:root -X POST http://localhost:6363/api/db/admin/foreman \
  -H "Content-Type: application/json" -d '{"label":"Foreman Graph Plane"}'

curl -u admin:root -X POST \
  "http://localhost:6363/api/document/admin/foreman?graph_type=schema&full_replace=true&author=R8&message=ontology" \
  -H "Content-Type: application/json" --data-binary @foreman-schema.json
```

Artifacts on this box: schema `/tmp/tdb-foreman-schema.json` · fixtures `/tmp/tdb-foreman-data.json`, `/tmp/tdb-foreman-edges.json` · perf scripts `/tmp/perf3.py`, `/tmp/perf4.py`, `/tmp/perf5.py` · crawl `/tmp/terminusdb-docs/`.
