# Spec delta — graph consumption

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: worker graph access is a pre-serialized block, not traversal

Foreman SHALL construct every lane's graph context host-side before dispatch and
SHALL NOT give a worker free traversal of the graph as its primary read path.

WHEN a lane is dispatched, the host SHALL build a `GraphContextBlock` for that
lane's task and role and SHALL include it in the lane's prompt.
The builder SHALL run before the worker starts and SHALL NOT require any LLM
call to construct the block.
A worker SHALL NOT be given a graph tool as its primary means of obtaining
context.
WHERE the graph plane is disabled by configuration, the lane SHALL run without a
block and the run record SHALL state that no graph context was served.

#### Scenario: a dispatched lane carries a block it did not fetch

- WHEN an implementer lane starts
- THEN its prompt contains a `GraphContextBlock` built by the host
- AND no graph query was issued by the worker to obtain it.

#### Scenario: the plane can be switched off

- WHEN the graph plane is disabled
- THEN the lane runs with no block
- AND the run record states that no graph context was served.

### Requirement: every served edge carries a stable, verifiable identifier

The builder SHALL mint edge identity, because `graph.json` edge records contain
no `id` field.

The builder SHALL compute a durable `edge_key` for every candidate edge as a
truncated `sha256` over `source`, `target`, `relation`, `source_file` and
`source_location`.
The builder SHALL assign each served edge a short in-block alias, and SHALL
include the alias-to-`edge_key` table in the block.
The alias table SHALL be inside the block's content hash.
Two edges that differ only in `source_file` or `source_location` SHALL receive
distinct `edge_key` values, because they are distinct evidence.
The `edge_key` SHALL be computable by any consumer reading `graph.json` without
invoking the builder.

#### Scenario: an alias resolves to exactly one graph edge

- WHEN a verifier resolves the alias `e07` against a block
- THEN it obtains one `edge_key`
- AND that `edge_key` resolves to exactly one edge record in `graph.json`.

#### Scenario: the same fact keeps its key across a rebuild

- WHEN the knowledge graph is refreshed and an edge's endpoints, relation and
  source location are unchanged
- THEN its `edge_key` is unchanged.

### Requirement: candidates are generated within two hops over a role-scoped allowlist, then ranked

The builder SHALL bound candidate generation and SHALL select by relevance rank
rather than by graph expansion.

The builder SHALL resolve seeds from the task text and SHALL cap the seed set at
eight.
The builder SHALL apply a role-scoped edge-type allowlist before any expansion.
The builder SHALL expand at most two hops from the seed set and SHALL cap the
candidate set; on overflow it SHALL truncate and SHALL set a `truncated` flag.
The builder SHALL rank candidates by a linear combination of task-text relevance,
directional distance features from the seeds, and verified status.
The builder SHALL NOT use PageRank or Personalized PageRank for ranking.
The builder SHALL NOT use a graph neural network for scoring.
The builder SHALL NOT serve the k-hop closure as the selected set.
WHERE a required fact lies two hops from a seed, the builder SHALL include it as
a directly served edge rather than relying on the worker to chain it.

#### Scenario: the closure is generated but never served

- WHEN the 2-hop closure from the seeds contains 1,400 edges and the budget
  allows 145
- THEN 145 ranked edges are served
- AND the remaining candidates do not appear in the block.

#### Scenario: role scoping is applied before expansion

- WHEN an implementer-role block is built
- THEN edge types outside the implementer allowlist are excluded before the
  2-hop expansion runs
- AND they are absent from the candidate set, not merely from the served set.

### Requirement: the block is token-budgeted and under-serves by default

The builder SHALL bound the block by tokens, SHALL prefer under-serving to
over-serving, and SHALL never substitute irrelevant context for absent context.

The default graph budget SHALL be 2,000 tokens, and this number SHALL be
recorded as **provisional**.

It is inherited from a published knee measured on short Freebase triples.
Foreman's edges carry longer free text — spec titles, finding summaries, file
paths — so the same token budget buys materially fewer edges and the knee is
expected to arrive earlier. Shipping the number is acceptable; shipping it as
though it were measured here is not.
The default SHALL be replaced by the outcome of the K/serializer sweep owned by
`graph-eval-falsification`, and until that sweep reports, any claim that 2,000
tokens is the right budget for Foreman SHALL be labelled as inherited rather
than measured.
The served edge count SHALL be derived from the budget at the measured cost per
edge and SHALL be clamped to a floor of 40 edges and a ceiling of 290 edges.
The block SHALL NOT exceed a hard cap of 4,000 tokens under any configuration.
The block SHALL state its served edge count, its token count and its budget.
IF seed resolution yields zero seeds, THEN the builder SHALL emit an explicit
`NO GRAPH CONTEXT` marker and SHALL NOT fall back to a global, random or
degree-ranked subgraph.
The builder SHALL stamp the knowledge graph's measured freshness into every
block.

