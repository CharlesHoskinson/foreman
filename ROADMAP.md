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

Status at base commit `3164cfa5779b8aac8eebeea710c16f3f9688d56f`:

| Band | Status | Notes |
|---|---|---|
| Authority baseline, destruction inventory, and ledger reconciliation | Landed | Ledger, coverage matrix freeze, destruction register, and program package |
| Node workspace, `@foreman/core`, and `@foreman/policy` | Landed | Architecture policy, destruction admission, installed-runtime integrity, Windows path-seam fixes |
| Typed `@foreman/event-log` foundation | Landed | Closed StoredEvent decoder, bounded NDJSON replay, cursors, attempt identity |
| Queue, resume, credentials, and fixture-aware secret scans (Sprint 3) | Open | Not in this base |
| GraphStore, launcher, SessionDB, and project registry | Open | Not in this base |
| Current-main session transport | Open | Not in this base |
| Council advisory plane, durable runtime, Gemini, MCP, and host plugins | Partial / open | Spec-correctness admission and live records exist. Full advisory plane remains open |
| Council supervised research, evidence provenance, and Council evaluation | Open | Not in this base |
| Release evidence, formal-model reconciliation, knowledge and Graphify | Open | Not in this base |
| Zero-Python cleanup, Superpowers, external dogfood, Windows boundary, exact-candidate convergence | Open | Not in this base |

Do not present unfinished v0.3.0 work as shipped work. Sprint 3 queue work
is not in this base and remains open.

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
