# Design: deterministic graph context

## Boundary

The v0.4 context builder is a pure function:

```text
context = build(graph bytes, metadata bytes, task text, role, budget)
```

The builder accepts canonical LF-terminated JSON. It accepts a graph up to 32
MiB and metadata up to 1 MiB. The metadata must identify Graphify 0.9.48, zero
model tokens, a lowercase source commit, and the exact graph digest.

The command reads regular files through explicit absolute paths. It rejects a
symbolic-link leaf, an oversized file, invalid UTF-8, or a file identity change.

## Selection

The builder normalizes the task text and extracts unique search tokens. It
scores node identifiers, labels, and source paths by token matches. It selects
at most eight seed nodes in deterministic order.

The implementer role accepts source-code structure relations. The auditor role
also accepts citation and rationale relations. The builder applies the role
allowlist before it selects edges.

The builder visits incident edges for two hops. It ranks edges by task matches,
hop number, and edge key. It uses UTF-8 byte order for every tie.

The builder emits `NO GRAPH CONTEXT` when no node matches the task. It never
substitutes a global or random subgraph.

## Identity and budget

An edge key is the SHA-256 digest of these NUL-separated values:

```text
source, target, relation, source_file, source_location
```

Graphify can omit `source_location` for a valid dynamic-import edge. The
builder represents that absence as an empty string. Each selected edge also
gets a block-local alias such as `e01`.

The builder clamps a requested budget to 256 through 4,000 tokens. It estimates
tokens as the canonical byte length divided by four and rounded up. It adds an
edge only when the complete serialized block remains within the budget.

The output is canonical LF-terminated JSON. The block records the graph digest,
source commit, task digest, role, budget, estimate, truncation state, seeds,
edges, and citation instruction. The result also includes the complete block
digest.

## Verification

The verifier checks every cited alias or edge key against the served block and
the source graph. It returns these codes in UTF-8 byte order:

- `HALLUCINATED_EDGE_ID` for an unknown edge.
- `OUT_OF_CONTEXT_CITATION` for a real edge that was not served.
- `UNSUPPORTED_CLAIM` for a claim without a citation.

The verifier does not call a model and does not infer support.

## Deferred work

v0.4 does not claim that graph context improves task outcomes. Tranche 8 owns
that falsification test.

v0.4 does not attach the block to lanes automatically. It does not persist the
block in run state, join work-DAG records, calculate graph absence, or expose an
MCP query service. Those changes need separate measurements and integration
contracts.
