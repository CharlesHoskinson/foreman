# bats test data (run via `bats`, not as a product executable)
# @description grok-lane-activation (v0.2.7.5 package 2) coverage.
#
#   Task 1 -- the grok arm of lane-run.sh's vendor map (T5a's
#   lane_vendor_env_var already maps grok->GROK_HOME; these are a
#   regression guard proving it end to end for THIS package, on both the
#   launcher-absent and launcher-present spawn branches, per the EARS spec's
#   "grok vendor-home reaches CMD and the ownership event" scenario).
#   Further tasks (secrets-refusal preflight, Setup-stage auth acceptance)
#   append to this same file -- see their own section headers below as they
#   land.
#
#   setup() mirrors tests/vendor-isolation.bats / tests/lifecycle-gate.bats:
#   a fresh single-commit git worktree, durable-lanes intervals off
#   (deterministic, no background heartbeat/checkpoint loop), and
#   FOREMAN_LAUNCH neutralized to a guaranteed-absent path so every test
#   starts on the frozen launcher-absent branch unless it explicitly
#   re-points FOREMAN_LAUNCH at a fake shim.
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_ENABLED=false
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch-binary"
  unset LANE_VENDOR LANE_CREDENTIAL_PROFILE LANE_CONFIG_DIR GROK_HOME CODEX_HOME CLAUDE_CONFIG_DIR 2>/dev/null || true
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
  # R4C3: default ready persisted records so tests not exercising refusal
  # do not depend on a live tool-check probe or host vendor sign-in.
  write_ready_preflight_record grok
  write_ready_preflight_record codex
}

# @description Write a canonical ready preflight record for vendor admission.
# @arg $1 vendor id (grok|codex)
write_ready_preflight_record() {
  local vendor="$1"
  mkdir -p "$FOREMAN_HOME/preflight"
  case "$vendor" in
    grok)
      cat > "$FOREMAN_HOME/preflight/grok.json" <<'JSON'
{"facts":{"authenticated":{"evidenceClass":"declared","reason":"signed in","value":"authenticated"},"current":{"evidenceClass":"declared","reason":"meets floor","value":"current"},"discoverable":{"evidenceClass":"declared","reason":"CLI resolved","value":"discoverable"}},"probes":[{"argv":["grok","--version"],"exitCode":0,"kind":"version","outcome":"completed"},{"argv":["grok","models"],"exitCode":0,"kind":"auth","outcome":"completed"}],"remediation":{"instruction":null,"kind":"none"},"reportedVersion":"0.2.118","resolvedPath":"/usr/bin/grok","schemaVersion":1,"timestamp":"2026-08-04T15:00:00.000Z","vendor":"grok","versionFloor":"0.2.118"}
JSON
      ;;
    codex)
      cat > "$FOREMAN_HOME/preflight/codex.json" <<'JSON'
{"facts":{"authenticated":{"evidenceClass":"declared","reason":"signed in","value":"authenticated"},"current":{"evidenceClass":"declared","reason":"meets floor","value":"current"},"discoverable":{"evidenceClass":"declared","reason":"CLI resolved","value":"discoverable"}},"probes":[{"argv":["codex","--version"],"exitCode":0,"kind":"version","outcome":"completed"},{"argv":["codex","login","status"],"exitCode":0,"kind":"auth","outcome":"completed"}],"remediation":{"instruction":null,"kind":"none"},"reportedVersion":"0.146.0","resolvedPath":"/usr/bin/codex","schemaVersion":1,"timestamp":"2026-08-04T15:00:00.000Z","vendor":"codex","versionFloor":"0.146.0"}
JSON
      ;;
    *)
      echo "write_ready_preflight_record: bad vendor $vendor" >&2
      return 1
      ;;
  esac
  write_profile_preflight_wrapper "$vendor"
}

