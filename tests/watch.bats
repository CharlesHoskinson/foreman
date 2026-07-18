#!/usr/bin/env bats
load helpers

setup() {
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  source "$SCRIPTS/watch.sh"
  export STALL_WARN=300 STALL_DEAD=900
}

@test "fresh events keep RUNNING and reset stall count" {
  run wd_state 30 RUNNING 1
  [ "$output" = "RUNNING 0" ]
}
@test "one stalled tick does not transition (debounce)" {
  run wd_state 400 RUNNING 0
  [ "$output" = "RUNNING 1" ]
}
@test "two consecutive stalled ticks transition to STALLED" {
  run wd_state 400 RUNNING 1
  [ "$output" = "STALLED 2" ]
}
@test "exceeding dead threshold transitions to DEAD" {
  run wd_state 1000 STALLED 3
  [ "$output" = "DEAD 4" ]
}
@test "recovery from STALLED back to RUNNING on fresh event" {
  run wd_state 20 STALLED 3
  [ "$output" = "RUNNING 0" ]
}
@test "boundary: age==STALL_WARN with a prior stall transitions to STALLED" {
  run wd_state 300 RUNNING 1
  [ "$output" = "STALLED 2" ]
}
@test "boundary: age==STALL_WARN-1 stays RUNNING" {
  run wd_state 299 RUNNING 1
  [ "$output" = "RUNNING 0" ]
}
@test "boundary: age==STALL_DEAD with a prior stall transitions to DEAD" {
  run wd_state 900 STALLED 1
  [ "$output" = "DEAD 2" ]
}
@test "boundary: age==STALL_DEAD-1 stays STALLED" {
  run wd_state 899 STALLED 1
  [ "$output" = "STALLED 2" ]
}
@test "restart-independence: fresh watchdog debounces once at DEAD age" {
  run wd_state 1000 RUNNING 0
  [ "$output" = "RUNNING 1" ]
}
@test "restart-independence: second observation reaches DEAD" {
  run wd_state 1000 RUNNING 1
  [ "$output" = "DEAD 2" ]
}

# bats test_tags=slow
@test "integration: silent lane reaches exactly one STALLED then one DEAD, exit 3" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
  grep -q 'kill+retry from' <<<"$output"
}

# bats test_tags=slow
@test "integration: completed lane exits 0 fast printing DONE" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

# bats test_tags=slow
@test "integration: lane isolation - lane B heartbeats never mask lane A stall" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt laneA '{}' >/dev/null
  el_emit run1 prompt laneB '{}' >/dev/null
  # Flake mitigation only (not a behavior change): this host's process-spawn
  # cost under concurrent .seq.lock contention (laneB's background emits vs
  # laneA's own watch.sh ticks/alert emits) can occasionally push total wall
  # time past a tight bound. Widened laneB's emit cadence/count and the outer
  # timeout give slack for slow spawns without changing STALL_WARN/STALL_DEAD
  # or the assertions below.
  (
    for i in $(seq 1 30); do
      el_emit run1 heartbeat laneB '{}' >/dev/null 2>&1 || true
      sleep 0.5
    done
  ) &
  bgpid=$!
  run timeout 40 bash "$SCRIPTS/watch.sh" run1 laneA "$REPO"
  kill "$bgpid" 2>/dev/null || true
  wait "$bgpid" 2>/dev/null || true
  [ "$status" -eq 3 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
}

@test "malformed liveness ts keeps the previous age baseline instead of resetting to ~0" {
  setup_tmp_repo
  local log; log="$(seed_run run1)/events.jsonl"
  # Tick 1: a genuinely old, well-formed liveness event -- establishes a large,
  # correctly-cached age baseline (like a prior successful watch.sh tick would).
  # Explicit baseline 0 = unfiltered (same as the ${4:-0} default for 3-arg
  # callers); round-boundary filtering is not under test here.
  printf '{"seq":1,"ts":"2001-01-01T00:00:00Z","type":"heartbeat","lane":"lane1","payload":{}}\n' > "$log"
  local start=$EPOCHSECONDS
  local WD_AGE WD_DONE
  wd_sample run1 lane1 "$start" 0
  [ "$WD_AGE" -gt 100000 ]

  # Tick 2: a NEWER event for the same lane lands with a malformed ts (e.g. a
  # schema hiccup / corrupted line). The fix must NOT reset the baseline to
  # "now" (which would make WD_AGE look artificially fresh and hide the
  # ongoing stall) -- it must keep the previous baseline and warn on stderr.
  printf '{"seq":2,"ts":"not-a-timestamp","type":"heartbeat","lane":"lane1","payload":{}}\n' >> "$log"
  local errfile="$BATS_TEST_TMPDIR/wd_sample.err"
  wd_sample run1 lane1 "$start" 0 2>"$errfile"
  [ "$WD_AGE" -gt 100000 ]
  grep -qi 'unparsable' "$errfile"
}

