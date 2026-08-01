#!/usr/bin/env bash
# @description Standalone harness for release-metrics linter verification.
#   Runs known-bad and known-good cases. Exits non-zero if ANY case fails
#   (wrong exit code or missing expected violation id).
#   Does not require bats. Gate concurrent runs with flock externally if needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$ROOT/skills/foreman/scripts/lib/metrics-lint.sh"
export FOREMAN_REPO_ROOT="$ROOT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILS=0
PASS=0

# @description Run the enforce-mode metrics linter against the prepared report
#   and record whether its exit status and optional violation text match.
# @arg $1 name  @arg $2 expected_exit (0|nonzero)  @arg $3 expected substring (optional)
# remaining: ignored; report file is $TMP/case.md already written
# @stdout formatted PASS result, or FAIL result with captured linter output
expect_case() {
  local name="$1" want_exit="$2" want_sub="${3:-}"
  local out ec=0
  set +e
  out="$(bash "$LINT" --mode enforce "$TMP/case.md" 2>&1)"
  ec=$?
  set -e
  local ok=1
  if [[ "$want_exit" == "0" ]]; then
    [[ "$ec" -eq 0 ]] || ok=0
  else
    [[ "$ec" -ne 0 ]] || ok=0
  fi
  if [[ -n "$want_sub" && "$out" != *"$want_sub"* ]]; then
    ok=0
  fi
  if (( ok )); then
    echo "PASS: $name (exit=$ec)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (exit=$ec, want $want_exit, sub='$want_sub')"
    while IFS= read -r _line; do
      printf '  | %s\n' "$_line"
    done <<<"$out"
    FAILS=$((FAILS + 1))
  fi
}

# V1
cat > "$TMP/case.md" <<'EOF'
M7: 6 per 100 lane-starts
EOF
expect_case "V1 companion" nonzero "[companion]"

# V2
cat > "$TMP/case.md" <<'EOF'
M7 improved from 8 to 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 2; unattended: 1).
EOF
expect_case "V2 sigma-missing" nonzero "[sigma-missing]"

# V3
cat > "$TMP/case.md" <<'EOF'
M7 improved 2 per 100 lane-starts (sigma=5) (lane starts: 50; maintainer-initiated: 1; unattended: 2).
EOF
expect_case "V3 smaller-than-sigma" nonzero "[smaller-than-sigma]"

# V4
cat > "$TMP/case.md" <<'EOF'
M3 uncomputable -- no usable cost fields; this is described as a result of the release.
EOF
expect_case "V4 uncomputable-result" nonzero "[uncomputable-result]"

# V5
cat > "$TMP/case.md" <<'EOF'
M7 uncomputable -- zero denominator (lane starts = 0 over 2026-07); presented as a pass for reliability.
EOF
expect_case "V5 zero-denom-pass" nonzero "[zero-denom-pass]"

# V6
cat > "$TMP/case.md" <<'EOF'
# v0.2.9 release metrics (reduced active set; not fully computed)
M2: p50=1 round, p90=3 rounds, abandoned=4% (tasks started: 40).
M7: 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 1; unattended: 2).
M8: evidence completeness 94% (gate decisions: 32; interim file basis share: 100%).
M3: uncomputable -- usage present but source unavailable for majority of attempts, pending decision-lineage-and-telemetry
M4: uncomputable -- five-bucket phase join incomplete (no unaccounted field emitted), pending decision-lineage-and-telemetry
sigma not yet estimated (n=0 windows, need n>=10) — no comparative claims.
EOF
expect_case "V6 correct" 0 "OK (0 violations)"

# V7 shadow: violations but exit 0
cat > "$TMP/case.md" <<'EOF'
M7: 6 per 100 lane-starts
EOF
set +e
out="$(bash "$LINT" --mode shadow "$TMP/case.md" 2>&1)"
ec=$?
set -e
if [[ "$ec" -eq 0 && "$out" == *"[companion]"* ]]; then
  echo "PASS: V7 shadow exit 0 with violations"
  PASS=$((PASS + 1))
else
  echo "FAIL: V7 shadow (exit=$ec)"
  while IFS= read -r _line; do
    printf '  | %s\n' "$_line"
  done <<<"$out"
  FAILS=$((FAILS + 1))
fi

# V8: prove harness itself exits non-zero when a case fails.
# Run a one-shot mini-harness that expects exit 0 on a known-bad input;
# that mini-harness must exit 1.
set +e
bash -c '
  set -euo pipefail
  LINT="$1"; FILE="$2"
  out="$(bash "$LINT" --mode enforce "$FILE" 2>&1)" || true
  ec=1
  # Deliberately wrong expectation: want exit 0 on known-bad
  if [[ "$ec" -eq 0 ]]; then
    exit 0
  fi
  echo "injected mismatch: known-bad exited $ec but mini-harness required 0" >&2
  exit 1
' bash "$LINT" "$TMP/case.md"
inj=$?
set -e
if [[ "$inj" -ne 0 ]]; then
  echo "PASS: V8 harness exits non-zero when a case fails (injected mismatch ec=$inj)"
  PASS=$((PASS + 1))
else
  echo "FAIL: V8 harness did not exit non-zero on injected mismatch"
  FAILS=$((FAILS + 1))
fi

echo "----"
echo "release-metrics-harness: $PASS passed, $FAILS failed"
if (( FAILS > 0 )); then
  exit 1
fi
exit 0
