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
