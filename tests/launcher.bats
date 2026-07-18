#!/usr/bin/env bats
# @description Harness-level tests for foreman-launch, run against the
#   COMPILED binary (launcher/dist/foreman-launch.exe) — never against
#   `bun run`/`bun test` (Bun #24690: stdout:pipe can read empty INSIDE
#   `bun test`; stdout_bytes growth is only asserted here, per T1 spec
#   REV2 resolution 6).
# Environment gotcha (documented, not a launcher bug): Git Bash/MSYS
# auto-converts arguments that look like Unix absolute paths (e.g. a bare
# "/c" cmd.exe flag) into Windows paths. MSYS_NO_PATHCONV=1 disables that
# conversion for this whole process tree. Once it's set, --heartbeat-file
# arguments must be RELATIVE paths (cd into BATS_TEST_TMPDIR first) since a
# literal "/c/Users/..." string is not a valid Windows path and would no
# longer get auto-translated.
load helpers

setup() {
  export MSYS_NO_PATHCONV=1
  EXE="$(cd "$BATS_TEST_DIRNAME/../launcher/dist" && pwd)/foreman-launch.exe"
  [ -f "$EXE" ] || skip "compiled exe not found at $EXE — run: pwsh -File launcher/build.ps1"
  # Native Windows form (backslashes) for when the exe path is passed as a
  # CMD ARGUMENT (e.g. the nested-launcher test's inner invocation): once it
  # crosses into a Bun.spawn -> CreateProcess call, an MSYS-style
  # "/c/foo/bar" string is not a valid Windows path and resolves ENOENT.
  # The bash-level `run "$EXE"` invocations are unaffected (that's bash's
  # own exec resolution, not an argv string handed to CreateProcess).
  EXE_WIN="$(cygpath -w "$EXE")"
  cd "$BATS_TEST_TMPDIR"
}

# @description Poll until `cmd` (a bash command string) succeeds or
#   timeout_s elapses. Bounded — never a raw sleep used as the assertion.
# @arg $1 timeout in seconds
# @arg $2 bash command to eval repeatedly
wait_until() {
  local timeout_s="$1" cmd="$2" waited_ticks=0
  local max_ticks=$(( timeout_s * 4 ))
  until eval "$cmd"; do
    sleep 0.25
    waited_ticks=$(( waited_ticks + 1 ))
    [ "$waited_ticks" -ge "$max_ticks" ] && return 1
  done
  return 0
}

# @description Read a field from the LAST JSON line of a heartbeat file.
# @arg $1 heartbeat file path
# @arg $2 jq field expression, e.g. .launcher_pid
last_hb_field() {
  tail -n 1 "$1" | jq -r "$2"
}

@test "basic passthrough: stdout unmodified, exit 0" {
  run "$EXE" -- cmd /c "echo hi"
  [ "$status" -eq 0 ]
  # CR-safe: cmd.exe emits CRLF: match substring rather than full-line equality.
  [[ "$output" == *hi* ]]
}

@test "exit-code passthrough: nonzero child code surfaces unchanged" {
  run "$EXE" -- cmd /c "exit 9"
  [ "$status" -eq 9 ]
}

@test "missing '--' separator exits 125 with usage" {
  run "$EXE" --timeout 5
  [ "$status" -eq 125 ]
  [[ "$output" == *"usage: foreman-launch"* ]]
}

# bats test_tags=slow
@test "timeout: grace then hard-kill -> exit 124, tree dead, wall-clock < 10s" {
  hb="./hb-timeout.jsonl"
  start_s=$(date +%s)
  run "$EXE" --timeout 2 --grace 1 --heartbeat-file "$hb" --heartbeat-interval 1 -- ping -n 60 127.0.0.1
  end_s=$(date +%s)
  [ "$status" -eq 124 ]
  elapsed=$(( end_s - start_s ))
  [ "$elapsed" -lt 10 ]
  child_pid="$(last_hb_field "$hb" .pid)"
  # bounded: tree should already be gone by the time `run` returned, but
  # poll briefly for tasklist's own latency.
  wait_until 5 "! tasklist /FI \"PID eq $child_pid\" | grep -q \"$child_pid\""
}

