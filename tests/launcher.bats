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
#
# posix-cascade-parity (v0.2.7.5 package 5): the "POSIX pidns: ..." tests
# below are the WSL/Linux counterpart, run against launcher/dist/
# foreman-launch (no extension -- the Linux --compile target), built fresh
# by setup_file() below. The Windows tests above/around them are completely
# UNCHANGED: this file's setup() now skips its Windows-exe requirement
# specifically for "POSIX pidns: ..."-named tests (see setup() below) so
# both families can coexist in one file without either blocking the other.
load helpers

setup_file() {
  # Builds the REAL compiled Linux exe once per bats-FILE invocation (not
  # mocked, not reused from some stale prior build) -- Task 2's own note
  # that "each WSL bats test must actually bun build --compile the Linux
  # exe first" is satisfied here once for the whole file rather than once
  # per @test, since the source doesn't change between tests in the same
  # run and re-compiling identical source N times would be waste, not extra
  # correctness. No-ops (returns 0) on anything that isn't Linux/WSL, or
  # where `bun` isn't on PATH -- the individual "POSIX pidns: ..." tests
  # each skip themselves via posix_launcher_or_skip() when the resulting
  # exe isn't there, so a failed/skipped build here just means those tests
  # report skipped, not that this hook itself fails the file.
  [[ "$(uname -s)" == "Linux" ]] || return 0
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || return 0
  local launcher_dir
  launcher_dir="$(cd "$BATS_TEST_DIRNAME/../launcher" && pwd)"
  ( cd "$launcher_dir" && bun build --compile --target=bun-linux-x64 \
      --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
      src/launch.ts --outfile dist/foreman-launch ) >&2
}

setup() {
  export MSYS_NO_PATHCONV=1
  cd "$BATS_TEST_TMPDIR"
  # POSIX-specific tests below do their own setup via
  # posix_launcher_or_skip() and must not be blocked by the Windows-exe
  # requirement this hook otherwise enforces for every OTHER (Windows) test
  # in this file -- naming convention: every POSIX test in this file is
  # prefixed "POSIX pidns: ".
  case "$BATS_TEST_DESCRIPTION" in
    "POSIX pidns: "*) return 0 ;;
  esac
  EXE="$(cd "$BATS_TEST_DIRNAME/../launcher/dist" && pwd)/foreman-launch.exe"
  [ -f "$EXE" ] || skip "compiled exe not found at $EXE — run: pwsh -File launcher/build.ps1"
  # Native Windows form (backslashes) for when the exe path is passed as a
  # CMD ARGUMENT (e.g. the nested-launcher test's inner invocation): once it
  # crosses into a Bun.spawn -> CreateProcess call, an MSYS-style
  # "/c/foo/bar" string is not a valid Windows path and resolves ENOENT.
  # The bash-level `run "$EXE"` invocations are unaffected (that's bash's
  # own exec resolution, not an argv string handed to CreateProcess).
  EXE_WIN="$(cygpath -w "$EXE")"
}

# @description Skip the calling POSIX test unless this is a Linux/WSL host
#   with a compiled launcher exe (built fresh by setup_file() above).
#   Exports POSIX_EXE on success.
posix_launcher_or_skip() {
  [[ "$(uname -s)" == "Linux" ]] || skip "not Linux/WSL"
  POSIX_EXE="$(cd "$BATS_TEST_DIRNAME/../launcher/dist" 2>/dev/null && pwd)/foreman-launch"
  [ -x "$POSIX_EXE" ] || skip "compiled POSIX exe not found/executable at $POSIX_EXE (bun/unshare absent, or the setup_file build failed -- see setup_file's own stderr above)"
  export POSIX_EXE
}

# @description Host-visible pid of a "sleep" process whose full command
#   line contains `pattern`, matched on the COMM field specifically (ps's
#   `comm`, i.e. the actual executable name) rather than a text grep of the
#   whole command line -- a plain `pgrep -f`/text grep would ALSO match the
#   launcher's own argv (it necessarily contains the same substring, since
#   that's exactly the CMD script string being quoted through to it),
#   silently finding the launcher instead of the real escapee.
# @arg $1 substring to match against the sleep command's own args
find_sleep_pid() {
  ps -eo pid,comm,args | awk -v pat="$1" '$2=="sleep" && index($0,pat) {print $1; exit}'
}

