#!/usr/bin/env bats
# @description Tests for lane-queue.sh. A PATH-shim fake `pueue`/`pueued`
#   pair (records argv to a log, returns canned/stateful output) drives the
#   ensure/add/status/kill logic deterministically without a live daemon.
#   LANE_QUEUE_FORCE_MISSING exercises the pueue-absent fallback path. ONE
#   test exercises the real staged pueue/pueued binaries end-to-end and is
#   skipped (with reason) when they are absent.
bats_require_minimum_version 1.5.0
load helpers

# @description Write a stateful fake `pueue` client to $SHIM_DIR/pueue. Every
#   invocation is appended to $SHIM_LOG as one line, argv elements joined by
#   \x1f (unit separator) so a test can assert on the exact argv pueue would
#   have received -- proof that CMD/ARGS are passed through as argv, never
#   re-joined into a shell string. Daemon reachability and per-group
#   "already exists" state are modeled with marker files under $SHIM_STATE so
#   the ensure retry-loop and idempotency logic can be exercised precisely.
#   SHIM_STATUS_BAD_JSON=1 makes `status --json` emit deliberately malformed
#   JSON (pueue itself still "succeeds", exit 0) so cmd_status's own jq
#   filtering failure path (Rework Round 1, F3) can be exercised
#   deterministically.
_write_shim_pueue() {
  cat > "$SHIM_DIR/pueue" <<'SHIM'
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
  chmod +x "$SHIM_DIR/pueue"
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

setup() {
  setup_tmp_repo
  cd "$REPO"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  SHIM_DIR="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM_DIR"
  SHIM_STATE="$BATS_TEST_TMPDIR/shim-state"
  mkdir -p "$SHIM_STATE"
  SHIM_LOG="$SHIM_STATE/argv.log"
  : > "$SHIM_LOG"
  export SHIM_STATE SHIM_LOG
  _write_shim_pueue
  _write_shim_pueued
  PATH_WITH_SHIM="$SHIM_DIR:$PATH"
  PATH_NO_SHIM="$PATH"
}

teardown() {
  # Rework Round 1, F2: this used to shut down the REAL staged daemon after
  # EVERY test unconditionally, which would kill any pre-existing developer
  # pueued the 15 shim tests have no business touching (the shim tests never
  # talk to the real binary at all -- PATH_WITH_SHIM makes `command -v pueue`
  # resolve to the fake client first). Scope the real-daemon shutdown
  # strictly to the live-daemon test, identified by its own description --
  # teardown() always runs (even if that test fails partway through), so this
  # is still a reliable cleanup net for it specifically, without being a
  # blanket hazard for every other test in the file.
  if [[ "$BATS_TEST_DESCRIPTION" == "live daemon:"* ]]; then
    local real_pueue="$HOME/.foreman/tools/pueue/pueue.exe"
    [[ -x "$real_pueue" ]] || real_pueue="$HOME/.foreman/tools/pueue/pueue"
    if [[ -x "$real_pueue" ]]; then
      "$real_pueue" shutdown >/dev/null 2>&1 || true
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

@test "add: enqueues via pueue add, argv passed through untouched, prints CR-free task id" {
  : > "$SHIM_STATE/daemon_up"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-queue.sh" add grok -- echo 'hello world; rm -rf /' '$HOME' '&&x'
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  # exact argv recorded by the shim: each element its own \x1f-delimited
  # token -- proof pueue add received the literal strings, not a re-joined
  # shell command (no shell metacharacter expansion happened anywhere).
  run grep -F $'pueue\x1fadd\x1f--group\x1fgrok\x1f--print-task-id\x1f--\x1fecho\x1fhello world; rm -rf /\x1f$HOME\x1f&&x' "$SHIM_LOG"
  [ "$status" -eq 0 ]
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

@test "live daemon: ensure -> add trivial task to misc -> status shows it -> kill" {
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

  # Defensive cleanup: a stray daemon surviving a previous crashed run would
  # make "the daemon this test started" ambiguous. Start from a clean slate.
  "$real_pueue" shutdown >/dev/null 2>&1 || true
  sleep 1

  run env PATH="$PATH_NO_SHIM" bash "$SCRIPTS/lane-queue.sh" ensure
  [ "$status" -eq 0 ]

  run env PATH="$PATH_NO_SHIM" bash "$SCRIPTS/lane-queue.sh" add misc -- bash -c "sleep 5"
  [ "$status" -eq 0 ]
  local tid="${output//$'\r'/}"
  [[ "$tid" =~ ^[0-9]+$ ]]

  run env PATH="$PATH_NO_SHIM" bash "$SCRIPTS/lane-queue.sh" status "$tid"
  [ "$status" -eq 0 ]
  [[ "$output" == *"\"id\":$tid"* ]]

  run env PATH="$PATH_NO_SHIM" bash "$SCRIPTS/lane-queue.sh" kill "$tid"
  [ "$status" -eq 0 ]

  "$real_pueue" shutdown >/dev/null 2>&1 || true
}
