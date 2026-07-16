#!/usr/bin/env bash
# @description Append-only per-run event log: the source of truth for durable-lanes.
#   One JSON object per line; atomic O_APPEND; torn-tail-safe reads; per-consumer
#   line-number cursors committed after processing (at-least-once).

# @description Initialize a run's event log. Single-threaded; call ONCE before
#   any concurrent emitters start. Clears a leftover .seq.lock from a previous
#   crashed run — safe here because there is no concurrency at init, which is
#   why el_emit does no racy in-band lock reclaim.
# @arg $1 run id
el_init() {
  local rd; rd="$(run_dir "$1")"; mkdir -p "$rd"
  rmdir "$rd/.seq.lock" 2>/dev/null || true
}

# @description Emit one event; auto-increments seq for the run.
# @arg $1 run id  @arg $2 type  @arg $3 lane  @arg $4 payload JSON  @arg $5 commit sha (optional)
# @stdout the assigned seq number
el_emit() {
  local run="$1" type="$2" lane="$3" payload="$4" commit="${5:-}"
  local rd; rd="$(run_dir "$run")"; mkdir -p "$rd"
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
  local seq ts raw line rc=0
  seq=$(( $(cat "$seqf" 2>/dev/null || echo 0) + 1 ))
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Plan used commit:($commit|select(.!="")) — under jq 1.8+ an empty select
  # empties the whole object; del keeps "omit empty commit". Capture jq's own
  # exit (not tr's). tr -d '\r': this host's Windows jq.exe emits CRLF.
  raw=$(jq -cn --argjson seq "$seq" --arg ts "$ts" --arg type "$type" \
    --arg lane "$lane" --arg commit "$commit" --argjson payload "$payload" \
    '{seq:$seq,ts:$ts,type:$type,lane:$lane,commit:$commit,payload:$payload}
     | if .commit == "" then del(.commit) else . end') || rc=1
  line="$(printf '%s' "$raw" | tr -d '\r')"
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
