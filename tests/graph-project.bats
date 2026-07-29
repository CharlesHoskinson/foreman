#!/usr/bin/env bats
# graph-project.sh — work-DAG projection (round 1)
bats_require_minimum_version 1.5.0
load helpers

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  mkdir -p "$FOREMAN_HOME"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  GP="$SCRIPTS/graph-project.sh"
  export LC_ALL=C
}

write_good() {
  local path="$1"
  cat > "$path" <<'EOF'
{"seq":1,"ts":"2026-01-01T00:00:00Z","type":"prompt","lane":"impl","payload":{"attempt":1,"cmd":"grok","vendor":"grok","model":"grok-4.5"}}
{"seq":2,"ts":"2026-01-01T00:00:01Z","type":"round_done","lane":"impl","payload":{"attempt":1,"exit_code":0}}
{"seq":3,"ts":"2026-01-01T00:00:02Z","type":"audit_verdict","lane":"impl","payload":{"attempt":1,"verdict":"APPROVED","vendor":"codex","model":"gpt-5.6"}}
{"seq":4,"ts":"2026-01-01T00:00:03Z","type":"gate_decision","lane":"impl","payload":{"attempt":1,"outcome":"pass","reasons":[]}}
EOF
}

@test "projects a clean log to attempt/verdict/gate nodes and edges" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  run "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl"
  [ "$status" -eq 0 ]
  # attempt node
  run jq -c 'select(.type=="attempt" and .attempt==1)' <<<"$output"
  [ -n "$output" ]
  [[ "$output" == *'foreman:run/r1/lane/impl/attempt/1'* ]]
  # evaluated_by edge
  run jq -c 'select(.relation=="evaluated_by")' <<<"$( "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" )"
  [ -n "$output" ]
}

@test "malformed line fails naming the line" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  printf '%s\n' 'not-json' >> "$BATS_TEST_TMPDIR/e.jsonl"
  run --separate-stderr "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"malformed line 5"* ]]
  [ -z "$output" ]
}

@test "truncated log fails naming the line" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  printf '%s' '{"partial":' >> "$BATS_TEST_TMPDIR/e.jsonl"
  run --separate-stderr "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"truncated log at line 5"* ]]
  [ -z "$output" ]
}

@test "unknown event type does not break projection" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  printf '%s\n' '{"seq":99,"ts":"2026-01-01T00:00:09Z","type":"future_widget","lane":"impl","payload":{"z":1}}' \
    >> "$BATS_TEST_TMPDIR/e.jsonl"
  run "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl"
  [ "$status" -eq 0 ]
  run jq -c 'select(.type=="attempt")' <<<"$output"
  [ -n "$output" ]
}

@test "two runs over the same log are byte-identical" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" > "$BATS_TEST_TMPDIR/a.jsonl"
  "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" > "$BATS_TEST_TMPDIR/b.jsonl"
  cmp -s "$BATS_TEST_TMPDIR/a.jsonl" "$BATS_TEST_TMPDIR/b.jsonl"
}

@test "reordered events yield the same projection (content identity)" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  tac "$BATS_TEST_TMPDIR/e.jsonl" > "$BATS_TEST_TMPDIR/rev.jsonl"
  "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" > "$BATS_TEST_TMPDIR/a.jsonl"
  "$GP" --run r1 --events "$BATS_TEST_TMPDIR/rev.jsonl" > "$BATS_TEST_TMPDIR/b.jsonl"
  cmp -s "$BATS_TEST_TMPDIR/a.jsonl" "$BATS_TEST_TMPDIR/b.jsonl"
}

@test "--check detects hand edit and accepts clean re-project" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" --out "$BATS_TEST_TMPDIR/w.jsonl"
  run "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" --out "$BATS_TEST_TMPDIR/w.jsonl" --check
  [ "$status" -eq 0 ]
  printf '%s\n' '{"kind":"node","id":"tamper"}' >> "$BATS_TEST_TMPDIR/w.jsonl"
  run "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" --out "$BATS_TEST_TMPDIR/w.jsonl" --check
  [ "$status" -eq 1 ]
}

@test "empty log reports uncovered coverage, not a clean success story" {
  : > "$BATS_TEST_TMPDIR/empty.jsonl"
  run "$GP" --run r1 --events "$BATS_TEST_TMPDIR/empty.jsonl"
  [ "$status" -eq 0 ]
  run jq -r 'select(.kind=="coverage") | "\(.attempts_projected):\(.durable_events):\(.reason)"' <<<"$output"
  [[ "$output" == 0:false:*empty* ]]
}

@test "finding id is content-stable across runs (JK-4)" {
  cat > "$BATS_TEST_TMPDIR/e.jsonl" <<'EOF'
{"seq":1,"ts":"2026-01-01T00:00:00Z","type":"finding","lane":"a","payload":{"attempt":1,"file":"f.sh","line":3,"summary":"x"}}
EOF
  id1="$("$GP" --run rA --events "$BATS_TEST_TMPDIR/e.jsonl" | jq -r 'select(.type=="finding")|.id')"
  id2="$("$GP" --run rB --events "$BATS_TEST_TMPDIR/e.jsonl" | jq -r 'select(.type=="finding")|.id')"
  [ -n "$id1" ]
  [ "$id1" = "$id2" ]
  [[ "$id1" == foreman:finding/* ]]
}

@test "projector does not modify the event log" {
  write_good "$BATS_TEST_TMPDIR/e.jsonl"
  cp "$BATS_TEST_TMPDIR/e.jsonl" "$BATS_TEST_TMPDIR/e.before"
  "$GP" --run r1 --events "$BATS_TEST_TMPDIR/e.jsonl" >/dev/null
  cmp -s "$BATS_TEST_TMPDIR/e.jsonl" "$BATS_TEST_TMPDIR/e.before"
}
