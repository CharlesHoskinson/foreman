#!/usr/bin/env bats
# @description Tests for lane-run.sh durable-lanes wrapper.
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo x > "$WT/f"
  git -C "$WT" add -A
  git -C "$WT" commit -qm base
}

@test "lane-run tees stream, emits round_done with exit code, checkpoints" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo "{\"type\":\"tool_result\"}"; echo modified > "'"$WT"'/f"'
  [ "$status" -eq 0 ]
  [ -f "$WT/.harness/stream.ndjson" ]
  grep -q tool_result "$WT/.harness/stream.ndjson"
  # round_done event exists with exit_code 0
  run jq -rc 'select(.type=="round_done")|.payload.exit_code' "$(run_dir run1)/events.jsonl"
  [ "$output" = "0" ]
  # a checkpoint captured the modified file
  sha="$(git -C "$WT" rev-parse refs/checkpoints/lane-a)"
  [ "$(git -C "$WT" show "$sha:f")" = "modified" ]
}

@test "lane-run round_done records nonzero exit" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'exit 3'
  [ "$status" -eq 3 ]
  run jq -rc 'select(.type=="round_done")|.payload.exit_code' "$(run_dir run1)/events.jsonl"
  [ "$output" = "3" ]
}

@test "lane-run rejects insufficient arity" {
  run bash "$SCRIPTS/lane-run.sh" onlytwo args
  [ "$status" -eq 2 ]
}

@test "lane-run refuses worktree when lane.lock already held" {
  mkdir -p "$WT/.harness/lane.lock"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'touch "'"$WT"'/should-not-exist"'
  [ "$status" -eq 2 ]
  [[ "$output" == *"owns"* ]] || [[ "$output" == *"another lane-run"* ]]
  [ ! -f "$WT/should-not-exist" ]
}

