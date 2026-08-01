#!/usr/bin/env bats
# @description T1/T2 contract tests for the groundedness registry and canary.
# Groundedness predicates deliberately do not live here or in the T1/T2 library.
# The evaluator below is a test double for the callback T3 will implement.

load helpers

setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  LIB="$SCRIPTS/lib/gate-ground.sh"
  REGISTRY="$SCRIPTS/gate-ground-registry.tsv"
  CORPUS="$BATS_TEST_DIRNAME/fixtures/gate-ground"
  unset GG_TEST_NOOP_CHECK GG_TEST_WRONG_FOCUS_CHECK
  if [[ -f "$LIB" ]]; then
    # shellcheck source=/dev/null
    source "$LIB"
  fi
}

# T2 test double: it emits the result a future registered check would produce.
# It is intentionally content-agnostic so this lane does not implement T3 checks.
gg_canary_evaluate_fixture() {
  local fixture="$1" id focus
  id="$(basename "$fixture" .json)"
  [[ "$id" == "baseline" ]] && return 0
  [[ "$id" == "${GG_TEST_NOOP_CHECK:-}" ]] && return 0
  focus="artifact:$id"
  if [[ "$id" == "${GG_TEST_WRONG_FOCUS_CHECK:-}" ]]; then
    focus="artifact:wrong-focus"
  fi
  printf '%s\t%s\n' "$id" "$focus"
}

write_registry() {
  local path="$1" cap="$2" rows="$3"
  {
    printf '# blocking_cap=%s\n' "$cap"
    printf 'id\ttier\tworld\tblocking\tmode\trequired_inputs\tzero_fp_rationale\n'
    printf '%s\n' "$rows"
  } >"$path"
}

@test "library sources without output or filesystem side effects" {
  [ -f "$LIB" ]
  before="$(find "$BATS_TEST_TMPDIR" -mindepth 1 -maxdepth 1 -print | sort)"
  run bash -c 'source "$1"' _ "$LIB"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  after="$(find "$BATS_TEST_TMPDIR" -mindepth 1 -maxdepth 1 -print | sort)"
  [ "$after" = "$before" ]
}

@test "registry loads nine checks with the declared blocking cap" {
  gg_registry_load "$REGISTRY"
  [ "${#GG_REGISTRY_IDS[@]}" -eq 9 ]
  [ "$GG_BLOCKING_CAP" -eq 9 ]
  [ "${GG_REGISTRY_WORLD[G1]}" = "closed" ]
  [ "${GG_REGISTRY_MODE[G9c]}" = "shadow" ]
  [ -n "${GG_REGISTRY_RATIONALE[G5]}" ]
}

@test "registry rejects a malformed row and names its row number" {
  bad="$BATS_TEST_TMPDIR/malformed.tsv"
  write_registry "$bad" 1 $'BAD\t2\tclosed\t1\tshadow\tdiff\t'
  echo "mutated_value=row_3_empty_rationale"
  run gg_registry_load "$bad"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"GG_REGISTRY_MALFORMED row=3"* ]]
}

@test "registry enforces its declared blocking cap" {
  bad="$BATS_TEST_TMPDIR/cap.tsv"
  rows=$'A\t2\tclosed\t1\tshadow\tdiff\tA structural fact cannot be false.\nB\t2\tclosed\t1\tshadow\tdiff\tA structural fact cannot be false.'
  write_registry "$bad" 1 "$rows"
  echo "mutated_value=blocking_rows_2_cap_1"
  run gg_registry_load "$bad"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"GG_REGISTRY_BLOCKING_CAP_EXCEEDED cap=1 actual=2"* ]]
}

@test "registry rejects a leading-zero blocking cap as malformed" {
  bad="$BATS_TEST_TMPDIR/leading-zero-cap.tsv"
  write_registry "$bad" 08 $'A\t2\tclosed\t1\tshadow\tdiff\tA structural fact cannot be false.'
  echo "mutated_value=blocking_cap=08"
  run gg_registry_load "$bad"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"GG_REGISTRY_MALFORMED row=1 detail=invalid_blocking_cap"* ]]
}

