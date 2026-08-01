# Council

Council is a local-first, cross-provider deliberation plugin for Claude Code, Codex, Gemini CLI, and Grok Build. It coordinates installed subscription CLIs through one provider-neutral control plane, conducts bounded evidence-backed research, and preserves dissent, provenance, and replayable decisions.

The project takes inspiration from [Karpathy's llm-council](https://github.com/karpathy/llm-council), then adds durable orchestration, typed authorization, supervised research tools, native host wrappers, and a functional TypeScript core.

## Current status

The architecture is approved and recorded as an OpenSpec change. The versioned schemas and pure domain foundation are implemented and covered by the complete local quality gate. Provider adapters, Effect application services, research tools, the MCP server, and native host plugins are not yet implemented.

Run the local verification gate with:

```sh
corepack pnpm check
```

- [Proposal](openspec/changes/design-council-core/proposal.md)
- [Architecture design](openspec/changes/design-council-core/design.md)
- [Capability specifications](openspec/changes/design-council-core/specs/)
- [Approved design record](docs/superpowers/specs/2026-08-01-council-core-design.md)
- [Roadmap](docs/ROADMAP.md)
- [Research reports](docs/research/)
- [Knowledge graph report](docs/research/graphify/GRAPH_REPORT.md)
- [Interactive knowledge graph](docs/research/graphify/graph.html)

## Design baseline

- TypeScript with immutable data, discriminated unions, and strict package boundaries.
- A runtime-free event-sourced domain built around pure `decide`, `evolve`, and `replay` functions.
- Stable Effect 3 for the application shell, typed services, resource scopes, concurrency, streams, retries, and telemetry.
- Installed subscription authentication for Claude, Codex, Gemini, and Grok; readiness is capability-probed and never silently substituted.
- Scrapling 0.4.12, PixelRAG 0.4.0, and Graphify 0.9.32 behind a capability-controlled Tool Gateway.
- SQLite WAL for authoritative events and content-addressed artifact storage on the runtime's native filesystem.
- Independent proposals, blinded review, round-zero aggregation, bounded critique, non-author judges, minority protection, and typed abstention.
- Claim-level evidence mappings with provenance kept separate from truth, quality, and authority.

## Repository layout

- `packages/schema/`: versioned serialized contracts and strict decoding.
- `packages/domain/`: runtime-free domain decisions, evolution, replay, authorization, budgets, quorum, and outcomes.
- `tests/architecture/` and `scripts/`: workspace and dependency-boundary verification.
- `openspec/changes/design-council-core/`: approved proposal, design, and capability specs.
- `docs/research/`: source reports, committee memos, and graph artifacts.
- `docs/superpowers/specs/`: dated design approval record.
- `docs/ROADMAP.md`: delivery sequence and deferred scope.

The remaining implementation layout is documented in the architecture design.
