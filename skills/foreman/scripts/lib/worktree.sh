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

# Serialize git worktree add/remove (git index lock races).
# @description Execute a worktree command under the repository lock, falling back to unlocked execution without flock.
# @arg $1 root repository root used to locate the shared lock
# @arg $2 command executable followed by its arguments
# @stderr a warning when flock is unavailable
# @exitcode the executed command's status
wt_with_lock() {
  local root="$1"; shift
  local lock
  lock="$(repo_lock_path "$root")"
  if command -v flock >/dev/null 2>&1; then
    flock "$lock" "$@"
  else
    log "WARN: flock missing — worktree op without lock"
    "$@"
  fi
}
