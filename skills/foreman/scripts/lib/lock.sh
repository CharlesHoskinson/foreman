#!/usr/bin/env bash
# @description Shared foreman lock helper: the single path by which the durable
#   core acquires every lock. Callers use fm_lock_acquire / fm_lock_release /
#   fm_with_lock rather than inline mkdir spin-loops.
#
# FLAT LOCKING (hard rule): at most one foreman lock may be held by this
# process / call-chain at a time via this helper. A nested acquisition is
# refused at runtime with FM_LOCK_NESTED. This file deliberately does NOT
# state, imply, or document any lock ordering — a stated ordering is standing
# permission to nest, and a deliberately-nesting configuration deadlocks at
# five steps under the formal model backing the lock-primitive-hardening
# spec. Nesting is refused, never scheduled.
#
# Mechanism selection: flock when available and trusted for the lock path;
# mkdir fallback under the same trust rule and no weaker one; refuse rather
# than acquire when trust is absent. Trust evaluation is a seam
# (fm_lock__verdict_for) replaced by round L2; this round fails closed.
#
# .seq.lock and .attempt.lock remain SEPARATE paths — callers pass distinct
# lock paths; this helper never collapses them.
#
# Source this file; do not execute.
#
# FM_LOCK_UNAVAILABLE detail-string shape (stable for L2/L4):
#   "<operation> <target>: <message>"
# where:
#   operation — the failing primitive name, one of:
#     "mkdir -p", "touch", "open fd", "flock -n", "mkdir"
#   target    — the path (or parent path) the operation acted on
#   message   — the primitive's stderr text when available; otherwise a short
#               fallback such as "failed" or "exec redirect failed (rc=N)".
# Bash does not expose errno numerically; the message is the portable stand-in
# for "errno" in this shell helper.

# Process-local hold state. At most one held lock (flat rule).
# Idempotent init: re-sourcing must not erase a live outer lock's record.
: "${_FM_LOCK_HELD_PATH:=}"
: "${_FM_LOCK_MECHANISM:=}"
: "${_FM_LOCK_FD:=}"

# Selected mechanism of the currently held lock (empty when none held).
# Callers such as el_init read this to decide conditional stale-lock
# reclamation: flock releases on process death; a mkdir lock does not.
: "${FM_LOCK_MECHANISM:=}"

# Default bounded spin, matching historical eventlog spin (~1500 * 0.02s).
: "${FM_LOCK_TIMEOUT_SEC:=30}"

# ---------------------------------------------------------------------------
# Refusal vocabulary — exactly six codes, ordered chain, first match wins.
# ---------------------------------------------------------------------------
# 1. FM_LOCK_NESTED              — decided at request time (before arg checks)
# 2. FM_LOCK_FS_UNSUPPORTED      — no available mechanism covers the FS class
# 3. FM_LOCK_NO_ATOMIC_PRIMITIVE — every available mechanism trusted-negative
# 4. FM_LOCK_PROBE_UNTRUSTED     — no trusted verdict of either polarity
# 5. FM_LOCK_UNAVAILABLE         — residual; carries a detail string
# 6. FM_LOCK_TIMEOUT             — spin expired on already-selected+engaged mech
# ---------------------------------------------------------------------------

# @description Emit one refusal in the one-shape form and return non-zero.
#   Scoped to the refused acquisition: does not release or alter any outer
#   lock already held by this process; does not enter a critical section;
#   writes the code (and optional detail) to stderr; returns non-zero.
# @arg $1 code one of the six FM_LOCK_* refusal codes
# @arg $2 detail optional detail string (required in spirit for UNAVAILABLE)
# @stderr the refusal code, optionally followed by a detail string
# @exitcode 1 always
fm_lock__refuse() {
  local code="$1"
  local detail="${2:-}"
  if [[ -n "$detail" ]]; then
    printf '%s %s\n' "$code" "$detail" >&2
  else
    printf '%s\n' "$code" >&2
  fi
  return 1
}

