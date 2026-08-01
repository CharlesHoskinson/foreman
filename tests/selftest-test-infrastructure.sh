#!/usr/bin/env bash
# @description Exercise the T1/T2 checkers against known-good and known-bad
#   fixtures. The harness accumulates failures and exits non-zero if any case
#   fails, so printed failures can never be mistaken for success.
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
FIXTURE_DIR="$TESTS_DIR/fixtures/test-infrastructure"
POLICY_DIR="$FIXTURE_DIR/policy"
RUNNER="$TESTS_DIR/run.sh"
DELTA_RECORD="$REPO_ROOT/docs/evidence/regression-harness-tier0-deltas.tsv"
INJECTED_SLICE="tests/fixtures/test-infrastructure/regressed-slice.bats"
MIN_OWNING_DROP_PP=20
MIN_DROP_SEPARATION_PP=15
BATS_BIN="${BATS:-$(command -v bats || true)}"
TMP_DIR="$(mktemp -d)"
FAILURES=0
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ "${FOREMAN_BATS_MUTEX_HELD:-0}" != 1 ]] && command -v flock >/dev/null 2>&1; then
  export FOREMAN_BATS_MUTEX_HELD=1
  exec flock "$HOME/.foreman/gate.lock" bash "$0" "$@"
fi

# @description Record one failed self-test without aborting later cases.
# @arg $1 failure description
record_failure() {
  printf 'SELFTEST FAIL: %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

# @description Assert an observed command status equals its expected status.
# @arg $1 expected status
# @arg $2 actual status
# @arg $3 case label
assert_status() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$actual" -ne "$expected" ]]; then
    record_failure "$label: expected exit $expected, got $actual"
  fi
}

# @description Assert a file contains an exact fixed string.
# @arg $1 file to inspect
# @arg $2 required string
# @arg $3 case label
assert_contains() {
  local file="$1" expected="$2" label="$3"
  if ! grep -Fq -- "$expected" "$file"; then
    record_failure "$label: missing output: $expected"
  fi
}

# @description Measure owning-slice and aggregate pass-rate drops from one report.
# @arg $1 machine-readable slice report
# @arg $2 injected slice path as recorded in the report
# @stdout tab-separated owning-slice and aggregate drops in percentage points
measure_delta_pair() {
  local report="$1" injected_slice="$2"
  awk -F '\t' -v injected_slice="$injected_slice" '
    NR == 1 {
      for (column = 1; column <= NF; column++) {
        index_by_name[$column] = column
      }
      file_column = index_by_name["file"]
      pass_column = index_by_name["pass"]
      fail_column = index_by_name["fail"]
      skip_column = index_by_name["skip"]
      baseline_column = index_by_name["baseline"]
      if (!file_column || !pass_column || !fail_column || !skip_column || !baseline_column) {
        print "ERROR delta measurement: required report columns are missing" > "/dev/stderr"
        invalid = 1
      }
      next
    }
    {
      if ($pass_column !~ /^[0-9]+$/ || $fail_column !~ /^[0-9]+$/ ||
          $skip_column !~ /^[0-9]+$/ || $baseline_column !~ /^[0-9]+$/) {
        printf "ERROR delta measurement: non-numeric report row for %s\n", $file_column > "/dev/stderr"
        invalid = 1
        next
      }
      row_tests = $pass_column + $fail_column + $skip_column
      total_pass += $pass_column
      total_baseline += $baseline_column
      total_tests += row_tests
      if ($file_column == injected_slice) {
        injected_rows++
        owning_pass = $pass_column
        owning_baseline = $baseline_column
        owning_tests = row_tests
      }
    }
    END {
      if (invalid) {
        exit 2
      }
      if (injected_rows != 1 || owning_tests == 0 || total_tests == 0) {
        printf "ERROR delta measurement: slice_rows=%d owning_tests=%d aggregate_tests=%d\n",
          injected_rows, owning_tests, total_tests > "/dev/stderr"
        exit 2
      }
      owning_deficit = owning_baseline - owning_pass
      aggregate_deficit = total_baseline - total_pass
      owning_drop = owning_deficit * 100 / owning_tests
      aggregate_drop = aggregate_deficit * 100 / total_tests
      printf "%.6f\t%.6f\t%d\t%d\t%d\t%d\n",
        owning_drop, aggregate_drop, owning_deficit, owning_tests,
        aggregate_deficit, total_tests
    }
  ' "$report"
}

