#!/usr/bin/env bats
# @description Tests for tools/plugin-drift.sh, which fails when the installed
#   skill is missing files the repo ships. The installed plugin once lacked the
#   entire session store while reporting no problem at all.
bats_require_minimum_version 1.5.0

setup() {
  DRIFT="$BATS_TEST_DIRNAME/../tools/plugin-drift.sh"
  REPO_SKILL="$BATS_TEST_TMPDIR/repo-skill"
  INSTALLED="$BATS_TEST_TMPDIR/installed"
  mkdir -p "$REPO_SKILL/scripts" "$INSTALLED/scripts"
  echo a > "$REPO_SKILL/scripts/fm-session.py"
  echo b > "$REPO_SKILL/scripts/other.py"
  echo a > "$INSTALLED/scripts/fm-session.py"
}

@test "drift is detected when the install is missing a repo file" {
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MISSING scripts/other.py"* ]]
}

@test "a complete install reports no drift" {
  echo b > "$INSTALLED/scripts/other.py"
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no drift"* ]]
}

@test "a fully absent install directory reports MISSING on stdout" {
  rm -rf "$INSTALLED"
  run --separate-stderr bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MISSING"* ]]
  [[ "$stderr" != *"MISSING"* ]]
}
