#!/usr/bin/env bash
# @description Per-lane stall watchdog over the event log. Polls on a fixed
#   tick, computes the age of the lane's last post-baseline liveness event,
#   and drives a RUNNING/STALLED/DEAD state machine (wd_state) with debounce.
#   Prints one line per state TRANSITION only, emits an alert event
#   (synchronously, status-checked) on each transition.
#
#   Completion is round-boundary based: a round_done completes the watcher
#   only when its seq is greater than the watcher's baseline. The baseline is
#   the seq of the round's own prompt event (lane-run emits exactly one prompt
#   per round at round start), auto-detected via the last prompt in the log,
#   or overridden with --after-seq N. If no prompt exists yet at startup, the
#   baseline is latched on the first later prompt (events before it are
#   ignored for completion). Prior-round round_done events (seq <= baseline)
#   never complete a newer-round watcher. Exits 0 on DONE; on DEAD prints a
#   kill+retry escalation hint using the lane's latest checkpoint SHA before
#   exiting 3.
#
#   v0.2.5 T4b: this v1 3-state machine is FROZEN and stays the exact
#   behavior for any round that never records a T2 `ownership` event ("pure
#   v1"). A typed 10-state machine (QUEUED, STARTING, RUNNING_IMPL,
#   VERIFYING, WAITING_CHILD, AGENT_ABANDONED, STALLED, DEAD, SUCCEEDED,
#   FAILED) wraps around it for T2 (launcher-owned) rounds -- see the T4b
#   banner comment further down this file for the dispatch rule, and
#   `watch.sh [--once] [--after-seq N] [--hb FILE] RUN LANE WORKTREE` for the
#   extended CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/eventlog.sh"
source "$SCRIPT_DIR/lib/checkpoint.sh"
source "$SCRIPT_DIR/lib/config.sh"

# @description Pure watchdog state-transition function: given the age
#   (seconds) since the lane's last liveness event, the previous state, and
#   the current stall counter, returns the new state and counter. Debounces a
#   single stale tick (either mid-range or freshly at/above STALL_DEAD)
#   before declaring STALLED/DEAD, but is restart-independent: if the counter
#   is already >=1 OR the previous state is already non-RUNNING, DEAD-range
#   age fires DEAD immediately (a restarted watchdog must not need to
#   re-debounce from a reset counter).
# @arg $1 age seconds since the lane's last liveness event
# @arg $2 prev_state RUNNING|STALLED|DEAD
# @arg $3 stall_count current consecutive-stall counter
# @stdout "<NEW_STATE> <NEW_COUNT>"
# @exitcode 0 always (pure computation, never fails)
wd_state() {
  local age="$1" prev="$2" count="$3"
  local warn="${STALL_WARN:-300}" dead="${STALL_DEAD:-900}"
  if (( age < warn )); then
    printf 'RUNNING 0\n'
    return 0
  fi
  if (( age >= dead )); then
    if (( count >= 1 )) || [[ "$prev" != RUNNING ]]; then
      local n=$((count + 1))
      printf 'DEAD %d\n' "$n"
    else
      printf 'RUNNING 1\n'
    fi
    return 0
  fi
  if (( count >= 1 )); then
    local n=$((count + 1))
    printf 'STALLED %d\n' "$n"
  else
    printf 'RUNNING 1\n'
  fi
  return 0
}

# @description Print a one-line usage message to stderr.
wd_usage() {
  echo "Usage: watch.sh [--once] [--after-seq N] [--hb FILE] RUN_ID LANE WORKTREE" >&2
}

# @description Strip a trailing CR from a jq-derived scalar (this host's
#   Windows jq.exe emits CRLF even when the underlying event log is CR-clean).
# @arg $1 value
# @stdout the value with any trailing CR removed
wd_strip_cr() {
  local v="$1"
  printf '%s' "${v%$'\r'}"
}

