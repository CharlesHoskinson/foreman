# Council Roadmap

This roadmap records delivery order and product intent. It is not the executable implementation plan and does not replace the future OpenSpec `tasks.md`.

## Phase 0 — Approved architecture

- Preserve the research corpus, committee reviews, and knowledge graph.
- Define the provider-neutral contracts and security invariants in OpenSpec.
- Validate the proposal, design, and nine capability specifications strictly.

Exit condition: the written design is reviewed and accepted as the implementation baseline.

## Phase 1 — Schemas and pure domain

- Establish the pnpm TypeScript workspace and dependency boundaries.
- Define versioned Effect Schema contracts, brands, tagged errors, and migrations.
- Implement runtime-free `decide`, `evolve`, and `replay` functions.
- Prove lifecycle, budget, authorization, quorum, and terminal-state invariants with property and replay tests.
- Status: Hosted root `gates-linux` and `gates-windows` now run the deterministic Council Node 24 gate (`pnpm check` and strict OpenSpec-all) on pull requests without provider credentials.

## Phase 2 — Effect application shell

- Add narrow `Context.Tag` service ports and deterministic in-memory Layers.
- Implement command handling, reactions, structured concurrency, bounded streams, deadlines, and retry ownership.
- Keep Effect execution at application entry points and out of the domain reducer.

## Phase 3 — Durable local runtime

- Add SQLite WAL event and observation stores with expected-version appends and a transactional outbox.
- Add content-addressed artifacts, snapshots, projections, redaction, tamper-evident audit, checkpoints, and replay modes.
- Test crash recovery, projection rebuilding, storage integrity, and ambiguous side-effect outcomes.

## Phase 4 — Process ownership and first provider

- Implement fail-safe process-tree guards for Linux, macOS, native Windows, and Windows-to-WSL execution.
- Certify one read-only provider adapter through golden fixtures, stream fuzzing, cancellation, and live canaries.
- Verify parent-death cleanup and zero owned orphan processes before expanding adapter scope.
- Status: Node process runner with optional stdin transport, provider-health canary service, and Grok adapter unit certification are in tree. Full OS matrix process-tree guards and live canary evidence remain open.

## Phase 5 — Four-provider participation

- Add and independently certify Claude, Codex, Gemini, and Grok adapters.
- Implement the readiness doctor, effective subscription checks, capability evidence, version degradation, and failure-domain quorum.
- Never replace an unavailable requested provider with a different provider without an explicit contract amendment.
- Status: Grok, Claude, and Codex canary adapters are in tree with focused unit tests. Schema-file materialization supports POSIX/WSL and refuses native Windows until an ACL-aware backend exists. Gemini adapter, readiness doctor, and live multi-provider certification remain open.

## Phase 6 — Authorization and deep research

- Add immutable task contracts, exact approvals, capability brokering, credential isolation, worker sandboxes, and egress controls.
- Integrate Scrapling 0.4.12, PixelRAG 0.4.0, and Graphify 0.9.32 through the Tool Gateway.
- Validate captures and outputs independently of exit status; quarantine all model- and web-derived material as untrusted evidence.

## Phase 7 — Council deliberation and provenance

- Add independent sealed proposals, blinding, deterministic admissibility checks, and round-zero aggregation.
- Add selective critique, non-author judging, A/B order reversal, evidence-backed minority protection, rank-then-synthesize, and typed abstention.
- Add claim-level locators, citation verification, transformation lineage, and candidate attribution.

## Phase 8 — MCP and native host wrappers

- Publish the provider-neutral MCP control surface.
- Add thin native wrappers for Claude, Codex, Gemini, and Grok with portable install-relative paths.
- Keep core policy out of wrappers and prevent provider workers from recursively controlling Council.

## Phase 9 — Evaluation and release

- Compare single-model, independent-vote, calibrated-vote, rank-and-fuse, and bounded-debate strategies under equal budgets.
- Evaluate correctness, evidence quality, calibration, bias, minority recovery, latency, cost, cancellation, recovery, and security.
- Require deterministic authorization tests, replay integrity, no unauthorized side effects, and no owned orphan processes across the supported OS matrix.

## Deferred beyond v1

- Reattachment to provider processes that remain alive after a Council runtime crash.
- Hosted multi-tenant operation, distributed consensus, and a mandatory external workflow service.
- Effect 4 beta, Effect Cluster, or experimental workflow packages in the correctness boundary.
- Exactly-once claims for external side effects.
- Unbounded debate or raw-agent-count quorum.