# bats test_tags=slow
@test "DEAD alert is durably emitted (foreground, status-checked) before exit 3" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  # Synchronous emit means the event is guaranteed durable the instant the
  # process has exited -- no race/grace-period needed to observe it.
  local n_dead
  n_dead="$(jq -r 'select(.type=="alert" and .lane=="lane1" and .payload.state=="DEAD") | .seq' \
    "$FOREMAN_HOME/runs/run1/events.jsonl" | wc -l)"
  [ "$n_dead" -eq 1 ]
  # No fire-and-forget backgrounding/disown pattern left around alert emits.
  ! grep -q 'disown' "$SCRIPTS/watch.sh"
}

# bats test_tags=slow
@test "restart-safe: an already-emitted round_done is not masked by a newer heartbeat" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  # Round-boundary semantics: auto-detect baseline = this round's prompt seq.
  # The round_done has seq > baseline, so the watcher completes. A later
  # heartbeat (higher seq, same lane) is post-baseline liveness only — it does
  # not undo completion of the baseline's round. (If a NEW prompt had appeared
  # instead, that would start a different round with a new baseline.)
  el_emit run1 heartbeat lane1 '{}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

# bats test_tags=slow
@test "round-boundary: prior-round round_done does not complete a watcher baselined after it" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  # Round 1 completed, then round 2's prompt (new baseline) with no further
  # events — the old round_done must not complete this watcher.
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  ! grep -q DONE <<<"$output"
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
}

# bats test_tags=slow
@test "round-boundary: round_done after baseline completes the watcher for its own round" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

# bats test_tags=slow
@test "round-boundary: --after-seq override is respected over auto-detection" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  # prompt seq1, round_done seq2, prompt seq3 → auto-detect baseline=3 would
  # NOT complete (round_done seq2 <= 3). With --after-seq 1, seq2 > 1 so DONE.
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO" --after-seq 1
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

@test "round-boundary: prior-round heartbeats do not refresh a new watcher's liveness age" {
  setup_tmp_repo
  local log; log="$(seed_run run1)/events.jsonl"
  # Old round (stale timestamps) + round-2 prompt with a current real timestamp
  # as the last prompt (becomes baseline). No post-baseline liveness events.
  local now_ts
  now_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' \
    '{"seq":1,"ts":"2001-01-01T00:00:00Z","type":"prompt","lane":"lane1","payload":{}}' \
    '{"seq":2,"ts":"2001-01-01T00:00:01Z","type":"heartbeat","lane":"lane1","payload":{}}' \
    '{"seq":3,"ts":"2001-01-01T00:00:02Z","type":"round_done","lane":"lane1","payload":{}}' \
    "{\"seq\":4,\"ts\":\"${now_ts}\",\"type\":\"prompt\",\"lane\":\"lane1\",\"payload\":{}}" \
    > "$log"
  local baseline
  baseline="$(wd_last_prompt_seq run1 lane1)"
  baseline=${baseline%$'\r'}
  [ "$baseline" = "4" ]
  local start=$EPOCHSECONDS
  local WD_AGE WD_DONE
  wd_sample run1 lane1 "$start" "$baseline"
  # No post-baseline liveness → age falls back to now-start (near 0), not the
  # ancient 2001 heartbeat.
  [ "$WD_AGE" -lt 5 ]
  [ "$WD_DONE" -eq 0 ]
}

# bats test_tags=slow
@test "round-boundary: a legitimate seq-0 last prompt still latches as baseline 0" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  local log; log="$(seed_run run1)/events.jsonl"
  # Imported/recovered log shape: the lane's last (and only) prompt sits at
  # seq 0 -- a legitimate baseline, not "no prompt found". The empty-output
  # sentinel (not "0") is what makes this distinguishable from the truly
  # absent case; if the sentinel were still "0" this seq-0 prompt would be
  # indistinguishable from no prompt at all.
  printf '%s\n' \
    '{"seq":0,"ts":"2001-01-01T00:00:00Z","type":"prompt","lane":"lane1","payload":{}}' \
    '{"seq":1,"ts":"2001-01-01T00:00:01Z","type":"round_done","lane":"lane1","payload":{"exit_code":0}}' \
    > "$log"
  local baseline
  baseline="$(wd_last_prompt_seq run1 lane1)"
  baseline=${baseline%$'\r'}
  [ "$baseline" = "0" ]
  # Auto-detection (no --after-seq) must latch baseline 0 and let the
  # round_done at seq 1 (> baseline) complete the watcher.
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

