#!/usr/bin/env bash
# @description Replay Tier 1 golden rounds entirely from recorded JSON.
#   Offline execution is enforced structurally: this runner has no vendor-command
#   hook and only reads local artefacts with jq, awk, find, and shell builtins.
#   The recorded response is supplied to replay assertions as the vendor response,
#   but assertions inspect only decision-trace gates, verdicts, and emitted events.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GOLDEN_ROOT="${TIER1_GOLDEN_ROOT:-$ROOT/tests/golden-rounds}"
CLASS_DOCUMENT="${TIER1_CLASS_DOCUMENT:-$ROOT/docs/design/tier1-failure-classes.md}"
FAILURES=0
declare -A DEMONSTRATED_CLASSES=()

# @description Record a round-specific replay failure without stopping later rounds.
# @arg $1 round id
# @arg $2 discrepancy
round_fail() {
  local round_id="$1" discrepancy="$2"
  printf 'FAIL round_id=%s: %s\n' "$round_id" "$discrepancy" >&2
  FAILURES=$((FAILURES + 1))
}

# @description Assert the seeded FC-01 decision contract against one trace.
# @arg $1 decision-trace JSON path
# @return 0 when the expected gate/verdict/event structure is present
assert_stall_no_output_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-01-monitor-predicate-cannot-fire"
    and .demonstrated_case == "unchanged"
    and .final_verdict == "STALL NO_OUTPUT"
    and ([.events[] |
      select(
        .case == "unchanged"
        and .decision == "classify_no_output"
        and .outcome == "predicate_fired"
        and .verdict == "STALL NO_OUTPUT"
        and (.emitted | type == "string" and startswith("STALL NO_OUTPUT"))
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "changed"
        and .decision == "classify_no_output"
        and .outcome == "predicate_did_not_fire"
        and .verdict == "OK"
        and (.emitted | type == "string" and startswith("OK"))
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "uncomputable"
        and .decision == "classify_no_output"
        and .outcome == "refused_to_classify"
        and .verdict == "UNVERIFIED"
        and (.emitted | type == "string" and startswith("UNVERIFIED"))
      )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-01 trace contains its seeded predicate defect.
# @arg $1 defective decision-trace JSON path
# @return 0 when the unavailable predicate and fallthrough decisions are present
assert_stall_no_output_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-01-monitor-predicate-cannot-fire"
    and .demonstrated_case == "unchanged"
    and .final_verdict == "OK"
    and ([.events[] |
      select(
        .case == "unchanged"
        and .decision == "evaluate_content_digest"
        and .outcome == "predicate_unavailable"
        and (.evidence.undefined_functions |
          type == "array"
          and index("ev_content_hash") != null
          and index("ev_hash_unchanged") != null
          and index("ev_porcelain_digest") != null
          and index("ev_porcelain_uall_digest") != null)
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "unchanged"
        and .decision == "classify_no_output"
        and .outcome == "fallthrough"
        and .verdict == "OK"
        and (.emitted | type == "string" and startswith("OK"))
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "changed"
        and .decision == "evaluate_content_digest"
        and .outcome == "predicate_unavailable"
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "changed"
        and .decision == "classify_no_output"
        and .outcome == "fallthrough"
        and .verdict == "OK"
        and (.emitted | type == "string" and startswith("OK"))
      )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert that a defective trace contains its round-specific witness.
# @arg $1 round id
# @arg $2 defective decision-trace JSON path
# @return 0 when the trace exhibits the seeded defect
assert_seeded_defect() {
  local round_id="$1" trace_path="$2"

  case "$round_id" in
    stall-no-output-undefined-predicate)
      assert_stall_no_output_defect "$trace_path"
      ;;
    *)
      return 1
      ;;
  esac
}

# @description Replay a recorded response against a round's decision-trace assertion.
#   The response argument deliberately remains opaque; only the trace is asserted.
# @arg $1 round id
# @arg $2 decision-trace JSON path
# @arg $3 recorded vendor response
# @return 0 when the decision trace satisfies the round's corrected contract
assert_decision_trace() {
  local round_id="$1" trace_path="$2" recorded_response="$3"

  # Supplying this value models the recorded response replacing a live call. It is
  # never parsed or compared, so cosmetic vendor wording cannot affect a verdict.
  : "$recorded_response"

  case "$round_id" in
    stall-no-output-undefined-predicate)
      assert_stall_no_output_trace "$trace_path"
      ;;
    *)
      return 1
      ;;
  esac
}

