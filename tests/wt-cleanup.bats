#!/usr/bin/env bats
# @description Tests for wt-cleanup.sh. No coverage of this script existed in
#   the suite before v0.2.5 T6. Centerpiece: the 2026-07-17 data-loss
#   regression (bugeventlog.md, "wt-cleanup archives only FOREMAN_REPORT.md,
#   lost V2/V3/V4 audit reports") -- the pre-fix archiver copied only the
#   fixed FOREMAN_REPORT.md/.json pair, so the multi-round audit convention's
#   versioned reports (FOREMAN_REPORT_V2/V3/V4.*) and cold-diff patches
#   (DIFF_V*.patch) were silently gone the instant `git worktree remove` ran.
#   Also covers the ordinary dirty-refusal/--force/--keep-branches behaviors
#   and metadata/branch bookkeeping.
bats_require_minimum_version 1.5.0
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

@test "wt-cleanup archives FOREMAN_REPORT*.* and DIFF_*.patch (versioned reports + diff patches) before --force removal" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 audit roundb | tail -1)"
  echo "V2 findings" > "$WT/FOREMAN_REPORT_V2.md"
  echo "V3 findings" > "$WT/FOREMAN_REPORT_V3.md"
  echo "V4 findings" > "$WT/FOREMAN_REPORT_V4.md"
  echo "cold diff v2" > "$WT/DIFF_V2.patch"
  echo "cold diff v3" > "$WT/DIFF_V3.patch"

  run bash "$SCRIPTS/wt-cleanup.sh" run1 --force
  [ "$status" -eq 0 ]

  archive="$FOREMAN_HOME/runs/run1/reports/audit-roundb"
  [ -d "$archive" ]
  [ -f "$archive/FOREMAN_REPORT.md" ]
  [ -f "$archive/FOREMAN_REPORT.json" ]
  [ -f "$archive/FOREMAN_REPORT_V2.md" ]
  [ -f "$archive/FOREMAN_REPORT_V3.md" ]
  [ -f "$archive/FOREMAN_REPORT_V4.md" ]
  [ -f "$archive/DIFF_V2.patch" ]
  [ -f "$archive/DIFF_V3.patch" ]
  grep -q "V3 findings" "$archive/FOREMAN_REPORT_V3.md"
  grep -q "cold diff v3" "$archive/DIFF_V3.patch"

  [ ! -d "$WT" ]
}

@test "wt-cleanup refuses a dirty worktree without --force but still archives its reports first" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo "V2 findings" > "$WT/FOREMAN_REPORT_V2.md"

  run bash "$SCRIPTS/wt-cleanup.sh" run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"DIRTY worktree"* ]]
  [ -d "$WT" ]

  [ -f "$FOREMAN_HOME/runs/run1/reports/implement-fix/FOREMAN_REPORT_V2.md" ]
}

@test "wt-cleanup removes a clean worktree, marks metadata cleaned, prunes, and deletes the branch by default" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "worker commit"

  run bash "$SCRIPTS/wt-cleanup.sh" run1
  [ "$status" -eq 0 ]
  [ ! -d "$WT" ]

  meta="$FOREMAN_HOME/runs/run1/worktrees/implement-fix.json"
  grep -q '"status": *"cleaned"' "$meta"
  run git branch --list "foreman/run1/implement/fix"
  [ -z "$output" ]
}

@test "wt-cleanup --keep-branches preserves the branch after removal" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "worker commit"

  run bash "$SCRIPTS/wt-cleanup.sh" run1 --keep-branches
  [ "$status" -eq 0 ]
  [ ! -d "$WT" ]

  run git branch --list "foreman/run1/implement/fix"
  [[ "$output" == *"foreman/run1/implement/fix"* ]]
}