# @description Enforce the Tier 0 difference-based detection criterion.
# @arg $1 owning-slice pass-rate drop in percentage points
# @arg $2 aggregate pass-rate drop in percentage points
# @arg $3 owning-slice pass deficit
# @arg $4 owning-slice test denominator
# @arg $5 aggregate pass deficit
# @arg $6 aggregate test denominator
check_detection_criterion() {
  local owning_drop="$1" aggregate_drop="$2"
  local owning_deficit="$3" owning_tests="$4"
  local aggregate_deficit="$5" aggregate_tests="$6"
  if awk -v owning_drop="$owning_drop" -v aggregate_drop="$aggregate_drop" \
    -v owning_deficit="$owning_deficit" -v owning_tests="$owning_tests" \
    -v aggregate_deficit="$aggregate_deficit" -v aggregate_tests="$aggregate_tests" \
    -v minimum_owning="$MIN_OWNING_DROP_PP" \
    -v minimum_separation="$MIN_DROP_SEPARATION_PP" \
    'BEGIN {
      owning_passes = 100 * owning_deficit >= minimum_owning * owning_tests
      separation_passes = 100 * (owning_deficit * aggregate_tests - aggregate_deficit * owning_tests) >= minimum_separation * owning_tests * aggregate_tests
      passes = owning_passes && separation_passes
      exit !passes
    }'; then
    printf 'SELFTEST CRITERION: PASS owning-slice drop=%spp aggregate drop=%spp\n' \
      "$owning_drop" "$aggregate_drop"
  else
    record_failure "delta criterion: owning-slice drop=${owning_drop}pp aggregate drop=${aggregate_drop}pp; require owning >= ${MIN_OWNING_DROP_PP}pp and owning minus aggregate >= ${MIN_DROP_SEPARATION_PP}pp"
    return 1
  fi
}

# @description Report whether the annual run is overdue without failing the suite.
# @arg $1 append-only delta record
# @arg $2 current time as Unix epoch seconds
report_annual_status() {
  local record="$1" now_epoch="$2"
  local last_run due_epoch due_at

  last_run="$(awk -F '\t' 'NR > 1 && $1 != "" { latest = $1 } END { print latest }' "$record" 2>/dev/null)"
  if [[ -z "$last_run" ]]; then
    printf 'SELFTEST OVERDUE: no prior Tier 0 delta run is recorded\n'
    return 0
  fi
  if ! due_epoch="$(date -u -d "$last_run + 12 months" +%s 2>/dev/null)"; then
    printf 'SELFTEST OVERDUE: last_run=%s has an invalid timestamp\n' "$last_run"
    return 0
  fi
  due_at="$(date -u -d "@$due_epoch" '+%Y-%m-%dT%H:%M:%SZ')"
  if (( now_epoch >= due_epoch )); then
    printf 'SELFTEST OVERDUE: last_run=%s due=%s\n' "$last_run" "$due_at"
  else
    printf 'SELFTEST ANNUAL: current last_run=%s due=%s\n' "$last_run" "$due_at"
  fi
}

# @description Append one measured Tier 0 delta pair to its evidence log.
# @arg $1 injected slice path
# @arg $2 owning-slice pass-rate drop in percentage points
# @arg $3 aggregate pass-rate drop in percentage points
record_delta_pair() {
  local injected_slice="$1" owning_drop="$2" aggregate_drop="$3"
  local ran_at
  if ! ran_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"; then
    record_failure "delta record: could not determine the UTC run time"
    return
  fi
  if ! printf '%s\t%s\t%s\t%s\n' \
    "$ran_at" "$injected_slice" "$owning_drop" "$aggregate_drop" >>"$DELTA_RECORD"; then
    record_failure "delta record: could not append $DELTA_RECORD"
    return
  fi
  printf 'SELFTEST RECORD: ran_at=%s injected_slice=%s owning-slice drop=%spp aggregate drop=%spp\n' \
    "$ran_at" "$injected_slice" "$owning_drop" "$aggregate_drop"
}

# @description Prove an overdue annual report is visible but non-blocking.
check_annual_overdue_report() {
  local record="$TMP_DIR/overdue-deltas.tsv"
  local output="$TMP_DIR/overdue-deltas.out"
  local status
  printf 'ran_at_utc\tinjected_slice\towning_slice_drop_pp\taggregate_drop_pp\n' >"$record"
  printf '2000-01-01T00:00:00Z\t%s\t100.00\t3.03\n' "$INJECTED_SLICE" >>"$record"
  report_annual_status "$record" "$(date -u +%s)" >"$output"
  status=$?
  assert_status 0 "$status" "annual overdue report is non-blocking"
  assert_contains "$output" "SELFTEST OVERDUE: last_run=2000-01-01T00:00:00Z" "annual overdue report"
}

