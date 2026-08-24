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
#   v0.2.5 T7 adds two audit-nit regression cases: the exact
#   durable.merge_base_max_commits boundary (behind == max stays MERGEABLE,
#   only behind > max flips it) and a corrupt/malformed events.jsonl (must
#   yield a clean NOT_MERGEABLE line, never an uncontracted script abort).
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
}

set_release_block() {
  local action="${1:-integrate}" commit="${2:-$(git rev-parse HEAD)}"
  RELEASE_BLOCK=(
    --endstop-state-root "$FOREMAN_HOME/state"
    --endstop-contract-id root-contract
    --endstop-contract-sha "$(printf 'a%.0s' {1..64})"
    --endstop-family-sha "$(printf 'b%.0s' {1..64})"
    --endstop-child-id v040-t9-release
    --endstop-action "$action"
    --endstop-candidate-sha "$(printf 'c%.0s' {1..64})"
    --release-program v040
    --release-phase release
    --release-owner v040-release-program
    --release-repo "$REPO"
    --release-candidate-commit "$commit"
    --release-register "$REPO/coverage.toml"
    --release-evidence "$REPO/evidence.json"
  )
}

install_fake_policy_node() {
  local fake_bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/node" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$POLICY_CALLS"
printf '{"_tag":"Admitted","schemaVersion":1}\n'
exit "${POLICY_EXIT:-0}"
EOF
  chmod +x "$fake_bin/node"
  export PATH="$fake_bin:$PATH"
  export POLICY_CALLS="$BATS_TEST_TMPDIR/policy-calls"
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

@test "merge-gate check runs release policy after freshness and exact branch identity" {
  run bash "$SCRIPTS/merge-gate.sh" record run-release lanea
  [ "$status" -eq 0 ]
  install_fake_policy_node
  set_release_block integrate "$(git rev-parse main)"

  run bash "$SCRIPTS/merge-gate.sh" check run-release lanea main "${RELEASE_BLOCK[@]}"
  [ "$status" -eq 0 ]
  [ "$output" = "MERGEABLE" ]
  [ -f "$POLICY_CALLS" ]
  grep -qx 'check' "$POLICY_CALLS"
}

@test "merge-gate refuses a verify release block without running policy" {
  run bash "$SCRIPTS/merge-gate.sh" record run-wrong-action lanea
  [ "$status" -eq 0 ]
  install_fake_policy_node
  set_release_block verify "$(git rev-parse main)"

  run bash "$SCRIPTS/merge-gate.sh" check run-wrong-action lanea main "${RELEASE_BLOCK[@]}"
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:*expected\ integrate* ]]
  [ ! -e "$POLICY_CALLS" ]
}

@test "merge-gate refuses candidate substitution before running policy" {
  run bash "$SCRIPTS/merge-gate.sh" record run-wrong-candidate lanea
  [ "$status" -eq 0 ]
  install_fake_policy_node
  set_release_block integrate "$(printf '9%.0s' {1..40})"

  run bash "$SCRIPTS/merge-gate.sh" check run-wrong-candidate lanea main "${RELEASE_BLOCK[@]}"
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:*does\ not\ match* ]]
  [ ! -e "$POLICY_CALLS" ]
}

@test "merge-gate suppresses policy output and emits one refusal line" {
  run bash "$SCRIPTS/merge-gate.sh" record run-policy-refused lanea
  [ "$status" -eq 0 ]
  install_fake_policy_node
  export POLICY_EXIT=1
  set_release_block integrate "$(git rev-parse main)"

  run bash "$SCRIPTS/merge-gate.sh" check run-policy-refused lanea main "${RELEASE_BLOCK[@]}"
  [ "$status" -eq 6 ]
  [ "${#lines[@]}" -eq 1 ]
  [[ "$output" == NOT_MERGEABLE:*release\ policy\ refused* ]]
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

@test "merge-gate check returns MERGEABLE when exactly at the durable.merge_base_max_commits boundary (behind == max is within bound)" {
  run bash "$SCRIPTS/merge-gate.sh" record run1 lanea
  [ "$status" -eq 0 ]

  for i in 1 2; do
    echo "c$i" >> README.md
    git -c core.hooksPath= commit -aqm "advance $i"
  done
  git update-ref refs/remotes/origin/main "$(git rev-parse main)"

  # Exactly 2 commits behind, MERGE_BASE_MAX_COMMITS=2: cmd_check's own bound
  # test is `behind > max_commits`, so equality must stay MERGEABLE -- only
  # strictly exceeding the bound (the sibling "stale beyond" test above, 4
  # commits behind a max of 2) may flip the verdict.
  MERGE_BASE_MAX_COMMITS=2 run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 0 ]
  [ "$output" = "MERGEABLE" ]
}

# @description T7 audit nit: a CORRUPT event log (a malformed/torn line
#   anywhere in events.jsonl, el_read's own rc=2 case) must never abort
#   cmd_check mid-contract -- it must print exactly one clean
#   NOT_MERGEABLE:<reason> line (exit 6), same as every other non-mergeable
#   verdict. Before the fix, the unguarded `sha=$(el_read ... | jq ... |
#   tail -1)` pipeline let el_read's nonzero rc trip `set -euo pipefail`
#   and exit the whole script with no NOT_MERGEABLE output at all (verified
#   empirically against the pre-fix code: `bash merge-gate.sh check ...`
#   exited silently with $?=2, never reaching this line).
@test "merge-gate check emits a clean NOT_MERGEABLE line (not a crash) when the event log is corrupt" {
  rd="$(run_dir run1)"
  mkdir -p "$rd"
  printf '{not valid json\n' > "$rd/events.jsonl"

  run bash "$SCRIPTS/merge-gate.sh" check run1 lanea main
  [ "$status" -eq 6 ]
  [[ "$output" == NOT_MERGEABLE:* ]]
  grep -q "corrupt" <<< "$output"
  grep -q "respawn from a fresh base" <<< "$output"
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
