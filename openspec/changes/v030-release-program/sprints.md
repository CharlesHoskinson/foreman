# Sprint order for Foreman v0.3.0

## Execution safety prerequisite

Ship **Foreman Endstop** before more sprint package execution. Endstop must
persist one shared feedback budget outside each worktree. Every later
workstream must use it. The hostile loop-closure test must pass before Sprint
3 resumes.

Each package starts from its accepted dependency commit. Each package uses
TypeScript tests first, implementation, architect verification, one Codex cold
audit, and at most one Endstop-bound Council review.

Do not use a sprint as an execution-budget boundary. Split a sprint into
packages when two tasks can receive independent acceptance verdicts. Give each
package one Endstop contract. A new lane, round, session, or attempt does not
create a new budget.

For Sprint 3 R7B2, use four packages: admission core, lane adapter,
obsolete-home removal, and release verification. The release-verification
package depends on the other three packages. The obsolete-home package is
independent of the admission-core package.

Sprint 3 depends on the accepted Sprint 2 event-log commit.

| Sprint | Scope | Exit condition |
|---:|---|---|
| 0 | Authority, baseline, reconciliation, and destruction inventory | Release truth is current. Package inventory is nine families including `@foreman/policy`. `graph-project` ownership is assigned to `@foreman/knowledge` with event-log input contracts. The 44-item baseline is complete. `SpecCorrectnessV1` reports `mapped + evidenced_defer = 44` and zero defects. |
| 1 | Node workspace, `@foreman/core`, and `@foreman/policy` | Clean install, strict type check, deterministic build, policy known-bad tests, and copied-install smoke pass. Canonical TypeScript `verify-install` and runtime `plugin-drift` cover repository, copy, path, snapshot-bound drift, and real link-mode tests (POSIX symlink / Windows junction with platform skip). Hosted Windows CI and legacy Setup/installer/whole-skill plugin-drift ports stay open. `@foreman/policy` remains its own package family. |
| 2 | Typed `@foreman/event-log` foundation | Typed foundation complete in `@foreman/event-log` (closed StoredEvent decoder, bounded NDJSON replay, physical-line cursors, attempt identity; schema v1 bounds: depth 64, nodes 100_000, line 1_048_576 B, input 67_108_864 B, lines 100_000). Filesystem writers, consumer migration, and legacy `eventlog.sh` adapters remain open. The accepted Sprint 2 commit is available to dependents after architect verify, cold audit, and land. `@foreman/event-log` remains the event-log system of record. |
| 3 | Queue, attempt identity, report freshness, resume, external runtime state, credentials, and fixture-aware scans | Queue admission, attempt-bound round transactions, report freshness, the live round runtime, vendor Setup and profile-bound lane admission through R7B2, the pure resume decision, process/lock observation services, atomic resume-count persistence, the Node supervisor adapter, the bounded fixture-aware Grok secret scan, external credential-profile authority, and profile-bound Setup preflight are complete in Node.js 24 TypeScript and Effect. R7C profile-use leasing is the active package. Remaining restore and queue execution ports and other shell ports remain open. |
| 4 | `@foreman/graph-store` | Restored authoritative contracts pass through compiled Node.js and seven Python modules are removed. Historical note: the tracked-delete guard package only shipped the fail-closed executor and kept a no-delete boundary. The follow-on package `v030-graph-store-python-retirement-20260805-1` authorized DST-0040 and performed the seven-module deletion. Residual Sprint 4 work outside that exact deletion remains open where not proved. |
| 5 | `@foreman/launcher` | Partial: Node core CLI, Effect supervise, POSIX process-group fallback, typed Windows degraded boundary, bounded live descendant-churn observation (launcher zombie direct children on `/proc`), and `foreman-launch.js` runtime artifact land under `launcher-node-port`. Live PID-namespace cascade is designed but host-unavailable where unshare is denied. System-wide process-table exhaustion, Job Object parity, legacy caller conversion, and Bun tree retirement remain open. Sprint 5 is not complete. |
| 6 | SessionDB and project registry | Closed replay, freshness, sidecar, current authority, multi-project recovery, and deleted-project behavior pass. `fm-session.py` is removed. |
| 7 | Current-main session transport | Protocol tests and live Codex and Claude acceptance pass without cherry-picking the divergent branch. |
| 8 | Minimal Council advisory plane | Bundle, quorum, blinding, decision core, CLI, Foreman bridge, report-only gate, and corrected live round pass. |
| 9 | Durable Council runtime and security | Event and artifact stores, leases, recovery, retry ownership, process cleanup, capability, credential, and egress controls pass. |
| 10 | Gemini, aggregate readiness, full deliberation, supervised research gateway, and evidence provenance | Gemini passes the provider-neutral canary. Aggregate readiness and full typed deliberation pass. The supervised research gateway proves bounded tools, quarantine, and denial controls. Evidence provenance proves content-bound identities, exact locators, lineage, and verification. |
| 11 | Council MCP, host plugins, and package-publication decision | Provider-neutral MCP and native host wrappers pass lifecycle, security, recursion, compatibility, and stale-cache controls. Package publication is decided with proof. |
| 12 | `@foreman/release` and formal-model plane | Typed metrics, package evidence, and Tier 2 finality pass. Both Tier 2 Python helpers are removed. Formal-model packages and workflows are reconciled and the formal release-scope decision has explicit release-criteria proof. |
| 13 | `@foreman/knowledge` and Graphify convergence | Current Graphify CLI and version are pinned. One immutable generation has no stale current-authority references. `graph-project` is owned by `@foreman/knowledge`. It consumes typed `@foreman/event-log` inputs and does not become the event-log system of record. |
| 14 | `@foreman/orchestration` | Round ownership, recovery, preflight, and environment services run in Node. Legacy entry points are thin adapters. |
| 15 | Zero-Python, Superpowers, and residual cleanup | Research and test utilities are ported or retired. Scrapling is externalized unless explicit TypeScript parity is approved. Superpowers extraction passes a complete dependency manifest or records an explicit retirement or externalization decision. `git ls-files '*.py'` is empty. |
| 16 | External dogfood, Windows boundary, ready-token multi-domain Council closure, and Council evaluation program | A second stateful or monorepo workload passes. Incomplete Windows Bats and absent native-Windows live-canary boundaries are closed or recorded as `evidenced_defer` with reason, owner, target release, blocking dependency, and acceptance evidence. Ready-token-bound multi-domain Council closure is preserved for the exact candidate. The Council evaluation program proves reproducible evaluation manifests, attack and utility controls, platform recovery tests, and signed release inputs. |
| 17 | Exact-candidate convergence | All local, hosted, graph, audit, Council, and publication predicates pass on one unchanged pushed commit. |
