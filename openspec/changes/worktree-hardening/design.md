# Design — worktree-hardening

## Research basis (2026-07-18, cited)

| Symptom | Root cause | Guard | Ref |
|---|---|---|---|
| index.lock failures under parallel lanes (62% fail @ 13 agents) | worktrees share one object DB/index-lock domain | git_retry backoff + never auto-delete dirty | claude-code#55724 |
| stale 0-byte lock blocks all later cmds | killed background `git status` pollers took the optional lock | `GIT_OPTIONAL_LOCKS=0` on polls + stale-lock sweep | claude-code#57102, #47721 |
| random multi-second stalls mid-commit | `gc.autoDetach` silently forks bg gc competing for the lock | `maintenance.auto=false` + scheduled `git maintenance run` | git-scm gc/maintenance docs; public-inbox gc.autodetach thread |
| `Permission denied` / endless "Unlink failed. Try again?(y/n)" | Windows open handles (Defender/MCP/indexer) during rename/unlink | `GIT_ASK_YESNO=false` + Defender exclusions + kill subprocs before remove | shukebeta GIT_ASK_YESNO; claude-code#32747 |
| `Filename too long` | Windows MAX_PATH | `core.longpaths=true` + short wt names (already convention) | — |
| slow status/checkout on Windows | no FS watcher | `core.fsmonitor` + `core.untrackedCache` | git-scm docs |

Two guards map onto foreman's OWN bugeventlog: the porcelain-check-before-
delete (2026-07-17 report-loss) and kill-subprocess-before-remove
(2026-07-16 orphan). `lib/worktree.sh` already serializes add/remove via
`wt_with_lock` (flock, with the "flock missing" WARN fallback the operator
sees) — this change adds the config/env guards it lacks, NOT a new lock.

Confidence: high on index.lock/GIT_OPTIONAL_LOCKS/gc-maintenance/unlink-
Defender/longpaths (multiple primary + issue sources); medium on MSYS
path-rewrite and fsmonitor sizing; low on exact retry counts (heuristic).

## Approach

A `scripts/git-guards.sh` (idempotent) applies the repo config and registers
maintenance; wt-new/lane-run export the scoped env; `git_retry` wraps the
lock-touching ops in `lib/worktree.sh`; a stale-lock sweep runs at lane
start; wt-cleanup gains the porcelain check + shutdown ordering; the
reference documents Defender exclusions. Everything additive and tested
against the existing wt-*.bats (byte-unmodified) plus new cases.

## Execution

Implementer: **Sonnet 5**. Audit: **Opus 4.8**. This package directly targets
the operator's reported active pain, so its acceptance includes a
concurrent-lane soak (spin N worktree lanes, assert zero stale-lock stalls
and no dirty-delete) as the SC-style proof.