# bats test_tags=slow
@test "kill-shot: taskkill launcher_pid reaps the whole tree, grandchildren included" {
  hb="./hb-killshot.jsonl"
  "$EXE" --heartbeat-file "$hb" --heartbeat-interval 1 -- \
    cmd /c "start /b ping -n 60 127.0.0.1 >nul & ping -n 60 127.0.0.1 >nul" &
  bg_pid=$!
  wait_until 5 "[ -s \"$hb\" ]"
  launcher_pid="$(last_hb_field "$hb" .launcher_pid)"
  child_pid="$(last_hb_field "$hb" .pid)"
  [ -n "$launcher_pid" ]; [ -n "$child_pid" ]
  # tree present before the kill shot
  tasklist /FI "PID eq $child_pid" | grep -q "$child_pid"
  taskkill /PID "$launcher_pid" /F
  wait_until 5 "! tasklist /FI \"PID eq $child_pid\" | grep -q \"$child_pid\""
  # belt-and-braces: no lingering ping.exe anywhere in the tree
  wait_until 5 "! tasklist /FI \"IMAGENAME eq PING.EXE\" | grep -qi ping.exe"
  wait "$bg_pid" 2>/dev/null || true
}

# bats test_tags=slow
@test "nested-launcher reap: outer kill reaps inner launcher AND its own job" {
  hb_outer="./hb-outer.jsonl"
  hb_inner="./hb-inner.jsonl"
  "$EXE" --heartbeat-file "$hb_outer" --heartbeat-interval 1 -- \
    "$EXE_WIN" --heartbeat-file "$hb_inner" --heartbeat-interval 1 -- \
    ping -n 60 127.0.0.1 &
  bg_pid=$!
  wait_until 5 "[ -s \"$hb_outer\" ] && [ -s \"$hb_inner\" ]"
  outer_launcher_pid="$(last_hb_field "$hb_outer" .launcher_pid)"
  inner_launcher_pid="$(last_hb_field "$hb_outer" .pid)"   # outer's child IS the inner launcher
  inner_child_pid="$(last_hb_field "$hb_inner" .pid)"       # inner's child is ping's cmd
  [ -n "$outer_launcher_pid" ]; [ -n "$inner_launcher_pid" ]; [ -n "$inner_child_pid" ]
  tasklist /FI "PID eq $inner_launcher_pid" | grep -q "$inner_launcher_pid"
  taskkill /PID "$outer_launcher_pid" /F
  wait_until 5 "! tasklist /FI \"PID eq $inner_launcher_pid\" | grep -q \"$inner_launcher_pid\""
  wait_until 5 "! tasklist /FI \"PID eq $inner_child_pid\" | grep -q \"$inner_child_pid\""
  wait "$bg_pid" 2>/dev/null || true
}

# bats test_tags=slow
@test "heartbeat file: parseable JSON lines, ts/elapsed_s advance, stdout_bytes grows" {
  hb="./hb-growth.jsonl"
  run "$EXE" --heartbeat-file "$hb" --heartbeat-interval 1 -- \
    cmd /c "echo one & ping -n 3 127.0.0.1 >nul & echo two"
  [ "$status" -eq 0 ]
  [ -s "$hb" ]
  # every line parses as JSON with the frozen field set
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "$line" | jq -e '(.ts|type=="string") and (.launcher_pid|type=="number") and (.pid|type=="number") and (.job_id|type=="string") and (.alive|type=="boolean") and (.stdout_bytes|type=="number") and (.stderr_bytes|type=="number") and (.elapsed_s|type=="number")' >/dev/null
  done < "$hb"
  first_elapsed="$(head -n1 "$hb" | jq -r .elapsed_s)"
  last_elapsed="$(last_hb_field "$hb" .elapsed_s)"
  last_stdout_bytes="$(last_hb_field "$hb" .stdout_bytes)"
  awk -v a="$last_elapsed" -v b="$first_elapsed" 'BEGIN{exit !(a>=b)}'
  [ "$last_stdout_bytes" -gt 0 ]
  last_alive="$(last_hb_field "$hb" .alive)"
  [ "$last_alive" = "false" ]
}

