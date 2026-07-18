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
