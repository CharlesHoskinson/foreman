#!/usr/bin/env bats
load helpers

setup() {
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/lib/checkpoint.sh"
  WT="$BATS_TEST_TMPDIR/wt"; mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com; git -C "$WT" config user.name t
  echo base > "$WT/f"; git -C "$WT" add -A; git -C "$WT" commit -qm base
}

@test "ckpt_snapshot captures uncommitted work without touching HEAD or index" {
  echo dirty > "$WT/f"; echo new > "$WT/g"     # uncommitted changes
  head_before="$(git -C "$WT" rev-parse HEAD)"
  run ckpt_snapshot "$WT" lane1
  [ "$status" -eq 0 ]
  sha="$output"
  [ "$(git -C "$WT" rev-parse HEAD)" = "$head_before" ]      # HEAD untouched
  git -C "$WT" diff --cached --quiet                          # index untouched
  # the snapshot commit contains the dirty content
  [ "$(git -C "$WT" show "$sha:g")" = "new" ]
  [ "$(git -C "$WT" show "$sha:f")" = "dirty" ]
  [ "$(git -C "$WT" rev-parse refs/checkpoints/lane1)" = "$sha" ]
}

@test "ckpt_snapshot chains parents and ckpt_latest returns newest" {
  echo one > "$WT/f"; s1="$(ckpt_snapshot "$WT" lane1)"
  echo two > "$WT/f"; s2="$(ckpt_snapshot "$WT" lane1)"
  [ "$s1" != "$s2" ]
  [ "$(git -C "$WT" rev-parse "$s2^")" = "$s1" ]
  [ "$(ckpt_latest "$WT" lane1)" = "$s2" ]
}

@test "ckpt_latest is empty when no checkpoint exists" {
  run ckpt_latest "$WT" nolane; [ -z "$output" ]
}

@test "ckpt_snapshot rejects an invalid lane name" {
  run ckpt_snapshot "$WT" "../evil"; [ "$status" -ne 0 ]
  run ckpt_snapshot "$WT" "a b"; [ "$status" -ne 0 ]
}
