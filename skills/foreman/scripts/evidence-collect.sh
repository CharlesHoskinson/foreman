#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: evidence-collect.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID"
require_cmd jq; require_cmd git

WT="$(jq -r .worktree "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
OUT="$RD/evidence"
mkdir -p "$OUT"

git_nohooks -C "$WT" diff "$BASE_SHA...HEAD"              > "$OUT/patch.diff"
git_nohooks -C "$WT" diff --stat "$BASE_SHA...HEAD"       > "$OUT/diff-stat.txt"
git_nohooks -C "$WT" status --porcelain                   > "$OUT/git-status.txt"
git_nohooks -C "$WT" rev-parse HEAD                       > "$OUT/head-sha.txt"
git_nohooks -C "$WT" log --oneline "$BASE_SHA..HEAD"      > "$OUT/commits.txt"

log "evidence collected to $OUT"
