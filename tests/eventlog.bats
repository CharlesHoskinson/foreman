#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
}

@test "el_emit appends a line and returns incrementing seq" {
  run el_emit run1 prompt lane-a '{"k":1}'
  [ "$status" -eq 0 ]; [ "$output" = "1" ]
  run el_emit run1 tool_call lane-a '{"k":2}'
  [ "$output" = "2" ]
  [ "$(wc -l < "$(run_dir run1)/events.jsonl")" -eq 2 ]
  run jq -r '.type' "$(run_dir run1)/events.jsonl"
  [ "${lines[0]}" = "prompt" ]; [ "${lines[1]}" = "tool_call" ]
}

@test "el_emit records seq, type, lane, payload" {
  el_emit run1 checkpoint lane-b '{"x":true}' abc123
  run jq -rc '[.seq,.type,.lane,.commit,(.payload.x)]|@csv' "$(run_dir run1)/events.jsonl"
  [ "$output" = '1,"checkpoint","lane-b","abc123",true' ]
}

@test "el_read returns lines after cursor, skips torn tail" {
  el_emit run1 a lane '{}'; el_emit run1 b lane '{}'
  printf '{"partial":' >> "$(run_dir run1)/events.jsonl"   # torn line, no newline
  # --separate-stderr: diagnostic on torn/malformed must not pollute $output line count
  run --separate-stderr el_read run1 0
  [ "$(wc -l <<<"$output")" -eq 2 ]           # only the 2 complete lines
  run --separate-stderr el_read run1 1
  [ "$(jq -r .type <<<"$output")" = "b" ]      # from line 2 only
}

@test "el_read returns 2 and diagnostic on malformed mid-file line" {
  el_emit run1 a lane '{}'
  el_emit run1 b lane '{}'
  # Append garbage directly (not via el_emit) so it lands as line 3.
  printf 'not-json-garbage\n' >> "$(run_dir run1)/events.jsonl"
  run --separate-stderr el_read run1 0
  [ "$status" -eq 2 ]
  [ "$(wc -l <<<"$output")" -eq 2 ]
  [[ "$output" != *"not-json"* ]]
  [[ "$stderr" == *"line 3"* ]]
}

@test "el_read returns 2 on torn tail (no trailing newline)" {
  el_emit run1 a lane '{}'
  printf '{"partial":' >> "$(run_dir run1)/events.jsonl"
  run --separate-stderr el_read run1 0
  [ "$status" -eq 2 ]
  [ "$(wc -l <<<"$output")" -eq 1 ]
  [[ "$stderr" == *"line 2"* ]] || [[ "$stderr" == *"torn"* ]]
}

@test "el_read clean EOF returns 0" {
  el_emit run1 a lane '{}'
  el_emit run1 b lane '{}'
  run --separate-stderr el_read run1 0
  [ "$status" -eq 0 ]
  [ "$(wc -l <<<"$output")" -eq 2 ]
  # Missing log file → status 0, no output
  run --separate-stderr el_read missingrun 0
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "cursor round-trips and defaults to 0" {
  run el_cursor_get run1 watcher; [ "$output" = "0" ]
  el_cursor_commit run1 watcher 5
  run el_cursor_get run1 watcher; [ "$output" = "5" ]
}

@test "concurrent emitters produce unique monotonic seqs (no duplicates)" {
  for i in $(seq 1 20); do el_emit run1 t lane "{\"i\":$i}" >/dev/null & done
  wait
  local total uniq
  total=$(wc -l < "$(run_dir run1)/events.jsonl")
  uniq=$(jq -r .seq "$(run_dir run1)/events.jsonl" | sort -n | uniq | wc -l)
  [ "$total" -eq 20 ]        # every emit landed
  [ "$uniq" -eq 20 ]         # every seq is unique
  # seqs are exactly 1..20
  [ "$(jq -r .seq "$(run_dir run1)/events.jsonl" | sort -n | tr '\n' ' ')" = "$(seq 1 20 | tr '\n' ' ')" ]
}

@test "jq failure emits no blank record and does not advance seq" {
  el_emit run1 ok lane '{"a":1}' >/dev/null                  # seq 1
  run el_emit run1 bad lane 'not-valid-json'                 # jq fails
  [ "$status" -ne 0 ]
  [ "$(wc -l < "$(run_dir run1)/events.jsonl")" -eq 1 ]      # no blank line appended
  run el_emit run1 ok2 lane '{"b":2}' >/dev/null             # seq resumes at 2, not 3
  run jq -r 'select(.type=="ok2")|.seq' "$(run_dir run1)/events.jsonl"
  [ "$output" = "2" ]
}

@test "stored lines contain no carriage returns" {
  el_emit run1 t lane '{"a":1}' >/dev/null
  # count CR (0x0d) bytes directly; the source-of-truth log must be clean LF
  [ "$(tr -cd '\r' < "$(run_dir run1)/events.jsonl" | wc -c)" -eq 0 ]
}

@test "el_read strips CR from CRLF-terminated lines" {
  el_init run1
  mkdir -p "$(run_dir run1)"
  printf '{"a":1}\r\n' >> "$(run_dir run1)/events.jsonl"
  run --separate-stderr el_read run1 0
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | tr -cd '\r' | wc -c)" -eq 0 ]
  [ "$(jq -r '.a' <<<"$output")" = "1" ]
}

