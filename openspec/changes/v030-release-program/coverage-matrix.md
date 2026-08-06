# v0.3.0 specification coverage matrix

This matrix is the stable item index for `SpecCorrectnessV1`. The canonical
accomplishment ledger supplies the detailed release evidence. The status in
this file describes the v0.3.0 baseline, not a completion claim.

The baseline contains 7 `RT-*` rows and 37 `CW-*` rows. The baseline count is
44.

Each row names these fields:

- stable item ID
- class
- target sprint
- mapped requirement or boundary
- acceptance evidence
- baseline status

## Released truth anchors

| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |
|---|---|---|---|---|---|
| RT-001 | released_truth | released | v0.2.8.2 resolves to commit `076c014a8123d8df341b8037b3be5756c7cf6354`. | Annotated tag and ledger release identity | shipped |
| RT-002 | released_truth | released | v0.2.8.2 passed its recorded local, hosted, formal, NATS, dogfood, and graph evidence. | Ledger verification section for v0.2.8.2 | shipped |
| RT-003 | released_truth | released | v0.2.9.0 is named Total Georgecall and resolves to commit `fbe23257fc389036d6feaa8f38e7b377f3106406`. | Annotated tag and ledger release identity | shipped |
| RT-004 | released_truth | released | v0.2.9.0 shipped the bounded Node.js 24 Council preflight slice and three provider adapters. | Ledger product boundary and package list | shipped |
| RT-005 | released_truth | released | v0.2.9.0 recorded local, hosted, live-canary, audit, dogfood, OpenSpec, and graph evidence. Live canaries used candidate `2ec886c3454b49420405aec87afaa6594ccbfdf8`, not the release commit. | Ledger live-canary section and PR comment `5171848075` | shipped |
| RT-006 | released_truth | released | The v0.2.9.0 dogfood Council result was `quorum_not_met`, not approval or rejection. | External dogfood Council closure evidence | shipped |
| RT-007 | released_truth | released | The v0.2.9.0 graph warnings remain visible and are not reported as clean raw extraction. | Ledger graph warning table | shipped |

## Release boundaries and carried work

| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |
|---|---|---:|---|---|---|
| CW-001 | carried_work | 0 | Correct stale release authority, OpenSpec task state, and residual records. | Sprint 0 authority diff and docs-check | open |
| CW-002 | destruction_constraint | 0 | Trace historical `DST-0030` through current `DST-0039` across both destruction records and inventory worktrees. Ship the fail-closed `DST-0059` guard before any later removal. | Both destruction records, complete owner and digest evidence, and passing pre-destruction guard tests | open |
| CW-003 | carried_work | 1 | Create the Node.js 24 workspace, `@foreman/core`, and `@foreman/policy`. | Clean install, strict type check, and policy known-bad tests | open |
| CW-004 | carried_work | 3 | Fix queue admission, attempt-bound report freshness, resume semantics, and external runtime state. | Sprint 3 deterministic tests after accepted Sprint 2 event-log commit | open |
| CW-005 | carried_work | 3 | Add explicit credential provisioning for isolated provider profiles. | Credential isolation tests and external state root checks | open |
| CW-006 | carried_work | 4 | Port GraphStore and restore or replace its missing authoritative tests. | Compiled Node GraphStore parity suite | open |
| CW-007 | carried_work | 5 | Port launcher supervision from Bun-specific APIs to Node.js and Effect. | Linux, WSL, Windows, and descendant-churn controls | open |
| CW-008 | carried_work | 6 | Implement SessionDB and the project registry only. Project-aware recovery uses the Sprint 2 event-log foundation. | Session recovery and multi-project tests | open |
| CW-009 | carried_work | 7 | Re-port session transport on current main and run its missing live acceptance. | Protocol tests plus live Codex and Claude acceptance | open |
| CW-010 | carried_work | 8 | Complete the minimal Council bundle, blinding, decision, CLI, Foreman bridge, and report-only gate plane. | Minimal advisory plane acceptance suite | open |
| CW-011 | carried_work | 9 | Add durable Council events, artifacts, retries, scheduling, recovery, and the security base. | Durable runtime and security controls | open |
| CW-012 | negative_boundary | 10 | Implement and certify the Council Gemini adapter and aggregate readiness. | Provider-neutral Gemini canary and readiness doctor | open |
| CW-013 | negative_boundary | 10 | Complete Council deliberation beyond the minimal advisory decision slice. | Full typed deliberation acceptance suite | open |
| CW-014 | negative_boundary | 11 | Add the Council MCP server and native host plugins after the runtime stabilizes. | MCP lifecycle, security, recursion, and stale-cache controls | open |
| CW-015 | carried_work | 12 | Port release evidence and remove the Tier 2 Python helpers. | Typed metrics suite and empty Tier 2 Python paths | open |
| CW-016 | carried_work | 13 | Repair Graphify version and CLI drift, port the knowledge plane, and rebuild one current graph unit. | Pinned Graphify version and one immutable generation | open |
| CW-017 | carried_work | 13 | Preserve raw graph warnings and eliminate current references to deleted or retired authority. | Graph validation with retained warnings | open |
| CW-018 | carried_work | 14 | Port orchestration and reduce retained shell and PowerShell files to thin adapters. | Node orchestration services and thin-adapter inventory | open |
| CW-019 | carried_work | 15 | Remove or externalize all remaining Python, including research and vendored files. | `git ls-files '*.py'` is empty for in-scope paths | open |
| CW-020 | carried_work | 16 | Run a broader external dogfood matrix with a stateful target or monorepo. | Second external workload gate evidence | open |
| CW-021 | carried_work | 16 | Preserve ready-token-bound multi-domain Council closure for the exact candidate. | Ready-token multi-domain closure evidence | open |
| CW-022 | carried_work | 17 | Run all release gates, graph rebuild, cold audits, Council review, and publication checks on one unchanged commit. | Exact-candidate gate bundle | open |
| CW-023 | carried_work | 0 | Resolve the eight-package versus nine-package migration mismatch in favor of nine packages including policy. | Workspace package inventory | open |
| CW-024 | carried_work | 0 | Assign `graph-project` ownership to `@foreman/knowledge` with event-log input contracts. | Package ownership map and contract references | open |
| CW-025 | carried_work | 0 | Keep spec triage and discover-lane work parked until their recorded admission dependencies exist. | Parked package status and dependency record | open |
| CW-026 | carried_work | 15 | Resolve the five Scrapling Python files by externalizing the plugin unless TypeScript parity is explicitly accepted. | Externalization or parity decision with evidence | open |
| CW-027 | carried_work | 3 | Make dependency secret scans bounded and fixture-aware without weakening source-secret refusal. | Fixture-aware scan suite and known-bad secret fixtures | open |
| CW-028 | negative_boundary | 11 | Decide private or unpublished Council package publication and prove the chosen boundary. | Explicit package-publication decision and proof | open |
| CW-029 | carried_work | 16 | Close incomplete Windows Bats coverage and the absent native-Windows live-canary boundary. | Windows Bats plan and native-Windows canary decision with evidence | open |
| CW-030 | destruction_constraint | 0 | Resolve `DST-0039` blocked worktree ownership and untracked `SPEC.md` before any removal. | Destruction log head, digest, owner, and blocked state | open |
| CW-031 | destruction_constraint | 0 | Complete `DST-0056` worktree and run-artifact inventory before removal. | Per-worktree head, dirty state, digests, owner, and recovery path | open |
| CW-032 | carried_work | 2 | Ship the typed `@foreman/event-log` foundation before queue and session dependents. | Event-log contract tests and accepted Sprint 2 commit | open |
| CW-033 | carried_work | 12 | Formal-model plane packages and workflows plus the formal release-scope decision. | Reconciled formal-package state and explicit release-criteria proof | open |
| CW-034 | carried_work | 15 | Superpowers extraction blocked on a complete dependency manifest. | Passing complete manifest or an explicit retirement or externalization decision | open |
| CW-035 | carried_work | 10 | Council supervised research gateway after the Sprint 9 security base. | Bounded tools, quarantine, and denial controls | open |
| CW-036 | carried_work | 10 | Council evidence provenance and claim verification. | Content-bound identities, exact locators, lineage, and verification | open |
| CW-037 | carried_work | 16 | Council evaluation and release program. | Reproducible evaluation manifests, attack and utility controls, platform recovery tests, and signed release inputs | open |