@test "lane-run continues when checkpoint fails on non-git worktree" {
  NOTGIT="$BATS_TEST_TMPDIR/notgit"
  mkdir -p "$NOTGIT"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$NOTGIT" -- bash -c 'echo "{\"type\":\"tool_result\"}"; touch "'"$NOTGIT"'/marker"'
  [ "$status" -eq 0 ]
  [ -f "$NOTGIT/marker" ]
  grep -q tool_result "$NOTGIT/.harness/stream.ndjson"
  run jq -rc 'select(.type=="round_done")|.payload.checkpoint_failed' "$(run_dir run1)/events.jsonl"
  [ "$output" = "true" ]
  run jq -rc 'select(.type=="round_done")|.payload.exit_code' "$(run_dir run1)/events.jsonl"
  [ "$output" = "0" ]
}

# Rework Round B, finding 1 [HIGH] lane-run.sh:67 — unguarded prompt el_emit
# could abort before CMD ran. The audit's own failure-scenario text names two
# equally real triggers for a nonzero el_emit return: its mkdir-mutex retry
# timeout (~30s of real contention -- on this host's per-process overhead
# that is many minutes, not 30s, so pre-holding .seq.lock is infeasible here)
# OR a jq failure. This test drives the jq-failure trigger instead: it
# shadows `jq` (as an exported bash function, so lane-run.sh's own child
# process picks it up) to fail ONLY el_emit's internal event-line-building
# call (its unique --argjson seq signature), passing every other jq
# invocation in the script straight through via `command jq`. Asserts CMD
# still ran to completion and lane-run.sh's own exit code is unaffected, with
# the guard's warning on stderr (captured in $output, per this file's
# existing convention).
@test "lane-run: guarded prompt el_emit does not abort CMD when el_emit itself fails" {
  jq() {
    if [[ "$*" == *"--argjson seq"* ]]; then
      echo "fake-jq: simulated failure for el_emit's internal event-line jq call" >&2
      return 1
    fi
    command jq "$@"
  }
  export -f jq
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'touch "'"$WT"'/cmd-ran"'
  [ "$status" -eq 0 ]
  [ -f "$WT/cmd-ran" ]
  [[ "$output" == *"el_emit prompt failed"* ]]
}

# Rework Round B, finding 2 [HIGH] lane-run.sh:109 vs :153 — background
# checkpoint loop was not reaped before the finalization checkpoint, so its
# own event could land in events.jsonl after round_done. With
# DURABLE_CHECKPOINT_INTERVAL=1 and a CMD that keeps running past at least
# one 1s tick, assert round_done is the LAST event emitted for the run once
# lane-run.sh exits, and that seq numbers are strictly increasing.
@test "lane-run reaps background checkpoint watcher before finalization; round_done is the last event" {
  export DURABLE_CHECKPOINT_INTERVAL=1 DURABLE_HEARTBEAT_INTERVAL=0
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo tick1; sleep 1.3; echo tick2'
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc '.type' "$events"
  [ "${lines[-1]}" = "round_done" ]
  run jq -r '.seq' "$events"
  prev=0
  for s in "${lines[@]}"; do
    [ "$s" -gt "$prev" ]
    prev="$s"
  done
}

# Rework Round 3, findings 1+2 [HIGH] lane-run.sh ~186, ~222 — job control
# (`set -m`) and the process-GROUP signal forwarding it enabled were REMOVED
# entirely (strategy decision: do not re-attempt job control; see the
# lane-run.sh header contract note). This test used to assert that an
# MSYS-fork grandchild of CMD was reached via process-group TERM. That
# mechanism no longer exists, and empirical testing during this rework showed
# `taskkill //T` does NOT reliably reach MSYS-fork-emulated grandchildren
# either (Windows' native PPID chain for Cygwin/MSYS fork() does not match
# the logical bash process tree, so tree-kill via winpid translation is a
# real best-effort sweep, not a guarantee, for this specific child class) —
# that limitation is accepted and documented, not chased further here. What
# this rework DOES guarantee, and what this test asserts instead, is that
# lane-run.sh itself always bounded-terminates CMD's own pid and exits
# promptly on TERM, regardless of what CMD may have left behind.
@test "lane-run bounded-kills CMD's own pid on TERM; lane-run.sh itself never hangs" {
  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'sleep 100 & echo $! > "'"$WT"'/child.pid"; wait' &
  lr_pid=$!
  for _ in $(seq 1 50); do
    [ -f "$WT/child.pid" ] && break
    sleep 0.1
  done
  [ -f "$WT/child.pid" ]
  kill -TERM "$lr_pid" 2>/dev/null || true
  # Bounded wait (not a fixed sleep-then-assert) for lane-run.sh's own full
  # exit -- this IS the hard guarantee this rework adds: the wrapper itself
  # must fully terminate within a small bound, never hang, no matter what CMD
  # did.
  for _ in $(seq 1 100); do
    kill -0 "$lr_pid" 2>/dev/null || break
    sleep 0.1
  done
  run kill -0 "$lr_pid"
  [ "$status" -ne 0 ]
}

# Rework Round 3, finding 1 [HIGH] lane-run.sh ~186 — new contract: CMD MUST
# be non-interactive, and lane-run.sh redirects CMD's OWN stdin from
# /dev/null. Assert a CMD that reads stdin gets EOF immediately (`read`
# fails fast, nonzero) rather than ever blocking on a real/inherited stdin.
# The bound is generous (not a tight "instant" check): this host's real
# per-invocation subprocess overhead (mkdir, several jq/git/stat calls across
# prompt emission, checkpointing, and event emission) is itself several
# seconds, well documented elsewhere in this file -- what this asserts is
# that the round trip is bounded at all (a real stdin block, e.g. if the
# isolation regressed, would hang far longer than this, indefinitely absent
# outside input).
@test "lane-run isolates CMD's stdin from /dev/null; a CMD that reads stdin gets EOF immediately, never blocks" {
  start="$(date +%s)"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'read x; exit $?'
  finish="$(date +%s)"
  [ "$status" -ne 0 ]
  [ "$((finish - start))" -le 30 ]
}

# Rework Round 3, finding 2 [HIGH] lane-run.sh ~222 — bounded TERM-then-KILL
# escalation replaces the old bare `wait`, which could block forever if CMD
# ignored TERM. Use a CMD that ignores TERM outright, signals it has actually
# started (touches a marker file) before sleeping far longer than the
# (shortened, for test speed) grace period, then send TERM to lane-run.sh
# itself. Waiting for the marker file (rather than a fixed sleep) matters:
# earlier iterations of this test sent TERM after a fixed short sleep and
# intermittently raced lane-run.sh's own setup (this host's mkdir/jq/git
# overhead before CMD is even launched is itself non-trivial), which let the
# signal land and be consumed before cmd_pid was assigned -- a test-harness
# race, not a script defect, but one worth eliminating outright. Assert
# lane-run.sh's own process exits within grace+margin, and that the
# KILL-escalation alert event ({"tree_kill":"best_effort",...}) is present in
# the event log per this rework's spec (the limitation must be
# machine-visible, not just a comment).
@test "lane-run KILL-escalates a TERM-ignoring CMD within grace+margin; never hangs; alert event present" {
  export LANE_KILL_GRACE=2
  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'trap "" TERM; touch "'"$WT"'/cmd-started"; sleep 25' &
  lr_pid=$!
  for _ in $(seq 1 100); do
    [ -f "$WT/cmd-started" ] && break
    sleep 0.1
  done
  [ -f "$WT/cmd-started" ]
  kill -TERM "$lr_pid" 2>/dev/null || true
  start="$(date +%s)"
  for _ in $(seq 1 150); do
    kill -0 "$lr_pid" 2>/dev/null || break
    sleep 0.2
  done
  finish="$(date +%s)"
  run kill -0 "$lr_pid"
  [ "$status" -ne 0 ]
  [ "$((finish - start))" -le 25 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="alert") | .payload.tree_kill' "$events"
  [ "$output" = "best_effort" ]
}

# Rework Round 3, finding 2 [HIGH] lane-run.sh ~222 — the tee consumer's own
# pid is now tracked explicitly and reaped via bounded escalation (see
# reap_tee_bounded), replacing the old bare `wait` used to reap "whatever is
# left". Assert no lingering tee process survives lane-run.sh's own exit by
# comparing `ps` snapshots before and shortly after, per this rework's
# instruction to compare process snapshots. A raw total-process-count
# comparison proved too noisy to use directly in this shared, multi-agent
# host (unrelated bash processes churn constantly from other concurrent
# activity on the machine); this host's `ps` DOES reliably print each
# process's command path, though, so filtering specifically for
# `/usr/bin/tee` gives a clean, targeted signal instead.
@test "lane-run reaps the tee consumer; no leftover tee process survives after exit" {
  before="$(ps | grep -c '/usr/bin/tee' || true)"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo hello; echo world'
  [ "$status" -eq 0 ]
  after="$before"
  for _ in $(seq 1 30); do
    after="$(ps | grep -c '/usr/bin/tee' || true)"
    [ "$after" -le "$before" ] && break
    sleep 0.1
  done
  [ "$after" -le "$before" ]
}

# Rework Round B, finding 4 [MEDIUM] lane-run.sh:85-124 — the background
# loop's stream.ndjson mtime check had no round boundary, so a stale mtime
# from a PRIOR invocation could be mistaken for current-round activity on
# the very first tick of a fresh invocation. Run lane-run.sh twice against
# the same worktree; round 2 uses DURABLE_CHECKPOINT_INTERVAL=1 with a CMD
# that writes no new stream output, so stream.ndjson's mtime never advances
# past round 2's own start. Assert no "checkpoint" event fires during round 2.
@test "lane-run scopes stream-activity check to this round; stale mtime is not current-round activity" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'echo round1'
  [ "$status" -eq 0 ]
  [ -f "$WT/.harness/stream.ndjson" ]
  # No extra sleep needed here: round 1's own invocation overhead on this
  # host already puts several seconds between its stream.ndjson write and
  # round 2's start, far more than mtime's 1s resolution requires.
  export DURABLE_CHECKPOINT_INTERVAL=1 DURABLE_HEARTBEAT_INTERVAL=0
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'sleep 1.3'
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="checkpoint")' "$events"
  [ -z "$output" ]
}

