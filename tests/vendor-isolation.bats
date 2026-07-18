#!/usr/bin/env bats
# @description T5a (v0.2.5 vendor config isolation plumbing) coverage:
#   wt-new.sh's unconditional per-lane vendor-home provisioning, and
#   lane-run.sh's LANE_VENDOR/LANE_CONFIG_DIR env contract (default dir
#   resolution, explicit-override precedence, the ownership event's
#   config_dir key, and the Bun #12970 backslash-passthrough hazard).
#   Shim-based per spec constraint 4: a fake foreman-launch shim (mirrors
#   tests/lane-run.bats's own write_fake_launcher) plus one skip-guarded
#   real-binary case. No destructive real-vendor concurrency test here --
#   that is T5b (deferred; see docs/research/vendor-concurrency-results.md).
load helpers

# Mirrors tests/lane-run.bats's own setup(): a throwaway single-commit git
# worktree, durable-lanes intervals off (deterministic, no background
# heartbeat/checkpoint loop), and FOREMAN_LAUNCH neutralized to a
# guaranteed-nonexistent path so every test starts on the frozen
# launcher-absent branch unless it explicitly re-exports FOREMAN_LAUNCH or
# PATH-shims `foreman-launch` itself. Also unsets the vendor-isolation env
# vars this whole file exercises, so no test's outcome depends on whatever
# happened to be set in the ambient environment that invoked bats.
setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
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
}

# @description Deterministic fake foreman-launch shim (same shape as
#   tests/lane-run.bats's write_fake_launcher, trimmed to what this file
#   needs): parses --heartbeat-file/--heartbeat-interval/`-- CMD`, emits one
#   synthetic heartbeat line before running CMD (mirroring the real
#   launcher's "first heartbeat fires immediately at spawn" contract), then
#   runs CMD with whatever environment IT was invoked with -- bash's normal
#   child-inherits-parent-env behavior, nothing special. That is precisely
#   what makes this shim a useful regression test for the backslash hazard
#   even though it cannot reproduce the actual Bun #12970 bug itself (it is
#   not a Bun binary): it proves lane-run.sh's own export + its
#   `env -u LD_PRELOAD ...` launcher-invocation wrapper never mangles the
#   value before CMD ever sees it. The skip-guarded real-binary test further
#   down is what actually exercises the Bun code path.
# @arg $1 dir directory to write the shim into (caller adds it to PATH, or
#   points FOREMAN_LAUNCH directly at DIR/foreman-launch)
write_fake_launcher() {
  local dir="$1"
  cat > "$dir/foreman-launch" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
hb=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --heartbeat-file) hb="$2"; shift 2 ;;
    --heartbeat-interval) shift 2 ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
launcher_pid=$$
child_pid=$((launcher_pid + 1000))
job_id="job-$child_pid"
write_hb() {
  [[ -z "$hb" ]] && return 0
  local alive="$1" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","launcher_pid":%d,"pid":%d,"job_id":"%s","alive":%s,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}\n' \
    "$ts" "$launcher_pid" "$child_pid" "$job_id" "$alive" >> "$hb"
}
write_hb true
"$@" < /dev/null &
cmd_pid=$!
wait "$cmd_pid"
rc=$?
write_hb false
exit "$rc"
SHIM
  chmod +x "$dir/foreman-launch"
}

# ---------------------------------------------------------------------
# wt-new.sh: unconditional per-lane vendor-home provisioning
# ---------------------------------------------------------------------

@test "wt-new provisions empty vendor-home dirs for grok/codex/claude and prints their paths" {
  setup_tmp_repo
  cd "$REPO"
  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]
  wt="${lines[-1]}"
  [ -d "$wt/.harness/vendor-home/grok" ]
  [ -d "$wt/.harness/vendor-home/codex" ]
  [ -d "$wt/.harness/vendor-home/claude" ]
  # Empty on purpose (T5b, deferred, is what seeds real vendor config content).
  [ -z "$(ls -A "$wt/.harness/vendor-home/grok")" ]
  [ -z "$(ls -A "$wt/.harness/vendor-home/codex")" ]
  [ -z "$(ls -A "$wt/.harness/vendor-home/claude")" ]
  # Paths printed via log() (stderr; bats' `run` captures it into $output).
  [[ "$output" == *"vendor-home (grok): $wt/.harness/vendor-home/grok"* ]]
  [[ "$output" == *"vendor-home (codex): $wt/.harness/vendor-home/codex"* ]]
  [[ "$output" == *"vendor-home (claude): $wt/.harness/vendor-home/claude"* ]]
}

# ---------------------------------------------------------------------
# lane-run.sh: LANE_VENDOR unset -> frozen path, byte-identical
# ---------------------------------------------------------------------

@test "lane-run (LANE_VENDOR unset, launcher absent -- frozen default): no vendor env reaches CMD" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'env | grep -E "^(GROK_HOME|CODEX_HOME|CLAUDE_CONFIG_DIR)=" > "'"$WT"'/env-dump" || true'
  [ "$status" -eq 0 ]
  [ ! -s "$WT/env-dump" ]
}

