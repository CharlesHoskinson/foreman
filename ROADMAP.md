# Foreman roadmap

This file is the current release roadmap. Dated plans, research reports, and
evidence files are historical records. They do not override this file.

## Latest release: George's Odyssey (v0.3.1)

Released 2026-08-22. v0.3.1 is one sentence: **session state is portable — one
contract, two implementations.**

`SessionStore` is the synchronous, transactional system of record.
`SqliteSessionStore` and `FilesOnlySessionStore` both pass the same 49-case
contract. `MemoryIndex` is an asynchronous, optional projection port.
`NullMemoryIndex` remains the only shipping adapter, so local correctness does
not require a network or credentials.

The release adds a durable desired-state outbox, `fm-session sync`, additive
collision-safe snapshot import, and a tested boundary around raw SQLite
access. Outbox delivery is durable idempotent at-least-once. It is not
exactly-once.

Product measurements bind to commit
`64604d24308b446eaf1102177165622d3ec29167`. The final reviewed candidate is
`0f841b4b2d3e52f0afafcc50026c49324a42ab8a`. Pull request
[#45](https://github.com/CharlesHoskinson/foreman/pull/45) merged it as
`c9030fbb98c0d723cd39ad361cb98a3e74b5f487`. The exact candidate
[gate](https://github.com/CharlesHoskinson/foreman/actions/runs/32556688358)
and exact integrated
[gate](https://github.com/CharlesHoskinson/foreman/actions/runs/32557610402)
passed. Release publication follows only after the release-state record merges
and its exact `main` gate passes.

## Released line

| Version | Date | Purpose |
|---|---|---|
| `v0.1.0` | 2026-07-15 | Initial cross-vendor orchestration skill |
| `v0.2.0` | 2026-07-17 | Durable lanes and recovery |
| `v0.2.5` | 2026-07-18 | Orchestration hardening |
| `v0.2.7.5` | 2026-07-18 | Setup, use, and cleanup lifecycle |
| `v0.2.8` | 2026-07-19 | Vendor concurrency and hard mode |
| `v0.2.8.1` | 2026-07-19 | Field-failure fixes |
| `v0.2.8.2` | 2026-08-03 | External soft-mode pilot and portability fixes |
| `v0.2.9.0` | 2026-08-03 | Total Georgecall Council preflight |
| `v0.3.0` | 2026-08-08 | One Runtime — the Node migration finished |
| `v0.3.1` | 2026-08-22 | George's Odyssey — portable session state |

Git tags and release notes preserve the complete history. Use Git history when
an old release decision matters. Do not add old plans back to this live file.

## v0.3.1 completion record

The release includes:

| Item | State |
|---|---|
| CLI port cutover and backend factory | Complete. Production orchestration imports no raw SQLite or concrete backend constructor |
| `FilesOnlySessionStore` | Complete. Snapshot and outbox use paired immutable generations |
| Conformance negative control | Complete. The do-nothing store fails 24 of 49 cases across eight categories |
| Durable projection outbox and `fm-session sync` | Complete. Delivery is idempotent at-least-once with opaque receipt acknowledgement |
| Additive `remap` import | Complete. Per-kind IDs, same-kind pointers, sessions, counters, and pending receipts are handled atomically |
| Legacy SQLite migration and rebuild boundary | Complete. Raw SQLite access is inside `packages/session-store/src` and failure-injection tests cover DB, WAL, and SHM safety |
| Shipped runtime | Complete. `fm-session.js` was rebuilt and manifest-verified |
| External `MemoryIndex` adapter | Not in v0.3.1. Assigned to v0.4.0 |
| Windows Bats suite | BW-004, unchanged from v0.3.0 |

The measured predicates are:

| # | Predicate | Verdict |
|---|---|---|
| 1 | No raw or concrete backend access outside the port | **PASS**, boundary 6/6 |
| 2 | CLI behaviour unchanged | **PASS**, Bats 29/29 and golden 15/15 |
| 3 | One unchanged contract passes against both implementations | **PASS**, 49 cases per backend |
| 4 | System-of-record correctness is independent of projection | **PASS**, I2 3/3 and durable failure tests |
| 5 | `fm-session-main.ts` has no `ts-nocheck` | **PASS**, 0 occurrences |
| 6 | Outbox delivery is durable idempotent at-least-once | **PASS**, drain 14/14 |

The full TypeScript suite found 1,665 tests: 1,661 passed, 4 skipped, and none
failed. The SessionStore package passed 171/171. The complete evidence and
residuals are in `docs/releases/v0.3.1-notes.md`.

The eighteen-sprint program described in earlier revisions of this file was
measured at 43 packages and roughly 819 open tasks, over half of it the tool
observing itself. The v0.4 governor narrows that carry-over into the stable
assignments below. Existing change packages remain unmodified until their
required design reconciliation.

## Next program: v0.4.0

The next program includes the first external `MemoryIndex` adapter, projection
epochs, and live-service tests. It also retains Windows Bats item BW-004.
Files-only writer exclusion remains a single-host claim, not a network
filesystem lease.

The coverage checker parses this table as the complete Roadmap assignment
inventory. `Coverage key` values are stable machine identifiers.

| Coverage key | Scope | Release | Owner |
|---|---|---|---|
| `roadmap:sprint-6-project-registry` | Sprint 6 project registry | `v0.4` | `project-registry` |
| `roadmap:sprint-8-minimal-council` | Sprint 8 minimal Council | `v0.6` | `council-review-plane` |
| `roadmap:sprint-9-council-runtime-security` | Sprint 9 Council runtime and security | `v0.6` | `council-review-plane` |
| `roadmap:sprint-10-council-research` | Sprint 10 deliberation, research, and provenance | `v0.6` | `council-review-plane` |
| `roadmap:sprint-11-council-interfaces` | Sprint 11 Council MCP, plugins, and publication | `v0.6` | `council-review-plane` |
| `roadmap:sprint-12-release-formal-carryover` | Sprint 12 release and formal carry-over | `v0.6` | `formal-model-suite` |
| `roadmap:sprint-13-knowledge-graph` | Sprint 13 knowledge and graph work | `v0.4` | `knowledge-plane-refresh` |
| `roadmap:sprint-16-windows-bats-bw004` | Sprint 16 Windows Bats item BW-004 | `v0.4` | `v040-release-program` |
| `roadmap:sprint-16-external-dogfood` | Sprint 16 broad external dogfood and Council evaluation | `v0.6` | `council-review-plane` |
| `roadmap:v040-external-memory-index` | External MemoryIndex, epochs, and live-service tests | `v0.4` | `external-memory-index` |
| `roadmap:v040-knowledge-graph-plane` | Focused knowledge and graph plane | `v0.4` | `knowledge-plane-refresh` |
| `roadmap:v040-publication` | Exact-candidate release and publication | `v0.4` | `v040-release-program` |
| `roadmap:v050-lane-runtime` | One TypeScript lane runtime, Bash adapters, policy pins retired | `v0.5` | `lane-runtime-typescript` |
| `roadmap:v050-verdict-honesty` | Three-outcome verdicts, grounded gate, evidence contracts | `v0.5` | `evidence-contracts` |
| `roadmap:v050-host-truth` | Session-store recovery, build determinism, WSL preflight | `v0.5` | `build-determinism` |
| `roadmap:v050-workflow-weight` | Verification receipts, one-command rounds, tiered gates, doctrine core | `v0.5` | `workflow-weight-reduction` |
| `roadmap:v050-publication` | Exact-candidate release and publication | `v0.5` | `v050-release-program` |

## Current authority

- Shipped v0.3.1 release notes: `docs/releases/v0.3.1-notes.md`
- v0.3.1 storage architecture: `docs/architecture/storage-port.md`
- Prior v0.3.0 release notes: `docs/releases/v0.3.0-notes.md`
- Canonical accomplishment ledger:
  `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`
- Superseded v0.3.0 release program: `openspec/changes/v030-release-program/`
- TypeScript migration checklist: `typescriptmigration.md`
- v0.3.0 destruction log: `docs/releases/v0.3.0-destruction-log.md`
- Shipped v0.2.9.0 release record: `checklist.md`
- Current residuals: `docs/RESIDUALS.md`
- Environment and vendor traps: `AGENT_TRAPS.md`
- Historical evidence rules: `docs/evidence/README.md`
