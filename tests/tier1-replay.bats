#!/usr/bin/env bats
# @description Tier 1 offline transcript replay and fail/pass demonstration.
bats_require_minimum_version 1.5.0

setup() {
  RUNNER="$BATS_TEST_DIRNAME/tier1-replay.sh"
  ROUND_ID="stall-no-output-undefined-predicate"
  ROUND_IDS=(
    audit-watchdog-orphaned-sleep
    crlf-worktree-shell-unrunnable
    formal-setsid-unavailable
    grok-single-turn-empty-burst
    launcher-pidns-capability-guard
    vendor-adapter-task-state
    lane-lint-worktree-artifact-leak
    reaudit-rework-no-convergence
    lane-report-objective-mismatch
  )
  NEW_ROUND_IDS=(
    lane-lint-worktree-artifact-leak
    reaudit-rework-no-convergence
    lane-report-objective-mismatch
  )
}

prepare_corpus() {
  CORPUS="$BATS_TEST_TMPDIR/golden-rounds"
  cp -R "$BATS_TEST_DIRNAME/golden-rounds" "$CORPUS"
}

@test "replays all ten demonstrated failure classes" {
  run bash "$RUNNER"

  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS round_id=$ROUND_ID"* ]]
  for round_id in "${ROUND_IDS[@]}"; do
    [[ "$output" == *"PASS round_id=$round_id"* ]]
  done
  [[ "$output" == *"COVERAGE: 10 of 10 failure classes demonstrated"* ]]
  [[ "$output" == *"Tier 1 replay: PASS (10 round(s))"* ]]
}

@test "a newly documented class with no round is visible before closure" {
  class_document="$BATS_TEST_TMPDIR/tier1-failure-classes.md"
  cp "$BATS_TEST_DIRNAME/../docs/design/tier1-failure-classes.md" "$class_document"
  printf '\nStable id: \x60FC-11-newly-recorded-unseeded\x60.\n' >> "$class_document"

  run env TIER1_CLASS_DOCUMENT="$class_document" bash "$RUNNER"

  [ "$status" -eq 0 ]
  [[ "$output" == *"10 of 11 failure classes demonstrated"* ]]
  [[ "$output" == *"FC-11-newly-recorded-unseeded"* ]]
  [[ "$output" == *"not closed until its golden round and demonstration record exist"* ]]
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

@test "every newly seeded round fails when its defective witness is absent" {
  for round_id in "${ROUND_IDS[@]}"; do
    corpus="$BATS_TEST_TMPDIR/golden-rounds-$round_id"
    cp -R "$BATS_TEST_DIRNAME/golden-rounds" "$corpus"
    trace="$corpus/$round_id/defective-trace.json"
    jq '.events = []' "$trace" > "$trace.tmp"
    mv "$trace.tmp" "$trace"

    run env TIER1_GOLDEN_ROOT="$corpus" bash "$RUNNER"

    [ "$status" -ne 0 ]
    [[ "$output" == *"FAIL round_id=$round_id"* ]]
    [[ "$output" == *"defective trace does not exhibit the seeded defect"* ]]
  done
}

@test "every new trace event decision is constrained by its round assertion" {
  for round_id in "${ROUND_IDS[@]}"; do
    for trace_name in defective-trace corrected-trace; do
      source_trace="$BATS_TEST_DIRNAME/golden-rounds/$round_id/$trace_name.json"
      event_count="$(jq '.events | length' "$source_trace")"
      for ((event_index = 0; event_index < event_count; event_index++)); do
        corpus="$BATS_TEST_TMPDIR/events-$round_id-$trace_name-$event_index"
        cp -R "$BATS_TEST_DIRNAME/golden-rounds" "$corpus"
        trace="$corpus/$round_id/$trace_name.json"
        jq --argjson event_index "$event_index" \
          '.events[$event_index].decision = "contradictory_event"' \
          "$trace" > "$trace.tmp"
        mv "$trace.tmp" "$trace"

        run env TIER1_GOLDEN_ROOT="$corpus" bash "$RUNNER"

        [ "$status" -ne 0 ]
        [[ "$output" == *"FAIL round_id=$round_id"* ]]
      done
    done
  done
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

@test "each missing-class assertion prints its corruption, fails, then passes" {
  corruption_filters=(
    '(.events[] | select(.decision == "enumerate_markdown_inputs") | .evidence.excluded_lane_artifacts) = 0'
    '(.events[] | select(.decision == "apply_rework_bound") | .evidence.decision_sequence) = ["rework", "rework"]'
    '(.events[] | select(.decision == "validate_worker_artifact") | .evidence.tbd_placeholders) = 1'
  )
  corruption_descriptions=(
    'excluded_lane_artifacts: 1 -> 0'
    'decision_sequence: [rework, escalate] -> [rework, rework]'
    'tbd_placeholders: 0 -> 1'
  )

  for ((round_index = 0; round_index < ${#NEW_ROUND_IDS[@]}; round_index++)); do
    round_id="${NEW_ROUND_IDS[$round_index]}"
    corpus="$BATS_TEST_TMPDIR/corruption-$round_id"
    cp -R "$BATS_TEST_DIRNAME/golden-rounds" "$corpus"
    trace="$corpus/$round_id/corrected-trace.json"

    printf '# CORRUPTION round_id=%s: %s\n' \
      "$round_id" "${corruption_descriptions[$round_index]}" >&3
    jq "${corruption_filters[$round_index]}" "$trace" > "$trace.tmp"
    mv "$trace.tmp" "$trace"

    run env TIER1_GOLDEN_ROOT="$corpus" bash "$RUNNER"

    [ "$status" -ne 0 ]
    [[ "$output" == *"FAIL round_id=$round_id"* ]]
    [[ "$output" == *"corrected decision trace does not satisfy the round assertion"* ]]

    cp "$BATS_TEST_DIRNAME/golden-rounds/$round_id/corrected-trace.json" "$trace"
    run env TIER1_GOLDEN_ROOT="$corpus" bash "$RUNNER"

    [ "$status" -eq 0 ]
    [[ "$output" == *"PASS round_id=$round_id"* ]]
  done
}