# @description Validate and replay both traces for one golden-round directory.
# @arg $1 round directory
replay_round() {
  local round_dir="$1"
  local round_id transcript defective_trace corrected_trace demonstration
  local artefact failure_class recorded_response
  local transcript_defective transcript_corrected demo_defective demo_corrected
  local expected_defective expected_corrected observed_defective observed_corrected
  local defective_result corrected_result expected_path

  round_id="$(basename "$round_dir")"
  transcript="$round_dir/transcript.json"
  defective_trace="$round_dir/defective-trace.json"
  corrected_trace="$round_dir/corrected-trace.json"
  demonstration="$round_dir/demonstration.json"

  for artefact in transcript.json defective-trace.json corrected-trace.json demonstration.json; do
    if [[ ! -f "$round_dir/$artefact" ]]; then
      round_fail "$round_id" "missing artefact: $artefact"
      return
    fi
    if ! jq -e . "$round_dir/$artefact" >/dev/null 2>&1; then
      round_fail "$round_id" "invalid JSON artefact: $artefact"
      return
    fi
  done

  if ! jq -e --arg round_id "$round_id" '
    .round_id == $round_id
    and (.failure_class | type == "string" and length > 0)
    and (.vendor.name | type == "string" and length > 0)
    and (.vendor.model | type == "string" and length > 0)
    and (.vendor.interface | type == "string" and length > 0)
    and (.vendor.version | type == "string" and length > 0)
    and (.input_context.prompt | type == "string")
    and (.input_context.repository_state | type == "string" and length > 0)
    and .input_context.network_access == false
    and (.response_text | type == "string" and length > 0)
    and (.recorded_at | type == "string" and length > 0)
    and (.recorded_version | type == "string" and length > 0)
    and (.defective_trace | type == "string" and length > 0)
    and (.corrected_trace | type == "string" and length > 0)
  ' "$transcript" >/dev/null 2>&1; then
    round_fail "$round_id" "transcript metadata is incomplete or permits network access"
    return
  fi

  failure_class="$(jq -r '.failure_class' "$transcript")"
  recorded_response="$(jq -r '.response_text' "$transcript")"
  transcript_defective="$(jq -r '.defective_trace' "$transcript")"
  transcript_corrected="$(jq -r '.corrected_trace' "$transcript")"

  for artefact in defective-trace.json corrected-trace.json; do
    if ! jq -e --arg round_id "$round_id" --arg failure_class "$failure_class" '
      .round_id == $round_id
      and .failure_class == $failure_class
      and (.events | type == "array")
      and (.final_verdict | type == "string" and length > 0)
    ' "$round_dir/$artefact" >/dev/null 2>&1; then
      round_fail "$round_id" "$artefact metadata does not match the round"
      return
    fi
  done

  if ! jq -e --arg round_id "$round_id" --arg failure_class "$failure_class" '
    .round_id == $round_id
    and .failure_class == $failure_class
    and (.defective_trace | type == "string" and length > 0)
    and (.corrected_trace | type == "string" and length > 0)
    and (.defective_verdict | type == "string" and length > 0)
    and (.corrected_verdict | type == "string" and length > 0)
    and (.harness_version | type == "string" and length > 0)
    and (.demonstrated_at | type == "string" and length > 0)
    and (.demonstrated_by | type == "string" and length > 0)
  ' "$demonstration" >/dev/null 2>&1; then
    round_fail "$round_id" "demonstration metadata does not match the round"
    return
  fi

  demo_defective="$(jq -r '.defective_trace' "$demonstration")"
  demo_corrected="$(jq -r '.corrected_trace' "$demonstration")"
  expected_defective="$(jq -r '.defective_verdict' "$demonstration")"
  expected_corrected="$(jq -r '.corrected_verdict' "$demonstration")"

  expected_path="tests/golden-rounds/$round_id/defective-trace.json"
  if [[ "$transcript_defective" != "$expected_path" || "$demo_defective" != "$expected_path" ]]; then
    round_fail "$round_id" "defective trace path is not the round artefact"
    return
  fi
  expected_path="tests/golden-rounds/$round_id/corrected-trace.json"
  if [[ "$transcript_corrected" != "$expected_path" || "$demo_corrected" != "$expected_path" ]]; then
    round_fail "$round_id" "corrected trace path is not the round artefact"
    return
  fi

  if [[ "$expected_defective" == "$expected_corrected" ]]; then
    round_fail "$round_id" \
      "demonstration record is not fail-then-pass: recorded verdicts are both $expected_defective"
    return
  fi

  if ! assert_seeded_defect "$round_id" "$defective_trace"; then
    round_fail "$round_id" "defective trace does not exhibit the seeded defect"
    return
  fi

  if assert_decision_trace "$round_id" "$defective_trace" "$recorded_response"; then
    defective_result="pass"
  else
    defective_result="fail"
  fi
  if assert_decision_trace "$round_id" "$corrected_trace" "$recorded_response"; then
    corrected_result="pass"
  else
    corrected_result="fail"
  fi

  if [[ "$defective_result" != "fail" ]]; then
    round_fail "$round_id" \
      "replay is not fail-then-pass: defective decision trace unexpectedly satisfies the round assertion"
    return
  fi
  if [[ "$corrected_result" != "pass" ]]; then
    round_fail "$round_id" \
      "replay is not fail-then-pass: corrected decision trace does not satisfy the round assertion"
    return
  fi

  observed_defective="$(jq -r '.final_verdict' "$defective_trace")"
  observed_corrected="$(jq -r '.final_verdict' "$corrected_trace")"
  if [[ "$observed_defective" != "$expected_defective" \
    || "$observed_corrected" != "$expected_corrected" ]]; then
    round_fail "$round_id" \
      "replay verdict pair $observed_defective -> $observed_corrected does not match record $expected_defective -> $expected_corrected"
    return
  fi

  DEMONSTRATED_CLASSES["$failure_class"]=1
  printf 'PASS round_id=%s: replayed fail-then-pass; decision verdicts=%s -> %s\n' \
    "$round_id" "$observed_defective" "$observed_corrected"
}

