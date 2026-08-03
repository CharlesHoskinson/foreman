# Council Core Design Approval

- **Status:** Approved for implementation planning
- **Date:** 2026-08-01
- **Scope:** Architecture and specifications only; implementation has not started.

## Decision

Council will be a local-first TypeScript system that coordinates the installed subscription CLIs for Claude, Codex, Gemini, and Grok. It will expose one provider-neutral MCP control plane and thin native host wrappers.

The core will use immutable functional values and a runtime-free event-sourced domain. Pure `decide`, `evolve`, and `replay` functions will own authoritative decisions. Stable Effect 3 will provide typed application services, Layer composition, structured concurrency, streams, scopes, retries, and telemetry outside the domain.

The canonical OpenSpec artifacts are:

- [Proposal](../../../openspec/changes/design-council-core/proposal.md)
- [Architecture design](../../../openspec/changes/design-council-core/design.md)
- [Capability specifications](../../../openspec/changes/design-council-core/specs/)

## Approved architecture

The directed architecture is: versioned schemas → pure event-sourced domain → Effect application services → Node platform and provider adapters → durable runtime and MCP server → thin Claude, Codex, Gemini, and Grok wrappers.

The authoritative domain event stream is separate from the high-volume provider observation log. SQLite WAL provides expected-version event appends, transactional outbox behavior, leases, checkpoints, and projections. Large data uses immutable content-addressed artifacts.

Provider adapters translate invocation and output only. They do not spawn processes, schedule, retry, persist, authorize, approve, or create domain events. A platform guard owns every process tree and terminates it if Council disappears. V1 resumes from durable checkpoints and does not attach to a previously running provider process.

## Deliberation model

The approved protocol uses:

- independent, sealed initial proposals;
- identity blinding without altering substantive content;
- deterministic admissibility and citation checks;
- round-zero aggregation as the cost and quality baseline;
- a default quorum of three admissible proposals from at least two registered failure domains;
- at most two critique rounds, opened only for material uncertainty or disagreement;
- non-author judges with A/B and B/A order reversal checks for decisive comparisons;
- an evidence-backed minority guard;
- ranking before synthesis; and
- typed abstention or escalation when closure conditions are unmet.

## Security and research model

An immutable task contract defines authority, tools, destinations, data classes, budgets, approvals, evidence scope, and output schema. Every privileged action requires a matching narrow capability. Workers have isolated workspaces, no ambient credentials, and no direct access to the Council control server.

Scrapling 0.4.12, PixelRAG 0.4.0, and Graphify 0.9.32 run behind the Tool Gateway. Network destinations, redirects, credentials, resource bounds, and outputs are mediated. Web pages, model output, pixels, OCR, graph content, and tool results remain untrusted evidence.

Claims map to exact source locations. Provenance and signatures establish lineage only; truth, factual support, source quality, and instruction authority remain separate typed states.

## Capability specifications

The change defines nine capabilities:

1. durable run lifecycle;
2. provider participation and readiness;
3. task authorization and approvals;
4. capability and egress enforcement;
5. supervised evidence research;
6. evidence provenance and claim support;
7. bounded Council deliberation;
8. audit and replay; and
9. MCP and native host integration.

## Deferred decisions

No unresolved question changes the architecture. Budget thresholds, calibration freshness, retention, snapshot cadence, and display thresholds are versioned policy settings to tune during implementation planning and evaluation.

Live provider-process reattachment, hosted multi-tenant operation, distributed consensus, Effect 4 beta, and exactly-once external side effects remain outside v1.

## Review gate

The design committee reviewed functional domain architecture, durable runtime behavior, and security/spec completeness. The user approved the synthesized design on 2026-08-01. The next gate is review of these written artifacts; only after that review will the implementation plan and OpenSpec `tasks.md` be created.