# @description Bind the legacy record fixture to the default external profile.
# @arg $1 vendor id (grok|codex)
write_profile_preflight_wrapper() {
  local vendor="$1" profile_id="${1}-default" result identity wrapper_dir
  result="$(node "$SCRIPTS/../runtime/dist/credential-profile.js" init \
    --state-root "$FOREMAN_HOME" --worktree "$WT" \
    --profile "$profile_id" --vendor "$vendor")"
  identity="$(jq -er '.profileIdentity' <<<"$result")"
  wrapper_dir="$FOREMAN_HOME/credential-profiles/$profile_id/preflight"
  mkdir -p "$wrapper_dir"
  jq -cn --arg profileId "$profile_id" --arg profileIdentity "$identity" \
    --arg vendor "$vendor" --argjson record "$(cat "$FOREMAN_HOME/preflight/$vendor.json")" \
    '{schemaVersion:1,profileId:$profileId,profileIdentity:$profileIdentity,vendor:$vendor,record:$record}' \
    > "$wrapper_dir/$vendor.json"
  chmod 600 "$wrapper_dir/$vendor.json"
}

# @description Write a canonical not-ready grok preflight record (auth unknown).
write_not_ready_grok_record() {
  mkdir -p "$FOREMAN_HOME/preflight"
  cat > "$FOREMAN_HOME/preflight/grok.json" <<'JSON'
{"facts":{"authenticated":{"evidenceClass":"probed","reason":"auth probe timed out","value":"unknown"},"current":{"evidenceClass":"declared","reason":"meets floor","value":"current"},"discoverable":{"evidenceClass":"declared","reason":"CLI resolved","value":"discoverable"}},"probes":[{"argv":["grok","--version"],"exitCode":0,"kind":"version","outcome":"completed"},{"argv":["grok","models"],"exitCode":null,"kind":"auth","outcome":"timeout"}],"remediation":{"instruction":"Re-run bounded grok models","kind":"diagnose"},"reportedVersion":"0.2.118","resolvedPath":"/usr/bin/grok","schemaVersion":1,"timestamp":"2026-08-04T15:00:00.000Z","vendor":"grok","versionFloor":"0.2.118"}
JSON
  write_profile_preflight_wrapper grok
}

# @description Mirrors lane-run.sh's own lane_normalize_config_dir exactly
#   (see tests/vendor-isolation.bats's identical helper): `cygpath -m` when
#   available (mixed form, e.g. `C:/Users/x`), else the input unchanged.
# @arg $1 path
# @stdout normalized (or unchanged) path
norm() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

# @description Deterministic fake foreman-launch shim -- same shape as
#   tests/vendor-isolation.bats's own write_fake_launcher (each bats file in
#   this suite keeps its own independent copy by established convention).
# @arg $1 dir directory to write the shim into
write_fake_launcher() {
  local dir="$1"
  cat > "$dir/foreman-launch" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
hb=""
cap_file=""
probe_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --heartbeat-file) hb="$2"; shift 2 ;;
    --heartbeat-interval) shift 2 ;;
    --capability-file) cap_file="$2"; shift 2 ;;
    --require-containment) shift 2 ;;
    --probe-only) probe_only=1; shift ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
# Containment probe (2026-09-05): lane-run.sh probes the launcher once per
# round and refuses an implementation lane without a strong record. The shim
# reports a strong capability so vendor-home tests exercise the spawn path.
if [[ -n "$cap_file" ]]; then
  printf '{"schema":"foreman-launch-capability/1","tag":"Strong","kind":"posix_pidns_userns_strong","reason":"probe_ok","required":"any","flags":[],"detail":"fake shim","attempts":[],"launcher_pid":%d,"launcher_version":"fake","platform":"linux"}\n' "$$" > "$cap_file"
fi
if (( probe_only == 1 )); then exit 0; fi
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

# @description Historical live-probe grok shim. R4C3 admission no longer
#   invokes the vendor CLI; kept only so PATH-dependent tests can install a
#   trap that proves live probes do not run. Prefer write_ready_preflight_record.
# @arg $1 dir directory to write the shim into (caller prepends it to PATH)
write_authed_grok_shim() {
  local dir="$1"
  cat > "$dir/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.118"; exit 0 ;;
  --single) echo "FOREMAN_GROK_READY_V1"; exit 0 ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$dir/grok"
}

