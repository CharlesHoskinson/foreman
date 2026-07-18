#!/usr/bin/env bats
# @description Tests for lane-queue.sh. A PATH-shim fake `pueue`/`pueued`
#   pair (records argv to a log, returns canned/stateful output) drives the
#   ensure/add/status/kill logic deterministically without a live daemon.
#   LANE_QUEUE_FORCE_MISSING exercises the pueue-absent fallback path. ONE
#   test exercises the real staged pueue/pueued binaries end-to-end and is
#   skipped (with reason) when they are absent.
#
#   Rework Round 2: the live-daemon test now runs against a fully isolated,
#   test-owned pueue instance (own config/port/state under BATS_TEST_TMPDIR
#   via PUEUE_CONFIG_PATH) instead of the host's default (potentially
#   developer/CI-shared) daemon -- see _isolated_pueue_config and the
#   teardown() note below. It also proves the Round 2 quoting fix directly
#   against a real daemon (a quoted argument's exact text survives) and
#   kills a task verified Running beforehand, rather than racing an
#   almost-instant completion.
#
#   Rework Round 3: Round 2's quoting fix applied the PowerShell dialect
#   UNCONDITIONALLY, which is a hard syntax error (leading `&`) or silent
#   quote-deletion (`''` doubling) under a POSIX daemon. There are now TWO
#   shim flavors: the plain `pueue` (no extension, $SHIM_DIR) resolves as
#   POSIX per lq_is_windows_pueue, and `pueue.exe` ($SHIM_DIR_EXE) resolves
#   as Windows -- see _write_shim_pueue_body/_write_shim_pueue/
#   _write_shim_pueue_exe. One test also pipes the POSIX-quoted output
#   through a real `sh -c` (this host's Git Bash sh) to prove the round trip
#   actually works, not just that the escape sequence looks right by
#   inspection. setup() also pins PUEUE_CONFIG_PATH to a nonexistent file by
#   default so lq_shell_command_override's "no override" path is exercised
#   deterministically rather than incidentally depending on the real host's
#   own pueue config.
bats_require_minimum_version 1.5.0
load helpers

# @description Shared body for the fake `pueue` client shim, written to
#   whichever PATH entry a test wants to exercise (see _write_shim_pueue /
#   _write_shim_pueue_exe below -- Rework Round 3 needs BOTH a plain "pueue"
#   -- no extension, resolves as POSIX per lq_is_windows_pueue -- and a
#   "pueue.exe" -- resolves as Windows -- to exercise both quoting dialects
#   deterministically). Every invocation is appended to $SHIM_LOG as one
#   line, argv elements joined by \x1f (unit separator) so a test can assert
#   on the EXACT argv lane-queue.sh passed to `pueue add`. Daemon
#   reachability and per-group "already exists" state are modeled with
#   marker files under $SHIM_STATE so the ensure retry-loop and idempotency
#   logic can be exercised precisely. SHIM_STATUS_BAD_JSON=1 makes
#   `status --json` emit deliberately malformed JSON (pueue itself still
#   "succeeds", exit 0) so cmd_status's own jq filtering failure path
#   (Rework Round 1, F3) can be exercised deterministically.
# @arg $1 target_path file path to write the shim script to (chmod +x)
_write_shim_pueue_body() {
  cat > "$1" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'pueue'
  for a in "$@"; do printf '\x1f%s' "$a"; done
  printf '\n'
} >> "$SHIM_LOG"