@test "open-world enforcing configuration fires the named refusal" {
  custom="$BATS_TEST_TMPDIR/open.tsv"
  write_registry "$custom" 0 $'EVIDENCE\t3\topen\t0\tenforcing\tclaims,graph\tThis row is advisory because an open-world judgement cannot be structurally certain.'
  gg_registry_load "$custom"
  echo "mutated_value=EVIDENCE.mode=enforcing"
  run gg_refuse_open_enforcing EVIDENCE
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"GG_REFUSE_OPEN_ENFORCING check=EVIDENCE"* ]]
}

@test "enforcing without a promotion record runs shadow and says so" {
  custom="$BATS_TEST_TMPDIR/no-promotion.tsv"
  write_registry "$custom" 1 $'G1\t2\tclosed\t1\tenforcing\tdiff,findings\tA path absent from every complete path set cannot be a real citation.'
  gg_registry_load "$custom"
  echo "mutated_value=G1.mode=enforcing promotion_record=absent"
  run gg_check_mode G1
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"shadow"* ]]
  [[ "$output" == *"GG_REFUSE_NO_PROMOTION check=G1"* ]]
}

@test "a promotion-record callback permits a closed-world enforcing mode" {
  custom="$BATS_TEST_TMPDIR/promoted.tsv"
  write_registry "$custom" 1 $'G1\t2\tclosed\t1\tenforcing\tdiff,findings\tA path absent from every complete path set cannot be a real citation.'
  gg_registry_load "$custom"
  gg_promotion_record_exists() { [[ "$1" == "G1" ]]; }
  run gg_check_mode G1
  [ "$status" -eq 0 ]
  [ "$output" = "enforcing" ]
}

@test "both example configs default every registered check to shadow" {
  gg_registry_load "$REGISTRY"
  for config in "$BATS_TEST_DIRNAME/../config/foreman.toml.example" \
    "$BATS_TEST_DIRNAME/../.foreman/config.toml"; do
    for id in "${GG_REGISTRY_IDS[@]}"; do
      run awk -v id="${id,,}" '
        /^\[gate\.groundedness\]$/ { in_section=1; next }
        /^\[/ { in_section=0 }
        in_section && $0 ~ "^" id "[[:space:]]*=[[:space:]]*\\\"shadow\\\"" { found=1 }
        END { exit(found ? 0 : 1) }
      ' "$config"
      [ "$status" -eq 0 ]
    done
  done
}

@test "canary validates exact count and focus and reports millisecond cost" {
  gg_registry_load "$REGISTRY"
  run gg_canary_run "$CORPUS"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^CANARY_OK\ fixtures=10\ checks=9\ elapsed_ms=[0-9]+$ ]]
}

@test "canary evaluates the corpus on every invocation" {
  gg_registry_load "$REGISTRY"
  run gg_canary_run "$CORPUS"
  first="$output"
  [ "$status" -eq 0 ]
  run gg_canary_run "$CORPUS"
  second="$output"
  [ "$status" -eq 0 ]
  [[ "$first" == CANARY_OK* ]]
  [[ "$second" == CANARY_OK* ]]
}

