#!/usr/bin/env bats
# @description NATS setup + one-way event-log bridge tests.
#   Requires nats-server and nats CLI; skips visibly when either is absent.
bats_require_minimum_version 1.5.0
load helpers

# Shared fixed port for all tests (test 3 restarts on the same port).
NATS_TEST_PORT=34222

# Return 0 if something accepts TCP on 127.0.0.1:$1, else 1.
_nats_port_in_use() {
  local port="$1"
  # bash /dev/tcp: connect success => listener present
  if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# Poll until 127.0.0.1:$1 refuses connections (port free). Bounded ~10s.
# Prints diagnostic and returns 1 if still held after the bound.
_nats_wait_port_free() {
  local port="$1"
  local i=0
  while _nats_port_in_use "$port"; do
    sleep 0.2
    i=$((i + 1))
    if [ "$i" -gt 50 ]; then
      echo "nats-bridge.bats: port ${port} still in use after kill/wait (~10s)" >&2
      return 1
    fi
  done
  return 0
}

# Poll until nats CLI can talk to $NATS_URL. Bounded ~10s. Fail loud if not ready.
_nats_wait_ready() {
  local ready=0 i
  for i in $(seq 1 50); do
    if nats --server "$NATS_URL" --timeout=1s account info >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [ "$ready" -ne 1 ]; then
    echo "nats-bridge.bats: nats-server not ready on ${NATS_URL} after ~10s" >&2
    return 1
  fi
  return 0
}

setup() {
  command -v nats-server >/dev/null 2>&1 && command -v nats >/dev/null 2>&1 \
    || skip "nats-server/nats not installed"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export NATS_STORE="$BATS_TEST_TMPDIR/ns"
  mkdir -p "$NATS_STORE"
  export NATS_URL="nats://127.0.0.1:${NATS_TEST_PORT}"
  # If a prior run left the port held, wait it out before bind (bounded).
  _nats_wait_port_free "$NATS_TEST_PORT" || return 1
  # Ephemeral JetStream server on fixed test port; store under bats tmp.
  nats-server -js -p "$NATS_TEST_PORT" -sd "$NATS_STORE" >/dev/null 2>&1 &
  echo $! > "$BATS_TEST_TMPDIR/nats.pid"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  source "$SCRIPTS/lib/nats-bridge.sh"
  # Wait until the server accepts connections, then ensure the stream.
  _nats_wait_ready || return 1
  # setup.sh worst-case internal bound is ~20s (wait_for_server + stream
  # info/add timeouts); outer bound needs real headroom for Windows spawn latency.
  timeout 40 bash "$SCRIPTS/nats/setup.sh"
}

teardown() {
  if [[ -f "$BATS_TEST_TMPDIR/nats.pid" ]]; then
    local pid
    pid="$(cat "$BATS_TEST_TMPDIR/nats.pid" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]]; then
      kill "$pid" 2>/dev/null || true
      # Wait until the process actually exits (do not race the next test).
      local i=0
      while kill -0 "$pid" 2>/dev/null; do
        sleep 0.1
        i=$((i + 1))
        if [ "$i" -gt 50 ]; then
          kill -9 "$pid" 2>/dev/null || true
          # Brief settle after SIGKILL before port poll
          sleep 0.2
          break
        fi
      done
    fi
    rm -f "$BATS_TEST_TMPDIR/nats.pid"
  fi
  # Windows (and some Unix stacks) can hold a just-closed listen port briefly.
  # Do not return until the port is free so the next test's bind does not race.
  _nats_wait_port_free "$NATS_TEST_PORT" || true
}

# bats test_tags=slow
@test "setup.sh is idempotent: two runs both exit 0; FOREMAN stream exists" {
  run timeout 30 bash "$SCRIPTS/nats/setup.sh"
  [ "$status" -eq 0 ]
  run timeout 10 nats --server "$NATS_URL" stream info FOREMAN
  [ "$status" -eq 0 ]
  run timeout 30 bash "$SCRIPTS/nats/setup.sh"
  [ "$status" -eq 0 ]
  run timeout 10 nats --server "$NATS_URL" stream info FOREMAN
  [ "$status" -eq 0 ]
}

# bats test_tags=slow
@test "bridge publishes and dedups on Nats-Msg-Id replay" {
  el_init run1
  el_emit run1 tool_result lane '{"n":1}' >/dev/null
  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 0 ]
  # Exactly one message in the stream (jq -e: CRLF-safe, never shell string compare)
  run timeout 10 bash -c 'nats --server "$NATS_URL" stream info FOREMAN --json | jq -e ".state.messages == 1"'
  [ "$status" -eq 0 ]
  # Reset cursor and re-bridge: JetStream dedup keeps message count at 1
  el_cursor_commit run1 nats-bridge 0
  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 0 ]
  run timeout 10 bash -c 'nats --server "$NATS_URL" stream info FOREMAN --json | jq -e ".state.messages == 1"'
  [ "$status" -eq 0 ]
}