sub="${1:-}"
case "$sub" in
  status)
    if [[ "${2:-}" == "--json" ]]; then
      if [[ -f "$SHIM_STATE/daemon_up" ]]; then
        if [[ "${SHIM_STATUS_BAD_JSON:-0}" == "1" ]]; then
          echo '{not valid json'
          exit 0
        fi
        echo '{"tasks":{"7":{"id":7,"status":{"Running":{}}}},"groups":{"default":{"status":"Running","parallel_tasks":1}}}'
        exit 0
      fi
      echo "Error: no daemon" >&2
      exit 1
    fi
    if [[ -f "$SHIM_STATE/daemon_up" ]]; then
      echo 'Group "default" (1 parallel): running'
      exit 0
    fi
    echo "Error: no daemon" >&2
    exit 1
    ;;
  group)
    if [[ "${2:-}" == "add" ]]; then
      name="${3:-}"
      marker="$SHIM_STATE/group.$name"
      if [[ -f "$marker" ]]; then
        echo "Group \"$name\" already exists" >&2
        exit 1
      fi
      : > "$marker"
      echo "New group \"$name\" has been created"
      exit 0
    fi
    exit 0
    ;;
  parallel)
    exit 0
    ;;
  add)
    n="$(cat "$SHIM_STATE/next_id" 2>/dev/null || echo 0)"
    echo $((n + 1)) > "$SHIM_STATE/next_id"
    echo "$n"
    exit 0
    ;;
  kill)
    echo "Tasks are being killed: ${2:-}"
    exit 0
    ;;
  shutdown)
    rm -f "$SHIM_STATE/daemon_up"
    echo "Daemon is shutting down"
    exit 0
    ;;
  *)
    echo "shim-pueue: unknown subcommand $sub" >&2
    exit 64
    ;;
esac
SHIM
  chmod +x "$1"
}

# @description Write the POSIX-flavor fake pueue client (no extension, no
#   "pueue.exe" sibling) to $SHIM_DIR/pueue -- lq_is_windows_pueue resolves
#   this as POSIX, so `add` must quote for `sh -c` (no leading `&`).
_write_shim_pueue() {
  _write_shim_pueue_body "$SHIM_DIR/pueue"
}

# @description Write the Windows-flavor fake pueue client (".exe" suffix) to
#   $SHIM_DIR_EXE/pueue.exe, in a SEPARATE directory from the POSIX shim so
#   the two never collide on the same PATH lookup -- lq_is_windows_pueue
#   resolves this as Windows, so `add` quotes for PowerShell (+ leading `&`).
_write_shim_pueue_exe() {
  mkdir -p "$SHIM_DIR_EXE"
  _write_shim_pueue_body "$SHIM_DIR_EXE/pueue.exe"
}

# @description Write a fake `pueued` daemon to $SHIM_DIR/pueued. `-d` marks
#   the daemon "up" (touches $SHIM_STATE/daemon_up) unless
#   SHIM_PUEUED_FAIL_TO_START=1 is set, letting a test simulate a daemon that
#   is spawned but never actually becomes reachable (the ensure
#   bounded-retry-exhausted / exit-1 path).
_write_shim_pueued() {
  cat > "$SHIM_DIR/pueued" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-d" ]]; then
  if [[ "${SHIM_PUEUED_FAIL_TO_START:-0}" != "1" ]]; then
    : > "$SHIM_STATE/daemon_up"
  fi
  echo "Pueued is now running in the background"
fi
exit 0
SHIM
  chmod +x "$SHIM_DIR/pueued"
}

# @description Independent reference implementation of PowerShell
#   single-quote-literal escaping (mirrors lq_pwsh_quote in lane-queue.sh,
#   but deliberately re-implemented here rather than sourced/called -- a test
#   that just re-invokes the function under test proves nothing about it).
#   Used to build the exact expected shim-log line for the quoting tests.
# @arg $1 token raw token to quote
# @stdout the PowerShell single-quoted literal
_ref_pwsh_quote() {
  printf "'%s'" "${1//\'/\'\'}"
}

# @description Independent reference implementation of POSIX single-quote
#   escaping (mirrors lq_posix_quote in lane-queue.sh, re-implemented rather
#   than sourced/called). Used to build the exact expected shim-log line for
#   the POSIX-dialect quoting tests, and to build a real, re-parseable
#   command line for the sh -c round-trip test (Rework Round 3).
# @arg $1 token raw token to quote
# @stdout the POSIX single-quoted literal, e.g. input `it's` -> `'it'\''s'`
_ref_posix_quote() {
  local q="'" esc="'\\''"
  printf "'%s'" "${1//$q/$esc}"
}

