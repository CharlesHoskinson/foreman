#!/usr/bin/env bash
# @description Run a coding-CLI lane with durable-lanes instrumentation: tee the
#   reasoning stream to disk, checkpoint the worktree, and emit lifecycle events
#   (prompt, heartbeat, checkpoint, round_done). Stderr is joined into the
#   transcript via 2>&1 because coding CLIs emit reasoning there.
#
# CONTRACT (Rework Round 3, finding 1): CMD MUST be non-interactive. lane-run.sh
#   redirects CMD's own stdin from /dev/null (CMD only -- never lane-run.sh's own
#   stdin). This is a structural, not best-effort, fix: job control (`set -m`)
#   and the separate-process-group launch it required have been REMOVED
#   entirely, so there is no path left where CMD can be stopped as a background
#   job competing for the controlling terminal (the SIGTTIN/TTY hazard class).
#   CMD now shares lane-run.sh's own process group; since CMD never reads its
#   controlling terminal (stdin is /dev/null), it never contends for terminal
#   foreground ownership in the first place -- there is nothing left to detect
#   or fall back from. Do not re-add `set -m` / job control: see bugeventlog.md
#   and FOREMAN_REPORT.md (Rework Round 3, finding 1) for why this was a dead
#   end on Git Bash/MSYS2.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/checkpoint.sh
source "$SCRIPT_DIR/lib/checkpoint.sh"