# @description Compare documented failure classes with successfully demonstrated rounds.
# @return 0 when the class document can be read, including for incomplete coverage
report_coverage() {
  local -a all_classes=() missing_classes=()
  local failure_class demonstrated_count=0

  if [[ ! -f "$CLASS_DOCUMENT" ]]; then
    printf 'FAIL coverage: missing class document: %s\n' "$CLASS_DOCUMENT" >&2
    FAILURES=$((FAILURES + 1))
    return 1
  fi
  mapfile -t all_classes < <(
    awk -F '`' '/^Stable id: `/ { print $2 }' "$CLASS_DOCUMENT"
  )
  if (( ${#all_classes[@]} == 0 )); then
    printf 'FAIL coverage: no failure classes found in %s\n' "$CLASS_DOCUMENT" >&2
    FAILURES=$((FAILURES + 1))
    return 1
  fi

  for failure_class in "${all_classes[@]}"; do
    if [[ -n "${DEMONSTRATED_CLASSES[$failure_class]+present}" ]]; then
      demonstrated_count=$((demonstrated_count + 1))
    else
      missing_classes+=("$failure_class")
    fi
  done

  printf 'COVERAGE: %d of %d failure classes demonstrated' \
    "$demonstrated_count" "${#all_classes[@]}"
  if (( ${#missing_classes[@]} > 0 )); then
    printf '; missing:'
    printf ' %s' "${missing_classes[@]}"
  fi
  printf '\n'
  if (( demonstrated_count < ${#all_classes[@]} )); then
    printf 'COVERAGE NOTE: incomplete corpus is loud but non-blocking until task 2.3 seeds the remaining rounds.\n'
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  printf 'FAIL Tier 1 replay requires local jq\n' >&2
  exit 2
fi
if [[ ! -d "$GOLDEN_ROOT" ]]; then
  printf 'FAIL Tier 1 golden-round root missing: %s\n' "$GOLDEN_ROOT" >&2
  exit 1
fi

declare -a round_dirs=()
mapfile -d '' -t round_dirs < <(
  find "$GOLDEN_ROOT" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z
)
if (( ${#round_dirs[@]} == 0 )); then
  printf 'FAIL Tier 1 replay found no golden rounds in %s\n' "$GOLDEN_ROOT" >&2
  exit 1
fi

for round_dir in "${round_dirs[@]}"; do
  replay_round "$round_dir"
done
report_coverage || true

if (( FAILURES > 0 )); then
  printf 'Tier 1 replay: FAIL (%d round or coverage error(s))\n' "$FAILURES" >&2
  exit 1
fi
printf 'Tier 1 replay: PASS (%d round(s))\n' "${#round_dirs[@]}"
