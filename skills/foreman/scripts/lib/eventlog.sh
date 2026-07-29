#!/usr/bin/env bash
# @description Append-only per-run event log: the source of truth for durable-lanes.
#   One JSON object per line; atomic O_APPEND; torn-tail-safe reads; per-consumer
#   line-number cursors committed after processing (at-least-once).
#
# Schema v2 (additive; 2026-07-18, v0.2.5 T3): v2 fields nest INSIDE payload
# only. el_emit's 5-positional signature and the top-level
# {seq,ts,type,lane,commit?,payload} shape are FROZEN -- top-level additions
# would be a signature migration, not additive, and are out of scope. The
# checkpoint SHA stays in the existing top-level `commit` field (resume.sh:74
# already reads `.commit // .payload.checkpoint // empty`, commit-first).
# Documented (not validated -- same as any other payload content) v2
# payload keys, populated by callers via the payload JSON they already pass:
#   attempt      - monotonic per-lane attempt id, see el_attempt_new
#   state        - a state-machine label for a state-transition event
#   pid          - CMD/root child pid (foreman-launch heartbeat/ownership)
#   launcher_pid - the launcher's own pid (job owner); distinct from pid
#   job_id       - Windows Job Object id / POSIX pgid
#   worktree     - lane worktree path (ownership event)
#   config_dir   - per-lane vendor config dir (GROK_HOME/CODEX_HOME etc.)
#   merge_base   - recorded merge-base sha (merge-freshness gate)
# The foreman-launch (T1) heartbeat schema is {ts, launcher_pid, pid, job_id,
# alive, stdout_bytes, stderr_bytes, elapsed_s}; when lane-run (T2) mirrors a
# launcher heartbeat into the event log, that whole object nests under
# payload too (event top-level ts/type/lane remain el_emit's own). `alert`
# joins the documented event-type vocabulary -- el_emit/el_read already
# treat every type opaquely, so no code change was needed for that part.
# `state` joins it too (v0.2.5 T4b): a dedicated event TYPE (distinct from
# the payload.state KEY documented above, which any event type may carry)
# whose payload always carries {state:<label>, attempt}. lane-run.sh's
# --round mode emits exactly one, `{state:"verifying"}`, right as the gate
# launcher spawns; watch.sh's v2 typed-state machine (skills/foreman/scripts/
# watch.sh) is its only consumer. Again opaque to el_emit/el_read/el_compact:
# is_collapsible only ever matches type=="heartbeat", so a `state` event is
# already structural/never-collapsed with no code change needed here either.
# Cursor semantics are UNCHANGED: the integer line-number cursor nats-bridge
# depends on (el_cursor_get/el_cursor_commit, line-count based) is untouched;
# el_read_after (attempt-filtered replay) is layered ON TOP of el_read, not a
# replacement for the cursor mechanism.
# PORTABILITY (deferred T3 audit nit): el_compact's cutoff computation needs
# GNU date's `-d "-N days"` relative-date parsing (Git Bash/WSL both ship
# it); a BSD/macOS date lacking `-d` fails SAFE -- rc 1, original
# events.jsonl completely untouched -- see el_compact for the full writeup.

# @description Initialize a run's event log. Single-threaded; call ONCE before
#   any concurrent emitters start. Clears a leftover .seq.lock from a previous
#   crashed run — safe here because there is no concurrency at init, which is
#   why el_emit does no racy in-band lock reclaim.
# @arg $1 run id
el_init() {
  local rd; rd="$(run_dir "$1")"; mkdir -p "$rd"
  rmdir "$rd/.seq.lock" 2>/dev/null || true
  # v0.2.5 T3 addition: el_attempt_new's sibling .attempt.lock is a separate
  # mkdir mutex on a separate on-disk file (attempts/$lane.attempt); the
  # exact same "no concurrency at init" crash-recovery argument that already
  # covers .seq.lock above applies unchanged, so it is reclaimed here too.
  rmdir "$rd/.attempt.lock" 2>/dev/null || true
}

