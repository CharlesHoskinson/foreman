#!/usr/bin/env bats
# @description Tests for merge-gate.sh (v0.2.5 T6): `record` emits a
#   merge_base event (sha = merge-base(HEAD, origin/main), or a noted degrade
#   to HEAD's own sha when origin/main is absent); `check` re-verifies (a)
#   the recorded sha still resolves to a commit, (b) BRANCH contains it, and
#   (c) it is not more than `durable.merge_base_max_commits` commits behind
#   origin/main, printing MERGEABLE (exit 0) or NOT_MERGEABLE:<reason> (exit
#   6) with the respawn-from-fresh-base recommendation and nothing else. All
#   scenarios use throwaway repos with manufactured histories -- including a
#   genuine second root commit for the parallel-history case -- and a
#   manufactured refs/remotes/origin/main ref (git only cares that the ref
#   resolves; no real remote/network needed) so every case is deterministic.
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
}

@test "merge-gate record emits a merge_base event with sha = merge-base(HEAD, origin/main)" {
  echo more >> README.md
  git -c core.hooksPath= commit -aqm "advance main"
  ADVANCED="$(git rev-parse HEAD)"
  git checkout -q -b lanebranch HEAD~1
  git update-ref refs/remotes/origin/main "$ADVANCED"
  BASE_BEFORE_ADVANCE="$(git rev-parse lanebranch)"

  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]
  [ "$output" = "$BASE_BEFORE_ADVANCE" ]

  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="merge_base") | [.lane,.payload.merge_base,.payload.degraded] | @csv' "$events"
  [ "$output" = "\"lanea\",\"$BASE_BEFORE_ADVANCE\",false" ]
}

@test "merge-gate record degrades to HEAD's own sha when origin/main is absent" {
  head_sha="$(git rev-parse HEAD)"

  run --separate-stderr bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]
  [ "$output" = "$head_sha" ]
  [[ "$stderr" == *"degrading to HEAD"* ]]

  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="merge_base") | .payload.degraded' "$events"
  [ "$output" = "true" ]
}

@test "merge-gate check returns MERGEABLE for a live branch descending from the recorded base" {
  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]

  git checkout -q -b lanebranch
  echo work >> README.md
  git -c core.hooksPath= commit -aqm "lane work"

  run bash "$SCRIPTS/merge-gate.sh" check run1 lanea lanebranch
  [ "$status" -eq 0 ]
  [ "$output" = "MERGEABLE" ]
}

@test "merge-gate check returns NOT_MERGEABLE when no merge-base was ever recorded" {
  run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:* ]]
  grep -q "no recorded merge-base" <<< "$output"
  grep -q "respawn from a fresh base" <<< "$output"
}

@test "merge-gate check returns NOT_MERGEABLE when the recorded merge-base no longer resolves to a commit" {
  el_emit run1 merge_base lanea '{"merge_base":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef","degraded":false}' >/dev/null

  run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:* ]]
  grep -q "no longer resolves to a commit" <<< "$output"
}

@test "merge-gate check returns NOT_MERGEABLE on parallel history (second root commit)" {
  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]

  git checkout -q --orphan orphanbranch
  git rm -rf . >/dev/null 2>&1
  echo unrelated > unrelated.txt
  git -c core.hooksPath= add unrelated.txt
  git -c core.hooksPath= commit -qm "second root commit"

  run bash "$SCRIPTS/merge-gate.sh" check run1 lanea orphanbranch
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:* ]]
  grep -q "parallel history" <<< "$output"
}

@test "merge-gate check returns NOT_MERGEABLE when stale beyond durable.merge_base_max_commits" {
  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]
  base_sha="$output"

  for i in 1 2 3 4; do
    echo "c$i" >> README.md
    git -c core.hooksPath= commit -aqm "advance $i"
  done
  git update-ref refs/remotes/origin/main "$(git rev-parse main)"

  MERGE_BASE_MAX_COMMITS=2 run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:* ]]
  grep -q "stale base" <<< "$output"
  grep -q "4 commits behind" <<< "$output"
  unset base_sha
}

@test "merge-gate check returns MERGEABLE when within the durable.merge_base_max_commits bound" {
  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]

  echo c1 >> README.md
  git -c core.hooksPath= commit -aqm "advance 1"
  git update-ref refs/remotes/origin/main "$(git rev-parse main)"

  MERGE_BASE_MAX_COMMITS=2 run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 0 ]
  [ "$output" = "MERGEABLE" ]
}

@test "merge-gate check uses the MOST RECENT recorded merge_base when record ran more than once" {
  el_emit run1 merge_base lanea '{"merge_base":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef","degraded":false}' >/dev/null

  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]
  fresh_sha="$output"

  run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 0 ]
  [ "$output" = "MERGEABLE" ]
  [[ -n "$fresh_sha" ]]
}
