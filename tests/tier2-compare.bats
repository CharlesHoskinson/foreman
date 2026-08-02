#!/usr/bin/env bats

setup() {
  RUNNER="$BATS_TEST_DIRNAME/tier2-compare.sh"
  FIXTURE_ROOT="$BATS_TEST_DIRNAME/fixtures/tier2"
  COMPARISON_FIXTURE="$FIXTURE_ROOT/comparison.json"
  BUDGETS="$BATS_TEST_DIRNAME/../skills/foreman/references/regression-tier-budgets.json"
  COLLECTOR="$BATS_TEST_DIRNAME/tier2-collect.sh"
  TRIGGER_SCANNER="$BATS_TEST_DIRNAME/tier2-trigger-scan.sh"
}

copy_comparison() {
  local destination="$BATS_TEST_TMPDIR/comparison.json"
  cp "$COMPARISON_FIXTURE" "$destination"
  printf '%s\n' "$destination"
}

@test "recorded N=3 runs produce point estimates, bootstrap CIs, and model pins" {
  result="$BATS_TEST_TMPDIR/result.json"

  run "$RUNNER" compare "$COMPARISON_FIXTURE" --output "$result"

  [ "$status" -eq 0 ]
  [ "$(jq '.expected_n' "$result")" -eq 3 ]
  [ "$(jq '.bootstrap.resamples' "$result")" -eq 1000 ]
  [ "$(jq '.results | length' "$result")" -eq 8 ]
  jq -e '
    .results[0].point_estimate_difference == 0.4
    and all(.results[];
      .baseline.n == 3
      and .candidate.n == 3
      and .baseline.confidence_interval.status == "computed"
      and .candidate.confidence_interval.status == "computed"
      and .baseline.model.identifier == "research-model"
      and .baseline.model.version == "2026-07-15"
      and .candidate.model.identifier == "research-model"
      and .candidate.model.version == "2026-07-15")
  ' "$result"
}

@test "Tier 2 input enforces the 8-to-12 spec machinery boundary" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '.locked_specs = .locked_specs[:7]' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"locked_specs must contain 8 to 12 unique spec identifiers"* ]]
}

@test "fewer than N scores makes the CI uncomputable and the decision not evaluated" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq 'del(.conditions.candidate.runs[0].scores["seeded-01"])' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .results[] | select(.spec_id == "seeded-01") |
    .candidate.confidence_interval.status == "uncomputable"
    and .candidate.confidence_interval.denominator == {"name":"observed runs","value":2}
    and .outcome == "INCONCLUSIVE"
    and .decision == "not_evaluated"
  ' "$result"
}

@test "a fourth run cannot hide a missing score and impersonate N=3" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '
    .conditions.candidate.runs += [(.conditions.candidate.runs[0] |
      .run_id = "candidate-4" | del(.scores["seeded-01"]))]
  ' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"candidate condition must contain exactly 3 run records"* ]]
}

@test "duplicate run identifiers are rejected before statistics" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '.conditions.candidate.runs[1].run_id = .conditions.candidate.runs[0].run_id' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"candidate run_id values must be unique"* ]]
}

@test "a difference within the wider CI half-width fires INCONCLUSIVE" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '
    .conditions.candidate.runs[0].scores["seeded-01"] = 0.44 |
    .conditions.candidate.runs[1].scores["seeded-01"] = 0.54 |
    .conditions.candidate.runs[2].scores["seeded-01"] = 0.64
  ' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"
  printf 'MUTATED INPUT inconclusive control:\n' >&3
  jq '{spec_id:"seeded-01", baseline:[.conditions.baseline.runs[].scores["seeded-01"]], candidate:[.conditions.candidate.runs[].scores["seeded-01"]]}' "$input" >&3

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -eq 0 ]
  [[ "$output" == *"RESULT spec_id=seeded-01 outcome=INCONCLUSIVE"* ]]
  jq -e '
    .results[] | select(.spec_id == "seeded-01") |
    .absolute_difference < .uncertainty_half_width
    and .outcome == "INCONCLUSIVE"
    and .decision == "not_evaluated"
  ' "$result"
}

