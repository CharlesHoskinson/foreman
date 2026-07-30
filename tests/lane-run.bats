#!/usr/bin/env bats
# @description Tests for lane-run.sh durable-lanes wrapper.
load helpers

# T2 launcher-absence-assumption verification (spec-required, done before any
# code changes): on this host, at the time this task started, neither
# launcher/dist/foreman-launch(.exe) nor a PATH-resolvable `foreman-launch`
# existed, so all 18 pre-T2 tests below already exercised lane_resolve_launcher's
# ABSENT branch by construction. That assumption does NOT survive this same
# task building the real binary for the skip-guarded integration test further
# down (a permanent artifact on disk in this worktree from that point on), so
# every test in this file -- old and new -- gets an explicit, unconditional
# FOREMAN_LAUNCH override here pointing at a guaranteed-nonexistent path. Per
# the spec's own neutralization instruction, this decouples every test's
# launcher-present/absent behavior from disk state: the 18 pre-T2 tests stay
# on the frozen absent path regardless of whether launcher/dist has since been
# built, and any NEW test that wants launcher-present behavior does so by
# re-exporting FOREMAN_LAUNCH itself (fake shim or the real compiled exe),
# which simply shadows this default within that test's own body.
setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch-binary"
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

# @description Write a deterministic fake foreman-launch shim to
#   DIR/foreman-launch (T2): parses just enough of the frozen CLI contract to
#   be a drop-in for lane-run.sh's own invocation shape (--heartbeat-file,
#   --heartbeat-interval, `-- CMD...`), records its ORIGINAL argv to
#   FAKE_LAUNCHER_ARGV_LOG (if set, for assertion), emits ONE synthetic
#   heartbeat line matching the frozen {ts,launcher_pid,pid,job_id,alive,
#   stdout_bytes,stderr_bytes,elapsed_s} schema to --heartbeat-file BEFORE
#   running CMD (mirroring the real launcher's "first heartbeat fires
#   immediately at spawn" contract), then runs CMD and exits either CMD's own
#   code or a forced code via FAKE_LAUNCHER_EXIT (simulating the real
#   launcher's own 124/125 outcomes) -- deterministic, no dependency on the
#   compiled binary.
# @arg $1 dir directory to write the shim into (caller adds it to PATH, or
#   points FOREMAN_LAUNCH directly at DIR/foreman-launch)
write_fake_launcher() {
  local dir="$1"
  cat > "$dir/foreman-launch" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
orig_argv=("$@")
hb=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --heartbeat-file) hb="$2"; shift 2 ;;
    --heartbeat-interval) shift 2 ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
if [[ -n "${FAKE_LAUNCHER_ARGV_LOG:-}" ]]; then
  printf '%s\n' "${orig_argv[*]}" >> "$FAKE_LAUNCHER_ARGV_LOG"
fi
launcher_pid=$$
child_pid=$((launcher_pid + 1000))
job_id="job-$child_pid"
write_hb() {
  [[ -z "$hb" ]] && return 0
  local alive="$1" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","launcher_pid":%d,"pid":%d,"job_id":"%s","alive":%s,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}\n' \
    "$ts" "$launcher_pid" "$child_pid" "$job_id" "$alive" >> "$hb"
}
write_hb true
if [[ -n "${FAKE_LAUNCHER_EXIT:-}" ]]; then
  "$@" < /dev/null > /dev/null 2>&1 &
  wait $! || true
  write_hb false
  exit "$FAKE_LAUNCHER_EXIT"
