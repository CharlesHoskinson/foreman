#!/usr/bin/env bats
load helpers/fixture

SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  export FOREMAN_NO_SANDBOX=1
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo"
  "$SCRIPTS/task-new.sh" T1 main
  WT="$BATS_TEST_TMPDIR/repo-T1"
  RD="$FOREMAN_HOME/runs/T1"
}

@test "green checks produce pass result" {
  run "$SCRIPTS/checks-run.sh" T1
  [ "$status" -eq 0 ]
  [ "$(jq -r .status "$RD/checks-result.json")" = "pass" ]
  jq -e '.sha | length == 40' "$RD/checks-result.json"
}

@test "checks run against committed tree, not dirty worktree" {
  # break the app UNCOMMITTED — archive of HEAD should still pass
  echo "exit 1" > "$WT/src/app.sh"
  run "$SCRIPTS/checks-run.sh" T1
  [ "$status" -eq 0 ]
  [ "$(jq -r .status "$RD/checks-result.json")" = "pass" ]
}

@test "failing committed checks produce fail result with exit 1" {
  echo "exit 1" > "$WT/src/app.sh"
  git -C "$WT" -c core.hooksPath= commit -qam "break"
  run "$SCRIPTS/checks-run.sh" T1
  [ "$status" -eq 1 ]
  [ "$(jq -r .status "$RD/checks-result.json")" = "fail" ]
}

@test "unknown stack exits 2" {
  sed -i '/\[checks\]/,+1d' "$BATS_TEST_TMPDIR/repo/.foreman/config.toml"
  rm -f "$WT/package.json" "$WT/pyproject.toml"
  # config lives in ROOT repo; worktree copy is what matters for autodetect
  sed -i '/\[checks\]/,+1d' "$WT/.foreman/config.toml" 2>/dev/null || true
  run "$SCRIPTS/checks-run.sh" T1
  [ "$status" -eq 2 ]
}
