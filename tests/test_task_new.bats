#!/usr/bin/env bats
load helpers/fixture

SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo"
}

@test "creates worktree, branch, run dir, meta, hashes" {
  run "$SCRIPTS/task-new.sh" T1 main
  [ "$status" -eq 0 ]
  [ -d "$BATS_TEST_TMPDIR/repo-T1" ]
  git -C "$BATS_TEST_TMPDIR/repo-T1" rev-parse --abbrev-ref HEAD | grep -qx "ai/T1"
  [ -f "$FOREMAN_HOME/runs/T1/meta.json" ]
  [ "$(jq -r .branch "$FOREMAN_HOME/runs/T1/meta.json")" = "ai/T1" ]
  jq -e '.base_sha | length == 40' "$FOREMAN_HOME/runs/T1/meta.json"
  grep -q '^tests/test_sample.sh' "$FOREMAN_HOME/runs/T1/hashes.txt"
  [ -f "$FOREMAN_HOME/runs/T1/task.md" ]
}

@test "rejects invalid task id with exit 2" {
  run "$SCRIPTS/task-new.sh" 'bad id!' main
  [ "$status" -eq 2 ]
}

@test "rejects duplicate task id with exit 2" {
  "$SCRIPTS/task-new.sh" T1 main
  run "$SCRIPTS/task-new.sh" T1 main
  [ "$status" -eq 2 ]
}

@test "worktree has hooks disabled" {
  "$SCRIPTS/task-new.sh" T1 main
  [ "$(git -C "$BATS_TEST_TMPDIR/repo-T1" config --worktree core.hooksPath)" = "" ]
}