# Rework Round 3 addendum (auditor resolution note on Round B finding 6):
# stream SIZE growth since round start, not mtime, is now the authoritative
# current-round activity signal (see round_start_size / round_start_epoch in
# lane-run.sh) -- this closes the exact gap the mtime-only `>=` fix left
# open: a file already holding bytes from an EARLIER write, observed in the
# SAME SECOND as this round's start (so 1-second mtime resolution cannot
# distinguish it), must never be mistaken for current-round activity.
# Pre-touch stream.ndjson with leftover content immediately before invoking
# lane-run.sh (same second, by construction) and give CMD zero output of its
# own; size never grows past round_start_size, so no checkpoint should fire
# regardless of mtime.
@test "lane-run stream-activity check uses size delta; a same-second pre-existing write is not current-round activity" {
  mkdir -p "$WT/.harness"
  printf '{"type":"leftover"}\n' > "$WT/.harness/stream.ndjson"
  export DURABLE_CHECKPOINT_INTERVAL=1 DURABLE_HEARTBEAT_INTERVAL=0
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'sleep 1.3'
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="checkpoint")' "$events"
  [ -z "$output" ]
}

# Rework Round B, finding 5 [LOW] arity/pre-lock failure paths and lock
# removal owned by another process — cleanup() must only rmdir the lock
# THIS process created (explicit lane_lock_owned flag), not one owned by
# another lane-run process. Assert a foreign, pre-held lock survives a
# refused acquisition attempt, and that this process's own lock is still
# released normally on a subsequent successful run.
@test "lane-run only removes the lock it created; a foreign lock survives, its own lock is released" {
  mkdir -p "$WT/.harness/lane.lock"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'true'
  [ "$status" -eq 2 ]
  [ -d "$WT/.harness/lane.lock" ]
  rmdir "$WT/.harness/lane.lock"

  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c 'true'
  [ "$status" -eq 0 ]
  [ ! -d "$WT/.harness/lane.lock" ]
}

