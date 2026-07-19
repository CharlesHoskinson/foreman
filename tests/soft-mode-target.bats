#!/usr/bin/env bats
# @description v0.2.8.1 Task 7 coverage: the `soft_mode.target=live` guard in
#   wt-new.sh. Worktree fan-out is inapplicable to stateful/live targets
#   (external node_modules, running services, live endpoints the checkout
#   doesn't carry) -- see references/parallel-worktrees.md § stateful/
#   live-target. The guard fires ONLY when soft_mode.target resolves to
#   "live"; default/"worktree" must leave wt-new's existing behavior
#   byte-unaffected. FOREMAN_CONFIG is a test-only override (see wt-new.sh
#   header) so this file never has to mutate the real repo's own
#   .foreman/config.toml.
setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"; mkdir -p "$FOREMAN_HOME"
  # a throwaway repo checkout that wt-new would operate from
  REPO="$BATS_TEST_TMPDIR/repo"; mkdir -p "$REPO/.foreman"
  # NOTE: wt-new resolves CONFIG from ITS OWN repo root (skills/foreman/scripts/../../..),
  # so the guard reads the REAL repo's .foreman/config.toml. The test drives the guard
  # via an env override the implementation must honor: FOREMAN_CONFIG (see Step 3).
  export FOREMAN_CONFIG="$REPO/.foreman/config.toml"
}

@test "soft_mode.target=live: wt-new refuses, creates no worktree" {
  printf '[soft_mode]\ntarget = "live"\n' > "$FOREMAN_CONFIG"
  run bash "$SCRIPTS/wt-new.sh" run1 impl
  [ "$status" -ne 0 ]
  [[ "$output" == *"live"* ]]
}

@test "default (no key): wt-new does NOT refuse on the live guard" {
  : > "$FOREMAN_CONFIG"   # empty config -> default worktree
  run bash "$SCRIPTS/wt-new.sh" run1 impl
  # it may fail later for unrelated setup reasons, but NOT with the live-target refusal
  [[ "$output" != *"soft_mode.target=live"* ]]
}