# ---------------------------------------------------------------------
# Task 1: vendor-home isolation arm for grok (regression guard -- T5a
# already shipped lane_vendor_env_var's grok arm; tests/vendor-isolation.bats
# already covers this vendor extensively, this file's copy is this package's
# own acceptance proof).
# ---------------------------------------------------------------------

@test "LANE_VENDOR=grok (launcher-absent branch, FOREMAN_LAUNCH absent): normalized GROK_HOME reaches CMD" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"   # Explicit legacy lane-run fixture. R7B2-B removes this default.
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm "$FOREMAN_HOME/credential-profiles/grok-default/homes/grok")"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
}

@test "LANE_VENDOR=grok (launcher-present, fake shim): GROK_HOME reaches CMD and the ownership event's config_dir matches" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  mkdir -p "$WT/.harness/vendor-home/grok"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run2 lane-a "$WT" -- \
    bash -c 'printf "%s" "$GROK_HOME" > "'"$WT"'/env-dump"'
  [ "$status" -eq 0 ]
  expected="$(norm "$FOREMAN_HOME/credential-profiles/grok-default/homes/grok")"
  [ "$(cat "$WT/env-dump")" = "$expected" ]
  events="$(run_dir run2)/events.jsonl"
  run jq -rc 'select(.type=="ownership") | .payload.config_dir' "$events"
  [ "$output" = "$expected" ]
}

# ---------------------------------------------------------------------
# Task 2 / R6: secrets-refusal preflight. An IN-LANE guard, DISTINCT from
# and running AFTER the package-1 Use-path readiness gate -- both apply to
# a grok lane. Domain logic is the TypeScript secret-scan runtime; the
# shell only forwards the absolute worktree root. Scoped to the worktree
# SOURCE: .harness/ scaffolding (vendor-home, lane.lock, heartbeat/stream
# files) is excluded, so provisioning that scaffolding never trips a false
# positive. Codex and unset-vendor paths remain byte-unaffected.
# ---------------------------------------------------------------------

# @description A deterministic, always-authenticated codex shim (mirrors
#   write_authed_grok_shim, codex's own exit-code-based auth contract) --
#   used only by the non-grok frozen-path test below, so that test's outcome
#   never depends on this host's ambient codex sign-in state.
# @arg $1 dir directory to write the shim into (caller prepends it to PATH)
write_authed_codex_shim() {
  local dir="$1"
  cat > "$dir/codex" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "codex-cli 0.146.0"; exit 0 ;;
  login)
    # Typed capability authority probes `codex login status`. Empty stdout
    # is classified empty_output → unknown, not authenticated. Mirror the
    # real CLI success line used by adapters.bats / live preflight.
    if [[ "${2:-}" == "status" ]]; then
      echo "Logged in using ChatGPT"
      exit 0
    fi
    exit 0
    ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$dir/codex"
}

@test "grok lane refuses a worktree containing .env" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  echo "SECRET=x" > "$WT/.env"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [ ! -f "$WT/ran" ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="alert") | .payload.kind' "$events"
  [[ "$output" == *"grok_secrets_refused"* ]]
}

@test "grok lane proceeds with only .env.example (CMD actually runs)" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  echo "SECRET=example" > "$WT/.env.example"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run2 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]           # non-vacuous: proves CMD ran on a clean worktree
}

@test "grok lane refuses a worktree containing a private key" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  { printf -- '-----BEGIN RSA PRIVATE KEY-----\n'
    printf 'MIIBOgIBAAJBAKj34GkxFhD91assdf90asdfa9sd8f7asdf9==\n'
    printf -- '-----END RSA PRIVATE KEY-----\n'
  } > "$WT/id_rsa"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run3 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [ ! -f "$WT/ran" ]
  events="$(run_dir run3)/events.jsonl"
  run jq -rc 'select(.type=="alert") | .payload.kind' "$events"
  [[ "$output" == *"grok_secrets_refused"* ]]
}

