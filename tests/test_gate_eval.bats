#!/usr/bin/env bats
load helpers/fixture

SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo"
  "$SCRIPTS/task-new.sh" T1 main
  WT="$BATS_TEST_TMPDIR/repo-T1"
  RD="$FOREMAN_HOME/runs/T1"
  # a legitimate committed change in the worktree
  echo "echo more" >> "$WT/src/app.sh"
  git -C "$WT" -c core.hooksPath= commit -qam "work"
  # green inputs
  jq -n '{sha:"x",command:"true",exit_code:0,status:"pass"}' > "$RD/checks-result.json"
  jq -n '{verdict:"APPROVED",findings:[]}' > "$RD/audit-verdict.json"
}

@test "passes with clean diff, intact hashes, green checks, APPROVED" {
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 0 ]
  [ "$(jq -r .pass "$RD/gate-decision.json")" = "true" ]
}

@test "fails when diff touches forbidden path" {
  echo tampered > "$WT/tests/test_sample.sh"
  git -C "$WT" -c core.hooksPath= commit -qam "evil"
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 1 ]
  jq -r '.reasons[]' "$RD/gate-decision.json" | grep -q forbidden
}

@test "fails on hash drift even without a commit" {
  echo tampered > "$WT/tests/test_sample.sh"   # uncommitted tamper
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 1 ]
  jq -r '.reasons[]' "$RD/gate-decision.json" | grep -q "hash drift"
}

@test "fails on failing checks" {
  jq -n '{sha:"x",command:"false",exit_code:1,status:"fail"}' > "$RD/checks-result.json"
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 1 ]
}

@test "fails on BLOCKED verdict and on invalid verdict json" {
  jq -n '{verdict:"BLOCKED",findings:[]}' > "$RD/audit-verdict.json"
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 1 ]
  echo '{"verdict":"MAYBE"}' > "$RD/audit-verdict.json"
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 1 ]
}

@test "exit 2 when inputs missing" {
  rm "$RD/checks-result.json"
  run "$SCRIPTS/gate-eval.sh" T1
  [ "$status" -eq 2 ]
}
