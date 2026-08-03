# Council

Council is a local-first, cross-provider deliberation plugin for Claude Code, Codex, Gemini CLI, and Grok Build. It coordinates installed subscription CLIs through one provider-neutral control plane, conducts bounded evidence-backed research, and preserves dissent, provenance, and replayable decisions.

The project takes inspiration from [Karpathy's llm-council](https://github.com/karpathy/llm-council), then adds durable orchestration, typed authorization, supervised research tools, native host wrappers, and a functional TypeScript core.

## Current status

The architecture is approved and recorded as an OpenSpec change. The versioned schemas, pure domain foundation, ACE Profile 1 parser and semantic linter, Effect prompt compiler, provider-schema lowerer, Node prompt-materialization boundary, bounded process runner with optional stdin transport, provider-health canary service, ready-token issuance, Grok canary adapter, and Claude canary adapter are implemented. The complete local quality gate covers these components.

Council is not ready for live release decisions. The TypeScript preflight CLI, durable runtime, MCP server, Codex and Gemini adapters, and native host plugins are not implemented. A bounded xAI smoke test on 2026-08-03 confirmed an earlier boundary: prompt compilation passed, but the provider returned no admissible structured output. See [the xAI live-smoke record](docs/evidence/2026-08-03-xai-live-smoke.md).

Run the code-quality suite (formatting, lint, type checking, architecture, and tests) with:

```sh
corepack pnpm check
```

Run the complete local verification gate, including strict OpenSpec validation and a clean diff check, with:

```sh
corepack pnpm verify
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
- `packages/application/`: Effect ports, prompt preflight, provider-health, and ready-token services.
- `packages/platform-node/`: Node process runner, prompt materializer, digests, and artifact helpers.
- `packages/adapter-grok/`: Grok canary adapter (file prompt, `stdin: null`).
- `packages/adapter-claude/`: Claude canary adapter (stdin prompt bytes).
- `tests/architecture/` and `scripts/`: workspace and dependency-boundary verification.
- `openspec/changes/design-council-core/`: approved proposal, design, and capability specs.
- `docs/research/`: source reports, committee memos, and graph artifacts.
- `docs/superpowers/specs/`: dated design approval record.
- `docs/ROADMAP.md`: delivery sequence and deferred scope.

The remaining implementation layout is documented in the architecture design.
