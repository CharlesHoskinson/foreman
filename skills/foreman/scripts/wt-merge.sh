#!/usr/bin/env bash
# @description Squash-apply a Foreman worktree branch onto the current branch
#   as staged changes (no commit by default). Fail-closed: refuses dirty
#   indexes, uncommitted overlap, and merge conflicts.
# Usage: wt-merge.sh RUN_ID ROLE [SLUG] [--commit]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

PY="$(command -v python3 || command -v python || true)"

COMMIT=0
POS=()
for a in "$@"; do
  case "$a" in
    --commit) COMMIT=1 ;;
    *) POS+=("$a") ;;
  esac
done
RUN_ID="${POS[0]:?usage: wt-merge.sh RUN_ID ROLE [SLUG] [--commit]}"
ROLE="${POS[1]:?role required}"
SLUG="${POS[2]:-}"

# @description Read one string field from the worktree metadata JSON.
# @arg $1 metadata file path
# @arg $2 field name
# @stdout field value
meta_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$2" '.[$k]' "$1"
  elif [[ -n "$PY" ]]; then
    "$PY" -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"
  else
    echo "wt-merge: jq or python is required to read metadata" >&2
    return 2
  fi
}

RD="$(run_dir "$RUN_ID")"
META="$RD/worktrees/${ROLE}${SLUG:+-$SLUG}.json"
[[ -f "$META" ]] || { echo "wt-merge: no metadata: $META" >&2; exit 3; }
BRANCH="$(meta_get "$META" branch)"
WORKTREE="$(meta_get "$META" worktree)"

# @description Commit pending uncommitted worker changes onto the worktree's own
#   branch before merge-base/overlap analysis. Workers never git-commit per the
#   standing constraint, so the tree usually holds uncommitted work at merge
#   time; this architect-invoked wt-merge.sh call preserves the worker git-write ban.
# @arg $1 worktree path
commit_worktree_pending() {
  local wt="$1"
  [[ -d "$wt" ]] || return 0
  local dirty
  dirty="$(git_nohooks -C "$wt" status --porcelain -- . ':!FOREMAN_REPORT.md' ':!FOREMAN_REPORT.json')"
  if [[ -n "$dirty" ]]; then
    git_nohooks -C "$wt" add -A -- ':!FOREMAN_REPORT.md' ':!FOREMAN_REPORT.json'
    git_nohooks -C "$wt" commit -m "foreman(${RUN_ID}/${ROLE}${SLUG:+/$SLUG}): worker changes" >/dev/null
  fi
}
commit_worktree_pending "$WORKTREE"

ROOT="$(git_nohooks rev-parse --show-toplevel)"

git_nohooks -C "$ROOT" diff --cached --quiet \
  || { echo "wt-merge: target index has staged changes — commit or reset first" >&2; exit 4; }

BASE="$(git_nohooks -C "$ROOT" merge-base HEAD "$BRANCH")"
INCOMING="$(git_nohooks -C "$ROOT" diff --name-only "$BASE" "$BRANCH" | sort)"
DIRTY="$(
  {
    git_nohooks -C "$ROOT" diff --name-only
    git_nohooks -C "$ROOT" diff --name-only --cached
    git_nohooks -C "$ROOT" ls-files --others --exclude-standard
  } | sort -u
)"
OVERLAP="$(comm -12 <(printf '%s\n' "$INCOMING") <(printf '%s\n' "$DIRTY") | sed '/^$/d')"
if [[ -n "$OVERLAP" ]]; then
  echo "wt-merge: uncommitted target changes overlap incoming files:" >&2
  while IFS= read -r f; do printf '  %s\n' "$f"; done <<< "$OVERLAP" >&2
  exit 5
fi

if ! git_nohooks -C "$ROOT" merge --squash "$BRANCH" >/dev/null 2>&1; then
  git_nohooks -C "$ROOT" reset --merge >/dev/null 2>&1 || true
  echo "wt-merge: squash merge conflict against $BRANCH" >&2
  exit 7
fi

if [[ "$COMMIT" -eq 1 ]]; then
  git_nohooks -C "$ROOT" commit -m "foreman(${RUN_ID}/${ROLE}${SLUG:+/$SLUG}): merge worktree" >/dev/null
fi

# @description Mark the metadata status merged (jq or python fallback).
mark_merged() {
  if command -v jq >/dev/null 2>&1; then
    jq '.status = "merged"' "$META" > "$META.tmp" && mv "$META.tmp" "$META"
  elif [[ -n "$PY" ]]; then
    "$PY" -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["status"]="merged"; json.dump(d, open(p,"w"), indent=2)' "$META"
  else
    echo "wt-merge: jq or python is required to update metadata" >&2
    return 2
  fi
}
mark_merged
MODE_LABEL=staged; [[ "$COMMIT" -eq 1 ]] && MODE_LABEL=committed
log "merged: $BRANCH -> $(git_nohooks -C "$ROOT" rev-parse --abbrev-ref HEAD) ($MODE_LABEL)"
