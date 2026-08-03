#!/usr/bin/env bats
# @description Coverage for lifecycle-three-stage Tasks 1-2: env/tool-check.sh
#   distinguishes per-vendor NOT_AUTHENTICATED (installed but not signed in)
#   from missing/outdated/degraded/ok, in both report_text and report_json,
#   and a `--lane <vendor>` query gates a LANE_READY verdict on that vendor's
#   auth state. Shim-based (mirrors the plan's own template): a fake grok
#   binary on PATH that answers --version but fails the real auth probe
#   (auth-probes.md: `grok models`, grepped for "not authenticated" since
#   grok's own exit code never distinguishes signed-in/out -- see TC below).
load helpers

setup() {
  setup_tmp_repo
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
  TC="$BATS_TEST_DIRNAME/../env/tool-check.sh"
}

@test "tool-check reports grok not_authenticated when installed but not signed in" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are not authenticated."; exit 0 ;;   # real grok: exit 0 either way; text is the signal (auth-probes.md)
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"not_authenticated"* ]]
  [[ "$output" == *"NOT_AUTHENTICATED: grok"* ]]
}

@test "tool-check reports grok ok when installed and signed in" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"grok"*"ok"* ]]
  [[ "$output" != *"NOT_AUTHENTICATED:"*"grok"* ]]
}

@test "tool-check reports codex not_authenticated when installed but not signed in" {
  cat > "$SHIM/codex" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "codex-cli 0.144.5"; exit 0 ;;
  login) [[ "$2" == "status" ]] && { echo "Not logged in"; exit 1; }; exit 1 ;;
  *) echo "unrecognized" >&2; exit 1 ;;
esac
EOF
  chmod +x "$SHIM/codex"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft
  [[ "$output" == *"codex"*"not_authenticated"* ]]
  [[ "$output" == *"NOT_AUTHENTICATED:"*"codex"* ]]
}

@test "tool-check omits the unsupported claude readiness row even when claude is installed" {
  cat > "$SHIM/claude" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "2.1.214 (Claude Code)"; exit 0 ;;
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
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
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
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--version" ]] && { echo "grok 0.2.103"; exit 0; }
echo "You are not authenticated."
exit 0
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane grok
  [[ "$output" == *"LANE_READY: grok=no"* ]]
}

@test "tool-check --lane grok gates on grok auth state (ok -> yes)" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--version" ]] && { echo "grok 0.2.103"; exit 0; }
echo "You are logged in with grok.com."
exit 0
EOF
  chmod +x "$SHIM/grok"
  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane grok
  [[ "$output" == *"LANE_READY: grok=yes"* ]]
}

@test "tool-check --lane codex gates on codex auth state" {
  cat > "$SHIM/codex" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--version" ]] && { echo "codex-cli 0.144.5"; exit 0; }
[[ "$1" == "login" && "$2" == "status" ]] && { echo "Not logged in"; exit 1; }
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

@test "tool-check distinguishes a tracer that did not run from an inconclusive trace" {
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) exit 1 ;;
esac
EOF
  cat > "$SHIM/codex" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "--version ") echo "codex-cli 0.144.5"; exit 0 ;;
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
  cat > "$SHIM/grok" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "grok 0.2.103"; exit 0 ;;
  models) echo "You are logged in with grok.com."; exit 0 ;;
  *) exit 1 ;;
esac
EOF
  cat > "$SHIM/codex" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "--version ") echo "codex-cli 0.144.5"; exit 0 ;;
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
