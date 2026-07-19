#!/usr/bin/env bats
# @description Coverage for v0.2.7.5 worktree-hardening T1: git-guards.sh, the
#   idempotent concurrency-safe repo-config bootstrap. Every test targets the
#   THROWAWAY repo `setup_tmp_repo` provides -- never the real foreman repo --
#   and never exercises `git maintenance register`/`start` (git-guards.sh
#   itself never calls them; see its header comment for why).
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

@test "git-guards sets the concurrency-safe config idempotently" {
  run bash "$SCRIPTS/git-guards.sh" "$REPO"
  [ "$status" -eq 0 ]
  [ "$(git -C "$REPO" config maintenance.auto)" = "false" ]
  [ "$(git -C "$REPO" config core.longpaths)" = "true" ]
  [ "$(git -C "$REPO" config core.fsmonitor)" = "true" ]
  [ "$(git -C "$REPO" config core.untrackedCache)" = "true" ]
  [ "$(git -C "$REPO" config safe.bareRepository)" = "explicit" ]

  run bash "$SCRIPTS/git-guards.sh" "$REPO"   # idempotent
  [ "$status" -eq 0 ]
  [ "$(git -C "$REPO" config maintenance.auto)" = "false" ]
  [ "$(git -C "$REPO" config core.longpaths)" = "true" ]
  [ "$(git -C "$REPO" config core.fsmonitor)" = "true" ]
  [ "$(git -C "$REPO" config core.untrackedCache)" = "true" ]
  [ "$(git -C "$REPO" config safe.bareRepository)" = "explicit" ]
}

@test "git-guards reports each applied setting" {
  run bash "$SCRIPTS/git-guards.sh" "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"applied maintenance.auto=false"* ]]
  [[ "$output" == *"applied core.fsmonitor=true"* ]]
  [[ "$output" == *"applied core.untrackedCache=true"* ]]
  [[ "$output" == *"applied core.longpaths=true"* ]]
  [[ "$output" == *"applied safe.bareRepository=explicit"* ]]
}

@test "git-guards ensures a maintenance path exists (foreman-owned tick, never git maintenance register/start)" {
  run bash "$SCRIPTS/git-guards.sh" "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"maintenance path active"* ]]
  common="$(git -C "$REPO" rev-parse --git-common-dir)"
  [[ "$common" = /* ]] || common="$REPO/$common"
  [ -f "$common/foreman-maintenance.tick" ]
  # never touches the real global config -- register/start are never called
  run git -C "$REPO" config --global --get-all maintenance.repo
  [ "$status" -ne 0 ] || [[ "$output" != *"$REPO"* ]]
}

@test "git-guards throttles the maintenance tick on an immediate re-run" {
  run bash "$SCRIPTS/git-guards.sh" "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"maintenance tick ran"* ]]

  run bash "$SCRIPTS/git-guards.sh" "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"maintenance tick skipped"* ]]
}

@test "git-guards rejects a missing REPO argument and a non-repo directory" {
  run bash "$SCRIPTS/git-guards.sh"
  [ "$status" -ne 0 ]

  notrepo="$BATS_TEST_TMPDIR/notrepo"
  mkdir -p "$notrepo"
  run bash "$SCRIPTS/git-guards.sh" "$notrepo"
  [ "$status" -ne 0 ]
}
