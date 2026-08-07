# bats test data (mode 100644; run via `bats`, not as a legacy executable)
# @description Coverage for lifecycle-three-stage Tasks 1-2 + Sprint 3 R4B/R4B2:
#   env/tool-check.sh is a thin Node adapter; TypeScript tool-check + vendor-
#   preflight is the authority for grok/codex. Distinguishes not_authenticated
#   (positive signed-out) from degraded (unknown/timeout/unmatched), outdated,
#   missing, and ok. Lane-scoped LANE_READY gates on that status. Shim-based:
#   fake vendor CLIs on PATH; real node + tracked runtime artifact under the
#   repo. Shell TSV-framing regressions are replaced by TypeScript boundary
#   tests in packages/orchestration/src/tool-check-run.test.ts (vendor binding,
#   projection, detail bounds) — the shell framing/NUL parser was deleted with
#   the shell domain logic.
load helpers

setup() {
  setup_tmp_repo
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
  TC="$BATS_TEST_DIRNAME/../env/tool-check.sh"
  # Capability-floor versions for ready fixtures (R4B):
  # Claude 2.1.220, Codex 0.146.0, Grok 0.2.118.
  GROK_FLOOR="0.2.118"
  CODEX_FLOOR="0.146.0"
}

@test "tool-check reports grok not_authenticated when installed but not signed in" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  login|update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"not_authenticated"* ]]
  [[ "$output" == *"NOT_AUTHENTICATED: grok"* ]]
  [[ "$output" == *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check reports grok ok when installed and signed in at floor" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  login|update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"ok"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check reports codex not_authenticated when installed but not signed in" {
  cat > "$SHIM/codex" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "codex-cli ${CODEX_FLOOR}"; exit 0 ;;
  login)
    if [[ "\$2" == "status" ]]; then
      echo "Not logged in"
      exit 1
    fi
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/codex"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"codex"*"not_authenticated"* ]]
  [[ "$output" == *"NOT_AUTHENTICATED:"*"codex"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check omits the unsupported claude readiness row even when claude is installed" {
  cat > "$SHIM/claude" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "2.1.220 (Claude Code)"; exit 0 ;;
  auth) [[ "$2" == "status" ]] && { echo '{"loggedIn":false}'; exit 1; }; exit 1 ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/claude"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  ! grep -Eq '^claude[[:space:]]+(ok|missing|not_authenticated)' <<<"$output"
  [[ "$output" != *"NOT_AUTHENTICATED:"*"claude"* ]]
}

@test "tool-check rejects --lane claude with the T7 decision" {
  run bash "$TC" --profile soft --lane claude
  [ "$status" -eq 2 ]
  [[ "$output" == *"T7 removed claude lane advertising because isolated HOME is unverified"* ]]
}

@test "tool-check --json emits a not_authenticated array alongside missing/outdated/degraded" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --json
  [ "$status" -ne 0 ]
  echo "$output" | jq -e '.not_authenticated | index("grok")' >/dev/null
}

# --- Task 2: lane-scoped readiness verdict ---

@test "tool-check --lane grok gates on grok auth state (not_authenticated -> no)" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--version" ]] && { echo "grok ${GROK_FLOOR}"; exit 0; }
echo "You are not authenticated."
exit 0
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane grok
  [[ "$output" == *"LANE_READY: grok=no"* ]]
}

@test "tool-check --lane grok gates on grok auth state (ok -> yes)" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--version" ]] && { echo "grok ${GROK_FLOOR}"; exit 0; }
echo "You are logged in with grok.com."
exit 0
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane grok
  [[ "$output" == *"LANE_READY: grok=yes"* ]]
  [[ "$output" == *"grok"*"ok"* ]]
}

@test "tool-check --lane codex gates on codex auth state" {
  cat > "$SHIM/codex" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--version" ]] && { echo "codex-cli ${CODEX_FLOOR}"; exit 0; }
[[ "\$1" == "login" && "\$2" == "status" ]] && { echo "Not logged in"; exit 1; }
exit 1
EOF
  chmod +x "$SHIM/codex"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane codex
  [[ "$output" == *"LANE_READY: codex=no"* ]]
}

@test "tool-check default output (no --lane) is unchanged: no LANE_READY line" {
  run env PATH="$PATH" bash "$TC" --profile soft
  [[ "$output" != *"LANE_READY:"* ]]
}

# --- Sprint 3 R4B: unknown must not collapse to signed-out ---

@test "tool-check reports grok degraded for unmatched auth banner without login hint" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "Error: leader socket unavailable"; exit 0 ;;
  login|update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"degraded"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
  [[ "$output" != *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check reports grok degraded for auth timeout without login hint" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) sleep 30; echo "too late"; exit 0 ;;
  login|update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"degraded"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
  [[ "$output" != *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check reports codex degraded for unrecognized nonzero auth without login hint" {
  cat > "$SHIM/codex" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "codex-cli ${CODEX_FLOOR}"; exit 0 ;;
  login)
    if [[ "\$2" == "status" ]]; then
      echo "internal error: backend 503"
      exit 3
    fi
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/codex"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"codex"*"degraded"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"codex"* ]]
  # Must not report not_authenticated; diagnose text may mention re-running
  # "codex login status" but must not collapse to a signed-out login hint.
  ! grep -Eq 'codex[[:space:]]+not_authenticated' <<<"$output"
  ! grep -Eq 'run: codex login([[:space:]]|$)' <<<"$output"
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check reports outdated for old but authenticated vendor, not not_authenticated" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.100"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  login|update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"outdated"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
  [[ "$output" != *"grok login --device-code"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}

@test "tool-check distinguishes a tracer that did not run from an inconclusive trace" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) exit 1 ;;
esac
EOF
  cat > "$SHIM/codex" <<EOF
#!/usr/bin/env bash
case "\$1 \$2" in
  "--version ") echo "codex-cli ${CODEX_FLOOR}"; exit 0 ;;
  "login status") exit 0 ;;
  *) exit 1 ;;