fi
"$@" < /dev/null &
cmd_pid=$!
wait "$cmd_pid"
rc=$?
write_hb false
exit "$rc"
SHIM
  chmod +x "$dir/foreman-launch"
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
# bats test_tags=slow
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
# bats test_tags=slow
@test "lane-run bounded-kills CMD's own pid on TERM; lane-run.sh itself never hangs" {
  bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'sleep 100 & echo $! > "'"$WT"'/child.pid"; wait' &
  lr_pid=$!
  # Liveness bound for the SETUP, not the property under test. 50*0.1s is the
  # tightest wait in this file and the only one that fails under full-suite
  # load: green standalone and under `run.sh tests/lane-run.bats`, red when it
  # runs as one of 41 files on a loaded box (observed 2026-07-30, runs 3 and 4;
  # green in run 1). Same class as tests/eventlog.bats's load-dependent
  # contention test. Matched to the 150-iteration bound this file already uses
  # for lane-run.sh's own exit; the assertion below is unchanged, so a
  # child.pid that never appears still fails.
  for _ in $(seq 1 150); do
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
# bats test_tags=slow
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
  # T2 addendum: exclude the new unconditional per-round degraded alert
  # ({kind:"degraded",reason:"launcher_absent"}, distinguishable by its
  # "kind" key -- the pre-existing kill-escalation alert never has one) from
  # this pre-existing query. This test predates T2 and asserts only about
  # the kill-escalation alert; the underlying kill_cmd_bounded/emit_kill_alert
  # behavior under test here is completely unchanged.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded") | .payload.tree_kill' "$events"
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
# bats test_tags=slow
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
# bats test_tags=slow
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
# bats test_tags=slow
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
# bats test_tags=slow
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
  # T2 addendum: see the tree_kill query above -- the new unconditional
  # degraded alert would otherwise make this an off-by-one count forever.
  run bash -c "jq -c 'select(.type==\"alert\" and .payload.kind != \"degraded\")' '$events' | jq -s 'length'"
  [ "$output" = "1" ]
  # T2 addendum: see the tree_kill query above -- exclude the new
  # unconditional degraded alert, which has no bearing on this test's
  # kill_cmd_bounded sweep-outcome assertion.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded") | .payload.sweep' "$events"
  [ "$output" = "sweep_failed" ]
  # T2 addendum: exclude the new unconditional per-round degraded alert
  # ({kind:"degraded",reason:"launcher_absent"}, distinguishable by its
  # "kind" key -- the pre-existing kill-escalation alert never has one) from
  # this pre-existing query. This test predates T2 and asserts only about
  # the kill-escalation alert; the underlying kill_cmd_bounded/emit_kill_alert
  # behavior under test here is completely unchanged.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded") | .payload.tree_kill' "$events"
  [ "$output" = "best_effort" ]
}

# (b) sweep_unavailable: point LANE_PROC_ROOT at an empty temp dir so
# "$LANE_PROC_ROOT/$pid/winpid" can never resolve for ANY pid, simulating a
# host with no /proc/*/winpid support without touching the real /proc (this
# one needs no pid correlation at all -- the dir is simply always empty).
# Assert exactly one alert event with payload.sweep=="sweep_unavailable".
# bats test_tags=slow
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
  # T2 addendum: see the tree_kill query above -- the new unconditional
  # degraded alert would otherwise make this an off-by-one count forever.
  run bash -c "jq -c 'select(.type==\"alert\" and .payload.kind != \"degraded\")' '$events' | jq -s 'length'"
  [ "$output" = "1" ]
  # T2 addendum: see the tree_kill query above -- exclude the new
  # unconditional degraded alert, which has no bearing on this test's
  # kill_cmd_bounded sweep-outcome assertion.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded") | .payload.sweep' "$events"
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
# bats test_tags=slow
@test "lane-run kill_cmd_bounded: clean TERM exit + vacuous real sweep emits zero alert events" {
  # The "vacuous sweep" outcome requires a real `taskkill` returning its
  # process-not-found code for the synthetic winpid below (lane-run.sh:461-470).
  # With no taskkill the outcome is sweep_failed, not vacuously swept, so the
  # alert this test asserts is absent would legitimately fire.
  command -v taskkill >/dev/null 2>&1 \
    || skip "taskkill unavailable: the Windows //T descendant sweep cannot be vacuous on this host"
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
  # T2 addendum: see the tree_kill query above -- exclude the new
  # unconditional degraded alert, which fires every round regardless of
  # kill_cmd_bounded's outcome and would otherwise make this permanently
  # non-empty. The clean-path guarantee under test (no KILL-escalation/sweep
  # alert) is unaffected.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded")' "$events"
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
# bats test_tags=slow
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
  # T2 addendum: see the tree_kill query above -- the new unconditional
  # degraded alert would otherwise make this an off-by-one count forever.
  run bash -c "jq -c 'select(.type==\"alert\" and .payload.kind != \"degraded\")' '$events' | jq -s 'length'"
  [ "$output" = "1" ]
  # T2 addendum: see the tree_kill query above -- exclude the new
  # unconditional degraded alert, which has no bearing on this test's
  # kill_cmd_bounded sweep-outcome assertion.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded") | .payload.sweep' "$events"
  [ "$output" = "sweep_failed" ]
  # T2 addendum: exclude the new unconditional per-round degraded alert
  # ({kind:"degraded",reason:"launcher_absent"}, distinguishable by its
  # "kind" key -- the pre-existing kill-escalation alert never has one) from
  # this pre-existing query. This test predates T2 and asserts only about
  # the kill-escalation alert; the underlying kill_cmd_bounded/emit_kill_alert
  # behavior under test here is completely unchanged.
  run jq -rc 'select(.type=="alert" and .payload.kind != "degraded") | .payload.tree_kill' "$events"
  [ "$output" = "best_effort" ]
}

