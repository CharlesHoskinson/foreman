#!/usr/bin/env bats
# @description release-metrics report linter (companion, sigma, zero-denom, shadow).
#   Every FAIL case was first observed failing against a known-bad fixture.
#   This suite exits non-zero when any case fails (bats default; also proven
#   by tests/release-metrics-harness.sh).
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  LINT="$SCRIPTS/lib/metrics-lint.sh"
  FIX="$BATS_TEST_TMPDIR/fixtures"
  mkdir -p "$FIX"
  export FOREMAN_REPO_ROOT="$BATS_TEST_DIRNAME/.."
  # Resolve to absolute (helpers leave SCRIPTS relative to tests/).
  FOREMAN_REPO_ROOT="$(cd "$FOREMAN_REPO_ROOT" && pwd)"
  export FOREMAN_REPO_ROOT
}

# --- known-bad fixtures ----------------------------------------------------

write_v1_no_companion() {
  cat > "$FIX/v1.md" <<'EOF'
# v0.2.9 release metrics
M7: 6 per 100 lane-starts
EOF
}

write_v2_no_sigma() {
  cat > "$FIX/v2.md" <<'EOF'
# v0.2.9 release metrics
M7 improved from 8 to 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 2; unattended: 1).
EOF
}

write_v3_smaller_than_sigma() {
  cat > "$FIX/v3.md" <<'EOF'
# v0.2.9 release metrics
M7 improved 2 per 100 lane-starts (sigma=5) (lane starts: 50; maintainer-initiated: 1; unattended: 2).
EOF
}

write_v4_uncomputable_as_result() {
  cat > "$FIX/v4.md" <<'EOF'
# v0.2.9 release metrics
M3 uncomputable -- no usable cost fields; this is described as a result of the release.
EOF
}

write_v5_zero_denom_pass() {
  cat > "$FIX/v5.md" <<'EOF'
# v0.2.9 release metrics
M7 uncomputable -- zero denominator (lane starts = 0 over 2026-07); presented as a pass for reliability.
EOF
}

write_v6_correct() {
  cat > "$FIX/v6.md" <<'EOF'
# v0.2.9 release metrics (reduced active set; not fully computed)

M2: p50=1 round, p90=3 rounds, abandoned=4% (tasks started: 40).
M7: 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 1; unattended: 2).
M8: evidence completeness 94% (gate decisions: 32; interim file basis share: 100%).
M3: uncomputable -- usage present but source unavailable for majority of attempts, pending decision-lineage-and-telemetry
M4: uncomputable -- five-bucket phase join incomplete (no unaccounted field emitted), pending decision-lineage-and-telemetry
sigma not yet estimated (n=0 windows, need n>=10) — no comparative claims.
EOF
}

# --- cases -----------------------------------------------------------------

@test "V1: metric without companion fails (names metric)" {
  write_v1_no_companion
  run bash "$LINT" --mode enforce "$FIX/v1.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[companion]"* ]]
  [[ "$output" == *"M7"* ]]
}

@test "V2: improvement claim with no sigma fails" {
  write_v2_no_sigma
  run bash "$LINT" --mode enforce "$FIX/v2.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[sigma-missing]"* ]]
  [[ "$output" == *"M7"* ]]
}

@test "V3: delta smaller than sigma as improvement fails" {
  write_v3_smaller_than_sigma
  run bash "$LINT" --mode enforce "$FIX/v3.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[smaller-than-sigma]"* ]]
  [[ "$output" == *"M7"* ]]
}

@test "V4: uncomputable placeholder described as result fails" {
  write_v4_uncomputable_as_result
  run bash "$LINT" --mode enforce "$FIX/v4.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[uncomputable-result]"* ]]
  [[ "$output" == *"M3"* ]]
}

@test "V5: zero-denominator presented as pass fails" {
  write_v5_zero_denom_pass
  run bash "$LINT" --mode enforce "$FIX/v5.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[zero-denom-pass]"* ]]
  [[ "$output" == *"M7"* ]]
}

@test "V6: correct report passes" {
  write_v6_correct
  run bash "$LINT" --mode enforce "$FIX/v6.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK (0 violations)"* ]]
}

@test "V7a: shadow mode reports V1 violations but exit 0" {
  write_v1_no_companion
  run bash "$LINT" --mode shadow "$FIX/v1.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[companion]"* ]]
  [[ "$output" == *"shadow mode"* ]]
}

@test "V7b: enforce mode exits non-zero on V1" {
  write_v1_no_companion
  run bash "$LINT" --mode enforce "$FIX/v1.md"
  [ "$status" -ne 0 ]
}

@test "V7c: shadow mode reports V5 but exit 0" {
  write_v5_zero_denom_pass
  run bash "$LINT" --mode shadow "$FIX/v5.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[zero-denom-pass]"* ]]
}

@test "deferred M1 value citation fails" {
  cat > "$FIX/m1.md" <<'EOF'
# v0.2.9 release metrics
M1: 78% first-pass gate rate (architect-authored share: 12%).
EOF
  run bash "$LINT" --mode enforce "$FIX/m1.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[deferred]"* ]] || [[ "$output" == *"M1"* ]]
}

@test "cross-vendor independence claim fails in v0.2.9" {
  cat > "$FIX/ind.md" <<'EOF'
# v0.2.9 release metrics
Cross-vendor independence: auditing found defects a single vendor would have missed.
M7: 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 1; unattended: 2).
EOF
  run bash "$LINT" --mode enforce "$FIX/ind.md"
  [ "$status" -ne 0 ]
  [[ "$output" == *"[independence]"* ]]
}

@test "default mode is shadow (env unset)" {
  write_v1_no_companion
  unset FOREMAN_METRICS_LINT_MODE || true
  run bash "$LINT" "$FIX/v1.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"shadow"* ]] || [[ "$output" == *"[companion]"* ]]
}

@test "metric with companion in same sentence passes companion rule" {
  cat > "$FIX/ok7.md" <<'EOF'
# v0.2.9 release metrics (not fully computed)
M7: 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 1; unattended: 2).
EOF
  run bash "$LINT" --mode enforce "$FIX/ok7.md"
  [ "$status" -eq 0 ]
}