# @description Emit one event; auto-increments seq for the run.
# @arg $1 run id  @arg $2 type  @arg $3 lane  @arg $4 payload JSON  @arg $5 commit sha (optional)
# @stdout the assigned seq number
el_emit() {
  local run="$1" type="$2" lane="$3" payload="$4" commit="${5:-}"
  local rd="$FOREMAN_HOME/runs/$run"
  [[ -d "$rd" ]] || mkdir -p "$rd"
  local log="$rd/events.jsonl" seqf="$rd/.seq" lock="$rd/.seq.lock"
  # Portable mutex: multiple lanes emit to one run's log concurrently, and the
  # seq read-modify-write must be atomic to avoid duplicate sequence numbers.
  # mkdir is atomic on Git Bash and WSL (no flock on MSYS2). This is a pure
  # mutex with NO in-band stale reclaim: any check-then-rmdir reclaim has an
  # unavoidable ABA race in bash (stat sees old lock; another process reclaims
  # + acquires; our rmdir then removes a live lock). Crash recovery is instead
  # single-threaded in el_init (run start) and the watchdog — see el_init.
  local tries=0
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.02; tries=$((tries+1))
    (( tries > 1500 )) && { echo "el_emit: lock timeout for $run (run el_init?)" >&2; return 1; }
  done
  # Critical section, single exit point, lock released unconditionally.
  # Ordering for uniqueness under failure: build line (jq) → reserve seq (write
  # .seq) → append. A duplicate seq is the only unacceptable outcome; a gap is
  # fine. jq failure: nothing written, seq not reserved (no gap). Append failure
  # after reserve: .seq is ahead → next emit skips (harmless gap), never a dup.
  local seq ts raw line rc=0 prev=0
  [[ -f "$seqf" ]] && prev="$(<"$seqf")"
  seq=$(( ${prev:-0} + 1 ))
  # F5 (v0.2.5 perf, spawn reduction): bash's own printf %()T strftime
  # builtin (bash >= 4.2) replaces the external `date -u +...` subprocess
  # spawn that used to run on every single emit. `-v ts` writes straight into
  # the shell variable (no command substitution, no fork at all -- not even
  # the cheaper bash-only fork $(...) would otherwise cost). `-1` means "now";
  # TZ=UTC on this one builtin invocation (restored after, no subshell
  # needed for a variable-assignment prefix on a builtin) forces UTC calendar
  # fields the same way `date -u` did. Verified byte-identical to
  # `date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ` across representative epochs
  # (epoch 0, leap day, DST-adjacent, Y2038-scale) -- see FOREMAN_REPORT.md.
  TZ=UTC printf -v ts '%(%Y-%m-%dT%H:%M:%SZ)T' -1
  # Plan used commit:($commit|select(.!="")) — under jq 1.8+ an empty select
  # empties the whole object; del keeps "omit empty commit". Capture jq's own
  # exit (not tr's). tr -d '\r': this host's Windows jq.exe emits CRLF.
  # F6 (v0.2.5 perf, spawn reduction): this was already the single combined
  # jq call for the whole object (seq/ts/type/lane/commit/payload assembly,
  # empty-commit omission, and payload validation all in one invocation) --
  # confirmed by re-reading this function end to end; there is no second/
  # redundant jq call in el_emit's hot path left to fold in. jq itself is
  # NOT a candidate for elimination here: it is what enforces the "invalid
  # payload -> el_emit fails, no blank line, seq not advanced" contract
  # (see the "jq failure emits no blank record" test) and what JSON-escapes
  # type/lane/commit/ts safely -- removing it would reshape audited behavior.
  raw=$(jq -cn --argjson seq "$seq" --arg ts "$ts" --arg type "$type" \
    --arg lane "$lane" --arg commit "$commit" --argjson payload "$payload" \
    '{seq:$seq,ts:$ts,type:$type,lane:$lane,commit:$commit,payload:$payload}
     | if .commit == "" then del(.commit) else . end') || rc=1
  line="${raw//$'\r'/}"
  if (( rc != 0 )) || [[ -z "$line" ]]; then
    rc=1; echo "el_emit: jq failed or empty line for $run" >&2
  elif ! { echo "$seq" > "$seqf.tmp" && mv "$seqf.tmp" "$seqf"; }; then
    # Reserve the seq ATOMICALLY (tmp + rename): a bare `> "$seqf"` truncates
    # first, so a failed write (e.g. ENOSPC) would leave .seq empty and the next
    # emit would restart at 1 → duplicate. tmp+rename preserves the old .seq on
    # any failure, so nothing is appended and the seq is safely retriable.
    rm -f "$seqf.tmp" 2>/dev/null
    rc=1; echo "el_emit: seq reserve failed for $run" >&2
  elif ! printf '%s\n' "$line" >> "$log"; then
    # seq already reserved → this leaves a harmless gap, never a duplicate
    rc=1; echo "el_emit: append failed for $run (seq $seq skipped)" >&2
  fi
  rmdir "$lock" 2>/dev/null   # single, unconditional release on every path
  (( rc == 0 )) && echo "$seq"
  return "$rc"
}

# @description Print well-formed JSON lines after FROM_LINE, stopping at the first
#   torn/invalid line. Every line is jq-validated before the from-cursor skip;
#   a poisoned line at or before the cursor also yields rc 2 (not silently skipped)
#   -- consumers must treat this as a signal to alert/investigate, not silently
#   continue past corruption. Trailing CR is stripped so CRLF writers emit LF-only
#   JSON. rc=2 may also be a benign in-progress torn tail (writer mid-append);
#   consumers should retry/alert, not treat it as a fatal crash or as clean EOF.
# @arg $1 run id  @arg $2 from-line (0-based count already consumed)
# @stdout newline-delimited JSON events (valid prefix only; never partial garbage; no CR)
# @exitcode 0 clean EOF (all lines valid, file ends with newline, or log missing);
#   2 stopped at a malformed line (any line number, including <= from) or a torn
#   tail (final line without trailing newline)
el_read() {
  local run="$1" from="$2" rd; rd="$(run_dir "$run")"
  local log="$rd/events.jsonl"; [[ -f "$log" ]] || return 0
  local n=0 line
  # Read line-by-line so a torn tail (EOF with non-empty buffer, no newline) and
  # a complete-but-malformed line are both distinguishable from clean EOF.
  while true; do
    if IFS= read -r line; then
      n=$((n + 1))
      # Single strip point: CRLF writers (e.g. Windows jq.exe) leave a trailing CR.
      # jq itself tolerates the CR (insignificant JSON whitespace); stripping it
      # here keeps \r out of stdout so consumers never see CRLF-tainted events.
      line=${line%$'\r'}
      if ! jq -e . >/dev/null 2>&1 <<<"$line"; then
        echo "el_read: malformed line $n for run $run" >&2
        return 2
      fi
      if (( n <= from )); then
        continue
      fi
      printf '%s\n' "$line"
    else
      # EOF: non-empty $line means the final line had no trailing newline (torn).
      if [[ -n "$line" ]]; then
        n=$((n + 1))
        echo "el_read: torn line $n for run $run" >&2
        return 2
      fi
      return 0
    fi
  done < "$log"
}

# @description Read a consumer's committed cursor (line number), 0 if none.
# @arg $1 run id  @arg $2 consumer name  @stdout line number
el_cursor_get() {
  local rd; rd="$(run_dir "$1")"
  cat "$rd/cursors/$2.cursor" 2>/dev/null || echo 0
}

# @description Commit a consumer cursor atomically (tmp + mv).
# @arg $1 run id  @arg $2 consumer  @arg $3 line number
el_cursor_commit() {
  local rd; rd="$(run_dir "$1")"; mkdir -p "$rd/cursors"
  printf '%s' "$3" > "$rd/cursors/$2.cursor.tmp" && mv "$rd/cursors/$2.cursor.tmp" "$rd/cursors/$2.cursor"
}

# @description Allocate the next monotonic attempt id for a run+lane (starts
#   at 1, one counter per lane per run). Serialized under a SIBLING
#   `.attempt.lock` mkdir mutex -- deliberately NOT el_emit's `.seq.lock`.
#   Rationale (see FOREMAN_REPORT.md for the full writeup): attempt
#   allocation touches a completely different on-disk file
#   (runs/$run/attempts/$lane.attempt) than events.jsonl/.seq, so sharing
#   el_emit's lock would only add contention to the hot per-emit path -- for
#   EVERY lane in the run, on EVERY emit -- to protect a file el_emit never
#   touches. A sibling lock scoped to attempt allocation keeps the two
#   concerns (and their locks) independent, same portable mkdir-mutex
#   pattern as el_emit's (mkdir is atomic on Git Bash and WSL; no flock on
#   MSYS2). This does NOT change el_emit's 5-positional signature: a caller
#   embeds the returned id as payload.attempt on whatever event(s) it emits
#   next -- attempt is plain payload content as far as el_emit is concerned.
# @arg $1 run id  @arg $2 lane
# @stdout the newly allocated attempt id (integer, starts at 1)
# @exitcode 0 success; 1 on lock timeout or a failed atomic persist (on
#   failure the on-disk counter is left exactly as it was before the call --
#   tmp+rename, same failure-preserves-prior-state discipline as .seq)
el_attempt_new() {
  local run="$1" lane="$2"
  [[ "$lane" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "el_attempt_new: invalid lane '${lane:-}'" >&2; return 1; }
  local rd="$FOREMAN_HOME/runs/$run"
  [[ -d "$rd" ]] || mkdir -p "$rd"
  local dir="$rd/attempts" lock="$rd/.attempt.lock"
  mkdir -p "$dir"
  local f="$dir/$lane.attempt"
  local tries=0
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.02; tries=$((tries+1))
    (( tries > 1500 )) && { echo "el_attempt_new: lock timeout for $run/$lane" >&2; return 1; }
  done
  # Critical section, single exit point, lock released unconditionally --
  # same discipline as el_emit's .seq.lock critical section.
  local prev=0 next rc=0
  if [[ -f "$f" ]]; then
    prev="$(<"$f")"
    prev="${prev%$'\r'}"
  fi
  [[ "$prev" =~ ^[0-9]+$ ]] || prev=0
  next=$(( prev + 1 ))
  if ! { printf '%s' "$next" > "$f.tmp" && mv "$f.tmp" "$f"; }; then
    rm -f "$f.tmp" 2>/dev/null
    rc=1
    echo "el_attempt_new: failed to persist attempt id for $run/$lane" >&2
  fi
  rmdir "$lock" 2>/dev/null   # single, unconditional release on every path
  (( rc == 0 )) && echo "$next"
  return "$rc"
}

# @description Print events whose payload.attempt is greater than ATTEMPT,
#   optionally further filtered by event TYPE (e.g. `el_read_after RUN X
#   checkpoint` for "checkpoint replay after attempt X"). Layered entirely on
#   top of el_read (read from line 0, no type filter) so it inherits el_read's
#   torn/malformed-line contract byte-for-byte: the WHOLE log is read via
#   el_read first and only THEN jq-filtered, so a torn/malformed line
#   anywhere still halts the valid prefix at exactly the point el_read itself
#   would stop at, and el_read's own rc (0 clean EOF, 2 stopped at a
#   malformed/torn line) is propagated unchanged. Pure read: never touches
#   any cursor file -- this is layered ON TOP of, not instead of, the
#   existing integer line-number cursor nats-bridge depends on.
# @arg $1 run id  @arg $2 attempt (integer; events with payload.attempt >
#   this value match)  @arg $3 optional event type filter
# @stdout newline-delimited compact JSON events matching the filter (may be
#   empty even on rc=0, if nothing matches)
# @exitcode 0 clean EOF; 1 bad ATTEMPT argument (usage error, checked before
#   any read); 2 el_read stopped at a malformed/torn line (see el_read); any
#   other non-0/2 el_read rc is propagated as-is
el_read_after() {
  local run="$1" attempt="$2" type_filter="${3:-}"
  attempt="${attempt%$'\r'}"
  type_filter="${type_filter%$'\r'}"
  if [[ ! "$attempt" =~ ^-?[0-9]+$ ]]; then
    echo "el_read_after: ATTEMPT must be an integer, got '${attempt:-}'" >&2
    return 1
  fi
  local raw rc=0
  raw="$(el_read "$run" 0)" || rc=$?
  if (( rc != 0 && rc != 2 )); then
    return "$rc"
  fi
  if [[ -n "$raw" ]]; then
    if [[ -n "$type_filter" ]]; then
      printf '%s\n' "$raw" | jq -c --arg attempt "$attempt" --arg type "$type_filter" \
        'select(.payload.attempt != null and (.payload.attempt > ($attempt|tonumber)) and .type == $type)'
    else
      printf '%s\n' "$raw" | jq -c --arg attempt "$attempt" \
        'select(.payload.attempt != null and (.payload.attempt > ($attempt|tonumber)))'
    fi
  fi
  return "$rc"
}

# @description Compact a run's event log: collapse contiguous runs of
#   heartbeat events older than N_DAYS into one heartbeat_rollup line each,
#   leaving every structural event (prompt, checkpoint, round_done, alert,
#   any event carrying payload.state, and any heartbeat NOT older than
#   N_DAYS) completely untouched, in place, at its original seq. Only
#   physically-contiguous same-lane heartbeat runs are merged into a single
#   rollup line -- an interleaved other-lane heartbeat (or any structural
#   event) between two otherwise-collapsible heartbeats starts a new rollup
#   rather than merging across it, so this never reorders or fabricates
#   adjacency that was not in the log.
#
#   Atomicity: builds events.jsonl.tmp, jq -e validates EVERY line of the
#   tmp file, then mv's it over the original. On ANY failure (bad N_DAYS,
#   missing log, el_read reports a malformed/torn EXISTING log -- refuses
#   to compact through corruption rather than risk losing data, jq
#   transform failure, tmp validation failure, or the mv itself failing)
#   the original events.jsonl is left completely untouched and this
#   returns 1.
#
#   Locking: acquires el_emit's OWN `.seq.lock` (not a separate lock) for
#   the full read+transform+validate+mv, because compaction rewrites
#   events.jsonl itself -- unlike el_attempt_new's sibling lock (a distinct
#   file el_emit never touches), a concurrent el_emit append between our
#   read and our mv would otherwise be silently discarded when the tmp file
#   replaces the original. PIPE_BUF/torn-append safety already depends on
#   this same mutex serializing all appends (see el_emit); compaction must
#   join that same serialization point to be safe, not invent a second one.
#
#   Seq gaps: retained lines keep their original seq (a rollup line carries
#   its collapsed range's LAST seq at the top level, plus the full
#   first_seq/last_seq/first_ts/last_ts range under payload) so the overall
#   seq sequence gets gaps where heartbeats were absorbed. Confirmed
#   tolerated by both consumers read here: el_read's from-cursor/torn-line
#   logic only ever counts physical LINES (`n`) and validates each line is
#   parseable JSON -- it never inspects or requires contiguity of the `seq`
#   field's VALUE. nats-bridge (nb_bridge_once) only requires each line's
#   `.seq` to match `^[0-9]+$` for the Nats-Msg-Id header; it never checks
#   that consecutive lines' seq values are contiguous either. (Compacting
#   while a consumer's line-count cursor already points past the collapsed
#   range does shift what physical line that cursor number resolves to
#   afterwards -- an operational caveat noted in FOREMAN_REPORT.md, not a
#   consumer-parsing bug; the line-cursor mechanism itself is unchanged.)
# @arg $1 run id  @arg $2 N_DAYS (non-negative integer)
# @exitcode 0 compacted, or nothing to do (empty log); 1 on any failure
#   (original untouched in every 1 case)
el_compact() {
  local run="$1" n_days="$2"
  if [[ ! "$n_days" =~ ^[0-9]+$ ]]; then
    echo "el_compact: N_DAYS must be a non-negative integer, got '${n_days:-}'" >&2
    return 1
  fi
  local rd; rd="$(run_dir "$run")"
  local log="$rd/events.jsonl" lock="$rd/.seq.lock"
  if [[ ! -f "$log" ]]; then
    echo "el_compact: no events.jsonl for run $run" >&2
    return 1
  fi

  # Cutoff computation below needs GNU date's `-d "-N days"` relative-date
  # parsing (Git Bash and WSL both ship it, same assumption el_emit/watch.sh
  # already make elsewhere in this codebase); a BSD/macOS date lacking `-d`
  # fails SAFE here -- the `cutoff=... || ...` guard below returns 1 with the
  # original events.jsonl completely untouched, never a silent misparse.
  local tries=0
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.02; tries=$((tries+1))
    (( tries > 1500 )) && { echo "el_compact: lock timeout for $run" >&2; return 1; }
  done

  local rc=0 raw read_rc=0
  raw="$(el_read "$run" 0)" || read_rc=$?
  if (( read_rc != 0 )); then
    echo "el_compact: refusing to compact — el_read reported rc=$read_rc (malformed/torn log); original untouched" >&2
    rc=1
  elif [[ -z "$raw" ]]; then
    : # empty log — nothing to compact, success no-op
  else
    local cutoff tmp="$log.tmp"
    if ! cutoff="$(TZ=UTC date -u -d "-${n_days} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"; then
      echo "el_compact: failed to compute cutoff for N_DAYS=$n_days" >&2
      rc=1
    else
      # One combined jq pass: group consecutive same-lane heartbeat-older-
      # than-cutoff runs into a single heartbeat_rollup line each; every
      # other line (structural, or a not-yet-old-enough heartbeat) passes
      # through byte-for-byte unchanged via $e.
      local jq_filter='
def is_collapsible: .type == "heartbeat" and (.payload.state // null) == null and .ts < $cutoff;
def flush(acc): if acc.pending == null then acc.out else (acc.out + [acc.pending]) end;
reduce .[] as $e (
  {out: [], pending: null};
  if ($e | is_collapsible) then
    if .pending != null and .pending.lane == $e.lane then
      .pending.payload.count += 1
      | .pending.payload.last_seq = $e.seq
      | .pending.payload.last_ts = $e.ts
      | .pending.seq = $e.seq
      | .pending.ts = $e.ts
    else
      { out: flush(.), pending: {
          seq: $e.seq, ts: $e.ts, type: "heartbeat_rollup", lane: $e.lane,
          payload: {count: 1, first_seq: $e.seq, last_seq: $e.seq, first_ts: $e.ts, last_ts: $e.ts}
      } }
    end
  else
    { out: (flush(.) + [$e]), pending: null }
  end
)
| flush(.)
| .[]
'
      if ! printf '%s\n' "$raw" | jq -cs --arg cutoff "$cutoff" "$jq_filter" > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        echo "el_compact: jq transform failed for run $run; original untouched" >&2
        rc=1
      else
        # Validate every output line before trusting it -- a corrupt
        # compaction result must never replace a good log (el_read halts on
        # the first malformed line, so a bad rewrite would poison every
        # future read at that point).
        local bad=0 vline
        while IFS= read -r vline || [[ -n "$vline" ]]; do
          [[ -z "$vline" ]] && continue
          jq -e . >/dev/null 2>&1 <<<"$vline" || { bad=1; break; }
        done < "$tmp"
        if (( bad != 0 )); then
          rm -f "$tmp"
          echo "el_compact: compacted output failed line validation for run $run; original untouched" >&2
          rc=1
        elif ! mv "$tmp" "$log"; then
          rm -f "$tmp"
          echo "el_compact: mv failed for run $run; original untouched" >&2
          rc=1
        fi
      fi
    fi
  fi

  rmdir "$lock" 2>/dev/null   # single, unconditional release on every path
  return "$rc"
}