# @description Trust-evaluation seam for one (mechanism, lock_path) pair.
#
#   CONTRACT (round L1 body; round L2 replaces the body, not the signature):
#     Called with:
#       $1 MECHANISM  — "flock" or "mkdir"
#       $2 LOCKPATH   — absolute or relative path of the lock to acquire
#     Signals (stdout + exit 0 in all three cases):
#       trusted-positive : echoes exactly "atomic"
#         Mechanism is provably atomic for LOCKPATH (trusted, current
#         verdict covering LOCKPATH's filesystem class).
#       trusted-negative : echoes exactly "non-atomic"
#         Atomicity has been positively disproved for this mechanism
#         (and, for path-sensitive data, for LOCKPATH).
#       no verdict available : echoes nothing (empty stdout)
#         No trusted verdict of either polarity is available — atomicity
#         is unproven, not disproved.
#       filesystem-class barrier (L2 may also echo): "fs-unsupported"
#         Mechanism has trusted data on some classes, but LOCKPATH's
#         filesystem class is covered by none of them. Distinct from
#         "no verdict" so guard 2 (FM_LOCK_FS_UNSUPPORTED) can fire.
#
#   Round L2 is expected to replace this body with the full evaluation:
#     read ${FOREMAN_TOOL_CHECK_JSON:-$HOME/.foreman/last-tool-check.json},
#     enforce the six-condition currency check, match SHA-256 digests
#     against env/reference-manifest.toml, compute LOCKPATH's filesystem
#     class, and return one of the signals above. L2 must NOT change
#     callers of this function or the public acquire/release API.
#
#   Round L1 CONSERVATIVE DEFAULT: always "no verdict available". No
#   mechanism earns trust. Failing open here is the defect this package
#   exists to remove — do not stub trusted-positive for anything.
#
# @arg $1 mechanism "flock" or "mkdir"
# @arg $2 lock_path path the lock would protect / live at
# @stdout "atomic" | "non-atomic" | "fs-unsupported" | empty
# @exitcode 0
fm_lock__verdict_for() {
  # L1: no verdict source exists yet. Fail closed.
  # L2 replaces this body.
  :
}

# @description List lock mechanisms available on this host (not yet trusted).
# @stdout one mechanism name per line: "flock" if present, always "mkdir"
# @exitcode 0
fm_lock__available_mechanisms() {
  if command -v flock >/dev/null 2>&1; then
    printf '%s\n' "flock"
  fi
  printf '%s\n' "mkdir"
}

