#!/usr/bin/env bash
# @description Run the Foreman Bats suite per file, enforce slice policy when
#   requested, and emit both human-readable verdicts and a machine-readable
#   TSV report. TEST_GATE_MODE defaults to enforce; set it to shadow to record
#   skip-budget, pass-baseline, and bare-skip failures affect the exit status.
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
CALLER_DIR="$PWD"
SCRIPT_PATH="$TESTS_DIR/run.sh"
BASELINE_FILE="${TEST_BASELINE_FILE:-$TESTS_DIR/baseline.tsv}"
SKIP_BUDGET_FILE="${TEST_SKIP_BUDGET_FILE:-$TESTS_DIR/skip-budget.tsv}"
SLICE_REPORT="${TEST_SLICE_REPORT:-${TMPDIR:-/tmp}/foreman-test-slices.tsv}"
GATE_MODE="${TEST_GATE_MODE:-enforce}"
BATS="${BATS:-$(command -v bats || true)}"
MUTEX_DIR=""
RUN_TMP=""
REPORT_TMP=""

# shellcheck source=tests/lib/preconditions.bash
source "$TESTS_DIR/lib/preconditions.bash"

# @description Remove only runner-owned temporary paths and fallback lock.
runner_cleanup() {
  if [[ -n "$REPORT_TMP" && -f "$REPORT_TMP" ]]; then
    rm -f -- "$REPORT_TMP"
  fi
  if [[ -n "$RUN_TMP" && -d "$RUN_TMP" ]]; then
    rm -rf -- "$RUN_TMP"
  fi
  if [[ -n "$MUTEX_DIR" && -d "$MUTEX_DIR" ]]; then
    rmdir -- "$MUTEX_DIR" 2>/dev/null || true
  fi
}
trap runner_cleanup EXIT

# @description Acquire the host-wide Bats mutex once for all per-file runs.
#   flock is preferred; Git Bash falls back to an atomic directory lock.
acquire_bats_mutex() {
  [[ "${FOREMAN_BATS_MUTEX_HELD:-0}" == 1 ]] && return 0
  if command -v flock >/dev/null 2>&1; then
    mkdir -p -- "$HOME/.foreman"
    export FOREMAN_BATS_MUTEX_HELD=1
    exec flock "$HOME/.foreman/gate.lock" bash "$SCRIPT_PATH" "$@"
  fi

  MUTEX_DIR="${TMPDIR:-/tmp}/foreman-bats-global.lock.d"
  local attempts=0
  until mkdir -- "$MUTEX_DIR" 2>/dev/null; do
    attempts=$((attempts + 1))
    if (( attempts >= 60 )); then
      printf 'ERROR Bats mutex unavailable after 60 attempts: %s\n' "$MUTEX_DIR" >&2
      return 2
    fi
    sleep 1
  done
  export FOREMAN_BATS_MUTEX_HELD=1
}

