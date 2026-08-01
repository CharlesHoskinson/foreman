#!/usr/bin/env bats
# @description T1-T3 contract tests for the groundedness registry and canary.

load helpers

setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  LIB="$SCRIPTS/lib/gate-ground.sh"
  CHECKS="$SCRIPTS/lib/gate-ground-checks.sh"
  REGISTRY="$SCRIPTS/gate-ground-registry.tsv"
  CORPUS="$BATS_TEST_DIRNAME/fixtures/gate-ground"
  if [[ -f "$LIB" ]]; then
    # shellcheck source=/dev/null
    source "$LIB"
  fi
}

write_registry() {
  local path="$1" cap="$2" rows="$3"
  {
    printf '# blocking_cap=%s\n' "$cap"
    printf 'id\ttier\tworld\tblocking\tmode\trequired_inputs\tzero_fp_rationale\n'
    printf '%s\n' "$rows"
  } >"$path"
}

@test "libraries source without output or filesystem side effects" {
  [ -f "$LIB" ]
  [ -f "$CHECKS" ]
  before="$(find "$BATS_TEST_TMPDIR" -mindepth 1 -maxdepth 1 -print | sort)"
  for library in "$LIB" "$CHECKS"; do
    run bash -c 'source "$1"; declare -F gg_canary_evaluate_fixture >/dev/null' \
      _ "$library"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
  done
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
  jq_count="$BATS_TEST_TMPDIR/jq-count"
  jq() {
    printf '1\n' >>"$jq_count"
    command jq "$@"
  }
  run gg_canary_run "$CORPUS"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^CANARY_OK\ fixtures=10\ checks=9\ elapsed_ms=[0-9]+$ ]]
  [ "$(wc -l <"$jq_count" | tr -d '[:space:]')" -eq 10 ]
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

  mutated_checks="$BATS_TEST_TMPDIR/gate-ground-checks-mutated.sh"
  cp "$CHECKS" "$mutated_checks"
  sed '0,/| any(\$artifact\.findings\[\];/s//| false and any($artifact.findings[];/' \
    "$CHECKS" >"$mutated_checks"
  echo "mutation_applied=G1_predicate_prefixed_with_false_and"
  # shellcheck source=/dev/null
  source "$mutated_checks"
  run gg_canary_run "$CORPUS"
  echo "state=broken $output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"reason=canary_result_mismatch"* ]]
  [[ "$output" == *"check=G1"* ]]
  [[ "$output" == *"expected_count=1 actual_count=0"* ]]

  echo "restoration_applied=source_original_real_predicates"
  # shellcheck source=/dev/null
  source "$CHECKS"
  run gg_canary_run "$CORPUS"
  echo "state=green_after $output"
  [ "$status" -eq 0 ]
}

@test "G1 reads complete diff and repository path sets" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  old_side="$BATS_TEST_TMPDIR/G1-old-side.json"
  jq '.findings = [{"id":"F-R","severity":"low","file":"src/old-name.sh","line":0,"summary":"Rename","evidence":"Cites the old side."}]
      | .changed_paths += ["src/old-name.sh"]' \
    "$CORPUS/baseline.json" >"$old_side"
  run gg_canary_evaluate_fixture "$old_side"
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  run gg_canary_evaluate_fixture "$CORPUS/G1.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G1\tartifact:G1' ]
}

@test "G2 reads citation ranges and flags only an impossible line" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G2.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G2\tartifact:G2' ]
}

@test "G3 reads criterion identifiers and discharges" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G3.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G3\tartifact:G3' ]
}

@test "G4 reads recorded vendors and separation policy" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G4.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G4\tartifact:G4' ]
}

@test "G5 reads the base and rubric pin" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G5.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G5\tartifact:G5' ]
}

@test "G6 reads changed paths and scope globs" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G6.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G6\tartifact:G6' ]
}

@test "G9a reads APPROVED and high-severity findings" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G9a.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G9a\tartifact:G9a' ]
}

@test "G9b reads BLOCKED findings and criterion misses" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G9b.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G9b\tartifact:G9b' ]
}

@test "G9c reads WARNING and the complete findings set" {
  run gg_canary_evaluate_fixture "$CORPUS/baseline.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run gg_canary_evaluate_fixture "$CORPUS/G9c.json"
  [ "$status" -eq 0 ]
  [ "$output" = $'G9c\tartifact:G9c' ]
}

@test "G1 counts an existing path outside the complete diff path set" {
  advisory="$BATS_TEST_TMPDIR/G1-advisory.json"
  jq '.findings = [{"id":"F-A","severity":"low","file":"docs/example.md","line":0,"summary":"Outside diff","evidence":"Repository-only citation."}]
      | .repository_head.paths += ["docs/example.md"]' \
    "$CORPUS/baseline.json" >"$advisory"
  run gg_canary_evaluate_fixture "$advisory"
  [ "$status" -eq 0 ]
  [ "$output" = $'G1\tartifact:G1' ]
}

@test "G2 counts an out-of-hunk line but never treats line zero as a violation" {
  advisory="$BATS_TEST_TMPDIR/G2-advisory.json"
  jq '.findings = [{"id":"F-A","severity":"low","file":"src/example.sh","line":8,"summary":"Outside hunk","evidence":"The line exists outside the changed range."}]' \
    "$CORPUS/baseline.json" >"$advisory"
  run gg_canary_evaluate_fixture "$advisory"
  [ "$status" -eq 0 ]
  [ "$output" = $'G2\tartifact:G2' ]

  jq '.findings[0].line = 0' "$advisory" >"$advisory.line-zero"
  run gg_canary_evaluate_fixture "$advisory.line-zero"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a check with a missing declared input is unevaluated rather than passed" {
  incomplete="$BATS_TEST_TMPDIR/G1-missing-input.json"
  jq 'del(.repository_head)' "$CORPUS/G1.json" >"$incomplete"
  actual="$BATS_TEST_TMPDIR/G1-missing-input.actual"
  gg_canary_evaluate_fixture "$incomplete" >"$actual"
  [ ! -s "$actual" ]
  [ "${GG_CHECK_LAST_UNEVALUATED[G1]}" = "repository_head" ]
}

@test "renaming a fixture leaves its content-derived verdict unchanged" {
  renamed="$BATS_TEST_TMPDIR/not-the-check-id.json"
  cp "$CORPUS/G9a.json" "$renamed"
  run gg_canary_evaluate_fixture "$CORPUS/G9a.json"
  original="$output"
  [ "$status" -eq 0 ]
  run gg_canary_evaluate_fixture "$renamed"
  [ "$status" -eq 0 ]
  [ "$output" = "$original" ]
  [ "$output" = $'G9a\tartifact:G9a' ]
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
