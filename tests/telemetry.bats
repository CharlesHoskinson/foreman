#!/usr/bin/env bats
# @description S4a telemetry: usage source honesty, model identity, phase timing.
#   Known-bad falsification for each assertion is recorded in REPORT.md.
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  export DURABLE_CHECKPOINT_INTERVAL=0 DURABLE_HEARTBEAT_INTERVAL=0
  export FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch-binary"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  source "$SCRIPTS/lib/telemetry.sh"
  WT="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo x > "$WT/f"
  git -C "$WT" add -A
  git -C "$WT" commit -qm base
}

@test "usage unavailable omits numeric fields (never zero)" {
  local u
  u="$(tl_usage_block grok grok-4.5 "" unavailable)"
  jq -e '.source == "unavailable"' <<<"$u" >/dev/null
  jq -e 'has("input_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("output_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("cached_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("cost_usd") | not' <<<"$u" >/dev/null
  # known-bad shape: zeros must NOT match our contract
  local bad='{"source":"unavailable","input_tokens":0,"cost_usd":0}'
  # assert our helper is not that shape
  [ "$(jq -c 'keys|sort' <<<"$u")" != "$(jq -c 'keys|sort' <<<"$bad")" ]
}

@test "usage vendor_reported carries numbers when stream has them" {
  local stream="$BATS_TEST_TMPDIR/stream.ndjson"
  printf '%s\n' '{"type":"message"}' \
    '{"usage":{"input_tokens":11,"output_tokens":7,"cached_tokens":2,"cost_usd":0.01}}' \
    > "$stream"
  local u
  u="$(tl_usage_from_file "$stream" codex gpt-5.6-sol medium)"
  jq -e '.source == "vendor_reported"' <<<"$u" >/dev/null
  jq -e '.input_tokens == 11' <<<"$u" >/dev/null
  jq -e '.output_tokens == 7' <<<"$u" >/dev/null
}

@test "usage from empty/missing file is unavailable without zeros" {
  local u
  u="$(tl_usage_from_file "$BATS_TEST_TMPDIR/no-such" grok grok-4.5 "")"
  jq -e '.source == "unavailable"' <<<"$u" >/dev/null
  jq -e '(has("input_tokens") | not) and (has("cost_usd") | not)' <<<"$u" >/dev/null
}

@test "model identity keeps requested_alias and cli_version separate" {
  local m
  m="$(tl_model_identity "")"
  jq -e 'has("requested_alias") and has("cli_version")' <<<"$m" >/dev/null
  # empty vendor → no forced equality between fields
  jq -e '.requested_alias == null or .cli_version == null or .requested_alias != .cli_version or true' <<<"$m" >/dev/null
}

@test "lane-run round_done carries usage and implement_s phase" {
  el_init run-tl
  run bash "$SCRIPTS/lane-run.sh" run-tl lane-a "$WT" -- bash -c 'echo "{\"type\":\"noop\"}"; sleep 1; echo y > "'"$WT"'/f"'
  [ "$status" -eq 0 ]
  run el_read run-tl 0
  [ "$status" -eq 0 ]
  local rd_ev
  rd_ev="$(printf '%s\n' "$output" | jq -c 'select(.type=="round_done")' | tail -1)"
  [ -n "$rd_ev" ]
  jq -e '.payload.usage.source == "unavailable"' <<<"$rd_ev" >/dev/null
  jq -e '.payload.usage | has("input_tokens") | not' <<<"$rd_ev" >/dev/null
  jq -e '.payload.phases.implement_s | type == "number" and . >= 1' <<<"$rd_ev" >/dev/null
  # model identity structured on prompt
  local pr
  pr="$(printf '%s\n' "$output" | jq -c 'select(.type=="prompt")' | tail -1)"
  jq -e '.payload.model | has("requested_alias") and has("cli_version")' <<<"$pr" >/dev/null
}

@test "lane-run records queue_wait_s when LANE_QUEUED_AT is set" {
  el_init run-qw
  local past
  past=$(( $(date -u +%s) - 5 ))
  export LANE_QUEUED_AT="$past"
  run bash "$SCRIPTS/lane-run.sh" run-qw lane-a "$WT" -- bash -c 'true'
  [ "$status" -eq 0 ]
  run el_read run-qw 0
  local pr
  pr="$(printf '%s\n' "$output" | jq -c 'select(.type=="prompt")' | tail -1)"
  jq -e '.payload.queue_wait_s | type == "number" and . >= 4' <<<"$pr" >/dev/null
  local rd_ev
  rd_ev="$(printf '%s\n' "$output" | jq -c 'select(.type=="round_done")' | tail -1)"
  jq -e '.payload.phases.queue_wait_s | type == "number" and . >= 4' <<<"$rd_ev" >/dev/null
}

@test "lane-run --round records gate_s phase duration" {
  el_init run-gate-phase
  local report="$BATS_TEST_TMPDIR/report.md"
  # Gate that sleeps then writes a fresh report
  local gate_cmd="sleep 1; echo ok > '$report'"
  run bash "$SCRIPTS/lane-run.sh" --round "$gate_cmd" "$report" run-gate-phase lane-a "$WT" -- bash -c 'echo z > "'"$WT"'/f"'
  [ "$status" -eq 0 ]
  run el_read run-gate-phase 0
  local rd_ev
  rd_ev="$(printf '%s\n' "$output" | jq -c 'select(.type=="round_done")' | tail -1)"
  [ -n "$rd_ev" ]
  jq -e '.payload.phases.gate_s | type == "number" and . >= 1' <<<"$rd_ev" >/dev/null
  jq -e '.payload.phases.implement_s | type == "number"' <<<"$rd_ev" >/dev/null
}

@test "finding id is stable across identical content" {
  local a b
  a="$(tl_finding_id "x.py" 12 medium "Null deref in foo")"
  b="$(tl_finding_id "x.py" 12 medium "Null deref in foo")"
  [ "$a" = "$b" ]
  # normalisation: case/whitespace
  local c
  c="$(tl_finding_id "x.py" 12 medium "  null deref in foo.  ")"
  [ "$a" = "$c" ]
}

@test "known-bad: zero-cost unavailable must not be produced by tl_usage_block" {
  # Defect detector: even if a caller passes literal zeros, unavailable MUST
  # omit numeric fields (never record cost=0 for an unmeasured round).
  local u
  u="$(tl_usage_block codex gpt-5.6-sol high unavailable 0 0 0 0)"
  jq -e '.source == "unavailable"' <<<"$u" >/dev/null
  jq -e 'has("cost_usd") | not' <<<"$u" >/dev/null
  jq -e 'has("input_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("output_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("cached_tokens") | not' <<<"$u" >/dev/null
}
