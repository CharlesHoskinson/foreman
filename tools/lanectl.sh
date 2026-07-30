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
#   1. FM_LANE_OWNER / FM_LANE_LABEL in the environment -> inherited by children
#   2. a PID registry file under $FM_LANE_DIR -> survives argv rewriting
#   3. a directory marker (.fm-lane-owner) via `claim` -> the ONLY source that
#      survives a vendor CLI re-execing itself. Observed 2026-07-29: grok
#      replaced its own process (pid 984219 -> 1030746); the replacement carried
#      neither the inherited FM_LANE_* environment nor the registered pid. The
#      worktree it ran in did not change, so the directory marker still
#      attributed it. Keep all three.
#
# Never uses `pkill -f`: it has previously matched its own command line.
#
# Usage:
#   lanectl.sh launch LABEL -- CMD...   start a tagged lane (backgrounded)
#   lanectl.sh adopt PID LABEL          claim an already-running process subtree
#   lanectl.sh claim DIR LABEL          write a directory ownership marker
#   lanectl.sh ps [--all]|progress [--watch S]               list my lanes (or every tagged lane)
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

# @description Mark a directory as owned by this lane owner. Attribution by cwd
#   is the only source that survives a vendor CLI re-execing itself (see header).
# @arg $1 directory  @arg $2 label
cmd_claim() {
  local dir="$1" label="${2:-claimed}"
  [[ -d "$dir" ]] || { echo "not a directory: $dir" >&2; return 1; }
  printf 'owner=%s\nlabel=%s\nclaimed=%s\n' \
    "$FM_LANE_OWNER" "$label" "$(date -u +%FT%TZ)" > "$dir/.fm-lane-owner"
  echo "claimed $dir owner=$FM_LANE_OWNER label=$label"
}