@test "classification uses full precision beyond the CI boundary" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '
    .conditions.baseline.runs[0].scores["seeded-01"] = 0.5 |
    .conditions.baseline.runs[1].scores["seeded-01"] = 0.5 |
    .conditions.baseline.runs[2].scores["seeded-01"] = 0.5 |
    .conditions.candidate.runs[0].scores["seeded-01"] = 0.500000004 |
    .conditions.candidate.runs[1].scores["seeded-01"] = 0.6 |
    .conditions.candidate.runs[2].scores["seeded-01"] = 0.699999996
  ' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .results[] | select(.spec_id == "seeded-01") |
    .absolute_difference > .uncertainty_half_width
    and .outcome == "IMPROVEMENT"
    and .decision == "evaluated"
  ' "$result"
}

@test "a changed observed model fires INVALID and returns failure" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '.conditions.candidate.runs[1].observed_model.version = "2026-08-01-drift"' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"
  printf 'MUTATED INPUT model-drift control:\n' >&3
  jq '{pinned:.conditions.candidate.pinned_model, observed_runs:[.conditions.candidate.runs[].observed_model]}' "$input" >&3

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"INVALID comparison_id=recorded-seeded-defect-control"* ]]
  [[ "$output" == *"candidate run candidate-2 observed model"* ]]
  jq -e '
    .validity.status == "invalid"
    and all(.results[]; .outcome == "INVALID" and .decision == "not_evaluated")
  ' "$result"
}

@test "an explicitly unpinned model invalidates the comparison" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '.conditions.baseline.pinned_model.pinned = false' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -ne 0 ]
  jq -e '.validity.status == "invalid" and (.validity.reasons[] | contains("not pinned"))' "$result"
}

@test "a difference outside the CI reports an improvement" {
  result="$BATS_TEST_TMPDIR/result.json"

  run "$RUNNER" compare "$COMPARISON_FIXTURE" --output "$result"

  [ "$status" -eq 0 ]
  jq -e 'all(.results[]; .outcome == "IMPROVEMENT" and .decision == "evaluated")' "$result"
}

@test "a negative difference outside the CI reports a regression" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '
    .conditions.candidate.runs[0].scores["seeded-01"] = 0.0 |
    .conditions.candidate.runs[1].scores["seeded-01"] = 0.1 |
    .conditions.candidate.runs[2].scores["seeded-01"] = 0.2
  ' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '.results[] | select(.spec_id == "seeded-01") | .outcome == "REGRESSION"' "$result"
}

@test "a rate over zero trials is uncomputable and carries its denominator" {
  result="$BATS_TEST_TMPDIR/rate.json"

  run "$RUNNER" rate "$FIXTURE_ROOT/rate-zero-trials.json" --output "$result"

  [ "$status" -eq 0 ]
  [[ "$output" == *"RATE rate_id=recorded-zero-trial-control status=uncomputable denominator=trials:0"* ]]
  jq -e '
    .rate.status == "uncomputable"
    and .rate.denominator == {"name":"trials","value":0}
    and .rate.decision == "not_evaluated"
    and (.rate | has("value") | not)
    and (.rate | has("percent") | not)
  ' "$result"
}

@test "a zero baseline makes the comparison inconclusive and not evaluated" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '
    .conditions.baseline.runs[0].scores["seeded-01"] = 0 |
    .conditions.baseline.runs[1].scores["seeded-01"] = 0 |
    .conditions.baseline.runs[2].scores["seeded-01"] = 0 |
    .conditions.candidate.runs[0].scores["seeded-01"] = 0.1 |
    .conditions.candidate.runs[1].scores["seeded-01"] = 0.2 |
    .conditions.candidate.runs[2].scores["seeded-01"] = 0.3
  ' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .results[] | select(.spec_id == "seeded-01") |
    .relative_difference.status == "uncomputable"
    and .relative_difference.denominator == {"name":"baseline condition point estimate","value":0}
    and .outcome == "INCONCLUSIVE"
    and .decision == "not_evaluated"
  ' "$result"
}

@test "a computed rate still carries its nonzero denominator" {
  input="$BATS_TEST_TMPDIR/rate.json"
  result="$BATS_TEST_TMPDIR/rate-result.json"
  jq '.numerator = 3 | .denominator.value = 4' "$FIXTURE_ROOT/rate-zero-trials.json" > "$input"

  run "$RUNNER" rate "$input" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '.rate.status == "computed" and .rate.value == 0.75 and .rate.percent == 75 and .rate.denominator.value == 4' "$result"
}

