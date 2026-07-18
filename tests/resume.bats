#!/usr/bin/env bats
# @description Tests for resume.sh: lane-filtered checkpoint restore, dirty guard,
#   --force backup, overlay vs --exact, and prompt recovery.
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  source "$SCRIPTS/lib/checkpoint.sh"
  setup_git_worktree
  el_init run1
}

# @description Checkpoint "work" for lane1, emit event, leave worktree clean at base.
seed_checkpoint_clean() {
  local lane="${1:-lane1}" content="${2:-work}"
  echo "$content" > "$WT/f"
  local sha
  sha="$(ckpt_snapshot "$WT" "$lane")"
  el_emit run1 checkpoint "$lane" '{}' "$sha" >/dev/null
  git -C "$WT" checkout -- . 2>/dev/null
  [ "$(cat "$WT/f")" = "base" ]
  [ -z "$(git -C "$WT" status --porcelain)" ]
}

@test "clean restore restores last checkpoint content" {
  seed_checkpoint_clean lane1 work
  run bash "$SCRIPTS/resume.sh" run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/f")" = "work" ]
}

@test "dirty refusal leaves worktree untouched and exits 5" {
  seed_checkpoint_clean lane1 work
  echo clobbered > "$WT/f"
  run bash "$SCRIPTS/resume.sh" run1 lane1 "$WT"
  [ "$status" -eq 5 ]
  [ "$(cat "$WT/f")" = "clobbered" ]
}

@test "--force restores and backs up dirty state to lane-pre-resume" {
  seed_checkpoint_clean lane1 work
  echo clobbered > "$WT/f"
  run bash "$SCRIPTS/resume.sh" --force run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/f")" = "work" ]
  git -C "$WT" rev-parse --verify refs/checkpoints/lane1-pre-resume
  [ "$(git -C "$WT" show refs/checkpoints/lane1-pre-resume:f)" = "clobbered" ]
}

@test "exit 4 when no checkpoint exists for run/lane" {
  run bash "$SCRIPTS/resume.sh" run1 nolane "$WT"
  [ "$status" -eq 4 ]
}

@test "lane isolation: resume laneA restores A-work not B-work" {
  echo A-work > "$WT/f"
  local shaA
  shaA="$(ckpt_snapshot "$WT" laneA)"
  el_emit run1 checkpoint laneA '{}' "$shaA" >/dev/null

  echo B-work > "$WT/f"
  local shaB
  shaB="$(ckpt_snapshot "$WT" laneB)"
  el_emit run1 checkpoint laneB '{}' "$shaB" >/dev/null

  git -C "$WT" checkout -- . 2>/dev/null
  [ -z "$(git -C "$WT" status --porcelain)" ]

  run bash "$SCRIPTS/resume.sh" run1 laneA "$WT"
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/f")" = "A-work" ]
  [ "$(cat "$WT/f")" != "B-work" ]
}

@test "prompt recovery prints last lane prompt payload as final PROMPT line" {
  seed_checkpoint_clean lane1 work
  el_emit run1 prompt lane1 '{"cmd":"retry-round"}' >/dev/null
  run bash "$SCRIPTS/resume.sh" run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  local prompt_line
  prompt_line="$(printf '%s\n' "$output" | grep '^PROMPT: ' | tail -n 1)"
  [[ "$prompt_line" == PROMPT:\ * ]]
  [[ "$prompt_line" == *cmd* ]]
  [[ "$prompt_line" == *retry-round* ]]
}

@test "--exact deletes post-checkpoint extras; overlay keeps them" {
  seed_checkpoint_clean lane1 work
  echo extra > "$WT/newfile.txt"
  # Untracked file dirties the tree; --force required.
  run bash "$SCRIPTS/resume.sh" --force --exact run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/f")" = "work" ]
  [ ! -e "$WT/newfile.txt" ]

  # Recreate extra and use default overlay restore: file must survive.
  echo extra > "$WT/newfile.txt"
  run bash "$SCRIPTS/resume.sh" --force run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ -f "$WT/newfile.txt" ]
  [ "$(cat "$WT/newfile.txt")" = "extra" ]
}

@test "--exact deletes gitignored extras too; overlay keeps them; .harness/FOREMAN_REPORT* always survive" {
  echo 'junk.log' > "$WT/.gitignore"
  git -C "$WT" add .gitignore
  git -C "$WT" commit -qm gitignore
  seed_checkpoint_clean lane1 work

  # Gitignored extra created after the checkpoint: `git status --porcelain`
  # does not surface it (ignored), so the tree still reads "clean" here, but
  # it must still be deleted by --exact per the documented contract.
  echo x > "$WT/junk.log"
  # Also create the two permanently-exempt paths so this test proves they
  # are never touched even while other untracked extras are being deleted.
  mkdir -p "$WT/.harness"
  echo keep > "$WT/.harness/state"
  echo keep > "$WT/FOREMAN_REPORT.md"

  run bash "$SCRIPTS/resume.sh" --force --exact run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/f")" = "work" ]
  [ ! -e "$WT/junk.log" ]
  [ -f "$WT/.harness/state" ]
  [ -f "$WT/FOREMAN_REPORT.md" ]

  # Recreate the gitignored extra and use default overlay restore: it must survive.
  echo x > "$WT/junk.log"
  run bash "$SCRIPTS/resume.sh" --force run1 lane1 "$WT"
  [ "$status" -eq 0 ]
  [ -f "$WT/junk.log" ]
  [ "$(cat "$WT/junk.log")" = "x" ]
  [ -f "$WT/.harness/state" ]
  [ -f "$WT/FOREMAN_REPORT.md" ]
}

@test "usage error: wrong arg count exits 2" {
  run bash "$SCRIPTS/resume.sh" run1 lane1
  [ "$status" -eq 2 ]
  run bash "$SCRIPTS/resume.sh" run1 lane1 "$WT" extra
  [ "$status" -eq 2 ]
}

@test "usage error: bad charset in RUN_ID or LANE exits 2" {
  run bash "$SCRIPTS/resume.sh" 'bad/run' lane1 "$WT"
  [ "$status" -eq 2 ]
  run bash "$SCRIPTS/resume.sh" run1 'bad lane' "$WT"
  [ "$status" -eq 2 ]
}
