#!/usr/bin/env bash
# @description Non-disruptive worktree checkpoints via git plumbing. Snapshots the
#   working tree into a commit on refs/checkpoints/<lane> using an isolated index,
#   so the running agent's own index/HEAD are never touched and refs are gc-safe.

# @description Snapshot a worktree's current content to refs/checkpoints/<lane>.
# @arg $1 worktree path  @arg $2 lane name
# @stdout the checkpoint commit sha
# @exitcode 1 if not a git worktree
ckpt_snapshot() {
  local wt="$1" lane="$2" ref="refs/checkpoints/$2"
  # Validate lane before it becomes a ref path (architect-controlled, but a bad
  # value must not yield a surprising ref). Same charset as wt-* roles/slugs.
  [[ "$lane" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  local gd; gd="$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  local idx; idx="$(mktemp)"
  GIT_DIR="$gd" GIT_WORK_TREE="$wt" GIT_INDEX_FILE="$idx" git read-tree HEAD 2>/dev/null || true
  # 2>/dev/null: git add prints core.autocrlf "LF will be replaced by CRLF"
  # advisories to stderr; this function's stdout/stderr must stay clean so
  # callers (and tests capturing merged output) get only the checkpoint SHA.
  # || { rm; return 1 }: a failed add must not fall through to a HEAD-only
  # snapshot that looks successful.
  GIT_DIR="$gd" GIT_WORK_TREE="$wt" GIT_INDEX_FILE="$idx" git add -A 2>/dev/null || { rm -f "$idx"; return 1; }
  local tree; tree="$(GIT_DIR="$gd" GIT_INDEX_FILE="$idx" git write-tree)" || { rm -f "$idx"; return 1; }
  rm -f "$idx"
  local parent; parent="$(git -C "$wt" rev-parse -q --verify "$ref" 2>/dev/null || true)"
  local msg="ckpt $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local commit
  commit="$(git -C "$wt" commit-tree "$tree" ${parent:+-p "$parent"} -m "$msg")" || return 1
  git -C "$wt" update-ref "$ref" "$commit" || return 1
  echo "$commit"
}

# @description Print the latest checkpoint sha for a lane (empty if none).
# @arg $1 worktree path  @arg $2 lane  @stdout sha or empty
ckpt_latest() {
  git -C "$1" rev-parse -q --verify "refs/checkpoints/$2" 2>/dev/null || true
}