# @description Return the current time as whole epoch milliseconds --
#   watch.sh's sole "what time is it" primitive (T4a clock seam). When
#   WATCH_CLOCK_CMD is set (env-only, NOT TOML-storable -- same deliberate
#   choice as WATCH_TICK; see lib/config.sh's header comment on
#   _CFG_ENV_VAR), invoke it and trust its stdout verbatim: a test-provided
#   command that prints its own fake epoch-ms reading (e.g. backed by a file
#   the test's WATCH_SLEEP_CMD advances), so a stall/completion walk can be
#   driven deterministically without ever sleeping for real. Otherwise
#   derives ms from bash's own EPOCHREALTIME (seconds.microseconds) via pure
#   string splitting -- never a `date` spawn -- so the default path's
#   per-tick cost is unchanged from before this seam existed.
# @stdout epoch milliseconds (integer)
wd_now_ms() {
  if [[ -n "${WATCH_CLOCK_CMD:-}" ]]; then
    $WATCH_CLOCK_CMD
    return 0
  fi
  local rt=$EPOCHREALTIME
  local si=${rt%%.*} sf
  if [[ "$rt" == *.* ]]; then sf=${rt#*.}; else sf=0; fi
  sf="${sf}000"; sf=${sf:0:3}
  printf '%d\n' $(( 10#$si * 1000 + 10#$sf ))
  return 0
}

# @description Sleep MS milliseconds -- watch.sh's sole "wait" primitive
#   (T4a clock seam). When WATCH_SLEEP_CMD is set (env-only, same doctrine
#   as WATCH_CLOCK_CMD/WATCH_TICK), invoke it with MS as $1 instead of
#   sleeping: tests wire this to a no-op (with respect to wall time) that
#   only advances a fake clock file, so a wall-clock wait of minutes runs in
#   the time the loop itself takes. Otherwise sleeps MS milliseconds via the
#   real `sleep` (a no-op, no process spawn, when MS<=0).
# @arg $1 ms milliseconds to sleep (integer; <=0 is a no-op)
wd_sleep_ms() {
  local ms="$1"
  if [[ -n "${WATCH_SLEEP_CMD:-}" ]]; then
    $WATCH_SLEEP_CMD "$ms"
    return 0
  fi
  if (( ms > 0 )); then
    sleep "$(printf '%d.%03d' $((ms / 1000)) $((ms % 1000)))"
  fi
  return 0
}

# Cached liveness seq→epoch so steady-state ticks avoid re-spawning
# `date -d` when the lane's last liveness event has not changed (~100ms+ per
# spawn on Windows/Git Bash; enough to skip the 2s STALLED integration window).
_WD_LIVE_SEQ_CACHE=""
_WD_LIVE_EPOCH_CACHE=""

# Single-pass jq program: last post-baseline liveness (prompt|heartbeat|
# checkpoint) + last post-baseline round_done for the bound $lane, emitted as
# TSV. Events with seq <= $baseline are ignored (round-boundary filter).
# Kept as a constant so the hot path never spawns `cat`/command-substitution
# just to load the filter.
# Pipe-delimited (not @tsv): bash IFS strips leading whitespace, so a
# done-only sample ("\t\t2") would put the done seq into live_seq. Pipes are
# not IFS whitespace, so empty leading fields stay empty ("||2").
_WD_SAMPLE_JQ='
reduce inputs as $e ({live_seq:"", live_ts:"", done_seq:""};
  if $e.lane == $lane and $e.seq > $baseline then
    if ($e.type == "prompt" or $e.type == "heartbeat" or $e.type == "checkpoint") then
      .live_seq = ($e.seq|tostring) | .live_ts = $e.ts
    elif $e.type == "round_done" then
      .done_seq = ($e.seq|tostring)
    else . end
  else . end
) | "\(.live_seq)|\(.live_ts)|\(.done_seq)"
'

# @description Return the seq of the last prompt event for RUN/LANE.
# @arg $1 run id
# @arg $2 lane
# @stdout the seq of the LAST prompt event recorded for run/lane, or EMPTY
#   OUTPUT (rc 0) if none / log missing / query fails -- never "0", since 0
#   is a legitimate seq value in imported/recovered logs and would otherwise
#   be indistinguishable from "no prompt found". One jq pass; same log-path/CR
#   conventions as wd_sample (FOREMAN_HOME/runs/$run/events.jsonl, strip CR,
#   validate the result is a bare non-negative integer before trusting it).
wd_last_prompt_seq() {
  local run="$1" lane="$2"
  local log extracted jq_rc=0
  log="${FOREMAN_HOME}/runs/${run}/events.jsonl"
  # Not-found sentinel is EMPTY OUTPUT, not 0 (audit t5-1 round 3: a 0
  # sentinel is indistinguishable from a genuine prompt at seq 0 in
  # imported/recovered logs). -1 is the internal jq accumulator sentinel;
  # it can never be a real seq and is mapped to empty here.
  if [[ ! -f "$log" ]]; then
    return 0
  fi
  extracted="$(jq -r --arg lane "$lane" '
    reduce inputs as $e (-1;
      if $e.lane == $lane and $e.type == "prompt" then ($e.seq // -1)
      else . end
    )
  ' -n -- "$log" 2>/dev/null)" || jq_rc=$?
  extracted=${extracted:-}
  extracted=${extracted%$'\r'}
  if (( jq_rc != 0 )) || [[ "$extracted" == "-1" ]] || [[ ! "$extracted" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  printf '%s\n' "$extracted"
  return 0
}

# @description Sleep the remainder of a tick budget measured from a
#   wd_now_ms() start (epoch ms). No-ops (no wd_sleep_ms call) when already
#   at/over budget so slow samples do not compound with a full extra sleep.
#   tick accepts an integer or fractional seconds literal ("2", "0.5",
#   "0.01"), parsed via plain string splitting -- NEVER a bash arithmetic
#   context on the raw string. THE FIX: the original did `tick * 1000` as a
#   bash arithmetic expression, and bash's arithmetic evaluator has no
#   floating-point support -- it throws "arithmetic syntax error (error
#   token \".01\")" the instant WATCH_TICK is fractional (e.g. "0.01" for
#   fast polling). Parsed into whole milliseconds up front (same
#   pad-to-3-digits convention wd_now_ms uses for EPOCHREALTIME), every
#   computation below is pure integer-ms arithmetic. A tick string that
#   isn't a bare non-negative integer/decimal literal is rejected via the
#   same usage-error path CLI arg validation uses (wd_usage + exit 2) rather
#   than crashing mid-loop.
# @arg $1 start_ms epoch ms at tick start (a wd_now_ms() reading)
# @arg $2 tick tick-seconds literal (integer or decimal, non-negative)
wd_sleep_remainder() {
  local start_ms="$1" tick="$2"
  if [[ ! "$tick" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    wd_usage
    exit 2
  fi
  local ip="${tick%%.*}" fp
  if [[ "$tick" == *.* ]]; then fp="${tick#*.}"; else fp=0; fi
  fp="${fp}000"; fp=${fp:0:3}
  local tick_ms=$(( 10#$ip * 1000 + 10#$fp ))
  local now_ms; now_ms="$(wd_now_ms)"
  local rem=$(( tick_ms - (now_ms - start_ms) ))
  if (( rem > 0 )); then
    wd_sleep_ms "$rem"
  fi
  return 0
}

# @description Sample the current event log for RUN/LANE and set the caller's
#   WD_AGE / WD_DONE out-variables (assigned without local here so bash's
#   dynamic scoping writes through to the local declarations in wd_main --
#   a $(...) capture would lose them instead). Distinguishes "no liveness
#   event yet" (age counted from watch.sh's own start time) from sample
#   failures, which are only logged, never fatal.
#
#   Only events with seq > baseline count for liveness age and completion.
#   The baseline event itself (typically the round's prompt at seq ==
#   baseline) is the reference point, not "after" it, so it is excluded.
#   WD_DONE=1 iff a round_done for the lane exists with seq > baseline.
#   A prior-round round_done (seq <= baseline) does NOT complete. A
#   round_done that completed THIS watcher's round remains DONE even if a
#   newer prompt (higher seq, a subsequent round) has since appeared — that
#   later prompt belongs to a different round; this watcher still completed
#   its own baseline's round.
# @arg $1 run id  @arg $2 lane  @arg $3 start epoch seconds (fallback age base)
# @arg $4 baseline seq (events with seq <= baseline are ignored for both
#   liveness age and completion; default 0 = no filtering)
# @set WD_AGE age in whole seconds since the lane's last post-baseline
#   liveness event (or since start if none)
# @set WD_DONE 1 if a round_done with seq > baseline exists for the lane,
#   else 0
wd_sample() {
  local run="$1" lane="$2" start="$3" baseline="${4:-0}"
  local log extracted live_seq="" live_ts="" done_seq="" jq_rc=0
  # Inline path (avoid $(run_dir) subshell on every tick).
  log="${FOREMAN_HOME}/runs/${run}/events.jsonl"

  # Fast path: ONE jq spawn over the log file (lane filter + baseline filter
  # + liveness + round_done). Avoids el_read's per-line jq -e validation
  # (~one Windows process spawn per event — with concurrent heartbeats that
  # is multi-second ticks and trips the isolation test timeout). On jq
  # failure (almost always a torn last line from a concurrent append) retry
  # once with the last line dropped — still one jq, not N.
  if [[ -f "$log" ]]; then
    extracted="$(jq -r --arg lane "$lane" --argjson baseline "$baseline" "$_WD_SAMPLE_JQ" -n -- "$log" 2>/dev/null)" || jq_rc=$?
    if (( jq_rc != 0 )); then
      local tmp
      tmp="$(mktemp)"
      # Drop the last line (likely the in-progress append). head is one spawn;
      # still far cheaper than el_read's per-line jq -e over a long log.
      if head -n -1 "$log" > "$tmp" 2>/dev/null; then
        jq_rc=0
        extracted="$(jq -r --arg lane "$lane" --argjson baseline "$baseline" "$_WD_SAMPLE_JQ" -n -- "$tmp" 2>/dev/null)" || jq_rc=$?
      fi
      rm -f "$tmp"
    fi
  fi

  # Strip trailing CRs in-place (no $(wd_strip_cr) subshells — those were
  # ~100ms+ each on this host and dominated the tick budget).
  extracted=${extracted:-}
  extracted=${extracted%$'\r'}
  if (( jq_rc != 0 )); then
    log "watch: jq sample failed for $run/$lane rc=$jq_rc"
  else
    # Pipe fields: live_seq, live_ts, done_seq (may be empty strings).
    # Delimiter must not be IFS whitespace (see _WD_SAMPLE_JQ comment).
    IFS='|' read -r live_seq live_ts done_seq <<<"$extracted" || true
    live_seq=${live_seq%$'\r'}
    live_ts=${live_ts%$'\r'}
    done_seq=${done_seq%$'\r'}
  fi

  # Round-boundary completion: a round_done with seq > baseline completes
  # THIS watcher's round. Prior-round round_done (seq <= baseline) is
  # filtered out by jq and never sets WD_DONE. A later same-lane prompt
  # (new round, higher seq) does not undo completion of the baseline's
  # round — DONE remains correct for per-round monitoring.
  WD_DONE=0
  if [[ -n "$done_seq" && "$done_seq" =~ ^[0-9]+$ ]]; then
    WD_DONE=1
  fi

  local now_epoch; now_epoch=$(( $(wd_now_ms) / 1000 ))
  if [[ -n "$live_ts" ]]; then
    local live_epoch
    # GNU date -d parses the ISO-8601 UTC ts el_emit writes
    # (YYYY-MM-DDTHH:MM:SSZ). Git Bash and WSL both ship GNU coreutils date;
    # BSD/macOS date needs -j -f and is out of scope here. Cache by seq so
    # steady-state ticks do not re-spawn date for an unchanged liveness event.
    if [[ -n "$live_seq" && "$live_seq" == "$_WD_LIVE_SEQ_CACHE" && -n "$_WD_LIVE_EPOCH_CACHE" ]]; then
      live_epoch="$_WD_LIVE_EPOCH_CACHE"
    elif live_epoch="$(date -u -d "$live_ts" +%s 2>/dev/null)"; then
      _WD_LIVE_SEQ_CACHE="$live_seq"
      _WD_LIVE_EPOCH_CACHE="$live_epoch"
    else
      # Malformed ts is a DIAGNOSTIC condition, NOT "no event yet". When a
      # prior cached good epoch exists, keep it so age accrues from the last
      # known-good liveness (fail-safe). When there is NO prior cache (first-
      # ever liveness event is corrupt), force age into the STALL_WARN range
      # so the debounce escalates like genuine staleness instead of looking
      # artificially fresh by resetting to $start (t5-8). Do NOT update the
      # seq/epoch cache here — a persistently malformed ts should keep
      # re-evaluating, not get "stuck" caching the fallback.
      log "watch: unparsable liveness ts '$live_ts' for $run/$lane; keeping previous age baseline"
      if [[ -n "$_WD_LIVE_EPOCH_CACHE" ]]; then
        live_epoch="$_WD_LIVE_EPOCH_CACHE"
      else
        local warn_fallback="${STALL_WARN:-300}"
        live_epoch=$(( now_epoch - warn_fallback ))
      fi
    fi
    WD_AGE=$(( now_epoch - live_epoch ))
  else
    WD_AGE=$(( now_epoch - start ))
  fi
  (( WD_AGE < 0 )) && WD_AGE=0
  return 0
}

# @description Resolve durable-lanes watchdog config (STALL_WARN/STALL_DEAD/
#   WATCH_TICK, the T4b v2 typed-state thresholds STARTING_STALE/IMPL_STALE/
#   VERIFY_STALE/WATCH_GRACE, and the T7 queue-probe bound
#   WATCH_QUEUE_TIMEOUT) through the shared config loader and export them, so
#   every existing "${STALL_WARN:-300}"-style default read in this file
#   (wd_state, wd_main's dead_thr, the tick default, wd_is_queued's `timeout`
#   bound) picks up the resolved value transparently. wd_state itself stays a
#   cheap, pure function with no config-loader calls of its own -- per-tick
#   cost and its existing direct-call unit tests (which export STALL_WARN/
#   STALL_DEAD themselves, bypassing this function entirely) are unaffected.
#   Precedence: dedicated env var > TOML [durable] value > built-in default.
#   WATCH_TICK has no TOML key (it is not one of the 19 documented
#   [durable]/[nats]/[audit.policy] keys) -- it still resolves through
#   cfg_get for a uniform call site, but only ever from its own env var or
#   the built-in default of 15. The four T4b keys and durable.queue_timeout
#   (v0.2.5 T7 -- promotes wd_is_queued's bound from env-only to
#   TOML-storable) ARE TOML-storable (added to lib/config.sh's allowlist in
#   BOTH tables).
# @exitcode 0 always
wd_resolve_config() {
  cfg_load
  STALL_WARN="$(cfg_get durable stall_warn 300)"
  STALL_DEAD="$(cfg_get durable stall_dead 900)"
  WATCH_TICK="$(cfg_get durable watch_tick 15)"
  STARTING_STALE="$(cfg_get durable starting_stale 90)"
  IMPL_STALE="$(cfg_get durable impl_stale 300)"
  VERIFY_STALE="$(cfg_get durable verify_stale 600)"
  WATCH_GRACE="$(cfg_get durable grace 10)"
  WATCH_QUEUE_TIMEOUT="$(cfg_get durable queue_timeout 3)"
  export STALL_WARN STALL_DEAD WATCH_TICK STARTING_STALE IMPL_STALE VERIFY_STALE WATCH_GRACE WATCH_QUEUE_TIMEOUT
  return 0
}

# @description Main watchdog loop: resolve the round-boundary baseline
#   (--after-seq override or auto-detect last prompt, with late-latch if no
#   prompt yet), poll on WATCH_TICK, print/emit on state transitions only,
#   exit 0 (printing DONE) on post-baseline lane completion, or exit 3
#   (after printing the kill+retry escalation hint) on DEAD.
# @arg $1 run id  @arg $2 lane  @arg $3 worktree path
# @arg $4 optional after-seq baseline (empty string = auto-detect)
wd_main() {
  local run="$1" lane="$2" wt="$3" after_seq="${4:-}"
  local tick="${WATCH_TICK:-15}"
  local start_epoch; start_epoch=$(( $(wd_now_ms) / 1000 ))
  local state=RUNNING count=0
  local WD_AGE WD_DONE
  local tick_start
  local baseline="" latched=0

  # Baseline resolution: explicit --after-seq latches immediately; else
  # auto-detect from the last prompt. If no prompt yet, remain unlatched
  # until the first prompt appears (then latch that seq).
  if [[ -n "$after_seq" ]]; then
    baseline="$after_seq"
    latched=1
  else
    local pseq
    pseq="$(wd_last_prompt_seq "$run" "$lane")"
    pseq=${pseq%$'\r'}
    if [[ -n "$pseq" && "$pseq" =~ ^[0-9]+$ ]]; then
      baseline="$pseq"
      latched=1
    fi
  fi

  while true; do
    tick_start="$(wd_now_ms)"
    WD_AGE=0; WD_DONE=0

    if (( latched == 0 )); then
      local pseq
      pseq="$(wd_last_prompt_seq "$run" "$lane")"
      pseq=${pseq%$'\r'}
      if [[ -n "$pseq" && "$pseq" =~ ^[0-9]+$ ]]; then
        baseline="$pseq"
        latched=1
      else
        # Unlatched: no round yet — never complete; age from watch start.
        # Reuses this iteration's own tick_start (already a wd_now_ms()
        # reading taken above) rather than issuing a fresh wd_now_ms() call
        # here -- intentional single-now-per-iteration semantics (one clock
        # read per tick, not one per code path), consistent with tick_start
        # already being the value wd_sleep_remainder anchors this same
        # iteration's sleep against below.
        WD_DONE=0
        WD_AGE=$(( tick_start / 1000 - start_epoch ))
        (( WD_AGE < 0 )) && WD_AGE=0
      fi
    fi

    if (( latched == 1 )); then
      wd_sample "$run" "$lane" "$start_epoch" "$baseline"
    fi

    if (( WD_DONE == 1 )); then
      echo "DONE"
      exit 0
    fi

    local result new_state new_count
    result="$(wd_state "$WD_AGE" "$state" "$count")"
    new_state="${result%% *}"
    new_count="${result#* }"

    # Debounce just armed (RUNNING, count 0→1) while age is still mid-range:
    # apply the second wd_state observation on the SAME age immediately.
    # Re-polling/sleeping lets age jump into DEAD on slow hosts and skip the
    # STALLED transition the silent-lane integration contract requires.
    # wd_state itself is unchanged — unit tests still exercise pure single calls.
    # Dead-range arming (restart-independence) is left to a later tick so a
    # fresh watchdog still debounces once at DEAD age across two real polls.
    if [[ "$new_state" == "RUNNING" && "$new_count" -ge 1 && "$count" -lt 1 ]]; then
      local dead_thr="${STALL_DEAD:-900}"
      if (( WD_AGE < dead_thr )); then
        state="$new_state"
        count="$new_count"
        result="$(wd_state "$WD_AGE" "$state" "$count")"
        new_state="${result%% *}"
        new_count="${result#* }"
      fi
    fi

    # If age jumped mid-range → DEAD between polls (slow sample / cold start),
    # wd_state goes RUNNING→DEAD and would skip the STALLED transition the
    # silent-lane integration contract requires. Emit STALLED first so the
    # observable chain is always RUNNING→STALLED→DEAD when we die from RUNNING.
    # (wd_state pure function is unchanged; unit tests still call it directly.)
    if [[ "$new_state" == "DEAD" && "$state" == "RUNNING" ]]; then
      local bridge_ts bridge_payload
      bridge_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "$bridge_ts $run/$lane STALLED age=${WD_AGE}s"
      bridge_payload="$(jq -cn --arg state STALLED --argjson age "$WD_AGE" \
        '{state:$state,age:$age}' 2>/dev/null || echo '{}')"
      bridge_payload=${bridge_payload//$'\r'/}
      # Emit in the FOREGROUND and check status: a detached background emit
      # can be reaped along with watch.sh itself, silently losing the alert.
      if ! el_emit "$run" alert "$lane" "$bridge_payload" >/dev/null; then
        log "watch: alert emit failed for $run/$lane (STALLED bridge)"
      fi
      state=STALLED
    fi

    if [[ "$new_state" != "$state" ]]; then
      local now_ts payload=""
      # Transition line once per state change only (not per tick).
      now_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "$now_ts $run/$lane $new_state age=${WD_AGE}s"
      # Emit in the FOREGROUND and check status. A detached background emit
      # can outlive watch.sh's own exit and be silently reaped (never durably
      # written) by a supervisor that tears down the process tree right after
      # seeing our exit code -- the DEAD transition in particular MUST be
      # durably logged before exit 3, not best-effort.
      payload="$(jq -cn --arg state "$new_state" --argjson age "$WD_AGE" \
        '{state:$state,age:$age}' 2>/dev/null || echo '{}')"
      payload=${payload//$'\r'/}
      if ! el_emit "$run" alert "$lane" "$payload" >/dev/null; then
        log "watch: alert emit failed for $run/$lane"
      fi
      if [[ "$new_state" == "DEAD" ]]; then
        local sha="" ckpt_rc=0
        sha="$(ckpt_latest "$wt" "$lane" 2>/dev/null)" || ckpt_rc=$?
        sha=${sha%$'\r'}
        if (( ckpt_rc != 0 )); then
          echo "kill+retry from <no checkpoint: not a git worktree>"
        elif [[ -z "$sha" ]]; then
          echo "kill+retry from <no checkpoint yet>"
        else
          echo "kill+retry from $sha"
        fi
        exit 3
      fi
    fi

    state="$new_state"
    count="$new_count"
    wd_sleep_remainder "$tick_start" "$tick"
  done
}

# ============================================================================
# T4b (v0.2.5): typed-state machine v2 -- QUEUED, STARTING, RUNNING_IMPL,
# VERIFYING, WAITING_CHILD, AGENT_ABANDONED, STALLED, DEAD, SUCCEEDED, FAILED.
#
# Everything ABOVE this banner (wd_state, wd_sample, wd_main, wd_now_ms,
# wd_sleep_ms, wd_sleep_remainder, wd_last_prompt_seq, and wd_resolve_config's
# STALL_WARN/STALL_DEAD/WATCH_TICK resolution) is the FROZEN v1 path --
# audited (T4a + Round B), covered by the 30 pre-T4b tests, and byte-for-byte
# unmodified by this section. The functions below only ever CALL wd_main /
# wd_sample / wd_state as-is; none of their bodies are edited.
#
# DOCTRINE DEVIATION (flagged per task instructions): the original plan's
# Task 4 text names RUNNING_AUDIT as a distinct state; the amended T4b text
# folds it into VERIFYING for v0.2.5 ("audit lanes are rounds like any
# other"). There is no RUNNING_AUDIT here -- by design, not omission.
#
# DISPATCH: main() (and wd_main_v2, for the late-latch case) decide, ONCE per
# watch.sh invocation, whether a lane's CURRENT round is a pure v1 round (no
# `ownership` event ever recorded for it, post-baseline) or a v2 (T2
# launcher-owned) round. A pure v1 round hands off to wd_main UNCHANGED --
# never reimplemented -- so its behavior is byte-identical to pre-T4b
# watch.sh. KNOWN LIMITATION (accepted, not exercised by any bats fixture
# here -- all of which are static/pre-built before watch.sh starts): the one
# unhandled race is "a prompt already exists, but this round's `ownership`
# event has not been recorded YET, at the EXACT instant the one-time decision
# is made" (lane_emit_ownership's own bound is up to 20s) -- that invocation
# would incorrectly stay on the v1 path for its entire lifetime. Solving this
# fully would mean re-implementing wd_main's debounce/transition bookkeeping
# a second time inside the loop below, which risks exactly the kind of subtle
# divergence "never rewrites it" exists to prevent; re-checking ownership on
# every tick and re-dispatching mid-loop was judged the worse tradeoff.
# ============================================================================

# @description Pure v2 threshold-crossing classifier: given an age (seconds)
#   and a phase-specific warn/dead pair, returns the generic bucket the age
#   falls into. UNLIKE wd_state (frozen v1), this is DIRECT -- no debounce
#   counter, no restart-independence bookkeeping -- v2 states are
#   reclassified fresh every tick (or every `--once` call) from the raw
#   liveness age. This is what makes a single `--once` classification
#   meaningful (there is no cross-process counter to debounce with) and is a
#   deliberate simplification from v1's 2-tick debounce, flagged in
#   FOREMAN_REPORT.md. "verifying is not stalled" holds because the caller
#   never asks this function to classify a fresh phase as anything but
#   RUNNING in the first place -- age only crosses warn/dead when liveness
#   (event log AND $hb) has genuinely gone quiet.
# @arg $1 age seconds
# @arg $2 warn phase-specific stale threshold (starting_stale/impl_stale/verify_stale)
# @arg $3 dead shared DEAD threshold (stall_dead)
# @stdout RUNNING | STALLED | DEAD
wd_state_v2() {
  local age="$1" warn="$2" dead="$3"
  if (( age < warn )); then
    printf 'RUNNING\n'
  elif (( age < dead )); then
    printf 'STALLED\n'
  else
    printf 'DEAD\n'
  fi
  return 0
}

# @description Read $hb's LAST line and print its `ts` field's epoch seconds.
#   CR-safe (strips a trailing CR before jq parses it, same single-strip
#   convention every other $hb/jq read in this codebase uses). Absent file,
#   empty file, or an unparsable last line all print nothing (rc 0) --
#   never fatal; callers treat empty as "no $hb liveness signal available",
#   never as age-zero. ONE jq spawn, not two (perf: an invalid/malformed line
#   fails this same `.ts // empty` extraction and produces empty output under
#   `2>/dev/null` anyway, so a separate `jq -e .` validation pass first buys
#   no extra safety here, only an extra ~100ms+ Windows/Git-Bash process
#   spawn per call -- see wd_sample_v2's own header comment for why per-tick
#   spawn count is load-bearing, not cosmetic, in this file).
# @arg $1 hb heartbeat-file path
# @stdout epoch seconds of the last line's `ts` field, or empty
wd_hb_last_epoch() {
  local hb="$1" line="" ts="" epoch="" jq_rc=0
  [[ -f "$hb" && -s "$hb" ]] || return 0
  line="$(tail -n 1 "$hb" 2>/dev/null || true)"
  line="${line%$'\r'}"
  [[ -z "$line" ]] && return 0
  ts="$(jq -r '.ts // empty' <<<"$line" 2>/dev/null)" || jq_rc=$?
  (( jq_rc != 0 )) && return 0
  ts="${ts%$'\r'}"
  [[ -z "$ts" ]] && return 0
  epoch="$(date -u -d "$ts" +%s 2>/dev/null)" || return 0
  printf '%s\n' "$epoch"
  return 0
}

# @description Whether ANY `ownership` event exists for LANE with seq >
#   BASELINE -- the dispatch signal distinguishing a v2 (T2 launcher-owned)
#   round from a pure v1 round (see the DISPATCH doctrine comment above this
#   section). One jq pass over the whole log; CR-safe (jq's own CRLF output
#   is compared as a bare "true"/"false" string, never round-tripped through
#   a shell numeric context).
# @arg $1 run  @arg $2 lane  @arg $3 baseline seq
# @exitcode 0 an ownership event exists; 1 it does not (or the log is absent)
wd_ownership_exists() {
  local run="$1" lane="$2" baseline="$3" log found
  log="${FOREMAN_HOME}/runs/${run}/events.jsonl"
  [[ -f "$log" ]] || return 1
  found="$(jq -r --arg lane "$lane" --argjson baseline "$baseline" '
    reduce inputs as $e (false;
      if . then . elif ($e.lane == $lane and $e.seq > $baseline and $e.type == "ownership") then true else . end)
  ' -n -- "$log" 2>/dev/null)"
  found="${found%$'\r'}"
  [[ "$found" == "true" ]]
}

# @description Bounded re-poll for an `ownership` event before committing to
#   the v1-compatibility hand-off (Rework Round 1, Opus audit finding 1,
#   MEDIUM -- mandatory fix). A genuinely v2 round's `ownership` event can
#   lag its own prompt by up to ~20s (lane_emit_ownership's own bound), so a
#   SINGLE point-in-time check at the moment of first latch can wrongly
#   commit forever to the v1 path for a round that is actually v2 -- exactly
#   the F5 failure mode (v1 never reads $hb, so it false-stalls during the
#   gate). Polls wd_ownership_exists on the T4a clock seam (wd_now_ms/
#   wd_sleep_ms), so under vtick this resolves in a bounded number of
#   FAKE-clock iterations at near-zero real cost regardless of how large the
#   bound is (a POSITIVE case -- ownership appears mid-window -- is caught
#   the next time this polls; a NEGATIVE case exhausts the bound).
#
#   DEFAULT IS DELIBERATELY CONSERVATIVE (3s), not the full ~20-25s this
#   fix's own motivation would ideally want: this function ALSO runs under
#   the frozen v1 wall-clock bats tests (they never set
#   WATCH_OWNERSHIP_WAIT, and several use a real, non-injected clock with
#   `timeout 20`/`timeout 40` bounds sized around their OWN STALL_WARN=2/
#   STALL_DEAD=4 test-scale thresholds -- a real ~25s wait ahead of that
#   would blow those timeouts before wd_main's own walk ever got to run,
#   confirmed empirically during this rework). Deployments that need the
#   full ~20-25s protection (matching lane_emit_ownership's own bound)
#   should set WATCH_OWNERSHIP_WAIT explicitly; tests that want to exercise
#   a late-arriving ownership event beyond 3s do the same, combined with
#   vtick_init so the larger bound costs no extra real wall-clock time.
# @arg $1 run  @arg $2 lane  @arg $3 baseline seq
# @exitcode 0 an ownership event appeared before the bound expired
# @exitcode 1 the bound (${WATCH_OWNERSHIP_WAIT:-3000}ms) expired first
wd_wait_ownership() {
  local run="$1" lane="$2" baseline="$3"
  local bound_ms="${WATCH_OWNERSHIP_WAIT:-3000}" poll_ms="${WATCH_OWNERSHIP_POLL:-300}"
  local start_ms; start_ms="$(wd_now_ms)"
  while true; do
    wd_ownership_exists "$run" "$lane" "$baseline" && return 0
    local now_ms; now_ms="$(wd_now_ms)"
    (( now_ms - start_ms >= bound_ms )) && return 1
    wd_sleep_ms "$poll_ms"
  done
}

# @description Print the `ts` field of the event at exactly seq==BASELINE
#   (the round's own prompt event in the common auto-detected case, or
#   whatever event --after-seq pointed at) -- STARTING's age anchor ("how
#   long have we been waiting for the first heartbeat"). Empty if not found.
# @arg $1 run  @arg $2 lane  @arg $3 baseline seq
# @stdout ISO-8601 ts, or empty
wd_baseline_ts() {
  local run="$1" lane="$2" baseline="$3" log ts
  log="${FOREMAN_HOME}/runs/${run}/events.jsonl"
  [[ -f "$log" ]] || return 0
  ts="$(jq -r --arg lane "$lane" --argjson baseline "$baseline" '
    reduce inputs as $e (""; if . == "" and $e.lane == $lane and $e.seq == $baseline then ($e.ts // "") else . end)
  ' -n -- "$log" 2>/dev/null)"
  ts="${ts%$'\r'}"
  [[ -z "$ts" ]] && return 0
  printf '%s\n' "$ts"
  return 0
}

# @description Resolve the lane-queue.sh sibling for the QUEUED best-effort
#   check. Precedence: WATCH_LANE_QUEUE_BIN env override (test-injection
#   seam, same family as WATCH_TICK/WATCH_CLOCK_CMD/WATCH_SLEEP_CMD) > PATH
#   lookup > co-located "$SCRIPT_DIR/lane-queue.sh" -- mirrors
#   lane-supervise.sh's own ls_resolve_lane_queue precedence and rationale.
# @stdout resolved script path
# @exitcode 0 found; 1 absent
wd_resolve_lane_queue() {
  if [[ -n "${WATCH_LANE_QUEUE_BIN:-}" ]]; then
    [[ -f "$WATCH_LANE_QUEUE_BIN" ]] && { printf '%s\n' "$WATCH_LANE_QUEUE_BIN"; return 0; }
    return 1
  fi
  local candidate
  if candidate="$(command -v lane-queue.sh 2>/dev/null)" && [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="$SCRIPT_DIR/lane-queue.sh"
  [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  return 1
}

# @description Best-effort QUEUED check (spec: "no ownership/prompt for the
#   latest attempt AND lane-queue reports a pueue task for this run/lane in
#   queued state"). Calls `lane-queue.sh status` (whole-queue JSON, no
#   TASK_ID) and looks for any task whose command/original_command string
#   contains BOTH RUN and LANE as substrings and whose status looks like
#   "Queued". pueue's own task-to-caller linkage is not recorded anywhere in
#   the shipped schema (lane-queue.sh's own `add` subcommand takes no
#   run/lane argument), so this is deliberately a substring/best-effort
#   match, exactly as the spec names it -- any failure (lane-queue.sh
#   unresolvable, pueue absent/degraded per lane-queue.sh's own
#   {"degraded":true} sentinel, or no matching task) means "not QUEUED",
#   never a false positive. Bounded by ${WATCH_QUEUE_TIMEOUT:-3}s (`timeout`,
#   already a hard dependency of this file's own bats suite): an unreachable
#   real pueue daemon's own connection-refused path has been empirically
#   observed to take ~2.2s on this host, and callers (the unlatched branch of
#   wd_main_v2/wd_once) must never let that stall the watcher's own tick
#   cadence the way an unbounded call would.
# @arg $1 run  @arg $2 lane
# @exitcode 0 a matching queued task was found; 1 otherwise
wd_is_queued() {
  local run="$1" lane="$2" lq_bin raw rc=0 n
  lq_bin="$(wd_resolve_lane_queue)" || return 1
  raw="$(timeout "${WATCH_QUEUE_TIMEOUT:-3}" bash "$lq_bin" status 2>/dev/null)" || rc=$?
  (( rc != 0 )) && return 1
  raw="${raw//$'\r'/}"
  [[ -z "$raw" ]] && return 1
  n="$(jq -r --arg run "$run" --arg lane "$lane" '
    [ (.tasks // {}) | to_entries[] | .value
      | ((.command // .original_command // "")) as $cmd
      | select(($cmd | contains($run)) and ($cmd | contains($lane)))
      | (.status | if type == "string" then . else (keys[0] // "") end)
      | select(test("Queued"; "i"))
    ] | length
  ' <<<"$raw" 2>/dev/null)"
  n="${n%$'\r'}"
  [[ "${n:-0}" -gt 0 ]]
}

# @description Whether the ownership-recorded owning process is confirmed
#   alive. Prefers launcher_pid (the job owner) over pid (CMD/gate's own
#   root child) -- same precedence lane-supervise.sh's ls_sweep_lane uses
#   (check_pid="${lpid:-$pid}"). An unrecorded pid (both null/empty -- e.g.
#   an ownership_timeout) can never be POSITIVELY confirmed dead, so it
#   defaults to "alive": AGENT_ABANDONED must never fire on missing data
#   alone, only on a confirmed-dead `kill -0`.
# @arg $1 launcher_pid (may be empty/"null")  @arg $2 pid (may be empty/"null")
# @exitcode 0 alive (or unknown); 1 confirmed dead
wd_pid_alive() {
  local lpid="$1" pid="$2" check=""
  [[ -n "$lpid" && "$lpid" != "null" ]] && check="$lpid"
  [[ -z "$check" && -n "$pid" && "$pid" != "null" ]] && check="$pid"
  [[ -z "$check" ]] && return 0
  kill -0 "$check" 2>/dev/null
}

# Single-pass, single-jq-spawn program for the v2 typed-state cascade:
# everything wd_classify_v2 needs about the CURRENT round (seq > $baseline,
# this $lane) in one file scan AND one process, mirroring wd_sample's own
# one-spawn-per-tick discipline exactly (perf note, empirically confirmed on
# this host: ~10 small jq spawns/tick -- an earlier "reduce, then 8 tiny
# extraction calls on the captured JSON" design -- pushed a 3-tick VERIFYING
# escalation past a 10s bats bound; collapsing to ONE spawn was required for
# green, not just a speed optimization, the same load-bearing lesson
# _WD_SAMPLE_JQ's own header comment already documents for v1). Pipe-
# delimited output (not JSON) for the same reason wd_sample's own _WD_SAMPLE_JQ
# is pipe- not @tsv-delimited: bash IFS strips leading whitespace, and pipes
# are not IFS whitespace, so empty leading fields stay empty and distinguishable
# from "absent".
_WD_V2_SAMPLE_JQ='
reduce inputs as $e (
  {round_done:false, gate_rc_present:false, gate_rc:null,
   abandoned:false,
   own_launcher_pid:null, own_pid:null, own_seq:null,
   wc_seq:null, wc_ts:null,
   verifying:false,
   live_seq:null, live_ts:null};
  if $e.lane == $lane and $e.seq > $baseline then
    if $e.type == "round_done" then
      .round_done = true
      | .gate_rc_present = ($e.payload.gate_rc != null)
      | .gate_rc = ($e.payload.gate_rc // null)
    elif ($e.type == "alert" and (($e.payload.kind // "") == "abandoned")) then
      .abandoned = true
    elif $e.type == "ownership" then
      .own_launcher_pid = ($e.payload.launcher_pid // null)
      | .own_pid = ($e.payload.pid // null)
      | .own_seq = $e.seq
    elif $e.type == "waiting_child" then
      .wc_seq = $e.seq | .wc_ts = $e.ts
    elif ($e.type == "state" and (($e.payload.state // "") == "verifying")) then
      .verifying = true
    elif ($e.type == "prompt" or $e.type == "heartbeat" or $e.type == "checkpoint" or $e.type == "state") then
      .live_seq = $e.seq | .live_ts = $e.ts
    else . end
  else . end
)
| "\(.round_done)|\(.gate_rc_present)|\(.gate_rc // "")|\(.abandoned)|\(.own_launcher_pid // "")|\(.own_pid // "")|\(.own_seq // "")|\(.wc_seq // "")|\(.wc_ts // "")|\(.verifying)|\(.live_ts // "")"
'

# @description Sample the v2 fields for RUN/LANE post-BASELINE in ONE jq
#   spawn, then set the caller's WD2_* out-variables (dynamic-scope
#   assignment, same convention wd_sample uses for WD_AGE/WD_DONE). Torn-tail
#   resilient the same way wd_sample is: on a jq failure (near-certainly a
#   concurrent in-progress append) retries once with the last line dropped
#   before giving up to all-empty/false defaults.
# @arg $1 run  @arg $2 lane  @arg $3 baseline seq
# @set WD2_ROUND_DONE WD2_GATE_RC_PRESENT WD2_ABANDONED WD2_VERIFYING (0|1)
# @set WD2_GATE_RC WD2_OWN_LPID WD2_OWN_PID WD2_OWN_SEQ WD2_WC_SEQ WD2_WC_TS
#   WD2_LIVE_TS (each may be empty)
wd_sample_v2() {
  local run="$1" lane="$2" baseline="$3"
  local log extracted jq_rc=0
  log="${FOREMAN_HOME}/runs/${run}/events.jsonl"
  WD2_ROUND_DONE=0; WD2_GATE_RC_PRESENT=0; WD2_GATE_RC=""
  WD2_ABANDONED=0
  WD2_OWN_LPID=""; WD2_OWN_PID=""; WD2_OWN_SEQ=""
  WD2_WC_SEQ=""; WD2_WC_TS=""
  WD2_VERIFYING=0
  WD2_LIVE_TS=""
  [[ -f "$log" ]] || return 0
  extracted="$(jq -r --arg lane "$lane" --argjson baseline "$baseline" "$_WD_V2_SAMPLE_JQ" -n -- "$log" 2>/dev/null)" || jq_rc=$?
  if (( jq_rc != 0 )); then
    local tmp
    tmp="$(mktemp)"
    if head -n -1 "$log" > "$tmp" 2>/dev/null; then
      jq_rc=0
      extracted="$(jq -r --arg lane "$lane" --argjson baseline "$baseline" "$_WD_V2_SAMPLE_JQ" -n -- "$tmp" 2>/dev/null)" || jq_rc=$?
    fi
    rm -f "$tmp"
  fi
  (( jq_rc != 0 )) && return 0
  extracted="${extracted//$'\r'/}"
  [[ -z "$extracted" ]] && return 0
  local f_round_done f_gate_rc_present f_gate_rc f_abandoned f_own_lpid f_own_pid f_own_seq f_wc_seq f_wc_ts f_verifying f_live_ts
  IFS='|' read -r f_round_done f_gate_rc_present f_gate_rc f_abandoned f_own_lpid f_own_pid f_own_seq f_wc_seq f_wc_ts f_verifying f_live_ts <<<"$extracted" || true
  [[ "$f_round_done" == "true" ]] && WD2_ROUND_DONE=1
  [[ "$f_gate_rc_present" == "true" ]] && WD2_GATE_RC_PRESENT=1
  WD2_GATE_RC="$f_gate_rc"
  [[ "$f_abandoned" == "true" ]] && WD2_ABANDONED=1
  WD2_OWN_LPID="$f_own_lpid"
  WD2_OWN_PID="$f_own_pid"
  WD2_OWN_SEQ="$f_own_seq"
  WD2_WC_SEQ="$f_wc_seq"
  WD2_WC_TS="$f_wc_ts"
  [[ "$f_verifying" == "true" ]] && WD2_VERIFYING=1
  WD2_LIVE_TS="$f_live_ts"
  return 0
}

# @description The v2 typed-state cascade for ONE tick, LATCHED case only --
#   the caller handles the unlatched/QUEUED window and the v1 hand-off
#   itself; by the time this runs, baseline is known and an `ownership`
#   event has already been confirmed for this round. Implements spec steps
#   1-2 and 4-7 (SUCCEEDED, FAILED, STARTING, WAITING_CHILD, AGENT_ABANDONED,
#   RUNNING_IMPL/VERIFYING/STALLED/DEAD) in that priority order -- first
#   match wins. Step 3 (QUEUED) only ever applies pre-latch (caller); step 8
#   (v1 compatibility) is the caller's hand-off to wd_main (never reached
#   here).
#
#   AGENT_ABANDONED predicate note (merged-reality deviation, flagged per
#   task instructions): the plan text's AGENT_ABANDONED/T2 predicate also
#   names "no attempt-fresh report" as a condition. watch.sh has no
#   REPORT_PATH -- GATE_CMD/REPORT_PATH are lane-run.sh's own argv and are
#   NEVER mirrored into any event payload (see lane-supervise.sh's own
#   GROUND-TRUTH comment making exactly this point). The reachable-from-
#   outside reduction used here is: pid-confirmed-dead AND no round_done --
#   round_done in the shipped schema is ONLY ever emitted when the report was
#   fresh AND the gate passed (lane-run.sh's --round mode), so "no
#   round_done" already implies "no attempt-fresh report OR a failed gate"
#   given the current lane-run.sh implementation.
# @arg $1 run  @arg $2 lane  @arg $3 wt  @arg $4 hb heartbeat-file path
# @arg $5 baseline seq  @arg $6 now_epoch (seconds, from the injected clock)
# @set WD2_LABEL one of SUCCEEDED FAILED STARTING WAITING_CHILD
#   AGENT_ABANDONED RUNNING_IMPL VERIFYING STALLED DEAD
# @set WD2_AGE seconds (0 for SUCCEEDED/FAILED/AGENT_ABANDONED)
# @set WD2_PHASE the un-escalated phase label (STARTING/RUNNING_IMPL/
#   VERIFYING) for grace-clamping, empty when not applicable
wd_classify_v2() {
  local run="$1" lane="$2" wt="$3" hb="$4" baseline="$5" now_epoch="$6"
  wd_sample_v2 "$run" "$lane" "$baseline"
  WD2_PHASE=""

  if (( WD2_ROUND_DONE == 1 )) && { [[ "$WD2_GATE_RC_PRESENT" == "0" ]] || [[ "$WD2_GATE_RC" == "0" ]]; }; then
    WD2_LABEL=SUCCEEDED; WD2_AGE=0
    return 0
  fi
  if (( WD2_ABANDONED == 1 )); then
    WD2_LABEL=FAILED; WD2_AGE=0
    return 0
  fi

  local hb_epoch=""
  hb_epoch="$(wd_hb_last_epoch "$hb")"

  if [[ -z "$hb_epoch" ]] && (( WD2_VERIFYING == 0 )); then
    # STARTING: prompt/ownership exists (guaranteed -- the caller only
    # reaches wd_classify_v2 once latched with ownership confirmed) but $hb
    # has no parseable line yet. Rework Round 1 (Opus audit finding 3, LOW):
    # gated on WD2_VERIFYING==0 -- a {state:"verifying"} event already
    # confirms the round reached the gate phase, so an empty/unparsable $hb
    # at that point must classify as VERIFYING (its own, larger
    # verify_stale bound), never STARTING (starting_stale) -- see the
    # RUNNING_IMPL/VERIFYING block below, which now tolerates an empty
    # hb_epoch instead of assuming this branch always catches that case.
    local anchor_ts anchor_epoch age
    anchor_ts="$(wd_baseline_ts "$run" "$lane" "$baseline")"
    if [[ -n "$anchor_ts" ]] && anchor_epoch="$(date -u -d "$anchor_ts" +%s 2>/dev/null)"; then
      age=$(( now_epoch - anchor_epoch ))
    else
      age=0
    fi
    (( age < 0 )) && age=0
    WD2_AGE="$age"
    WD2_PHASE=STARTING
    local bucket; bucket="$(wd_state_v2 "$age" "${STARTING_STALE:-90}" "${STALL_DEAD:-900}")"
    case "$bucket" in
      RUNNING) WD2_LABEL=STARTING ;;
      STALLED) WD2_LABEL=STALLED ;;
      DEAD) WD2_LABEL=DEAD ;;
    esac
    return 0
  fi

  # WAITING_CHILD: latest waiting_child event newer than the last heartbeat
  # activity. "heartbeat activity" here means $hb specifically (the T2/F5
  # doctrine's authoritative gate-phase liveness source), not event-log
  # heartbeats -- a waiting_child/round_incomplete pair is lane-run.sh's own
  # terminal signal for THIS round (nothing further ever appends to $hb once
  # it fires), so this is effectively "has the round ended incomplete".
  if [[ -n "$WD2_WC_SEQ" ]]; then
    local wc_epoch=""
    wc_epoch="$(date -u -d "$WD2_WC_TS" +%s 2>/dev/null || true)"
    # An empty hb_epoch here means "no $hb activity at all" (reachable only
    # via the WD2_VERIFYING==1 edge the STARTING gate above now carves out)
    # -- explicitly "no prior activity to compare against" rather than
    # relying on bash's empty-string-as-zero arithmetic coercion.
    if [[ -n "$wc_epoch" ]] && { [[ -z "$hb_epoch" ]] || (( wc_epoch > hb_epoch )); }; then
      WD2_LABEL=WAITING_CHILD
      WD2_AGE=$(( now_epoch - wc_epoch ))
      (( WD2_AGE < 0 )) && WD2_AGE=0
      return 0
    fi
  fi

  # AGENT_ABANDONED: owning pid confirmed dead. no round_done and no
  # (newer-than-$hb) waiting_child are already known true here -- either
  # branch above would have returned first otherwise.
  if ! wd_pid_alive "$WD2_OWN_LPID" "$WD2_OWN_PID"; then
    WD2_LABEL=AGENT_ABANDONED; WD2_AGE=0
    return 0
  fi

  # RUNNING_IMPL / VERIFYING / STALLED / DEAD: liveness age = seconds since
  # the LATEST of (event-log liveness event for the attempt, $hb last-line
  # ts). "verifying is not stalled": VERIFYING uses its own, larger
  # verify_stale bound instead of impl_stale. hb_epoch may be EMPTY here
  # (Rework Round 1 finding 3's edge: verifying with $hb not yet populated) --
  # liveness_epoch falls back to the event-log's own live_epoch in that case
  # (the {state:"verifying"} event itself is tracked as a live_ts by
  # _WD_V2_SAMPLE_JQ), and to now_epoch (age 0) only if NEITHER signal
  # exists at all.
  local live_epoch=""
  if [[ -n "$WD2_LIVE_TS" ]]; then
    live_epoch="$(date -u -d "$WD2_LIVE_TS" +%s 2>/dev/null || true)"
  fi
  local liveness_epoch=""
  if [[ -n "$hb_epoch" && -n "$live_epoch" ]]; then
    if (( live_epoch > hb_epoch )); then liveness_epoch="$live_epoch"; else liveness_epoch="$hb_epoch"; fi
  elif [[ -n "$hb_epoch" ]]; then
    liveness_epoch="$hb_epoch"
  elif [[ -n "$live_epoch" ]]; then
    liveness_epoch="$live_epoch"
  else
    liveness_epoch="$now_epoch"
  fi
  WD2_AGE=$(( now_epoch - liveness_epoch ))
  (( WD2_AGE < 0 )) && WD2_AGE=0

  local phase="RUNNING_IMPL" warn="${IMPL_STALE:-300}"
  if (( WD2_VERIFYING == 1 )); then
    phase="VERIFYING"; warn="${VERIFY_STALE:-600}"
  fi
  WD2_PHASE="$phase"
  local bucket; bucket="$(wd_state_v2 "$WD2_AGE" "$warn" "${STALL_DEAD:-900}")"
  case "$bucket" in
    RUNNING) WD2_LABEL="$phase" ;;
    STALLED) WD2_LABEL=STALLED ;;
    DEAD) WD2_LABEL=DEAD ;;
  esac
  return 0
}

# @description Apply the phase-transition grace window: if LABEL is an
#   escalated bucket (STALLED/DEAD) reached while still within WATCH_GRACE
#   seconds of PHASE_ENTERED_MS (the wd_now_ms() reading at which the
#   CURRENTLY ACTIVE phase -- STARTING/RUNNING_IMPL/VERIFYING -- was
#   entered), clamp back to PHASE_LABEL (the un-escalated label for that
#   phase) instead. This is what lets "verifying is not stalled" hold right
#   at a phase boundary even when $hb's last line briefly predates the
#   transition (e.g. the gate's own first heartbeat has not landed yet --
#   lane_refresh_gate_ownership_pid's own bound is up to 20s). Loop-mode
#   only: `--once` (wd_once) has no prior-tick history to measure a phase
#   entry from, so it reports the raw classification directly instead (see
#   wd_once's own doc comment).
# @arg $1 label the raw classification from wd_classify_v2
# @arg $2 phase_label the un-escalated label for the CURRENTLY ACTIVE phase
#   (empty when not applicable, e.g. WAITING_CHILD/AGENT_ABANDONED/FAILED/
#   SUCCEEDED, none of which are ever clamped)
# @arg $3 now_ms  @arg $4 phase_entered_ms  @arg $5 grace_s
# @stdout the (possibly clamped) label
wd_grace_clamp() {
  local label="$1" phase_label="$2" now_ms="$3" phase_entered_ms="$4" grace_s="$5"
  if [[ -n "$phase_label" ]] && { [[ "$label" == "STALLED" ]] || [[ "$label" == "DEAD" ]]; }; then
    local grace_ms=$(( grace_s * 1000 ))
    if (( now_ms - phase_entered_ms < grace_ms )); then
      printf '%s\n' "$phase_label"
      return 0
    fi
  fi
  printf '%s\n' "$label"
  return 0
}

# @description `--once` entry point: evaluate a SINGLE classification and
#   exit with the mapped code (spec: "evaluates one classification and exits
#   with the mapped code (0 for non-terminal healthy states)"). Stateless by
#   design -- there is no prior tick to debounce against or to grace-clamp
#   relative to (wd_grace_clamp needs "when did we enter this phase", which a
#   single detached invocation cannot know), so this reports the raw
#   classification directly. Dispatches through the SAME QUEUED / v1-fallback
#   / v2-cascade decision the loop makes, just for one instant instead of
#   forever.
# @arg $1 run  @arg $2 lane  @arg $3 wt  @arg $4 after_seq (may be empty)
# @arg $5 hb heartbeat-file path
# @exitcode 0 SUCCEEDED or any non-terminal healthy state; 3 DEAD; 4 FAILED;
#   5 AGENT_ABANDONED
wd_once() {
  local run="$1" lane="$2" wt="$3" after_seq="$4" hb="$5"
  local now_ms; now_ms="$(wd_now_ms)"
  local now_epoch=$(( now_ms / 1000 ))
  local now_ts; now_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local baseline="" latched=0
  if [[ -n "$after_seq" ]]; then
    baseline="$after_seq"; latched=1
  else
    local pseq; pseq="$(wd_last_prompt_seq "$run" "$lane")"
    pseq=${pseq%$'\r'}
    if [[ -n "$pseq" && "$pseq" =~ ^[0-9]+$ ]]; then baseline="$pseq"; latched=1; fi
  fi

  if (( latched == 0 )); then
    if wd_is_queued "$run" "$lane"; then
      echo "$now_ts $run/$lane QUEUED age=0s"
      return 0
    fi
    echo "$now_ts $run/$lane STARTING age=0s"
    return 0
  fi

  if ! wd_ownership_exists "$run" "$lane" "$baseline"; then
    # v1-compatibility, single-shot: same primitives wd_main uses (wd_sample
    # + wd_state), with count=0/prev=RUNNING (a cold read -- consistent with
    # wd_main's own documented cold-start debounce; see watch.bats's
    # "restart-independence" tests).
    local WD_AGE WD_DONE
    wd_sample "$run" "$lane" "$now_epoch" "$baseline"
    if (( WD_DONE == 1 )); then
      echo "DONE"
      return 0
    fi
    local result bucket
    result="$(wd_state "$WD_AGE" RUNNING 0)"
    bucket="${result%% *}"
    echo "$now_ts $run/$lane $bucket age=${WD_AGE}s"
    [[ "$bucket" == "DEAD" ]] && return 3
    return 0
  fi

  wd_classify_v2 "$run" "$lane" "$wt" "$hb" "$baseline" "$now_epoch"
  case "$WD2_LABEL" in
    SUCCEEDED) echo "DONE"; return 0 ;;
    FAILED) echo "$now_ts $run/$lane FAILED"; return 4 ;;
    AGENT_ABANDONED) echo "$now_ts $run/$lane AGENT_ABANDONED age=${WD2_AGE}s"; return 5 ;;
    DEAD)
      echo "$now_ts $run/$lane DEAD age=${WD2_AGE}s"
      local sha="" ckpt_rc=0
      sha="$(ckpt_latest "$wt" "$lane" 2>/dev/null)" || ckpt_rc=$?
      sha=${sha%$'\r'}
      if (( ckpt_rc != 0 )); then
        echo "kill+retry from <no checkpoint: not a git worktree>"
      elif [[ -z "$sha" ]]; then
        echo "kill+retry from <no checkpoint yet>"
      else
        echo "kill+retry from $sha"
      fi
      return 3 ;;
    *)
      echo "$now_ts $run/$lane $WD2_LABEL age=${WD2_AGE}s"
      return 0 ;;
  esac
}

# @description The v2 continuous watchdog loop: unlatched (QUEUED-aware)
#   polling identical in cadence to wd_main's own, a ONE-TIME v1-fallback
#   hand-off decision made at the moment of first latch (see the DISPATCH
#   doctrine comment above), and -- once confirmed v2 -- the full typed-state
#   cascade with phase-transition grace, printing once per transition and
#   emitting a synchronous alert on each, matching wd_main's own observable
#   conventions (one line per transition, "DONE"/exit 0 on completion, a
#   durably-emitted alert before any exit).
# @arg $1 run  @arg $2 lane  @arg $3 wt  @arg $4 after_seq (may be empty)
# @arg $5 hb heartbeat-file path
wd_main_v2() {
  local run="$1" lane="$2" wt="$3" after_seq="$4" hb="$5"
  local tick="${WATCH_TICK:-15}"
  local start_epoch; start_epoch=$(( $(wd_now_ms) / 1000 ))
  local baseline="" latched=0
  if [[ -n "$after_seq" ]]; then
    baseline="$after_seq"; latched=1
  else
    local pseq; pseq="$(wd_last_prompt_seq "$run" "$lane")"
    pseq=${pseq%$'\r'}
    if [[ -n "$pseq" && "$pseq" =~ ^[0-9]+$ ]]; then baseline="$pseq"; latched=1; fi
  fi

  # Already latched at process start: decide v1-fallback vs v2 via a BOUNDED
  # RE-POLL (Rework Round 1, Opus audit finding 1, MEDIUM), not a single
  # point-in-time check -- see wd_wait_ownership's own doc comment. Commits
  # to the v1 hand-off only if ownership is STILL absent once the bound
  # (~25s, T4a clock seam) expires.
  if (( latched == 1 )) && ! wd_wait_ownership "$run" "$lane" "$baseline"; then
    wd_main "$run" "$lane" "$wt" "$baseline"
    return 0
  fi

  local typed_state="RUNNING" phase=""
  local phase_entered_ms; phase_entered_ms="$(wd_now_ms)"
  local tick_start
  while true; do
    tick_start="$(wd_now_ms)"
    local now_epoch=$(( tick_start / 1000 ))
    local label="" age=0 new_phase=""

    if (( latched == 0 )); then
      local pseq; pseq="$(wd_last_prompt_seq "$run" "$lane")"
      pseq=${pseq%$'\r'}
      if [[ -n "$pseq" && "$pseq" =~ ^[0-9]+$ ]]; then
        baseline="$pseq"; latched=1
        # Same bounded re-poll as the process-start check above (finding 1):
        # a late-latching round gets the SAME ~25s grace before this
        # watcher commits to the v1 hand-off.
        if ! wd_wait_ownership "$run" "$lane" "$baseline"; then
          wd_main "$run" "$lane" "$wt" "$baseline"
          return 0
        fi
        # Falls through: latched, confirmed v2 (possibly after re-polling) --
        # classify below.
      fi
    fi

    if (( latched == 0 )); then
      # QUEUED is checked via a REAL lane-queue.sh/pueue round-trip (bounded
      # by WATCH_QUEUE_TIMEOUT, but still real subprocess latency -- an
      # unreachable daemon's own connection-refused path measured ~2.2s on
      # this host). The FIRST tick this comes back "not queued", hand off to
      # wd_main PERMANENTLY (same one-time-decision doctrine as the
      # ownership-based hand-off above) rather than reimplementing v1's own
      # unlatched debounce/forced-STALLED-before-DEAD subtleties here a
      # second time -- exactly the kind of divergence risk "wraps around it,
      # never rewrites it" exists to prevent. Only a CONFIRMED-queued lane
      # stays in this loop (continuously re-checked, since a real pueue
      # task's status can change at any tick).
      if wd_is_queued "$run" "$lane"; then
        label=QUEUED; age=0; new_phase=""
      else
        wd_main "$run" "$lane" "$wt" ""
        return 0
      fi
    else
      wd_classify_v2 "$run" "$lane" "$wt" "$hb" "$baseline" "$now_epoch"
      label="$WD2_LABEL"; age="$WD2_AGE"; new_phase="$WD2_PHASE"
      if [[ "$new_phase" != "$phase" ]]; then
        phase_entered_ms="$tick_start"
      fi
      label="$(wd_grace_clamp "$label" "$new_phase" "$tick_start" "$phase_entered_ms" "${WATCH_GRACE:-10}")"
      # Same "force STALLED before DEAD" rule wd_main's own loop applies (see
      # its "If age jumped mid-range -> DEAD between polls" comment): a slow
      # sample, a cold start, or (as in the grace-window test) an already-
      # ancient $hb/liveness ts observed for the first time right as grace
      # expires can jump straight from a healthy phase label to DEAD in one
      # tick, skipping the observable STALLED step the silent-lane
      # integration contract requires (PHASE -> STALLED -> DEAD, never
      # PHASE -> DEAD). Forcing it here costs one extra tick before the
      # real DEAD transition/exit -- restart-independent, matching v1's own
      # documented tradeoff.
      if [[ "$label" == "DEAD" && "$typed_state" != "STALLED" ]]; then
        label=STALLED
      fi
    fi
    phase="$new_phase"

    if [[ "$label" != "$typed_state" ]]; then
      local now_ts; now_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      case "$label" in
        SUCCEEDED)
          echo "DONE"
          exit 0
          ;;
        FAILED)
          echo "$now_ts $run/$lane FAILED age=${age}s"
          exit 4
          ;;
        AGENT_ABANDONED)
          echo "$now_ts $run/$lane AGENT_ABANDONED age=${age}s"
          local ap; ap="$(jq -cn --arg state AGENT_ABANDONED --argjson age "$age" '{state:$state,age:$age}' 2>/dev/null || echo '{}')"
          ap=${ap//$'\r'/}
          if ! el_emit "$run" alert "$lane" "$ap" >/dev/null; then
            log "watch: alert emit failed for $run/$lane (AGENT_ABANDONED)"
          fi
          exit 5
          ;;
        *)
          echo "$now_ts $run/$lane $label age=${age}s"
          local payload; payload="$(jq -cn --arg state "$label" --argjson age "$age" '{state:$state,age:$age}' 2>/dev/null || echo '{}')"
          payload=${payload//$'\r'/}
          if ! el_emit "$run" alert "$lane" "$payload" >/dev/null; then
            log "watch: alert emit failed for $run/$lane"
          fi
          if [[ "$label" == "DEAD" ]]; then
            local sha="" ckpt_rc=0
            sha="$(ckpt_latest "$wt" "$lane" 2>/dev/null)" || ckpt_rc=$?
            sha=${sha%$'\r'}
            if (( ckpt_rc != 0 )); then
              echo "kill+retry from <no checkpoint: not a git worktree>"
            elif [[ -z "$sha" ]]; then
              echo "kill+retry from <no checkpoint yet>"
            else
              echo "kill+retry from $sha"
            fi
            exit 3
          fi
          ;;
      esac
    fi
    typed_state="$label"
    wd_sleep_remainder "$tick_start" "$tick"
  done
}

# @description CLI entry point: parse the extended v2 grammar `[--once]
#   [--after-seq N] [--hb FILE] RUN LANE WORKTREE` -- flags may appear
#   anywhere (before or after the three positionals), so the FROZEN v1
#   invocation shape (`RUN LANE WORKTREE [--after-seq N]`, flags AFTER the
#   positionals) keeps working byte-for-byte unchanged. Exactly 3 positional
#   arguments are required after flag extraction; --after-seq/--hb each
#   require a following value; an unrecognized flag or wrong positional count
#   is a usage error (exit 2), same as before. Dispatches to wd_once
#   (--once), or wd_main_v2 (the v2 loop, which itself hands off to the
#   frozen wd_main when this round turns out to be pure v1 -- see wd_main_v2's
#   own doc comment). Guarded by the BASH_SOURCE!=$0 check below so tests can
#   source this file for wd_state/wd_state_v2/etc. with zero side effects.
# @arg $@ [--once] [--after-seq N] [--hb FILE] RUN LANE WORKTREE
main() {
  local once=0 after_seq="" hb_override=""
  local -a positional=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --once) once=1; shift ;;
      --after-seq)
        if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ ]]; then wd_usage; exit 2; fi
        after_seq="$2"; shift 2 ;;
      --hb)
        if [[ $# -lt 2 ]]; then wd_usage; exit 2; fi
        hb_override="$2"; shift 2 ;;
      -*)
        wd_usage; exit 2 ;;
      *)
        positional+=("$1"); shift ;;
    esac
  done
  if [[ "${#positional[@]}" -ne 3 ]]; then
    wd_usage
    exit 2
  fi
  local run="${positional[0]}" lane="${positional[1]}" wt="${positional[2]}"
  if [[ ! "$run" =~ ^[A-Za-z0-9._-]+$ ]] || [[ ! "$lane" =~ ^[A-Za-z0-9._-]+$ ]]; then
    wd_usage
    exit 2
  fi
  wd_resolve_config
  local hb="${hb_override:-$wt/.harness/heartbeat.ndjson}"
  if (( once == 1 )); then
    wd_once "$run" "$lane" "$wt" "$after_seq" "$hb"
    exit $?
  fi
  wd_main_v2 "$run" "$lane" "$wt" "$after_seq" "$hb"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