# @description Resolve a file or directory relative to the runner's caller.
# @arg $1 input path
# @stdout canonical absolute path
absolute_path() {
  local input="$1"
  local candidate
  if [[ "$input" == /* ]]; then
    candidate="$input"
  else
    candidate="$CALLER_DIR/$input"
  fi
  if [[ -d "$candidate" ]]; then
    (cd "$candidate" && pwd -P)
  else
    local parent
    parent="$(dirname "$candidate")"
    printf '%s/%s\n' "$(cd "$parent" && pwd -P)" "$(basename "$candidate")"
  fi
}

# @description Render a selected file as a stable repository-relative key.
# @arg $1 absolute file path
# @stdout repository-relative path when in-tree, otherwise the absolute path
slice_key() {
  local file="$1"
  if [[ "$file" == "$REPO_ROOT/"* ]]; then
    printf '%s\n' "${file#"$REPO_ROOT/"}"
  else
    printf '%s\n' "$file"
  fi
}

# @description Validate the committed baseline TSV header.
validate_baseline_file() {
  local header
  [[ -f "$BASELINE_FILE" ]] || {
    printf 'ERROR baseline file missing: %s\n' "$BASELINE_FILE" >&2
    return 2
  }
  IFS= read -r header <"$BASELINE_FILE"
  header="${header%$'\r'}"
  [[ "$header" == $'file\tplatform\texpected_passes' ]] || {
    printf 'ERROR baseline header must be: file<TAB>platform<TAB>expected_passes\n' >&2
    return 2
  }
}

# @description Validate the committed skip-budget TSV header.
validate_skip_budget_file() {
  local header
  [[ -f "$SKIP_BUDGET_FILE" ]] || {
    printf 'ERROR skip-budget file missing: %s\n' "$SKIP_BUDGET_FILE" >&2
    return 2
  }
  IFS= read -r header <"$SKIP_BUDGET_FILE"
  header="${header%$'\r'}"
  [[ "$header" == $'file\tplatform\tpermitted_skips' ]] || {
    printf 'ERROR skip-budget header must be: file<TAB>platform<TAB>permitted_skips\n' >&2
    return 2
  }
}

POLICY_VALUE=""
POLICY_ERROR=""

# @description Look up one exact file-and-platform pass baseline.
# @arg $1 repository-relative slice key
# @arg $2 platform id
# @set POLICY_VALUE expected pass count on success
# @set POLICY_ERROR actionable error on failure
lookup_baseline() {
  local key="$1" platform="$2"
  local -a matches=()
  POLICY_VALUE=""
  POLICY_ERROR=""
  mapfile -t matches < <(
    awk -F '\t' -v key="$key" -v platform="$platform" '
      NR > 1 {
        sub(/\r$/, "", $NF)
        if ($1 == key && $2 == platform) print $3
      }
    ' "$BASELINE_FILE"
  )
  if (( ${#matches[@]} == 0 )); then
    POLICY_ERROR="missing pass baseline for $key on $platform"
    return 1
  fi
  if (( ${#matches[@]} != 1 )); then
    POLICY_ERROR="duplicate pass baseline for $key on $platform"
    return 1
  fi
  if [[ ! "${matches[0]}" =~ ^[0-9]+$ ]]; then
    POLICY_ERROR="invalid pass baseline for $key on $platform: ${matches[0]}"
    return 1
  fi
  POLICY_VALUE="${matches[0]}"
}

# @description Look up one exact file-and-platform skip budget.
# @arg $1 repository-relative slice key
# @arg $2 platform id
# @set POLICY_VALUE permitted skip count on success
# @set POLICY_ERROR actionable error on failure
lookup_skip_budget() {
  local key="$1" platform="$2"
  local -a matches=()
  POLICY_VALUE=""
  POLICY_ERROR=""
  mapfile -t matches < <(
    awk -F '\t' -v key="$key" -v platform="$platform" '
      NR > 1 {
        sub(/\r$/, "", $NF)
        if ($1 == key && $2 == platform) print $3
      }
    ' "$SKIP_BUDGET_FILE"
  )
  if (( ${#matches[@]} == 0 )); then
    POLICY_ERROR="missing skip budget for $key on $platform"
    return 1
  fi
  if (( ${#matches[@]} != 1 )); then
    POLICY_ERROR="duplicate skip budget for $key on $platform"
    return 1
  fi
  if [[ ! "${matches[0]}" =~ ^[0-9]+$ ]]; then
    POLICY_ERROR="invalid skip budget for $key on $platform: ${matches[0]}"
    return 1
  fi
  POLICY_VALUE="${matches[0]}"
}

# @description Replace TSV-breaking characters with spaces.
# @arg $1 field text
# @stdout one-line tab-free text
tsv_field() {
  local value="$1"
  value="${value//$'\t'/ }"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

if [[ "$GATE_MODE" != shadow && "$GATE_MODE" != enforce ]]; then
  printf 'ERROR TEST_GATE_MODE must be shadow or enforce, got: %s\n' "$GATE_MODE" >&2
  exit 2
fi
if [[ -z "$BATS" ]]; then
  printf 'ERROR bats not found. Install: git clone https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core\n' >&2
  exit 2
fi
if [[ ! -x "$BATS" && ! -f "$BATS" ]]; then
  printf 'ERROR bats executable not found: %s\n' "$BATS" >&2
  exit 2
fi

validate_baseline_file || exit $?
validate_skip_budget_file || exit $?

declare -a selected_files=()
declare -a bats_args=()
for arg in "$@"; do
  candidate="$arg"
  [[ "$candidate" == /* ]] || candidate="$CALLER_DIR/$candidate"
  if [[ -f "$candidate" ]]; then
    if [[ "$candidate" != *.bats ]]; then
      printf 'ERROR selected test file is not .bats: %s\n' "$arg" >&2
      exit 2
    fi
    selected_files+=("$(absolute_path "$arg")")
  elif [[ -d "$candidate" ]]; then
    while IFS= read -r file; do
      selected_files+=("$file")
    done < <(find "$(absolute_path "$arg")" -maxdepth 1 -type f -name '*.bats' -print | sort)
  elif [[ "$arg" == *.bats ]]; then
    printf 'ERROR selected test file does not exist: %s\n' "$arg" >&2
    exit 2
  else
    case "$arg" in
      --formatter|--formatter=*)
        printf 'ERROR tests/run.sh reserves --formatter tap for sound result parsing\n' >&2
        exit 2
        ;;
    esac
    bats_args+=("$arg")
  fi
done

if (( ${#selected_files[@]} == 0 )); then
  while IFS= read -r file; do
    selected_files+=("$file")
  done < <(find "$TESTS_DIR" -maxdepth 1 -type f -name '*.bats' -print | sort)
fi
if (( ${#selected_files[@]} == 0 )); then
  printf 'ERROR no Bats files selected\n' >&2
  exit 2
fi
if [[ "${FAST:-0}" == 1 ]]; then
  bats_args+=(--filter-tags '!slow')
fi

acquire_bats_mutex "$@" || exit $?

RUN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/foreman-tests.XXXXXX")"
report_parent="$(dirname "$SLICE_REPORT")"
mkdir -p -- "$report_parent"
REPORT_TMP="$(mktemp "$report_parent/.foreman-test-slices.XXXXXX")"
printf 'file\tplatform\tpass\tfail\tskip\tbare_skip\tskip_budget\tbudget_slack\tbaseline\tpass_delta\ttest_verdict\tbudget_verdict\tbaseline_verdict\tskip_reasons\n' >"$REPORT_TMP"

_FILE_TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  _FILE_TIMEOUT_BIN=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  _FILE_TIMEOUT_BIN=gtimeout
else
  printf 'WARN timeout not found; per-file bound disabled (a wedged file can hold the host)\n' >&2
fi

platform="$(preconditions_platform)"
total_pass=0
total_fail=0
total_skip=0
total_bare=0
policy_failures=0
runner_errors=0
slice_index=0

for file in "${selected_files[@]}"; do
  slice_index=$((slice_index + 1))
  key="$(slice_key "$file")"
  tap_file="$RUN_TMP/slice-$slice_index.tap"
  # R1: bound every file. tests/decision-events.bats once hung 31 minutes on a
  # single test while holding the host-wide bats mutex, and three unrelated
  # verifications queued behind it with no output. A gate that can hang forever
  # is worse than no gate, because silence reads as progress. This converts a
  # deadlock into a failure, and a failure is actionable.
  # --kill-after: a file that ignores TERM is still killed, or the bound is
  # advisory. Absent `timeout`, run unbounded rather than refusing to run.
  if [[ -n "$_FILE_TIMEOUT_BIN" ]]; then
    "$_FILE_TIMEOUT_BIN" --kill-after=30 "${TEST_FILE_TIMEOUT_S:-600}" \
      "$BATS" --formatter tap "${bats_args[@]}" "$file" >"$tap_file" 2>&1
  else
    "$BATS" --formatter tap "${bats_args[@]}" "$file" >"$tap_file" 2>&1
  fi
  bats_status=$?

  printf '\n=== %s ===\n' "$key"
  cat "$tap_file"

  pass_count=0
  fail_count=0
  skip_count=0
  bare_count=0
  planned=-1
  skip_reasons=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^1\.\.([0-9]+)$ ]]; then
      planned="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^ok[[:space:]][0-9]+([[:space:]].*)?[[:space:]]#[[:space:]]skip([[:space:]].*)?$ ]]; then
      skip_count=$((skip_count + 1))
      reason="${line##*# skip}"
      reason="${reason#"${reason%%[![:space:]]*}"}"
      reason="${reason%"${reason##*[![:space:]]}"}"
      if [[ -z "$reason" ]]; then
        bare_count=$((bare_count + 1))
      elif [[ -z "$skip_reasons" ]]; then
        skip_reasons="$reason"
      else
        skip_reasons="$skip_reasons | $reason"
      fi
    elif [[ "$line" =~ ^ok[[:space:]][0-9]+([[:space:]].*)?$ ]]; then
      pass_count=$((pass_count + 1))
    elif [[ "$line" =~ ^not[[:space:]]ok[[:space:]][0-9]+([[:space:]].*)?$ ]]; then
      fail_count=$((fail_count + 1))
    fi
  done <"$tap_file"

  observed=$((pass_count + fail_count + skip_count))
  test_verdict=PASS
  if (( bats_status == 124 || bats_status == 137 )); then
    # 124 = timeout expiry, 137 = SIGKILL after --kill-after.
    printf 'TIMEOUT %s exceeded %ss\n' "$key" "${TEST_FILE_TIMEOUT_S:-600}" >&2
    test_verdict=TIMEOUT
    runner_errors=$((runner_errors + 1))
  fi
  if [[ "$test_verdict" == TIMEOUT ]]; then
    : # already accounted for above; do not relabel a timeout as unparsable TAP
  elif (( planned < 0 || planned != observed )); then
    printf 'ERROR unparsable TAP for %s: planned=%s observed=%s bats_exit=%s\n' \
      "$key" "$planned" "$observed" "$bats_status" >&2
    test_verdict=ERROR
    runner_errors=$((runner_errors + 1))
  elif (( bats_status != 0 && fail_count == 0 )); then
    printf 'ERROR Bats exited %s without a TAP failure for %s\n' "$bats_status" "$key" >&2
    test_verdict=ERROR
    runner_errors=$((runner_errors + 1))
  elif (( fail_count > 0 )); then
    test_verdict=FAIL
  fi

  if (( bare_count > 0 )); then
    printf 'FAIL bare skip without reason: %s count=%d\n' "$key" "$bare_count"
    test_verdict=FAIL
    policy_failures=$((policy_failures + 1))
  fi

  budget="MISSING"
  slack="UNCOMPUTABLE"
  budget_verdict=ERROR
  if lookup_skip_budget "$key" "$platform"; then
    budget="$POLICY_VALUE"
    slack=$((budget - skip_count))
    if (( skip_count > budget )); then
      printf 'FAIL skip budget: %s actual=%d budget=%d excess=%d\n' \
        "$key" "$skip_count" "$budget" "$((skip_count - budget))"
      budget_verdict=FAIL
      policy_failures=$((policy_failures + 1))
    else
      budget_verdict=PASS
    fi
  else
    printf 'ERROR %s\n' "$POLICY_ERROR"
    policy_failures=$((policy_failures + 1))
  fi

  baseline="MISSING"
  pass_delta="UNCOMPUTABLE"
  baseline_verdict=ERROR
  if lookup_baseline "$key" "$platform"; then
    baseline="$POLICY_VALUE"
    pass_delta=$((pass_count - baseline))
    if (( pass_count < baseline )); then
      printf 'FAIL pass baseline: %s actual=%d baseline=%d deficit=%d\n' \
        "$key" "$pass_count" "$baseline" "$((baseline - pass_count))"
      baseline_verdict=FAIL
      policy_failures=$((policy_failures + 1))
    else
      baseline_verdict=PASS
    fi
  else
    printf 'ERROR %s\n' "$POLICY_ERROR"
    policy_failures=$((policy_failures + 1))
  fi

  printf 'SLICE %s platform=%s pass=%d fail=%d skip=%d bare_skip=%d budget=%s slack=%s baseline=%s delta=%s test=%s budget_verdict=%s baseline_verdict=%s\n' \
    "$key" "$platform" "$pass_count" "$fail_count" "$skip_count" "$bare_count" \
    "$budget" "$slack" "$baseline" "$pass_delta" "$test_verdict" \
    "$budget_verdict" "$baseline_verdict"

  printf '%s\t%s\t%d\t%d\t%d\t%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(tsv_field "$key")" "$platform" "$pass_count" "$fail_count" "$skip_count" \
    "$bare_count" "$budget" "$slack" "$baseline" "$pass_delta" "$test_verdict" \
    "$budget_verdict" "$baseline_verdict" "$(tsv_field "${skip_reasons:--}")" \
    >>"$REPORT_TMP"

  total_pass=$((total_pass + pass_count))
  total_fail=$((total_fail + fail_count))
  total_skip=$((total_skip + skip_count))
  total_bare=$((total_bare + bare_count))
done

mv -f -- "$REPORT_TMP" "$SLICE_REPORT"
REPORT_TMP=""
[[ -s "$SLICE_REPORT" ]] || {
  printf 'ERROR machine-readable slice report missing or empty: %s\n' "$SLICE_REPORT" >&2
  exit 2
}

total_tests=$((total_pass + total_fail + total_skip))
printf '\nTOTAL pass=%d fail=%d skip=%d tests=%d bare_skip=%d platform=%s\n' \
  "$total_pass" "$total_fail" "$total_skip" "$total_tests" "$total_bare" "$platform"
printf 'REPORT %s\n' "$SLICE_REPORT"

if (( runner_errors > 0 )); then
  printf 'RESULT ERROR runner_errors=%d\n' "$runner_errors"
  exit 2
fi
if (( total_fail > 0 )); then
  printf 'RESULT FAIL test_failures=%d\n' "$total_fail"
  exit 1
fi
if (( policy_failures > 0 )); then
  if [[ "$GATE_MODE" == enforce ]]; then
    printf 'RESULT FAIL mode=enforce policy_failures=%d\n' "$policy_failures"
    exit 1
  fi
  printf 'RESULT SHADOW mode=shadow policy_failures=%d exit=0\n' "$policy_failures"
  exit 0
fi

printf 'RESULT PASS mode=%s\n' "$GATE_MODE"