#### Scenario: an unresolvable task gets no graph rather than the wrong graph

- WHEN the task text resolves to no seeds
- THEN the block contains the `NO GRAPH CONTEXT` marker and no edges
- AND no substitute subgraph is served.

#### Scenario: the hard cap holds against a misconfigured budget

- WHEN the configured budget exceeds the hard cap
- THEN the block is built at the hard cap
- AND the block records that the configured budget was clamped.

### Requirement: the block layout is fixed, and conflicts are labelled and separated

The builder SHALL control information layout, because layout is where the
measured accuracy difference lives.

The block SHALL restate the task at the beginning and again at the end.
Edges SHALL be grouped by subject.
Groups SHALL be ordered ascending by their highest member score, so that the
highest-scoring group is adjacent to the closing task restatement.
Conflicting or disputed edges SHALL appear in a separately headed, explicitly
labelled block of at most ten edges, outside the served-edge budget, and SHALL
NOT be interleaved with the evidence edges.
The conflicts block SHALL state in words that its contents are known disputes
rather than established facts.
Pinned current-artifact-version edges SHALL be capped at ten and SHALL be marked
as an unvalidated inclusion.
The serializer SHALL be a single replaceable function so that surface syntax can
be varied per vendor without changing the layout rules above.

#### Scenario: a contradiction is never served as a fact

- WHEN the candidate set contains an edge that contradicts another served edge
- THEN it appears only in the labelled conflicts block
- AND the block states that these are disputes, not facts.

#### Scenario: the strongest evidence sits last

- WHEN a block contains several subject groups
- THEN the group containing the highest-scoring edge is the last group before
  the closing task restatement.

### Requirement: the citation contract is issued in-context at generation time

Foreman SHALL require citation during generation and SHALL NOT attach graph
provenance to worker output afterwards.

The block SHALL contain the citation instruction, and the instruction SHALL
require an inline edge alias on every factual claim drawn from the graph.
The block SHALL contain at least one worked citation demonstration.
The worker's output contract SHALL include a structured `cited_edges` field and
an `uncited_claims` field.
Foreman SHALL NOT run any process that infers or attaches citations to a
worker's output after generation.
The citation instruction SHALL state a minimum and maximum number of edges per
claim.

#### Scenario: post-hoc attribution is not available as a fallback

- WHEN a worker returns a report with no citations
- THEN the report is recorded as uncited
- AND no process attaches citations to it after the fact.

#### Scenario: the demonstration is present

- WHEN any block is built with at least one edge
- THEN it contains a worked example showing an inline citation.

### Requirement: served edges are never summarised or compressed

The builder SHALL serve edges verbatim with their identifiers.

The builder SHALL NOT summarise, paraphrase or otherwise compress the selected
edges in order to fit more of them into the budget.
WHERE the candidate set does not fit, the builder SHALL reduce the number of
edges rather than the fidelity of each edge.
The block SHALL NOT contain a model-generated prose summary of the served
subgraph.

#### Scenario: budget pressure reduces edges, not fidelity

- WHEN the ranked candidate set exceeds the budget
- THEN the number of served edges is reduced
- AND every served edge appears with its full relation, target and alias.

### Requirement: every citation is verified deterministically after generation

Foreman SHALL treat a worker's citations as claims to be checked, and SHALL
check them without a model.

WHEN a lane returns, the host SHALL verify each cited alias.
IF a cited alias does not resolve to any edge in the graph, THEN the host SHALL
record `HALLUCINATED_EDGE_ID`.
IF a cited alias resolves to a real edge that was not in the block served to that
lane, THEN the host SHALL record `OUT_OF_CONTEXT_CITATION`.
IF a load-bearing claim carries no citation, THEN the host SHALL record
`UNSUPPORTED_CLAIM`.
The verification SHALL be an exact lookup and SHALL NOT invoke a language model
or an entailment judgement.
The verification results SHALL be recorded in the run record and SHALL be
available to the gate.

#### Scenario: an invented edge id is caught

- WHEN a worker cites an alias that appears in no block and matches no edge
- THEN verification records `HALLUCINATED_EDGE_ID` naming the alias.

#### Scenario: a real edge the worker never saw is caught

- WHEN a worker cites an alias that resolves to a real edge that was not served
  to it
- THEN verification records `OUT_OF_CONTEXT_CITATION`.

### Requirement: absence and contradiction are found by query, never by model reading

Foreman SHALL compute questions of absence and contradiction in the builder and
SHALL NOT ask a worker or an auditor to notice them.

The builder SHALL detect missing required evidence and contradictory edge pairs
by deterministic query over `graph.json` and `worklog.jsonl`.
The builder SHALL serve the results of those queries as findings in the block.
Foreman SHALL NOT prompt a model to identify what is missing from, disconnected
in, or globally inconsistent about a served subgraph.
IF an absence question arises that the block cannot answer, THEN it SHALL be
routed to a bounded query rather than to the model.

#### Scenario: a missing dependency is served, not requested