# bats test_tags=slow
@test "cursor not advanced on publish failure; advances after server returns" {
  el_init run1
  local pid
  pid="$(cat "$BATS_TEST_TMPDIR/nats.pid")"
  kill "$pid" 2>/dev/null || true
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.1
    i=$((i + 1))
    if (( i > 50 )); then
      kill -9 "$pid" 2>/dev/null || true
      break
    fi
  done
  rm -f "$BATS_TEST_TMPDIR/nats.pid"

  el_emit run1 tool_result lane '{"n":1}' >/dev/null
  local before after
  before="$(el_cursor_get run1 nats-bridge)"
  before="${before%$'\r'}"
  run --separate-stderr nb_bridge_once run1
  # Publish failure → return 0 (retry next tick); cursor unchanged
  [ "$status" -eq 0 ]
  after="$(el_cursor_get run1 nats-bridge)"
  after="${after%$'\r'}"
  [ "$after" = "$before" ]

  # Restart ephemeral server (same port + store) and re-ensure stream
  mkdir -p "$NATS_STORE"
  nats-server -js -p 34222 -sd "$NATS_STORE" >/dev/null 2>&1 &
  echo $! > "$BATS_TEST_TMPDIR/nats.pid"
  timeout 30 bash "$SCRIPTS/nats/setup.sh"
  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 0 ]
  after="$(el_cursor_get run1 nats-bridge)"
  after="${after%$'\r'}"
  [ "$after" = "1" ]
  run timeout 10 bash -c 'nats --server "$NATS_URL" stream info FOREMAN --json | jq -e ".state.messages == 1"'
  [ "$status" -eq 0 ]
}

# bats test_tags=slow
@test "torn-tail: returns 2, publishes valid prefix only, cursor past valid line" {
  el_init run1
  el_emit run1 tool_result lane '{"n":1}' >/dev/null
  # Literal partial-object text with no trailing newline (torn tail)
  printf '{"partial":' >> "$(run_dir run1)/events.jsonl"
  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 2 ]
  local cur
  cur="$(el_cursor_get run1 nats-bridge)"
  cur="${cur%$'\r'}"
  [ "$cur" = "1" ]
  run timeout 10 bash -c 'nats --server "$NATS_URL" stream info FOREMAN --json | jq -e ".state.messages == 1"'
  [ "$status" -eq 0 ]
}

# bats test_tags=slow
@test "lock: pre-created .nats-bridge.lock directory yields return 5" {
  el_init run1
  mkdir -p "$(run_dir run1)/.nats-bridge.lock"
  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 5 ]
}

# bats test_tags=slow
@test "lock: token mismatch is a no-op (foreign lock survives)" {
  local rd; rd="$(seed_run run1)"
  mkdir -p "$rd/.nats-bridge.lock"
  # Fake PID:token unlikely to collide with any real process/token on this
  # host. _nb_lock_release must compare the in-memory token, not the PID
  # alone, so even a foreign owner file naming *our own* $$ but a different
  # token must survive.
  echo -n "999999:deadbeefdeadbeef" > "$rd/.nats-bridge.lock/owner"
  _NB_LOCK_PATH="$rd/.nats-bridge.lock"
  _NB_LOCK_TOKEN="notthesametoken"
  _nb_lock_release "$rd/.nats-bridge.lock"
  [ -d "$rd/.nats-bridge.lock" ]
  [ "$(cat "$rd/.nats-bridge.lock/owner")" = "999999:deadbeefdeadbeef" ]
}

# bats test_tags=slow
@test "lock: token match removes a lock this process acquired" {
  local rd; rd="$(seed_run run1)"
  mkdir -p "$rd/.nats-bridge.lock"
  local token="cafef00dcafef00d"
  printf '%s:%s' "$$" "$token" > "$rd/.nats-bridge.lock/owner"
  _NB_LOCK_PATH="$rd/.nats-bridge.lock"
  _NB_LOCK_TOKEN="$token"
  _nb_lock_release "$rd/.nats-bridge.lock"
  [ ! -d "$rd/.nats-bridge.lock" ]
}

