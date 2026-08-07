#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  load "$REPO_ROOT/tests/lib/preconditions.bash"
  PLATFORM="$(preconditions_platform)"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/policy-test.XXXXXX")"
  FIXTURE="tests/fixtures/policy/trivial.bats"
}

teardown() {
  rm -rf -- "$WORK"
}

@test "baseline header without a platform column is rejected" {
  printf 'file\texpected_passes\n%s\t1\n' "$FIXTURE" >"$WORK/baseline.tsv"
  printf 'file\tplatform\tpermitted_skips\n%s\t%s\t0\n' \
    "$FIXTURE" "$PLATFORM" >"$WORK/skip.tsv"

  run env TEST_BASELINE_FILE="$WORK/baseline.tsv" \
    TEST_SKIP_BUDGET_FILE="$WORK/skip.tsv" \
    TEST_SLICE_REPORT="$WORK/slices.tsv" \
    bash "$REPO_ROOT/tests/run.sh" "$REPO_ROOT/$FIXTURE"

  [ "$status" -eq 2 ]
  [[ "$output" == *"baseline header must be: file<TAB>platform<TAB>expected_passes"* ]]
}

@test "baseline lookup selects the row for the current platform" {
  {
    printf 'file\tplatform\texpected_passes\n'
    printf '%s\tlinux\t1\n' "$FIXTURE"
    printf '%s\twsl\t1\n' "$FIXTURE"
    printf '%s\twindows\t1\n' "$FIXTURE"
  } >"$WORK/baseline.tsv"
  {
    printf 'file\tplatform\tpermitted_skips\n'
    printf '%s\tlinux\t0\n' "$FIXTURE"
    printf '%s\twsl\t0\n' "$FIXTURE"
    printf '%s\twindows\t0\n' "$FIXTURE"
  } >"$WORK/skip.tsv"

  run env TEST_BASELINE_FILE="$WORK/baseline.tsv" \
    TEST_SKIP_BUDGET_FILE="$WORK/skip.tsv" \
    TEST_SLICE_REPORT="$WORK/slices.tsv" \
    bash "$REPO_ROOT/tests/run.sh" "$REPO_ROOT/$FIXTURE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"baseline_verdict=PASS"* ]]
}

@test "a platform absent from the baseline is an actionable error" {
  {
    printf 'file\tplatform\texpected_passes\n'
    printf '%s\tnosuchplatform\t1\n' "$FIXTURE"
  } >"$WORK/baseline.tsv"
  {
    printf 'file\tplatform\tpermitted_skips\n'
    printf '%s\t%s\t0\n' "$FIXTURE" "$PLATFORM"
  } >"$WORK/skip.tsv"

  run env TEST_BASELINE_FILE="$WORK/baseline.tsv" \
    TEST_SKIP_BUDGET_FILE="$WORK/skip.tsv" \
    TEST_SLICE_REPORT="$WORK/slices.tsv" \
    bash "$REPO_ROOT/tests/run.sh" "$REPO_ROOT/$FIXTURE"

  [ "$status" -ne 0 ]
  [[ "$output" == *"missing pass baseline for $FIXTURE on $PLATFORM"* ]]
}
