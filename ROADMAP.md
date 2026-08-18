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

**Being defined.** There is no `openspec/changes/v031-release-program/` yet.
The scope below is what has landed on `main` since the `v0.3.0` tag, not an
agreed exit definition. Do not present it as one.

Landed since `v0.3.0` (PR #42, merged 2026-08-08):

**The storage port.** Session state now has two ports with disjoint
responsibilities rather than one port with two implementations. `SessionStore`
is the system of record — synchronous, transactional, exact, with SQLite as the
reference and only complete implementation. `MemoryIndex` is a derived semantic
projection — asynchronous, optional, `NullMemoryIndex` by default, returning
entity references rather than content so a superseded row cannot be acted on.

An external agent-memory service was evaluated as a second `SessionStore`
implementation and rejected on measurement, not preference: its SDK is HTTP and
`Promise`-only with no synchronous path, no transactions, no integer identity,
and memory formation is LLM-mediated and therefore non-deterministic.
Substitutability would have put network availability on the critical path of
local correctness. That workstream is closed: `NullMemoryIndex` is the only
`MemoryIndex` implementation and no external adapter is planned.

The defect this fixed: the sidecar round-trip contract was defined by SQLite
introspection, so the portable contract was whatever `sqlite_schema` reported at
runtime and changed silently on every migration. The model is now declared in
`packages/session-store/src/entities.ts` and SQLite is validated against it,
with drift an error at open. Identity is minted by the port from persisted
counters rather than by backend `AUTOINCREMENT`.

The contract is in `docs/architecture/storage-port.md`. The design review that
shaped it is in `docs/reviews/2026-08-08-storage-port/`.

Open work carried by this line:

| Item | State |
|---|---|
| Migrate `fm-session-main.ts` onto the port | Landed. The CLI runs on `@foreman/session-store`. `packages/orchestration/src/session-legacy-shape.ts` retains the only non-test `node:sqlite` import outside `packages/session-store/`, because recognizing and migrating a pre-port file requires raw SQLite |
| `fm-session sync` — drain `memory_outbox` | Not started. The outbox table exists and is written; nothing drains it |
| `importSnapshot` `remap` id-collision policy | Throws as unimplemented |
| `FilesOnlySessionStore` — the port's second implementation | Absent. Exit predicate 3, the one the design calls decisive, is unmet: a contract satisfied once is a description of its only implementation |
| Conformance suite negative control | Absent, and the gap is wider than it looks. Measured 2026-08-17: only 20 of the 37 cases take the store factory. The other 17 read `SessionSnapshot` literals through `findViolations` and pass against any backend, including one that does nothing |
| Council runtime | Builds cleanly, verified 2026-08-17 with pnpm 11.18.0 — eight packages produce `dist`. `components/council/packages/*/dist` is a local artifact, so a fresh checkout still needs `pnpm install && pnpm build` |
| Windows Bats suite | BW-004, unchanged from v0.3.0 |

The close-out plan for the remaining v0.3.1 work, with each predicate measured
against branch state rather than restated from the design, is
`docs/superpowers/plans/2026-08-17-v031-closeout.md`.

The eighteen-sprint program described in earlier revisions of this file was
measured at 43 packages and roughly 819 open tasks, over half of it the tool
observing itself. Sprints 8-13 and 16, Sprint 6's project registry, and the
knowledge and graph plane are assigned to v0.4.0. Their change packages under
`openspec/changes/` are unmodified; only their release assignment moved.

## Current authority

- Shipped v0.3.0 release notes: `docs/releases/v0.3.0-notes.md`
- Storage port contract: `docs/architecture/storage-port.md`
- Canonical accomplishment ledger:
  `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`
- Superseded v0.3.0 release program: `openspec/changes/v030-release-program/`
- TypeScript migration checklist: `typescriptmigration.md`
- v0.3.0 destruction log: `docs/releases/v0.3.0-destruction-log.md`
- Shipped v0.2.9.0 release record: `checklist.md`
- Current residuals: `docs/RESIDUALS.md`
- Environment and vendor traps: `AGENT_TRAPS.md`
- Historical evidence rules: `docs/evidence/README.md`
