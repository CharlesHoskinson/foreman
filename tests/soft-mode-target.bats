#!/usr/bin/env bats
# @description v0.2.8.1 Task 7: the soft_mode.target=live guard in wt-new.sh.
#   Worktree fan-out is inapplicable to stateful/live targets (external
#   node_modules, running services, live endpoints the checkout doesn't carry)
#   -- see references/parallel-worktrees.md § stateful/live-target. The guard
#   fires ONLY when soft_mode.target resolves to "live"; default/"worktree"
#   leaves wt-new byte-unaffected.
#
#   Config is resolved against the CALLER's git-root (ROOT = git rev-parse
#   --show-toplevel), matching cfg_load + worker-run -- NOT the foreman skill's
#   own dir. So these tests run wt-new from INSIDE a throwaway git repo and
#   drive the guard via that repo's OWN .foreman/config.toml (the real default
#   path). An earlier version resolved config from the skill's own root and was
#   only tested via the FOREMAN_CONFIG override, which hid that bug -- test 1
#   below is exactly the default-path case that regression-guards it.
setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"; mkdir -p "$FOREMAN_HOME"
  REPO="$BATS_TEST_TMPDIR/repo"; mkdir -p "$REPO/.foreman"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email t@e.com; git -C "$REPO" config user.name t
  echo base > "$REPO/f"; git -C "$REPO" add -A; git -C "$REPO" commit -qm base
  unset FOREMAN_CONFIG   # tests 1/2 exercise the DEFAULT path ($ROOT/.foreman/config.toml)
}

@test "live via the DEFAULT config path (FOREMAN_CONFIG unset): wt-new refuses, no worktree" {
  printf '[soft_mode]\ntarget = "live"\n' > "$REPO/.foreman/config.toml"
  cd "$REPO"
  run bash "$SCRIPTS/wt-new.sh" run1 implement
  [ "$status" -ne 0 ]
  [[ "$output" == *"live"* ]]
  [ ! -d "$FOREMAN_HOME/runs/run1/worktrees" ]   # died at the guard, before the run dir
}

@test "default (no soft_mode.target key): wt-new proceeds PAST the guard" {
  : > "$REPO/.foreman/config.toml"
  cd "$REPO"
  run bash "$SCRIPTS/wt-new.sh" run1 implement
  [[ "$output" != *"worktree fan-out is bypassed"* ]]   # the guard did not fire
  [ -d "$FOREMAN_HOME/runs/run1/worktrees" ]            # reached the post-guard run-dir creation
}

@test "FOREMAN_CONFIG production override drives the guard, independent of ROOT" {
  : > "$REPO/.foreman/config.toml"   # the repo's OWN config has no live key
  local override="$BATS_TEST_TMPDIR/override.toml"
  printf '[soft_mode]\ntarget = "live"\n' > "$override"
  cd "$REPO"
  FOREMAN_CONFIG="$override" run bash "$SCRIPTS/wt-new.sh" run1 implement
  [ "$status" -ne 0 ]
  [[ "$output" == *"live"* ]]
}
