#!/usr/bin/env bash
# Worktree helpers for parallel Foreman agents (search / plan / audit / implement).
# shellcheck shell=bash
# Source after lib/common.sh

# Layout (sibling of repo root by default):
#   <parent>/<repo>-wt-<RUN_ID>-<ROLE>[-<slug>]
# Reports (written by agents inside the worktree):
#   FOREMAN_REPORT.md   (human)
#   FOREMAN_REPORT.json (optional machine)
# Consolidated (host, outside worktrees):
#   $FOREMAN_HOME/runs/<RUN_ID>/reports/<role>[-slug].md
#   $FOREMAN_HOME/runs/<RUN_ID>/CONSOLIDATED.md

# @description Return the directory in which Foreman creates sibling worktrees for a repository root.
# @arg $1 root repository root path
# @stdout the repository root's parent directory
wt_parent_dir() {
  local root="$1"
  dirname "$root"
}

# @description Build the sibling worktree path for a Foreman run, role, and optional slug.
# @arg $1 root repository root path
# @arg $2 run_id Foreman run identifier
# @arg $3 role worker role included in the worktree name
# @arg $4 slug optional suffix distinguishing workers with the same role
# @stdout the computed worktree path
wt_path() {
  local root="$1" run_id="$2" role="$3" slug="${4:-}"
  local base
  base="$(basename "$root")-wt-${run_id}-${role}"
  [[ -n "$slug" ]] && base="${base}-${slug}"
  echo "$(wt_parent_dir "$root")/$base"
}

# @description Build the Foreman branch name for a run, role, and optional slug.
# @arg $1 run_id Foreman run identifier
# @arg $2 role worker role included in the branch name
# @arg $3 slug optional suffix distinguishing workers with the same role
# @stdout the computed branch name
wt_branch() {
  local run_id="$1" role="$2" slug="${3:-}"
  local b="foreman/${run_id}/${role}"
  [[ -n "$slug" ]] && b="${b}/${slug}"
  echo "$b"
}

# @description Validate that a worker role is one of Foreman's supported worktree roles.
# @arg $1 role worker role to validate
# @exitcode 0 for a supported role; 1 for any other value
wt_role_ok() {
  case "$1" in
    search|plan|audit|implement|advisor|misc) return 0 ;;
    *) return 1 ;;
  esac
}

# @description Retry a command with bounded exponential backoff (v0.2.7.5
#   worktree-hardening T2): up to 5 attempts total, sleeping 200, 400, 800,
#   and 1600 ms between them (so the last, 5th attempt follows a 1600 ms
#   wait -- 200+400+800+1600=3000 ms of backoff, ~3.2s worst case before the
#   final attempt), returning success as soon as any attempt succeeds, or the
#   LAST attempt's own failing exit status once attempts are exhausted. Rides
#   out transient shared-lock contention (e.g. a concurrent process briefly
#   holding ".git/index.lock") instead of aborting a worktree op on the first
#   failure. Self-contained (no dependency on lib/common.sh's `log`, since
#   this file is sometimes sourced standalone in tests) -- writes its own
#   retry notices straight to stderr.
# @arg $@ cmd command (and arguments) to execute
# @exitcode 0 the command eventually succeeded; the last attempt's nonzero
#   status otherwise
git_retry() {
  local max=5 delays=(0.2 0.4 0.8 1.6) i rc=0
  for (( i=0; i<max; i++ )); do
    # Both pitfalls avoided deliberately:
    #  (1) NOT "if "$@"; then return 0; fi; rc=$?" -- when an `if` with no
    #      `else` takes the false branch, POSIX/bash define the COMPOUND
    #      statement's own exit status as 0 regardless of the tested
    #      command's real status, so a `rc=$?` placed AFTER it would always
    #      read 0, never the real failure code.
    #  (2) NOT a bare unguarded "$@" followed by "rc=$?" either -- under a
    #      caller's `set -e` (every script in this codebase that sources
    #      this file uses it), a failing command outside an if/while/&&/||
    #      condition aborts the whole script immediately, defeating the
    #      retry loop entirely on the very first failure.
    #  Using "$@" as the if/else CONDITION itself is safe under set -e
    #  (a command tested as an if condition never triggers set -e, pass or
    #  fail), and rc is then set explicitly inside each branch -- never
    #  inferred from a later, unrelated $?.
    if "$@"; then
      rc=0
    else
      rc=$?
    fi
    if (( rc == 0 )); then
      return 0
    fi
    if (( i < ${#delays[@]} )); then
      printf '[foreman] git_retry: attempt %d/%d failed (rc=%d); retrying in %ss\n' \
        "$((i+1))" "$max" "$rc" "${delays[$i]}" >&2
      sleep "${delays[$i]}"
    fi
  done
  return "$rc"
}

# @description Remove stale, zero-byte git lock files under a repository's
#   own git directory (v0.2.7.5 worktree-hardening T3) -- e.g. a leftover
#   ".git/index.lock" orphaned by a process that crashed mid-operation.
#   Spares any lock that is non-empty (a live process may still be actively
#   writing it) or younger than the staleness threshold (a live process may
#   still legitimately hold it for a moment) -- it NEVER removes a lock a
#   live git process may hold. Logs each lock it removes. Intended to run at
#   lane start, before a worktree op ever touches the repo, so a crashed
#   prior process's lock never blocks a fresh lane indefinitely. Self-
#   contained (no dependency on lib/common.sh's `log`; see git_retry's own
#   note above) -- prunes `objects/` while walking so a large pack directory
#   is never descended into needlessly.
# @arg $1 repo repository or worktree path
# @arg $2 threshold_s optional staleness threshold in seconds (default 30)
wt_sweep_stale_locks() {
  local repo="$1" threshold="${2:-30}" gitdir now f size mtime
  gitdir="$(git -C "$repo" rev-parse --git-dir 2>/dev/null || true)"
  [[ -z "$gitdir" ]] && return 0
  [[ "$gitdir" = /* ]] || gitdir="$repo/$gitdir"
  [[ -d "$gitdir" ]] || return 0
  now="$(date -u +%s)"
  while IFS= read -r -d '' f; do
    size="$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f" 2>/dev/null || echo -1)"
    [[ "$size" == "0" ]] || continue
    mtime="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo "$now")"
    if (( now - mtime >= threshold )); then
      printf '[foreman] stale lock removed: %s\n' "$f" >&2
      rm -f "$f"
    fi
  done < <(find "$gitdir" -path "*/objects/*" -prune -o -type f -name '*.lock' -print0 2>/dev/null)
}

# Serialize git worktree add/remove (git index lock races).
# @description Execute a worktree command under the repository lock, falling
#   back to unlocked execution without flock. Either way the command itself
#   runs through `git_retry` (T2) so a transient shared-lock failure (a
#   concurrent process briefly holding ".git/index.lock") is ridden out with
#   bounded backoff instead of failing the worktree op outright.
# @arg $1 root repository root used to locate the shared lock
# @arg $2 command executable followed by its arguments
# @stderr a warning when flock is unavailable
# @exitcode the executed command's status
wt_with_lock() {
  local root="$1"; shift
  local lock
  lock="$(repo_lock_path "$root")"
  if command -v flock >/dev/null 2>&1; then
    git_retry flock "$lock" "$@"
  else
    log "WARN: flock missing — worktree op without lock"
    git_retry "$@"
  fi
}
