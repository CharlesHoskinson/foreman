#!/usr/bin/env bash
# Archive reports (if needed) and remove parallel worktrees for a run.
# Usage: wt-cleanup.sh RUN_ID [--force] [--keep-branches]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

RUN_ID="${1:?usage: wt-cleanup.sh RUN_ID [--force] [--keep-branches]}"
shift || true
FORCE=0
KEEP_BRANCHES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --keep-branches) KEEP_BRANCHES=1; shift ;;
    *) die "$EXIT_CONFIG" "unknown flag: $1" ;;
  esac
done

RD="$(run_dir "$RUN_ID")"
[[ -d "$RD/worktrees" ]] || die "$EXIT_CONFIG" "no worktrees for $RUN_ID"
require_cmd git
if ! command -v jq >/dev/null 2>&1; then
  require_cmd python3 "or install jq"
fi

# @description Read a top-level metadata field with jq or the Python fallback, returning empty text when absent.
# @arg $1 file JSON metadata file to read
# @arg $2 key top-level object key to resolve
# @stdout the field value, or an empty line when absent or null
json_get() {
  local file="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.[$k] // empty' "$file"
  else
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$file" "$key"
  fi
}

# @description Archive every FOREMAN_REPORT*/DIFF_* artifact from a worktree
#   into the run's reports dir BEFORE the worktree is removed. Glob-based --
#   NOT a fixed filename pair -- so the multi-round audit convention's
#   versioned reports (FOREMAN_REPORT_V2.md, _V3, _V4, ...) and cold-diff
#   patches (DIFF_V2.patch, ...) survive worktree removal instead of being
#   silently lost (2026-07-17 data loss: wt-consolidate.sh's own copy step
#   only ever grabs the fixed FOREMAN_REPORT.md/.json pair per worktree, so
#   anything beyond that pair was gone the instant `git worktree remove`
#   ran -- lost V2/V3/V4 audit reports for a whole round, unrecoverable).
#   Runs unconditionally for every worktree this script processes --
#   including ones ultimately skipped as dirty -- and independent of whether
#   CONSOLIDATED.md already existed (a stale CONSOLIDATED.md from an earlier,
#   narrower pass must never suppress this archive step). This is a second,
#   defense-in-depth archive pass alongside wt-consolidate.sh's own
#   CONSOLIDATED.md generation, not a replacement for it. Files land under
#   reports/<ID>/ (a subdirectory, never colliding with wt-consolidate.sh's
#   own reports/<ID>.md / reports/<ID>.json).
# @arg $1 worktree path (source)
# @arg $2 reports dir (dest root, e.g. "$RD/reports")
# @arg $3 worktree id (subdirectory name)
archive_worktree_reports() {
  local wt="$1" reports_dir="$2" id="$3"
  local f matched=()
  for f in "$wt"/FOREMAN_REPORT*.* "$wt"/DIFF_*.patch; do
    [[ -f "$f" ]] && matched+=("$f")
  done
  [[ ${#matched[@]} -eq 0 ]] && return 0
  local dest="$reports_dir/$id"
  mkdir -p "$dest"
  local m
  for m in "${matched[@]}"; do
    cp -f "$m" "$dest/$(basename "$m")"
  done
}

# @description Best-effort, bounded SIGINT (escalating to SIGKILL) of the
#   latest ownership-recorded pid for a worktree, BEFORE `git worktree
#   remove` is ever called (v0.2.7.5 worktree-hardening T5 -- spec: SIGINT
#   precedes remove, never the reverse; the 2026-07-16 shutdown-ordering
#   failure this closes). This GUARDS wt-cleanup.sh itself when invoked
#   standalone -- foreman-cleanup.sh already SIGINTs a run's lane
#   subprocesses before it delegates to this script (a separate, run-wide
#   sweep keyed by lane name), but wt-cleanup.sh had no such guard of its own
#   when called directly, which is exactly what this closes. Reads the run's
#   own event log (never the worktree itself, which may be mid-teardown) for
#   the LAST `ownership` event whose payload.worktree matches this EXACT
#   worktree path, and signals its launcher_pid (fallback pid) if still
#   alive: SIGINT first, then -- because this codebase has already empirically
#   confirmed (tests/foreman-cleanup.bats) that plain SIGINT delivery to a
#   non-launcher-wrapped process is unreliable on this Windows/MSYS host --
#   a bounded grace wait, escalating to SIGKILL if still alive, mirroring
#   lane-run.sh's own kill_cmd_bounded discipline (never an unbounded wait).
#   Silently tolerant of a missing event log, an absent jq, or an
#   already-dead pid.
#
#   v0.2.7.5 worktree-hardening Rework Round 1 (Risk 3, Opus audit): the
#   INT/KILL above targets ONLY the single recorded pid -- any grandchild it
#   spawned (e.g. a git subprocess) is reparented and survives untouched
#   once that one pid is gone. After the single-pid signal settles, this
#   also sweeps the WHOLE subtree: on Windows, `taskkill //T` against the
#   recorded pid's real Windows PID (translated via
#   `${WT_CLEANUP_PROC_ROOT:-/proc}/<pid>/winpid`, the exact same trick
#   lane-run.sh's own kill_cmd_bounded uses, and the same test-only knob
#   pattern as its LANE_PROC_ROOT -- pointing it at a controlled directory
#   makes the winpid resolution deterministic in tests instead of racing
#   the real /proc entry's lifetime); on POSIX, signals the process GROUP
#   (`kill -- -PID`, negative pid) instead of the bare pid -- this codebase's
#   convention throughout (e.g. lane-run.sh's kill_launcher_bounded POSIX
#   branch) is that a recorded pid is also its own pgid via setsid. Runs
#   AFTER, not instead of, the single-pid INT/KILL above (that ordering
#   still matters for the common single-process case); this is best-effort,
#   silently-tolerant defense in depth for the multi-process case, never a
#   hard gate on worktree removal proceeding.
# @arg $1 run_dir the run's directory (holds events.jsonl)
# @arg $2 wt worktree path to match against payload.worktree
wtc_sigint_worktree() {
  local run_dir="$1" wt="$2" grace="${WT_CLEANUP_KILL_GRACE:-5}"
  local events_file="$run_dir/events.jsonl"
  [[ -f "$events_file" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local last_ownership lpid pid check_pid waited=0
  last_ownership="$(jq -c --arg wt "$wt" 'select(.type=="ownership" and .payload.worktree==$wt)' "$events_file" 2>/dev/null | tail -n1 | tr -d '\r')"
  [[ -z "$last_ownership" ]] && return 0
  lpid="$(jq -r '.payload.launcher_pid // empty' <<<"$last_ownership" 2>/dev/null | tr -d '\r')"
  pid="$(jq -r '.payload.pid // empty' <<<"$last_ownership" 2>/dev/null | tr -d '\r')"
  check_pid="${lpid:-$pid}"
  [[ -z "$check_pid" ]] && return 0
  kill -0 "$check_pid" 2>/dev/null || return 0
  log "SIGINT lane subprocess (pid $check_pid) for $wt before worktree remove"
  kill -INT "$check_pid" 2>/dev/null || true
  while kill -0 "$check_pid" 2>/dev/null && (( waited < grace )); do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$check_pid" 2>/dev/null; then
    log "pid $check_pid still alive after SIGINT+${grace}s grace -- escalating to SIGKILL (Windows/MSYS SIGINT-delivery limitation)"
    kill -KILL "$check_pid" 2>/dev/null || true
    waited=0
    while kill -0 "$check_pid" 2>/dev/null && (( waited < grace )); do
      sleep 1
      waited=$((waited + 1))
    done
  fi

  # Rework Round 1, Risk 3: sweep the whole subtree so a grandchild the
  # single-pid signal above could never reach does not survive it. Windows:
  # translate check_pid's real Windows PID via /proc/<pid>/winpid (present
  # while the process was recently alive, even seconds after it has been
  # signaled dead -- same empirical basis lane-run.sh's kill_cmd_bounded
  # relies on) and taskkill //T the whole tree. POSIX (no winpid file):
  # signal the process GROUP instead of the bare pid.
  local proc_root="${WT_CLEANUP_PROC_ROOT:-/proc}" winpid=""
  winpid="$(cat "$proc_root/$check_pid/winpid" 2>/dev/null || true)"
  if [[ -n "$winpid" ]]; then
    taskkill //PID "$winpid" //T //F >/dev/null 2>&1 || true
  else
    kill -TERM -- "-$check_pid" 2>/dev/null || true
    kill -KILL -- "-$check_pid" 2>/dev/null || true
  fi
  return 0
}

# Ensure consolidated archive exists
if [[ ! -f "$RD/CONSOLIDATED.md" ]]; then
  log "running consolidate before cleanup..."
  "$SCRIPT_DIR/wt-consolidate.sh" "$RUN_ID" >/dev/null
fi

ROOT=""
shopt -s nullglob
for meta in "$RD"/worktrees/*.json; do
  [[ "$(basename "$meta")" == "index.json" ]] && continue
  WT="$(json_get "$meta" worktree)"
  BRANCH="$(json_get "$meta" branch)"
  ROOT="$(json_get "$meta" repo_root)"
  ID="$(json_get "$meta" id)"

  if [[ ! -d "$WT" ]]; then
    log "already gone: $WT"
    continue
  fi

  # Archive FOREMAN_REPORT*/DIFF_* artifacts before any possible removal --
  # unconditional, and before the dirty check below, so a versioned audit
  # report is preserved even on a run that later gets skipped (dirty) or
  # torn down with --force.
  archive_worktree_reports "$WT" "$RD/reports" "$ID"

  # Refuse dirty trees unless --force
  dirty="$(git_nohooks -C "$WT" status --porcelain 2>/dev/null || true)"
  if [[ -n "$dirty" && $FORCE -eq 0 ]]; then
    log "DIRTY worktree $ID - skipping remove (use --force to discard, or commit first)"
    log "  $WT"
    continue
  fi

  # v0.2.7.5 worktree-hardening T5: SIGINT (bounded, escalating to SIGKILL)
  # any recorded lane subprocess for THIS worktree before git worktree
  # remove ever runs. Order is load-bearing: SIGINT/kill then remove, never
  # the reverse.
  wtc_sigint_worktree "$RD" "$WT"

  log "removing worktree $ID -> $WT"
  if [[ -n "$ROOT" && -d "$ROOT" ]]; then
    wt_with_lock "$ROOT" \
      git -c core.hooksPath= -C "$ROOT" worktree remove --force "$WT" 2>/dev/null \
      || git -c core.hooksPath= -C "$ROOT" worktree remove "$WT" 2>/dev/null \
      || rm -rf "$WT"
    if [[ $KEEP_BRANCHES -eq 0 ]]; then
      git -c core.hooksPath= -C "$ROOT" branch -D "$BRANCH" 2>/dev/null || true
    fi
  else
    rm -rf "$WT"
  fi

  if command -v jq >/dev/null 2>&1; then
    jq '.status="cleaned"' "$meta" > "$meta.tmp" && mv "$meta.tmp" "$meta"
  else
    python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["status"]="cleaned"; json.dump(d, open(p,"w"), indent=2)' "$meta"
  fi
done

# Prune stale worktree metadata in main repo
if [[ -n "$ROOT" && -d "$ROOT" ]]; then
  git_nohooks -C "$ROOT" worktree prune 2>/dev/null || true
fi

log "cleanup complete for $RUN_ID (reports kept under $RD/reports)"
echo "$RD"