# @description Write a fully isolated pueue config (Rework Round 2, F3): own
#   port (derived from this test process's PID to reduce collisions with
#   any other concurrent lane's own isolated test instance) and own state
#   directory, both under BATS_TEST_TMPDIR. The state dir must be converted
#   to a real Windows path (`cygpath -m`) before being written into the YAML
#   -- pueued is a native Windows binary that parses this file itself, with
#   no MSYS path translation involved (unlike argv/env, which MSYS does
#   translate automatically at the process-spawn boundary). Sets the global
#   LIVE_DAEMON_CFG so teardown() can target the SAME isolated instance.
# @stdout nothing; sets $LIVE_DAEMON_CFG as a side effect
_isolated_pueue_config() {
  LIVE_DAEMON_CFG="$BATS_TEST_TMPDIR/pueue.yml"
  local state_dir="$BATS_TEST_TMPDIR/pueue-state"
  mkdir -p "$state_dir"
  local win_state_dir
  win_state_dir="$(cygpath -m "$state_dir")"
  local port=$((20000 + (BASHPID % 10000)))
  cat > "$LIVE_DAEMON_CFG" <<EOF
client:
  restart_in_place: false
  read_local_logs: true
  show_confirmation_questions: false
  edit_mode: toml
  show_expanded_aliases: false
  dark_mode: false
  max_status_lines: null
  status_time_format: '%H:%M:%S'
  status_datetime_format: |-
    %Y-%m-%d
    %H:%M:%S
daemon:
  pause_group_on_failure: false
  pause_all_on_failure: false
  compress_state_file: false
  callback: null
  env_vars: {}
  callback_log_lines: 10
  shell_command: null
shared:
  pueue_directory: $win_state_dir
  runtime_directory: null
  alias_file: null
  host: 127.0.0.1
  port: '$port'
  pid_path: null
  daemon_cert: null
  daemon_key: null
  shared_secret_path: null
profiles: {}
EOF
}

setup() {
  setup_tmp_repo
  cd "$REPO"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  SHIM_DIR="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM_DIR"
  SHIM_DIR_EXE="$BATS_TEST_TMPDIR/shim-exe"
  SHIM_STATE="$BATS_TEST_TMPDIR/shim-state"
  mkdir -p "$SHIM_STATE"
  SHIM_LOG="$SHIM_STATE/argv.log"
  : > "$SHIM_LOG"
  export SHIM_STATE SHIM_LOG
  _write_shim_pueue
  _write_shim_pueue_exe
  _write_shim_pueued
  PATH_WITH_SHIM="$SHIM_DIR:$PATH"
  PATH_WITH_EXE_SHIM="$SHIM_DIR_EXE:$PATH"
  PATH_NO_SHIM="$PATH"
  LIVE_DAEMON_CFG=""
  # Rework Round 3: pin PUEUE_CONFIG_PATH to a file that does not exist by
  # default, so lq_shell_command_override's "no override" path is exercised
  # deterministically. Without this, any test that never sets
  # PUEUE_CONFIG_PATH itself would fall through to reading the REAL host's
  # actual pueue config file -- which happens to also say
  # `shell_command: null` today, but a hermetic test should not depend on
  # that remaining true. Tests that need a specific config (the override
  # tests, the isolated live-daemon test) set PUEUE_CONFIG_PATH explicitly,
  # which takes precedence over this default.
  export PUEUE_CONFIG_PATH="$BATS_TEST_TMPDIR/no-such-pueue-config.yml"
}

