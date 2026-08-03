# Foreman roadmap

This file is the current release roadmap. Dated plans, research reports, and
evidence files are historical records. They do not override this file.

## Latest release: v0.2.8.2

The v0.2.8.2 release reduces the abandoned v0.2.9 scope to one external pilot,
the portability changes that the pilot required, current release records, and
three release gates.

| Work item | Status | Evidence |
|---|---|---|
| Preserve the withdrawn v0.2.9 work | Complete | Annotated tag `v0.2.9-preserve` targets `04f3695` |
| Run one external Foreman pilot | Complete | Gobox PR [#1](https://github.com/CharlesHoskinson/gobox/pull/1), worker commit `b0519b2`, merge `24bd736` |
| Pass the target repository gate | Complete | `make check` passed in Gobox and in the pristine-archive Foreman gate |
| Fix the external soft-mode defects | Complete | Foreman PR [#7](https://github.com/CharlesHoskinson/foreman/pull/7), merge `525cfb0` |
| Restore Linux NATS coverage | Complete | Foreman PR [#10](https://github.com/CharlesHoskinson/foreman/pull/10), merge `09e0715`, 12 of 12 NATS tests passed |
| Replace stale active release guidance | Complete | Foreman PR [#12](https://github.com/CharlesHoskinson/foreman/pull/12), merge `d9eafbb` |
| Remove Quint's rate-limited first-run fetch | Complete | Foreman PR [#14](https://github.com/CharlesHoskinson/foreman/pull/14), merge `074f3c4`; exact-main formal, Linux, and Windows workflows passed |
| Rebuild the knowledge graph from the merged tree | Complete | The authority-filtered graph records exact release commit `076c014`; it has 1,434 nodes, 2,618 links, and no duplicate or dangling records |
| Run the three release gates and tag | Complete | Annotated tag `v0.2.8.2` targets `076c014`; exact-commit local, Linux, and Windows gates passed |

### Release purpose

The release proves one concrete result: a cold Grok worker wrote a Gobox fix,
a different model family reviewed the diff, and Gobox passed its own gate. The
pilot also produced the first Foreman defect list that came from another
repository.

The release does not claim that every repository, operating system, queue
configuration, or provider version is supported. The tested boundary is one
Gobox workload and the Foreman paths that were required to run it.

### Shipped portability changes

- `checks-run.sh` can select an exact soft-mode worktree without hard-mode
  `meta.json` and still verifies a pristine commit archive.
- External targets can use their own Make or Go gate instead of Foreman
  documentation checks.
- `lane-run.sh` separates the Foreman tool root, the target repository root,
  the target worktree, and the run-scoped session database.
- Workers and gates run from the selected target worktree. Foreman readiness
  and launcher resources continue to resolve from the Foreman checkout.
- The Linux mkdir trace parser accepts target paths that contain the letter
  `n`; the prior regular expression could change one probe from `atomic` to
  `unknown`.
- The Linux workflow installs checksum-pinned NATS Server and NATS CLI
  binaries, verifies their versions, and runs the NATS integration slice.

The remaining limitations are in `docs/RESIDUALS.md`.

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

Git tags and release notes preserve the complete history. Use Git history when
an old release decision matters; do not add old plans back to this live file.

## Active release candidate: v0.2.9.0

The v0.2.9.0 candidate has one product boundary. It ships the bounded
`council-preflight` executable for Grok, Claude, and Codex.

| Work item | Status | Evidence |
|---|---|---|
| Build the Node.js 24 TypeScript preflight executable | Complete | Implementation stack through `04e42be`, PR #22 |
| Compile ACE before provider startup | Complete | Compiled-process marker test and independent review |
| Pass the local Council gate | Complete | 39 files and 1,123 tests passed |
| Pass hosted Linux and Windows gates | Provisional pass | PR #22 passed both workflows at `04e42be`; final candidate rerun remains required |
| Pass live Grok, Claude, and Codex canaries | Provisional pass | Three secret-safe provider-neutral receipts at `04e42be`; final candidate rerun remains required |
| Complete one external Foreman workflow | Complete | Grok commit `31e26ea`; 122 target tests passed; independent Codex audit approved the exact diff |
| Preserve the Council shadow outcome | Complete | Exact external bundle records `quorum_not_met`; the ordinary cold audit is not promoted to a Council verdict |
| Replace stale release knowledge | In progress | New OpenSpec package and cleanup register |
| Rebuild the exact-candidate graph | Pending | Graph source commit must match the release candidate |

The release excludes Gemini, npm publication, formal scope, Tier 2 scope, and
complete Python removal. The release does not claim a complete Council runtime.

## Current authority

- Release criteria: `checklist.md`
- Known limitations: `docs/RESIDUALS.md`
- Release changes: `docs/releases/v0.2.9.0-notes.md`
- Cleanup decisions: `docs/releases/v0.2.9.0-cleanup-log.md`
- Release OpenSpec: `openspec/changes/council-v029-preflight-release/`
- Historical evidence rules: `docs/evidence/README.md`
