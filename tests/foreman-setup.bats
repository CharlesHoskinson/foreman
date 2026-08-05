# bats test data (mode 100644; run via `bats`, not as a legacy executable)
# @description Coverage for lifecycle-three-stage Task 3 + Sprint 3 R4C2:
#   foreman-setup Setup stage (Node TypeScript). Login instructions print only
#   for positive signed-out (not_authenticated). Unknown/degraded must not
#   instruct login. Setup never runs login or update. Capability-floor versions
#   for ready fixtures: Grok 0.2.118. Setup persists vendor-preflight records
#   under FOREMAN_HOME/preflight/<vendor>.json.
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
  # Isolate preflight persistence from the operator home.
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  # GitHub setup-node installs Node outside /usr/bin:/bin. Keep a node-only
  # directory on PATH so the thin adapter can start without ambient tools.
  NODE_BIN="$(command -v node)"
  NODE_ONLY="$BATS_TEST_TMPDIR/node-only"
  mkdir -p "$NODE_ONLY"
  ln -sfn "$NODE_BIN" "$NODE_ONLY/node"
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
  run env PATH="$SHIM:$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    bash "$SCRIPTS/foreman-setup.sh" --profile soft
  [ "$status" -ne 0 ]
  [[ "$output" == *"grok"*"NOT-READY"* ]]
  [[ "$output" == *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/login-called" ]
  [ ! -f "$BATS_TEST_TMPDIR/update-called" ]
  # R4C2: not-ready record persisted before exit 1
  [ -f "$FOREMAN_HOME/preflight/grok.json" ]
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
  # --lane scopes the verdict to grok alone (see Setup SCOPING): a
  # fresh worktree checkout's own foreman_skill/codex/claude ambient state is
  # irrelevant noise for THIS assertion -- only grok's own readiness matters.
  run env PATH="$SHIM:$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  first_status="$status"
  # Strip the "time: ..." line (tool-check stamps a fresh wall-clock
  # timestamp every run by design -- that is expected to differ between the
  # two invocations below; idempotency means the VERDICT is unchanged, not
  # that the report is byte-identical down to its timestamp).
  first_output="$(grep -v '^time: ' <<<"$output")"
  [ "$first_status" -eq 0 ]
  [[ "$first_output" == *"SETUP: READY"* ]]

  run env PATH="$SHIM:$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
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
  [ -f "$FOREMAN_HOME/preflight/grok.json" ]
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
  run env PATH="$SHIM:$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  [ "$status" -ne 0 ]
  [[ "$output" == *"SETUP: NOT-READY"* ]]
  [[ "$output" == *"LANE_READY: grok=no"* ]]
  [ -f "$FOREMAN_HOME/preflight/grok.json" ]
  # --lane scopes persist to that vendor only
  [ ! -f "$FOREMAN_HOME/preflight/codex.json" ]
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
  run env PATH="$SHIM:$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    bash "$SCRIPTS/foreman-setup.sh" --profile soft --lane grok
  [ "$status" -ne 0 ]
  [[ "$output" == *"SETUP: NOT-READY"* ]]
  [[ "$output" == *"grok"*"degraded"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
  # Setup only emits "v: NOT-READY -- run <login>" from NOT_AUTHENTICATED.
  [[ "$output" != *"grok: NOT-READY -- run grok login"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/login-called" ]
  # Unknown-auth record is still persisted for lane-gate.
  [ -f "$FOREMAN_HOME/preflight/grok.json" ]
}

@test "setup reports durable default drift without rewriting repository config" {
  # Unit tests own the durable TOML parser; this bats row proves the live
  # Setup CLI does not rewrite repository config. The thin adapter resolves
  # repo root from the bundled runtime (real checkout), so a fixture-local
  # config.toml cannot be injected here.
  real_root="$BATS_TEST_DIRNAME/.."
  cfg="$real_root/.foreman/config.toml"
  before="$(sha256sum "$cfg" 2>/dev/null | awk '{print $1}')"
  run env PATH="$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    FOREMAN_TEST_WSL_FORCE=0 \
    bash "$SCRIPTS/foreman-setup.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage:"* ]]
  after="$(sha256sum "$cfg" 2>/dev/null | awk '{print $1}')"
  [ "$after" = "$before" ]
}

@test "setup adapter exits 3 with sanitized diagnostic when node is missing" {
  # Curated PATH with shell helpers only — no node binary. Do not use the
  # node-only dir from setup(); absolute bash keeps the interpreter available.
  CORE="$BATS_TEST_TMPDIR/core-bin"
  mkdir -p "$CORE"
  for name in dirname pwd; do
    src="$(command -v "$name" || true)"
    if [ -n "$src" ]; then
      ln -sfn "$src" "$CORE/$name"
    fi
  done
  run env PATH="$CORE" FOREMAN_HOME="$FOREMAN_HOME" \
    /bin/bash "$SCRIPTS/foreman-setup.sh" --help
  [ "$status" -eq 3 ]
  [[ "$output" == *"foreman-setup: node is required"* ]]
  # Fixed diagnostic only — no absolute paths or stacks.
  [[ "$output" != *"/usr/"* ]]
  [[ "$output" != *"/home/"* ]]
  [[ "$output" != *"stack"* ]]
}

@test "setup adapter exits 3 with sanitized diagnostic when runtime bundle is missing" {
  BUNDLE="$BATS_TEST_DIRNAME/../skills/foreman/runtime/dist/foreman-setup.js"
  [ -f "$BUNDLE" ]
  BAK="$BATS_TEST_TMPDIR/foreman-setup.js.bak"
  mv "$BUNDLE" "$BAK"
  restore_bundle() { mv -f "$BAK" "$BUNDLE" 2>/dev/null || true; }
  trap restore_bundle EXIT
  run env PATH="$NODE_ONLY:/usr/bin:/bin" FOREMAN_HOME="$FOREMAN_HOME" \
    bash "$SCRIPTS/foreman-setup.sh" --help
  status_got="$status"
  output_got="$output"
  restore_bundle
  trap - EXIT
  [ "$status_got" -eq 3 ]
  [[ "$output_got" == *"foreman-setup: runtime bundle missing"* ]]
  [[ "$output_got" != *"/home/"* ]]
  [[ "$output_got" != *"stack"* ]]
}
