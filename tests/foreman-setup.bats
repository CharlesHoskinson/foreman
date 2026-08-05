# bats test data (mode 100644; run via `bats`, not as a legacy executable)
# @description Coverage for lifecycle-three-stage Task 3 + Sprint 3 R4B:
#   foreman-setup.sh Setup stage. Login instructions print only for positive
#   signed-out (not_authenticated). Unknown/degraded must not instruct login.
#   Setup never runs login or update. Capability-floor versions for ready
#   fixtures: Grok 0.2.118.
load helpers

setup() {
  setup_tmp_repo
  # These lifecycle tests predate the WSL launcher build and exercise only
  # readiness/auth/config behavior. Keep their real-checkout calls read-only;
  # wsl-launcher-shipped.bats owns the forced-WSL build fixtures.
  export FOREMAN_TEST_WSL_FORCE=0
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
  GROK_FLOOR="0.2.118"
}

@test "setup marks grok NOT-READY and refuses (no auto-login) when unsigned" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  login)
    echo "SETUP-SHOULD-NOT-CALL-LOGIN" > "$BATS_TEST_TMPDIR/login-called"
    exit 0
    ;;
  update)
    echo "SETUP-SHOULD-NOT-CALL-UPDATE" > "$BATS_TEST_TMPDIR/update-called"
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
  [ ! -f "$BATS_TEST_TMPDIR/update-called" ]
}

@test "setup is idempotent: two runs on an authenticated grok lane both report READY, unchanged" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  login|update)
    echo "SETUP-SHOULD-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
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
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "setup --lane grok reports NOT-READY for an unsigned grok lane, ignoring unrelated vendors" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
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

@test "setup prints login instructions only for positive signed-out, not degraded unknown" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "Error: leader socket unavailable"; exit 0 ;;
  login)
    echo "SETUP-SHOULD-NOT-CALL-LOGIN" > "$BATS_TEST_TMPDIR/login-called"
    exit 0
    ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  [ "$status" -ne 0 ]
  [[ "$output" == *"SETUP: NOT-READY"* ]]
  [[ "$output" == *"grok"*"degraded"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
  # Setup only emits "v: NOT-READY -- run <login>" from NOT_AUTHENTICATED.
  [[ "$output" != *"grok: NOT-READY -- run grok login"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/login-called" ]
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
