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
