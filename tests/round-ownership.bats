#!/usr/bin/env bats
# @description Behavioral coverage for durable round-ownership admission.
load helpers
load lib/preconditions

setup() {
  require_tool git "install git"
  require_tool jq "install jq"
  require_tool flock "install util-linux"
  require_tool sha256sum "install coreutils"
  require_tool python3 "install python3"

  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  export DURABLE_CHECKPOINT_INTERVAL=0
  export DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch"
  unset DURABLE_ENABLED FOREMAN_CONFIG 2>/dev/null || true

  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  setup_lock_trust_fixture

  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email test@example.com
  git -C "$WT" config user.name "Foreman Test"
  printf 'fixture\n' >"$WT/README.md"
  git -C "$WT" add README.md
  git -C "$WT" commit -qm init
}

# @description Invoke lane-run.sh from the fixture repo so cfg_load observes
#   that repo's .foreman/config.toml, or its absence, rather than this checkout.
run_lane() {
  (
    cd "$WT"
    bash "$SCRIPTS/lane-run.sh" "$@"
  )
}

# @description Assert no round_done event exists, accepting a pre-event refusal
#   whose run directory or events.jsonl has not been created.
assert_no_round_done() {
  local events
  events="$(run_dir "$1")/events.jsonl"
  if [[ -f "$events" ]]; then
    ! jq -e 'select(.type == "round_done")' "$events" >/dev/null
  fi
}

@test "round ownership refusal blocks unowned dispatch before child spawn" {
  export DURABLE_ENABLED=true
  marker="$WT/child-spawned"

  run run_lane run-refuse lane-a "$WT" -- \
    bash -c 'touch "$1"' _ "$marker"

  [ "$status" -eq 2 ]
  [[ "$output" == *"round ownership"* ]]
  [ ! -e "$marker" ]
}

@test "round-owned dispatch proceeds while durable ownership is enabled" {
  export DURABLE_ENABLED=true
  report="$WT/FOREMAN_REPORT.md"

  run run_lane --round true "$report" run-owned lane-a "$WT" -- \
    bash -c 'printf "attempt: 1\n" >"$1"' _ "$report"

  [ "$status" -eq 0 ]
  [ -f "$report" ]
  events="$(run_dir run-owned)/events.jsonl"
  jq -e 'select(.type == "round_done" and .payload.gate_rc == 0 and .payload.report_fresh == true)' \
    "$events" >/dev/null
}

@test "durable disabled preserves the pre-change unowned dispatch path" {
  export DURABLE_ENABLED=false
  marker="$WT/unowned-ran"

  run run_lane run-disabled lane-a "$WT" -- \
    bash -c 'touch "$1"' _ "$marker"

  [ "$status" -eq 0 ]
  [ -f "$marker" ]
}

@test "DURABLE_ENABLED false overrides TOML true at the enforcement point" {
  mkdir -p "$WT/.foreman"
  printf '[durable]\nenabled = true\n' >"$WT/.foreman/config.toml"
  export DURABLE_ENABLED=false
  marker="$WT/env-override-ran"

  run run_lane run-env-override lane-a "$WT" -- \
    bash -c 'touch "$1"' _ "$marker"

  [ "$status" -eq 0 ]
  [ -f "$marker" ]
}

@test "round mode refuses a whitespace-only gate before child spawn and round_done" {
  export DURABLE_ENABLED=true
  marker="$WT/gate-child-spawned"

  run run_lane --round "   " "$WT/FOREMAN_REPORT.md" run-empty-gate lane-a "$WT" -- \
    bash -c 'touch "$1"' _ "$marker"

  [ "$status" -eq 2 ]
  [[ "$output" == *"gate command"* ]]
  [ ! -e "$marker" ]
  assert_no_round_done run-empty-gate
}

@test "unowned escape hatch runs and records the exact reason as an alert" {
  export DURABLE_ENABLED=true
  reason="stateful target, worktree isolation does not apply"
  marker="$WT/escape-ran"

  run run_lane --unowned "$reason" run-escape lane-a "$WT" -- \
    bash -c 'touch "$1"' _ "$marker"

  [ "$status" -eq 0 ]
  [ -f "$marker" ]
  jq -e --arg reason "$reason" \
    'select(.type == "alert"
      and .payload.kind == "unowned_dispatch"
      and .payload.reason == $reason)' \
    "$(run_dir run-escape)/events.jsonl" >/dev/null
}

@test "unowned escape hatch refuses a missing reason before child spawn" {
  export DURABLE_ENABLED=true
  marker="$WT/missing-reason-child"

  run run_lane --unowned

  [ "$status" -eq 2 ]
  [[ "$output" == *"REASON"* ]]
  [ ! -e "$marker" ]
}

@test "unowned escape hatch refuses a whitespace-only reason before child spawn" {
  export DURABLE_ENABLED=true
  marker="$WT/blank-reason-child"

  run run_lane --unowned "   " run-blank-reason lane-a "$WT" -- \
    bash -c 'touch "$1"' _ "$marker"

  [ "$status" -eq 2 ]
  [[ "$output" == *"REASON"* ]]
  [ ! -e "$marker" ]
}
