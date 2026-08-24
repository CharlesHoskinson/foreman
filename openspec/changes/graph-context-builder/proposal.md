# Change: Ship the deterministic graph-context builder

## Why

The qualified Graphify graph is useful only when Foreman can serve a small,
replayable part of it. Open graph traversal would make the prompt and audit
input depend on worker behavior. A large graph dump would exceed useful prompt
budgets.

v0.4 needs a deterministic read boundary. The boundary must bind each context
block to the qualified graph, the source commit, the task bytes, the role, and
the token budget.

## What changes

- Add a pure graph-context builder for the qualified Graphify 0.9.48 files.
- Select at most eight task-matched seed nodes.
- Select role-approved edges within two hops of those seeds.
- Clamp the context budget to 256 through 4,000 estimated tokens.
- Emit canonical JSON bytes and a SHA-256 digest.
- Emit `NO GRAPH CONTEXT` when no seed matches.
- Mint a stable edge key and a short alias for each served edge.
- Add a deterministic citation verifier with three closed failure codes.
- Add a bounded Node 24 command and copied runtime artifact.

## Impact

The command reads only the selected graph, metadata, and task files. It does
not modify the graph, task, repository, run state, or release state.

The builder remains opt-in for v0.4. Tranche 8 must measure the context arm
before Foreman can attach context to worker or auditor prompts by default.

Automatic prompt injection, run-record persistence, work-DAG joins, absence
queries, an MCP wrapper, and model-quality claims remain deferred.