@test "lock is released after a successful emit and after a failed emit" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  el_emit run1 ok lane '{"a":1}' >/dev/null
  [ ! -d "$rd/.seq.lock" ]                       # released on success
  run el_emit run1 bad lane 'not-json'           # jq fails
  [ "$status" -ne 0 ]
  [ ! -d "$rd/.seq.lock" ]                        # released on the error path too
}

@test "el_init clears a leftover lock so a new run does not wedge" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd/.seq.lock"   # crashed prior run
  el_init run1                                   # single-threaded crash recovery
  [ ! -d "$rd/.seq.lock" ]
  run el_emit run1 t lane '{"a":1}'              # emit now proceeds
  [ "$status" -eq 0 ]
}

@test "a failed seq reservation preserves .seq (no reset to empty, no duplicate)" {
  el_emit run1 a lane '{"n":1}' >/dev/null       # seq 1, .seq="1"
  local rd; rd="$(run_dir run1)"
  # Force the reserve write to fail portably: make .seq.tmp a directory so
  # `echo "$seq" > "$seqf.tmp"` cannot write it (works on Git Bash + WSL).
  mkdir "$rd/.seq.tmp"
  run el_emit run1 b lane '{"n":2}'
  rm -rf "$rd/.seq.tmp"
  [ "$status" -ne 0 ]                             # reserve failed
  [ "$(cat "$rd/.seq")" = "1" ]                   # .seq NOT truncated/reset (atomic tmp+rename)
  run el_emit run1 c lane '{"n":3}'               # resumes at 2, no duplicate of 1
  [ "$(jq -r .seq "$rd/events.jsonl" | tr '\n' ' ')" = "1 2 " ]
}

@test "append failure leaves a gap, never a duplicate seq" {
  el_emit run1 a lane '{"n":1}' >/dev/null       # seq 1
  local rd; rd="$(run_dir run1)"
  chmod 000 "$rd/events.jsonl" 2>/dev/null || skip "cannot make log unwritable on this fs"
  run el_emit run1 b lane '{"n":2}'              # append fails; seq 2 reserved
  chmod 644 "$rd/events.jsonl"
  [ "$status" -ne 0 ]
  run el_emit run1 c lane '{"n":3}'              # next emit gets 3 (gap at 2), not a dup of 1/2
  run jq -r .seq "$rd/events.jsonl"
  # stored seqs are 1 then 3 — unique, monotonic, gap at 2
  [ "$(jq -r .seq "$rd/events.jsonl" | tr '\n' ' ')" = "1 3 " ]
}

# --- v0.2.5 T3: schema v2 additions (el_attempt_new, el_read_after, el_compact) ---