# bats test_tags=slow
@test "round-boundary: no prompt event ever seen keeps watcher unlatched despite a pre-existing round_done" {
  setup_tmp_repo
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  # No prompt at all for the lane -- wd_last_prompt_seq returns empty output,
  # so the watcher never latches a baseline and a pre-existing round_done
  # must not complete it (contrast to the seq-0 case above, which does
  # latch). Falls back to the same silent-lane STALLED-then-DEAD path.
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  ! grep -q DONE <<<"$output"
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
}

@test "cold-start: first-ever liveness event with corrupt ts forces STALL_WARN age" {
  setup_tmp_repo
  local log; log="$(seed_run run1)/events.jsonl"
  # Single malformed-ts event, no prior cached good epoch.
  printf '{"seq":1,"ts":"not-a-timestamp","type":"heartbeat","lane":"lane1","payload":{}}\n' > "$log"
  _WD_LIVE_SEQ_CACHE=""
  _WD_LIVE_EPOCH_CACHE=""
  local start=$EPOCHSECONDS
  local WD_AGE WD_DONE
  local errfile="$BATS_TEST_TMPDIR/wd_sample_cold.err"
  local warn="${STALL_WARN:-300}"
  wd_sample run1 lane1 "$start" 0 2>"$errfile"
  [ "$WD_AGE" -eq "$warn" ]
  grep -qi 'unparsable' "$errfile"
  # Two consecutive observations at this age must escalate via debounce:
  # RUNNING → RUNNING(1) → STALLED(2), not stay fresh forever.
  run wd_state "$WD_AGE" RUNNING 0
  [ "$output" = "RUNNING 1" ]
  run wd_state "$WD_AGE" RUNNING 1
  [ "$output" = "STALLED 2" ]
}

# --- T4a VTICK: clock seam + fractional-tick fix (2026-07-18) ---------------
# New tests only below this line. All FAST (no slow tag): the VTICK twins
# replace real sleeping with an instantly-advanced fake clock (see
# vtick_init in helpers.bash), and the fractional-tick regression is bounded
# by a short `timeout` on the default clock. None of the 24 tests above this
# marker were modified.

@test "fractional-tick regression: WATCH_TICK=0.01 with default clock does not crash (bounded run)" {
  setup_tmp_repo
  export WATCH_TICK=0.01 STALL_WARN=300 STALL_DEAD=900
  el_emit run1 prompt lane1 '{}' >/dev/null
  # Pre-fix, wd_sleep_remainder's `tick * 1000` bash-arithmetic on the
  # fractional literal "0.01" throws "arithmetic syntax error (error token
  # \".01\")" on the very first tick and the process dies almost instantly.
  # With STALL_WARN/STALL_DEAD left at their (huge) defaults, no state
  # transition is possible within the bounded window, so the ONLY green
  # outcome post-fix is the loop surviving until `timeout` kills it (124).
  run timeout 1 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 124 ]
}

@test "VTICK: silent lane reaches exactly one STALLED then one DEAD, exit 3 (fast twin of the wall-clock original)" {
  setup_tmp_repo
  vtick_init
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
  grep -q 'kill+retry from' <<<"$output"
}