# T2 (v0.2.5 round ownership) -- new coverage below this point. All 18 tests
# above are the frozen pre-T2 set (Round B / Rework Round 3-4), unmodified.

# T2 spec: "Absent -> today's direct-spawn path + one alert event
# {kind:degraded, reason:launcher_absent} per round." Every test in this file
# already runs on the absent path (setup's FOREMAN_LAUNCH neutralization), so
# this is exercised constantly; this test makes the alert's presence and
# shape an explicit, direct assertion, and confirms it fires exactly ONCE
# per round (not once per el_emit-guarded call site).
@test "lane-run (launcher absent): emits exactly one degraded alert per round" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "true"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"alert\" and .payload.kind==\"degraded\") | .payload.reason" "$events"
  [ "$output" = "launcher_absent" ]
  run bash -c "jq -c \"select(.type==\\\"alert\\\" and .payload.kind==\\\"degraded\\\")\" \"$events\" | jq -s length"
  [ "$output" = "1" ]
}

# T2 spec: ownership event at spawn, payload
# {attempt, launcher_pid, pid, job_id, worktree, config_dir, launcher} --
# pid/job_id parsed from the FIRST heartbeat line of the round's heartbeat
# file. Uses the fake launcher shim (deterministic, no dependency on the
# compiled binary) on PATH; FOREMAN_LAUNCH is unset so resolution goes
# through the PATH-lookup probe (lane_resolve_launcher's third precedence
# tier), covering that probe explicitly. Also checks
# round_done.exit_source==child for the plain-exit-0 case (the fourth
# interface bullet: 124/125/child exit_source mapping -- see the two
# dedicated forced-exit tests below for 124/125).
@test "lane-run (launcher present via PATH shim): ownership event carries attempt/pid/job_id/launcher_pid/worktree; exit_source=child" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "echo hi"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"ownership\") | .payload.launcher" "$events"
  [ "$output" = "true" ]
  run jq -rc "select(.type==\"ownership\") | .payload.attempt" "$events"
  [ "$output" = "1" ]
  run jq -rc "select(.type==\"ownership\") | .payload.pid" "$events"
  [ "$output" != "null" ]; [ -n "$output" ]
  run jq -rc "select(.type==\"ownership\") | .payload.job_id" "$events"
  [ "$output" != "null" ]; [ -n "$output" ]
  run jq -rc "select(.type==\"ownership\") | .payload.launcher_pid" "$events"
  [ "$output" != "null" ]; [ -n "$output" ]
  run jq -rc "select(.type==\"ownership\") | .payload.worktree" "$events"
  [ "$output" = "$WT" ]
  run jq -rc "select(.type==\"round_done\") | .payload.exit_source" "$events"
  [ "$output" = "child" ]
  # No ownership-timeout alert on the happy path (heartbeat appears immediately).
  run jq -rc "select(.type==\"alert\" and .payload.kind==\"ownership_timeout\")" "$events"
  [ -z "$output" ]
  # And no degraded alert -- the launcher WAS present.
  run jq -rc "select(.type==\"alert\" and .payload.kind==\"degraded\")" "$events"
  [ -z "$output" ]
}

# T2 spec: round_done.exit_code gains documented launcher codes 124
# (timeout)/125 (launcher error), plus exit_source. FAKE_LAUNCHER_EXIT forces
# the shim's own exit code, simulating the real launcher's --timeout kill
# (124) outcome without any real wall-clock wait.
@test "lane-run (launcher present): round_done exit_code=124 maps to exit_source=timeout" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  export FAKE_LAUNCHER_EXIT=124
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "true"
  [ "$status" -eq 124 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"round_done\") | .payload.exit_code" "$events"
  [ "$output" = "124" ]
  run jq -rc "select(.type==\"round_done\") | .payload.exit_source" "$events"
  [ "$output" = "timeout" ]
}

