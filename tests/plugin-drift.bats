#!/usr/bin/env bats
# @description Tests for tools/plugin-drift.sh, which fails when the installed
#   skill is missing files the repo ships. The installed plugin once lacked the
#   entire session store and ontology while reporting no problem at all.

setup() {
  DRIFT="$BATS_TEST_DIRNAME/../tools/plugin-drift.sh"
  REPO_SKILL="$BATS_TEST_TMPDIR/repo-skill"
  INSTALLED="$BATS_TEST_TMPDIR/installed"
  mkdir -p "$REPO_SKILL/scripts" "$REPO_SKILL/ontology" "$INSTALLED/scripts"
  echo a > "$REPO_SKILL/scripts/fm-session.py"
  echo b > "$REPO_SKILL/ontology/schema.sql"
  echo a > "$INSTALLED/scripts/fm-session.py"
}

@test "drift is detected when the install is missing a repo file" {
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MISSING ontology/schema.sql"* ]]
}

@test "a complete install reports no drift" {
  mkdir -p "$INSTALLED/ontology"
  echo b > "$INSTALLED/ontology/schema.sql"
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no drift"* ]]
}
