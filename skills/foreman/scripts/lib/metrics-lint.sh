#!/usr/bin/env bash
# @description Release-metrics report linter (definitions + claim discipline).
#   Scans already-rendered report text; does NOT compute metrics from events.
#   Default mode is shadow (D7): print violations, exit 0. Enforce mode exits
#   non-zero when any violation is found.
#
# Usage (CLI):
#   metrics-lint.sh [--mode shadow|enforce] [--version VERSION] REPORT_FILE
#   FOREMAN_METRICS_LINT_MODE=enforce metrics-lint.sh REPORT_FILE
#
# When sourced, call: ml_lint_file PATH  (sets ML_VIOLATIONS, returns status
# under enforce; under shadow always 0 after printing).
#
# Shellcheck: intended to be shellcheck-clean as a standalone script.
set -euo pipefail

# Resolve script dir when executed; when sourced BASH_SOURCE still works.
_ML_SELF="${BASH_SOURCE[0]:-$0}"
_ML_DIR="$(cd "$(dirname "$_ML_SELF")" && pwd)"
# Repo root: lib -> scripts -> foreman -> skills -> repo
_ML_REPO_ROOT="$(cd "$_ML_DIR/../../../.." && pwd)"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ML_MODE="${FOREMAN_METRICS_LINT_MODE:-shadow}"
ML_VERSION="${FOREMAN_METRICS_REPORT_VERSION:-v0.2.9}"
ML_VIOLATIONS=()
ML_REPO_ROOT="${FOREMAN_REPO_ROOT:-$_ML_REPO_ROOT}"

# Deferred / excluded from v0.2.9 reports (must not be cited as computed).
ML_DEFERRED_IDS=(M1 M5 M6 M9 M10 M11 M12 M13)

# Comparative claim language (case-insensitive).
ML_CLAIM_RE='improv(e|ed|ement|ing)|regress(ed|ion|ing)?|better|worse'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# @description Record one violation (unique id + human message).
# @arg $1 rule id  @arg $2 message (may name offending sentence)
ml_violation() {
  local rule="$1" msg="$2"
  ML_VIOLATIONS+=("[$rule] $msg")
}

# @description Lowercase a string (portable).
ml_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# @description True if package exists under openspec/changes/ and is not archived.
# @arg $1 package directory name
ml_blocker_open() {
  local pkg="$1"
  local open="$ML_REPO_ROOT/openspec/changes/$pkg"
  # Open (unlanded) change directory is the only "still blocking" state.
  # Landed packages move under openspec/changes/archive/; missing = fictional.
  [[ -d "$open" ]]
}

# @description Strip CR for Windows-ish files.
ml_read_file() {
  tr -d '\r' < "$1"
}

# ---------------------------------------------------------------------------
# Per-line / whole-text rules
# ---------------------------------------------------------------------------

# Companion keywords required when a metric claims a numeric value.
# Returns 0 if companion present in context, 1 if missing.
ml_has_companion() {
  local mid="$1" ctx_lc="$2"
  case "$mid" in
    M1)
      [[ "$ctx_lc" == *"architect-authored"* || "$ctx_lc" == *"architect authored"* ]] && return 0
      return 1
      ;;
    M2)
      # Three figures together: p50, p90, abandoned
      [[ "$ctx_lc" == *"p50"* && "$ctx_lc" == *"p90"* && "$ctx_lc" == *"abandon"* ]] && return 0
      return 1
      ;;
    M3)
      [[ "$ctx_lc" == *"non-merging"* || "$ctx_lc" == *"non merging"* || "$ctx_lc" == *"failed attempt"* ]] && return 0
      return 1
      ;;
    M4)
      [[ "$ctx_lc" == *"unaccounted"* ]] && return 0
      return 1
      ;;
    M7)
      # lane starts + maintainer-initiated share
      local has_starts=0 has_maint=0
      [[ "$ctx_lc" == *"lane start"* || "$ctx_lc" == *"lane-start"* || "$ctx_lc" == *"lane_starts"* ]] && has_starts=1
      [[ "$ctx_lc" == *"maintainer"* || "$ctx_lc" == *"cancel"* || "$ctx_lc" == *"abandon"* ]] && has_maint=1
      (( has_starts && has_maint )) && return 0
      return 1
      ;;
    M8)
      local has_gd=0 has_basis=0
      [[ "$ctx_lc" == *"gate decision"* || "$ctx_lc" == *"gate-decision"* || "$ctx_lc" == *"gate_decision"* ]] && has_gd=1
      [[ "$ctx_lc" == *"interim"* || "$ctx_lc" == *"file basis"* || "$ctx_lc" == *"event basis"* ]] && has_basis=1
      (( has_gd && has_basis )) && return 0
      return 1
      ;;
    *)
      # Unknown / deferred: companion check handled by deferred rule
      return 0
      ;;
  esac
}

