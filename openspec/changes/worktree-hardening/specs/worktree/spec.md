# Spec delta — concurrent worktree hardening

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: the repo carries the concurrency-safe git config

The implementer SHALL provide a git-guards bootstrap that sets, on the
foreman repo: `maintenance.auto=false`, `core.fsmonitor=true`,
`core.untrackedCache=true`, `core.longpaths=true`, and
`safe.bareRepository=explicit`, and SHALL register a foreman-owned scheduled
`git maintenance run` in place of reactive auto-gc.

- WHEN the guards bootstrap runs, it SHALL be idempotent (re-running changes
  nothing) and SHALL report which settings it applied.
- WHILE `maintenance.auto` is false, the implementer SHALL ensure a
  maintenance path exists (scheduled task or a foreman tick) so pack/ref
  hygiene still occurs — disabling reactive gc SHALL NOT leave the repo
  un-maintained.

## ADDED Requirement: lanes scope optional-lock and yes/no env vars

WHEN a lane performs read-only git polling (status/diff/log), the implementer
SHALL run it with `GIT_OPTIONAL_LOCKS=0`; and WHEN any git operation runs in a
lane, `GIT_ASK_YESNO=false` SHALL be set so a Windows unlink-retry prompt
auto-declines instead of hanging.

- The implementer SHALL NOT set `GIT_OPTIONAL_LOCKS=0` for `commit`/`add`/
  write operations (only for read-only polling).
- IF a git write operation fails on a lock, THEN the retry wrapper (below)
  SHALL handle it, not `GIT_OPTIONAL_LOCKS`.

## ADDED Requirement: shared-lock operations retry with bounded backoff

The implementer SHALL wrap the shared-lock-touching operations in
`lib/worktree.sh` with `git_retry`: up to 5 attempts, exponential backoff
starting ~200 ms (200→400→800→1600→3200), returning failure only after the
last attempt.

#### Scenario: a transient index.lock contention succeeds on retry

- WHEN a worktree op fails once with `Unable to create '.git/index.lock'`
- THEN `git_retry` re-attempts after backoff and the op succeeds
- AND the lane does not abort on the first transient failure.

## ADDED Requirement: stale locks are swept before a lane starts

WHEN a lane starts, the implementer SHALL remove 0-byte `index.lock` and
worktree `*.lock` files whose mtime is older than ~30 s, and SHALL log each
removed stale lock.

- The sweep SHALL only remove 0-byte locks older than the threshold — it
  SHALL NOT remove a lock a live git process may hold (non-zero size or
  recent mtime).

## MODIFIED Requirement: wt-cleanup never destroys uncommitted work and orders shutdown

WHEN removing a worktree, `wt-cleanup` SHALL first check `git status
--porcelain` and SHALL refuse to delete (or archive-then-refuse) a worktree
with uncommitted or untracked changes unless explicitly forced; and it SHALL
SIGINT any lane subprocess associated with the worktree BEFORE calling `git
worktree remove`.

- IF a worktree has untracked report files, THEN `wt-cleanup` SHALL archive
  them (the existing `FOREMAN_REPORT*.*` archiver) AND SHALL NOT delete the
  tree without the porcelain check passing or `--force`.
- Subprocess SIGINT SHALL precede `git worktree remove`, never follow it
  (the 2026-07-16 shutdown-ordering failure).

#### Scenario: cleanup refuses a dirty worktree by default

- WHEN `wt-cleanup` targets a worktree with an uncommitted file and no
  `--force`
- THEN it archives reports, refuses the delete, and exits non-zero with a
  clear message.

## ADDED Requirement: Defender exclusion doctrine is documented

The reference SHALL document adding Windows Defender path exclusions for the
foreman repo and all sibling `*-wt-*` worktree directories, with the rationale
(real-time scanning of `.git`/VHDX is a measured stall/unlink-failure cause).
