#!/usr/bin/env bash
# @file liveness.sh
# @brief Process liveness judged on STATE and CPU-since-start, never existence.
#
# Motivated by 2026-07-29 S-2/S-7: a grok round sat at STAT=Tl with TIME=00:00:00
# for eleven minutes after SIGTTIN. pgrep / kill -0 matched it as alive.
#
# Sound signals only:
#   - STAT beginning with T  -> SUSPENDED (cannot self-recover)
#   - zero CPU after grace   -> WEDGED (never began working), only for processes
#     with a `timeout` ancestor so interactive sessions are excluded
#
# NOTE: a CPU-delta "hang check" was tried and REMOVED. A vendor CLI blocked on
# a model response legitimately consumes no CPU for minutes, and the check
# produced a false positive on every run -- first on a live interactive session,
# then on a healthy dispatched lane waiting on the network. Only STOPPED state
# and zero-CPU-since-start survive as sound signals. Do not reintroduce a
# CPU-delta hang check without a predicate that distinguishes network-blocked
# from wedged.
#
# Source this file; do not execute.

# @description Convert ps ELAPSED ([[dd-]hh:]mm:ss) to seconds.
lv_etime_secs() {
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

# @description Convert ps TIME (cpu) to seconds.
lv_cputime_secs() { lv_etime_secs "$1"; }

# @description True if PID has a `timeout` ancestor (dispatched lane, not interactive).
# @arg $1 pid
lv_is_dispatched_lane() {
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

# @description Existence-only predicate (the DEFECT under test). Returns 0 if
#   any process matching the name/pid exists — including STAT=T stopped ones.
#   Kept only so tests can prove a pgrep-style check would have lied.
# @arg $1 pid
lv_exists_only() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

# @description pgrep-style existence by command name (defect under test).
# @arg $1 pattern
lv_pgrep_exists() {
  pgrep -f "$1" >/dev/null 2>&1
}

# @description Read ps fields for a pid: stat time etime comm
# @arg $1 pid
# @stdout "stat time etime comm" or empty if gone
lv_ps_fields() {
  local pid="$1"
  ps -o stat=,time=,etime=,comm= -p "$pid" 2>/dev/null | awk '{print $1, $2, $3, $4}'
}

# @description Classify one process for liveness.
# @arg $1 pid
# @arg $2 grace seconds (default 300) for zero-CPU WEDGED
# @stdout one of: DEAD | SUSPENDED | WEDGED | ALIVE
#   followed by evidence text on the same line after a tab
# @exitcode 0 always (classification is on stdout)
lv_classify_pid() {
  local pid="$1" grace="${2:-300}"
  local fields stat cput etim comm el cp
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    printf 'DEAD\tno such process pid=%s\n' "${pid:-empty}"
    return 0
  fi
  fields="$(lv_ps_fields "$pid")"
  if [[ -z "$fields" ]]; then
    printf 'DEAD\tno ps fields for pid=%s\n' "$pid"
    return 0
  fi
  read -r stat cput etim comm <<<"$fields"
  if [[ "$stat" == T* ]]; then
    printf 'SUSPENDED\tpid=%s stat=%s (STAT begins with T; cannot self-recover)\n' \
      "$pid" "$stat"
    return 0
  fi
  el=$(lv_etime_secs "$etim")
  cp=$(lv_cputime_secs "$cput")
  # Zero-CPU-after-grace only for dispatched lanes (timeout ancestor) and
  # vendor-like commands — never interactive sessions.
  if (( el > grace && cp == 0 )) && lv_is_dispatched_lane "$pid"; then
    printf 'WEDGED\tpid=%s zero CPU after %ss elapsed (cpu=%s stat=%s)\n' \
      "$pid" "$el" "$cput" "$stat"
    return 0
  fi
  printf 'ALIVE\tpid=%s stat=%s cpu=%s elapsed=%s\n' "$pid" "$stat" "$cput" "$etim"
  return 0
}

# @description True if pid is live work (ALIVE), false for DEAD/SUSPENDED/WEDGED.
#   Replaces kill -0 / pgrep as a liveness predicate.
# @arg $1 pid
# @arg $2 optional grace
# @exitcode 0 ALIVE; 1 not live work
lv_is_live() {
  local pid="$1" grace="${2:-300}" line kind
  line="$(lv_classify_pid "$pid" "$grace")"
  kind="${line%%$'\t'*}"
  [[ "$kind" == "ALIVE" ]]
}
