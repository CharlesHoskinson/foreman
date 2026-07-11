#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: task-new.sh TASK_ID [BASE_BRANCH]}"
BASE="${2:-main}"

[[ "$TASK_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
  || die "$EXIT_CONFIG" "task id must match [A-Za-z0-9._-]+: $TASK_ID"

require_cmd git; require_cmd jq; require_cmd flock; require_cmd python3

ROOT="$(git_nohooks rev-parse --show-toplevel)"
WT="$(dirname "$ROOT")/$(basename "$ROOT")-$TASK_ID"
BRANCH="ai/$TASK_ID"

# Validate the base ref BEFORE creating any run-dir state, mapping git's raw
# exit code to the contract's config-error code.
BASE_SHA="$(git_nohooks -C "$ROOT" rev-parse "$BASE^{commit}" 2>/dev/null)" \
  || die "$EXIT_CONFIG" "unknown base ref: $BASE"

RD="$(run_dir "$TASK_ID")"
[[ -e "$RD" ]] && die "$EXIT_CONFIG" "run dir already exists: $RD"
mkdir -p "$RD/evidence"

# Serialize worktree creation: parallel `git worktree add` races on .git locks.
LOCK="$(repo_lock_path "$ROOT")"
if ! flock "$LOCK" git -c core.hooksPath= -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE_SHA"; then
  rm -rf "$RD"
  # worktree add may fail after creating the branch; remove it so retries work.
  git_nohooks -C "$ROOT" branch -D "$BRANCH" >/dev/null 2>&1 || true
  die "$EXIT_FAIL" "git worktree add failed for $WT (branch $BRANCH)"
fi

# Per-worktree hook disable (harness calls also use git_nohooks; belt and braces).
git_nohooks -C "$ROOT" config extensions.worktreeConfig true
git_nohooks -C "$WT" config --worktree core.hooksPath ''

CONFIG="$ROOT/.foreman/config.toml"
mapfile -t HASH_GLOBS < <(toml_get "$CONFIG" gate.hash_paths 'tests/**
.github/**')
hash_snapshot "$WT" "${HASH_GLOBS[@]}" > "$RD/hashes.txt"

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
- Never modify: tests/**, .github/**, .foreman/**, lockfiles.
- No network access is available.

## Done when
- The repo's checks pass, run independently by the harness.
- The diff matches the plan and acceptance criteria in plan.md.
EOF

log "created worktree $WT (branch $BRANCH, base $BASE_SHA)"
log "run dir: $RD"
