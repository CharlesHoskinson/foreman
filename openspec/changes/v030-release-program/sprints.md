# Sprint order for Foreman v0.3.0

Each sprint starts from the accepted commit of its predecessor. Each sprint
uses TypeScript tests first, Grok implementation, architect verification, a
Codex cold audit, and a ledger-bound Council review.

| Sprint | Scope | Exit condition |
|---:|---|---|
| 0 | Authority, baseline, stale-ledger reconciliation, and destruction inventory | Release truth is current. `SpecCorrectnessV1` reports full mapping and zero defects. |
| 1 | Node workspace, `@foreman/core`, and `@foreman/policy` | Clean install, strict type check, deterministic build, policy known-bad tests, and copied-install smoke pass. |
| 2 | Queue, attempt identity, report freshness, resume, external runtime state, credentials, and secret scans | Immediate enqueue is reliable, resume preserves round semantics, source trees stay free of runtime state, and fixture-aware scans fail closed. |
| 3 | `@foreman/graph-store` | Restored authoritative contracts pass through compiled Node.js and seven Python modules are removed. |
| 4 | `@foreman/launcher` | Node and Effect own supervision. Linux, WSL, Windows, and descendant-churn controls pass without Bun. |
| 5 | `@foreman/event-log`, `@foreman/session`, and project registry | Closed replay, freshness, sidecar, current authority, multi-project recovery, and deleted-project behavior pass. `fm-session.py` is removed. |
| 6 | Current-main session transport | Protocol tests and live Codex and Claude acceptance pass without cherry-picking the divergent branch. |
| 7 | Minimal Council advisory plane | Bundle, quorum, blinding, decision core, CLI, Foreman bridge, report-only gate, and corrected live round pass. |
| 8 | Durable Council runtime and security | Event and artifact stores, leases, recovery, retry ownership, process cleanup, capability, credential, and egress controls pass. |
| 9 | Gemini, readiness, and deliberation | Gemini passes the provider-neutral canary. Aggregate readiness and full typed deliberation pass. |
| 10 | Council MCP and host plugins | Provider-neutral MCP and native host wrappers pass lifecycle, security, recursion, compatibility, and stale-cache controls. |
| 11 | `@foreman/release` | Typed metrics, package evidence, and Tier 2 finality pass. Both Tier 2 Python helpers are removed. |
| 12 | `@foreman/knowledge` and Graphify convergence | Current Graphify CLI and version are pinned. One immutable generation has no stale current-authority references. |
| 13 | `@foreman/orchestration` | Round ownership, recovery, preflight, and environment services run in Node. Legacy entry points are thin adapters. |
| 14 | Zero-Python and residual cleanup | Research and test utilities are ported or retired. Scrapling is externalized unless explicit TypeScript parity is approved. `git ls-files '*.py'` is empty. |
| 15 | External dogfood matrix | A second stateful or monorepo workload passes queue, runtime-state, ready-token, and multi-domain review controls. |
| 16 | Exact-candidate convergence | All local, hosted, graph, audit, Council, and publication predicates pass on one unchanged pushed commit. |
