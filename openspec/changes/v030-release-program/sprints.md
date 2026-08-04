# Sprint order for Foreman v0.3.0

Each sprint starts from the accepted commit of its predecessor. Each sprint
uses TypeScript tests first, Grok implementation, architect verification, a
Codex cold audit, and a ledger-bound Council review.

Sprint 3 depends on the accepted Sprint 2 event-log commit.

| Sprint | Scope | Exit condition |
|---:|---|---|
| 0 | Authority, baseline, reconciliation, and destruction inventory | Release truth is current. Package inventory is nine families including `@foreman/policy`. `graph-project` ownership is assigned to `@foreman/knowledge` with event-log input contracts. `SpecCorrectnessV1` reports full mapping and zero defects. |
| 1 | Node workspace, `@foreman/core`, and `@foreman/policy` | Clean install, strict type check, deterministic build, policy known-bad tests, and copied-install smoke pass. `@foreman/policy` remains its own package family. |
| 2 | Typed `@foreman/event-log` foundation | Closed event-log contracts pass. The accepted Sprint 2 commit is available to dependents. `@foreman/event-log` remains the event-log system of record. |
| 3 | Queue, attempt identity, report freshness, resume, external runtime state, credentials, and fixture-aware scans | Immediate enqueue is reliable, resume preserves round semantics, source trees stay free of runtime state, and fixture-aware scans fail closed. |
| 4 | `@foreman/graph-store` | Restored authoritative contracts pass through compiled Node.js and seven Python modules are removed. |
| 5 | `@foreman/launcher` | Node and Effect own supervision. Linux, WSL, Windows, and descendant-churn controls pass without Bun. |
| 6 | SessionDB and project registry | Closed replay, freshness, sidecar, current authority, multi-project recovery, and deleted-project behavior pass. `fm-session.py` is removed. |
| 7 | Current-main session transport | Protocol tests and live Codex and Claude acceptance pass without cherry-picking the divergent branch. |
| 8 | Minimal Council advisory plane | Bundle, quorum, blinding, decision core, CLI, Foreman bridge, report-only gate, and corrected live round pass. |
| 9 | Durable Council runtime and security | Event and artifact stores, leases, recovery, retry ownership, process cleanup, capability, credential, and egress controls pass. |
| 10 | Gemini, aggregate readiness, and full deliberation | Gemini passes the provider-neutral canary. Aggregate readiness and full typed deliberation pass. |
| 11 | Council MCP, host plugins, and package-publication decision | Provider-neutral MCP and native host wrappers pass lifecycle, security, recursion, compatibility, and stale-cache controls. Package publication is decided with proof. |
| 12 | `@foreman/release` | Typed metrics, package evidence, and Tier 2 finality pass. Both Tier 2 Python helpers are removed. |
| 13 | `@foreman/knowledge` and Graphify convergence | Current Graphify CLI and version are pinned. One immutable generation has no stale current-authority references. `graph-project` is owned by `@foreman/knowledge`. It consumes typed `@foreman/event-log` inputs and does not become the event-log system of record. |
| 14 | `@foreman/orchestration` | Round ownership, recovery, preflight, and environment services run in Node. Legacy entry points are thin adapters. |
| 15 | Zero-Python and residual cleanup | Research and test utilities are ported or retired. Scrapling is externalized unless explicit TypeScript parity is approved. `git ls-files '*.py'` is empty. |
| 16 | External dogfood and Windows boundary | A second stateful or monorepo workload passes. Incomplete Windows Bats and absent native-Windows live-canary boundaries are closed or explicitly deferred with evidence. |
| 17 | Exact-candidate convergence | All local, hosted, graph, audit, Council, and publication predicates pass on one unchanged pushed commit. |
