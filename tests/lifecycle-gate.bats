# bats test data (run via `bats`, not as a product executable)
# @description Coverage for lifecycle-three-stage Task 5 / R4C3: the Use-path
#   readiness gate in lane-run.sh. Spec R1/R2 require Use to REFUSE routing
#   to a not-ready lane at the door -- not merely for Setup to report it.
#   R4C3 replaces the live tool-check probe with the persisted TypeScript
#   preflight record at $FOREMAN_HOME/preflight/<vendor>.json via the
#   tracked vendor-preflight lane-gate command. When LANE_VENDOR is set,
#   lane-run.sh MUST refuse to spawn CMD for a not-ready (or missing /
#   invalid) record BEFORE touching the worktree lock or emitting any event,
#   and MUST never start a live vendor probe or continue as unverified.
#   Unset LANE_VENDOR is the frozen v1 path (no gate).
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
  PROBE_LOG="$BATS_TEST_TMPDIR/live-probe.log"
  : > "$PROBE_LOG"
}

# @description Write one canonical ready grok preflight record under FOREMAN_HOME.
write_ready_grok_record() {
  mkdir -p "$FOREMAN_HOME/preflight"
  cat > "$FOREMAN_HOME/preflight/grok.json" <<'JSON'
{"facts":{"authenticated":{"evidenceClass":"declared","reason":"signed in","value":"authenticated"},"current":{"evidenceClass":"declared","reason":"meets floor","value":"current"},"discoverable":{"evidenceClass":"declared","reason":"CLI resolved","value":"discoverable"}},"probes":[{"argv":["grok","--version"],"exitCode":0,"kind":"version","outcome":"completed"},{"argv":["grok","models"],"exitCode":0,"kind":"auth","outcome":"completed"}],"remediation":{"instruction":null,"kind":"none"},"reportedVersion":"0.2.118","resolvedPath":"/usr/bin/grok","schemaVersion":1,"timestamp":"2026-08-04T15:00:00.000Z","vendor":"grok","versionFloor":"0.2.118"}
JSON
}

# @description Write one canonical not-ready grok preflight record (auth unknown).
write_not_ready_grok_record() {
  mkdir -p "$FOREMAN_HOME/preflight"
  cat > "$FOREMAN_HOME/preflight/grok.json" <<'JSON'
{"facts":{"authenticated":{"evidenceClass":"probed","reason":"auth probe timed out","value":"unknown"},"current":{"evidenceClass":"declared","reason":"meets floor","value":"current"},"discoverable":{"evidenceClass":"declared","reason":"CLI resolved","value":"discoverable"}},"probes":[{"argv":["grok","--version"],"exitCode":0,"kind":"version","outcome":"completed"},{"argv":["grok","models"],"exitCode":null,"kind":"auth","outcome":"timeout"}],"remediation":{"instruction":"Re-run bounded grok models","kind":"diagnose"},"reportedVersion":"0.2.118","resolvedPath":"/usr/bin/grok","schemaVersion":1,"timestamp":"2026-08-04T15:00:00.000Z","vendor":"grok","versionFloor":"0.2.118"}
JSON
}

# @description Trap executables that record any live vendor / tool-check probe.
install_live_probe_traps() {
  local marker="$PROBE_LOG"
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
printf 'grok %s\n' "\$*" >> "$marker"
exit 1
EOF
  cat > "$SHIM/codex" <<EOF
#!/usr/bin/env bash
printf 'codex %s\n' "\$*" >> "$marker"
exit 1
EOF
  cat > "$SHIM/tool-check.sh" <<EOF
#!/usr/bin/env bash
printf 'tool-check %s\n' "\$*" >> "$marker"
exit 1
EOF
  chmod +x "$SHIM/grok" "$SHIM/codex" "$SHIM/tool-check.sh"
}

@test "Use refuses a not-ready grok lane from the persisted record, before lock and events" {
  write_not_ready_grok_record
  install_live_probe_traps
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 2 ]
  [[ "$output" == *"auth probe timed out"* ]]
  [ ! -f "$WT/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir gaterun)/events.jsonl" ]
  [ ! -s "$PROBE_LOG" ]
}

@test "Use allows a ready grok lane through the door (CMD spawns normally)" {
  write_ready_grok_record
  install_live_probe_traps
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun2 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
  # R4C3 forbids live readiness probes (grok models, tool-check) on the ready
  # path. Post-admission telemetry may call grok --version via tl_model_identity;
  # that version call is not a vendor-readiness probe and is permitted.
  ! grep -q 'models' "$PROBE_LOG"
  ! grep -q 'tool-check' "$PROBE_LOG"
  if [[ -s "$PROBE_LOG" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == "grok --version" || "$line" == "codex --version" ]]
    done < "$PROBE_LOG"
  fi
}

@test "Use refuses a missing preflight record before lock, events, and live probes" {
  install_live_probe_traps
  # No $FOREMAN_HOME/preflight/grok.json
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun-miss lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 2 ]
  [ ! -f "$WT/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir gaterun-miss)/events.jsonl" ]
  [ ! -s "$PROBE_LOG" ]
}

@test "Use with LANE_VENDOR unset is the frozen path -- no gate, CMD runs unconditionally" {
  # Deliberately no preflight record and no grok shim: the frozen
  # (LANE_VENDOR-unset) path must never consult readiness.
  run bash "$SCRIPTS/lane-run.sh" gaterun3 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

@test "Use refuses --unowned with a missing record before unowned_dispatch event" {
  # Durable unowned emits unowned_dispatch; admission must refuse first so a
  # missing record never produces a durable side effect.
  export DURABLE_ENABLED=true
  install_live_probe_traps
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" \
    --unowned "stateful target fixture" gaterun-unowned-miss lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 2 ]
  [ ! -f "$WT/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir gaterun-unowned-miss)/events.jsonl" ]
  [ ! -s "$PROBE_LOG" ]
}

@test "Use refuses --unowned with a not-ready record before unowned_dispatch event" {
  export DURABLE_ENABLED=true
  write_not_ready_grok_record
  install_live_probe_traps
  run env PATH="$SHIM:$PATH" LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" \
    --unowned "stateful target fixture" gaterun-unowned-nr lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 2 ]
  [[ "$output" == *"auth probe timed out"* ]]
  [ ! -f "$WT/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir gaterun-unowned-nr)/events.jsonl" ]
  [ ! -s "$PROBE_LOG" ]
}