@test "VTICK: round-boundary completion - round_done after baseline completes for its own round (fast twin)" {
  setup_tmp_repo
  vtick_init
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

@test "VTICK: cold-start corrupt-ts fail-safe forces STALL_WARN age under the fake clock too (fast twin)" {
  setup_tmp_repo
  vtick_init
  local log; log="$(seed_run run1)/events.jsonl"
  # First-ever liveness event is corrupt -- no prior cached good epoch.
  printf '{"seq":1,"ts":"not-a-timestamp","type":"heartbeat","lane":"lane1","payload":{}}\n' > "$log"
  _WD_LIVE_SEQ_CACHE=""
  _WD_LIVE_EPOCH_CACHE=""
  local start; start=$(( $(wd_now_ms) / 1000 ))
  local WD_AGE WD_DONE
  local errfile="$BATS_TEST_TMPDIR/wd_sample_cold_vtick.err"
  local warn="${STALL_WARN:-300}"
  wd_sample run1 lane1 "$start" 0 2>"$errfile"
  [ "$WD_AGE" -eq "$warn" ]
  grep -qi 'unparsable' "$errfile"
  # Same debounce escalation the wall-clock original demonstrates, proving
  # the fallback age is unaffected by routing wd_sample's "now" through the
  # WATCH_CLOCK_CMD seam instead of a bare EPOCHSECONDS read.
  run wd_state "$WD_AGE" RUNNING 0
  [ "$output" = "RUNNING 1" ]
  run wd_state "$WD_AGE" RUNNING 1
  [ "$output" = "STALLED 2" ]
}

@test "VTICK: unlatched-path age computation reaches STALLED then DEAD, exit 3 (fast twin)" {
  setup_tmp_repo
  vtick_init
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  # No prompt ever -- wd_last_prompt_seq returns empty output forever, so the
  # watcher never latches and never calls wd_sample; age comes entirely from
  # wd_main's unlatched fallback (now - start_epoch), exercising the OTHER
  # time read this seam had to cover besides wd_sample's latched path.
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  ! grep -q DONE <<<"$output"
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
}

@test "VTICK: real thresholds (STALL_WARN=300/STALL_DEAD=900) walked via a wall-clock-unreachable tick -- load-bearing seam proof (rework F1)" {
  setup_tmp_repo
  vtick_init
  # STALL_WARN/STALL_DEAD are the SHIPPED production defaults, not a
  # test-scale override -- the wall clock alone cannot reach DEAD (900s)
  # inside the 10s timeout below. A large WATCH_TICK (500s/tick) reaches it
  # in just 2 virtual ticks, but ONLY if WATCH_CLOCK_CMD/WATCH_SLEEP_CMD are
  # actually honored end-to-end. This makes the fake clock STRUCTURALLY
  # required for green, not just a speed optimization: if the seam wiring
  # were silently removed (or wd_now_ms/wd_sleep_ms silently fell back to
  # the real clock), this test would time out (124), not merely run slower
  # -- unlike the other twins above, which use test-scale thresholds
  # (STALL_WARN=2/STALL_DEAD=4) the real wall clock can also satisfy within
  # their own timeouts, so a silently-removed seam would just make THOSE
  # slower, not fail.
  export WATCH_TICK=500 STALL_WARN=300 STALL_DEAD=900
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
  grep -q 'kill+retry from' <<<"$output"
}

# --- T4b: v2 typed states -- QUEUED, STARTING, RUNNING_IMPL, VERIFYING,
# WAITING_CHILD, AGENT_ABANDONED, STALLED, DEAD, SUCCEEDED, FAILED
# (2026-07-18). New tests only below this line, all on the T4a injected
# clock (vtick_init) or --once (stateless, no clock dependency at all) --
# none of the 30 tests above this marker were modified. --------------------

# @description Emit a v2-shape `ownership` event matching lane_emit_ownership's
#   exact shipped payload (ground truth: lane-run.sh), same convention
#   tests/lane-supervise.bats's own _emit_ownership helper uses.
# @arg $1 run  @arg $2 lane  @arg $3 attempt  @arg $4 launcher_pid (empty=null)
# @arg $5 pid (empty=null)  @arg $6 worktree
t4b_emit_ownership() {
  local run="$1" lane="$2" attempt="$3" lpid="$4" pid="$5" wt="$6"
  local payload
  payload="$(
    MSYS_NO_PATHCONV=1 jq -cn --argjson attempt "$attempt" --arg lp "$lpid" --arg pid "$pid" --arg wt "$wt" \
      '{attempt:$attempt,
        launcher_pid:(if $lp=="" then null else ($lp|tonumber) end),
        pid:(if $pid=="" then null else ($pid|tonumber) end),
        job_id:null, worktree:$wt, config_dir:null, launcher:true}'
  )"
  el_emit "$run" ownership "$lane" "$payload" >/dev/null
}

# @description Print one foreman-launch heartbeat line matching the frozen
#   {ts, launcher_pid, pid, job_id, alive, stdout_bytes, stderr_bytes,
#   elapsed_s} schema (ground truth: launcher/README.md, mirrored by
#   tests/lane-run.bats's write_fake_launcher shim).
# @arg $1 ts ISO-8601 UTC timestamp  @arg $2 launcher_pid  @arg $3 pid
t4b_hb_line() {
  printf '{"ts":"%s","launcher_pid":%d,"pid":%d,"job_id":"j1","alive":true,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.0}\n' \
    "$1" "$2" "$3"
}