# --- arity / validation (before unguarded positional use under set -u) ---
if (( $# < 5 )); then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD... (CMD must be non-interactive; stdin is redirected from /dev/null)" >&2
  exit 2
fi
if [[ "${4:-}" != "--" ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD... (CMD must be non-interactive; stdin is redirected from /dev/null)" >&2
  exit 2
fi
if [[ ! "${1:-}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD..." >&2
  exit 2
fi
if [[ ! "${2:-}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD..." >&2
  exit 2
fi
if [[ ! -d "${3:-}" ]]; then
  echo "usage: lane-run.sh RUN_ID LANE WORKTREE -- CMD..." >&2
  exit 2
fi

RUN="$1"
LANE="$2"
WT="$3"
shift 4

mkdir -p "$WT/.harness"

# @description Emit a machine-visible alert marking a bounded-kill escalation
#   (Rework Round 3, finding 2). This is deliberately an EVENT, not just a code
#   comment: full process-tree ownership does not exist in plain bash on Git
#   Bash/MSYS2 today (that arrives with foreman-launch@0.2.5), so whenever this
#   script actually has to force a kill, the limitation belongs in the
#   operator-visible event log, not buried in source.
#
#   Rework Round 4, finding 1: kill_cmd_bounded now calls this AT MOST ONCE
#   per invocation (see below) -- the escalation outcome and the sweep
#   outcome are folded into a single alert instead of two independent
#   alerts racing to describe one kill incident.
# @arg $1 which "cmd" or "tee" -- which tracked pid triggered the escalation
# @arg $2 sweep optional sweep outcome: "swept", "sweep_failed", or
#   "sweep_unavailable" (no /proc winpid). "swept" covers both an actual
#   kill AND a vacuous sweep (taskkill found nothing left to kill -- see
#   kill_cmd_bounded). Audit round-3 medium: the alert must fire ESPECIALLY
#   when the descendant sweep genuinely failed or was skipped -- that is
#   exactly when survivors are possible.
emit_kill_alert() {
  local which="$1" sweep="${2:-}"
  local payload='{"tree_kill":"best_effort","full_tree_kill_via":"foreman-launch@0.2.5"'
  if [[ -n "$sweep" ]]; then
    payload+=",\"sweep\":\"$sweep\""
  fi
  payload+='}'
  if ! el_emit "$RUN" alert "$LANE" "$payload" >/dev/null; then
    echo "lane-run: el_emit alert failed ($which kill escalation)" >&2
  fi
}

# @description Bounded TERM-then-KILL escalation against an explicitly tracked
#   pid, used to actively terminate CMD (Rework Round 3, finding 2). NEVER an
#   unbounded wait: liveness is polled via `kill -0` in a fixed loop capped by
#   ${LANE_KILL_GRACE:-5} seconds, so lane-run.sh cannot hang here even if CMD
#   ignores TERM outright. On the KILL branch, best-effort sweep CMD's
#   descendant tree via `taskkill //T //F` -- translating bash's MSYS pid to
#   the real Windows PID via /proc/<pid>/winpid first, since MSYS's own $! is
#   not a Windows PID and a raw `taskkill //PID <msys-pid>` always fails to
#   find the process. The /proc root used for that translation is itself
#   overridable via ${LANE_PROC_ROOT:-/proc} (test-only knob: pointing it at
#   an empty directory simulates a host with no /proc/*/winpid support
#   without touching the real /proc). This sweep is still best-effort (a
#   detached descendant that escapes the tree, or a host without
#   /proc/*/winpid, is not covered) -- emit_kill_alert makes that limitation
#   visible in the event log.
#
#   Rework Round 4, finding 1: this function now emits AT MOST ONE alert per
#   invocation (previously it could emit one for the KILL escalation itself
#   and a second, independent one for the sweep outcome -- two events for a
#   single kill incident). The escalation flag and the sweep outcome are
#   computed first, then folded into a single emit_kill_alert call. Rework
#   Round 4, finding 2: a taskkill exit code that means "nothing left to
#   kill" (process/tree already gone -- a VACUOUS sweep, not a failed one) is
#   no longer misreported as sweep_failed; only a genuinely unexpected
#   nonzero rc is. Empirically confirmed on this host (MSYS2/Git Bash
#   taskkill.exe wrapper): `taskkill //PID 4000000 //T //F` (a PID that does
#   not exist) exits 128 with "ERROR: The process ... not found."; that rc is
#   folded into the "swept" outcome alongside rc==0.
# @arg $1 pid pid to terminate
kill_cmd_bounded() {
  local pid="$1" grace="${LANE_KILL_GRACE:-5}" waited=0
  local escalated=0
  [[ -z "$pid" ]] && return 0
  kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null || true; return 0; }
  kill -TERM "$pid" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null && (( waited < grace )); do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    escalated=1
  fi
  # Best-effort full-tree sweep regardless of whether TERM alone already
  # stopped CMD's own pid, or KILL was needed: CMD may have spawned children
  # BEFORE it died, and killing/terminating CMD's own pid does not reach them
  # -- there is no process-group forwarding anymore (see the header contract
  # note; that is the accepted tradeoff of dropping job control). Windows
  # retains a child's recorded parent-PID in the process snapshot even after
  # the parent itself has exited, so `taskkill //T` against CMD's Windows PID
  # can still reach those children at this point. Read the winpid BEFORE the
  # final `wait` below so the winpid file is still resolvable even if $pid
  # is already a zombie.
  local winpid="" sweep_rc="" outcome=""
  winpid="$(cat "${LANE_PROC_ROOT:-/proc}/$pid/winpid" 2>/dev/null || true)"
  if [[ -n "$winpid" ]]; then
    # Capture the real rc without tripping `set -e` (this is a plain
    # statement, not part of a conditional, so an unguarded nonzero exit
    # here would abort the whole script).
    if taskkill //PID "$winpid" //T //F >/dev/null 2>&1; then
      sweep_rc=0
    else
      sweep_rc=$?
    fi
    if [[ "$sweep_rc" == "0" || "$sweep_rc" == "128" ]]; then
      # rc==0: a real kill happened. rc==128: taskkill's own "process not
      # found" rc on this host (see the function doc comment) -- a VACUOUS
      # sweep (nothing left to kill), not a failure.
      outcome=swept
    else
      # Sweep FAILED: descendants may survive. This is precisely when the
      # limitation must be operator-visible (audit round-3 medium).
      outcome=sweep_failed
    fi
  else
    # No winpid available (no /proc/<pid>/winpid on this host, or pid gone
    # from /proc): sweep skipped entirely -- same visibility requirement.
    outcome=sweep_unavailable
  fi
  # Single alert point (Rework Round 4, finding 1): fire iff KILL was needed
  # OR the sweep itself was not a clean/vacuous success. The clean path (no
  # escalation, sweep swept/vacuous) is silent -- nothing operator-visible
  # happened.
  if (( escalated == 1 )) || [[ "$outcome" == "sweep_failed" || "$outcome" == "sweep_unavailable" ]]; then
    emit_kill_alert cmd "$outcome"
  fi
  wait "$pid" 2>/dev/null || true
}

# @description Bounded reap of the tee consumer (Rework Round 3, finding 2).
#   Unlike kill_cmd_bounded, this first gives tee up to $grace seconds to exit
#   ON ITS OWN (it is likely still draining buffered output after CMD exits,
#   and killing it immediately would truncate the tail of a legitimate
#   transcript); only if it is STILL alive past that bound -- e.g. a detached
#   descendant of CMD inherited the write end of the pipe and is keeping it
#   open -- does this escalate TERM then KILL, each bounded the same way. This
#   replaces the old bare `wait` (which had no bound at all and could hang
#   lane-run.sh forever in exactly that detached-descendant scenario).
#   Sets the caller-visible `tee_escalated` flag when a kill was required, so
#   the caller can mark the round's instrumentation as degraded.
# @arg $1 pid tee's own pid (see the exec-trick note at the launch site below)
reap_tee_bounded() {
  local pid="$1" grace="${LANE_KILL_GRACE:-5}" waited=0
  tee_escalated=0
  [[ -z "$pid" ]] && return 0
  while kill -0 "$pid" 2>/dev/null && (( waited < grace )); do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    tee_escalated=1
    kill -TERM "$pid" 2>/dev/null || true
    waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < grace )); do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
      emit_kill_alert tee
    fi
  fi
  # Best-effort: on this host, `wait` on the process-substitution pid (even
  # after the exec-trick below makes it identify tee itself) sometimes returns
  # 127 ("not a child of this shell") rather than a real child of lane-run.sh
  # in bash's job-table sense. Guarded so that outcome is never fatal under
  # set -e and never blocks -- it is a fast, non-blocking call either way.
  wait "$pid" 2>/dev/null || true
}

# Single-writer-per-worktree lock: plain mkdir (no -p). If it exists, fail
# immediately — no stale-lock reclaim (ABA-unsafe on Git Bash/MSYS).
# lane_lock_owned only flips to 1 on OUR successful mkdir, so cleanup() can
# never rmdir a lock directory some other process created (e.g. a
# hypothetical future code path that installs the trap earlier) -- ownership
# is explicit, not inferred from control flow.
#
# Rework Round 3, finding 3: a signal delivered after mkdir succeeds but
# before ownership is recorded / the real cleanup trap is installed used to
# hit bash's default disposition and exit without releasing the lock,
# stranding it for every future lane-run against this worktree. Close that
# window: install a NON-EXITING pending-signal trap first (it only records
# which signal arrived; it never itself exits), complete mkdir + ownership
# recording, THEN install the real cleanup trap, THEN honor any signal that
# arrived during that critical section.
lane_lock_owned=0
_pending_signal=""
trap '_pending_signal=INT' INT
trap '_pending_signal=TERM' TERM

if ! mkdir "$WT/.harness/lane.lock" 2>/dev/null; then
  echo "lane-run: another lane-run owns this worktree: $WT" >&2
  trap - INT TERM
  exit 2
fi
lane_lock_owned=1

watcher_pid=""
cmd_pid=""
tee_pid=""

# @description Release the worktree lock (only if this process created it),
#   terminate CMD and the tee consumer via bounded escalation (never an
#   unbounded wait — see kill_cmd_bounded / reap_tee_bounded above), and stop
#   any background watcher. Invoked on EXIT/INT/TERM so nothing survives the
#   script, and lane-run.sh itself can never hang here even if CMD ignores
#   TERM or a detached descendant keeps the output pipe open.
cleanup() {
  if [[ -n "${cmd_pid:-}" ]]; then
    kill_cmd_bounded "$cmd_pid"
    cmd_pid=""
  fi
  if [[ -n "${tee_pid:-}" ]]; then
    reap_tee_bounded "$tee_pid"
    tee_pid=""
  fi
  if [[ -n "${watcher_pid:-}" ]]; then
    kill "$watcher_pid" 2>/dev/null || true
    wait "$watcher_pid" 2>/dev/null || true
    watcher_pid=""
  fi
  if [[ "$lane_lock_owned" == "1" ]]; then
    rmdir "$WT/.harness/lane.lock" 2>/dev/null || true
  fi
}
# INT/TERM must TERMINATE the script (audit t3-2 round 3: a trap that only
# runs cleanup and returns lets a pre-launch signal be swallowed, after which
# CMD launches anyway). cleanup() is idempotent; drop the EXIT trap before
# exiting so it does not run twice.
trap cleanup EXIT
trap 'cleanup; trap - EXIT; exit 130' INT
trap 'cleanup; trap - EXIT; exit 143' TERM

# Honor any signal that arrived during the mkdir/ownership-recording critical
# section above, now that the real cleanup trap is installed and can actually
# release the lock it just acquired.
if [[ -n "$_pending_signal" ]]; then
  echo "lane-run: signal $_pending_signal received during lock acquisition; exiting" >&2
  case "$_pending_signal" in
    INT) exit 130 ;;
    TERM) exit 143 ;;
  esac
fi

# prompt event: full CMD joined as a single string
prompt_payload="$(jq -cn --arg c "$*" '{cmd:$c}' | tr -d '\r')"
# Guarded like every other el_emit call in this file: el_emit can legitimately
# fail (mkdir-mutex retry timeout ~30s under .seq.lock contention, a jq
# failure, or a failed atomic seq write) and under `set -euo pipefail` an
# unguarded call here would abort the whole script before CMD ever runs --
# never emitting round_done and never running CMD at all. A missed prompt
# event must not block the round.
if ! el_emit "$RUN" prompt "$LANE" "$prompt_payload" >/dev/null; then
  echo "lane-run: el_emit prompt failed" >&2
fi

# Prefer stdbuf for line-buffered tee; gstdbuf (coreutils on some hosts) next.
# When both are absent, output is only as line-buffered as the wrapped CLI
# makes it itself.
STDBUF=""
if command -v stdbuf >/dev/null 2>&1; then
  STDBUF="stdbuf -oL"
elif command -v gstdbuf >/dev/null 2>&1; then
  STDBUF="gstdbuf -oL"
fi

CKPT_INTERVAL="${DURABLE_CHECKPOINT_INTERVAL:-20}"
HB_INTERVAL="${DURABLE_HEARTBEAT_INTERVAL:-30}"

stream_file_path="$WT/.harness/stream.ndjson"

# Round boundary for the background loop's stream-activity check below.
# stream.ndjson is append-only across repeated invocations against the same
# worktree, with no in-file round marker.
#
# Rework Round 3 addendum (auditor resolution note on Round B finding 6): the
# original fix compared the file's mtime against round_start_epoch with `>=`.
# Both values only have 1-second resolution, so a prior round's write landing
# in the SAME second as this round's start could still alias as current-round
# activity. Fix: prefer stream SIZE growth since round start as the activity
# signal -- it is resolution-independent (a byte count, not a clock tick), so
# a same-second collision can never produce a false positive. mtime is kept
# only as a fallback for hosts where a size stat is unavailable, now compared
# with strict `>` (equality is stale, not current) instead of `>=`.
round_start_epoch="$(date -u +%s)"
round_start_size=0
if [[ -f "$stream_file_path" ]]; then
  round_start_size="$(stat -c %s "$stream_file_path" 2>/dev/null || stat -f %z "$stream_file_path" 2>/dev/null || echo 0)"
fi

# Background watcher: mid-run heartbeats and activity-driven checkpoints.
# When both intervals are 0 (tests), skip the loop entirely and rely on the
# single post-run checkpoint in finalization.
if (( CKPT_INTERVAL > 0 || HB_INTERVAL > 0 )); then
  (
    set +e
    elapsed=0
    last_hb=0
    last_ckpt=0
    last_size="$round_start_size"
    last_mtime=""
    stream="$stream_file_path"
    while true; do
      sleep 1
      elapsed=$((elapsed + 1))
      if (( HB_INTERVAL > 0 && elapsed - last_hb >= HB_INTERVAL )); then
        last_hb=$elapsed
        if el_emit "$RUN" heartbeat "$LANE" '{}' >/dev/null; then
          :
        fi
      fi
      if (( CKPT_INTERVAL > 0 && elapsed - last_ckpt >= CKPT_INTERVAL )); then
        last_ckpt=$elapsed
        if [[ -f "$stream" ]]; then
          size="$(stat -c %s "$stream" 2>/dev/null || stat -f %z "$stream" 2>/dev/null || echo "")"
          activity=0
          if [[ -n "$size" ]]; then
            # Preferred, resolution-independent signal (see note above).
            if (( size > round_start_size )) && [[ "$size" != "$last_size" ]]; then
              activity=1
            fi
          else
            mtime="$(stat -c %Y "$stream" 2>/dev/null || stat -f %m "$stream" 2>/dev/null || echo "")"
            if [[ -n "$mtime" ]] && (( mtime > round_start_epoch )) && [[ "$mtime" != "$last_mtime" ]]; then
              activity=1
              last_mtime="$mtime"
            fi
          fi
          if (( activity )); then
            [[ -n "$size" ]] && last_size="$size"
            ckpt_err="$(mktemp)"
            if mid_sha=$(ckpt_snapshot "$WT" "$LANE" 2>"$ckpt_err"); then
              mid_payload="$(jq -cn --arg sha "$mid_sha" '{sha:$sha}' | tr -d '\r')"
              if el_emit "$RUN" checkpoint "$LANE" "$mid_payload" "$mid_sha" >/dev/null; then
                :
              fi
            fi
            rm -f "$ckpt_err"
          fi
        fi
      fi
    done
  ) &
  watcher_pid=$!
fi

stream_file="$stream_file_path"
stream_failed=0

# Rework Round 3, finding 1: job control (`set -m`) and the process-group
# launch it required have been REMOVED. CMD's stdin is redirected from
# /dev/null (MSYS maps /dev/null to NUL correctly) -- CMD is contractually
# non-interactive, so there is no SIGTTIN/TTY class left to detect or fall
# back from. lane-run.sh's OWN stdin is untouched.
#
# CMD's output is still routed through a process substitution (rather than a
# `|` pipeline stage) so cmd_pid from `$!` is CMD's own pid, not tee's --
# `wait "$cmd_pid"` yields CMD's real exit status directly.
#
# Rework Round 3, finding 2: tee's own pid is now captured explicitly instead
# of relying on a final bare `wait` to reap "whatever is left". The
# process-substitution subshell prints its own $BASHPID to tee_pid_file and
# then `exec`s directly into tee -- exec preserves the pid, so tee_pid_file
# ends up holding tee's REAL, individually-signalable pid (confirmed against
# this host: a CMD that backgrounds a detached grandchild holding the pipe
# open leaves tee blocked in read(), and only a direct kill against tee's OWN
# pid -- not its would-be parent -- unblocks it; see FOREMAN_REPORT.md).
tee_pid_file="$(mktemp)"
set +e
if [[ -n "$STDBUF" ]]; then
  # STDBUF is a fixed non-attacker-controlled string ("stdbuf -oL" or "gstdbuf -oL")
  # safe to word-split unquoted when non-empty.
  $STDBUF "$@" < /dev/null > >(printf '%s\n' "$BASHPID" > "$tee_pid_file"; exec tee -a "$stream_file") 2>&1 &
else
  "$@" < /dev/null > >(printf '%s\n' "$BASHPID" > "$tee_pid_file"; exec tee -a "$stream_file") 2>&1 &
fi
cmd_pid=$!
wait "$cmd_pid"
rc=$?

# Reap the background checkpoint/heartbeat watcher NOW, immediately after CMD
# finishes -- before anything else waits on background jobs, and before the
# finalization checkpoint below. Two reasons this must happen here first:
# (1) the watcher loops (`while true`) until explicitly killed, so reaping the
#     tee consumer next would otherwise race a still-running watcher's own
#     mid-run checkpoint; (2) per this rework's fix, the watcher's own
#     ckpt_snapshot must not still be in flight when the finalization
#     ckpt_snapshot runs below, or nothing serializes which checkpoint/
#     round_done event lands in events.jsonl first relative to which commit
#     actually became the ref tip. cleanup()'s own kill/wait remains a no-op
#     safety net for signal-driven exits (watcher_pid is cleared here so that
#     later no-op is truly a no-op).
if [[ -n "$watcher_pid" ]]; then
  kill "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
  watcher_pid=""
fi

# Retrieve tee's own pid (written by the process-substitution subshell before
# it execs into tee -- see the launch comment above). Bounded poll, not an
# unbounded wait: the write happens as the very first statement in that
# subshell, well before any real work, so this loop resolves almost
# immediately in practice; the cap just keeps it from ever hanging outright.
for _ in $(seq 1 100); do
  tee_pid="$(cat "$tee_pid_file" 2>/dev/null || true)"
  [[ -n "$tee_pid" ]] && break
  sleep 0.02
done
rm -f "$tee_pid_file"

# Rework Round 3, finding 2: replaces the old bare `wait` (which reaped
# "whatever background job is left" with no bound at all, and could hang
# forever if a detached descendant of CMD kept the output pipe open). This
# gives tee bounded time to finish draining, then escalates the same bounded
# way (TERM, then KILL) only if it is genuinely stuck.
reap_tee_bounded "$tee_pid"
tee_pid=""
if (( tee_escalated )); then
  echo "lane-run: tee consumer required forced termination; round is instrumentation-degraded" >&2
  stream_failed=1
fi
set -e

# --- Finalization: post-run checkpoint + round_done ---
# Required if-assignment pattern so set -e does not abort on ckpt_snapshot
# failure, and the real exit status is still observed for checkpoint_failed.
ckpt_err_file="$(mktemp)"
if sha=$(ckpt_snapshot "$WT" "$LANE" 2>"$ckpt_err_file"); then
  checkpoint_failed=0
else
  checkpoint_failed=1
  sha=""
  cat "$ckpt_err_file" >&2
fi
rm -f "$ckpt_err_file"

# Build round_done payload. Omit stream_failed / checkpoint_failed when false
# (do not set them to false). checkpoint is JSON null when sha is empty.
# tr -d '\r': Windows jq.exe emits CRLF; strip before storing/passing to el_emit.
round_payload="$(
  jq -cn \
    --argjson exit_code "$rc" \
    --arg sha "$sha" \
    --argjson stream_failed "$stream_failed" \
    --argjson checkpoint_failed "$checkpoint_failed" \
    '{exit_code:$exit_code, checkpoint:(if $sha == "" then null else $sha end)}
     | if $stream_failed != 0 then . + {stream_failed:true} else . end
     | if $checkpoint_failed != 0 then . + {checkpoint_failed:true} else . end' \
  | tr -d '\r'
)"

if (( checkpoint_failed == 0 )); then
  if ! el_emit "$RUN" round_done "$LANE" "$round_payload" "$sha" >/dev/null; then
    echo "lane-run: el_emit round_done failed" >&2
  fi
else
  if ! el_emit "$RUN" round_done "$LANE" "$round_payload" >/dev/null; then
    echo "lane-run: el_emit round_done failed" >&2
  fi
fi

# Always exit with CMD's real exit code (checkpoint/el_emit failures do not alter it).
exit "$rc"