teardown() {
  # Rework Round 1, F2: this used to shut down the REAL staged daemon after
  # EVERY test unconditionally, which would kill any pre-existing developer
  # pueued the shim-driven tests have no business touching (they never talk
  # to the real binary at all -- PATH_WITH_SHIM/PATH_WITH_EXE_SHIM make
  # `command -v pueue` resolve to a fake client first). Scope the real-daemon
  # shutdown
  # strictly to the live-daemon test, identified by its own description --
  # teardown() always runs (even if that test fails partway through), so this
  # is still a reliable cleanup net for it specifically, without being a
  # blanket hazard for every other test in the file.
  #
  # Rework Round 2, F3: the live-daemon test now runs an ISOLATED, test-owned
  # daemon (own config/port/state, see _isolated_pueue_config), never the
  # host's default/shared one. Shutting down MUST target that same isolated
  # config ($LIVE_DAEMON_CFG, set by the test body before it starts the
  # daemon) -- shutting down via the default config here would risk hitting
  # a completely unrelated, real developer/CI daemon if one happened to be
  # reachable on the default port at the time.
  if [[ "$BATS_TEST_DESCRIPTION" == "live daemon:"* && -n "${LIVE_DAEMON_CFG:-}" ]]; then
    local real_pueue="$HOME/.foreman/tools/pueue/pueue.exe"
    [[ -x "$real_pueue" ]] || real_pueue="$HOME/.foreman/tools/pueue/pueue"
    if [[ -x "$real_pueue" ]]; then
      PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" "$real_pueue" shutdown >/dev/null 2>&1 || true
    fi
  fi
}

# --- shim-driven tests (deterministic, no live daemon) ---

@test "ensure: spawns pueued when unreachable, creates the fixed group topology" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 0 ]
  [[ "$output" == *"ready"* ]]
  # daemon was (re)started via the shim
  [ -f "$SHIM_STATE/daemon_up" ]
  # all five groups created exactly once
  for g in grok codex claude misc gate; do
    [ -f "$SHIM_STATE/group.$g" ]
  done
  # parallelism set for grok/codex/claude/gate, and an EXPLICIT cap of 2 for
  # misc (Rework Round 1, F1 -- deliberate, not the inherited default of 1)
  grep -qF $'pueue\x1fparallel\x1f1\x1f--group\x1fgrok' "$SHIM_LOG"
  grep -qF $'pueue\x1fparallel\x1f1\x1f--group\x1fcodex' "$SHIM_LOG"
  grep -qF $'pueue\x1fparallel\x1f3\x1f--group\x1fclaude' "$SHIM_LOG"
  grep -qF $'pueue\x1fparallel\x1f1\x1f--group\x1fgate' "$SHIM_LOG"
  grep -qF $'pueue\x1fparallel\x1f2\x1f--group\x1fmisc' "$SHIM_LOG"
}

@test "ensure: idempotent re-run tolerates already-exists groups and still exits 0" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 0 ]
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 0 ]
  [[ "$output" == *"ready"* ]]
}

@test "ensure: daemon unreachable after bounded retry returns 1" {
  export SHIM_PUEUED_FAIL_TO_START=1
  run env PATH="$PATH_WITH_SHIM" SHIM_PUEUED_FAIL_TO_START=1 bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 1 ]
  [[ "$output" == *"unreachable"* ]]
  [ ! -f "$SHIM_STATE/daemon_up" ]
}

@test "add: POSIX dialect (default -- plain, non-.exe pueue binary), no leading &, prints CR-free task id" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" add grok -- echo 'hello world; rm -rf /' '$HOME' '&&x'
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  # Rework Round 3: the shim resolves via PATH with no ".exe" suffix (and no
  # "pueue.exe" sibling on disk anywhere) -- lq_is_windows_pueue classifies
  # this as a POSIX daemon, so `add` must quote for `sh -c`: NO leading "&"
  # (a hard POSIX syntax error), each token wrapped via the
  # close-quote/escaped-quote/reopen-quote idiom -- reconstructed here via an
  # INDEPENDENT reference quoting implementation (_ref_posix_quote), not by
  # calling the script's own function.
  local expect
  expect="pueue"$'\x1f'"add"$'\x1f'"--group"$'\x1f'"grok"$'\x1f'"--print-task-id"$'\x1f'"--"$'\x1f'"$(_ref_posix_quote echo)"$'\x1f'"$(_ref_posix_quote 'hello world; rm -rf /')"$'\x1f'"$(_ref_posix_quote '$HOME')"$'\x1f'"$(_ref_posix_quote '&&x')"
  run grep -F -- "$expect" "$SHIM_LOG"
  [ "$status" -eq 0 ]
  # no stray "&" call-operator token anywhere -- that would be a hard POSIX
  # syntax error (Round 2's bug, unconditional-PowerShell-transform)
  ! grep -qF $'--\x1f&\x1f' "$SHIM_LOG"
}