@test "env-var backslash passthrough (Bun #12970): FOO=C:\\a\\b reaches CMD verbatim" {
  export FOO='C:\a\b'
  run "$EXE" -- cmd /c "echo %FOO%"
  [ "$status" -eq 0 ]
  [[ "$output" == *'C:\a\b'* ]]
}

# bats test_tags=slow
@test "--detach: returns 0 before completion; F has launcher_pid/pid/job_id; detached round finishes after foreground exits" {
  hb="./hb-detach.jsonl"
  # Long enough (~19s) that "foreground returned in <5s" only holds if it
  # truly did not wait for completion.
  start_s=$(date +%s)
  run "$EXE" --detach --heartbeat-file "$hb" --heartbeat-interval 1 -- \
    cmd /c "ping -n 20 127.0.0.1 >nul & echo detached-done"
  end_s=$(date +%s)
  [ "$status" -eq 0 ]
  elapsed=$(( end_s - start_s ))
  [ "$elapsed" -lt 5 ]
  [ -s "$hb" ]
  first_line="$(head -n1 "$hb")"
  echo "$first_line" | jq -e '(.launcher_pid|type=="number") and (.pid|type=="number") and (.job_id|type=="string")' >/dev/null
  # detached round keeps running after the foreground shell exited: bounded
  # wait (well past the ~19s ping) for its FINAL heartbeat (alive:false).
  waited_ticks=0
  until [ "$(last_hb_field "$hb" .alive)" = "false" ]; do
    sleep 0.5
    waited_ticks=$(( waited_ticks + 1 ))
    [ "$waited_ticks" -ge 60 ] && break   # bounded: 30s ceiling
  done
  [ "$(last_hb_field "$hb" .alive)" = "false" ]
}

# bats test_tags=slow
# F1 regression (rework round 1, Opus audit): runDetached used to return 0
# on ANY parseable first line in F, and supervise() only ever appends — so a
# stale, still-parseable line left over from a prior run could false-succeed
# the handoff before the NEW detached copy ever wrote anything. Seed F with
# a sentinel stale line first; the fix must prove the handoff is keyed to a
# genuinely FRESH line, not merely "F is non-empty and parses."
@test "--detach: stale pre-existing heartbeat line does not cause a false-success handoff (F1 regression)" {
  hb="./hb-detach-stale.jsonl"
  printf '%s\n' '{"ts":"2020-01-01T00:00:00.000Z","launcher_pid":999999,"pid":999998,"job_id":"999997","alive":true,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}' > "$hb"
  run "$EXE" --detach --heartbeat-file "$hb" --heartbeat-interval 1 -- \
    cmd /c "echo fresh-detach-run"
  [ "$status" -eq 0 ]
  [ -s "$hb" ]
  # The line the handoff succeeded on must NOT be the stale sentinel.
  first_launcher_pid="$(head -n1 "$hb" | jq -r .launcher_pid)"
  [ "$first_launcher_pid" != "999999" ]
  # bounded wait for the fresh detached round's final heartbeat, confirming
  # it's a genuinely live, distinct run (not a coincidental leftover value).
  waited_ticks=0
  until [ "$(last_hb_field "$hb" .alive)" = "false" ]; do
    sleep 0.5
    waited_ticks=$(( waited_ticks + 1 ))
    [ "$waited_ticks" -ge 20 ] && break   # bounded: 10s ceiling
  done
  [ "$(last_hb_field "$hb" .alive)" = "false" ]
  final_launcher_pid="$(last_hb_field "$hb" .launcher_pid)"
  [ "$final_launcher_pid" != "999999" ]
}