@test "a negative denominator is rejected rather than rendered as a rate" {
  input="$BATS_TEST_TMPDIR/rate.json"
  result="$BATS_TEST_TMPDIR/rate-result.json"
  jq '.numerator = 1 | .denominator.value = -2' "$FIXTURE_ROOT/rate-zero-trials.json" > "$input"

  run "$RUNNER" rate "$input" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"rate denominator must be nonnegative"* ]]
}

@test "the active tier policy declares budgets, cadence, and no Tier 3" {
  jq -e '
    .material_margin_percent == 20
    and .tiers.tier0.cadence == "per_commit"
    and .tiers.tier0.max_cost_usd == 0
    and .tiers.tier1.cadence == "per_commit_or_pull_request"
    and .tiers.tier1.max_cost_usd == 0
    and .tiers.tier2.cadence == "on_demand_manual_only"
    and .tiers.tier2.expected_n == 3
    and .tiers.tier2.min_specs == 8
    and .tiers.tier2.max_specs == 12
    and .tiers.tier2.max_vendor_calls == 72
    and .tiers.tier2.automatic_triggers == []
    and (.tiers | has("tier3") | not)
  ' "$BUDGETS"
}

@test "a breach above the fixed 20 percent margin requires budget review" {
  result="$BATS_TEST_TMPDIR/budgets.json"

  run "$RUNNER" budget "$FIXTURE_ROOT/tier-run-records.json" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .runs[] | select(.run_id == "tier0-over-material-margin") |
    .budget_breach == true
    and .budget_review == true
    and .fields.duration_s.delta == 25
    and .fields.duration_s.margin_percent.value > 20
  ' "$result"
}

@test "a breach within the 20 percent material margin does not require review" {
  result="$BATS_TEST_TMPDIR/budgets.json"

  run "$RUNNER" budget "$FIXTURE_ROOT/tier-run-records.json" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .runs[] | select(.run_id == "tier0-within-material-margin") |
    .budget_breach == true
    and .budget_review == false
    and .fields.duration_s.margin_percent.value < 20
  ' "$result"
}

@test "nonzero spend against a zero cost budget breaches without a percentage" {
  result="$BATS_TEST_TMPDIR/budgets.json"

  run "$RUNNER" budget "$FIXTURE_ROOT/tier-run-records.json" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .runs[] | select(.run_id == "tier1-unexpected-spend") |
    .budget_breach == true
    and .budget_review == true
    and .fields.cost_usd.margin_percent.status == "uncomputable"
    and .fields.cost_usd.margin_percent.denominator == {"name":"declared cost_usd budget","value":0}
    and (.fields.cost_usd.margin_percent | has("value") | not)
  ' "$result"
}

@test "Tier 2 comparison records its measured and declared budget state" {
  result="$BATS_TEST_TMPDIR/result.json"

  run "$RUNNER" compare "$COMPARISON_FIXTURE" --output "$result"

  [ "$status" -eq 0 ]
  jq -e '
    .run_record.tier == "tier2"
    and .run_record.duration_s == 84.25
    and .run_record.cost_usd == 9
    and .run_record.declared_budget.cadence == "on_demand_manual_only"
    and .run_record.cadence_check.status == "permitted"
    and .run_record.budget_breach == false
    and .run_record.budget_review == false
    and .plan.planned_vendor_calls == 48
    and .plan.declared_expected_cost_usd == 12
  ' "$result"
}

@test "an automatic Tier 2 invocation is refused even with an override" {
  input="$BATS_TEST_TMPDIR/runs.json"
  result="$BATS_TEST_TMPDIR/budgets.json"
  jq '
    .runs = [.runs[] | select(.run_id == "tier2-within-budget")] |
    .runs[0].invocation = {source:"release", explicit_override:true}
  ' "$FIXTURE_ROOT/tier-run-records.json" > "$input"

  run "$RUNNER" budget "$input" --output "$result"

  [ "$status" -ne 0 ]
  jq -e '
    .runs[0].cadence_check.status == "refused"
    and .runs[0].cadence_check.decision == "not_evaluated"
    and .runs[0].cadence_permitted == false
  ' "$result"
}

