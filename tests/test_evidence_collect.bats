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
  echo "new line" >> "$WT/src/app.sh"
  git -C "$WT" -c core.hooksPath= commit -qam "worker change"
}

@test "collects diff, stat, status, sha, commits" {
  run "$SCRIPTS/evidence-collect.sh" T1
  [ "$status" -eq 0 ]
  grep -q "new line" "$RD/evidence/patch.diff"
  grep -q "src/app.sh" "$RD/evidence/diff-stat.txt"
  [ -f "$RD/evidence/git-status.txt" ]
  [ "$(wc -c < "$RD/evidence/head-sha.txt")" -eq 41 ]
  grep -q "worker change" "$RD/evidence/commits.txt"
}