# @description Prove fractional drops are compared before display rounding.
check_fractional_delta_boundary() {
  local report="$TMP_DIR/fractional-boundary.tsv"
  local output="$TMP_DIR/fractional-boundary.out"
  local delta_pair owning_drop aggregate_drop status
  local owning_deficit owning_tests aggregate_deficit aggregate_tests
  printf 'file\tplatform\tpass\tfail\tskip\tbare_skip\tskip_budget\tbudget_slack\tbaseline\tpass_delta\ttest_verdict\tbudget_verdict\tbaseline_verdict\tskip_reasons\n' >"$report"
  printf '%s\tlinux\t0\t0\t20000\t0\t20000\t0\t3999\t-3999\tPASS\tPASS\tFAIL\tseeded boundary\n' "$INJECTED_SLICE" >>"$report"
  printf 'tests/fixtures/test-infrastructure/healthy-slice.bats\tlinux\t0\t0\t60000\t0\t60000\t0\t0\t0\tPASS\tPASS\tPASS\t-\n' >>"$report"
  delta_pair="$(measure_delta_pair "$report" "$INJECTED_SLICE")"
  IFS=$'\t' read -r owning_drop aggregate_drop owning_deficit owning_tests \
    aggregate_deficit aggregate_tests <<<"$delta_pair"
  (
    check_detection_criterion "$owning_drop" "$aggregate_drop" \
      "$owning_deficit" "$owning_tests" "$aggregate_deficit" "$aggregate_tests"
  ) >"$output" 2>&1
  status=$?
  assert_status 1 "$status" "fractional delta boundary rejects a sub-threshold drop"
  assert_contains "$output" "owning-slice drop=19.995000pp aggregate drop=4.998750pp" "fractional delta boundary names both drops"
}

# @description Run the suite runner with fixture policy and capture its status.
# @arg $1 case label, also used as the output filename
# @arg $2 gate mode (shadow or enforce)
# @arg $3 baseline TSV
# @arg $4 skip-budget TSV
# @arg $5... fixture .bats paths relative to tests/
# @stdout runner exit status
run_runner() {
  local label="$1" mode="$2" baseline="$3" budget="$4"
  shift 4
  local output="$TMP_DIR/$label.out"
  local report="$TMP_DIR/$label.tsv"
  (
    cd "$REPO_ROOT" || exit 2
    TEST_GATE_MODE="$mode" \
      TEST_BASELINE_FILE="$baseline" \
      TEST_SKIP_BUDGET_FILE="$budget" \
      TEST_SLICE_REPORT="$report" \
      bash "$RUNNER" "$@"
  ) >"$output" 2>&1
  printf '%s\n' "$?"
}

# @description Verify all T1 helpers skip with specific, actionable reasons.
check_preconditions() {
  local output="$TMP_DIR/preconditions.out"
  "$BATS_BIN" --formatter tap "$FIXTURE_DIR/preconditions.bats" >"$output" 2>&1
  local status=$?
  assert_status 0 "$status" "precondition helpers"
  assert_contains "$output" "requires platform fixture-platform" "require_platform reason"
  assert_contains "$output" "requires tool foreman-fixture-tool; install with: install foreman-fixture-tool" "require_tool reason"
  if (( EUID == 0 )); then
    assert_contains "$output" "requires a non-root user" "require_non_root reason"
  fi
  assert_contains "$output" "requires built artefact" "require_built reason"
  assert_contains "$output" "build with: npm run build:fixture" "require_built command"
  assert_contains "$output" "requires no live foreman-fixture-vendor process" "require_no_live_vendor reason"
}