# Same as above for the launcher's own error code (125 = bad args/FFI/spawn
# failure/--detach handoff timeout, per launcher/README.md).
@test "lane-run (launcher present): round_done exit_code=125 maps to exit_source=launcher" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  export FAKE_LAUNCHER_EXIT=125
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "true"
  [ "$status" -eq 125 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"round_done\") | .payload.exit_code" "$events"
  [ "$output" = "125" ]
  run jq -rc "select(.type==\"round_done\") | .payload.exit_source" "$events"
  [ "$output" = "launcher" ]
}

# T2 spec: --round GATE_CMD REPORT_PATH mode happy path (gate green + fresh
# report -> round_done). CMD itself writes REPORT_PATH (with an
# "attempt: 1" line, doubling as the secondary attempt-string freshness
# signal) strictly AFTER round_prompt_epoch was captured, so the primary
# mtime signal is satisfied too. GATE_CMD ("true", run via bash -c) passes.
@test "lane-run --round: gate green + fresh report -> round_done with gate_rc/report_fresh; no waiting_child" {
  report="$BATS_TEST_TMPDIR/FOREMAN_REPORT.md"
  run bash "$SCRIPTS/lane-run.sh" --round "true" "$report" run1 lane-a "$WT" -- \
    bash -c "echo attempt: 1 > $report"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"round_done\") | .payload.gate_rc" "$events"
  [ "$output" = "0" ]
  run jq -rc "select(.type==\"round_done\") | .payload.report_fresh" "$events"
  [ "$output" = "true" ]
  run jq -rc "select(.type==\"waiting_child\")" "$events"
  [ -z "$output" ]
  run jq -rc "select(.type==\"alert\" and .payload.kind==\"round_incomplete\")" "$events"
  [ -z "$output" ]
}

