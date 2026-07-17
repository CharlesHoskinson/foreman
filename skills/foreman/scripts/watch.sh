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
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/eventlog.sh"
source "$SCRIPT_DIR/lib/checkpoint.sh"

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
  echo "Usage: watch.sh RUN_ID LANE WORKTREE [--after-seq N]" >&2
}

# @description Strip a trailing CR from a jq-derived scalar (this host's
#   Windows jq.exe emits CRLF even when the underlying event log is CR-clean).
# @arg $1 value
# @stdout the value with any trailing CR removed
wd_strip_cr() {
  local v="$1"
  printf '%s' "${v%$'\r'}"
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

# @description Sleep the remainder of a tick budget measured from an
#   EPOCHREALTIME start. No-ops (no process spawn) when already at/over budget
#   so slow samples do not compound with a full extra sleep.
# @arg $1 start EPOCHREALTIME at tick start
# @arg $2 tick seconds (non-negative integer)
wd_sleep_remainder() {
  local start_rt="$1" tick="$2"
  local now_rt=$EPOCHREALTIME
  local si=${start_rt%%.*} ni=${now_rt%%.*} sf nf
  if [[ "$start_rt" == *.* ]]; then sf=${start_rt#*.}; else sf=0; fi
  if [[ "$now_rt" == *.* ]]; then nf=${now_rt#*.}; else nf=0; fi
  sf="${sf}000"; sf=${sf:0:3}
  nf="${nf}000"; nf=${nf:0:3}
  local rem=$(( tick * 1000 - ( (10#$ni * 1000 + 10#$nf) - (10#$si * 1000 + 10#$sf) ) ))
  if (( rem > 0 )); then
    sleep "$(printf '%d.%03d' $((rem / 1000)) $((rem % 1000)))"
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

  local now_epoch=$EPOCHSECONDS
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
  local start_epoch=$EPOCHSECONDS
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
    tick_start=$EPOCHREALTIME
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
        WD_DONE=0
        WD_AGE=$(( EPOCHSECONDS - start_epoch ))
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

# @description CLI entry point: validate arity (3 args, or 5 with
#   --after-seq N), charset, then run the watchdog loop with the resolved
#   baseline override. Guarded by the BASH_SOURCE!=$0 check below so tests
#   can source this file for wd_state with zero side effects.
# @arg $@ RUN_ID LANE WORKTREE [--after-seq N]
main() {
  local after_seq=""
  if [[ $# -eq 3 ]]; then
    :
  elif [[ $# -eq 5 && "$4" == "--after-seq" && "$5" =~ ^[0-9]+$ ]]; then
    after_seq="$5"
  else
    wd_usage
    exit 2
  fi
  local run="$1" lane="$2" wt="$3"
  if [[ ! "$run" =~ ^[A-Za-z0-9._-]+$ ]] || [[ ! "$lane" =~ ^[A-Za-z0-9._-]+$ ]]; then
    wd_usage
    exit 2
  fi
  wd_main "$run" "$lane" "$wt" "$after_seq"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