@test "add: POSIX dialect -- embedded single quotes use close/escape/reopen, NOT PowerShell doubling" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" add misc -- echo "it's a test"
  [ "$status" -eq 0 ]
  local expect
  expect="$(_ref_posix_quote echo)"$'\x1f'"$(_ref_posix_quote "it's a test")"
  run grep -F -- "$expect" "$SHIM_LOG"
  [ "$status" -eq 0 ]
  # the two dialects must actually differ for an embedded quote -- guards
  # against this test (and the fix) passing vacuously if POSIX quoting were
  # accidentally identical to PowerShell's doubling
  [[ "$(_ref_posix_quote "it's a test")" != "$(_ref_pwsh_quote "it's a test")" ]]
}

@test "add: POSIX-quoted command actually round-trips through a real sh -c (not just visual inspection)" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" add misc -- echo "spaced arg" "quote's here"
  [ "$status" -eq 0 ]
  # Reconstruct exactly what pueue's own space-join hands to `sh -c` (pueue
  # only ever joins with plain spaces -- see the script header) and prove it
  # actually re-parses correctly on a real POSIX shell (this host's Git Bash
  # /usr/bin/sh), not just that the escape sequence looks right by
  # inspection of the shim log alone.
  local joined
  joined="$(_ref_posix_quote echo) $(_ref_posix_quote "spaced arg") $(_ref_posix_quote "quote's here")"
  run sh -c "$joined"
  [ "$status" -eq 0 ]
  [ "$output" = "spaced arg quote's here" ]
}

@test "add: Windows dialect (.exe pueue binary) -- leading & call operator, doubled-quote escaping" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_EXE_SHIM" bash "$SCRIPTS/lane-queue.sh" add grok -- echo "it's a test"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  # Windows daemon (pueue.exe on PATH): PowerShell 5.1 default -- lq_pwsh_quote
  # + leading "&" call-operator, unchanged from Round 2, now reached only
  # when the resolved binary is actually classified as Windows.
  local expect
  expect="pueue"$'\x1f'"add"$'\x1f'"--group"$'\x1f'"grok"$'\x1f'"--print-task-id"$'\x1f'"--"$'\x1f'"&"$'\x1f'"$(_ref_pwsh_quote echo)"$'\x1f'"$(_ref_pwsh_quote "it's a test")"
  run grep -F -- "$expect" "$SHIM_LOG"
  [ "$status" -eq 0 ]
}

@test "add: fails fast (exit 2) when the daemon's shell_command override can't be classified" {
  : > "$SHIM_STATE/daemon_up"
  local cfg="$BATS_TEST_TMPDIR/override.yml"
  cat > "$cfg" <<'EOF'
daemon:
  shell_command: "fish -c"
EOF
  run --separate-stderr env PATH="$PATH_WITH_SHIM" PUEUE_CONFIG_PATH="$cfg" bash "$SCRIPTS/lane-queue.sh" add misc -- echo hi
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"shell_command"* ]]
  # refused to guess -- pueue itself must never have been invoked
  [ ! -s "$SHIM_LOG" ]
}

@test "add: an explicit null shell_command override is treated as no override (proceeds normally)" {
  : > "$SHIM_STATE/daemon_up"
  local cfg="$BATS_TEST_TMPDIR/null-override.yml"
  cat > "$cfg" <<'EOF'
daemon:
  shell_command: null
EOF
  run env PATH="$PATH_WITH_SHIM" PUEUE_CONFIG_PATH="$cfg" bash "$SCRIPTS/lane-queue.sh" add misc -- echo hi
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
}