# @description Verify T2 runner policy, reporting, and shadow/enforce behavior.
check_runner() {
  local status output report delta_pair owning_drop aggregate_drop now_epoch
  local owning_deficit owning_tests aggregate_deficit aggregate_tests

  status="$(run_runner reasoned-enforce enforce \
    "$POLICY_DIR/baseline-within.tsv" "$POLICY_DIR/skip-within.tsv" \
    "$FIXTURE_DIR/reasoned-skip.bats")"
  output="$TMP_DIR/reasoned-enforce.out"
  report="$TMP_DIR/reasoned-enforce.tsv"
  assert_status 0 "$status" "reasoned skip within budget"
  assert_contains "$output" "requires fixture capability; install with fixture-setup" "reasoned skip human report"
  assert_contains "$report" "requires fixture capability; install with fixture-setup" "reasoned skip machine report"
  assert_contains "$output" "slack=0" "budget slack"

  status="$(run_runner bare-shadow shadow \
    "$POLICY_DIR/baseline-bare.tsv" "$POLICY_DIR/skip-bare.tsv" \
    "$FIXTURE_DIR/bare-skip.bats")"
  output="$TMP_DIR/bare-shadow.out"
  assert_status 0 "$status" "bare skip shadow"
  assert_contains "$output" "FAIL bare skip without reason" "bare skip shadow verdict"

  status="$(run_runner bare-enforce enforce \
    "$POLICY_DIR/baseline-bare.tsv" "$POLICY_DIR/skip-bare.tsv" \
    "$FIXTURE_DIR/bare-skip.bats")"
  output="$TMP_DIR/bare-enforce.out"
  assert_status 1 "$status" "bare skip enforce"
  assert_contains "$output" "FAIL bare skip without reason" "bare skip enforce verdict"

  status="$(run_runner budget-shadow shadow \
    "$POLICY_DIR/baseline-within.tsv" "$POLICY_DIR/skip-over.tsv" \
    "$FIXTURE_DIR/reasoned-skip.bats")"
  output="$TMP_DIR/budget-shadow.out"
  assert_status 0 "$status" "skip budget shadow"
  assert_contains "$output" "FAIL skip budget: tests/fixtures/test-infrastructure/reasoned-skip.bats actual=1 budget=0 excess=1" "skip budget shadow verdict"

  status="$(run_runner budget-enforce enforce \
    "$POLICY_DIR/baseline-within.tsv" "$POLICY_DIR/skip-over.tsv" \
    "$FIXTURE_DIR/reasoned-skip.bats")"
  assert_status 1 "$status" "skip budget enforce"

  status="$(run_runner baseline-shadow shadow \
    "$POLICY_DIR/baseline-below.tsv" "$POLICY_DIR/skip-within.tsv" \
    "$FIXTURE_DIR/reasoned-skip.bats")"
  output="$TMP_DIR/baseline-shadow.out"
  assert_status 0 "$status" "pass baseline shadow"
  assert_contains "$output" "FAIL pass baseline: tests/fixtures/test-infrastructure/reasoned-skip.bats actual=1 baseline=2 deficit=1" "baseline shadow verdict"

  status="$(run_runner baseline-enforce enforce \
    "$POLICY_DIR/baseline-below.tsv" "$POLICY_DIR/skip-within.tsv" \
    "$FIXTURE_DIR/reasoned-skip.bats")"
  assert_status 1 "$status" "pass baseline enforce"

  status="$(run_runner aggregate-enforce enforce \
    "$POLICY_DIR/baseline-aggregate.tsv" "$POLICY_DIR/skip-aggregate.tsv" \
    "$FIXTURE_DIR/healthy-slice.bats" "$FIXTURE_DIR/regressed-slice.bats")"
  output="$TMP_DIR/aggregate-enforce.out"
  report="$TMP_DIR/aggregate-enforce.tsv"
  assert_status 1 "$status" "aggregate blindness enforce"
  assert_contains "$output" "TOTAL pass=32 fail=0 skip=1 tests=33" "aggregate totals"
  assert_contains "$output" "FAIL pass baseline: tests/fixtures/test-infrastructure/regressed-slice.bats actual=0 baseline=1 deficit=1" "per-slice regression"
  assert_contains "$report" $'tests/fixtures/test-infrastructure/regressed-slice.bats\t' "per-slice machine report"

  check_annual_overdue_report
  check_fractional_delta_boundary
  if delta_pair="$(measure_delta_pair "$report" "$INJECTED_SLICE")"; then
    IFS=$'\t' read -r owning_drop aggregate_drop owning_deficit owning_tests \
      aggregate_deficit aggregate_tests <<<"$delta_pair"
    printf 'SELFTEST DELTA: injected_slice=%s owning-slice drop=%spp aggregate drop=%spp\n' \
      "$INJECTED_SLICE" "$owning_drop" "$aggregate_drop"
    check_detection_criterion "$owning_drop" "$aggregate_drop" \
      "$owning_deficit" "$owning_tests" "$aggregate_deficit" "$aggregate_tests"
    now_epoch="$(date -u +%s)"
    report_annual_status "$DELTA_RECORD" "$now_epoch"
    record_delta_pair "$INJECTED_SLICE" "$owning_drop" "$aggregate_drop"
  else
    record_failure "delta measurement: could not measure owning-slice and aggregate drops from $report"
  fi
}

case "${1:-all}" in
  preconditions) check_preconditions ;;
  runner) check_runner ;;
  all)
    check_preconditions
    check_runner
    ;;
  *)
    printf 'usage: %s [preconditions|runner|all]\n' "$0" >&2
    exit 2
    ;;
esac

if [[ "${SELFTEST_FORCE_FAILURE:-0}" == 1 ]]; then
  record_failure "forced known-bad harness input"
fi

if (( FAILURES > 0 )); then
  printf 'SELFTEST RESULT: FAIL (%d case(s))\n' "$FAILURES" >&2
  exit 1
fi

printf 'SELFTEST RESULT: PASS\n'
