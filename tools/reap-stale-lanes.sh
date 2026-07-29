#!/usr/bin/env bash
# @file reap-stale-lanes.sh
# @brief Detect and kill wedged vendor-lane processes; never touch live work.
#
# Motivated by 2026-07-29: a grok round sat at STAT=T with 00:00:00 CPU for 11
# minutes after self-updating and taking SIGTTIN. A pgrep-based watchdog counted
# it as alive and would have waited out its full budget. Liveness must be judged
# on process STATE and CPU DELTA, never on existence.
#
# Kill criteria (a process must match one; each is a positive signal of wedge):
#   1. STAT begins with T  -> stopped by signal (SIGTTIN/SIGTTOU). Never useful.
#   2. Zero CPU consumed after GRACE seconds elapsed -> never started working.
#
# Deliberately NOT killed:
#   - `timeout` wrappers (they legitimately consume no CPU; killing the child
#     makes them exit on their own)
#   - anything not a vendor binary
#   - any process still accumulating CPU, however long it has run
#
# @arg $1 mode: "report" (default) or "reap"
set -uo pipefail

MODE="${1:-report}"
GRACE="${REAP_GRACE:-300}"     # seconds a process may consume no CPU before suspect
VENDORS='^(grok|codex)$'

# @description Convert ps ELAPSED ([[dd-]hh:]mm:ss) to seconds.
etime_secs() {
  local t="$1" d=0 h=0 m=0 s=0
  case "$t" in
    *-*) d="${t%%-*}"; t="${t#*-}" ;;
  esac
  case "$t" in
    *:*:*) IFS=: read -r h m s <<<"$t" ;;
    *:*)   IFS=: read -r m s   <<<"$t" ;;
    *)     s="$t" ;;
  esac
  echo $(( 10#${d:-0}*86400 + 10#${h:-0}*3600 + 10#${m:-0}*60 + 10#${s:-0} ))
}

# @description Convert ps TIME (cpu, [[dd-]hh:]mm:ss) to seconds.
cputime_secs() { etime_secs "$1"; }

# @description True if PID has a `timeout` ancestor, i.e. it is a dispatched
#   lane rather than an interactive session. This is the ONLY safe way to tell
#   them apart: an idle interactive vendor session legitimately consumes no CPU
#   and would otherwise be reaped as "hung". Learned the hard way 2026-07-29 --
#   the first version of this script flagged a live interactive codex session.
# @arg $1 pid
is_dispatched_lane() {
  local pid="$1" guard=0 comm ppid
  while [[ -n "$pid" && "$pid" != "1" && "$pid" != "0" ]]; do
    (( ++guard > 24 )) && return 1
    comm="$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ "$comm" == "timeout" ]] && return 0
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ -z "$ppid" ]] && return 1
    pid="$ppid"
  done
  return 1
}

mapfile -t ROWS < <(
  ps -eo pid,ppid,stat,time,etime,comm,args --no-headers 2>/dev/null |
  awk -v pat="$VENDORS" '$6 ~ pat { print }'
)

suspects=()
for row in "${ROWS[@]}"; do
  read -r pid _ppid stat cput etim comm _rest <<<"$row"
  [[ -z "${pid:-}" ]] && continue
  # Never consider an interactive session -- only dispatched lanes.
  is_dispatched_lane "$pid" || continue

  el=$(etime_secs "$etim")
  cp=$(cputime_secs "$cput")
  reason=""

  if [[ "$stat" == T* ]]; then
    reason="STOPPED (stat=$stat) — suspended by signal, cannot self-recover"
  elif (( el > GRACE && cp == 0 )); then
    reason="zero CPU after ${el}s elapsed — never began working"
  fi

  [[ -n "$reason" ]] && suspects+=("$pid|$comm|$stat|$cput|$etim|$reason")
done

# NOTE: a CPU-delta "hang check" was tried and REMOVED. A vendor CLI blocked on
# a model response legitimately consumes no CPU for minutes, and the check
# produced a false positive on every run -- first on a live interactive session,
# then on a healthy dispatched lane waiting on the network. Only STOPPED state
# and zero-CPU-since-start survive as sound signals. Do not reintroduce it
# without a predicate that distinguishes network-blocked from wedged.

if ((${#suspects[@]} == 0)); then
  echo "CLEAN: no wedged vendor processes (checked ${#ROWS[@]})"
  exit 0
fi

echo "SUSPECT: ${#suspects[@]}"
for s in "${suspects[@]}"; do
  IFS='|' read -r pid comm stat cput etim reason <<<"$s"
  printf '  pid=%-8s cmd=%-8s stat=%-5s cpu=%-9s elapsed=%-10s %s\n' \
    "$pid" "$comm" "$stat" "$cput" "$etim" "$reason"
done

[[ "$MODE" != "reap" ]] && { echo "(report mode; re-run with 'reap' to kill)"; exit 1; }

for s in "${suspects[@]}"; do
  IFS='|' read -r pid _ _ _ _ _ <<<"$s"
  # Kill by recorded PID only. NEVER pkill -f: it has previously matched its own
  # command line and killed the shell issuing it.
  kill -TERM "$pid" 2>/dev/null
done
sleep 3
for s in "${suspects[@]}"; do
  IFS='|' read -r pid _ _ _ _ _ <<<"$s"
  kill -KILL "$pid" 2>/dev/null
done
sleep 1
echo "--- after reap ---"
for s in "${suspects[@]}"; do
  IFS='|' read -r pid comm _ _ _ _ <<<"$s"
  if ps -p "$pid" >/dev/null 2>&1; then echo "  pid=$pid ($comm) SURVIVED"; else echo "  pid=$pid ($comm) reaped"; fi
done
