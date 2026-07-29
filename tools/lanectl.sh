#!/usr/bin/env bash
# @file lanectl.sh
# @brief Launch, list and reap vendor lanes and watchdogs with an OWNER TAG, so
#   one session can always tell its own processes from a foreign session's.
#
# Motivated by 2026-07-29: a `lane-watchdog5.sh` was found running for 40+
# minutes and could only be attributed to another Claude session by reading
# /proc/<pid>/cwd and grepping the script for a harness path. Untagged lanes
# make "is this mine?" an archaeology exercise, and the safe default when you
# cannot tell is to leave a wedged process running.
#
# Ownership is recorded three ways, deliberately redundant:
#   1. FM_LANE_OWNER in the environment  -> inherited by every child
#   2. FM_LANE_LABEL in the environment  -> what the lane is for
#   3. a PID registry file under $FM_LANE_DIR -> survives exec/argv rewriting
#
# Never uses `pkill -f`: it has previously matched its own command line.
#
# Usage:
#   lanectl.sh launch LABEL -- CMD...   start a tagged lane (backgrounded)
#   lanectl.sh adopt PID LABEL          claim an already-running process
#   lanectl.sh ps [--all]               list my lanes (or every tagged lane)
#   lanectl.sh reap [--force]           kill MY wedged lanes only
#   lanectl.sh sweep                    drop dead PIDs from the registry
set -uo pipefail

FM_LANE_OWNER="${FM_LANE_OWNER:-$(hostname -s)-$$}"
FM_LANE_DIR="${FM_LANE_DIR:-/root/.foreman-lanes}"
REG="$FM_LANE_DIR/$FM_LANE_OWNER.pids"
mkdir -p "$FM_LANE_DIR"
touch "$REG"

# @description Read one variable out of a process environment.
# @arg $1 pid  @arg $2 var name
proc_env() {
  [[ -r "/proc/$1/environ" ]] || return 0
  tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | sed -n "s/^$2=//p" | head -1
}