# @description True if text looks like an uncomputable render (not a value).
ml_is_uncomputable() {
  local lc
  lc="$(ml_lower "$1")"
  [[ "$lc" == *uncomputable* ]]
}

# @description True if context claims a numeric/result value for the metric.
ml_claims_value() {
  local ctx="$1"
  local lc
  lc="$(ml_lower "$ctx")"
  # Uncomputable is not a value claim.
  ml_is_uncomputable "$ctx" && return 1
  # Numeric claim patterns: percent, per-100, currency, plain number after colon.
  [[ "$ctx" =~ [0-9]+([.][0-9]+)?% ]] && return 0
  [[ "$ctx" =~ [0-9]+([.][0-9]+)?[[:space:]]*(per[[:space:]]*100|/100) ]] && return 0
  [[ "$ctx" =~ \$[0-9] ]] && return 0
  [[ "$ctx" =~ :[[:space:]]*[0-9] ]] && return 0
  [[ "$lc" == *p50* || "$lc" == *p90* ]] && return 0
  return 1
}

# @description Lint one report body (full text).
# @arg $1 report text
ml_lint_text() {
  local text="$1"
  ML_VIOLATIONS=()

  # Normalise newlines; work line-oriented with a sliding window of context.
  local -a lines=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    lines+=("$line")
  done <<<"$text"

  local i n mid ctx ctx_lc
  n=${#lines[@]}

  # --- whole-document rules ---
  local text_lc
  text_lc="$(ml_lower "$text")"

  # Independence claim without per-pair M5 (v0.2.9: M5 not rendered → always reject).
  if printf '%s' "$text_lc" | grep -Eq \
      'cross[- ]vendor.*independence|independence.*cross[- ]vendor|cross[- ]vendor auditing found|defects a single vendor'; then
    if [[ "$ML_VERSION" == "v0.2.9" ]] || ! printf '%s' "$text_lc" | grep -Eq 'per[- ]pair m5'; then
      ml_violation "independence" \
        "cross-vendor independence claim rejected: M5 is not rendered in ${ML_VERSION} (owned by graph-eval-falsification; no aggregate form)"
    fi
  fi

  # "fully computed" active-set claim (positive only — "not fully computed" is fine).
  # Strip explicit negations before matching so "not fully computed" is allowed.
  local text_fc
  text_fc="$(printf '%s' "$text_lc" \
    | sed -e 's/not fully computed//g' -e 's/never fully computed//g' -e 's/not a complete release//g')"
  if printf '%s' "$text_fc" | grep -Eq \
      'fully computed|five active metrics are fully|active set is fully|complete release metrics'; then
    ml_violation "fully-computed" \
      "must not describe v0.2.9 active set as fully computed (M3/M4 may be partial; M8 interim-basis): offending language present"
  fi

  # Deferred metrics cited as computed values
  local did
  for did in "${ML_DEFERRED_IDS[@]}"; do
    # Look for "M1: 78%" style or "M1 = 12" with a value claim, not mere definitional mentions.
    if printf '%s\n' "$text" | grep -E -q "\b${did}\b[^[:alnum:]_].{0,40}([0-9]+([.][0-9]+)?%|\\\$[0-9]|:[[:space:]]*[0-9])"; then
      # Allow if the same span is uncomputable
      local hit
      hit="$(printf '%s\n' "$text" | grep -E "\b${did}\b" | head -5 || true)"
      if ! ml_is_uncomputable "$hit"; then
        ml_violation "deferred" \
          "${did} is deferred/excluded from ${ML_VERSION} reports and must not be cited as a computed value: $(echo "$hit" | head -1)"
      fi
    fi
  done

  # --- per-metric line window rules ---
  for (( i=0; i<n; i++ )); do
    local line="${lines[$i]}"
    # Build context: this line + next two (same row/sentence neighbourhood).
    ctx="$line"
    (( i+1 < n )) && ctx+=$'\n'"${lines[$((i+1))]}"
    (( i+2 < n )) && ctx+=$'\n'"${lines[$((i+2))]}"
    ctx_lc="$(ml_lower "$ctx")"

    # Find metric ids on this line.
    local ids
    ids="$(printf '%s' "$line" | grep -oE '\bM([1-9]|1[0-3])\b' | sort -u || true)"
    [[ -z "$ids" ]] && continue

    while IFS= read -r mid; do
      [[ -z "$mid" ]] && continue

      # Uncomputable render checks on this metric's context.
      if ml_is_uncomputable "$ctx"; then
        # Zero-denominator form must name the empty population.
        if printf '%s' "$ctx_lc" | grep -Eq 'zero[- ]denominator'; then
          if ! printf '%s' "$ctx_lc" | grep -Eq '=[[:space:]]*0[[:space:]]+over'; then
            ml_violation "zero-denom-shape" \
              "$mid zero-denominator render must use form 'uncomputable -- zero denominator (<name> = 0 over <window>)': $line"
          fi
          # Zero-denom presented as pass / result / target met.
          if printf '%s' "$ctx_lc" | grep -Eq 'as a pass|is a pass|target met|presented as a pass|pass rate of 0|success'; then
            ml_violation "zero-denom-pass" \
              "$mid zero-denominator uncomputable presented as a pass/result: $line"
          fi
          # Comparative claim on zero-denom.
          if printf '%s' "$ctx_lc" | grep -Eiq "$ML_CLAIM_RE"; then
            ml_violation "zero-denom-claim" \
              "$mid zero-denominator metric cannot carry a comparative claim: $line"
          fi
        else
          # Blocked-input uncomputable: extract pending package if present.
          local pkg=""
          if [[ "$line" =~ pending[[:space:]]+([A-Za-z0-9._-]+) ]]; then
            pkg="${BASH_REMATCH[1]}"
            # Trim trailing punctuation
            pkg="${pkg%%[,.;:]*}"
            if [[ -n "$pkg" ]]; then
              if ! ml_blocker_open "$pkg"; then
                ml_violation "blocker" \
                  "$mid uncomputable names blocker '$pkg' which is missing or already landed under openspec/changes/: $line"
              fi
            fi
          fi
          # Uncomputable described as a result / pass.
          if printf '%s' "$ctx_lc" | grep -Eq \
              'described as a result|as a result|is a result|as a pass|target met|passed with uncomputable'; then
            ml_violation "uncomputable-result" \
              "$mid uncomputable placeholder described as a result/pass: $line"
          fi
        fi
        # Uncomputable satisfies companion rule (no value claimed) — skip companion.
        continue
      fi

      # Value claim without companion.
      if ml_claims_value "$ctx"; then
        if ! ml_has_companion "$mid" "$ctx_lc"; then
          ml_violation "companion" \
            "$mid reported without required companion in the same row/sentence: $line"
        fi
      fi

      # Comparative claim near this metric → require sigma.
      if printf '%s' "$ctx_lc" | grep -Eiq "$ML_CLAIM_RE"; then
        if [[ "$ctx_lc" != *sigma* && "$ctx_lc" != *σ* ]]; then
          ml_violation "sigma-missing" \
            "$mid comparative claim (improved/regressed/better/worse) without stated sigma: $line"
        else
          # Smaller-than-sigma: if both delta and sigma numeric present.
          # Patterns: improved 2; sigma=5 / sigma 5pp
          local sigma_raw d_num s_num
          sigma_raw="$(printf '%s' "$ctx" | grep -oiE 'sigma[[:space:]]*[=:]?[[:space:]]*[0-9]+([.][0-9]+)?' | head -1 || true)"
          if [[ -n "$sigma_raw" ]]; then
            d_num="$(printf '%s' "$ctx" | grep -oiE '(improved|regressed|delta)[[:space:]]+[+-]?[0-9]+([.][0-9]+)?' | grep -oE '[0-9]+([.][0-9]+)?' | head -1 || true)"
            if [[ -z "$d_num" ]]; then
              d_num="$(printf '%s' "$ctx" | grep -oiE '[+-][0-9]+([.][0-9]+)?[[:space:]]*(pp|%)' | grep -oE '[0-9]+([.][0-9]+)?' | head -1 || true)"
            fi
            s_num="$(printf '%s' "$sigma_raw" | grep -oE '[0-9]+([.][0-9]+)?' | head -1 || true)"
            if [[ -n "$d_num" && -n "$s_num" ]]; then
              # Compare absolute delta to sigma via awk.
              local smaller
              smaller="$(awk -v d="$d_num" -v s="$s_num" 'BEGIN { if (d+0 < s+0) print "yes"; else print "no" }')"
              if [[ "$smaller" == "yes" ]]; then
                if ! printf '%s' "$ctx_lc" | grep -Eq \
                    'not distinguishable from (measurement )?noise|indistinguishable from noise'; then
                  ml_violation "smaller-than-sigma" \
                    "$mid |delta|=$d_num < sigma=$s_num described as improvement/regression without noise language: $line"
                fi
              fi
            fi
          fi
        fi
      fi

      # Human-review flag for moves >1 sigma: advisory check — if report states
      # a move > sigma without "human review" flag, warn (still a violation in enforce).
      if [[ "$ctx_lc" == *sigma* ]] && printf '%s' "$ctx_lc" | grep -Eiq 'moved|move of|rose|fell|increased|decreased'; then
        local move_n sig_n
        move_n="$(printf '%s' "$ctx" | grep -oiE '(moved|rose|fell|increased|decreased)[[:space:]]+[0-9]+([.][0-9]+)?' | grep -oE '[0-9]+([.][0-9]+)?' | head -1 || true)"
        sig_n="$(printf '%s' "$ctx" | grep -oiE 'sigma[[:space:]]*[=:]?[[:space:]]*[0-9]+([.][0-9]+)?' | grep -oE '[0-9]+([.][0-9]+)?' | head -1 || true)"
        if [[ -n "$move_n" && -n "$sig_n" ]]; then
          local big
          big="$(awk -v m="$move_n" -v s="$sig_n" 'BEGIN { if (m+0 > s+0) print "yes"; else print "no" }')"
          if [[ "$big" == "yes" ]]; then
            if ! printf '%s' "$ctx_lc" | grep -Eq 'human review|flagged for review|review flag'; then
              ml_violation "human-review" \
                "$mid moved more than sigma without human-review flag (companion must be shown; no auto gaming label): $line"
            fi
            # Auto-classification forbidden.
            if printf '%s' "$ctx_lc" | grep -Eq 'classified as gaming|auto-classified|automatically label|is gaming'; then
              ml_violation "no-auto-gaming" \
                "$mid must not auto-classify a >sigma move as gaming or legitimate: $line"
            fi
          fi
        fi
      fi

    done <<<"$ids"
  done

  # Zero rendered for empty population style: "M7: 0 per 100" with zero starts language nearby is caught
  # by companion/value rules; also catch bare "0%" pass claims for zero-denom metrics.
  if printf '%s\n' "$text" | grep -Eiq 'zero[[:space:]]+(lane starts|gate decisions|tasks started|tasks that merged).{0,80}(0%|0 per|100%)'; then
    ml_violation "zero-denom-numeric" \
      "empty population rendered as numeric 0/0%/100% instead of uncomputable zero-denominator form"
  fi
}

# @description Print violations to stdout; return status based on mode.
ml_report() {
  local v
  if (( ${#ML_VIOLATIONS[@]} == 0 )); then
    echo "metrics-lint: OK (0 violations) mode=$ML_MODE version=$ML_VERSION"
    return 0
  fi
  echo "metrics-lint: ${#ML_VIOLATIONS[@]} violation(s) mode=$ML_MODE version=$ML_VERSION"
  for v in "${ML_VIOLATIONS[@]}"; do
    echo "  VIOLATION: $v"
  done
  if [[ "$ML_MODE" == "enforce" ]]; then
    return 1
  fi
  # shadow: report but exit 0
  echo "metrics-lint: shadow mode — violations reported, exit 0"
  return 0
}

# @description Lint a file path.
# @arg $1 path
# @exitcode 0 ok or shadow; 1 enforce with violations; 2 usage/IO
ml_lint_file() {
  local path="${1:-}"
  if [[ -z "$path" || ! -f "$path" ]]; then
    echo "metrics-lint: file not found: ${path:-<empty>}" >&2
    return 2
  fi
  local body
  body="$(ml_read_file "$path")"
  ml_lint_text "$body"
  ml_report
}

# ---------------------------------------------------------------------------
# CLI entry (only when executed, not sourced)
# ---------------------------------------------------------------------------
ml_main() {
  local report=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        ML_MODE="${2:-}"
        shift 2
        case "$ML_MODE" in
          shadow|enforce) ;;
          *) echo "metrics-lint: --mode must be shadow|enforce" >&2; return 2 ;;
        esac
        ;;
      --version)
        ML_VERSION="${2:-}"
        shift 2
        ;;
      -h|--help)
        cat <<'EOF'
Usage: metrics-lint.sh [--mode shadow|enforce] [--version VERSION] REPORT_FILE

Lint a rendered release-metrics report for claim discipline:
  companion numbers, sigma-before-claim, smaller-than-sigma,
  uncomputable-as-result, zero-denominator guards, deferred metrics,
  independence claims, fully-computed language.

Default mode: shadow (report violations, exit 0).
Enforce mode: exit non-zero when any violation is found.
Env: FOREMAN_METRICS_LINT_MODE, FOREMAN_METRICS_REPORT_VERSION, FOREMAN_REPO_ROOT
EOF
        return 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        echo "metrics-lint: unknown flag: $1" >&2
        return 2
        ;;
      *)
        report="$1"
        shift
        ;;
    esac
  done
  if [[ -z "$report" && $# -gt 0 ]]; then
    report="$1"
  fi
  if [[ -z "$report" ]]; then
    echo "metrics-lint: REPORT_FILE required" >&2
    return 2
  fi
  ml_lint_file "$report"
}

# Detect direct execution vs source.
if [[ "${BASH_SOURCE[0]:-}" == "$0" ]]; then
  ml_main "$@"
fi