@test "grok lane permits documentation that mentions a private-key marker inline" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  printf '%s\n' \
    'The scanner rejects -----BEGIN RSA PRIVATE KEY----- when it starts a PEM line.' \
    'This sentence is documentation, not private-key material.' > "$WT/security-notes.md"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run9 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

# ---------------------------------------------------------------------
# Rework Round 1 (Opus audit): Nit A (pipefail-safe capture-then-test, no
# behavioral surface of its own to assert directly -- covered indirectly by
# every test in this file still passing) and Nit B (broadened filename net:
# .env.* variants at depth, plus common key filenames without requiring a
# PEM content match).
# ---------------------------------------------------------------------

@test "grok lane refuses a .env.local at subdirectory depth (proves the broadened glob + depth)" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  mkdir -p "$WT/sub/dir"
  echo "SECRET=x" > "$WT/sub/dir/.env.local"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run7 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [ ! -f "$WT/ran" ]
  events="$(run_dir run7)/events.jsonl"
  run jq -rc 'select(.type=="alert") | .payload.kind' "$events"
  [[ "$output" == *"grok_secrets_refused"* ]]
}

@test "grok lane refuses an id_rsa file with no PEM banner (proves the key-filename net, not just content grep)" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  echo "not a PEM banner, just plain text" > "$WT/id_rsa"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run8 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -ne 0 ]
  [ ! -f "$WT/ran" ]
  events="$(run_dir run8)/events.jsonl"
  run jq -rc 'select(.type=="alert") | .payload.kind' "$events"
  [[ "$output" == *"grok_secrets_refused"* ]]
}

@test "grok lane frozen path: .harness/ scaffolding itself never trips the secrets scan" {
  write_authed_grok_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/grok"
  # A dotfile sitting inside .harness/ scaffolding (foreman's own
  # bookkeeping, not source) must never be mistaken for a source secret.
  echo "SECRET=x" > "$WT/.harness/vendor-home/grok/.env"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run4 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

@test "frozen path: non-grok LANE_VENDOR is byte-unaffected by the secrets scan (codex proceeds despite .env)" {
  write_authed_codex_shim "$SHIM"
  export PATH="$SHIM:$PATH"
  mkdir -p "$WT/.harness/vendor-home/codex"
  echo "SECRET=x" > "$WT/.env"
  export LANE_VENDOR=codex
  run bash "$SCRIPTS/lane-run.sh" run5 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

@test "frozen path: unset LANE_VENDOR is byte-unaffected by the secrets scan (CMD runs despite .env)" {
  echo "SECRET=x" > "$WT/.env"
  run bash "$SCRIPTS/lane-run.sh" run6 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/ran" ]
}

# ---------------------------------------------------------------------
# Task 3 / R4C3: persisted not-ready refusal. lane-run.sh admits only via
# the stored preflight record. A valid not-ready record preserves its
# recorded reason unchanged; no live vendor probe and no mid-lane login.
# ---------------------------------------------------------------------

@test "grok Use route is refused from a not-ready persisted record -- no mid-lane auth attempt" {
  write_not_ready_grok_record
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  --single) echo "You are not authenticated."; exit 0 ;;
  login)
    echo "SETUP-SHOULD-NOT-CALL-LOGIN" > "$BATS_TEST_TMPDIR/login-called"
    exit 0
    ;;
  *)
    echo "SHOULD-NOT-RUN" > "$BATS_TEST_TMPDIR/ran"
    exit 1
    ;;
esac
EOF
  chmod +x "$SHIM/grok"
  export PATH="$SHIM:$PATH"
  export LANE_VENDOR=grok
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo RAN > "'"$WT"'/ran"'
  [ "$status" -eq 2 ]
  [[ "$output" == *"preflight_not_ready"* ]]
  [ ! -f "$WT/ran" ]
  [ ! -f "$BATS_TEST_TMPDIR/login-called" ]
  [ ! -f "$BATS_TEST_TMPDIR/ran" ]
  [ ! -d "$WT/.harness/lane.lock" ]
}
