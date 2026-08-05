# bats test data (run via `bats`, not as a product executable)
# @description Coverage for lifecycle-three-stage Task 5 / R4C: the Use-path
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
#   R4C: admission reads only the persisted preflight record (lane-gate).
#   Tests seed $FOREMAN_HOME/preflight/<vendor>.json rather than live probes.
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_ENABLED=false
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch-binary"
  unset LANE_VENDOR LANE_CONFIG_DIR GROK_HOME CODEX_HOME CLAUDE_CONFIG_DIR 2>/dev/null || true
  unset FOREMAN_VENDOR_PREFLIGHT_RECORD FOREMAN_VENDOR_PREFLIGHT_RUNTIME 2>/dev/null || true
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

# @description Write a valid ready grok preflight record for lane-gate.
write_ready_grok_record() {
  local path="${1:-$FOREMAN_HOME/preflight/grok.json}"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'EOF'
{
  "schemaVersion": 1,
  "vendor": "grok",
  "timestamp": "2026-08-04T15:00:00.000Z",
  "resolvedPath": "/usr/bin/grok",
  "reportedVersion": "0.2.118",
  "versionFloor": "0.2.118",
  "facts": {
    "discoverable": {
      "value": "discoverable",
      "evidenceClass": "probed",
      "reason": "CLI resolved on PATH"
    },
    "authenticated": {
      "value": "authenticated",
      "evidenceClass": "probed",
      "reason": "auth probe matched positive marker"
    },
    "current": {
      "value": "current",
      "evidenceClass": "probed",
      "reason": "reported version meets floor"
    }
  },
  "probes": [
    {
      "kind": "version",
      "argv": ["grok", "--version"],
      "outcome": "completed",
      "exitCode": 0
    },
    {
      "kind": "auth",
      "argv": ["grok", "models"],
      "outcome": "completed",
      "exitCode": 0
    }
  ],
  "remediation": { "kind": "none", "instruction": null }
}
EOF
}

# @description Write a valid not-authenticated grok preflight record.
write_not_ready_grok_record() {
  local path="${1:-$FOREMAN_HOME/preflight/grok.json}"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'EOF'
{
  "schemaVersion": 1,
  "vendor": "grok",
  "timestamp": "2026-08-04T15:00:00.000Z",
  "resolvedPath": "/usr/bin/grok",
  "reportedVersion": "0.2.118",
  "versionFloor": "0.2.118",
  "facts": {
    "discoverable": {
      "value": "discoverable",
      "evidenceClass": "probed",
      "reason": "CLI resolved on PATH"
    },
    "authenticated": {
      "value": "not-authenticated",
      "evidenceClass": "probed",
      "reason": "You are not authenticated."
    },
    "current": {
      "value": "current",
      "evidenceClass": "probed",
      "reason": "reported version meets floor"
    }
  },
  "probes": [
    {
      "kind": "version",
      "argv": ["grok", "--version"],
      "outcome": "completed",
      "exitCode": 0
    },
    {
      "kind": "auth",
      "argv": ["grok", "models"],
      "outcome": "completed",
      "exitCode": 0
    }
  ],
  "remediation": {
    "kind": "login",
    "instruction": "grok login --device-code"
  }
}
EOF
}

@test "Use refuses a not-ready grok lane at the door, citing Setup" {
  write_not_ready_grok_record
  run env LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [[ "$output" == *"Setup"* ]]
  [[ "$output" == *"You are not authenticated."* ]]
  [ ! -f "$WT/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir gaterun)/events.jsonl" ]
}

@test "Use allows a ready grok lane through the door (CMD spawns normally)" {
  write_ready_grok_record
  run env LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun2 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

@test "Use with LANE_VENDOR unset is the frozen path -- no gate, CMD runs unconditionally" {
  # Deliberately no preflight record: the frozen (LANE_VENDOR-unset) path
  # must never read readiness, so a missing record cannot block it.
  run bash "$SCRIPTS/lane-run.sh" gaterun3 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

@test "Use refuses when the preflight record is missing (fail closed, no live probe)" {
  # No record under FOREMAN_HOME/preflight — boundary failure stops the lane.
  run env LANE_VENDOR=grok bash "$SCRIPTS/lane-run.sh" gaterun4 lane-a "$WT" -- \
    bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [[ "$output" == *"Setup"* ]]
  [ ! -f "$WT/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
}
