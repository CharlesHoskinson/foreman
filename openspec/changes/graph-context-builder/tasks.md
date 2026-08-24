# Tasks: deterministic graph context

## 1. Reconcile the release scope

- [x] Keep v0.4 context generation opt-in.
- [x] Defer automatic lane injection and model-quality claims to Tranche 8.
- [x] Defer work-DAG joins, persistence, absence queries, and the MCP wrapper.

## 2. Build the context boundary

- [x] Parse the qualified Graphify 0.9.48 graph and metadata.
- [x] Accept valid graphs through the explicit 32 MiB limit.
- [x] Resolve no more than eight task-matched seeds.
- [x] Apply role relation allowlists before two-hop selection.
- [x] Rank seeds and edges deterministically.
- [x] Clamp the estimated token budget to 256 through 4,000.
- [x] Emit canonical content-hashed context blocks.
- [x] Emit `NO GRAPH CONTEXT` without a fallback subgraph.
- [x] Support valid Graphify edges without `source_location`.

## 3. Verify citations

- [x] Mint deterministic edge keys and block-local aliases.
- [x] Detect unknown, unserved, and missing citations.
- [x] Keep citation verification model-free.

## 4. Ship the command

- [x] Add the bounded Node 24 command.
- [x] Add the copied runtime artifact and manifest entry.
- [x] Prove source and bundled output equality on the qualified graph.

## 5. Gate

- [x] Run the focused graph-context tests.
- [x] Run strict OpenSpec validation.
- [x] Run runtime verification and type checks.
- [x] Run bootstrap release coverage.
- [x] Run the full repository verifier.
- [x] Add the release brief and mark the package coverage row complete.