# Rework Round 3, finding 3 [LOW] lane-run.sh ~52 — NOT independently tested
# here, documented instead. The window this closes is a signal landing AFTER
# the `mkdir "$WT/.harness/lane.lock"` syscall returns but BEFORE
# lane_lock_owned=1 / the real cleanup trap is installed — on the order of a
# single syscall's duration. Reliably hitting that window from a bats test
# would require either (a) a real race against another OS process's exact
# scheduling (flaky by construction, and this host's per-process overhead
# already makes even the ~30s el_emit lock-timeout path impractical to drive
# deterministically per finding 1's own test comment above), or (b) adding a
# test-only delay hook into lane-run.sh's production code purely to widen the
# window artificially, which would test the hook rather than the real
# critical section. The fix itself (non-exiting pending-signal trap installed
# BEFORE mkdir, real cleanup trap installed only after ownership is recorded,
# pending signal honored immediately after) is a small, directly-inspectable
# diff reviewed as part of this rework rather than exercised by a timing-
# dependent test.

# Rework Round 4, finding 1+2 [HIGH] lane-run.sh emit_kill_alert /
# kill_cmd_bounded ~58-146 — kill_cmd_bounded used to be able to emit TWO
# independent alert events for a single kill incident (one for the KILL
# escalation itself, a second, separately, for the descendant sweep
# outcome), and it misreported a taskkill rc that just means "nothing left to
# kill" (the target PID/tree was already gone -- a VACUOUS sweep) as a
# genuine sweep_failed. Both are fixed together: the escalation flag and the
# sweep outcome are now computed first and folded into a single
# emit_kill_alert call, and a vacuous not-found rc is folded into the
# "swept" outcome. These three tests drive the three distinct outcomes
# (sweep_failed / sweep_unavailable / clean-no-alert) directly, using the
# same background-lane-run + marker-file + external-TERM pattern as the
# KILL-escalation test above (kill_cmd_bounded's escalation/sweep body is
# only reached via cleanup() while CMD is still alive -- a CMD that has
# already exited on its own takes the early-return branch with no sweep and
# no alert, per lane-run.sh's own early-return guard).
#
# Empirical host note (see FOREMAN_REPORT.md for the full writeup): on this
# host, the REAL "/proc/<pid>/winpid" file for a signaled process becomes
# unreadable essentially immediately on signal delivery -- often before
# `kill -0` even reports the process as gone -- so a test that waits for CMD
# to die and only THEN reads the real /proc/<pid>/winpid cannot reliably
# observe a live winpid at all (it raced to "sweep_unavailable" in every
# manual trial, regardless of test intent). Tests (a) and (c) below sidestep
# that race deterministically using the LANE_PROC_ROOT knob (added for
# exactly this purpose per the spec): CMD reports its own $$ (== the pid
# lane-run.sh's cmd_pid tracks, since CMD is exec'd directly with no extra
# subshell layer) into a marker file, and the test pre-populates
# "$LANE_PROC_ROOT/$cmd_pid/winpid" itself -- with a fixed, real-but-
# nonexistent Windows PID (4000000, the same value empirically probed at
# the top of this task's report) -- BEFORE sending the external TERM that
# triggers kill_cmd_bounded. This makes the winpid read land on a file the
# test controls instead of racing the real /proc entry's lifetime, while
# still exercising the REAL taskkill.exe rc-mapping logic under test in (c).

