#!/usr/bin/env bash
# Build an immutable review bundle describing ONE round of lane work.
# Two of three HIGH findings in a single audit round on 2026-08-01 were
# artifacts of a stale base and of cumulative worktree state being presented
# as the round's change. This script exists so a reviewer can never see either.
#
# Usage: lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR
# Writes OUT_DIR/bundle.json with keys:
#   base_sha, head_sha, round_diff, files_in_round, worktree_dirty_files,
#   worktree_dirty, base_is_ancestor_of_head, truncated, diff_bytes
#
# round_diff has three clearly separated sections:
#   1. committed range:  git diff BASE HEAD
#   2. untracked bodies: === NEW FILE: path ===
#   3. uncommitted:      === UNCOMMITTED (not part of the committed round) ===
set -uo pipefail

WT="${1:?usage: lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR}"
BASE_REF="${2:?usage: lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR}"
OUT_DIR="${3:?usage: lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR}"

if [[ ! -d "$WT" ]]; then
  printf 'lane-review-bundle: worktree is not a directory: %s\n' "$WT" >&2
  exit 2
fi

# Resolve base; exit 2 when the ref does not resolve.
base_sha="$(git -C "$WT" rev-parse --verify "${BASE_REF}^{commit}" 2>/dev/null)" || {
  printf 'lane-review-bundle: base ref %s does not resolve\n' "$BASE_REF" >&2
  exit 2
}

head_sha="$(git -C "$WT" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || {
  printf 'lane-review-bundle: worktree HEAD does not resolve: %s\n' "$WT" >&2
  exit 2
}

# Refuse a stale / unrelated base outright: an auditor reading superseded
# records files correct-looking findings about problems already fixed.
# The boolean is computed from this check and bound into JSON via --argjson.
if git -C "$WT" merge-base --is-ancestor "$base_sha" "$head_sha"; then
  base_is_ancestor_of_head=true
else
  printf 'lane-review-bundle: base %s is not an ancestor of head %s\n' \
    "$base_sha" "$head_sha" >&2
  exit 3
fi

mkdir -p "$OUT_DIR" || {
  printf 'lane-review-bundle: cannot create out dir %s\n' "$OUT_DIR" >&2
  exit 2
}

# @description Test whether a path is architect or lane meta rather than lane output.
#   SPEC.md is the architect's instruction and FOREMAN_REPORT.md is the lane's own
#   report; neither is the change under review, and a bundle that lists what it
#   will not show misleads the reviewer.
# @arg $1 path repository-relative path to test
# @exitcode 0 the path is meta and must be excluded
# @exitcode 1 the path is lane output
_is_meta_path() {
  case "$1" in
    SPEC.md|FOREMAN_REPORT.md) return 0 ;;
    *) return 1 ;;
  esac
}

# @description Convert path arguments to a JSON string array via jq --args.
#   jq builds the array so paths containing spaces, double quotes or backslashes
#   survive; string concatenation would mangle them.
# @arg $@ paths zero or more repository-relative paths
# @stdout a JSON array of strings, `[]` when given no arguments
_paths_to_json() {
  if [[ "$#" -eq 0 ]]; then
    printf '%s' '[]'
  else
    jq -n --args '$ARGS.positional' "$@"
  fi
}

diff_tmp="$(mktemp)"
files_round_tmp="$(mktemp)"
files_dirty_tmp="$(mktemp)"
uncommitted_tmp="$(mktemp)"
trap 'rm -f "$diff_tmp" "$files_round_tmp" "$files_dirty_tmp" "$uncommitted_tmp"' EXIT

# --- round_diff section 1: committed range only (base..HEAD) ---------------
git -C "$WT" diff "$base_sha" "$head_sha" >"$diff_tmp"

# --- round_diff section 2: untracked file bodies ---------------------------
# `git diff` shows nothing for UNTRACKED files, so a lane whose whole
# deliverable is new files produced a bundle of filenames with no content.
while IFS= read -r -d '' nf; do
  [[ -n "$nf" ]] || continue
  _is_meta_path "$nf" && continue
  [[ -f "$WT/$nf" ]] || continue
  printf '\n=== NEW FILE: %s ===\n' "$nf" >>"$diff_tmp"
  cat "$WT/$nf" >>"$diff_tmp"
done < <(git -C "$WT" ls-files --others --exclude-standard -z)

