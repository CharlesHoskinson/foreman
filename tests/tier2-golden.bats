#!/usr/bin/env bats
# Value-level equivalence for the Tier 2 evaluator.
#
# tests/tier2-compare.bats drives the CLI and asserts exit codes and shapes. It
# asserts no statistical value, which is why two ports passed all 27 of its
# tests while computing different answers: whole-valued floats lost their
# decimals, and one bootstrap confidence interval came out 16% from Python's on
# identical input (brokenwindows.md BW-014).
#
# These fixtures are Python's exact output, frozen. A port is equivalent when
# it reproduces them byte for byte, and this file fails when it does not.

setup() {
  ROOT="$BATS_TEST_DIRNAME/.."
  GOLD="$BATS_TEST_DIRNAME/fixtures/tier2/golden"
  FIX="$BATS_TEST_DIRNAME/fixtures/tier2"
  OUT="$BATS_TEST_TMPDIR/out.json"
}

@test "compare reproduces the frozen output byte for byte" {
  run bash "$ROOT/tests/tier2-compare.sh" compare "$FIX/comparison.json" --output "$OUT"
  [ "$status" -eq 0 ]
  run diff -u "$GOLD/compare-comparison.json" "$OUT"
  [ "$status" -eq 0 ]
}

@test "rate reproduces the frozen output byte for byte" {
  run bash "$ROOT/tests/tier2-compare.sh" rate "$FIX/rate-zero-trials.json" --output "$OUT"
  [ "$status" -eq 0 ]
  run diff -u "$GOLD/rate-zero-trials.json" "$OUT"
  [ "$status" -eq 0 ]
}

@test "budget reproduces the frozen output byte for byte" {
  run bash "$ROOT/tests/tier2-compare.sh" budget "$FIX/tier-run-records.json" --output "$OUT"
  [ "$status" -eq 0 ]
  run diff -u "$GOLD/budget-tier-run-records.json" "$OUT"
  [ "$status" -eq 0 ]
}

@test "the golden fixtures carry the values a CLI-shape test cannot see" {
  # Guards the guard: if the fixtures ever stop containing statistical values,
  # this file would pass vacuously and BW-014 could recur unseen.
  run grep -c 'uncertainty_half_width' "$GOLD/compare-comparison.json"
  [ "$status" -eq 0 ]
  [ "$output" -gt 0 ]
}