# (a) sweep_failed: CMD ignores TERM outright (proven pattern from the
# KILL-escalation test above), forcing kill_cmd_bounded to escalate to KILL.
# PATH-inject a fake `taskkill` that always exits 1 (a genuinely-nonzero,
# non-128 rc) ahead of the real taskkill.exe, and pre-populate a
# LANE_PROC_ROOT winpid file (see note above) so the sweep step reliably
# reaches the taskkill call. Assert exactly one alert event fires, carrying
# payload.sweep=="sweep_failed" and the unchanged payload.tree_kill=="best_effort".
@test "lane-run kill_cmd_bounded: sweep_failed emits exactly one alert with payload.sweep=sweep_failed" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  cat > "$stub_dir/taskkill" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "$stub_dir/taskkill"
  export PATH="$stub_dir:$PATH"
  proc_root="$BATS_TEST_TMPDIR/proc-a"
  mkdir -p "$proc_root"
  export LANE_PROC_ROOT="$proc_root"
  export LANE_KILL_GRACE=1

  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'trap "" TERM; echo $$ > "'"$WT"'/cmd-pid"; touch "'"$WT"'/cmd-started"; sleep 25' &
  lr_pid=$!
  for _ in $(seq 1 100); do
    [ -f "$WT/cmd-started" ] && [ -f "$WT/cmd-pid" ] && break
    sleep 0.1
  done
  [ -f "$WT/cmd-started" ]
  [ -f "$WT/cmd-pid" ]
  cmd_pid="$(cat "$WT/cmd-pid")"
  mkdir -p "$proc_root/$cmd_pid"
  echo "4000000" > "$proc_root/$cmd_pid/winpid"

  kill -TERM "$lr_pid" 2>/dev/null || true
  for _ in $(seq 1 150); do
    kill -0 "$lr_pid" 2>/dev/null || break
    sleep 0.2
  done
  run kill -0 "$lr_pid"
  [ "$status" -ne 0 ]

  events="$(run_dir run1)/events.jsonl"
  run bash -c "jq -c 'select(.type==\"alert\")' '$events' | jq -s 'length'"
  [ "$output" = "1" ]
  run jq -rc 'select(.type=="alert") | .payload.sweep' "$events"
  [ "$output" = "sweep_failed" ]
  run jq -rc 'select(.type=="alert") | .payload.tree_kill' "$events"
  [ "$output" = "best_effort" ]
}

# (b) sweep_unavailable: point LANE_PROC_ROOT at an empty temp dir so
# "$LANE_PROC_ROOT/$pid/winpid" can never resolve for ANY pid, simulating a
# host with no /proc/*/winpid support without touching the real /proc (this
# one needs no pid correlation at all -- the dir is simply always empty).
# Assert exactly one alert event with payload.sweep=="sweep_unavailable".
@test "lane-run kill_cmd_bounded: sweep_unavailable emits exactly one alert with payload.sweep=sweep_unavailable" {
  export LANE_PROC_ROOT="$BATS_TEST_TMPDIR/empty-proc"
  mkdir -p "$LANE_PROC_ROOT"
  export LANE_KILL_GRACE=1

  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'trap "" TERM; touch "'"$WT"'/cmd-started"; sleep 25' &
  lr_pid=$!
  for _ in $(seq 1 100); do
    [ -f "$WT/cmd-started" ] && break
    sleep 0.1
  done
  [ -f "$WT/cmd-started" ]
  kill -TERM "$lr_pid" 2>/dev/null || true
  for _ in $(seq 1 150); do
    kill -0 "$lr_pid" 2>/dev/null || break
    sleep 0.2
  done
  run kill -0 "$lr_pid"
  [ "$status" -ne 0 ]

  events="$(run_dir run1)/events.jsonl"
  run bash -c "jq -c 'select(.type==\"alert\")' '$events' | jq -s 'length'"
  [ "$output" = "1" ]
  run jq -rc 'select(.type=="alert") | .payload.sweep' "$events"
  [ "$output" = "sweep_unavailable" ]
}