# @description Convert a vtick fake-clock epoch-ms reading to an ISO-8601 UTC
#   timestamp -- a pure formatting conversion of a KNOWN value, not itself a
#   real-clock read, so it stays meaningful under the injected clock.
# @arg $1 epoch_ms
t4b_mkts() {
  date -u -d "@$(( $1 / 1000 ))" +%Y-%m-%dT%H:%M:%SZ
}

# @description Write a fake lane-queue.sh shim to DIR/lane-queue.sh: its
#   `status` subcommand prints a whole-queue JSON blob with one task whose
#   original_command mentions RUN and LANE, status "Queued" (QUEUED=1) or an
#   empty task map (QUEUED=0) -- the wd_is_queued best-effort substring/status
#   match this file's own watch.sh implements is exercised against a
#   plausible, not-necessarily-real-pueue-verified shape (spec explicitly
#   calls this match "best-effort").
# @arg $1 dir  @arg $2 run  @arg $3 lane  @arg $4 queued (1|0)
t4b_write_fake_lane_queue() {
  local dir="$1" run="$2" lane="$3" queued="$4"
  if [[ "$queued" == "1" ]]; then
    cat > "$dir/lane-queue.sh" <<SHIM
#!/usr/bin/env bash
if [[ "\$1" == "status" ]]; then
  printf '{"tasks":{"7":{"original_command":"bash lane-run.sh $run $lane /wt -- foo","status":"Queued"}}}\n'
  exit 0
fi
exit 1
SHIM
  else
    cat > "$dir/lane-queue.sh" <<'SHIM'
#!/usr/bin/env bash
if [[ "$1" == "status" ]]; then
  printf '{"tasks":{}}\n'
  exit 0
fi
exit 1
SHIM
  fi
  chmod +x "$dir/lane-queue.sh"
}

# --- wd_state_v2: pure function, direct-call unit tests (same style as the
# wd_state unit tests at the top of this file) ------------------------------

@test "wd_state_v2: age below warn is RUNNING" {
  run wd_state_v2 10 90 900
  [ "$output" = "RUNNING" ]
}
@test "wd_state_v2: age at warn (boundary) is STALLED" {
  run wd_state_v2 90 90 900
  [ "$output" = "STALLED" ]
}
@test "wd_state_v2: age just below dead stays STALLED" {
  run wd_state_v2 899 90 900
  [ "$output" = "STALLED" ]
}
@test "wd_state_v2: age at dead (boundary) is DEAD" {
  run wd_state_v2 900 90 900
  [ "$output" = "DEAD" ]
}

# --- STARTING ---------------------------------------------------------------

@test "T4b --once: STARTING when ownership exists but \$hb has no line yet" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  export STARTING_STALE=90 STALL_DEAD=900
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STARTING"* ]]
}

@test "T4b VTICK: STARTING escalates to STALLED after starting_stale with no \$hb ever" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  export WATCH_TICK=1 STARTING_STALE=2 STALL_DEAD=900 WATCH_GRACE=0
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO" --hb "$hb"
  [ "$(grep -c STARTING <<<"$output")" -ge 1 ]
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [[ "$output" != *"DEAD"* ]]
}

# --- RUNNING_IMPL ------------------------------------------------------------

@test "T4b --once: RUNNING_IMPL when \$hb and the event log are both fresh" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 heartbeat lane1 '{}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$$" > "$hb"
  export IMPL_STALE=300 STALL_DEAD=900
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"RUNNING_IMPL"* ]]
}

@test "T4b VTICK: RUNNING_IMPL escalates through STALLED to DEAD (stall_dead retained from v1), exit 3" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 heartbeat lane1 '{}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  # $hb's line is written ONCE, at vtick's starting instant, then never
  # refreshed -- age grows purely from the fake clock advancing.
  t4b_hb_line "$(t4b_mkts "$(cat "$VTICK_FILE")")" "$$" "$$" > "$hb"
  export WATCH_TICK=1 IMPL_STALE=2 STALL_DEAD=4 WATCH_GRACE=0
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 3 ]
  [ "$(grep -c RUNNING_IMPL <<<"$output")" -eq 1 ]
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
}

# --- VERIFYING ---------------------------------------------------------------

@test "T4b --once: VERIFYING once a {state:verifying} event exists for the attempt" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 state lane1 '{"state":"verifying","attempt":1}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$$" > "$hb"
  export VERIFY_STALE=600 STALL_DEAD=900
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERIFYING"* ]]
}