# @description Builds a directory of symlinks (setsid/bash/sh/true/env,
#   resolved from their REAL absolute paths) that deliberately excludes
#   `unshare` -- a faithful "unshare genuinely unresolvable" PATH, not an
#   internal test-only bypass flag: the launcher's own availability probe
#   does a real PATH search, so pointing PATH at this directory exercises
#   the actual absence code path end to end. Kept out of `--` (existing)
#   PATH entries entirely (not just missing `unshare` from among them) so
#   there's no risk of an unrelated `unshare` elsewhere on this host's real
#   PATH shadowing the simulated absence.
# @stdout the directory path
build_no_unshare_path() {
  local dir="$BATS_TEST_TMPDIR/no-unshare-bin"
  mkdir -p "$dir"
  local b p
  for b in setsid bash sh true env; do
    p="$(command -v "$b" 2>/dev/null)" || continue
    ln -sf "$p" "$dir/$b"
  done
  echo "$dir"
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

# ==========================================================================
# posix-cascade-parity (v0.2.7.5 package 5) -- POSIX/WSL-only, run against
# launcher/dist/foreman-launch (built fresh by setup_file() above). Every
# test below is guarded via posix_launcher_or_skip() (skip on non-Linux, or
# if the build didn't produce an executable) — nothing here runs, or can
# affect, the Windows tests above.
# ==========================================================================

# bats test_tags=slow
# Task 2 (posix-cascade-parity plan), THE kill-shot: a CMD under the
# pidns-wrapped launcher spawns a grandchild that setsid+backgrounds
# (double-fork-equivalent detach: a NEW session AND process group, distinct
# from CMD's own pgid) to escape its process group. Killing launcher_pid
# (the pid a host-side caller actually has -- see posix.ts's
# bootstrapPidnsCascade / posix-bootstrap.ts's HOST_PID_ENV handoff) must
# leave zero survivors, including the escapee -- which the pgid-only path
# (pre-this-plan) would NOT reap, since the escapee's pgid differs from
# CMD's.
@test "POSIX pidns: killing launcher_pid reaps a setsid/backgrounded escapee (kill-shot, WSL)" {
  posix_launcher_or_skip
  command -v unshare >/dev/null 2>&1 || skip "unshare absent on this host"
  unshare --pid --mount-proc --fork true >/dev/null 2>&1 \
    || skip "pid namespaces unavailable on this host; the kernel cascade this test asserts cannot occur (see test 12 for the degraded setsid+pgid contract)"
  hb="./hb-posix-killshot.jsonl"
  marker="999.$$"
  "$POSIX_EXE" --heartbeat-file "$hb" --heartbeat-interval 1 -- \
    /bin/bash -c "setsid /bin/bash -c '(sleep $marker &)' ; sleep 300" &
  bg_pid=$!
  wait_until 5 "[ -s \"$hb\" ]"
  launcher_pid="$(last_hb_field "$hb" .launcher_pid)"
  [ -n "$launcher_pid" ]
  wait_until 5 "[ -n \"\$(find_sleep_pid '$marker')\" ]"
  escapee_pid="$(find_sleep_pid "$marker")"
  [ -n "$escapee_pid" ]
  kill -0 "$escapee_pid"   # sanity: alive before the kill-shot
  kill -9 "$launcher_pid"
  wait_until 5 "! kill -0 $escapee_pid 2>/dev/null"
  ! kill -0 "$escapee_pid" 2>/dev/null
  wait "$bg_pid" 2>/dev/null || true
}

# bats test_tags=slow
# Task 2 Step 4's forced-absent case: unshare is made genuinely
# unresolvable (see build_no_unshare_path's header) so the launcher's own
# availability probe really fails, exercising the real "unshare
# unavailable" branch end to end (not a fake internal-only bypass). The
# downgrade must be LOGGED (never silent) and the frozen exit-code/heartbeat
# contract must still hold via the pre-existing setsid+pgid path.
@test "POSIX pidns: forced unshare-absent run logs the downgrade and still honors the frozen contract via setsid+pgid" {
  posix_launcher_or_skip
  no_unshare_path="$(build_no_unshare_path)"
  hb="./hb-posix-degraded.jsonl"
  run env PATH="$no_unshare_path" "$POSIX_EXE" --heartbeat-file "$hb" --heartbeat-interval 1 -- /bin/bash -c "exit 5"
  [ "$status" -eq 5 ]
  [[ "$output" == *"DEGRADED"* ]]
  [[ "$output" == *"setsid+pgid"* ]]
  [ -s "$hb" ]
  last_alive="$(last_hb_field "$hb" .alive)"
  [ "$last_alive" = "false" ]
}

# Task 3 (posix-cascade-parity plan): contract parity under the pidns
# wrapper -- same exit-code passthrough and heartbeat schema as the Windows
# build (README/orchestration-hardening.md's frozen contract), now running
# through the pidns bootstrap rather than a bare setsid. (The
# launcherPid/HOST_PID_ENV passthrough this depends on already shipped in
# the previous commit, since the kill-shot test above could not target a
# meaningful pid without it -- this task adds DEDICATED pinning coverage
# for the exit-code/heartbeat contract specifically, exit code and schema
# both, so a future change that breaks either fails a test named for it.)
@test "POSIX pidns: exit-code + heartbeat contract parity under the pidns wrapper (CMD exit 3)" {
  posix_launcher_or_skip
  command -v unshare >/dev/null 2>&1 || skip "unshare absent on this host"
  hb="./hb-posix-contract.jsonl"
  run "$POSIX_EXE" --heartbeat-file "$hb" --heartbeat-interval 1 -- /bin/bash -c "exit 3"
  [ "$status" -eq 3 ]
  [ -s "$hb" ]
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "$line" | jq -e '(.ts|type=="string") and (.launcher_pid|type=="number") and (.pid|type=="number") and (.job_id|type=="string") and (.alive|type=="boolean") and (.stdout_bytes|type=="number") and (.stderr_bytes|type=="number") and (.elapsed_s|type=="number")' >/dev/null
  done < "$hb"
  last_alive="$(last_hb_field "$hb" .alive)"
  [ "$last_alive" = "false" ]
}

# bats test_tags=slow
@test "POSIX pidns: --timeout still yields exit 124 under the pidns wrapper" {
  posix_launcher_or_skip
  command -v unshare >/dev/null 2>&1 || skip "unshare absent on this host"
  hb="./hb-posix-timeout.jsonl"
  start_s=$(date +%s)
  run "$POSIX_EXE" --timeout 2 --grace 1 --heartbeat-file "$hb" --heartbeat-interval 1 -- /bin/bash -c "sleep 60"
  end_s=$(date +%s)
  [ "$status" -eq 124 ]
  elapsed=$(( end_s - start_s ))
  [ "$elapsed" -lt 10 ]
}
