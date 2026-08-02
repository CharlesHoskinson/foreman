## Why

Council needs a provider-neutral, durable control plane for consulting Claude, Codex, Gemini, and Grok through their installed subscription CLIs. The four CLIs expose different protocols, authentication behavior, lifecycle controls, and plugin formats, while unbounded debate and unrestricted research tools create reliability, cost, bias, and security risks.

## What Changes

- Add a local-first Council runtime with durable runs, checkpoints, cancellation, budgets, typed failures, and immutable terminal outcomes.
- Add provider participation through capability-probed Claude, Codex, Gemini, and Grok CLI adapters without making any provider wire format public.
- Compile user intent into an immutable, versioned task contract with explicit amendments and exact approvals.
- Place worker tools, network access, credentials, and side effects behind a capability and egress boundary.
- Add supervised Scrapling 0.4.12, PixelRAG 0.4.0, and Graphify research flows with quarantined evidence.
- Add artifact lineage, exact claim-to-evidence mappings, citation verification, and separate provenance, truth, quality, and authority states.
- Add independent proposals, blinded review, round-zero aggregation, selective deliberation, bias checks, minority protection, and typed abstention.
- Add tamper-evident audit records, deterministic recorded-input replay, honest live-replay divergence, and incident handling.
- Add one provider-neutral MCP control surface with thin native wrappers for Claude, Codex, Gemini, and Grok.
- Use a functional TypeScript design: versioned Effect Schema contracts, a runtime-free event-sourced domain, and an Effect application shell.
- Pin the stable Effect 3 line for v1; experimental Effect workflow and cluster packages are outside the correctness boundary.
- Defer reconnecting to already-running provider processes after a Council crash. V1 terminates owned process trees and resumes only from durable checkpoints.

## Capabilities

### New Capabilities

- `run-lifecycle`: Durable run states, append-before-publish events, checkpoints, budgets, retries, cancellation, recovery, and immutable terminal outcomes.
- `provider-participation`: Subscription CLI discovery, authentication doctoring, capability evidence, normalized provider observations, adapter compatibility, and failure-domain quorum.
- `task-authorization`: Authority classes, immutable task contracts, amendments, exact approvals, side-effect states, and fail-closed commitment decisions.
- `capability-egress`: Narrow capabilities, worker isolation, tool mediation, credential injection, structured network requests, SSRF prevention, redirects, and secret boundaries.
- `evidence-research`: Supervised Scrapling, PixelRAG, and Graphify workflows, collection limits, visual validation, graph-query preference, and evidence quarantine.
- `evidence-provenance`: Artifact identity, transformation lineage, typed provenance validation, claim-level locators, citation support states, and candidate attribution.
- `council-deliberation`: Independent proposals, blinding, admissibility, round-zero metrics, calibrated confidence, failure-domain quorum, bounded critique, judging, minority guard, synthesis, and abstention.
- `audit-replay`: Canonical audit events, tamper evidence, redaction, checkpoints, replay modes, deterministic decision verification, and security incidents.
- `host-integration`: Provider-neutral Council commands and events, MCP task mapping, thin native host wrappers, portable paths, recursion prevention, and installation trust boundaries.

### Modified Capabilities

None. This is a greenfield repository.

## Impact

- Creates a TypeScript workspace with independent schema, domain, application, Node platform, provider-adapter, runtime, MCP, testing, and host-wrapper boundaries.
- Introduces stable Effect 3, Effect Schema, a local SQLite event store in WAL mode, and content-addressed artifact storage.
- Invokes installed subscription CLIs rather than requiring provider API keys.
- Invokes pinned Python research workers for Scrapling and PixelRAG and a pinned Graphify installation through a controlled tool gateway.
- Requires native process-tree conformance on Windows, WSL, Linux, and macOS.
- Requires strict OpenSpec validation and equal-budget quality, safety, bias, recovery, and cancellation evaluation before release.