@test "mutation proof: a no-op registered check is caught, then restoration is green" {
  gg_registry_load "$REGISTRY"

  run gg_canary_run "$CORPUS"
  echo "state=green_before $output"
  [ "$status" -eq 0 ]

  export GG_TEST_NOOP_CHECK=G1
  echo "mutated_value=GG_TEST_NOOP_CHECK=$GG_TEST_NOOP_CHECK"
  run gg_canary_run "$CORPUS"
  echo "state=broken $output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"reason=canary_result_mismatch"* ]]
  [[ "$output" == *"check=G1"* ]]
  [[ "$output" == *"expected_count=1 actual_count=0"* ]]

  unset GG_TEST_NOOP_CHECK
  echo "restored_value=GG_TEST_NOOP_CHECK=unset"
  run gg_canary_run "$CORPUS"
  echo "state=green_after $output"
  [ "$status" -eq 0 ]

  export GG_TEST_WRONG_FOCUS_CHECK=G2
  echo "mutated_value=GG_TEST_WRONG_FOCUS_CHECK=$GG_TEST_WRONG_FOCUS_CHECK"
  run gg_canary_run "$CORPUS"
  echo "state=wrong_focus $output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"reason=canary_result_mismatch"* ]]
  [[ "$output" == *"check=G2 expected_count=1 actual_count=1"* ]]
  [[ "$output" == *"expected_focus=artifact:G2 actual_focus=artifact:wrong-focus"* ]]

  unset GG_TEST_WRONG_FOCUS_CHECK
  echo "restored_value=GG_TEST_WRONG_FOCUS_CHECK=unset"
  run gg_canary_run "$CORPUS"
  echo "state=final_green $output"
  [ "$status" -eq 0 ]
}

@test "short corpus fails UNVERIFIED with its own reason" {
  gg_registry_load "$REGISTRY"
  short="$BATS_TEST_TMPDIR/short"
  cp -R "$CORPUS" "$short"
  rm "$short/G1.json"
  echo "mutated_value=removed_fixture=G1.json remaining_mutants=$(find "$short" -name 'G*.json' | wc -l)"
  run gg_canary_run "$short"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED reason=canary_short"* ]]
  [[ "$output" != *"reason=groundedness_violation"* ]]
}

@test "unreadable corpus fails UNVERIFIED with its own reason" {
  gg_registry_load "$REGISTRY"
  gg_canary_corpus_readable() { return 1; }
  echo "mutated_value=gg_canary_corpus_readable=return_1"
  run gg_canary_run "$CORPUS"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED reason=canary_unreadable"* ]]
  [[ "$output" != *"reason=groundedness_violation"* ]]
}

@test "shape-mismatched corpus fails UNVERIFIED with its own reason" {
  gg_registry_load "$REGISTRY"
  broken="$BATS_TEST_TMPDIR/shape"
  cp -R "$CORPUS" "$broken"
  jq '.findings = "not-an-array"' "$broken/G2.json" >"$broken/G2.json.tmp"
  mv "$broken/G2.json.tmp" "$broken/G2.json"
  echo "mutated_value=G2.findings=$(jq -c '.findings' "$broken/G2.json")"
  run gg_canary_run "$broken"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED reason=canary_shape_mismatch"* ]]
  [[ "$output" != *"reason=groundedness_violation"* ]]

  cp "$CORPUS/G2.json" "$broken/G2.json"
  jq '.findings[0].severity = "unknown"' "$broken/G2.json" >"$broken/G2.json.tmp"
  mv "$broken/G2.json.tmp" "$broken/G2.json"
  echo "mutated_value=G2.severity=$(jq -c '.findings[0].severity' "$broken/G2.json")"
  run gg_canary_run "$broken"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED reason=canary_shape_mismatch"* ]]

  cp "$CORPUS/G2.json" "$broken/G2.json"
  jq '.findings[0].line = 1.5' "$broken/G2.json" >"$broken/G2.json.tmp"
  mv "$broken/G2.json.tmp" "$broken/G2.json"
  echo "mutated_value=G2.line=$(jq -c '.findings[0].line' "$broken/G2.json")"
  run gg_canary_run "$broken"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED reason=canary_shape_mismatch"* ]]
}

@test "undeclared extra fixture cannot bypass canary evaluation" {
  gg_registry_load "$REGISTRY"
  extra="$BATS_TEST_TMPDIR/extra"
  cp -R "$CORPUS" "$extra"
  cp "$CORPUS/baseline.json" "$extra/extra.json"
  echo "mutated_value=fixture_count=$(find "$extra" -name '*.json' | wc -l) extra=extra.json"
  run gg_canary_run "$extra"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED reason=canary_undeclared_fixture"* ]]
}