# @description Owner tag of a pid: environ first, registry as fallback.
owner_of() {
  local o; o="$(proc_env "$1" FM_LANE_OWNER)"
  if [[ -n "$o" ]]; then printf '%s\n' "$o"; return 0; fi
  local f
  for f in "$FM_LANE_DIR"/*.pids; do
    [[ -e "$f" ]] || continue
    if awk -v p="$1" '$1==p{found=1} END{exit !found}' "$f"; then
      basename "$f" .pids; return 0
    fi
  done
  printf 'UNTAGGED\n'
}

etime_secs() {
  local t="$1" d=0 h=0 m=0 s=0
  case "$t" in *-*) d="${t%%-*}"; t="${t#*-}";; esac
  case "$t" in
    *:*:*) IFS=: read -r h m s <<<"$t" ;;
    *:*)   IFS=: read -r m s   <<<"$t" ;;
    *)     s="$t" ;;
  esac
  echo $(( 10#${d:-0}*86400 + 10#${h:-0}*3600 + 10#${m:-0}*60 + 10#${s:-0} ))
}

cmd_launch() {
  local label="$1"; shift
  [[ "${1:-}" == "--" ]] && shift
  FM_LANE_OWNER="$FM_LANE_OWNER" FM_LANE_LABEL="$label" \
    nohup "$@" </dev/null >>"$FM_LANE_DIR/$FM_LANE_OWNER.$label.out" 2>&1 &
  local pid=$!
  printf '%s\t%s\t%s\n' "$pid" "$label" "$(date -u +%FT%TZ)" >> "$REG"
  echo "launched pid=$pid owner=$FM_LANE_OWNER label=$label"
}

# @description Echo pid and all its descendants, breadth first.
_descendants() {
  local queue=("$1") out=() cur kids k
  while ((${#queue[@]})); do
    cur="${queue[0]}"; queue=("${queue[@]:1}"); out+=("$cur")
    kids="$(ps -o pid= --ppid "$cur" 2>/dev/null | tr -d " ")"
    for k in $kids; do queue+=("$k"); done
  done
  printf '%s\n' "${out[@]}"
}

cmd_adopt() {
  local pid="$1" label="${2:-adopted}" n=0 p
  if ! kill -0 "$pid" 2>/dev/null; then echo "pid $pid not alive" >&2; return 1; fi
  # Claim the whole subtree: a lane is a timeout wrapper plus its vendor child,
  # and adopting only the named pid leaves the child looking foreign.
  for p in $(_descendants "$pid"); do
    printf '%s\t%s\t%s\n' "$p" "$label" "$(date -u +%FT%TZ)" >> "$REG"
    n=$((n+1))
  done
  echo "adopted $n pid(s) rooted at $pid owner=$FM_LANE_OWNER label=$label"
}

cmd_ps() {
  local all="${1:-}"
  printf '%-8s %-6s %-9s %-10s %-22s %-14s %s\n' PID STAT CPU ELAPSED OWNER LABEL CMD
  local pid stat cput etim comm
  while read -r pid stat cput etim comm; do
    [[ -z "${pid:-}" ]] && continue
    local o; o="$(owner_of "$pid")"
    [[ "$all" != "--all" && "$o" != "$FM_LANE_OWNER" ]] && continue
    local l; l="$(proc_env "$pid" FM_LANE_LABEL)"
    [[ -z "$l" ]] && l="$(awk -v p="$pid" '$1==p{print $2; exit}' "$REG" 2>/dev/null)"
    printf '%-8s %-6s %-9s %-10s %-22s %-14s %s\n' \
      "$pid" "$stat" "$cput" "$etim" "$o" "${l:--}" "$comm"
  done < <(ps -eo pid,stat,time,etime,comm --no-headers |
           awk '$5 ~ /^(grok|codex|bash|timeout|sleep)$/')
}

cmd_reap() {
  local force="${1:-}" killed=0
  local pid stat cput etim comm
  while read -r pid stat cput etim comm; do
    [[ -z "${pid:-}" ]] && continue
    [[ "$(owner_of "$pid")" != "$FM_LANE_OWNER" ]] && continue   # MINE ONLY
    local el cp reason=""
    el=$(etime_secs "$etim"); cp=$(etime_secs "$cput")
    if [[ "$stat" == T* ]]; then
      reason="STOPPED (stat=$stat)"
    elif (( el > 300 && cp == 0 )) && [[ "$comm" =~ ^(grok|codex)$ ]]; then
      reason="zero CPU after ${el}s"
    fi
    [[ -z "$reason" ]] && continue
    echo "REAP pid=$pid ($comm) -- $reason"
    if [[ "$force" == "--force" ]]; then
      kill -TERM "$pid" 2>/dev/null; sleep 2; kill -KILL "$pid" 2>/dev/null
      killed=$((killed+1))
    fi
  done < <(ps -eo pid,stat,time,etime,comm --no-headers)
  if [[ "$force" != "--force" ]]; then echo "(dry run; pass --force to kill)"; fi
  echo "reaped=$killed owner=$FM_LANE_OWNER"
}

cmd_sweep() {
  local tmp; tmp="$(mktemp)"
  local n=0
  while IFS=$'\t' read -r pid label ts; do
    [[ -z "${pid:-}" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then printf '%s\t%s\t%s\n' "$pid" "$label" "$ts" >> "$tmp"
    else n=$((n+1)); fi
  done < "$REG"
  mv "$tmp" "$REG"
  echo "swept $n dead entries; $(wc -l < "$REG") live"
}

case "${1:-ps}" in
  launch) shift; cmd_launch "$@" ;;
  adopt)  shift; cmd_adopt "$@" ;;
  ps)     shift; cmd_ps "${1:-}" ;;
  reap)   shift; cmd_reap "${1:-}" ;;
  sweep)  cmd_sweep ;;
  *) echo "usage: lanectl.sh {launch LABEL -- CMD...|adopt PID LABEL|ps [--all]|reap [--force]|sweep}" >&2; exit 2 ;;
esac
