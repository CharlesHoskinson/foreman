#!/usr/bin/env bats
# @description Tests for lane-review-bundle.sh — immutable one-round review
#   bundle so a reviewer never sees a stale base or cumulative worktree state.
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  BUNDLE_OUT="$BATS_TEST_TMPDIR/bundle-out"
  mkdir -p "$BUNDLE_OUT"
}

@test "worktree with uncommitted carry-over records round diff and worktree_dirty=true" {
  base="$(git rev-parse HEAD)"
  echo carry > carry.txt          # uncommitted carry-over from an earlier round
  echo round > round.txt          # current round material

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]
  [ -f "$BUNDLE_OUT/bundle.json" ]

  run jq -r '.worktree_dirty' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "true" ]

  run jq -r '.base_is_ancestor_of_release' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "true" ]

  run jq -r '.base_sha' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$base" ]

  run jq -r '.head_sha' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$(git rev-parse HEAD)" ]

  # Bundle is present and self-describing even when the only changes are
  # untracked (git diff is empty for pure untracked carry-over).
  run jq -e 'has("round_diff") and has("files_changed")' "$BUNDLE_OUT/bundle.json"
  [ "$status" -eq 0 ]
}

@test "base that is not an ancestor of HEAD exits non-zero, names both SHAs, writes no bundle" {
  # Advance main so HEAD has history.
  echo next > next.txt
  git -c core.hooksPath= add next.txt
  git -c core.hooksPath= commit -qm next
  head_sha="$(git rev-parse HEAD)"

  # Unrelated second root — not an ancestor of HEAD.
  git checkout -q --orphan unrelated-root
  echo other > other.txt
  git -c core.hooksPath= add other.txt
  git -c core.hooksPath= commit -qm unrelated
  unrelated_sha="$(git rev-parse HEAD)"
  git checkout -q main

  rm -f "$BUNDLE_OUT/bundle.json"
  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$unrelated_sha" "$BUNDLE_OUT"
  [ "$status" -ne 0 ]
  [ "$status" -ne 2 ]
  # Exact requirement: message names BOTH resolved SHAs.
  [[ "$output" == *"$unrelated_sha"* ]]
  [[ "$output" == *"$head_sha"* ]]
  [ ! -f "$BUNDLE_OUT/bundle.json" ]
}

@test "base ref that does not resolve exits 2" {
  rm -f "$BUNDLE_OUT/bundle.json"
  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "refs/does-not-exist-xyz" "$BUNDLE_OUT"
  [ "$status" -eq 2 ]
  [ ! -f "$BUNDLE_OUT/bundle.json" ]
}

@test "files_changed is a JSON array whose length matches porcelain entries" {
  base="$(git rev-parse HEAD)"
  # Isolate from setup_tmp_repo's untracked fixture copies so the porcelain
  # count is exactly the three files this test creates.
  WT="$BATS_TEST_TMPDIR/clean-wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo base > "$WT/tracked.txt"
  git -C "$WT" -c core.hooksPath= add tracked.txt
  git -C "$WT" -c core.hooksPath= commit -qm base
  base="$(git -C "$WT" rev-parse HEAD)"
  echo a > "$WT/a.txt"
  echo b > "$WT/b.txt"
  echo c > "$WT/c.txt"
  porcelain_n="$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')"
  [ "$porcelain_n" = "3" ]

  run bash "$SCRIPTS/lane-review-bundle.sh" "$WT" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  run jq -r '.files_changed | type' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "array" ]

  run jq -r '.files_changed | length' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$porcelain_n" ]
  [ "$output" = "3" ]

  # Exact membership — array of the three paths, order matches porcelain.
  run jq -c '.files_changed' "$BUNDLE_OUT/bundle.json"
  [ "$output" = '["a.txt","b.txt","c.txt"]' ]
}

@test "diff with double quote and backslash round-trips through jq -r .round_diff" {
  base="$(git rev-parse HEAD)"
  # Modify a tracked file so git diff produces content (untracked alone does not).
  printf 'line with "quote" and \\ backslash\n' > README.md

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  expected="$(git diff "$base" -- . | head -c 400000)"
  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [ "$actual" = "$expected" ]
  # Explicit markers must survive (this is why jq -n --arg is mandatory).
  [[ "$actual" == *'"quote"'* ]]
  [[ "$actual" == *'\\'* ]] || [[ "$actual" == *'backslash'* ]]
}