@test "add: rejects an invalid GROUP without ever invoking pueue" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" add Bad_Group -- echo hi
  [ "$status" -eq 2 ]
  [ ! -s "$SHIM_LOG" ]
}

@test "add: usage error when the -- separator is missing" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" add grok echo hi
  [ "$status" -eq 2 ]
  [ ! -s "$SHIM_LOG" ]
}

@test "status: whole queue and single task id (present and absent)" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" status
  [ "$status" -eq 0 ]
  [[ "$output" == *'"7"'* ]]

  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" status 7
  [ "$status" -eq 0 ]
  [[ "$output" == *'"id":7'* ]]

  # absent task id tolerated -- empty object, not an error
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" status 999
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "status: single-task jq failure is caught explicitly, not a bare pipefail abort (F3)" {
  : > "$SHIM_STATE/daemon_up"
  run --separate-stderr env PATH="$PATH_WITH_SHIM" SHIM_STATUS_BAD_JSON=1 bash "$SCRIPTS/lane-queue.sh" status 7
  [ "$status" -eq 1 ]
  [ -n "$stderr" ]
}

@test "kill: passes TASK_ID through to pueue kill" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" kill 7
  [ "$status" -eq 0 ]
  [[ "$output" == *"killed: 7"* ]]
  grep -qF $'pueue\x1fkill\x1f7' "$SHIM_LOG"
}

@test "kill: usage error with no TASK_ID" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" kill
  [ "$status" -eq 2 ]
}

@test "kill: usage error on a non-numeric TASK_ID, never invokes pueue (F5)" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" kill 7abc
  [ "$status" -eq 2 ]
  [ ! -s "$SHIM_LOG" ]
}

@test "unknown subcommand and no-args are usage errors (exit 2)" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh"
  [ "$status" -eq 2 ]
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" bogus
  [ "$status" -eq 2 ]
}

# --- LANE_QUEUE_FORCE_MISSING fallback tests ---

@test "FORCE_MISSING: ensure exits 3 and never invokes pueue" {
  run env PATH="$PATH_WITH_SHIM" LANE_QUEUE_FORCE_MISSING=1 bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 3 ]
  [ ! -s "$SHIM_LOG" ]
}

@test "FORCE_MISSING: add runs CMD directly, prints direct, exits with CMD's code" {
  run --separate-stderr env PATH="$PATH_WITH_SHIM" LANE_QUEUE_FORCE_MISSING=1 bash "$SCRIPTS/lane-queue.sh" \
    add misc -- bash -c 'echo ran > "'"$BATS_TEST_TMPDIR"'/marker"; exit 9'
  [ "$status" -eq 9 ]
  [ -f "$BATS_TEST_TMPDIR/marker" ]
  [[ "$output" == *"direct"* ]]
  [[ "$stderr" == *"degraded direct-spawn (pueue absent)"* ]]
  [ ! -s "$SHIM_LOG" ]
}

@test "FORCE_MISSING: add emits the degraded marker exactly once" {
  run --separate-stderr env PATH="$PATH_WITH_SHIM" LANE_QUEUE_FORCE_MISSING=1 bash "$SCRIPTS/lane-queue.sh" \
    add misc -- true
  [ "$status" -eq 0 ]
  local n
  n="$(grep -c 'degraded direct-spawn (pueue absent)' <<< "$stderr")"
  [ "$n" -eq 1 ]
}

@test "FORCE_MISSING: status prints the degraded sentinel" {
  run env PATH="$PATH_WITH_SHIM" LANE_QUEUE_FORCE_MISSING=1 bash "$SCRIPTS/lane-queue.sh" status
  [ "$status" -eq 0 ]
  [ "$output" = '{"degraded":true}' ]
}

@test "FORCE_MISSING: kill is a usage error (nothing to kill)" {
  run env PATH="$PATH_WITH_SHIM" LANE_QUEUE_FORCE_MISSING=1 bash "$SCRIPTS/lane-queue.sh" kill 3
  [ "$status" -eq 2 ]
  [ ! -s "$SHIM_LOG" ]
}

