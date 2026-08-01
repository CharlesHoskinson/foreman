#!/usr/bin/env bash
# @file stall.sh
# @brief Stall taxonomy: SUSPENDED, NEVER_LAUNCHED, NO_OUTPUT, WEDGED.
#
# Each state is named by the evidence that produced it. "not responding" alone
# is not a permitted state.
#
#   SUSPENDED      — process STAT begins with T
#   NEVER_LAUNCHED — expected vendor process absent after grace
#   NO_OUTPUT      — deliverable content hash unchanged (never porcelain alone)
#   WEDGED         — dispatched vendor process with zero CPU after grace
#
# Source this file; do not execute. Requires liveness.sh and evidence.sh.

if ! declare -F evidence_content_digest >/dev/null 2>&1; then
  _STALL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=evidence.sh
  # shellcheck disable=SC1091  # Resolved from this library's directory at runtime.
  source "$_STALL_LIB_DIR/evidence.sh"
  unset _STALL_LIB_DIR
fi

# Grace defaults (seconds). Overridable via env for tests.
STALL_VENDOR_GRACE="${STALL_VENDOR_GRACE:-90}"
STALL_OUTPUT_GRACE="${STALL_OUTPUT_GRACE:-300}"
STALL_ZERO_CPU_GRACE="${STALL_ZERO_CPU_GRACE:-300}"

# @description Emit a stall report line: STATE evidence=...
# @arg $1 state  @arg $2 evidence text
stall_report() {
  local state="$1"; shift
  printf 'STALL %s evidence=%s\n' "$state" "$*"
}

# @description Classify a pid into SUSPENDED / WEDGED / ALIVE / DEAD.
# @arg $1 pid
# @arg $2 optional zero-cpu grace
# @stdout stall_report line or ALIVE line
stall_from_pid() {
  local pid="$1" grace="${2:-$STALL_ZERO_CPU_GRACE}"
  local line kind rest
  line="$(lv_classify_pid "$pid" "$grace")"
  kind="${line%%$'\t'*}"
  rest="${line#*$'\t'}"
  case "$kind" in
    SUSPENDED) stall_report SUSPENDED "$rest" ;;
    WEDGED)    stall_report WEDGED "$rest" ;;
    DEAD)      printf 'DEAD evidence=%s\n' "$rest" ;;
    ALIVE)     printf 'ALIVE evidence=%s\n' "$rest" ;;
    *)         printf 'ALIVE evidence=unknown kind=%s\n' "$kind" ;;
  esac
}

# @description NEVER_LAUNCHED: expected vendor binary not present after grace.
# @arg $1 vendor command name (e.g. grok, codex)
# @arg $2 elapsed seconds since lane start
# @arg $3 optional owner filter (empty = any)
# @stdout stall report or OK line
stall_never_launched() {
  local vendor="$1" elapsed="$2" owner="${3:-}"
  local grace="${STALL_VENDOR_GRACE}"
  if (( elapsed < grace )); then
    printf 'PENDING evidence=vendor=%s elapsed=%ss grace=%ss\n' \
      "$vendor" "$elapsed" "$grace"
    return 0
  fi
  # Search for a live (non-suspended) vendor process; optional owner match.
  local found=0 pid stat o
  while read -r pid stat; do
    [[ -z "$pid" ]] && continue
    [[ "$stat" == T* ]] && continue
    if [[ -n "$owner" ]]; then
      o="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^FM_LANE_OWNER=//p' | head -1 || true)"
      [[ "$o" == "$owner" ]] || continue
    fi
    found=1
    break
  done < <(ps -eo pid=,stat=,comm= --no-headers 2>/dev/null | awk -v v="$vendor" '$3==v {print $1, $2}')
  if (( found == 0 )); then
    stall_report NEVER_LAUNCHED \
      "searched for vendor process comm=$vendor owner=${owner:-any}; none found after ${elapsed}s (grace=${grace}s)"
    return 0
  fi
  printf 'OK evidence=vendor=%s process present\n' "$vendor"
}

# @description NO_OUTPUT: content hash of deliverable set unchanged.
# @arg $1 root directory
# @arg $2 baseline hash
# @arg $3 elapsed seconds
# @arg $@ optional pathspecs under root
# @stdout stall report or OK/PENDING line
stall_no_output() {
  local root="$1" baseline="$2" elapsed="$3"
  shift 3
  local grace="${STALL_OUTPUT_GRACE}"
  local current digest_file
  if (( elapsed < grace )); then
    printf 'PENDING evidence=output grace not reached elapsed=%ss grace=%ss\n' \
      "$elapsed" "$grace"
    return 0
  fi
  digest_file="$(mktemp)"
  if evidence_content_digest "$root" work "$@" >"$digest_file"; then
    current="$(<"$digest_file")"
    rm -f "$digest_file"
  else
    rm -f "$digest_file"
    printf 'UNVERIFIED evidence=content digest unavailable EVIDENCE_STATUS=%s EVIDENCE_REASON=%s root=%s\n' \
      "${EVIDENCE_STATUS:-INCONCLUSIVE}" "${EVIDENCE_REASON:-unknown-reason}" "$root"
    return 0
  fi
  if [[ "$baseline" == "$current" ]]; then
    stall_report NO_OUTPUT \
      "content hash unchanged hash=$current root=$root (not git status --porcelain)"
    return 0
  fi
  printf 'OK evidence=content hash changed before=%s after=%s\n' "$baseline" "$current"
}

# @description Full taxonomy probe for a supervised lane.
#   Order: SUSPENDED (if pid) > WEDGED (if pid) > NEVER_LAUNCHED > NO_OUTPUT > ALIVE.
# @arg $1 pid (may be empty)
# @arg $2 vendor name
# @arg $3 elapsed seconds
# @arg $4 deliverable root (may be empty to skip NO_OUTPUT)
# @arg $5 baseline content hash (may be empty)
# @arg $6 owner (optional)
# @stdout single classification line
stall_classify() {
  local pid="$1" vendor="$2" elapsed="$3" root="${4:-}" baseline="${5:-}" owner="${6:-}"
  local line kind

  if [[ -n "$pid" ]]; then
    line="$(stall_from_pid "$pid")"
    kind="${line%% *}"
    if [[ "$kind" == "STALL" ]]; then
      # STALL SUSPENDED|WEDGED ...
      printf '%s\n' "$line"
      return 0
    fi
    if [[ "$kind" == "DEAD" ]]; then
      # Process gone — fall through to NEVER_LAUNCHED / NO_OUTPUT
      :
    fi
  fi

  if [[ -n "$vendor" ]]; then
    line="$(stall_never_launched "$vendor" "$elapsed" "$owner")"
    if [[ "$line" == STALL\ NEVER_LAUNCHED* ]]; then
      printf '%s\n' "$line"
      return 0
    fi
  fi

  if [[ -n "$root" && -n "$baseline" ]]; then
    line="$(stall_no_output "$root" "$baseline" "$elapsed")"
    if [[ "$line" == STALL\ NO_OUTPUT* || "$line" == UNVERIFIED* ]]; then
      printf '%s\n' "$line"
      return 0
    fi
  fi

  if [[ -n "$pid" ]]; then
    line="$(stall_from_pid "$pid")"
    printf '%s\n' "$line"
    return 0
  fi
  printf 'ALIVE evidence=no stall signals fired elapsed=%ss\n' "$elapsed"
}