# @description Resolve which mechanism (if any) is trusted for LOCKPATH.
#   Trust and filesystem-support causes are decided entirely here, BEFORE
#   any spin/retry loop. That ordering is structural: FM_LOCK_TIMEOUT can
#   never fire against an untrusted mechanism.
#
#   Ordered refusal chain (first matching guard wins), after NESTED which
#   is decided at request time by the caller:
#     2. FM_LOCK_FS_UNSUPPORTED       — aggregate: no available mechanism
#                                        has a trusted verdict covering the
#                                        lock path's filesystem class, and
#                                        at least one reported fs-unsupported
#     3. FM_LOCK_NO_ATOMIC_PRIMITIVE  — every available mechanism has a
#                                        trusted-negative (non-atomic) verdict
#     4. FM_LOCK_PROBE_UNTRUSTED      — no trusted verdict of either polarity
#                                        for any available mechanism
#     residual → FM_LOCK_UNAVAILABLE  — mixed states matching no guard above
#   On success, echoes the selected mechanism name (flock preferred over mkdir).
#
# @arg $1 lock_path
# @stdout selected mechanism on success
# @stderr one FM_LOCK_* code on refusal
# @exitcode 0 on selection; 1 on refusal
fm_lock__select_mechanism() {
  local lock_path="$1"
  local mech verdict
  local any_atomic=0
  local any_fs_unsup=0
  local any_trusted_polarity=0
  local all_trusted_negative=1
  local mech_count=0
  local flock_atomic=0
  local mkdir_atomic=0

  # ---- TRUST / FS RESOLUTION (no spin may begin before this returns) ----
  while IFS= read -r mech; do
    [[ -z "$mech" ]] && continue
    mech_count=$((mech_count + 1))
    # Capture verdict; empty means no trusted verdict available.
    verdict="$(fm_lock__verdict_for "$mech" "$lock_path" || true)"
    verdict="${verdict//$'\r'/}"
    verdict="${verdict//$'\n'/}"
    case "$verdict" in
      atomic)
        any_atomic=1
        any_trusted_polarity=1
        all_trusted_negative=0
        if [[ "$mech" == "flock" ]]; then
          flock_atomic=1
        elif [[ "$mech" == "mkdir" ]]; then
          mkdir_atomic=1
        fi
        ;;
      non-atomic)
        any_trusted_polarity=1
        ;;
      fs-unsupported)
        any_fs_unsup=1
        all_trusted_negative=0
        ;;
      *)
        # empty / unknown: no trusted verdict of either polarity for this mech
        all_trusted_negative=0
        ;;
    esac
  done < <(fm_lock__available_mechanisms)

  if (( mech_count == 0 )); then
    # No candidate binary at all — residual.
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "no lock mechanism binary available"
    return 1
  fi

  if (( any_atomic )); then
    # Prefer flock when both are trusted-positive for this path.
    if (( flock_atomic )); then
      printf '%s\n' "flock"
      return 0
    fi
    if (( mkdir_atomic )); then
      printf '%s\n' "mkdir"
      return 0
    fi
  fi

  # No trusted-positive selection. Refuse via ordered guards 2–4, then residual.
  # ASSERTION: we have not entered any spin/retry loop.
  #
  # Guard 2 (aggregate coverage): the lock path's filesystem class is covered
  # by no trusted verdict (of either polarity) for any available mechanism,
  # and at least one mechanism reported the fs-unsupported barrier. A single
  # mechanism reporting fs-unsupported does NOT fire this guard if another
  # available mechanism has a covering trusted verdict.
  if (( any_fs_unsup && any_trusted_polarity == 0 )); then
    fm_lock__refuse "FM_LOCK_FS_UNSUPPORTED"
    return 1
  fi
  if (( all_trusted_negative && any_trusted_polarity )); then
    # Guard 3: trusted verdict exists for every available mechanism and
    # every one is negative. (all_trusted_negative stays 1 only when every
    # mech returned non-atomic.)
    fm_lock__refuse "FM_LOCK_NO_ATOMIC_PRIMITIVE"
    return 1
  fi
  # Guard 4: no trusted verdict of either polarity for any available mechanism.
  # Must NOT catch mixed states (some polarity present, no positive selection).
  if (( any_trusted_polarity == 0 )); then
    fm_lock__refuse "FM_LOCK_PROBE_UNTRUSTED"
    return 1
  fi
  # Residual: enum total — mixed verdicts matching no guard (e.g. flock
  # trusted-negative + mkdir absent; flock fs-unsupported + mkdir non-atomic).
  fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
    "no trusted-positive mechanism available (mixed verdicts)"
  return 1
}