@test "F5: el_emit's ts field is UTC ISO-8601 (bash printf builtin, no date spawn)" {
  el_emit run1 t lane '{"a":1}' >/dev/null
  run jq -r '.ts' "$(run_dir run1)/events.jsonl"
  [[ "$output" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

@test "el_attempt_new starts at 1 and increments monotonically per lane" {
  run el_attempt_new run1 lane-a
  [ "$status" -eq 0 ]; [ "$output" = "1" ]
  run el_attempt_new run1 lane-a
  [ "$output" = "2" ]
  run el_attempt_new run1 lane-a
  [ "$output" = "3" ]
}

@test "el_attempt_new counters are independent per lane" {
  el_attempt_new run1 lane-a >/dev/null
  el_attempt_new run1 lane-a >/dev/null
  run el_attempt_new run1 lane-b
  [ "$output" = "1" ]
  run el_attempt_new run1 lane-a
  [ "$output" = "3" ]
}

@test "el_attempt_new rejects an invalid lane charset" {
  run el_attempt_new run1 "bad lane!"
  [ "$status" -ne 0 ]
}

@test "el_init also clears a leftover .attempt.lock so el_attempt_new does not wedge" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd/.attempt.lock"
  el_init run1
  [ ! -d "$rd/.attempt.lock" ]
  run el_attempt_new run1 lane-a
  [ "$status" -eq 0 ]; [ "$output" = "1" ]
}

@test "el_read_after prints only events with payload.attempt greater than ATTEMPT" {
  el_emit run1 prompt lane-a '{"attempt":1}' >/dev/null
  el_emit run1 heartbeat lane-a '{"attempt":1}' >/dev/null
  el_emit run1 checkpoint lane-a '{"attempt":2}' abc123 >/dev/null
  el_emit run1 round_done lane-a '{"attempt":2}' >/dev/null
  run --separate-stderr el_read_after run1 1
  [ "$status" -eq 0 ]
  [ "$(wc -l <<<"$output")" -eq 2 ]
  [ "$(jq -r '.type' <<<"$output" | tr '\n' ',')" = "checkpoint,round_done," ]
}

@test "el_read_after further filters by an optional TYPE_FILTER" {
  el_emit run1 prompt lane-a '{"attempt":1}' >/dev/null
  el_emit run1 checkpoint lane-a '{"attempt":2}' abc >/dev/null
  el_emit run1 round_done lane-a '{"attempt":2}' >/dev/null
  el_emit run1 checkpoint lane-a '{"attempt":3}' def >/dev/null
  run --separate-stderr el_read_after run1 1 checkpoint
  [ "$status" -eq 0 ]
  [ "$(wc -l <<<"$output")" -eq 2 ]
  [ "$(jq -r '.type' <<<"$output" | sort -u)" = "checkpoint" ]
}

@test "el_read_after excludes events with no payload.attempt field" {
  el_emit run1 prompt lane-a '{"no_attempt":true}' >/dev/null
  el_emit run1 checkpoint lane-a '{"attempt":5}' abc >/dev/null
  run --separate-stderr el_read_after run1 0
  [ "$status" -eq 0 ]
  [ "$(wc -l <<<"$output")" -eq 1 ]
  [ "$(jq -r '.type' <<<"$output")" = "checkpoint" ]
}

@test "el_read_after propagates el_read's torn-line rc=2 contract" {
  el_emit run1 prompt lane-a '{"attempt":1}' >/dev/null
  printf '{"partial":' >> "$(run_dir run1)/events.jsonl"
  run --separate-stderr el_read_after run1 0
  [ "$status" -eq 2 ]
}

@test "el_read_after rejects a non-integer ATTEMPT argument" {
  run el_read_after run1 notanumber
  [ "$status" -eq 1 ]
}

@test "el_read_after never advances or touches any cursor" {
  el_emit run1 prompt lane-a '{"attempt":1}' >/dev/null
  run el_cursor_get run1 someconsumer
  [ "$output" = "0" ]
  el_read_after run1 0 >/dev/null
  run el_cursor_get run1 someconsumer
  [ "$output" = "0" ]
}

@test "el_compact collapses a contiguous old heartbeat run, keeps structural events and retained seq" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  {
    printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"prompt","lane":"a","payload":{}}'
    printf '%s\n' '{"seq":2,"ts":"2000-01-01T00:00:05Z","type":"heartbeat","lane":"a","payload":{"pid":1}}'
    printf '%s\n' '{"seq":3,"ts":"2000-01-01T00:00:10Z","type":"heartbeat","lane":"a","payload":{"pid":1}}'
    printf '%s\n' '{"seq":4,"ts":"2000-01-01T00:00:15Z","type":"checkpoint","lane":"a","commit":"abc","payload":{}}'
  } >> "$rd/events.jsonl"
  run el_compact run1 30
  [ "$status" -eq 0 ]
  run jq -r '.type' "$rd/events.jsonl"
  [ "${lines[0]}" = "prompt" ]; [ "${lines[1]}" = "heartbeat_rollup" ]; [ "${lines[2]}" = "checkpoint" ]
  run jq -c 'select(.type=="heartbeat_rollup")|[.seq,.payload.count,.payload.first_seq,.payload.last_seq]' "$rd/events.jsonl"
  [ "$output" = "[3,2,2,3]" ]
  [ "$(jq -r '.seq' "$rd/events.jsonl" | tr '\n' ' ')" = "1 3 4 " ]
}

