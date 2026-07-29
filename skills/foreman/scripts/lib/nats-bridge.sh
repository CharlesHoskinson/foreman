#!/usr/bin/env bash
# @description One-way event-log → JetStream bridge for durable-lanes.
#   Publishes new events.jsonl lines to <subject_prefix>.<run>.<type>
#   (subject_prefix from [nats] config, default "foreman") with Nats-Msg-Id
#   dedup; advances the per-consumer nats-bridge cursor ONLY after a validated
#   JetStream PubAck (nats pub -J). The event log remains the sole source of
#   truth; on any publish failure the cursor does not advance and events replay
#   on the next pass. Source this file; no side effects at source time.
#
#   Locking: a per-run lock (.nats-bridge.lock) via lib/lock.sh
#   (fm_lock_acquire / fm_lock_release). Same helper contract as the event
#   log: flock when trusted, mkdir fallback under trust; timeout refuses
#   (never fail-open). Owner-aware reclamation of a wedged lock is via
#   fm_lock_reclaim at bridge start (records never swallowed).

# Resolve sibling libs relative to this file (safe when sourced).
# Guard: common.sh declares readonly EXIT_*; re-sourcing aborts under set -u/e.
_NB_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F run_dir >/dev/null 2>&1; then
  # shellcheck source=common.sh
  source "$_NB_LIB_DIR/common.sh"
fi
if ! declare -F el_read >/dev/null 2>&1; then
  # shellcheck source=eventlog.sh
  source "$_NB_LIB_DIR/eventlog.sh"
fi
if ! declare -F cfg_load >/dev/null 2>&1; then
  # shellcheck source=config.sh
  source "$_NB_LIB_DIR/config.sh"
fi
if ! declare -F fm_lock_acquire >/dev/null 2>&1; then
  # shellcheck source=lock.sh
  source "$_NB_LIB_DIR/lock.sh"
fi

# Path of the nats-bridge lock this process currently holds (empty if none).
# Used by the nb_bridge TERM trap so a non-holding instance never releases
# a foreign lock. The helper itself only releases a path it holds.
_NB_LOCK_PATH="${_NB_LOCK_PATH:-}"

# @description Release the nats-bridge lock only if this process holds it
#   via lib/lock.sh. Safe no-op when this process never acquired the lock
#   (e.g. a bridge instance whose last tick returned rc=5).
# @arg $1 lock path (e.g. "$rd/.nats-bridge.lock")
_nb_lock_release() {
  local lock="$1"
  if [[ -z "${_NB_LOCK_PATH:-}" || "$lock" != "$_NB_LOCK_PATH" ]]; then
    return 0
  fi
  fm_lock_release "$lock" || true
  _NB_LOCK_PATH=""
}

