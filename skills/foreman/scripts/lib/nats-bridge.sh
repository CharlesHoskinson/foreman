#!/usr/bin/env bash
# @description One-way event-log → JetStream bridge for durable-lanes.
#   Publishes new events.jsonl lines to <subject_prefix>.<run>.<type>
#   (subject_prefix from [nats] config, default "foreman") with Nats-Msg-Id
#   dedup; advances the per-consumer nats-bridge cursor ONLY after a validated
#   JetStream PubAck (nats pub -J). The event log remains the sole source of
#   truth; on any publish failure the cursor does not advance and events replay
#   on the next pass. Source this file; no side effects at source time.
#
#   Locking: a per-run mkdir mutex (.nats-bridge.lock) is owned by a random
#   per-acquisition token (not a bare PID — PIDs can be recycled after a
#   crash), recorded on disk AND kept in an in-memory shell variable; release
#   only ever acts when both match. Owner-file recording is part of
#   acquisition itself: a lock whose ownership cannot be durably recorded is
#   removed immediately rather than left held. Stale-lock recovery (owner
#   confirmed dead) is intentionally a separate, explicit MANUAL operation —
#   see the note on _nb_lock_release below — never automatic.

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

# In-memory record of the lock this process itself acquired (path + the
# random per-acquisition token it wrote to disk). A bare PID is not a durable
# ownership identity — after a crash the PID can be recycled by an unrelated
# process, which would then false-match a PID-only owner file and strip a
# lock it never acquired. A random token cannot be guessed/recycled, so
# ownership is proven only when the on-disk token matches the token this
# exact process instance remembers minting. A single path/token pair is
# sufficient: this library acquires at most one nats-bridge lock at a time
# per process (nb_bridge_once acquires-then-releases within one call).
_NB_LOCK_PATH="${_NB_LOCK_PATH:-}"
_NB_LOCK_TOKEN="${_NB_LOCK_TOKEN:-}"

# @description Generate an unguessable per-acquisition token. Falls back to a
#   PID+time+$RANDOM composite if /dev/urandom or od are unavailable (still
#   immune to PID-reuse false-matches since it is never reused verbatim).
# @stdout the token (single line, no whitespace)
_nb_gen_token() {
  local t
  t="$(od -An -N8 -tx8 /dev/urandom 2>/dev/null | tr -d ' \t\r\n')"
  if [[ -z "$t" ]]; then
    t="fallback-$$-$RANDOM$RANDOM-$(date +%s%N 2>/dev/null || date +%s)"
  fi
  printf '%s' "$t"
}

# @description Release the mkdir-mutex lock ONLY if the calling process is the
#   one that acquired it. Ownership is proven by an in-memory token recorded
#   at acquisition time matching the "$$:$token" content on disk (see
#   _nb_gen_token and the acquisition block in nb_bridge_once) — never by PID
#   alone, since a crashed owner's PID can be recycled by an unrelated later
#   process. This prevents a non-owning process — e.g. a second nb_bridge
#   instance whose own mkdir never succeeded (lock already held by another
#   live instance), or a process that merely shares a recycled PID with a
#   dead owner — from stripping a lock it does not own out from under the
#   process that does. A non-owning call is a silent no-op: the foreign lock
#   is left intact.
#
#   Stale-lock recovery (owner confirmed dead, lock left behind) is
#   deliberately NOT automated here: this function will never remove a lock
#   whose on-disk token does not match this process's own in-memory token,
#   by design. Recovering a genuinely stale lock is a separate, explicit
#   manual operation for a human/ops script: confirm the owning process is
#   actually gone, then `rm -f LOCK/owner && rmdir LOCK`.
# @arg $1 lock directory path (e.g. "$rd/.nats-bridge.lock")
_nb_lock_release() {
  local lock="$1" owner
  # Short-circuit: this process never recorded acquiring this exact lock
  # path, so it cannot possibly hold a matching token — avoid touching it.
  if [[ -z "$_NB_LOCK_TOKEN" || "$lock" != "$_NB_LOCK_PATH" ]]; then
    return 0
  fi
  owner="$(cat "$lock/owner" 2>/dev/null || true)"
  owner="${owner%$'\r'}"
  if [[ "$owner" == "$$:$_NB_LOCK_TOKEN" ]]; then
    rm -f "$lock/owner" 2>/dev/null || true
    rmdir "$lock" 2>/dev/null || true
    _NB_LOCK_PATH=""
    _NB_LOCK_TOKEN=""
  fi
}