# --- round_diff section 3: uncommitted tracked changes ---------------------
# Working tree + index vs HEAD for tracked paths only. Reviewers must not
# confuse this with the committed round.
git -C "$WT" diff HEAD >"$uncommitted_tmp"
if [[ -s "$uncommitted_tmp" ]]; then
  printf '\n=== UNCOMMITTED (not part of the committed round) ===\n' >>"$diff_tmp"
  cat "$uncommitted_tmp" >>"$diff_tmp"
fi

# Byte size of the full (pre-truncation) body — the value a consumer needs
# when truncated is true.
diff_bytes="$(wc -c <"$diff_tmp" | tr -d '[:space:]')"
truncated=false

# Truncate on a LINE boundary. `head -c` cuts mid-character on a large diff,
# the result is invalid UTF-8, jq rejects it, and the redirect leaves an empty
# bundle behind with no error.
if [[ "$diff_bytes" -gt 400000 ]]; then
  head -n 5000 "$diff_tmp" >"$diff_tmp.cut" && mv "$diff_tmp.cut" "$diff_tmp"
  printf '\n=== TRUNCATED: bundle exceeded 400000 bytes ===\n' >>"$diff_tmp"
  truncated=true
fi

# --- files_in_round: committed renames/paths + untracked (not porcelain) ---
# NUL-separated so paths with spaces, quotes, or renames survive intact.
: >"$files_round_tmp"
while IFS= read -r -d '' p; do
  [[ -n "$p" ]] || continue
  _is_meta_path "$p" && continue
  printf '%s\0' "$p" >>"$files_round_tmp"
done < <(git -C "$WT" diff --name-only -z "$base_sha" "$head_sha")

while IFS= read -r -d '' p; do
  [[ -n "$p" ]] || continue
  _is_meta_path "$p" && continue
  printf '%s\0' "$p" >>"$files_round_tmp"
done < <(git -C "$WT" ls-files --others --exclude-standard -z)

files_in_round_args=()
while IFS= read -r -d '' p; do
  [[ -n "$p" ]] || continue
  files_in_round_args+=("$p")
done <"$files_round_tmp"
files_in_round_json="$(_paths_to_json ${files_in_round_args[@]+"${files_in_round_args[@]}"})"

# --- worktree_dirty_files: porcelain -z (distinct from the round list) -----
# Rename/copy entries are XY + space + origin, NUL, then destination NUL.
: >"$files_dirty_tmp"
while IFS= read -r -d '' entry; do
  [[ -n "$entry" ]] || continue
  xy="${entry:0:2}"
  path="${entry:3}"
  case "$xy" in
    R*|C*)
      dest=
      IFS= read -r -d '' dest || dest=
      if [[ -n "$dest" ]]; then
        path="$dest"
      fi
      ;;
  esac
  [[ -n "$path" ]] || continue
  _is_meta_path "$path" && continue
  printf '%s\0' "$path" >>"$files_dirty_tmp"
# -uall lists each untracked file, not just the parent directory name.
done < <(git -C "$WT" status --porcelain -z -uall)

worktree_dirty_args=()
while IFS= read -r -d '' p; do
  [[ -n "$p" ]] || continue
  worktree_dirty_args+=("$p")
done <"$files_dirty_tmp"
worktree_dirty_files_json="$(_paths_to_json ${worktree_dirty_args[@]+"${worktree_dirty_args[@]}"})"

if [[ "${#worktree_dirty_args[@]}" -gt 0 ]]; then
  worktree_dirty=true
else
  worktree_dirty=false
fi

jq -n \
  --arg base_sha "$base_sha" \
  --arg head_sha "$head_sha" \
  --rawfile round_diff "$diff_tmp" \
  --argjson files_in_round "$files_in_round_json" \
  --argjson worktree_dirty_files "$worktree_dirty_files_json" \
  --argjson worktree_dirty "$worktree_dirty" \
  --argjson base_is_ancestor_of_head "$base_is_ancestor_of_head" \
  --argjson truncated "$truncated" \
  --argjson diff_bytes "$diff_bytes" \
  '{
    base_sha: $base_sha,
    head_sha: $head_sha,
    round_diff: $round_diff,
    files_in_round: $files_in_round,
    worktree_dirty_files: $worktree_dirty_files,
    worktree_dirty: $worktree_dirty,
    base_is_ancestor_of_head: $base_is_ancestor_of_head,
    truncated: $truncated,
    diff_bytes: $diff_bytes
  }' >"$OUT_DIR/bundle.json"