# (c) clean path: CMD responds to TERM promptly (a short-sleep polling loop,
# not one long `sleep`, so bash's trap can actually preempt it between
# iterations -- empirically confirmed via instrumentation to land
# kill_cmd_bounded's escalated flag at 0, i.e. genuinely no KILL needed),
# and the REAL taskkill.exe (no PATH stub) runs against a pre-populated
# LANE_PROC_ROOT winpid pointing at a real-but-nonexistent PID (see note
# above) -- so the sweep step exercises the actual empirically-confirmed
# vacuous rc==128 "process not found" mapping to "swept", not a fabricated
# outcome. Assert ZERO alert events: neither escalation nor a vacuous sweep
# is a failure, and neither should be operator-visible noise.
@test "lane-run kill_cmd_bounded: clean TERM exit + vacuous real sweep emits zero alert events" {
  proc_root="$BATS_TEST_TMPDIR/proc-c"
  mkdir -p "$proc_root"
  export LANE_PROC_ROOT="$proc_root"

  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'trap "exit 0" TERM; echo $$ > "'"$WT"'/cmd-pid"; touch "'"$WT"'/cmd-started"; while true; do sleep 0.1; done' &
  lr_pid=$!
  for _ in $(seq 1 100); do
    [ -f "$WT/cmd-started" ] && [ -f "$WT/cmd-pid" ] && break
    sleep 0.1
  done
  [ -f "$WT/cmd-started" ]
  [ -f "$WT/cmd-pid" ]
  cmd_pid="$(cat "$WT/cmd-pid")"
  mkdir -p "$proc_root/$cmd_pid"
  echo "4000000" > "$proc_root/$cmd_pid/winpid"

  kill -TERM "$lr_pid" 2>/dev/null || true
  for _ in $(seq 1 150); do
    kill -0 "$lr_pid" 2>/dev/null || break
    sleep 0.2
  done
  run kill -0 "$lr_pid"
  [ "$status" -ne 0 ]

  events="$(run_dir run1)/events.jsonl"
  run jq -rc 'select(.type=="alert")' "$events"
  [ -z "$output" ]
}

# Bonus item (V4 audit finding, LOW) -- regression test for the OR-branch at
# the single alert point (lane-run.sh ~171): `(( escalated == 1 )) ||
# [[ "$outcome" == "sweep_failed" || ... ]]`. The three kill_cmd_bounded tests
# above cover escalated=1 WITH sweep_failed (a), sweep_unavailable
# un-escalated (b), and the fully clean escalated=0 + outcome=swept path (c)
# -- none of them isolates the SECOND disjunct on its own: escalated=0 (CMD
# responded to TERM promptly, no KILL needed) but the sweep step itself still
# fails. Without the `||`, a future edit collapsing it to `&&` would silently
# stop alerting on exactly this combination (a real kill-tree failure with no
# other symptom) and this test would be the only thing left to catch it.
# Reuses test (c)'s prompt-TERM-response CMD pattern (so kill_cmd_bounded's
# escalated flag lands at 0, not 1) combined with test (a)'s PATH-stubbed
# always-fail taskkill and pre-populated LANE_PROC_ROOT winpid (so the sweep
# step reliably reaches -- and fails -- the stubbed taskkill instead of
# racing the real /proc entry's lifetime).
@test "lane-run kill_cmd_bounded: no-escalation-but-sweep_failed still emits exactly one alert" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  cat > "$stub_dir/taskkill" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "$stub_dir/taskkill"
  export PATH="$stub_dir:$PATH"
  proc_root="$BATS_TEST_TMPDIR/proc-noesc"
  mkdir -p "$proc_root"
  export LANE_PROC_ROOT="$proc_root"

  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'trap "exit 0" TERM; echo $$ > "'"$WT"'/cmd-pid"; touch "'"$WT"'/cmd-started"; while true; do sleep 0.1; done' &
  lr_pid=$!
  for _ in $(seq 1 100); do
    [ -f "$WT/cmd-started" ] && [ -f "$WT/cmd-pid" ] && break
    sleep 0.1
  done
  [ -f "$WT/cmd-started" ]
  [ -f "$WT/cmd-pid" ]
  cmd_pid="$(cat "$WT/cmd-pid")"
  mkdir -p "$proc_root/$cmd_pid"
  echo "4000000" > "$proc_root/$cmd_pid/winpid"

  kill -TERM "$lr_pid" 2>/dev/null || true
  for _ in $(seq 1 150); do
    kill -0 "$lr_pid" 2>/dev/null || break
    sleep 0.2
  done
  run kill -0 "$lr_pid"
  [ "$status" -ne 0 ]

  events="$(run_dir run1)/events.jsonl"
  run bash -c "jq -c 'select(.type==\"alert\")' '$events' | jq -s 'length'"
  [ "$output" = "1" ]
  run jq -rc 'select(.type=="alert") | .payload.sweep' "$events"
  [ "$output" = "sweep_failed" ]
  run jq -rc 'select(.type=="alert") | .payload.tree_kill' "$events"
  [ "$output" = "best_effort" ]
}