# F5 -- THE LOAD-BEARING TEST OF THIS TASK.
@test "T4b F5 (load-bearing): event log silent + \$hb still advancing during VERIFYING -> stays VERIFYING, no false stall" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 state lane1 '{"state":"verifying","attempt":1}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  export VERIFY_STALE=2 STALL_DEAD=900

  t4b_hb_line "$(t4b_mkts "$(cat "$VTICK_FILE")")" "$$" "$$" > "$hb"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERIFYING"* ]]

  # Advance the fake clock past verify_stale (2s) WITHOUT any new event-log
  # activity (the event log stays silent -- no new prompt/heartbeat/
  # checkpoint/state event) -- but $hb keeps advancing, a fresh line
  # appended, simulating the launcher's own heartbeat continuing during the
  # gate phase (T2/F5 doctrine: the event log goes quiet during the gate;
  # $hb is the only liveness signal left, and it is genuinely alive here).
  $WATCH_SLEEP_CMD 3000
  t4b_hb_line "$(t4b_mkts "$(cat "$VTICK_FILE")")" "$$" "$$" >> "$hb"

  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERIFYING"* ]]
  [[ "$output" != *"STALLED"* ]]
}

# The F5 case's inverse (spec-required): $hb frozen + log silent past
# verify_stale -> STALLED.
@test "T4b F5 inverse: \$hb frozen + event log silent past verify_stale -> STALLED" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 state lane1 '{"state":"verifying","attempt":1}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  export VERIFY_STALE=2 STALL_DEAD=900

  t4b_hb_line "$(t4b_mkts "$(cat "$VTICK_FILE")")" "$$" "$$" > "$hb"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERIFYING"* ]]

  # Advance the fake clock past verify_stale WITHOUT touching $hb this time
  # (frozen) or the event log (silent) -- this MUST escalate to STALLED.
  $WATCH_SLEEP_CMD 3000

  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALLED"* ]]
}

@test "T4b VTICK: phase-transition grace suppresses an immediate STALLED right after entering VERIFYING" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 state lane1 '{"state":"verifying","attempt":1}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  # $hb's last line is ALREADY stale (year 2001) the moment watch.sh starts
  # -- without the grace window this would read STALLED on tick 1.
  t4b_hb_line "2001-01-01T00:00:00Z" "$$" "$$" > "$hb"
  export WATCH_TICK=1 VERIFY_STALE=2 STALL_DEAD=900 WATCH_GRACE=5
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO" --hb "$hb"
  first_line="$(head -n1 <<<"$output")"
  [[ "$first_line" == *"VERIFYING"* ]]
  # Grace is bounded, not a permanent exemption: it DOES eventually escalate
  # once the grace window itself expires (the raw age is still stale).
  [ "$(grep -c STALLED <<<"$output")" -ge 1 ]
}

# --- WAITING_CHILD -----------------------------------------------------------

@test "T4b --once: WAITING_CHILD when the latest waiting_child event is newer than \$hb activity" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "2001-01-01T00:00:00Z" "$$" "$$" > "$hb"
  el_emit run1 waiting_child lane1 '{"gate_rc":7,"report_fresh":false}' >/dev/null
  export STALL_DEAD=900
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WAITING_CHILD"* ]]
}

# --- AGENT_ABANDONED ---------------------------------------------------------

@test "T4b --once: AGENT_ABANDONED when the owning pid is confirmed dead, no round_done, no waiting_child" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 999999999 "" "$REPO"
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 999999999 999999999 > "$hb"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 5 ]
  [[ "$output" == *"AGENT_ABANDONED"* ]]
}

@test "T4b --once: AGENT_ABANDONED never fires when the owning pid is a genuinely live process" {
  setup_tmp_repo
  sleep 100 &
  livepid=$!
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$livepid" "" "$REPO"
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$livepid" "$livepid" > "$hb"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  kill "$livepid" 2>/dev/null || true
  wait "$livepid" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" != *"AGENT_ABANDONED"* ]]
}

@test "T4b VTICK: AGENT_ABANDONED via the continuous loop emits exactly one alert and exits 5" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 999999999 "" "$REPO"
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 999999999 999999999 > "$hb"
  export WATCH_TICK=1
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 5 ]
  [[ "$output" == *"AGENT_ABANDONED"* ]]
  n="$(jq -rc 'select(.type=="alert" and .payload.state=="AGENT_ABANDONED") | .seq' "$FOREMAN_HOME/runs/run1/events.jsonl" | wc -l)"
  [ "$n" -eq 1 ]
}