## Metric rules

- `baseline_item_count` is 44.
- The baseline is the set of all `RT-*` and `CW-*` rows in this file.
- A reviewer emits exactly one item result for every baseline ID.
- Sort item results by UTF-8 byte order of item ID.
- The exact canonical sequence is `CW-001` through `CW-037`, then `RT-001`
  through `RT-007`.
- Each item result uses one disposition from the closed set `mapped`,
  `evidenced_defer`, `omitted`, `contradiction`, and `unevidenced_defer`.
- Duplicate, unknown, or missing IDs make the response invalid.
- The five disposition counts are host-derived from those mutually exclusive
  item results. Their sum equals 44.
- `mapped_item_count` counts only `mapped`.
- `evidenced_defer_count` counts only `evidenced_defer`.
- `omitted_item_count` counts only `omitted`.
- `contradiction_count` counts only `contradiction`.
- `unevidenced_defer_count` counts only `unevidenced_defer`.
- An `evidenced_defer` disposition names nonblank reason, owner, target
  release, blocking dependency, and acceptance evidence. An `evidenced_defer`
  is not a defect.
- An `unevidenced_defer` is a defect.
- Invented completions are a separate sorted set of `InventedCompletionV1`
  records. `invented_completion_count` equals that set size.
- An `InventedCompletionV1` record is an actionable source-located record.
  After a reviewer detects an invented completion, the host selects a
  whole-line byte range that contains the claim. The range starts at byte
  zero or immediately after LF. The range ends at EOF or includes a
  terminating LF. The range is nonempty valid UTF-8. The host verifies
  artifact, range, exact-slice, and record digests against immutable
  artifact bytes. The record fields are artifact alias, artifact SHA-256,
  zero-based start byte, exclusive end byte, exact-slice SHA-256, short
  summary, and corrective action. Sort invention records by digest byte
  order. The record digest is SHA-256 over artifact digest, NUL, decimal
  start, NUL, decimal end, NUL, and the exact source bytes. Do not use
  free-form claim IDs.
- Duplicate invention-record digests make the response invalid.
- Counts are derived from arrays. Counts are not accepted as independent model
  claims.
- Every `mapped` result contains nonblank sprint, requirement, acceptance
  evidence, and status.
- Canonical result encoding is recursively key-sorted UTF-8 JSON with no
  insignificant whitespace and one trailing LF.
- The outcome is `accept` only when `mapped + evidenced_defer = 44`, every
  defect count is zero, invented completions are zero, every bound identity
  matches, and the response is valid.
- Defect counts are `omitted_item_count`, `contradiction_count`, and
  `unevidenced_defer_count`.
- Otherwise the outcome is `changes_requested`, except a reviewer may `abstain`
  only for a named evidence gap under the existing Council rules.
- An identity mismatch is not an abstention. The result is excluded from
  admission and the candidate receives `changes_requested`.