# --- live daemon test (real staged binaries, skipped if absent) ---
#
# Rework Round 2: runs against a fully isolated, test-owned pueue instance
# (own config/port/state, see _isolated_pueue_config) so this test never
# reads, shares, or disturbs the host's default/shared daemon in either
# direction (tonight's ~40-task accumulated state on the shared daemon is
# itself pollution from prior runs this isolation now prevents). It also
# directly proves the Round 2 quoting fix against a REAL daemon (a quoted
# argument's exact text, including an embedded space and an embedded quote,
# survives byte-for-byte) and kills a task verified Running beforehand
# rather than racing an almost-instant completion (F4: the pre-fix version
# only ever passed by racing the quoting bug's instant failure).

@test "live daemon: isolated instance -- quoting survives a real round trip, kill targets a verified-Running task" {
  local real_pueue="$HOME/.foreman/tools/pueue/pueue.exe"
  local real_pueued="$HOME/.foreman/tools/pueue/pueued.exe"
  if [[ ! -x "$real_pueue" ]]; then
    real_pueue="$HOME/.foreman/tools/pueue/pueue"
  fi
  if [[ ! -x "$real_pueued" ]]; then
    real_pueued="$HOME/.foreman/tools/pueue/pueued"
  fi
  if [[ ! -x "$real_pueue" || ! -x "$real_pueued" ]]; then
    skip "real pueue/pueued binaries not staged at \$HOME/.foreman/tools/pueue"
  fi
  command -v cygpath >/dev/null 2>&1 || skip "cygpath not available to build the isolated pueue config"

  _isolated_pueue_config
  export PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG"

  run env PATH="$PATH_NO_SHIM" PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 0 ]

  # --- F4a: quoting survives a real PowerShell round trip -----------------
  # A single logical argument with an embedded space AND an embedded single
  # quote must come back byte-for-byte -- the property the shim structurally
  # cannot prove, since it never re-parses anything through a real shell.
  # Rework Round 3: poll for Done (bounded ~5s) instead of a fixed sleep,
  # matching F4b's Running-poll style below.
  run env PATH="$PATH_NO_SHIM" PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" bash "$SCRIPTS/lane-queue.sh" \
    add misc -- echo "argument with spaces and a 'quote'"
  [ "$status" -eq 0 ]
  local qtid="${output//$'\r'/}"
  [[ "$qtid" =~ ^[0-9]+$ ]]

  local qdone=0 i
  for i in $(seq 1 25); do
    run env PATH="$PATH_NO_SHIM" PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" bash "$SCRIPTS/lane-queue.sh" status "$qtid"
    [ "$status" -eq 0 ]
    if [[ "$output" == *'"Done"'* ]]; then
      qdone=1
      break
    fi
    sleep 0.2
  done
  [ "$qdone" -eq 1 ]

  run env PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" "$real_pueue" log "$qtid"
  [ "$status" -eq 0 ]
  [[ "$output" == *"argument with spaces and a 'quote'"* ]]

  # --- F4b: kill targets a task verified Running, not raced ---------------
  run env PATH="$PATH_NO_SHIM" PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" bash "$SCRIPTS/lane-queue.sh" \
    add misc -- bash -c "sleep 30"
  [ "$status" -eq 0 ]
  local tid="${output//$'\r'/}"
  [[ "$tid" =~ ^[0-9]+$ ]]

  local running=0 i
  for i in $(seq 1 25); do
    run env PATH="$PATH_NO_SHIM" PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" bash "$SCRIPTS/lane-queue.sh" status "$tid"
    [ "$status" -eq 0 ]
    if [[ "$output" == *'"Running"'* ]]; then
      running=1
      break
    fi
    sleep 0.2
  done
  [ "$running" -eq 1 ]

  run env PATH="$PATH_NO_SHIM" PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" bash "$SCRIPTS/lane-queue.sh" kill "$tid"
  [ "$status" -eq 0 ]

  PUEUE_CONFIG_PATH="$LIVE_DAEMON_CFG" "$real_pueue" shutdown >/dev/null 2>&1 || true
}
