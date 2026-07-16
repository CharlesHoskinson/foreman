#!/usr/bin/env bash
# @description Non-disruptive worktree checkpoints via git plumbing. Snapshots the
#   working tree into a commit on refs/checkpoints/<lane> using an isolated index,
#   so the running agent's own index/HEAD are never touched and refs are gc-safe.

# @description Snapshot a worktree's current content to refs/checkpoints/<lane>.
#   Uses compare-and-swap update-ref with retry so concurrent snapshots of the same
#   lane never orphan each other's commits (lost-update race). Parent is re-read each
#   attempt via for-each-ref (real git failures abort; empty means no parent yet).
# @arg $1 worktree path  @arg $2 lane name
# @stdout the checkpoint commit sha
# @exitcode 1 if not a git worktree, invalid lane, parent for-each-ref failed, or CAS exhausted
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
  local msg="ckpt $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local parent parent_out parent_rc commit attempt=0
  # CAS loop: re-read parent + commit-tree + update-ref <ref> <new> <old>.
  # Empty old value means "ref must not exist". On conflict, retry up to 5 times.
  while (( attempt < 5 )); do
    attempt=$((attempt + 1))
    parent_out="$(git -C "$wt" for-each-ref --format='%(objectname)' "$ref" 2>/dev/null)"
    parent_rc=$?
    if (( parent_rc != 0 )); then
      echo "ckpt_snapshot: for-each-ref failed reading parent for $ref" >&2
      return 1
    fi
    parent="${parent_out%$'\r'}"
    commit="$(git -C "$wt" commit-tree "$tree" ${parent:+-p "$parent"} -m "$msg")" || return 1
    # 2>/dev/null is safe here: exit status still drives the retry loop, and a
    # conflict/failure is the expected CAS retry path (not a silently-ignored
    # real error). Unrecoverable exhaustion is reported after the loop below.
    if git -C "$wt" update-ref "$ref" "$commit" "${parent:-}" 2>/dev/null; then
      echo "$commit"
      return 0
    fi
  done
  echo "ckpt_snapshot: CAS failed after 5 attempts for $ref" >&2
  return 1
}

# @description Print the latest checkpoint sha for a lane.
# @arg $1 worktree path  @arg $2 lane
# @stdout sha if the ref exists; empty if the worktree is fine but no checkpoint yet
# @exitcode 0 if WT is a real worktree and for-each-ref succeeded (sha printed, or
#   empty if no checkpoint yet); 1 if not a worktree OR for-each-ref itself failed
#   (a real git failure, NOT the same as no checkpoint)
ckpt_latest() {
  # Require an actual worktree (not bare / git-dir-only). Exit status alone is
  # not enough: bare repos print "false" with status 0.
  [[ "$(git -C "$1" rev-parse --is-inside-work-tree 2>/dev/null)" == "true" ]] || return 1
  local sha
  sha="$(git -C "$1" for-each-ref --format='%(objectname)' "refs/checkpoints/$2" 2>/dev/null)"
  local rc=$?
  if (( rc != 0 )); then
    echo "ckpt_latest: for-each-ref failed for refs/checkpoints/$2" >&2
    return 1
  fi
  if [[ -n "$sha" ]]; then
    printf '%s\n' "${sha%$'\r'}"
  fi
  return 0
}
