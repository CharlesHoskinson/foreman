#!/usr/bin/env bats
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

@test "wt-new creates worktree, branch, and report scaffold" {
  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]
  WT="${lines[-1]}"
  [ -d "$WT" ]
  [ -f "$WT/FOREMAN_REPORT.md" ]
  [ -f "$WT/FOREMAN_REPORT.json" ]
  git -C "$REPO" show-ref --verify --quiet refs/heads/foreman/run1/implement/slug1
}

@test "wt-new rejects malformed run id" {
  run bash "$SCRIPTS/wt-new.sh" "bad id" search
  [ "$status" -ne 0 ]
}

@test "wt-new rejects unknown role" {
  run bash "$SCRIPTS/wt-new.sh" run1 hacker
  [ "$status" -ne 0 ]
}

@test "wt-new refuses duplicate worktree path" {
  bash "$SCRIPTS/wt-new.sh" run1 plan
  run bash "$SCRIPTS/wt-new.sh" run1 plan
  [ "$status" -ne 0 ]
}
