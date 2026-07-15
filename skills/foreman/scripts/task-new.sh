#!/usr/bin/env bash
# INIT: worktree + task envelope + hash snapshot
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: task-new.sh TASK_ID [BASE_BRANCH]}"
BASE="${2:-main}"

[[ "$TASK_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
  || die "$EXIT_CONFIG" "task id must match [A-Za-z0-9._-]+: $TASK_ID"

require_cmd git; require_cmd jq; require_cmd python3

ROOT="$(git_nohooks rev-parse --show-toplevel)"
RD="$(run_dir "$TASK_ID")"
[[ -e "$RD" ]] && die "$EXIT_CONFIG" "run dir already exists: $RD"
mkdir -p "$RD/evidence"

WT="$(dirname "$ROOT")/$(basename "$ROOT")-$TASK_ID"
BRANCH="ai/$TASK_ID"
BASE_SHA="$(git_nohooks -C "$ROOT" rev-parse "$BASE^{commit}")"

LOCK="$(repo_lock_path "$ROOT")"
if command -v flock >/dev/null 2>&1; then
  flock "$LOCK" git -c core.hooksPath= -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE_SHA"
else
  log "WARN: flock not found — worktree add without serialization"
  git -c core.hooksPath= -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE_SHA"
fi

git_nohooks -C "$ROOT" config extensions.worktreeConfig true 2>/dev/null || true
git_nohooks -C "$WT" config --worktree core.hooksPath '' 2>/dev/null || true

CONFIG="$ROOT/.foreman/config.toml"
mapfile -t HASH_GLOBS < <(toml_get "$CONFIG" gate.hash_paths $'tests/**\n.github/**' 2>/dev/null || printf 'tests/**\n.github/**')
hash_snapshot "$WT" "${HASH_GLOBS[@]}" > "$RD/hashes.txt" 2>/dev/null || : > "$RD/hashes.txt"

jq -n --arg t "$TASK_ID" --arg r "$ROOT" --arg w "$WT" \
      --arg b "$BRANCH" --arg s "$BASE_SHA" \
      '{task_id:$t, repo_root:$r, worktree:$w, branch:$b, base_sha:$s}' \
      > "$RD/meta.json"

cat > "$RD/task.md" <<EOF
# Task $TASK_ID

## Goal
(orchestrator: state the requested change)

## Constraints
- Work only inside the worktree; commit all changes before finishing.
- Never modify: tests/**, .github/**, .foreman/**, lockfiles (unless task says otherwise).
- No network access is available in hard-mode containers.

## Done when
- The repo's checks pass, run independently by the harness.
- The diff matches the plan and acceptance criteria in plan.md.
EOF

log "created worktree $WT (branch $BRANCH, base $BASE_SHA)"
log "run dir: $RD"
