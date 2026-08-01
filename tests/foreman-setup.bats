#!/usr/bin/env bats
# @description Coverage for lifecycle-three-stage Task 3: foreman-setup.sh, the
#   Setup & Environment stage wrapper. Shim-based, per auth-probes.md's
#   empirical findings (Task 0): the fake grok binary answers --version and
#   the real auth probe (`grok models`) the same way the real CLI does --
#   exit 0 either way, auth signal carried in stdout text -- rather than the
#   plan's illustrative (and, for grok, inaccurate) bare exit-code template.
load helpers

setup() {
  setup_tmp_repo
  # These lifecycle tests predate the WSL launcher build and exercise only
  # readiness/auth/config behavior. Keep their real-checkout calls read-only;
  # wsl-launcher-shipped.bats owns the forced-WSL build fixtures.
  export FOREMAN_WSL_FORCE=0
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
}

@test "setup marks grok NOT-READY and refuses (no auto-login) when unsigned" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  login)
    echo "SETUP-SHOULD-NOT-CALL-LOGIN" > "$BATS_TEST_TMPDIR/login-called"
    exit 0
    ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/foreman-setup.sh" --profile soft
  [ "$status" -ne 0 ]
  [[ "$output" == *"grok"*"NOT-READY"* ]]
  [[ "$output" == *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/login-called" ]
}

@test "setup is idempotent: two runs on an authenticated grok lane both report READY, unchanged" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  # --lane scopes the verdict to grok alone (see foreman-setup.sh header): a
  # fresh worktree checkout's own foreman_skill/codex/claude ambient state is
  # irrelevant noise for THIS assertion -- only grok's own readiness matters.
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  first_status="$status"
  # Strip the "time: ..." line (tool-check.sh stamps a fresh wall-clock
  # timestamp every run by design -- that is expected to differ between the
  # two invocations below; idempotency means the VERDICT is unchanged, not
  # that the report is byte-identical down to its timestamp).
  first_output="$(grep -v '^time: ' <<<"$output")"
  [ "$first_status" -eq 0 ]
  [[ "$first_output" == *"SETUP: READY"* ]]

  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  second_output="$(grep -v '^time: ' <<<"$output")"
  [ "$status" -eq 0 ]
  [[ "$second_output" == *"SETUP: READY"* ]]
  if [ "$second_output" != "$first_output" ]; then
    echo "idempotence broken: the two reports differ (time: lines already stripped)" >&2
    echo "--- first run" >&2
    printf '%s\n' "$first_output" >&2
    echo "--- second run" >&2
    printf '%s\n' "$second_output" >&2
    echo "--- unified diff (< first, > second)" >&2
    diff <(printf '%s\n' "$first_output") <(printf '%s\n' "$second_output") >&2 || true
  fi
  [ "$second_output" = "$first_output" ]
}

@test "setup --lane grok reports NOT-READY for an unsigned grok lane, ignoring unrelated vendors" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  [ "$status" -ne 0 ]
  [[ "$output" == *"SETUP: NOT-READY"* ]]
  [[ "$output" == *"LANE_READY: grok=no"* ]]
}

@test "setup reports durable default drift without rewriting repository config" {
  fixture_scripts="$REPO/skills/foreman/scripts"
  mkdir -p "$fixture_scripts/lib" "$REPO/env" "$REPO/.foreman"
  cp "$SCRIPTS/foreman-setup.sh" "$fixture_scripts/"
  cp "$SCRIPTS/lib/common.sh" "$SCRIPTS/lib/config.sh" "$fixture_scripts/lib/"
  cat > "$REPO/env/tool-check.sh" <<'EOF'
#!/usr/bin/env bash
echo "fixture tool check"
EOF
  cat > "$REPO/.foreman/config.toml" <<'EOF'
[durable]
enabled = false
EOF
  before="$(sha256sum "$REPO/.foreman/config.toml" | awk '{print $1}')"

  run bash "$fixture_scripts/foreman-setup.sh" --profile soft

  [ "$status" -eq 0 ]
  [[ "$output" == *"durable.enabled=false"* ]]
  [[ "$output" == *"differs from the shipped"* ]]
  after="$(sha256sum "$REPO/.foreman/config.toml" | awk '{print $1}')"
  [ "$after" = "$before" ]
}
