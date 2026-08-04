# bats test data (run via `bats`, not as a product executable)
# @description Coverage for lifecycle-three-stage Task 5: the Use-path
#   readiness gate in lane-run.sh. Spec R1/R2 require Use to REFUSE routing
#   to a not-ready lane at the door -- not merely for Setup to report it
#   (Opus plan-audit finding: a real coded gate, not Setup-side reporting
#   alone). When LANE_VENDOR is set, lane-run.sh MUST refuse to spawn CMD for
#   a not-ready vendor, citing Setup, with NO auth attempt of its own, BEFORE
#   touching the worktree lock or emitting any event. Unset LANE_VENDOR is
#   the frozen v1 path (no gate) -- covered by the third test here and by
#   the pre-existing lane-run.bats/vendor-isolation.bats suites, re-run
#   alongside this file per the plan's own Step 4 instruction.
#
#   Shim per auth-probes.md's empirical grok findings (Task 0): `grok
#   models` always exits 0 regardless of auth state -- the signal is in
#   stdout text ("not authenticated" / "logged in") -- so the shim mirrors
#   that, not the plan's illustrative (and, for grok, inaccurate) bare
#   exit-code template.
#
#   setup() mirrors tests/vendor-isolation.bats's own setup() (durable-lanes
#   intervals off for a deterministic, no-background-loop run; FOREMAN_LAUNCH
#   neutralized to a guaranteed-absent path so every test runs the frozen
#   launcher-absent direct-spawn branch).
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_ENABLED=false
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch-binary"
  unset LANE_VENDOR LANE_CONFIG_DIR GROK_HOME CODEX_HOME CLAUDE_CONFIG_DIR 2>/dev/null || true
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo x > "$WT/f"
  git -C "$WT" add -A
  git -C "$WT" commit -qm base
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
}

@test "Use refuses a not-ready grok lane at the door, citing Setup" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  *) echo "SHOULD-NOT-RUN" > "$BATS_TEST_TMPDIR/ran"; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [[ "$output" == *"Setup"* ]]
  [ ! -f "$WT/ran" ]
  [ ! -f "$BATS_TEST_TMPDIR/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir gaterun)/events.jsonl" ]
}

@test "Use allows a ready grok lane through the door (CMD spawns normally)" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.118"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun2 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

@test "Use with LANE_VENDOR unset is the frozen path -- no gate, CMD runs unconditionally" {
  # Deliberately no grok shim at all: the frozen (LANE_VENDOR-unset) path
  # must never probe readiness, so an absent/broken grok cannot block it.
  run bash "$SCRIPTS/lane-run.sh" gaterun3 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}