@test "an automatically sourced comparison is invalid and emits no finding" {
  input="$(copy_comparison)"
  result="$BATS_TEST_TMPDIR/result.json"
  jq '.measurement.invocation = {source:"release", explicit_override:true}' "$input" > "$input.tmp"
  mv "$input.tmp" "$input"

  run "$RUNNER" compare "$input" --output "$result"

  [ "$status" -ne 0 ]
  jq -e '
    .run_record.cadence_check.status == "refused"
    and .validity.status == "invalid"
    and all(.results[]; .outcome == "INVALID" and .decision == "not_evaluated")
  ' "$result"
}

@test "manual collection refuses to start without explicit acknowledgement" {
  result="$BATS_TEST_TMPDIR/collected.json"

  run env TIER2_FIXTURE_SOURCE="$COMPARISON_FIXTURE" \
    "$COLLECTOR" --adapter "$FIXTURE_ROOT/fixture-adapter.sh" \
    "$FIXTURE_ROOT/collection-plan.json" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"--acknowledge-paid-vendor-calls is required"* ]]
  [ ! -e "$result" ]
}

@test "manual collection rejects an unpinned plan before the first adapter call" {
  input="$BATS_TEST_TMPDIR/collection-plan.json"
  result="$BATS_TEST_TMPDIR/collected.json"
  call_log="$BATS_TEST_TMPDIR/adapter-calls.log"
  jq '.conditions.baseline.pinned_model.pinned = false' \
    "$FIXTURE_ROOT/collection-plan.json" > "$input"

  run env TIER2_FIXTURE_SOURCE="$COMPARISON_FIXTURE" \
    TIER2_FIXTURE_CALL_LOG="$call_log" \
    "$COLLECTOR" --acknowledge-paid-vendor-calls \
    --adapter "$FIXTURE_ROOT/fixture-adapter.sh" \
    "$input" --output "$result"

  [ "$status" -ne 0 ]
  [[ "$output" == *"baseline model is not pinned"* ]]
  [ ! -e "$call_log" ]
  [ ! -e "$result" ]
}

@test "manual collector performs exactly N=3 fixture calls per spec and condition" {
  result="$BATS_TEST_TMPDIR/collected.json"

  run env TIER2_FIXTURE_SOURCE="$COMPARISON_FIXTURE" \
    "$COLLECTOR" --acknowledge-paid-vendor-calls \
    --adapter "$FIXTURE_ROOT/fixture-adapter.sh" \
    "$FIXTURE_ROOT/collection-plan.json" --output "$result"

  [ "$status" -eq 0 ]
  [[ "$output" == *"COLLECTED fixture-only-compatible calls=48"* ]]
  jq -e '
    .collection.adapter_invocations == 48
    and .collection.expected_n == 3
    and (.conditions.baseline.runs | length) == 3
    and (.conditions.candidate.runs | length) == 3
    and all(.conditions.baseline.runs[]; (.scores | length) == 8)
    and all(.conditions.candidate.runs[]; (.scores | length) == 8)
  ' "$result"
}

@test "workflow, hook, release, and scheduler surfaces contain no Tier 2 invocation" {
  run "$TRIGGER_SCANNER"

  [ "$status" -eq 0 ]
  [[ "$output" == *"TRIGGER_SCAN_OUTPUT_BEGIN"$'\n'"TRIGGER_SCAN_OUTPUT_END"* ]]
  [[ "$output" == *"TRIGGER_SCAN_RESULT grep_exit=1 output_bytes=0"* ]]
}

@test "the trigger absence scanner fails on a planted extensionless hook" {
  root="$BATS_TEST_TMPDIR/automation"
  mkdir -p "$root/hooks"
  printf '#!/usr/bin/env bash\ntests/tier2-compare.sh compare paid.json\n' > "$root/hooks/pre-commit"

  run "$TRIGGER_SCANNER" "$root"

  [ "$status" -ne 0 ]
  [[ "$output" == *"hooks/pre-commit"* ]]
  [[ "$output" == *"TRIGGER_SCAN_RESULT grep_exit=0"* ]]
}