# @description Single bridge pass: publish new log lines for RUN_ID to JetStream.
#   Acquires a per-run mkdir mutex (.nats-bridge.lock). Owner recording is
#   part of acquisition: a random per-acquisition token is written as
#   "$$:$token" and kept in memory, and if that write fails the just-created
#   lock is removed immediately and this returns 1 (never hold a lock we
#   cannot prove we own). The mkdir→owner-write interval is protected by a
#   non-exiting pending-signal TERM trap so a signal in that narrow window
#   cannot leave an unreleasable lock; any pending signal is honored right
#   after ownership is durably recorded. All release paths (via
#   _nb_lock_release) remove the lock only if this process's in-memory token
#   still matches the on-disk token.
#   Reads via el_read into a temp file first so torn/malformed (rc=2) is observed.
#   Cursor advances only after nats pub ... -J exits 0 (PubAck granted).
# @arg $1 run id
# @exitcode 0 clean pass, or publish failed (cursor held for retry next tick)
# @exitcode 1 invalid seq/type, corrupt on-disk cursor, cursor commit failure,
#   owner-file write failure, or a signal was honored during acquisition
# @exitcode 2 invalid run id (usage error), or el_read reported torn/malformed
#   (valid prefix was published) — disambiguated on stderr
# @exitcode 5 lock already held
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

  # --- Signal-safe acquisition window ---------------------------------
  # Between a successful mkdir and durably recording ownership, this
  # process holds a lock no one (including itself, after a crash) can ever
  # prove ownership of and therefore can never release. A signal delivered
  # in that narrow window must not be allowed to exit with the default
  # disposition. Install a non-exiting trap that only records that a
  # signal arrived; once ownership is recorded (or acquisition is
  # abandoned), restore whatever trap was previously active — the caller's
  # own TERM handler when called from nb_bridge's loop, or the default
  # disposition when called standalone — and, only then, honor a pending
  # signal by releasing (if owned) and re-delivering it to ourselves so the
  # restored handler (or default action) runs exactly as it would have.
  local _nb_prev_term_trap _nb_pending_term=""
  _nb_prev_term_trap="$(trap -p TERM)"
  trap '_nb_pending_term=1' TERM

  if ! mkdir "$lock" 2>/dev/null; then
    eval "${_nb_prev_term_trap:-trap - TERM}"
    if [[ -n "$_nb_pending_term" ]]; then
      kill -s TERM "$$"
    fi
    return 5
  fi

  local token
  token="$(_nb_gen_token)"
  # Owner recording IS acquisition: never hold a lock we cannot prove we
  # own. On write failure, remove the just-created lock immediately and
  # fail loud rather than leaving an orphaned, unreleasable lock dir.
  if ! printf '%s:%s' "$$" "$token" > "$lock/owner" 2>/dev/null; then
    echo "nb_bridge_once: failed to record lock ownership for run $run; removing the lock just created (never hold a lock we cannot prove we own)" >&2
    # rm -rf, not a bare rmdir: we just created $lock ourselves via a
    # successful mkdir moments ago, so we know it is ours to clear even if
    # something occupies the owner path and left it non-empty (e.g. the
    # owner path itself unexpectedly being a directory).
    rm -rf "$lock" 2>/dev/null || true
    eval "${_nb_prev_term_trap:-trap - TERM}"
    if [[ -n "$_nb_pending_term" ]]; then
      kill -s TERM "$$"
    fi
    return 1
  fi
  _NB_LOCK_PATH="$lock"
  _NB_LOCK_TOKEN="$token"
  eval "${_nb_prev_term_trap:-trap - TERM}"
  if [[ -n "$_nb_pending_term" ]]; then
    # Ownership is now durably recorded, so releasing it here is safe and
    # provable; re-deliver the deferred signal so any real handler (e.g.
    # nb_bridge's loop-level trap, now restored above) runs as normal.
    _nb_lock_release "$lock"
    kill -s TERM "$$"
    return 1
  fi
  # --- End signal-safe acquisition window ------------------------------

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