# bats test_tags=slow
@test "lock: owner-write failure removes the just-created lock and returns 1" {
  local rd; rd="$(seed_run run1)"
  # Wrap mkdir so the real lock-dir mkdir (nb_bridge_once's own acquisition
  # call) succeeds normally, but the instant it does, occupy the owner path
  # with a directory of its own -- this makes the subsequent
  # `printf ... > "$lock/owner"` redirection fail (cannot write a regular
  # file where a directory already exists) without ever touching
  # nb_bridge_once's unconditional `mkdir "$lock"` acquisition call itself.
  mkdir() {
    if [[ "$1" == */.nats-bridge.lock ]]; then
      command mkdir "$1" || return $?
      command mkdir "$1/owner"
      return 0
    fi
    command mkdir "$@"
  }

  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"failed to record lock ownership"* ]]
  # Never hold a lock we cannot prove we own: the lock dir must be gone.
  [ ! -d "$rd/.nats-bridge.lock" ]

  unset -f mkdir
}

# bats test_tags=slow
@test "nb_bridge TERM trap does not strip a foreign-owned lock (foreign-lock survival)" {
  local rd; rd="$(seed_run run1)"
  mkdir -p "$rd/.nats-bridge.lock"
  # Simulate a lock held by ANOTHER live process (a real, unrelated PID: a
  # background sleep in this same test), distinct from the nb_bridge
  # instance we are about to TERM.
  ( sleep 20 ) &
  local foreign_pid=$!
  echo -n "$foreign_pid" > "$rd/.nats-bridge.lock/owner"

  # Run nb_bridge as a genuinely separate process (own $$/PID) so this test
  # exercises the exact interleaving from the audit finding: a second bridge
  # instance whose own nb_bridge_once tick returned 5 (lock already held by
  # someone else), now asleep between ticks, receiving SIGTERM.
  bash -c '
    source "'"$SCRIPTS"'/lib/common.sh"
    source "'"$SCRIPTS"'/lib/eventlog.sh"
    source "'"$SCRIPTS"'/lib/nats-bridge.sh"
    export FOREMAN_HOME="'"$FOREMAN_HOME"'"
    export NB_TICK=2
    nb_bridge run1
  ' &
  local nb_pid=$!

  # Give it time to hit the lock-already-held tick and enter its sleep.
  sleep 0.5
  kill -TERM "$nb_pid" 2>/dev/null || true

  # Bounded wait for the nb_bridge process to exit (trap runs `exit 0`).
  local i=0
  while kill -0 "$nb_pid" 2>/dev/null; do
    sleep 0.2
    i=$((i + 1))
    if [ "$i" -gt 50 ]; then
      kill -9 "$nb_pid" 2>/dev/null || true
      break
    fi
  done

  # The foreign lock (owned by $foreign_pid, not nb_bridge's own PID) must
  # still exist: nb_bridge's TERM trap must not have rmdir'd it.
  [ -d "$rd/.nats-bridge.lock" ]
  [ "$(cat "$rd/.nats-bridge.lock/owner" 2>/dev/null)" = "$foreign_pid" ]

  kill "$foreign_pid" 2>/dev/null || true
  wait "$foreign_pid" 2>/dev/null || true
}

# bats test_tags=slow
@test "nb_bridge_once rejects an invalid run id (return 2, no filesystem/nats touch)" {
  run --separate-stderr nb_bridge_once 'run*with.nats.meta'
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"invalid run id"* ]]
}

# bats test_tags=slow
@test "nb_bridge rejects an invalid run id at entry (return 2, before the loop)" {
  run --separate-stderr nb_bridge 'bad run id'
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"invalid run id"* ]]
}

# bats test_tags=slow
@test "corrupt on-disk cursor fails closed: return 1, no silent replay from 0" {
  el_init run1
  el_emit run1 tool_result lane '{"n":1}' >/dev/null
  mkdir -p "$(run_dir run1)/cursors"
  printf 'not-a-number' > "$(run_dir run1)/cursors/nats-bridge.cursor"
  run --separate-stderr nb_bridge_once run1
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"corrupt"* ]]
  # Lock must not be left held after the early, fail-closed return.
  [ ! -d "$(run_dir run1)/.nats-bridge.lock" ]
  # Nothing published: corrupt cursor must not be silently treated as 0.
  run timeout 10 bash -c 'nats --server "$NATS_URL" stream info FOREMAN --json | jq -e ".state.messages == 0"'
  [ "$status" -eq 0 ]
  # The corrupt value itself is left in place for a human to inspect/decide.
  [ "$(cat "$(run_dir run1)/cursors/nats-bridge.cursor")" = "not-a-number" ]
}