- WHEN a task's spec references a module with no edge to any implementing symbol
- THEN the block contains that absence as a stated finding
- AND the worker is not asked to determine what is missing.

### Requirement: the block is content-hashed, recorded and replayable

The `GraphContextBlock` SHALL be an immutable audit artefact.

The builder SHALL compute a content hash over the full block, including the
alias table, and SHALL write that hash into the run record.
The builder SHALL persist the block itself under the run directory.
WHEN an auditor lane is dispatched for a run, the host SHALL serve it the same
persisted block bytes as the implementer, extended only by the auditor-scoped
edge-type allowlist, and SHALL record both hashes.
A recorded block SHALL be replayable, such that rebuilding it from the same
graph, task, role and budget reproduces the same hash.
IF replay produces a different hash, THEN the difference SHALL be reported as a
determinism defect rather than silently accepted.

#### Scenario: the audit trail proves what the worker saw

- WHEN a run is inspected after the fact
- THEN the run record contains the block hash
- AND the persisted block reproduces that hash.

#### Scenario: the auditor is served the same evidence

- WHEN an auditor lane is dispatched for a completed implementer lane
- THEN it receives the implementer's block bytes plus its role extension
- AND both block hashes are recorded.

### Requirement: the MCP path is a bounded, read-only, wrapped escape hatch

Foreman lanes SHALL reach the graphify MCP server only through a Foreman
wrapper, and only in bounded situations.

The wrapper SHALL perform the vocabulary-expansion pre-step against the graph's
label vocabulary before issuing a query, and SHALL log the expansion.
IF vocabulary expansion produces no terms, THEN the wrapper SHALL fail loudly and
SHALL NOT return an answer.
The wrapper SHALL return structured JSON carrying node identifiers and source
locations, and SHALL NOT return the server's prose strings to a lane.
The wrapper SHALL cap any single result at approximately forty edges and SHALL
count the result against the lane's graph budget.
A tool call SHALL answer a specific question and SHALL NOT return an unbounded
subgraph.
The escape hatch SHALL be available only when seed resolution returned zero
seeds, when the candidate set was truncated, when the question concerns absence
or a count, or when a citation is being verified.
All MCP access SHALL be read-only.

#### Scenario: zero-recall matching fails loudly instead of silently

- WHEN a lane queries with vocabulary that matches no graph label and expansion
  yields no terms
- THEN the wrapper returns an explicit failure
- AND the lane does not receive an answer to paraphrase.

#### Scenario: a tool result cannot become a context dump

- WHEN a wrapped tool call would return more than the cap
- THEN the result is truncated to the cap
- AND the truncation is recorded and charged against the lane's budget.

### Requirement: the builder reconstructs direction at load, not from the `directed` field

The builder SHALL treat edge direction as a property of each link's ordered
endpoints and SHALL reconstruct it when it loads the graph.

WHEN the builder loads `graphify-out/graph.json`, it SHALL build with
`build_from_json(raw, directed=True)` under the pinned interpreter, regardless of
the value of the artifact's `directed` field.
The builder SHALL NOT branch on, warn about, or refuse an artifact whose
`directed` field is `false`, because the upstream merge cadence
(`graphify update`) publishes exactly that and no graphify CLI cadence publishes
anything else.
The builder's directional distance features SHALL be computed over that
reconstructed directed graph.
The builder SHALL NOT expect parallel typed edges between the same ordered pair
in `graph.json`; WHERE both a supporting and a contradicting edge are required
between one ordered pair, they SHALL be read store-native.

#### Scenario: an undirected artifact is loaded as a directed graph

- WHEN the builder loads an artifact whose `directed` field is `false`
- THEN it builds a directed graph from the same link records
- AND an edge `u → v` is present while `v → u` is absent
- AND no warning about the `directed` field is emitted.

#### Scenario: ranking uses reconstructed direction

- WHEN directional distance from a seed is scored
- THEN it is computed over the reconstructed directed graph
- AND not over an undirected view of the same links.

### Requirement: the builder runs off files and requires no graph store

The context builder SHALL depend only on artifacts Foreman produces on disk.

The builder SHALL read `graphify-out/graph.json`,
`graphify-out/worklog.jsonl` and the run-directory JSON.
The builder SHALL NOT require a database, a server or a network service in order
to produce a block.
IF the work-DAG projection is absent, THEN the builder SHALL produce a
knowledge-plane-only block and SHALL state that the work plane was unavailable.
The builder SHALL NOT claim reduced hallucination; the properties it reports
SHALL be citation precision and multi-hop task outcomes.

#### Scenario: the block builds with no store present

- WHEN no graph store is configured or running
- THEN a block is still produced from the files on disk
- AND the run proceeds normally.

#### Scenario: a missing work plane degrades rather than fails

- WHEN `worklog.jsonl` does not exist
- THEN the block contains knowledge-plane edges only
- AND states that the work plane was unavailable.