@test "el_compact leaves heartbeats not older than N_DAYS untouched" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  local now; TZ=UTC printf -v now '%(%Y-%m-%dT%H:%M:%SZ)T' -1
  {
    printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"heartbeat","lane":"a","payload":{}}'
    printf '{"seq":2,"ts":"%s","type":"heartbeat","lane":"a","payload":{}}\n' "$now"
  } >> "$rd/events.jsonl"
  run el_compact run1 30
  [ "$status" -eq 0 ]
  run jq -r '.type' "$rd/events.jsonl"
  [ "${lines[0]}" = "heartbeat_rollup" ]; [ "${lines[1]}" = "heartbeat" ]
}

@test "el_compact never collapses a heartbeat carrying a payload.state transition" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"heartbeat","lane":"a","payload":{"state":"RUNNING_IMPL"}}' >> "$rd/events.jsonl"
  run el_compact run1 30
  [ "$status" -eq 0 ]
  run jq -r '.type' "$rd/events.jsonl"
  [ "$output" = "heartbeat" ]
}

@test "el_compact does not merge heartbeat runs across a different lane's interleaved heartbeat" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  {
    printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"heartbeat","lane":"a","payload":{}}'
    printf '%s\n' '{"seq":2,"ts":"2000-01-01T00:00:05Z","type":"heartbeat","lane":"b","payload":{}}'
    printf '%s\n' '{"seq":3,"ts":"2000-01-01T00:00:10Z","type":"heartbeat","lane":"a","payload":{}}'
  } >> "$rd/events.jsonl"
  run el_compact run1 30
  [ "$status" -eq 0 ]
  [ "$(jq -r '.lane' "$rd/events.jsonl" | tr '\n' ' ')" = "a b a " ]
  [ "$(jq -r '.type' "$rd/events.jsonl" | sort -u | tr '\n' ' ')" = "heartbeat_rollup " ]
}

@test "el_compact rejects a malformed N_DAYS and leaves the log untouched" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"heartbeat","lane":"a","payload":{}}' >> "$rd/events.jsonl"
  local before; before="$(cat "$rd/events.jsonl")"
  run el_compact run1 "-1"
  [ "$status" -eq 1 ]
  [ "$(cat "$rd/events.jsonl")" = "$before" ]
  [ ! -f "$rd/events.jsonl.tmp" ]
}

@test "el_compact refuses to compact a log with a malformed existing line, leaves it untouched" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"heartbeat","lane":"a","payload":{}}' >> "$rd/events.jsonl"
  printf 'not-json-garbage\n' >> "$rd/events.jsonl"
  local before; before="$(cat "$rd/events.jsonl")"
  run el_compact run1 30
  [ "$status" -eq 1 ]
  [ "$(cat "$rd/events.jsonl")" = "$before" ]
  [ ! -f "$rd/events.jsonl.tmp" ]
}

@test "el_compact on a missing log returns 1" {
  run el_compact nonexistentrun 30
  [ "$status" -eq 1 ]
}

@test "el_compact output stays readable by el_read afterward" {
  local rd; rd="$(run_dir run1)"; mkdir -p "$rd"
  {
    printf '%s\n' '{"seq":1,"ts":"2000-01-01T00:00:00Z","type":"prompt","lane":"a","payload":{}}'
    printf '%s\n' '{"seq":2,"ts":"2000-01-01T00:00:05Z","type":"heartbeat","lane":"a","payload":{}}'
    printf '%s\n' '{"seq":3,"ts":"2000-01-01T00:00:10Z","type":"heartbeat","lane":"a","payload":{}}'
  } >> "$rd/events.jsonl"
  run el_compact run1 30
  [ "$status" -eq 0 ]
  run --separate-stderr el_read run1 0
  [ "$status" -eq 0 ]
  [ "$(wc -l <<<"$output")" -eq 2 ]
}