# --- SUCCEEDED / FAILED -------------------------------------------------------

@test "T4b --once: SUCCEEDED (DONE) when round_done exists with gate_rc 0, even with ownership present" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 round_done lane1 '{"exit_code":0,"gate_rc":0,"report_fresh":true}' >/dev/null
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"DONE"* ]]
}

@test "T4b VTICK: SUCCEEDED via the continuous loop with ownership present exits 0 printing DONE" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 round_done lane1 '{"exit_code":0,"gate_rc":0,"report_fresh":true}' >/dev/null
  export WATCH_TICK=1
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  grep -q DONE <<<"$output"
}

@test "T4b --once: FAILED when a terminal T8 abandoned alert exists for the attempt" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 999999999 "" "$REPO"
  el_emit run1 alert lane1 '{"kind":"abandoned","attempts":2}' >/dev/null
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO"
  [ "$status" -eq 4 ]
  [[ "$output" == *"FAILED"* ]]
}

@test "T4b VTICK: FAILED via the continuous loop exits 4 without double-emitting T8's own alert" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 999999999 "" "$REPO"
  el_emit run1 alert lane1 '{"kind":"abandoned","attempts":2}' >/dev/null
  export WATCH_TICK=1
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 4 ]
  [[ "$output" == *"FAILED"* ]]
  n="$(jq -rc 'select(.type=="alert" and .payload.kind=="abandoned") | .seq' "$FOREMAN_HOME/runs/run1/events.jsonl" | wc -l)"
  [ "$n" -eq 1 ]
}

# --- QUEUED ------------------------------------------------------------------

@test "T4b --once: QUEUED when no prompt exists yet and lane-queue reports a matching queued task" {
  setup_tmp_repo
  stub="$BATS_TEST_TMPDIR/stub"; mkdir -p "$stub"
  t4b_write_fake_lane_queue "$stub" run1 lane1 1
  export WATCH_LANE_QUEUE_BIN="$stub/lane-queue.sh"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"QUEUED"* ]]
}

@test "T4b --once: no matching queued task -> never QUEUED (best-effort, no false positive)" {
  setup_tmp_repo
  stub="$BATS_TEST_TMPDIR/stub"; mkdir -p "$stub"
  t4b_write_fake_lane_queue "$stub" run1 lane1 0
  export WATCH_LANE_QUEUE_BIN="$stub/lane-queue.sh"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" != *"QUEUED"* ]]
}

@test "T4b --once: pueue/lane-queue.sh entirely unresolvable -> never QUEUED (fail toward not-queued)" {
  setup_tmp_repo
  export WATCH_LANE_QUEUE_BIN="$BATS_TEST_TMPDIR/does-not-exist.sh"
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" != *"QUEUED"* ]]
}

@test "T4b VTICK: QUEUED never stall-classifies even past thresholds that would otherwise fire immediately" {
  setup_tmp_repo
  vtick_init
  stub="$BATS_TEST_TMPDIR/stub"; mkdir -p "$stub"
  t4b_write_fake_lane_queue "$stub" run1 lane1 1
  export WATCH_LANE_QUEUE_BIN="$stub/lane-queue.sh"
  export WATCH_TICK=1 STALL_WARN=1 STALL_DEAD=2 STARTING_STALE=1
  # Rework Round 1 (Opus audit finding 5, LOW): tightened from an 8s bound --
  # the fake sleep is instant under vtick, so this test never needed to
  # busy-spin anywhere close to that long; 3s is ample headroom over the
  # per-tick jq/subprocess overhead actually observed on this host.
  run timeout 3 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [[ "$output" == *"QUEUED"* ]]
  [[ "$output" != *"STALLED"* ]]
  [[ "$output" != *"DEAD"* ]]
}

# --- v1 hand-off / CLI grammar -----------------------------------------------

@test "T4b CLI: --hb overrides the default heartbeat-file path" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  custom_hb="$BATS_TEST_TMPDIR/custom-heartbeat.ndjson"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$$" > "$custom_hb"
  # The DEFAULT path ($REPO/.harness/heartbeat.ndjson) does not exist at all
  # -- without --hb this would read as STARTING; with --hb pointing at
  # custom_hb it must read RUNNING_IMPL instead.
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$custom_hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"RUNNING_IMPL"* ]]
}

@test "T4b CLI: flags may appear before the positionals (new grammar) alongside --once" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  el_emit run1 round_done lane1 '{"exit_code":0}' >/dev/null
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"DONE"* ]]
}