@test "lane-run (LANE_VENDOR unset, launcher present): ownership.config_dir stays null, no vendor env reaches CMD" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'env | grep -E "^(GROK_HOME|CODEX_HOME|CLAUDE_CONFIG_DIR)=" > "'"$WT"'/env-dump" || true'
  [ "$status" -eq 0 ]
  [ ! -s "$WT/env-dump" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "null" ]
}

@test "lane-run rejects an unknown LANE_VENDOR before spawning CMD or touching the lock" {
  export LANE_VENDOR=bogus-vendor
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'echo should-not-run > "'"$WT"'/should-not-exist"'
  [ "$status" -eq 2 ]
  [ ! -f "$WT/should-not-exist" ]
  [ ! -d "$WT/.harness/lane.lock" ]
  [ ! -f "$(run_dir run1)/events.jsonl" ]
}

# ---------------------------------------------------------------------
# lane-run.sh: LANE_VENDOR set -- default dir resolution, explicit
# override, one env var per vendor, ownership.config_dir
# ---------------------------------------------------------------------

@test "lane-run (LANE_VENDOR=grok, LANE_CONFIG_DIR unset): GROK_HOME defaults to the wt-new-provisioned dir; ownership.config_dir matches" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  mkdir -p "$WT/.harness/vendor-home/grok"   # mirrors wt-new.sh's own provisioning
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$WT/.harness/vendor-home/grok"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$expected" ]
}

@test "lane-run (LANE_VENDOR=codex, explicit LANE_CONFIG_DIR): CODEX_HOME + ownership.config_dir use the override, not the default" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  export LANE_VENDOR=codex
  export LANE_CONFIG_DIR="$BATS_TEST_TMPDIR/custom-codex-home"
  mkdir -p "$LANE_CONFIG_DIR"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$CODEX_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/env-dump")" = "$LANE_CONFIG_DIR" ]
  [ "$LANE_CONFIG_DIR" != "$WT/.harness/vendor-home/codex" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$LANE_CONFIG_DIR" ]
}

@test "lane-run (LANE_VENDOR=claude): CLAUDE_CONFIG_DIR exported (third vendor mapping)" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  export LANE_VENDOR=claude
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$CLAUDE_CONFIG_DIR" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/env-dump")" = "$WT/.harness/vendor-home/claude" ]
}

@test "lane-run (LANE_VENDOR=grok, launcher-absent direct-spawn branch): GROK_HOME still reaches CMD without a launcher" {
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/env-dump")" = "$WT/.harness/vendor-home/grok" ]
}

# ---------------------------------------------------------------------
# Bun issue #12970: compiled Bun exes have stripped `\` from env var
# values on Windows in the past. LANE_CONFIG_DIR is frequently a
# backslashed Windows path -- it must reach CMD byte-for-byte.
# ---------------------------------------------------------------------

@test "lane-run (Bun #12970 regression, fake launcher shim): backslashed GROK_HOME (C:\\x\\y) reaches CMD verbatim" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  export LANE_VENDOR=grok
  export LANE_CONFIG_DIR='C:\x\y'
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  [ "$(cat "$WT/env-dump")" = 'C:\x\y' ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = 'C:\x\y' ]
}

# @description Skip-guarded real-binary counterpart: exercises the ACTUAL
#   compiled foreman-launch.exe (a Bun binary -- the only thing that can
#   really reproduce #12970) end to end through lane-run.sh's own
#   LANE_VENDOR plumbing, not just the bash fake shim above. Deliberately
#   checks file existence FIRST via a plain (non-canonicalized) path before
#   any `cd` -- unlike tests/launcher.bats's own setup(), which `cd`s into
#   launcher/dist unconditionally and hard-fails (rather than skipping) in
#   a fresh worktree where that directory does not exist at all yet (only
#   the exe file itself missing is guarded there, not the parent dir --
#   confirmed empirically in this worktree, out of scope to fix here since
#   launcher.bats is not a T5a file). Expected to SKIP on any host where
#   launcher/build.ps1 has not been run in THIS worktree.
@test "lane-run (Bun #12970, real compiled launcher): backslashed GROK_HOME reaches cmd.exe verbatim" {
  exe_rel="$BATS_TEST_DIRNAME/../launcher/dist/foreman-launch.exe"
  [ -f "$exe_rel" ] || skip "compiled exe not found at $exe_rel -- run: pwsh -File launcher/build.ps1"
  EXE="$(cd "$(dirname "$exe_rel")" && pwd)/foreman-launch.exe"
  export MSYS_NO_PATHCONV=1
  export FOREMAN_LAUNCH="$EXE"
  export LANE_VENDOR=grok
  export LANE_CONFIG_DIR='C:\vendor-iso-real\sub'
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- cmd /c "echo %GROK_HOME%"
  [ "$status" -eq 0 ]
  grep -qF 'C:\vendor-iso-real\sub' "$WT/.harness/stream.ndjson"
}
