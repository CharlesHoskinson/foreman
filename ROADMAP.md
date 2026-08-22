# Foreman roadmap

This file is the current release roadmap. Dated plans, research reports, and
evidence files are historical records. They do not override this file.

## Latest release: One Runtime (v0.3.0)

Annotated tag `v0.3.0` targets exact commit
`d4040316f3dfe5406773d8a483ddd8662b035554`, tagged 2026-08-08.

v0.3.0 is one sentence: **the Node migration is finished — one runtime, one
language.**

Foreman's own Python is gone. `git ls-files '*.py'` returns seven files: four
vendored `scrapling` templates, one vendored `scrapling` test, one vendored
`superpowers` token-usage utility, and one archived schema checker under
`openspec/changes/archive/`. None of them is Foreman's.

Three subsystems moved to Node.js 24 and TypeScript. The session store became
`packages/orchestration/src/fm-session-main.ts`, driven by `tests/session.bats`
through `FM_SESSION_CMD`. The Tier 2 evaluator reproduces Python's output byte
for byte, which required porting MT19937 including its SHA-512 string seeding
and Python 3.12's compensated float summation. Three `docs/research/` utilities
retired rather than ported.

The four exit predicates, measured on the release commit:

| # | Predicate | Verdict |
|---|---|---|
| 1 | `git ls-files '*.py'` returns exactly the 6 vendored plus 1 archived | **PASS** |
| 2 | `gates-linux` green on `main` | **PASS** |
| 3 | `session.bats` passes with `FM_SESSION_CMD` on the TypeScript, `fm-session.py` deleted | **PASS** |
| 4 | `tests/positive-control-todo.tsv` empty for in-scope gates, or every row carries a reason | **PASS** |

Predicate 2 covers Linux only. The Bats suite was measured on Windows for the
first time at pass=444 fail=270 skip=26 and does not fit the 60-minute job cap,
so Windows is excluded by decision rather than by omission and the exclusion is
enforced by a test. Windows remains open work in `brokenwindows.md` (BW-004).

The release excludes Gemini, npm publication, and a complete Council runtime.
The remaining limitations are in `docs/RESIDUALS.md`. Full detail is in
`docs/releases/v0.3.0-notes.md`.

The recurring lesson of the release run: the oracle is usually the defect. Five
separate "it passed" reports were false, and every one was caught by a check
that could discriminate — never by a more careful reading of the report.

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

Git tags and release notes preserve the complete history. Use Git history when
an old release decision matters. Do not add old plans back to this live file.

## Active release program: v0.3.1 "George's Odyssey"

**Release candidate.** The six exit predicates passed on pushed commit
`64604d24308b446eaf1102177165622d3ec29167`. The branch is not merged or
tagged. v0.3.0 remains the latest release.

v0.3.1 is one sentence: **session state is portable — one contract, two
implementations.**

`SessionStore` is the synchronous, transactional system of record.
`SqliteSessionStore` and `FilesOnlySessionStore` both pass the same 49-case
contract. `MemoryIndex` is an asynchronous, optional projection port.
`NullMemoryIndex` remains the only shipping adapter, so local correctness does
not require a network or credentials.

The release candidate includes:

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
observing itself. Sprints 8-13 and 16, Sprint 6's project registry, and the
knowledge and graph plane are assigned to v0.4.0. Their change packages under
`openspec/changes/` are unmodified; only their release assignment moved.

## Current authority

- v0.3.1 release-candidate record: `docs/releases/v0.3.1-notes.md`
- v0.3.1 storage architecture: `docs/architecture/storage-port.md`
- Shipped v0.3.0 release notes: `docs/releases/v0.3.0-notes.md`
- Canonical accomplishment ledger:
  `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`
- Superseded v0.3.0 release program: `openspec/changes/v030-release-program/`
- TypeScript migration checklist: `typescriptmigration.md`
- v0.3.0 destruction log: `docs/releases/v0.3.0-destruction-log.md`
- Shipped v0.2.9.0 release record: `checklist.md`
- Current residuals: `docs/RESIDUALS.md`
- Environment and vendor traps: `AGENT_TRAPS.md`
- Historical evidence rules: `docs/evidence/README.md`
