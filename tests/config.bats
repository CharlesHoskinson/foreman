#!/usr/bin/env bats
# @description Tests for the shared [durable]/[nats] config loader
#   (skills/foreman/scripts/lib/config.sh): TOML-only resolution for all 14
#   known keys (v0.2.5 T8 adds durable.resume_max_attempts; v0.2.5 T4b adds
#   durable.starting_stale/impl_stale/verify_stale/grace), env-beats-TOML
#   precedence, defaults when neither is set, ~ expansion in nats.store_dir,
#   malformed-file fail-safe, and a TOML-only spot-check that lane-run.sh/
#   watch.sh each resolve one interval through the loader.
load helpers

setup() {
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/lib/config.sh"
  # Isolate from any config the real checkout happens to carry: every test
  # sets FOREMAN_CONFIG explicitly rather than relying on git-root detection.
  unset FOREMAN_CONFIG DURABLE_ENABLED DURABLE_CHECKPOINT_INTERVAL \
    DURABLE_HEARTBEAT_INTERVAL STALL_WARN STALL_DEAD RESUME_MAX_ATTEMPTS \
    STARTING_STALE IMPL_STALE VERIFY_STALE WATCH_GRACE \
    MERGE_BASE_MAX_COMMITS \
    NATS_URL NATS_STORE NATS_STREAM NATS_SUBJECT_PREFIX 2>/dev/null || true
}

# @description Write a TOML fixture with every known key set to a
#   non-default value, plus an unrelated array-valued section (mirrors this
#   repo's own .foreman/config.toml [gate] block) to prove sections outside
#   [durable]/[nats] are never inspected by this loader.
# @arg $1 path to write
write_full_toml() {
  cat > "$1" <<'EOF'
mode = "soft"

[durable]
enabled = true
checkpoint_interval = 5
heartbeat_interval = 7
stall_warn = 11
stall_dead = 13

[nats]
url = "nats://example.test:5222"
store_dir = "/tmp/custom-nats-store"
stream = "CUSTOMSTREAM"
subject_prefix = "custom"

[gate]
forbidden_paths = [
  "tests/**",
  ".github/**",
]
EOF
}

@test "(a) TOML-only: all 9 known keys resolve from TOML when no env vars are set" {
  toml="$BATS_TEST_TMPDIR/full.toml"
  write_full_toml "$toml"
  export FOREMAN_CONFIG="$toml"
  cfg_load
  [ "$(cfg_get durable enabled false)" = "true" ]
  [ "$(cfg_get durable checkpoint_interval 20)" = "5" ]
  [ "$(cfg_get durable heartbeat_interval 30)" = "7" ]
  [ "$(cfg_get durable stall_warn 300)" = "11" ]
  [ "$(cfg_get durable stall_dead 900)" = "13" ]
  [ "$(cfg_get nats url nats://127.0.0.1:4222)" = "nats://example.test:5222" ]
  [ "$(cfg_get nats store_dir '~/.foreman/nats-store')" = "/tmp/custom-nats-store" ]
  [ "$(cfg_get nats stream FOREMAN)" = "CUSTOMSTREAM" ]
  [ "$(cfg_get nats subject_prefix foreman)" = "custom" ]
}

@test "(a2) v0.2.5 T8: durable.resume_max_attempts resolves from TOML only (env unset)" {
  toml="$BATS_TEST_TMPDIR/resume.toml"
  cat > "$toml" <<'EOF'
[durable]
resume_max_attempts = 7
EOF
  export FOREMAN_CONFIG="$toml"
  cfg_load
  [ "$(cfg_get durable resume_max_attempts 2)" = "7" ]
}

@test "(a3) v0.2.5 T4b: starting_stale/impl_stale/verify_stale/grace resolve from TOML only (env unset)" {
  toml="$BATS_TEST_TMPDIR/t4b.toml"
  cat > "$toml" <<'EOF'
[durable]
starting_stale = 45
impl_stale = 150
verify_stale = 300
grace = 5
EOF
  export FOREMAN_CONFIG="$toml"
  cfg_load
  [ "$(cfg_get durable starting_stale 90)" = "45" ]
  [ "$(cfg_get durable impl_stale 300)" = "150" ]
  [ "$(cfg_get durable verify_stale 600)" = "300" ]
  [ "$(cfg_get durable grace 10)" = "5" ]
}

