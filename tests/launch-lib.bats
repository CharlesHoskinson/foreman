#!/usr/bin/env bats
# @description Unit tests for lib/launch.sh's fl_resolve_launcher — the
#   self-contained foreman-launch resolver hard-mode scripts use (they live
#   one level deeper, skills/foreman/scripts/lib, than lane-run.sh's own
#   lane_resolve_launcher, hence FOUR levels up to repo root, not three).

setup() {
  load "$BATS_TEST_DIRNAME/lib/preconditions.bash"
  source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/launch.sh"
}

@test "override authoritative when executable" {
  local f="$BATS_TEST_TMPDIR/fl"; printf '#!/usr/bin/env bash\ntrue\n' >"$f"; chmod +x "$f"
  FOREMAN_LAUNCH="$f" run fl_resolve_launcher
  [ "$status" -eq 0 ]
  [ "$output" = "$f" ]
}

@test "non-executable override means ABSENT" {
  FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/x" run fl_resolve_launcher
  [ "$status" -ne 0 ]
}

@test "no override resolves an available launcher/dist binary (fallback)" {
  # launcher/dist is gitignored, so this artefact exists only after a build.
  # Without this precondition the test fails on a fresh clone and passes on any
  # machine that has ever built it -- an order and history dependence, not a
  # property of fl_resolve_launcher. CI builds it before the suite runs
  # (gates-linux.yml, "Build POSIX launcher"), so the property stays covered
  # where it matters.
  require_built "$BATS_TEST_DIRNAME/../launcher/dist/foreman-launch" \
    "(cd launcher && bun run build:posix)"
  unset FOREMAN_LAUNCH
  run fl_resolve_launcher
  [ "$status" -eq 0 ]
  [[ "$output" == *"launcher/dist/foreman-launch"* ]]
}
