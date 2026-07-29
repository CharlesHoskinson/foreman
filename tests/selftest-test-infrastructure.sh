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
  local status output report

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