@test "(a4) v0.2.5 T6: durable.merge_base_max_commits resolves from TOML only (env unset)" {
  toml="$BATS_TEST_TMPDIR/t6.toml"
  cat > "$toml" <<'EOF'
[durable]
merge_base_max_commits = 12
EOF
  export FOREMAN_CONFIG="$toml"
  cfg_load
  [ "$(cfg_get durable merge_base_max_commits 50)" = "12" ]
}

@test "(b) env beats TOML; an unrelated key still resolves from TOML" {
  toml="$BATS_TEST_TMPDIR/full.toml"
  write_full_toml "$toml"
  export FOREMAN_CONFIG="$toml"
  export DURABLE_CHECKPOINT_INTERVAL=99
  export NATS_URL="nats://env-wins:1111"
  cfg_load
  [ "$(cfg_get durable checkpoint_interval 20)" = "99" ]
  [ "$(cfg_get nats url nats://127.0.0.1:4222)" = "nats://env-wins:1111" ]
  [ "$(cfg_get durable stall_warn 300)" = "11" ]
  [ "$(cfg_get nats stream FOREMAN)" = "CUSTOMSTREAM" ]
}

@test "(b2) v0.2.5 T4b: env beats TOML for the four new keys" {
  toml="$BATS_TEST_TMPDIR/t4b_env.toml"
  cat > "$toml" <<'EOF'
[durable]
starting_stale = 45
impl_stale = 150
verify_stale = 300
grace = 5
EOF
  export FOREMAN_CONFIG="$toml"
  export STARTING_STALE=61
  export VERIFY_STALE=601
  cfg_load
  [ "$(cfg_get durable starting_stale 90)" = "61" ]
  [ "$(cfg_get durable verify_stale 600)" = "601" ]
  # Unset-env keys still resolve from TOML, not the built-in default.
  [ "$(cfg_get durable impl_stale 300)" = "150" ]
  [ "$(cfg_get durable grace 10)" = "5" ]
}

@test "(b3) v0.2.5 T6: env beats TOML for durable.merge_base_max_commits" {
  toml="$BATS_TEST_TMPDIR/t6_env.toml"
  cat > "$toml" <<'EOF'
[durable]
merge_base_max_commits = 12
EOF
  export FOREMAN_CONFIG="$toml"
  export MERGE_BASE_MAX_COMMITS=99
  cfg_load
  [ "$(cfg_get durable merge_base_max_commits 50)" = "99" ]
}

@test "(c) defaults when neither env nor TOML supplies a value" {
  export FOREMAN_CONFIG="$BATS_TEST_TMPDIR/does-not-exist.toml"
  cfg_load
  [ "$(cfg_get durable enabled false)" = "false" ]
  [ "$(cfg_get durable checkpoint_interval 20)" = "20" ]
  [ "$(cfg_get durable heartbeat_interval 30)" = "30" ]
  [ "$(cfg_get durable stall_warn 300)" = "300" ]
  [ "$(cfg_get durable stall_dead 900)" = "900" ]
  [ "$(cfg_get durable starting_stale 90)" = "90" ]
  [ "$(cfg_get durable impl_stale 300)" = "300" ]
  [ "$(cfg_get durable verify_stale 600)" = "600" ]
  [ "$(cfg_get durable grace 10)" = "10" ]
  [ "$(cfg_get durable merge_base_max_commits 50)" = "50" ]
  [ "$(cfg_get nats url nats://127.0.0.1:4222)" = "nats://127.0.0.1:4222" ]
  [ "$(cfg_get nats store_dir '~/.foreman/nats-store')" = "$HOME/.foreman/nats-store" ]
  [ "$(cfg_get nats stream FOREMAN)" = "FOREMAN" ]
  [ "$(cfg_get nats subject_prefix foreman)" = "foreman" ]
}

