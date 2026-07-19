# Change: worktree-hardening

## Why

The operator reports stalls and git issues during heavy concurrent worktree
use (many lanes on Windows/Git Bash), and foreman's own worktree helper
already warns "flock missing — worktree op without lock". Research
(2026-07-18, cited in design.md) mapped these to specific, documented failure
classes with public reproductions — and two of them are already in foreman's
own bugeventlog: a wt-cleanup that destroyed untracked report files with no
porcelain check (2026-07-17), and orphaned subprocesses blocking worktree
lanes (2026-07-16). The guard patterns are well-established; this change
adopts them.

## What changes

Guard bundle for concurrent git-worktree reliability:

- **Repo config** applied to the foreman repo (inherited by all worktrees):
  `maintenance.auto=false` + a foreman-owned scheduled `git maintenance run`
  (removes the reactive `gc.autoDetach` stall), `core.fsmonitor=true`,
  `core.untrackedCache=true`, `core.longpaths=true`,
  `safe.bareRepository=explicit`.
- **Per-lane env** set by wt-new/lane-run: `GIT_OPTIONAL_LOCKS=0` for
  read-only status/diff/log polling ONLY, `GIT_ASK_YESNO=false` (kills the
  Windows "Unlink failed. Try again? (y/n)" hang).
- **Retry wrapper** `git_retry` (bounded exponential backoff) around the
  shared-lock operations in `lib/worktree.sh`.
- **Stale-lock sweep** at lane start: remove 0-byte `index.lock` / worktree
  locks older than ~30s.
- **wt-cleanup hardening**: porcelain-status check BEFORE any delete (never
  destroy uncommitted work), and SIGINT of lane subprocesses BEFORE `git
  worktree remove` (correct shutdown ordering).
- **Doctrine**: Windows Defender path-exclusion guidance for the repo + all
  sibling `*-wt-*` dirs.

## Impact

- Affected: `skills/foreman/scripts/lib/worktree.sh`,
  `skills/foreman/scripts/wt-new.sh`, `skills/foreman/scripts/wt-cleanup.sh`,
  `skills/foreman/scripts/lane-run.sh` (per-lane env), a new git-config
  bootstrap step (install.* or a `scripts/git-guards.sh`),
  `tests/wt-*.bats`, and `references/orchestration-hardening.md`.
- Backward compatible: guards are additive; `GIT_OPTIONAL_LOCKS`/
  `GIT_ASK_YESNO` are scoped, not global.
