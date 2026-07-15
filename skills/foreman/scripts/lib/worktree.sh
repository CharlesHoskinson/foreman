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

wt_parent_dir() {
  local root="$1"
  dirname "$root"
}

wt_path() {
  local root="$1" run_id="$2" role="$3" slug="${4:-}"
  local base
  base="$(basename "$root")-wt-${run_id}-${role}"
  [[ -n "$slug" ]] && base="${base}-${slug}"
  echo "$(wt_parent_dir "$root")/$base"
}

wt_branch() {
  local run_id="$1" role="$2" slug="${3:-}"
  local b="foreman/${run_id}/${role}"
  [[ -n "$slug" ]] && b="${b}/${slug}"
  echo "$b"
}

wt_role_ok() {
  case "$1" in
    search|plan|audit|implement|advisor|misc) return 0 ;;
    *) return 1 ;;
  esac
}

# Serialize git worktree add/remove (git index lock races).
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