@test "T4b dispatch: a round with events but no ownership ever hands off to the frozen v1 path unchanged" {
  setup_tmp_repo
  vtick_init
  export WATCH_TICK=1 STALL_WARN=2 STALL_DEAD=4
  el_emit run1 prompt lane1 '{}' >/dev/null
  run timeout 10 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO"
  [ "$status" -eq 3 ]
  [ "$(grep -c STALLED <<<"$output")" -eq 1 ]
  [ "$(grep -c DEAD <<<"$output")" -eq 1 ]
  # v1 vocabulary only -- never a typed-state label leaks into a pure v1 round.
  [[ "$output" != *"RUNNING_IMPL"* ]]
  [[ "$output" != *"STARTING"* ]]
}

# --- Rework Round 1 (Opus audit, 2026-07-18) --------------------------------

# Finding 1 (MEDIUM, mandatory): the one-time v1/v2 dispatch race. A watcher
# that first-latches in the prompt->ownership gap (ownership can lag its own
# prompt by up to ~20s, lane_emit_ownership's own bound) must NOT commit
# irrevocably to v1 on a single point-in-time check -- that path never reads
# $hb, so it would false-stall during the gate exactly like the F5 case this
# task exists to prevent. Fix: wd_wait_ownership bounded-re-polls before
# committing. This test proves the re-poll actually catches a LATE-arriving
# ownership event: a background watcher (driven by the T4a fake-clock FILE
# directly, not real time) appends the ownership event the instant the fake
# clock crosses +10 fake-seconds past the moment watch.sh started polling --
# simulating lane_emit_ownership's own real-world latency with zero real
# wall-clock cost. WATCH_OWNERSHIP_WAIT is raised well above
# wd_wait_ownership's own conservative 3s default (which exists specifically
# to protect the FROZEN v1 wall-clock tests' `timeout` budgets, per that
# function's own doc comment) so the bounded window actually reaches +10s.
@test "T4b Rework1 finding1: ownership appearing ~10 fake-seconds after latch still lands in v2, not the v1 hand-off" {
  setup_tmp_repo
  vtick_init
  el_emit run1 prompt lane1 '{}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"; mkdir -p "$(dirname "$hb")"
  t4b_hb_line "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$$" > "$hb"

  start_ms="$(cat "$VTICK_FILE")"
  (
    while true; do
      cur="$(cat "$VTICK_FILE" 2>/dev/null || echo "$start_ms")"
      if (( cur - start_ms >= 10000 )); then
        t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
        break
      fi
      sleep 0.05
    done
  ) &
  bgpid=$!

  export WATCH_TICK=1 WATCH_OWNERSHIP_WAIT=15000 STALL_DEAD=900 IMPL_STALE=300
  run timeout 20 bash "$SCRIPTS/watch.sh" run1 lane1 "$REPO" --hb "$hb"
  kill "$bgpid" 2>/dev/null || true
  wait "$bgpid" 2>/dev/null || true

  # Lands in v2 (RUNNING_IMPL, $hb+event both fresh once ownership is
  # confirmed) -- never falls back to bare v1 RUNNING/STALLED/DEAD, proving
  # the bounded re-poll caught the late-arriving ownership event instead of
  # committing to v1 at the very first check.
  [[ "$output" == *"RUNNING_IMPL"* ]]
}

# Finding 3 (LOW): with a {state:verifying} event present but $hb empty/
# unparsable, classification must land in VERIFYING (verify_stale, 600s
# default), not STARTING (starting_stale, 90s default) -- the verifying flag
# must be checked BEFORE the empty-hb STARTING branch.
@test "T4b Rework1 finding3: verifying event present but \$hb empty -> VERIFYING, not STARTING" {
  setup_tmp_repo
  el_emit run1 prompt lane1 '{}' >/dev/null
  t4b_emit_ownership run1 lane1 1 "$$" "" "$REPO"
  el_emit run1 state lane1 '{"state":"verifying","attempt":1}' >/dev/null
  hb="$REPO/.harness/heartbeat.ndjson"
  # $hb deliberately absent (no mkdir/write at all) -- the empty/unparsable
  # case this finding is about.
  export STARTING_STALE=90 VERIFY_STALE=600 STALL_DEAD=900
  run bash "$SCRIPTS/watch.sh" --once run1 lane1 "$REPO" --hb "$hb"
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERIFYING"* ]]
  [[ "$output" != *"STARTING"* ]]
}