@test "(d) ~ expansion in nats.store_dir: TOML value, env value, and default all expand" {
  toml="$BATS_TEST_TMPDIR/store.toml"
  cat > "$toml" <<'EOF'
[nats]
store_dir = "~/.foreman/from-toml"
EOF
  export FOREMAN_CONFIG="$toml"
  cfg_load
  [ "$(cfg_get nats store_dir '~/.foreman/nats-store')" = "$HOME/.foreman/from-toml" ]

  export NATS_STORE="~/.foreman/from-env"
  [ "$(cfg_get nats store_dir '~/.foreman/nats-store')" = "$HOME/.foreman/from-env" ]

  unset NATS_STORE
  export FOREMAN_CONFIG="$BATS_TEST_TMPDIR/does-not-exist.toml"
  cfg_load
  [ "$(cfg_get nats store_dir '~/.foreman/nats-store')" = "$HOME/.foreman/nats-store" ]
}

@test "(e) malformed TOML falls back to defaults with a warning, never aborts the caller" {
  toml="$BATS_TEST_TMPDIR/broken.toml"
  cat > "$toml" <<'EOF'
[durable]
enabled = true
checkpoint_interval = [1, 2, 3]
EOF
  export FOREMAN_CONFIG="$toml"
  err="$BATS_TEST_TMPDIR/cfg_load.err"
  cfg_load 2>"$err"
  [ "$(cfg_get durable enabled false)" = "false" ]
  [ "$(cfg_get durable checkpoint_interval 20)" = "20" ]
  grep -qi 'malformed' "$err"
  # Warn ONCE per process even across repeated cfg_load calls.
  cfg_load 2>>"$err"
  cfg_load 2>>"$err"
  [ "$(grep -c -i 'malformed' "$err")" -eq 1 ]
}

# bats test_tags=slow
@test "(f1) lane-run.sh resolves checkpoint_interval through the loader (TOML-only)" {
  setup_tmp_repo
  source "$SCRIPTS/lib/common.sh"
  toml="$BATS_TEST_TMPDIR/lane-run.toml"
  cat > "$toml" <<'EOF'
[durable]
checkpoint_interval = 1
heartbeat_interval = 0
EOF
  export FOREMAN_CONFIG="$toml"
  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo x > "$WT/f"
  git -C "$WT" add -A
  git -C "$WT" commit -qm base
  events="$(run_dir run1)/events.jsonl"
  # Generous headroom (not the bare 1.3s the sibling lane-run.bats
  # ordering-only test uses, which never actually asserts a checkpoint event
  # exists): the mid-run checkpoint tick must both fire AND let
  # ckpt_snapshot's git plumbing complete before CMD exits and the watcher is
  # reaped, which on a loaded host can itself take several seconds -- this
  # test's assertion is stricter than the sibling test (it requires the
  # checkpoint event to actually exist, not just correct ordering IF one
  # happens to appear). CMD polls for the checkpoint event itself (bounded,
  # not a fixed sleep) so it waits only as long as actually needed, capped at
  # ~30s.
  cmd_script="$BATS_TEST_TMPDIR/wait-for-checkpoint.sh"
  cat > "$cmd_script" <<CMDEOF
#!/usr/bin/env bash
echo tick1
for _ in \$(seq 1 150); do
  grep -q '"type":"checkpoint"' "$events" 2>/dev/null && break
  sleep 0.2
done
echo tick2
CMDEOF
  chmod +x "$cmd_script"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash "$cmd_script"
  [ "$status" -eq 0 ]
  run jq -rc 'select(.type=="checkpoint")' "$events"
  [ -n "$output" ]
}

@test "(f2) watch.sh resolves stall_dead through the loader (TOML-only)" {
  source "$SCRIPTS/watch.sh"
  toml="$BATS_TEST_TMPDIR/watch.toml"
  cat > "$toml" <<'EOF'
[durable]
stall_warn = 111
stall_dead = 222
EOF
  export FOREMAN_CONFIG="$toml"
  wd_resolve_config
  [ "$STALL_WARN" = "111" ]
  [ "$STALL_DEAD" = "222" ]
}
