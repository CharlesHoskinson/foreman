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

# @description Drift-audit refinement (2026-07-18): the pre-fix wt-merge.sh
#   already used an exclude pathspec (':!FOREMAN_REPORT.md'
#   ':!FOREMAN_REPORT.json') and STILL aborted -- exit 1, "The following
#   paths are ignored by one of your .gitignore files" -- the instant a
#   genuinely gitignored FOREMAN_REPORT.md/.json existed, because git's
#   pathspec matching rejects an ignored path the moment it is *named*
#   anywhere in a pathspec, negated or not. The sibling test above
#   ("auto-commit excludes Foreman report files") never caught this because
#   its $REPO fixture carries no .gitignore for these names, so
#   FOREMAN_REPORT.md/.json land merely untracked-but-not-ignored there --
#   this test uses a genuinely gitignored tree (a real, committed
#   .gitignore, exactly like this repo's own top-level .gitignore already
#   lists FOREMAN_REPORT.md/.json) so it actually exercises the bug the
#   drift audit flagged.
@test "wt-merge commits pending changes when FOREMAN_REPORT.md/.json are genuinely gitignored" {
  printf 'FOREMAN_REPORT.md\nFOREMAN_REPORT.json\n' > "$REPO/.gitignore"
  git -C "$REPO" -c core.hooksPath= add .gitignore
  git -C "$REPO" -c core.hooksPath= commit -qm "gitignore reports"

  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  # Confirm the premise: wt-new.sh's own scaffolded FOREMAN_REPORT.md/.json
  # land untracked AND ignored inside the worktree (the .gitignore just
  # committed to $REPO is checked out there too).
  ignored="$(git -C "$WT" status --porcelain --ignored)"
  grep -q '^!! FOREMAN_REPORT.md$' <<< "$ignored"
  grep -q '^!! FOREMAN_REPORT.json$' <<< "$ignored"

  echo "updated report" >> "$WT/FOREMAN_REPORT.md"
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