# @description Single bridge pass: publish new log lines for RUN_ID to JetStream.
#   Acquires a per-run lock (.nats-bridge.lock) via lib/lock.sh. On timeout or
#   other refusal returns 5 (lock not held; never enters the critical section).
#   Reads via el_read into a temp file first so torn/malformed (rc=2) is observed.
#   Cursor advances only after nats pub ... -J exits 0 (PubAck granted).
# @arg $1 run id
# @exitcode 0 clean pass, or publish failed (cursor held for retry next tick)
# @exitcode 1 invalid seq/type, corrupt on-disk cursor, cursor commit failure
# @exitcode 2 invalid run id (usage error), or el_read reported torn/malformed
#   (valid prefix was published) — disambiguated on stderr
# @exitcode 5 lock acquisition refused (timeout / untrusted / unavailable)
nb_bridge_once() {
  local run="$1"
  local rd lock from tmp errf n line seq type
  local read_rc=0 pub_rc=0 nats_url subject_prefix
  # Resolved through the shared config loader: dedicated env var (as before)
  # > [nats] TOML value > the same built-in defaults this always had. With
  # neither NATS_URL/NATS_SUBJECT_PREFIX nor a .foreman/config.toml [nats]
  # block present, cfg_get returns these literal defaults -- byte-identical
  # to the prior "${NATS_URL:-...}" form and the previously-hardcoded
  # "foreman" subject prefix.
  cfg_load
  nats_url="$(cfg_get nats url nats://127.0.0.1:4222)"
  subject_prefix="$(cfg_get nats subject_prefix foreman)"

  # Validate before it touches any path/subject/header interpolation.
  if [[ ! "$run" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "nb_bridge_once: invalid run id '$run' (expected ^[A-Za-z0-9._-]+\$)" >&2
    return 2
  fi

  rd="$(run_dir "$run")"
  lock="$rd/.nats-bridge.lock"
  mkdir -p "$rd" || return 1

  # Owner-aware reclaim of this lock only (never a sweep). Mechanism
  # conditionality lives inside fm_lock_reclaim (no-op on flock). Never
  # reclaim silently: surface the record (success or refusal) on stderr.
  local _nb_reclaim_rc=0 _nb_reclaim_errf _nb_reclaim_msg
  _nb_reclaim_errf="$(mktemp "${TMPDIR:-/tmp}/nb-reclaim.XXXXXX")" || _nb_reclaim_errf=""
  if [[ -n "$_nb_reclaim_errf" ]]; then
    fm_lock_reclaim "$lock" 2>"$_nb_reclaim_errf" || _nb_reclaim_rc=$?
    _nb_reclaim_msg="$(tr -d '\r' <"$_nb_reclaim_errf" 2>/dev/null)"
    rm -f -- "$_nb_reclaim_errf"
  else
    fm_lock_reclaim "$lock" || _nb_reclaim_rc=$?
    _nb_reclaim_msg=""
  fi
  if [[ -n "$_nb_reclaim_msg" ]]; then
    printf '%s\n' "$_nb_reclaim_msg" >&2
  fi
  if (( _nb_reclaim_rc != 0 )); then
    echo "nb_bridge_once: fm_lock_reclaim refused for $lock (rc=$_nb_reclaim_rc); lock left in place" >&2
  fi

  # Bounded acquire via shared helper. Refusal (timeout / untrusted / etc.)
  # leaves the critical section unentered — never fail-open.
  local _nb_lock_timeout="${NB_LOCK_TIMEOUT_SEC:-${FM_LOCK_TIMEOUT_SEC:-30}}"
  if ! fm_lock_acquire "$lock" "$_nb_lock_timeout" >/dev/null; then
    echo "nb_bridge_once: lock acquire refused for run $run (FM_LOCK_*)" >&2
    return 5
  fi
  _NB_LOCK_PATH="$lock"

  from="$(el_cursor_get "$run" nats-bridge)"
  from="${from%$'\r'}"
  # Fail closed on a corrupted cursor: do not guess/replay from 0 silently.
  # A bad on-disk cursor is a human decision, not something to paper over.
  if [[ ! "$from" =~ ^[0-9]+$ ]]; then
    echo "nb_bridge_once: corrupt nats-bridge cursor for run $run (value='${from}'); refusing to guess a starting point, human review required" >&2
    _nb_lock_release "$lock"
    return 1
  fi
  # Temp capture: $(el_read) would lose the function's exit status under pipes.
  tmp="$(mktemp)" || { _nb_lock_release "$lock"; return 1; }
  errf="${tmp}.err"
  read_rc=0
  el_read "$run" "$from" >"$tmp" 2>"$errf" || read_rc=$?
  if [[ -s "$errf" ]]; then
    cat "$errf" >&2
  fi
  # Unexpected el_read failure: release and propagate (not 0/2).
  if (( read_rc != 0 && read_rc != 2 )); then
    rm -f "$tmp" "$errf"
    _nb_lock_release "$lock"
    return "$read_rc"
  fi

  n="$from"
  while IFS= read -r line || [[ -n "${line:-}" ]]; do
    line=${line%$'\r'}
    if [[ -z "$line" ]]; then
      continue
    fi
    n=$((n + 1))
    seq="$(jq -r '.seq' <<<"$line" 2>/dev/null)" || seq=""
    type="$(jq -r '.type' <<<"$line" 2>/dev/null)" || type=""
    seq=${seq%$'\r'}
    type=${type%$'\r'}
    # Validate before subject/header interpolation (injection + CRLF safety).
    if [[ ! "$seq" =~ ^[0-9]+$ ]] || [[ ! "$type" =~ ^[A-Za-z0-9_-]+$ ]]; then
      echo "nb_bridge_once: invalid seq/type at line $n for run $run (seq=${seq:-} type=${type:-}); stopping without advancing" >&2
      rm -f "$tmp" "$errf"
      _nb_lock_release "$lock"
      return 1
    fi
    # -J / --jetstream: require JetStream PubAck. A plain core nats pub exit 0
    # is NOT proof of stream persistence; no stream → nonzero exit.
    pub_rc=0
    if ! nats --server "$nats_url" --timeout=5s pub "$subject_prefix.$run.$type" "$line" \
      -H "Nats-Msg-Id:$run:$seq" -J >/dev/null 2>&1; then
      pub_rc=1
    fi
    if (( pub_rc != 0 )); then
      echo "nb_bridge_once: JetStream PubAck failed for run $run seq=$seq; cursor not advanced (will retry)" >&2
      rm -f "$tmp" "$errf"
      _nb_lock_release "$lock"
      return 0
    fi
    if ! el_cursor_commit "$run" nats-bridge "$n"; then
      echo "nb_bridge_once: cursor commit failed for run $run at line $n" >&2
      rm -f "$tmp" "$errf"
      _nb_lock_release "$lock"
      return 1
    fi
  done <"$tmp"

  rm -f "$tmp" "$errf"
  _nb_lock_release "$lock"

  if (( read_rc == 2 )); then
    echo "nb_bridge_once: el_read torn/malformed for run $run; published valid prefix only" >&2
    return 2
  fi
  return 0
}

# @description Loop wrapper around nb_bridge_once until stop sentinel or SIGTERM.
#   Sleeps NB_TICK (default 2s) between passes; backs off up to 10s on consecutive
#   no-op passes. Exit 0 on $(run_dir)/.nats-bridge.stop or SIGTERM. Both the
#   TERM trap and the stop-sentinel path release the lock via _nb_lock_release,
#   which is a no-op if this process is not the lock's current owner — a
#   bridge instance that never acquired the lock (e.g. rc=5 on its last tick)
#   must never strip another live instance's lock out from under it.
# @arg $1 run id
# @exitcode 0 stop sentinel or SIGTERM
# @exitcode 2 invalid run id (usage error), rejected before the loop starts
nb_bridge() {
  local run="$1"
  local rd stop_file sleep_s before after once_rc
  local tick="${NB_TICK:-2}"

  if [[ ! "$run" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "nb_bridge: invalid run id '$run' (expected ^[A-Za-z0-9._-]+\$)" >&2
    return 2
  fi

  rd="$(run_dir "$run")"
  stop_file="$rd/.nats-bridge.stop"
  sleep_s="$tick"

  # Release lock (only if owned by this process) then exit 0 on SIGTERM.
  # Expand $rd now into the trap string (SC2064 intentional).
  # shellcheck disable=SC2064
  trap '_nb_lock_release "'"$rd"'/.nats-bridge.lock"; exit 0' TERM

  while true; do
    if [[ -f "$stop_file" ]]; then
      _nb_lock_release "$rd/.nats-bridge.lock"
      return 0
    fi
    before="$(el_cursor_get "$run" nats-bridge)"
    before="${before%$'\r'}"
    once_rc=0
    nb_bridge_once "$run" || once_rc=$?
    # once_rc 0/2 are expected progress paths; 1/5 logged by once or ignored here.
    after="$(el_cursor_get "$run" nats-bridge)"
    after="${after%$'\r'}"
    if [[ "$before" == "$after" ]]; then
      # Backoff toward 10s on consecutive no-op passes.
      if (( sleep_s < 10 )); then
        sleep_s=$((sleep_s + 1))
      fi
    else
      sleep_s="$tick"
    fi
    # once_rc unused beyond cursor comparison; keep set -u happy if callers extend.
    : "${once_rc}"
    sleep "$sleep_s"
  done
}
