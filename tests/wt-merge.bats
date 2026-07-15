#!/usr/bin/env bats
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

# @description helper: create implement worktree with one committed change
make_work() {  # $1 filename  $2 content
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo "${2:-work}" > "$WT/${1:-new-file.txt}"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm work
}

@test "wt-merge stages changes without committing by default" {
  make_work new-file.txt
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 0 ]
  git -C "$REPO" diff --cached --name-only | grep -q new-file.txt
  [ "$(git -C "$REPO" rev-list --count HEAD)" -eq 1 ]
}

@test "wt-merge --commit creates exactly one commit" {
  make_work new-file.txt
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix --commit
  [ "$status" -eq 0 ]
  [ "$(git -C "$REPO" rev-list --count HEAD)" -eq 2 ]
  git -C "$REPO" diff --cached --quiet
}

@test "wt-merge refuses when target has uncommitted overlap" {
  make_work README.md changed-in-worktree
  echo dirty-local >> "$REPO/README.md"
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 5 ]
  git -C "$REPO" diff --cached --quiet   # nothing staged
}

@test "wt-merge refuses when target index already has staged changes" {
  make_work new-file.txt
  echo staged > "$REPO/staged.txt"
  git -C "$REPO" -c core.hooksPath= add staged.txt
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 4 ]
}

@test "wt-merge fails on missing metadata" {
  run bash "$SCRIPTS/wt-merge.sh" nosuchrun implement
  [ "$status" -eq 3 ]
}

@test "wt-merge marks metadata merged" {
  make_work new-file.txt
  bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  grep -q '"status": *"merged"' "$FOREMAN_HOME/runs/run1/worktrees/implement-fix.json"
}

@test "wt-merge commits uncommitted worker changes before merging" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo work > "$WT/uncommitted-file.txt"
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 0 ]
  git -C "$REPO" diff --cached --name-only | grep -q uncommitted-file.txt
}

@test "wt-merge exit 7 on squash conflict leaves clean index" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo "worktree-line" > "$WT/conflict.txt"
  git -C "$WT" -c core.hooksPath= add conflict.txt
  git -C "$WT" -c core.hooksPath= commit -qm wtchange

  echo "target-line" > "$REPO/conflict.txt"
  git -C "$REPO" -c core.hooksPath= add conflict.txt
  git -C "$REPO" -c core.hooksPath= commit -qm targetchange

  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 7 ]
  git -C "$REPO" diff --cached --quiet
}

@test "wt-merge auto-commit excludes Foreman report files" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo "updated report" >> "$WT/FOREMAN_REPORT.md"
  echo " " >> "$WT/FOREMAN_REPORT.json"
  echo "normal content" > "$WT/normal.txt"

  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 0 ]

  staged="$(git -C "$REPO" diff --cached --name-only)"
  ! grep -Eq '^FOREMAN_REPORT\.(md|json)$' <<< "$staged"
  grep -q '^normal.txt$' <<< "$staged"

  committed="$(git -C "$WT" show --format= --name-only HEAD)"
  ! grep -Eq '^FOREMAN_REPORT\.(md|json)$' <<< "$committed"
  grep -q '^normal.txt$' <<< "$committed"
}
