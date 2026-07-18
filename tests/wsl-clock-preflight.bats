#!/usr/bin/env bats
# @description Tests for env/wsl-clock-preflight.sh (v0.2.7.5 package 3,
#   wsl-reliability-env-refresh Task 4): the lane-start clock-drift preflight
#   that protects the event log's ordering invariants against WSL VM clock
#   drift after a Windows host sleep/resume cycle. Every test drives the
#   script entirely through its injectable clock seam (WSL_CLOCK_CMD /
#   HOST_CLOCK_CMD / CLOCK_RESYNC_CMD) -- none of these tests reads or
#   writes the real system clock, so "mock a skewed clock" is deterministic,
#   not a real sleep/resume reproduction.
load helpers

setup() {
  ENV_DIR="$(cd "$BATS_TEST_DIRNAME/../env" && pwd)"
  WORK="$BATS_TEST_TMPDIR"
}

# @description Write a tiny script that unconditionally prints a fixed
#   epoch-seconds value, for use as a WSL_CLOCK_CMD/HOST_CLOCK_CMD override.
# @arg $1 path to write
# @arg $2 epoch-seconds value to print
fixed_clock() {
  cat > "$1" <<EOF
#!/usr/bin/env bash
echo "$2"
EOF
}

@test "wsl-clock-preflight: passes when WSL and host clocks agree exactly" {
  fixed_clock "$WORK/wsl_clock.sh" 1000000
  fixed_clock "$WORK/host_clock.sh" 1000000
  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

@test "wsl-clock-preflight: passes when drift is within the default threshold" {
  fixed_clock "$WORK/wsl_clock.sh" 1000000
  fixed_clock "$WORK/host_clock.sh" 1000003
  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh"
  [ "$status" -eq 0 ]
}

@test "wsl-clock-preflight: refuses + alerts when drift exceeds threshold, no --resync" {
  fixed_clock "$WORK/wsl_clock.sh" 1000000
  fixed_clock "$WORK/host_clock.sh" 1009999
  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ALERT"* ]]
  [[ "$output" == *"9999"* ]]
}

@test "wsl-clock-preflight: a custom --threshold changes the pass/fail boundary" {
  fixed_clock "$WORK/wsl_clock.sh" 1000000
  fixed_clock "$WORK/host_clock.sh" 1000050
  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh" --threshold 100
  [ "$status" -eq 0 ]

  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh" --threshold 10
  [ "$status" -eq 1 ]
}

# @description A stateful fake WSL clock: starts skewed, and a paired
#   CLOCK_RESYNC_CMD script overwrites its backing file to the host's value
#   -- simulating what a real `hwclock -s` does (pull the guest clock to
#   match the host) without ever touching the real system clock.
# @arg $1 directory to hold the backing state file and both scripts
# @arg $2 initial (skewed) WSL clock value
# @arg $3 host clock value (also what a successful resync converges to)
setup_stateful_resync() {
  local dir="$1" wsl_val="$2" host_val="$3"
  echo "$wsl_val" > "$dir/wsl_time"
  cat > "$dir/wsl_clock.sh" <<EOF
#!/usr/bin/env bash
cat "$dir/wsl_time"
EOF
  cat > "$dir/host_clock.sh" <<EOF
#!/usr/bin/env bash
echo "$host_val"
EOF
  cat > "$dir/resync.sh" <<EOF
#!/usr/bin/env bash
echo "$host_val" > "$dir/wsl_time"
EOF
}

@test "wsl-clock-preflight: --resync corrects a skewed clock and then passes" {
  setup_stateful_resync "$WORK" 1000000 1009999
  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    CLOCK_RESYNC_CMD="bash $WORK/resync.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh" --resync
  [ "$status" -eq 0 ]
  [[ "$output" == *"resync"* ]]
  [[ "$output" == *"OK"* ]]
}

@test "wsl-clock-preflight: --resync still refuses + alerts if drift persists after a failed resync" {
  setup_stateful_resync "$WORK" 1000000 1009999
  # A no-op resync command: drift is never actually corrected.
  WSL_CLOCK_CMD="bash $WORK/wsl_clock.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    CLOCK_RESYNC_CMD="true" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh" --resync
  [ "$status" -eq 1 ]
  [[ "$output" == *"ALERT"* ]]
}

@test "wsl-clock-preflight: alerts (does not silently pass) when a clock source is unreadable" {
  fixed_clock "$WORK/host_clock.sh" 1000000
  WSL_CLOCK_CMD="bash $WORK/does-not-exist.sh" \
    HOST_CLOCK_CMD="bash $WORK/host_clock.sh" \
    run bash "$ENV_DIR/wsl-clock-preflight.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ALERT"* ]]
}