# @description Spin to acquire via flock on a lock file at LOCK_PATH.
#   Prerequisite: mechanism already selected and trusted (caller asserts).
#   Contention (EWOULDBLOCK / empty-stderr non-zero from flock -n) spins until
#   timeout. Any other flock/open failure is FM_LOCK_UNAVAILABLE immediately
#   with a detail naming the operation and its message — never TIMEOUT.
# @arg $1 lock_path
# @arg $2 timeout_sec
# @stderr FM_LOCK_UNAVAILABLE detail | FM_LOCK_TIMEOUT
# @exitcode 0 held; 1 refused
fm_lock__acquire_flock() {
  local lock_path="$1"
  local timeout_sec="$2"
  local parent err errfile open_rc
  parent="$(dirname -- "$lock_path")"

  if [[ -d "$lock_path" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "open flock lock file ${lock_path}: is a directory"
    return 1
  fi

  err="$(mkdir -p -- "$parent" 2>&1)" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir -p ${parent}: ${err:-failed}"
    return 1
  }

  err="$(touch -- "$lock_path" 2>&1)" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "touch ${lock_path}: ${err:-failed}"
    return 1
  }

  # Open a dedicated FD and hold it for the critical-section lifetime.
  # Capture open failure message without losing the FD on success.
  local lock_fd
  errfile="$(mktemp "${TMPDIR:-/tmp}/fm-lock-open.XXXXXX")" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "open fd for ${lock_path}: mktemp failed"
    return 1
  }
  open_rc=0
  exec 3>&2
  exec 2>"$errfile"
  exec {lock_fd}>>"$lock_path" || open_rc=$?
  exec 2>&3
  exec 3>&-
  if (( open_rc != 0 )); then
    err="$(tr -d '\r' <"$errfile" 2>/dev/null | head -n 1)"
    rm -f -- "$errfile"
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "open fd for ${lock_path}: ${err:-exec redirect failed (rc=${open_rc})}"
    return 1
  fi
  rm -f -- "$errfile"

  local start=$SECONDS
  local flock_err flock_rc engaged=0
  # ASSERTION: trust was resolved before this spin; TIMEOUT is only reachable
  # on an already-trusted, already-selected mechanism that has been engaged
  # (contention observed) at least once.
  while true; do
    flock_err="$(flock -n "$lock_fd" 2>&1)"
    flock_rc=$?
    if (( flock_rc == 0 )); then
      _FM_LOCK_FD="$lock_fd"
      return 0
    fi
    # Contention: non-zero with empty stderr (typical EWOULDBLOCK / exit 1).
    # Operation failure: non-zero with a message (ENOLCK, EOPNOTSUPP, EINVAL…).
    if [[ -n "$flock_err" ]]; then
      eval "exec ${lock_fd}>&-" 2>/dev/null || true
      flock_err="${flock_err//$'\r'/}"
      flock_err="${flock_err//$'\n'/ }"
      fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
        "flock -n ${lock_path}: ${flock_err}"
      return 1
    fi
    engaged=1
    if (( SECONDS - start >= timeout_sec )); then
      eval "exec ${lock_fd}>&-" 2>/dev/null || true
      # TIMEOUT only after the mechanism was engaged at least once.
      if (( engaged )); then
        fm_lock__refuse "FM_LOCK_TIMEOUT"
      else
        fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
          "flock -n ${lock_path}: failed without engagement"
      fi
      return 1
    fi
    sleep 0.02
  done
}

