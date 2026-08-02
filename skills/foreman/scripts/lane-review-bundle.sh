#!/usr/bin/env bash
# Build an immutable review bundle describing ONE round of lane work.
# Two of three HIGH findings in a single audit round on 2026-08-01 were
# artifacts of a stale base and of cumulative worktree state being presented
# as the round's change. This script exists so a reviewer can never see either.
#
# Usage: lane-review-bundle.sh WORKTREE BASE_REF OUT_DIR
# Writes OUT_DIR/bundle.json with keys base_sha, head_sha, round_diff,
# files_changed, worktree_dirty, base_is_ancestor_of_release.
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
if ! git -C "$WT" merge-base --is-ancestor "$base_sha" "$head_sha"; then
  printf 'lane-review-bundle: base %s is not an ancestor of head %s\n' \
    "$base_sha" "$head_sha" >&2
  exit 3
fi

mkdir -p "$OUT_DIR" || {
  printf 'lane-review-bundle: cannot create out dir %s\n' "$OUT_DIR" >&2
  exit 2
}

# Round diff, truncated at 400000 bytes. Use a temp file + jq --rawfile so
# trailing newlines and embedded quotes/backslashes are preserved exactly
# (command substitution would strip trailing newlines; string concat of JSON
# would mangle quotes).
diff_tmp="$(mktemp)"
trap 'rm -f "$diff_tmp"' EXIT
git -C "$WT" diff "$base_sha" -- . | head -c 400000 >"$diff_tmp"

# files_changed: one path per porcelain line (status columns stripped).
# Paths with spaces stay intact after the three-byte XY+space prefix.
files_tmp="$(mktemp)"
trap 'rm -f "$diff_tmp" "$files_tmp"' EXIT
git -C "$WT" status --porcelain | sed 's/^...//' >"$files_tmp"
files_json="$(jq -R . <"$files_tmp" | jq -s .)"

if [[ -s "$files_tmp" ]]; then
  worktree_dirty=true
else
  worktree_dirty=false
fi

jq -n \
  --arg base_sha "$base_sha" \
  --arg head_sha "$head_sha" \
  --rawfile round_diff "$diff_tmp" \
  --argjson files_changed "$files_json" \
  --argjson worktree_dirty "$worktree_dirty" \
  '{
    base_sha: $base_sha,
    head_sha: $head_sha,
    round_diff: $round_diff,
    files_changed: $files_changed,
    worktree_dirty: $worktree_dirty,
    base_is_ancestor_of_release: true
  }' >"$OUT_DIR/bundle.json"
