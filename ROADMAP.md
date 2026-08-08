# Foreman roadmap

This file is the current release roadmap. Dated plans, research reports, and
evidence files are historical records. They do not override this file.

## Latest release: Total Georgecall (v0.2.9.0)

Annotated tag `v0.2.9.0` targets exact commit
`fbe23257fc389036d6feaa8f38e7b377f3106406`.

The product boundary is the bounded Node.js 24 TypeScript Council preflight
executable named `council-preflight`. The executable compiles ACE before any
provider process starts. Google fails closed because Gemini is absent.

Live-canary evidence uses exact canary candidate
`2ec886c3454b49420405aec87afaa6594ccbfdf8`. xAI Grok 4.5, Anthropic Claude
Sonnet 5, and OpenAI GPT-5.4 returned nonce-bound `ready` receipts with
completed terminal state, exit code 0, zero pending or failed tool calls, and
empty standard error. GitHub evidence is
<https://github.com/CharlesHoskinson/foreman/pull/22#issuecomment-5171848075>.
The Council package tree is byte-identical at candidate `2ec886c` and release
commit `fbe23257fc389036d6feaa8f38e7b377f3106406`. Both resolve
`components/council/packages` to tree
`fe0af13811a6bbed482af60a57eb869fbebde075`. The only Council path changed
after the canary candidate is `components/council/vitest.config.ts`. These
receipts are not exact-merge receipts. The canaries did not run on the
release commit.

| Work item | Status | Evidence |
|---|---|---|
| Build the Node.js 24 TypeScript preflight executable | Complete | Release commit `fbe23257fc389036d6feaa8f38e7b377f3106406` |
| Compile ACE before provider startup | Complete | Compile-before-provider marker tests and release notes |
| Pass the local Council gate | Complete | 39 test files and 1,126 tests |
| Pass the local Foreman gate | Complete | 708 passed, 0 failed, and 19 skipped Bats cases |
| Pass hosted Linux and Windows gates | Complete | Linux run `30860945352` and Windows run `30860945387` |
| Pass live Grok, Claude, and Codex canaries | Complete | Candidate `2ec886c` receipts. Council packages tree `fe0af138`. PR comment `5171848075` |
| Complete one external Foreman workflow | Complete | Grok commit `31e26eac`, 122 target tests, independent Codex audit |
| Preserve the Council shadow outcome | Complete | Exact external bundle records honest `quorum_not_met` |
| Rebuild the exact release graph | Complete | 2,781 nodes, 5,104 edges, and 20 hyperedges on the tag commit |

The release excludes Gemini, npm publication, formal scope, Tier 2 scope, and
complete Python removal. The release does not claim a complete Council
runtime.

The remaining limitations are in `docs/RESIDUALS.md`. The full inventory is
the canonical ledger at
`docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`.

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

Git tags and release notes preserve the complete history. Use Git history when
an old release decision matters. Do not add old plans back to this live file.

## Active release program: v0.3.0

The active program lives at `openspec/changes/v030-release-program/`.
v0.3.0 is not released.

All new executable code uses Node.js 24 and TypeScript under the repository
Iron Rule. Effect owns typed failures, scoped resources, cancellation,
retries, timeouts, and concurrency.

**Redefined 2026-08-07.** v0.3.0 is "the Node migration is finished — one
runtime, one language." The eighteen-sprint program that the band table below
described was measured at 43 packages and roughly 819 open tasks, over half of
it the tool observing itself. Sprints 8-13 and 16, Sprint 6's project registry,
and the knowledge and graph plane move to v0.4.0; their change packages under
`openspec/changes/` are unmodified, only their release assignment moves. The
current definition is
`docs/superpowers/specs/2026-08-07-v030-node-migration-completion-design.md`.

Exit is four predicates on one unchanged pushed commit. Measured against
`origin/main` at `2ab7528` on 2026-08-08:

| # | Predicate | Verdict | Evidence |
|---|---|---|---|
| 1 | `git ls-files '*.py'` returns exactly the 6 vendored plus 1 archived | **PASS** | 7 tracked, none of them Foreman's |
| 2 | `gates-linux` green on `main` | **PASS** | run on `2ab7528` success |
| 3 | `session.bats` passes with `FM_SESSION_CMD` on the TypeScript and `fm-session.py` deleted | **PASS** | `fm-session.py` tracked: 0; suite 29/29 on the bundle, 0/29 on a broken command |
| 4 | `tests/positive-control-todo.tsv` empty for in-scope gates, or every row carries a reason | **PASS** | 17 rows, 0 without a reason |

Predicate 2 was amended on 2026-08-08. It previously also required a green
`gates-windows` that actually ran the Bats suite. The suite was then measured
there for the first time at pass=444 fail=270 skip=26 and does not fit the
60-minute job cap, so Windows is excluded by decision rather than by omission
and the exclusion is enforced by a test. Windows remains open work in
`brokenwindows.md` (BW-004).

Predicate 1's remaining four files, and why each is still there:

| File | State |
|---|---|
| `skills/foreman/scripts/fm-session.py` | ported on `sprint/w4-session-port`; not landed. The port passes `session.bats` 31/31 through the seam, but three white-box Python tests retire with it and their properties — worktree store sharing, single-snapshot sidecar reads, row-check-after-write-lock — have no replacement yet |
| `skills/foreman/ontology/test_ontology.py` | retires with the `project` verb, same branch |
| `tests/tier2_collect.py` | port **backed out**. See `brokenwindows.md` BW-014 |
| `tests/tier2_compare.py` | port **backed out**. Two attempts produced a statistically divergent evaluator: whole-valued floats lost their decimals, and one bootstrap confidence interval was 16% from the Python's on identical input |

The three `docs/research/` utilities are retired on `sprint/w2-w5a`.

Do not present unfinished v0.3.0 work as shipped work. Sprint 3 is partial and
remains open.

## Current authority

- Canonical accomplishment ledger:
  `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`
- Active v0.3.0 release program: `openspec/changes/v030-release-program/`
- TypeScript migration checklist: `typescriptmigration.md`
- Current destruction log: `docs/releases/v0.3.0-destruction-log.md`
- Shipped v0.2.9.0 release notes: `docs/releases/v0.2.9.0-notes.md`
- Shipped v0.2.9.0 release record: `checklist.md`
- Current residuals: `docs/RESIDUALS.md`
- Historical evidence rules: `docs/evidence/README.md`