# @description Spin to acquire via mkdir mutex at LOCK_PATH (directory).
#   Prerequisite: mechanism already selected and trusted (caller asserts).
#   Contention (EEXIST / path already a directory) spins until timeout.
#   Any other mkdir failure is FM_LOCK_UNAVAILABLE immediately with a detail
#   naming the operation and its message — never TIMEOUT.
# @arg $1 lock_path
# @arg $2 timeout_sec
# @stderr FM_LOCK_UNAVAILABLE detail | FM_LOCK_TIMEOUT
# @exitcode 0 held; 1 refused
fm_lock__acquire_mkdir() {
  local lock_path="$1"
  local timeout_sec="$2"
  local parent err mkdir_err mkdir_rc
  parent="$(dirname -- "$lock_path")"

  if [[ -e "$lock_path" && ! -d "$lock_path" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir lock ${lock_path}: path exists and is not a directory"
    return 1
  fi

  err="$(mkdir -p -- "$parent" 2>&1)" || {
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir -p ${parent}: ${err:-failed}"
    return 1
  }

  local start=$SECONDS
  local engaged=0
  # ASSERTION: trust was resolved before this spin; TIMEOUT is only reachable
  # on an already-trusted, already-selected mechanism that has been engaged
  # (contention observed) at least once.
  while true; do
    mkdir_err="$(mkdir -- "$lock_path" 2>&1)"
    mkdir_rc=$?
    if (( mkdir_rc == 0 )); then
      return 0
    fi
    # Contention: directory already exists (EEXIST).
    if [[ -d "$lock_path" ]]; then
      engaged=1
      if (( SECONDS - start >= timeout_sec )); then
        fm_lock__refuse "FM_LOCK_TIMEOUT"
        return 1
      fi
      sleep 0.02
      continue
    fi
    # Operation failure: permission denied, read-only FS, ENOSPC, etc.
    mkdir_err="${mkdir_err//$'\r'/}"
    mkdir_err="${mkdir_err//$'\n'/ }"
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
      "mkdir ${lock_path}: ${mkdir_err:-failed}"
    return 1
  done
}

# @description Acquire a foreman lock at LOCK_PATH.
#   On success, holds the lock, sets FM_LOCK_MECHANISM to the selected
#   mechanism (flock|mkdir), and echoes that mechanism name on stdout so
#   callers (e.g. el_init reclamation) know which regime they are in.
#   IMPORTANT: do not capture this function in $(...) / command substitution
#   if you need the lock held in the current shell — a subshell would drop
#   process-local hold state and close the flock FD. Read FM_LOCK_MECHANISM
#   instead, or redirect stdout: fm_lock_acquire path >mech.txt
#   On refusal, emits exactly one FM_LOCK_* code on stderr, holds no lock
#   for this acquisition, enters no critical section, and returns non-zero.
#   Protected files for this acquisition are left byte-identical.
# @arg $1 lock_path path of the lock (file for flock; directory for mkdir)
# @arg $2 timeout_sec optional bounded spin seconds (default FM_LOCK_TIMEOUT_SEC)
# @stdout mechanism name on success (flock|mkdir)
# @stderr one FM_LOCK_* code on refusal (UNAVAILABLE includes a detail string)
# @exitcode 0 acquired; 1 refused
fm_lock_acquire() {
  local lock_path="${1:-}"
  local timeout_sec="${2:-$FM_LOCK_TIMEOUT_SEC}"
  local selected

  # Guard 1: flat locking — refuse nesting rather than order locks.
  # Evaluated FIRST, before argument validation, so empty-path + held outer
  # still names FM_LOCK_NESTED (ordered chain requires NESTED at request time).
  if [[ -n "$_FM_LOCK_HELD_PATH" ]]; then
    fm_lock__refuse "FM_LOCK_NESTED"
    return 1
  fi

  if [[ -z "$lock_path" ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "fm_lock_acquire: empty lock_path"
    return 1
  fi

  # Guards 2–4: trust and filesystem support — BEFORE any spin.
  # Structural guarantee: FM_LOCK_TIMEOUT cannot fire on an untrusted mechanism.
  selected="$(fm_lock__select_mechanism "$lock_path")" || return 1

  case "$selected" in
    flock)
      fm_lock__acquire_flock "$lock_path" "$timeout_sec" || return 1
      ;;
    mkdir)
      fm_lock__acquire_mkdir "$lock_path" "$timeout_sec" || return 1
      ;;
    *)
      fm_lock__refuse "FM_LOCK_UNAVAILABLE" \
        "internal: unknown selected mechanism '${selected}'"
      return 1
      ;;
  esac

  # Hold recorded only after successful acquisition (single owner).
  _FM_LOCK_HELD_PATH="$lock_path"
  _FM_LOCK_MECHANISM="$selected"
  FM_LOCK_MECHANISM="$selected"
  printf '%s\n' "$selected"
  return 0
}

# @description Release the foreman lock held at LOCK_PATH by this process.
#   Single-unconditional-release discipline: state is cleared once up front
#   so a second call cannot double-release; the underlying unlock runs at
#   most once. Safe to call only for a lock this process currently holds.
# @arg $1 lock_path path previously passed to fm_lock_acquire
# @exitcode 0 released (or nothing held for this path); 1 path mismatch
fm_lock_release() {
  local lock_path="$1"
  local mech="$_FM_LOCK_MECHANISM"
  local fd="$_FM_LOCK_FD"
  local held="$_FM_LOCK_HELD_PATH"

  if [[ -z "$held" ]]; then
    return 0
  fi
  if [[ "$held" != "$lock_path" ]]; then
    echo "fm_lock_release: path mismatch (held=${held}, asked=${lock_path})" >&2
    return 1
  fi

  # Clear hold state first — single release, no double-release on re-entry.
  _FM_LOCK_HELD_PATH=""
  _FM_LOCK_MECHANISM=""
  _FM_LOCK_FD=""
  FM_LOCK_MECHANISM=""

  case "$mech" in
    flock)
      if [[ -n "$fd" ]]; then
        flock -u "$fd" 2>/dev/null || true
        eval "exec ${fd}>&-" 2>/dev/null || true
      fi
      ;;
    mkdir)
      rmdir -- "$lock_path" 2>/dev/null || true
      ;;
  esac
  return 0
}

