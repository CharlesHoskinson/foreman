#!/usr/bin/env bats
# @description Tier 1 offline transcript replay and fail/pass demonstration.
bats_require_minimum_version 1.5.0

setup() {
  RUNNER="$BATS_TEST_DIRNAME/tier1-replay.sh"
  ROUND_ID="stall-no-output-undefined-predicate"
}

prepare_corpus() {
  CORPUS="$BATS_TEST_TMPDIR/golden-rounds"
  cp -R "$BATS_TEST_DIRNAME/golden-rounds" "$CORPUS"
}

@test "replays the demonstrated round and reports the nine coverage gaps" {
  run bash "$RUNNER"

  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS round_id=$ROUND_ID"* ]]
  [[ "$output" == *"1 of 10 failure classes demonstrated"* ]]
  for missing in \
    FC-02-checker-verdict-unestablished \
    FC-03-lane-terminal-without-deliverable \
    FC-04-process-ownership-leak \
    FC-05-environment-capability-gap \
    FC-06-cross-boundary-representation \
    FC-07-isolation-artifact-safety \
    FC-08-record-state-disagreement \
    FC-09-decision-policy-nonconvergent \
    FC-10-orchestration-task-mismatch; do
    [[ "$output" == *"$missing"* ]]
  done
}

@test "cosmetic vendor prose changes do not affect decision-trace assertions" {
  prepare_corpus
  transcript="$CORPUS/$ROUND_ID/transcript.json"
  jq '.response_text = "The same decision-relevant response, reworded completely."' \
    "$transcript" > "$transcript.tmp"
  mv "$transcript.tmp" "$transcript"

  run env TIER1_GOLDEN_ROOT="$CORPUS" bash "$RUNNER"

  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS round_id=$ROUND_ID"* ]]
}

@test "a missing round artefact fails and names the round" {
  prepare_corpus
  rm "$CORPUS/$ROUND_ID/defective-trace.json"

  run env TIER1_GOLDEN_ROOT="$CORPUS" bash "$RUNNER"

  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL round_id=$ROUND_ID"* ]]
  [[ "$output" == *"missing artefact: defective-trace.json"* ]]
}

@test "mismatched defective-trace metadata fails and names the round" {
  prepare_corpus
  trace="$CORPUS/$ROUND_ID/defective-trace.json"
  jq '.round_id = "a-different-round"' "$trace" > "$trace.tmp"
  mv "$trace.tmp" "$trace"

  run env TIER1_GOLDEN_ROOT="$CORPUS" bash "$RUNNER"

  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL round_id=$ROUND_ID"* ]]
  [[ "$output" == *"defective-trace.json metadata does not match the round"* ]]
}

@test "meaningless emitted events fail and name the round" {
  prepare_corpus
  trace="$CORPUS/$ROUND_ID/corrected-trace.json"
  jq '(.events[] | select(has("emitted")) | .emitted) = "garbage"' \
    "$trace" > "$trace.tmp"
  mv "$trace.tmp" "$trace"

  run env TIER1_GOLDEN_ROOT="$CORPUS" bash "$RUNNER"

  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL round_id=$ROUND_ID"* ]]
  [[ "$output" == *"corrected decision trace does not satisfy the round assertion"* ]]
}

@test "a defective trace without the seeded defect witness fails" {
  prepare_corpus
  trace="$CORPUS/$ROUND_ID/defective-trace.json"
  jq '.events = []' "$trace" > "$trace.tmp"
  mv "$trace.tmp" "$trace"

  run env TIER1_GOLDEN_ROOT="$CORPUS" bash "$RUNNER"

  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL round_id=$ROUND_ID"* ]]
  [[ "$output" == *"defective trace does not exhibit the seeded defect"* ]]
}

@test "a corrupted demonstration fails and names the round" {
  prepare_corpus
  demonstration="$CORPUS/$ROUND_ID/demonstration.json"
  jq '.corrected_verdict = .defective_verdict' \
    "$demonstration" > "$demonstration.tmp"
  mv "$demonstration.tmp" "$demonstration"

  run env TIER1_GOLDEN_ROOT="$CORPUS" bash "$RUNNER"

  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL round_id=$ROUND_ID"* ]]
  [[ "$output" == *"demonstration record is not fail-then-pass"* ]]
}