# @description Owner recorded by a directory marker, walking up from a cwd.
owner_by_cwd() {
  local d="$1" guard=0
  while [[ -n "$d" && "$d" != "/" ]]; do
    (( ++guard > 24 )) && break
    if [[ -r "$d/.fm-lane-owner" ]]; then
      sed -n 's/^owner=//p' "$d/.fm-lane-owner" | head -1
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# @description Label recorded by a directory marker, walking up from a cwd.
label_by_cwd() {
  local d="$1" guard=0
  while [[ -n "$d" && "$d" != "/" ]]; do
    (( ++guard > 24 )) && break
    if [[ -r "$d/.fm-lane-owner" ]]; then
      sed -n 's/^label=//p' "$d/.fm-lane-owner" | head -1
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# @description Owner tag of a pid: environ, then registry, then directory marker.
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
  # Last resort: the directory the process is running in. Survives re-exec.
  local cwd; cwd="$(readlink -f "/proc/$1/cwd" 2>/dev/null)"
  if [[ -n "$cwd" ]]; then
    local co; co="$(owner_by_cwd "$cwd" 2>/dev/null)"
    if [[ -n "$co" ]]; then printf '%s\n' "$co"; return 0; fi
  fi
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
    if [[ -z "$l" ]]; then
      local cw; cw="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)"
      [[ -n "$cw" ]] && l="$(label_by_cwd "$cw" 2>/dev/null)"
    fi
    printf '%-8s %-6s %-9s %-10s %-22s %-14s %s\n' \
      "$pid" "$stat" "$cput" "$etim" "$o" "${l:--}" "$comm"
  done < <(ps -eo pid,stat,time,etime,comm --no-headers |
           awk '$5 ~ /^(grok|codex|bash|timeout|sleep)$/')
}

#!/usr/bin/env bash
# @description Per-lane progress from the surfaces a lane ACTUALLY emits.
#
#   Three healthy lanes were killed on 2026-07-30 because liveness was read from
#   `ps` — and a lane in preamble has no process-layer signal at all: it spends
#   its first many minutes in model calls with no child process. Absence of a
#   vendor process is the normal early state, not a fault.
#
#   The valid surfaces already exist and were simply never surfaced together:
#     <lane>.out             the lane's own stdout — grows whenever it speaks
#     .harness/heartbeat.ndjson   written by the compiled launcher
#     .harness/stream.ndjson      CMD stdout, live
#     git status                  files the worker has actually changed
#
#   Byte growth in <lane>.out is the one surface demonstrated to move while a
#   lane is alive, so it is the primary signal here. `--watch` samples twice and
#   reports the DELTA, which is what distinguishes "working" from "wedged" —
#   a single reading cannot.
#
# Usage:
#   lanectl.sh progress [--watch SECONDS] [--all]
# @stdout one row per lane: bytes, delta, heartbeat age, changed files, state
cmd_progress() {
  local watch=0 all=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --watch) watch="${2:-5}"; shift 2 ;;
      --all)   all="--all"; shift ;;
      *) shift ;;
    esac
  done

  # Snapshot every lane output file this owner has (or all owners with --all).
  local pat="$FM_LANE_DIR/$FM_LANE_OWNER.*.out"
  [[ -n "$all" ]] && pat="$FM_LANE_DIR/*.out"

  declare -A before=()
  local f
  for f in $pat; do
    [[ -e "$f" ]] || continue
    before["$f"]=$(stat -c %s "$f" 2>/dev/null || echo 0)
  done

  if (( watch > 0 )); then
    sleep "$watch"
  fi

  printf '%-22s %-10s %-9s %-11s %-7s %s\n' \
    LANE BYTES "DELTA/${watch}s" HEARTBEAT CHANGED LAST
  for f in $pat; do
    [[ -e "$f" ]] || continue
    local base label owner now delta wt hb hbage changed last
    base="$(basename "$f" .out)"
    owner="${base%%.*}"
    label="${base#*.}"
    now=$(stat -c %s "$f" 2>/dev/null || echo 0)
    delta=$(( now - ${before["$f"]:-0} ))

    # Worktree is discovered from the lane marker, never guessed.
    wt="$(grep -rl "label=$label" /root/fm-wt/*/.fm-lane-owner 2>/dev/null | head -1)"
    wt="${wt%/.fm-lane-owner}"
    [[ -d "$wt" ]] || wt="/root/fm-wt/$label"

    hbage="-"
    hb="$wt/.harness/heartbeat.ndjson"
    if [[ -r "$hb" ]]; then
      local m; m=$(stat -c %Y "$hb" 2>/dev/null || echo 0)
      hbage="$(( $(date +%s) - m ))s"
    fi

    changed="-"
    if [[ -d "$wt/.git" || -f "$wt/.git" ]]; then
      changed=$(git -C "$wt" status --porcelain -uall 2>/dev/null | wc -l)
    fi

    last="$(tail -c 120 "$f" 2>/dev/null | tr '\n' ' ' | tail -c 60)"

    printf '%-22s %-10s %-9s %-11s %-7s %s\n' \
      "$label" "$now" "$delta" "$hbage" "$changed" "${last:--}"
  done

  if (( watch > 0 )); then
    echo ""
    echo "DELTA is bytes written during the ${watch}s window. A lane with"
    echo "DELTA=0 AND no heartbeat AND no changed files may be wedged — but a"
    echo "lane in preamble legitimately shows all three, so do not kill on this"
    echo "alone below the measured ~30min preamble cost (AGENT_TRAPS section 8)."
  fi
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
      # Kill by recorded PID only. NEVER pkill -f.
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
  claim)  shift; cmd_claim "$@" ;;
  ps)     shift; cmd_ps "${1:-}" ;;
  progress) shift; cmd_progress "$@" ;;
  reap)   shift; cmd_reap "${1:-}" ;;
  sweep)  cmd_sweep ;;
  *) echo "usage: lanectl.sh {launch LABEL -- CMD...|adopt PID LABEL|claim DIR LABEL|ps [--all]|progress [--watch S]|reap [--force]|sweep}" >&2; exit 2 ;;
esac