esac
EOF
  cat > "$SHIM/strace" <<'EOF'
#!/usr/bin/env bash
echo "strace: forced attach failure" >&2
exit 125
EOF
  chmod +x "$SHIM/grok" "$SHIM/codex" "$SHIM/strace"

  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --json

  mkdir_row="$(jq -c '.lock_atomicity[] | select(.mechanism == "mkdir")' <<<"$output")"
  [ "$(jq -r '.verdict' <<<"$mkdir_row")" = "unknown" ]
  [ "$(jq -r '.evidence_class' <<<"$mkdir_row")" = "syscall" ]
  [[ "$(jq -r '.notes' <<<"$mkdir_row")" == *"tracer did not run"* ]]
  [[ "$(jq -r '.notes' <<<"$mkdir_row")" == *"exit=125"* ]]
}

@test "tool-check reads mkdir syscalls from the dedicated strace output" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) exit 1 ;;
esac
EOF
  cat > "$SHIM/codex" <<EOF
#!/usr/bin/env bash
case "\$1 \$2" in
  "--version ") echo "codex-cli ${CODEX_FLOOR}"; exit 0 ;;
  "login status") exit 0 ;;
  *) exit 1 ;;
esac
EOF
  cat > "$SHIM/strace" <<'EOF'
#!/usr/bin/env bash
trace_file=""
last_arg=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      trace_file="$2"
      shift 2
      ;;
    *)
      last_arg="$1"
      shift
      ;;
  esac
done
if [[ -z "$trace_file" ]]; then
  echo "strace: expected -o FILE" >&2
  exit 125
fi
# Keep an "n" in the target path. In grep ERE, [^\n] excludes the literal
# letter n rather than matching any non-newline character.
printf 'mkdir("/tmp/contains-n/x", 0777) = -1 EEXIST (File exists)\n' >"$trace_file"
printf '+++ exited with 1 +++\n' >>"$trace_file"
echo 'tracee stderr noise: mkdir("/interleaved' >&2
exit 1
EOF
  chmod +x "$SHIM/grok" "$SHIM/codex" "$SHIM/strace"

  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --json

  mkdir_row="$(jq -c '.lock_atomicity[] | select(.mechanism == "mkdir")' <<<"$output")"
  [ "$(jq -r '.verdict' <<<"$mkdir_row")" = "atomic" ]
  [ "$(jq -r '.evidence_class' <<<"$mkdir_row")" = "syscall" ]
  [[ "$(jq -r '.notes' <<<"$mkdir_row")" == *"kernel returned EEXIST"* ]]
}

@test "tool-check never falls back to shell vendor_authed probes" {
  # Static contract: the thin adapter has no domain logic and no shell
  # vendor probes for grok/codex. TypeScript is the only authority.
  ! grep -q 'vendor_authed' "$TC"
  ! grep -Eq 'grok models|codex login status' "$TC"
  ! grep -Eq 'grok --version|codex --version' "$TC"
  # Closed thin-adapter grammar: exec node bundle only.
  grep -q 'skills/foreman/runtime/dist/tool-check.js' "$TC"
  grep -q 'exec "\$NODE" "\$BUNDLE" "\$@"' "$TC"
}

@test "thin adapter has exactly six non-comment productions" {
  # Architecture policy inspectLegacyAdapter closed grammar:
  # blank/comment lines ignored, but shebang (#!) counts as a production.
  mapfile -t lines < <(awk '
    /^#!/ { print; next }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    { print }
  ' "$TC")
  [ "${#lines[@]}" -eq 6 ]
  [[ "${lines[0]}" == "#!/usr/bin/env bash" ]]
  [[ "${lines[1]}" == "set -euo pipefail" ]]
  [[ "${lines[2]}" == ROOT=* ]]
  [[ "${lines[3]}" == NODE=* ]]
  [[ "${lines[4]}" == BUNDLE=*tool-check.js\" ]]
  [[ "${lines[5]}" == 'exec "$NODE" "$BUNDLE" "$@"' ]]
}

@test "TypeScript and shell adapter agree on soft lane grok for signed-out shim" {
  cat > "$SHIM/grok" <<EOF
#!/usr/bin/env bash
case "\$1" in
  --version) echo "grok ${GROK_FLOOR}"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;
  login|update)
    echo "TEST-MUST-NOT-MUTATE" > "$BATS_TEST_TMPDIR/mutate-called"
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  BUNDLE="$BATS_TEST_DIRNAME/../skills/foreman/runtime/dist/tool-check.js"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane grok
  shell_out="$output"
  shell_st="$status"
  run env PATH="$SHIM:$PATH" node "$BUNDLE" --profile soft --lane grok
  [ "$status" -eq "$shell_st" ]
  [[ "$output" == *"LANE_READY: grok=no"* ]]
  [[ "$shell_out" == *"LANE_READY: grok=no"* ]]
  [[ "$output" == *"not_authenticated"* ]]
  [ ! -f "$BATS_TEST_TMPDIR/mutate-called" ]
}
