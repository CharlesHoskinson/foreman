# v0.3.0 specification coverage matrix

This matrix is the stable item index for `SpecCorrectnessV1`. The canonical
accomplishment ledger supplies the detailed release evidence. The status in
this file describes the v0.3.0 baseline, not a completion claim.

## Released truth anchors

| ID | Class | Required representation |
|---|---|---|
| RT-001 | released_truth | v0.2.8.2 resolves to commit `076c014a8123d8df341b8037b3be5756c7cf6354`. |
| RT-002 | released_truth | v0.2.8.2 passed its recorded local, hosted, formal, NATS, dogfood, and graph evidence. |
| RT-003 | released_truth | v0.2.9.0 is named Total Georgecall and resolves to commit `fbe23257fc389036d6feaa8f38e7b377f3106406`. |
| RT-004 | released_truth | v0.2.9.0 shipped the bounded Node.js 24 Council preflight slice and three provider adapters. |
| RT-005 | released_truth | v0.2.9.0 passed its recorded local, hosted, live-canary, audit, dogfood, OpenSpec, and graph evidence. |
| RT-006 | released_truth | The v0.2.9.0 dogfood Council result was `quorum_not_met`, not approval or rejection. |
| RT-007 | released_truth | The v0.2.9.0 graph warnings remain visible and are not reported as clean raw extraction. |

## Release boundaries and carried work

| ID | Class | Target sprint | Required representation |
|---|---|---:|---|
| CW-001 | carried_work | 0 | Correct stale release authority, OpenSpec task state, and residual records. |
| CW-002 | destruction_constraint | 0 | Inventory worktrees and resolve `DST-0030` ownership before removal. |
| CW-003 | carried_work | 1 | Create the Node.js 24 workspace, `@foreman/core`, and `@foreman/policy`. |
| CW-004 | carried_work | 2 | Fix queue admission, attempt-bound report freshness, resume semantics, and external runtime state. |
| CW-005 | carried_work | 2 | Add explicit credential provisioning for isolated provider profiles. |
| CW-006 | carried_work | 3 | Port GraphStore and restore or replace its missing authoritative tests. |
| CW-007 | carried_work | 4 | Port launcher supervision from Bun-specific APIs to Node.js and Effect. |
| CW-008 | carried_work | 5 | Implement the typed event log, SessionDB, project registry, and project-aware recovery. |
| CW-009 | carried_work | 6 | Re-port session transport on current main and run its missing live acceptance. |
| CW-010 | carried_work | 7 | Complete the minimal Council bundle, blinding, decision, CLI, Foreman bridge, and report-only gate plane. |
| CW-011 | carried_work | 8 | Add durable Council events, artifacts, retries, scheduling, recovery, and the security base. |
| CW-012 | negative_boundary | 9 | Implement and certify the Council Gemini adapter and aggregate readiness. |
| CW-013 | negative_boundary | 9 | Complete Council deliberation beyond the minimal advisory decision slice. |
| CW-014 | negative_boundary | 10 | Add the Council MCP server and native host plugins after the runtime stabilizes. |
| CW-015 | carried_work | 11 | Port release evidence and remove the Tier 2 Python helpers. |
| CW-016 | carried_work | 12 | Repair Graphify version and CLI drift, port the knowledge plane, and rebuild one current graph unit. |
| CW-017 | carried_work | 12 | Preserve raw graph warnings and eliminate current references to deleted or retired authority. |
| CW-018 | carried_work | 13 | Port orchestration and reduce retained shell and PowerShell files to thin adapters. |
| CW-019 | carried_work | 14 | Remove or externalize all remaining Python, including research and vendored files. |
| CW-020 | carried_work | 15 | Run a broader external dogfood matrix with a stateful target or monorepo. |
| CW-021 | carried_work | 15 | Preserve ready-token-bound multi-domain Council closure for the exact candidate. |
| CW-022 | carried_work | 16 | Run all release gates, graph rebuild, cold audits, Council review, and publication checks on one unchanged commit. |
| CW-023 | carried_work | 0 | Resolve the eight-package versus nine-package migration mismatch in favor of nine packages including policy. |
| CW-024 | carried_work | 0 | Assign `graph-project` ownership to `@foreman/knowledge` with event-log input contracts. |
| CW-025 | carried_work | 0 | Keep spec triage and discover-lane work parked until their recorded admission dependencies exist. |
| CW-026 | carried_work | 14 | Resolve the five Scrapling Python files by externalizing the plugin unless TypeScript parity is explicitly accepted. |
| CW-027 | carried_work | 2 | Make dependency secret scans bounded and fixture-aware without weakening source-secret refusal. |

## Metric rules

- `baseline_item_count` is the number of `RT-*` and `CW-*` rows.
- A mapped item names a sprint, requirement, acceptance evidence, and status.
- A defer is valid only when it names the reason, owner, target release, and
  dependency that blocks current implementation.
- A candidate with a missing row, contradictory claim, invented completion,
  or unevidenced defer receives `changes_requested`.
- A reviewer reports the exact item IDs behind every nonzero count.