# T2 spec / SC-D stale-report immunity: round_done is NOT emitted when only a
# prior round's report is present. The report is written and its mtime fixed
# BEFORE lane-run.sh (and therefore its round_prompt_epoch) even starts, with
# a real 1.1s sleep bounding out any same-second mtime-vs-epoch aliasing
# (same discipline as this file's pre-existing stream-activity tests), and it
# carries a DIFFERENT attempt id (attempt: 999) so the secondary string
# signal also fails to match -- both freshness signals miss, confirming
# genuine staleness, not a narrowly-missed primary check.
# bats test_tags=slow
@test "lane-run --round SC-D: stale report older than this round's prompt event never satisfies -- no round_done, alert emitted" {
  report="$BATS_TEST_TMPDIR/FOREMAN_REPORT.md"
  printf "attempt: 999\n" > "$report"
  sleep 1.1
  run bash "$SCRIPTS/lane-run.sh" --round "true" "$report" run1 lane-a "$WT" -- bash -c "true"
  [ "$status" -ne 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"round_done\")" "$events"
  [ -z "$output" ]
  run jq -rc "select(.type==\"waiting_child\") | .payload.report_fresh" "$events"
  [ "$output" = "false" ]
  run jq -rc "select(.type==\"alert\" and .payload.kind==\"round_incomplete\") | .payload.report_fresh" "$events"
  [ "$output" = "false" ]
}

# T2 spec: --round gate-fail -- the report IS fresh (CMD wrote it), but
# GATE_CMD itself fails; round_done must still never fire (both conditions
# are required, not just freshness), and the alert must carry the real
# nonzero gate_rc.
@test "lane-run --round: gate failure never emits round_done even with a fresh report; alert carries gate_rc" {
  report="$BATS_TEST_TMPDIR/FOREMAN_REPORT.md"
  run bash "$SCRIPTS/lane-run.sh" --round "exit 7" "$report" run1 lane-a "$WT" -- \
    bash -c "echo attempt: 1 > $report"
  [ "$status" -eq 7 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"round_done\")" "$events"
  [ -z "$output" ]
  run jq -rc "select(.type==\"alert\" and .payload.kind==\"round_incomplete\") | .payload.gate_rc" "$events"
  [ "$output" = "7" ]
}

# v0.2.5 T4b: the ONLY additive change lane-run.sh makes for T4b -- a
# {state:"verifying"} event, fired once, right as the gate is about to spawn
# (launcher-absent branch here, matching this file's own default
# neutralization). Carries payload.attempt matching the round's own attempt
# id (1, for a lane's first-ever round) so watch.sh's v2 typed-state machine
# can scope it to the current attempt.
@test "lane-run --round (T4b): emits exactly one {state:verifying} event with the round's attempt id, before the gate runs" {
  report="$BATS_TEST_TMPDIR/FOREMAN_REPORT.md"
  run bash "$SCRIPTS/lane-run.sh" --round "true" "$report" run1 lane-a "$WT" -- \
    bash -c "echo attempt: 1 > $report"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"state\" and .payload.state==\"verifying\") | .payload.attempt" "$events"
  [ "$output" = "1" ]
  run bash -c "jq -c \"select(.type==\\\"state\\\" and .payload.state==\\\"verifying\\\")\" \"$events\" | jq -s length"
  [ "$output" = "1" ]
  # Ordering: the verifying event precedes round_done (it marks the START of
  # the gate phase, not its outcome).
  run jq -rc '.type' "$events"
  state_line=0; round_done_line=0; i=0
  for t in "${lines[@]}"; do
    i=$((i+1))
    [ "$t" = "state" ] && state_line=$i
    [ "$t" = "round_done" ] && round_done_line=$i
  done
  [ "$state_line" -gt 0 ]
  [ "$round_done_line" -gt 0 ]
  [ "$state_line" -lt "$round_done_line" ]
}

# v0.2.5 T4b: the verifying event marks "the gate spawned", not "the gate
# succeeded" -- it must still fire even when GATE_CMD itself goes on to fail
# (round_done never emitted in that case, per the pre-existing SC-D/gate-fail
# tests above; the verifying event is orthogonal to that outcome).
@test "lane-run --round (T4b): {state:verifying} still fires when the gate itself fails" {
  report="$BATS_TEST_TMPDIR/FOREMAN_REPORT.md"
  run bash "$SCRIPTS/lane-run.sh" --round "exit 7" "$report" run1 lane-a "$WT" -- \
    bash -c "echo attempt: 1 > $report"
  [ "$status" -eq 7 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"state\" and .payload.state==\"verifying\")" "$events"
  [ -n "$output" ]
}

# v0.2.5 T4b: plain (non---round) mode is UNCHANGED -- no {state:verifying}
# event, ever, outside --round mode (the phase concept only exists there).
@test "lane-run (T4b): plain non-round mode never emits a {state:verifying} event" {
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "true"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"state\")" "$events"
  [ -z "$output" ]
}

# v0.2.5 T4b: the launcher-PRESENT branch also emits it (unconditional across
# both GATE_CMD spawn branches, per the spec's "when the gate launcher
# spawns" -- not launcher-present-only).
@test "lane-run --round (launcher present via PATH shim) (T4b): {state:verifying} still fires" {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export PATH="$stub_dir:$PATH"
  unset FOREMAN_LAUNCH
  report="$BATS_TEST_TMPDIR/FOREMAN_REPORT.md"
  run bash "$SCRIPTS/lane-run.sh" --round "true" "$report" run1 lane-a "$WT" -- \
    bash -c "echo attempt: 1 > $report"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"state\" and .payload.state==\"verifying\") | .payload.attempt" "$events"
  [ "$output" = "1" ]
}

# T2 spec: plus ONE integration test against the real
# launcher/dist/foreman-launch.exe if present, skip-guarded. Mirrors
# tests/launcher.bats's own skip pattern exactly (compiled exe not found ->
# skip with the build hint, never a failure). Exercises the SAME lane-run.sh
# code path as the fake-shim tests above, but against the real compiled
# binary end to end.
@test "lane-run (real compiled launcher, skip-guarded): ownership + round_done via the real foreman-launch.exe" {
  EXE_DIR="$BATS_TEST_DIRNAME/../launcher/dist"
  [ -d "$EXE_DIR" ] || skip "compiled exe not found at $EXE_DIR -- run: pwsh -File launcher/build.ps1"
  EXE="$(cd "$EXE_DIR" && pwd)/foreman-launch.exe"
  [ -f "$EXE" ] || skip "compiled exe not found at $EXE -- run: pwsh -File launcher/build.ps1"
  export FOREMAN_LAUNCH="$EXE"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "echo hi"
  [ "$status" -eq 0 ]
  events="$(run_dir run1)/events.jsonl"
  run jq -rc "select(.type==\"ownership\") | .payload.launcher" "$events"
  [ "$output" = "true" ]
  run jq -rc "select(.type==\"ownership\") | .payload.pid" "$events"
  [ "$output" != "null" ]; [ -n "$output" ]
  run jq -rc "select(.type==\"round_done\") | .payload.exit_code" "$events"
  [ "$output" = "0" ]
  run jq -rc "select(.type==\"round_done\") | .payload.exit_source" "$events"
  [ "$output" = "child" ]
}

# Rework round 1 (Opus audit) -- new coverage below this point.

# F2 (LOW-MEDIUM, POSIX-only SC-B gap): during the --round mode's gate
# phase, LANE_OWNERSHIP_PID used to still hold the CMD phase's (already
# dead) child pid -- on POSIX, a signal during the gate phase would then
# group-kill the wrong pgid while only TERM-ing the gate's own launcher,
# which does not cascade to the gate's setsid'd child group there (Windows
# is unaffected: Job Object KILL_ON_JOB_CLOSE cascades from killing the
# launcher alone). Fix: lane_refresh_gate_ownership_pid re-parses $hb for
# the first NEW heartbeat line past a baseline line count and refreshes
# LANE_OWNERSHIP_PID to the gate's own child pid. This is the only piece of
# that POSIX-only fix testable on this Windows host (a real POSIX
# kill-shot/group-kill integration test is out of scope here per the
# auditor's own note) -- so this test unit-tests the refresh function's
# parsing logic directly and deterministically: it extracts JUST that one
# function from lane-run.sh (sed, start/end markers -- the function has no
# dependencies beyond jq, so no script-wide sourcing/side effects are
# needed or wanted), seeds a heartbeat file with a CMD-phase pid (111,
# baseline = 2 lines already written) then appends a DIFFERENT gate-phase
# pid (222) shortly after the refresh call starts polling -- exercising the
# bounded-poll path, not just an already-fully-written file -- and asserts
# LANE_OWNERSHIP_PID ends up refreshed to the gate's pid, not left stale.
@test "lane-run --round (F2 rework): gate-phase ownership pid refresh picks up the gate's own heartbeat pid, not CMD's stale one" {
  fn_file="$BATS_TEST_TMPDIR/refresh_fn.sh"
  sed -n '/^lane_refresh_gate_ownership_pid()/,/^}/p' "$SCRIPTS/lane-run.sh" > "$fn_file"
  [ -s "$fn_file" ]
  source "$fn_file"

  hb="$BATS_TEST_TMPDIR/hb.ndjson"
  printf '{"ts":"t0","launcher_pid":9001,"pid":111,"job_id":"j1","alive":true,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}\n' >> "$hb"
  printf '{"ts":"t1","launcher_pid":9001,"pid":111,"job_id":"j1","alive":false,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":1.0}\n' >> "$hb"
  baseline="$(wc -l < "$hb")"
  LANE_OWNERSHIP_PID="111"

  ( sleep 0.3; printf '{"ts":"t2","launcher_pid":9002,"pid":222,"job_id":"j2","alive":true,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}\n' >> "$hb" ) &
  bgpid=$!
  lane_refresh_gate_ownership_pid "$hb" "$baseline"
  wait "$bgpid"
  [ "$LANE_OWNERSHIP_PID" = "222" ]
}

# F4 (LOW): the fake shim's FAKE_LAUNCHER_ARGV_LOG support (used by the F2
# test above only indirectly, and available to any future test) was itself
# untested. Pins the exact invocation shape lane-run.sh uses when spawning
# CMD through the launcher: --heartbeat-file F --heartbeat-interval 15 --
# CMD... (this exact flag order and the literal "15" interval, matching the
# CMD-launch site in lane-run.sh).
@test "lane-run (launcher present): fake shim records the exact invocation shape --heartbeat-file F --heartbeat-interval 15 -- CMD..." {
  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  write_fake_launcher "$stub_dir"
  export FOREMAN_LAUNCH="$stub_dir/foreman-launch"
  argv_log="$BATS_TEST_TMPDIR/argv.log"
  export FAKE_LAUNCHER_ARGV_LOG="$argv_log"
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- bash -c "echo hi"
  [ "$status" -eq 0 ]
  [ -f "$argv_log" ]
  recorded="$(cat "$argv_log")"
  hb_path="$WT/.harness/heartbeat.ndjson"
  expected="--heartbeat-file $hb_path --heartbeat-interval 15 -- bash -c echo hi"
  [ "$recorded" = "$expected" ]
}

# Rework round 2 (architect-diagnosed present-path regression caught by the
# full-suite merge gate, config.bats f1 -- the only pre-existing test that
# asserted mid-run STREAM GROWTH; this file's own tests only ever asserted
# exit codes / event payloads for the launcher-present path, never that
# CMD's actual stdout bytes reached stream.ndjson, which is exactly the gap
# this regression lived in).
#
# ROOT CAUSE: on the launcher-present branch, the spawn used to wrap the
# NATIVE launcher exe in $STDBUF ("stdbuf -oL"). stdbuf works via
# LD_PRELOAD=/usr/lib/coreutils/libstdbuf.dll; MSYS silently rewrites that
# value to Windows form (C:\Program Files\Git\usr\lib\coreutils\libstdbuf.dll)
# at the msys->native exec boundary when spawning the compiled launcher; the
# launcher forwards its environment to CMD verbatim (correct per the T1
# contract); CMD's own MSYS bash then colon-splits that Windows path on ITS
# OWN LD_PRELOAD parse and tries to dlopen "C:" as a shared object, hard
# crashing with "*** fatal error - error while loading shared libraries: C:"
# before CMD's real command ever runs -- CMD's stdout is lost entirely (the
# stream file never grows, so no mid-run checkpoint fires) while the
# launcher's own exit code still reads 0, making this silent. Fixed by never
# prefixing the launcher with $STDBUF (collapsed to one un-prefixed
# invocation; $STDBUF still applies, unchanged, on the launcher-absent
# branch, where it is not poisonous and still matters) plus defense-in-depth
# `env -u LD_PRELOAD -u _STDBUF_O -u _STDBUF_E` on the launcher's spawn
# environment.
#
# This class of bug is NOT catchable by this file's deterministic fake-shim
# tests: the shim IS an MSYS bash script itself (not a native exe), so
# spawning it under $STDBUF never crosses the msys->native exec boundary
# that mangles LD_PRELOAD in the first place -- the shim is structurally
# immune, which is exactly why this regression slipped past every
# shim-based test above and was only caught by the architect's full-suite
# gate (config.bats f1) against the REAL compiled binary. This test
# therefore MUST run against the real exe (skip-guarded, tagged slow, same
# pattern as the other real-launcher test above) -- there is no
# deterministic-shim equivalent that would exercise the actual bug.
# bats test_tags=slow
@test "lane-run (real compiled launcher, skip-guarded) rework round 2 regression: launcher-present CMD stdout reaches stream.ndjson (STDBUF-poisoning fix)" {
  EXE_DIR="$BATS_TEST_DIRNAME/../launcher/dist"
  [ -d "$EXE_DIR" ] || skip "compiled exe not found at $EXE_DIR -- run: pwsh -File launcher/build.ps1"
  EXE="$(cd "$EXE_DIR" && pwd)/foreman-launch.exe"
  [ -f "$EXE" ] || skip "compiled exe not found at $EXE -- run: pwsh -File launcher/build.ps1"
  export FOREMAN_LAUNCH="$EXE"
  stream="$WT/.harness/stream.ndjson"
  before_size=0
  if [ -f "$stream" ]; then
    before_size="$(stat -c %s "$stream" 2>/dev/null || stat -f %z "$stream" 2>/dev/null || echo 0)"
  fi
  # CMD echoes a unique marker, then polls briefly (a short real delay, not
  # a fixed instant-exit) so this exercises the same "CMD actually runs for
  # a bit and produces real output through the launcher" shape the
  # regression hid in, before echoing a second marker and exiting.
  run bash "$SCRIPTS/lane-run.sh" run1 lane-a "$WT" -- \
    bash -c 'echo rework-round-2-marker; for _ in $(seq 1 5); do sleep 0.2; done; echo done-polling'
  [ "$status" -eq 0 ]
  [ -f "$stream" ]
  after_size="$(stat -c %s "$stream" 2>/dev/null || stat -f %z "$stream" 2>/dev/null || echo 0)"
  # Stream-durability assertion that was missing: growth AND content, not
  # just lane-run.sh's own exit code (which read 0 even while CMD's stdout
  # was silently lost to the fatal shared-library error).
  [ "$after_size" -gt "$before_size" ]
  grep -q "rework-round-2-marker" "$stream"
  grep -q "done-polling" "$stream"
}