# @description Acquire LOCK_PATH, run COMMAND, release on every exit path.
#   The lock is released exactly once whether COMMAND succeeds, fails, calls
#   exit, or the shell is terminated by HUP/INT/TERM. A trap plus fall-through
#   share a once-flag so release is never double.
#   Acquisition refusal propagates without running COMMAND.
# @arg $1 lock_path
# @arg $2 timeout_sec optional; if the next arg is --, $2 is timeout and
#   command follows --; otherwise $2 starts the command and timeout is
#   FM_LOCK_TIMEOUT_SEC
# @arg $3... command and arguments (after optional timeout and --)
# @stdout command stdout (mechanism via FM_LOCK_MECHANISM)
# @stderr refusal codes or command stderr
# @exitcode acquire refusal status, or command status after release
fm_with_lock() {
  local lock_path="${1:-}"
  shift || true
  local timeout_sec="$FM_LOCK_TIMEOUT_SEC"

  if [[ "${1:-}" == "--" ]]; then
    shift
  elif [[ "${1:-}" =~ ^[0-9]+([.][0-9]+)?$ && "${2:-}" == "--" ]]; then
    timeout_sec="$1"
    shift 2
  elif [[ "${1:-}" =~ ^[0-9]+([.][0-9]+)?$ && $# -ge 2 ]]; then
    # numeric timeout without -- : treat as timeout when a command follows
    timeout_sec="$1"
    shift
  fi

  # Guard 1 before missing-command validation (same ordering as acquire).
  if [[ -n "$_FM_LOCK_HELD_PATH" ]]; then
    fm_lock__refuse "FM_LOCK_NESTED"
    return 1
  fi

  if [[ $# -lt 1 ]]; then
    fm_lock__refuse "FM_LOCK_UNAVAILABLE" "fm_with_lock: missing command"
    return 1
  fi

  # Do NOT capture acquire in $() — that runs in a subshell, drops hold
  # state, and for flock closes the lock FD on subshell exit (silent unlock).
  # Mechanism is exposed via FM_LOCK_MECHANISM after a successful acquire.
  fm_lock_acquire "$lock_path" "$timeout_sec" >/dev/null || return 1

  # Once-flag shared by trap and fall-through — exactly one release.
  local _fm_wl_path="$lock_path"
  local _fm_wl_released=0

  # shellcheck disable=SC2329
  _fm_with_lock_release_once() {
    if (( _fm_wl_released == 0 )); then
      _fm_wl_released=1
      fm_lock_release "$_fm_wl_path" || true
    fi
  }

  # EXIT covers normal return paths that still exit the shell (e.g. `exit 7`
  # inside the critical-section command). Signal traps cover termination.
  # shellcheck disable=SC2064
  trap '_fm_with_lock_release_once' EXIT
  # shellcheck disable=SC2064
  trap '_fm_with_lock_release_once; trap - EXIT HUP INT TERM; exit 129' HUP
  # shellcheck disable=SC2064
  trap '_fm_with_lock_release_once; trap - EXIT HUP INT TERM; exit 130' INT
  # shellcheck disable=SC2064
  trap '_fm_with_lock_release_once; trap - EXIT HUP INT TERM; exit 143' TERM

  local rc=0
  "$@" || rc=$?

  _fm_with_lock_release_once
  trap - EXIT HUP INT TERM
  return "$rc"
}
