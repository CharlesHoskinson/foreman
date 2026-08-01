#!/usr/bin/env bash
# lib/gate-ground.sh — groundedness gate registry and validator canary (T1/T2).
# shellcheck shell=bash
# shellcheck disable=SC2034  # Public registry/canary state is consumed by callers.
# Source-safe: declarations only; no registry is loaded and no canary is run.
#
# Two-speed doctrine: only closed-world checks may block. Open-world checks
# warn, the model verdict is one signal among several, and that verdict is
# itself checked. An unproved promotion is refused and remains in shadow.
#
# This file intentionally contains no groundedness predicate. T3 onward supply
# gg_canary_evaluate_fixture(), then call gg_canary_run before trusting results.

GG_DEFAULT_REGISTRY="${BASH_SOURCE[0]%/lib/gate-ground.sh}/gate-ground-registry.tsv"
GG_BLOCKING_CAP=0
GG_REGISTRY_PATH=""
GG_CANARY_LAST_REASON=""

declare -ag GG_REGISTRY_IDS=()
declare -Ag GG_REGISTRY_TIER=()
declare -Ag GG_REGISTRY_WORLD=()
declare -Ag GG_REGISTRY_BLOCKING=()
declare -Ag GG_REGISTRY_MODE=()
declare -Ag GG_REGISTRY_REQUIRED_INPUTS=()
declare -Ag GG_REGISTRY_RATIONALE=()

# @description Print a named malformed-registry error.
# @arg $1 one-based physical row number
# @arg $2 detail
# @exitcode 1 always
gg_registry_malformed() {
  printf 'GG_REGISTRY_MALFORMED row=%s detail=%s\n' "$1" "$2" >&2
  return 1
}

# @description Load and validate the groundedness check registry.
# @arg $1 registry TSV path
# @exitcode 0 on success; nonzero with a named error on malformed data
gg_registry_load() {
  local path="$1" line id tier world blocking mode required_inputs rationale
  local row=0 header_seen=0 cap_seen=0 blocking_count=0 field_count

  if [[ ! -f "$path" || ! -r "$path" ]]; then
    printf 'GG_REGISTRY_UNREADABLE path=%s\n' "$path" >&2
    return 1
  fi

  GG_BLOCKING_CAP=0
  GG_REGISTRY_PATH=""
  GG_REGISTRY_IDS=()
  GG_REGISTRY_TIER=()
  GG_REGISTRY_WORLD=()
  GG_REGISTRY_BLOCKING=()
  GG_REGISTRY_MODE=()
  GG_REGISTRY_REQUIRED_INPUTS=()
  GG_REGISTRY_RATIONALE=()

  while IFS= read -r line || [[ -n "$line" ]]; do
    row=$((row + 1))
    if [[ "$line" == '# blocking_cap='* ]]; then
      if (( cap_seen != 0 )); then
        gg_registry_malformed "$row" "duplicate_blocking_cap"
        return 1
      fi
      GG_BLOCKING_CAP="${line#*=}"
      if [[ ! "$GG_BLOCKING_CAP" =~ ^(0|[1-9][0-9]*)$ ]]; then
        gg_registry_malformed "$row" "invalid_blocking_cap"
        return 1
      fi
      cap_seen=1
      continue
    fi
    [[ "$line" == '#'* || -z "$line" ]] && continue

    if (( header_seen == 0 )); then
      if [[ "$line" != $'id\ttier\tworld\tblocking\tmode\trequired_inputs\tzero_fp_rationale' ]]; then
        gg_registry_malformed "$row" "invalid_header"
        return 1
      fi
      header_seen=1
      continue
    fi

    field_count="$(awk -F '\t' '{ print NF }' <<<"$line")"
    if [[ "$field_count" != "7" ]]; then
      gg_registry_malformed "$row" "expected_7_fields_got_$field_count"
      return 1
    fi
    IFS=$'\t' read -r id tier world blocking mode required_inputs rationale <<<"$line"
    if [[ -z "$id" || -z "$tier" || -z "$world" || -z "$blocking" || \
      -z "$mode" || -z "$required_inputs" || -z "$rationale" ]]; then
      gg_registry_malformed "$row" "empty_required_field"
      return 1
    fi
    if [[ ! "$id" =~ ^[A-Za-z][A-Za-z0-9]*$ || ! "$tier" =~ ^[1-9][0-9]*$ ]]; then
      gg_registry_malformed "$row" "invalid_id_or_tier"
      return 1
    fi
    if [[ "$world" != "closed" && "$world" != "open" ]]; then
      gg_registry_malformed "$row" "invalid_world_$world"
      return 1
    fi
    if [[ "$blocking" != "0" && "$blocking" != "1" ]]; then
      gg_registry_malformed "$row" "invalid_blocking_$blocking"
      return 1
    fi
    if [[ "$mode" != "shadow" && "$mode" != "enforcing" ]]; then
      gg_registry_malformed "$row" "invalid_mode_$mode"
      return 1
    fi
    if [[ "$world" == "open" && "$blocking" == "1" ]]; then
      gg_registry_malformed "$row" "open_world_cannot_be_blocking"
      return 1
    fi
    if [[ -n "${GG_REGISTRY_WORLD[$id]+present}" ]]; then
      gg_registry_malformed "$row" "duplicate_id_$id"
      return 1
    fi

    GG_REGISTRY_IDS+=("$id")
    GG_REGISTRY_TIER["$id"]="$tier"
    GG_REGISTRY_WORLD["$id"]="$world"
    GG_REGISTRY_BLOCKING["$id"]="$blocking"
    GG_REGISTRY_MODE["$id"]="$mode"
    GG_REGISTRY_REQUIRED_INPUTS["$id"]="$required_inputs"
    GG_REGISTRY_RATIONALE["$id"]="$rationale"
    if [[ "$blocking" == "1" ]]; then
      blocking_count=$((blocking_count + 1))
    fi
  done <"$path"

  if (( cap_seen == 0 )); then
    gg_registry_malformed 1 "missing_blocking_cap"
    return 1
  fi
  if (( header_seen == 0 )); then
    gg_registry_malformed "$row" "missing_header"
    return 1
  fi
  if (( blocking_count > GG_BLOCKING_CAP )); then
    printf 'GG_REGISTRY_BLOCKING_CAP_EXCEEDED cap=%s actual=%s\n' \
      "$GG_BLOCKING_CAP" "$blocking_count" >&2
    return 1
  fi

  GG_REGISTRY_PATH="$path"
  return 0
}

# @description Refuse an open-world check configured as enforcing.
# @arg $1 registered check id
# @exitcode 0 if configuration is honourable; nonzero with a named error otherwise
gg_refuse_open_enforcing() {
  local id="$1"
  if [[ -z "${GG_REGISTRY_WORLD[$id]+present}" ]]; then
    printf 'GG_UNKNOWN_CHECK check=%s\n' "$id" >&2
    return 2
  fi
  if [[ "${GG_REGISTRY_WORLD[$id]}" == "open" && \
    "${GG_REGISTRY_MODE[$id]}" == "enforcing" ]]; then
    printf 'GG_REFUSE_OPEN_ENFORCING check=%s world=open configured_mode=enforcing\n' \
      "$id" >&2
    return 1
  fi
  return 0
}

# @description Echo the effective mode after both T1 refusals.
# A future promotion-record implementation may provide the callback
# gg_promotion_record_exists ID. Until then no promotion is provable.
# @arg $1 registered check id
# @stdout shadow or enforcing
# @exitcode nonzero when an open-world enforcing configuration is refused
gg_check_mode() {
  local id="$1" configured
  gg_refuse_open_enforcing "$id" || return $?
  configured="${GG_REGISTRY_MODE[$id]}"
  if [[ "$configured" == "enforcing" ]]; then
    if declare -F gg_promotion_record_exists >/dev/null 2>&1 && \
      gg_promotion_record_exists "$id"; then
      printf 'enforcing\n'
      return 0
    fi
    printf 'GG_REFUSE_NO_PROMOTION check=%s configured_mode=enforcing effective_mode=shadow\n' \
      "$id" >&2
  fi
  printf 'shadow\n'
  return 0
}

# @description Print a wall-clock timestamp in integer milliseconds.
# @stdout epoch milliseconds
gg_now_ms() {
  local now seconds
  now="$(date +%s%N 2>/dev/null || true)"
  if [[ "$now" =~ ^[0-9]{11,}$ ]]; then
    printf '%s\n' "$((now / 1000000))"
    return 0
  fi
  seconds="$(date +%s)"
  printf '%s\n' "$((seconds * 1000))"
}

# @description Emit a distinct fail-closed canary result.
# @arg $1 reason token
# @arg $2 start timestamp in milliseconds
# @arg $@ optional key=value details
# @exitcode 1 always
gg_canary_unverified() {
  local reason="$1" start_ms="$2" end_ms elapsed detail
  shift 2
  end_ms="$(gg_now_ms)"
  elapsed=$((end_ms - start_ms))
  (( elapsed < 0 )) && elapsed=0
  GG_CANARY_LAST_REASON="$reason"
  detail="$*"
  printf 'UNVERIFIED reason=%s' "$reason"
  [[ -n "$detail" ]] && printf ' %s' "$detail"
  printf ' elapsed_ms=%s\n' "$elapsed"
  return 1
}

# @description Validate the core artifact shape consumed by future checks.
# @arg $1 fixture JSON path
# @exitcode 0 if the fixture has the parsed audit-artifact shape
gg_canary_shape_valid() {
  local fixture="$1"
  jq -e '
    type == "object"
    and (.verdict == "APPROVED" or .verdict == "WARNING" or .verdict == "BLOCKED")
    and (.summary | type == "string")
    and (.findings | type == "array")
    and all(.findings[];
      type == "object"
      and (.severity == "critical" or .severity == "high"
        or .severity == "medium" or .severity == "low")
      and (.file | type == "string")
      and (.line | type == "number" and . == floor)
      and (.summary | type == "string")
      and (.evidence | type == "string"))
  ' "$fixture" >/dev/null 2>&1
}

# @description Probe whether the current process can enumerate a corpus.
# Tests may override this function to exercise the unreadable branch without
# chmod controls that are void when the suite runs as root.
# @arg $1 corpus directory
# @exitcode 0 when the directory is readable and enumerable
gg_canary_corpus_readable() {
  local corpus="$1"
  [[ -d "$corpus" && -r "$corpus" ]] || return 1
  find "$corpus" -maxdepth 1 -type f -print >/dev/null 2>&1
}

# @description Run every registered canary mutant and compare exact count/focus.
# The caller must define gg_canary_evaluate_fixture FIXTURE, which writes one
# check<TAB>focus row per observed violation. This separation lets T2 ship the
# fail-closed harness before T3 supplies any real groundedness check.
# @arg $1 canary corpus directory
# @stdout CANARY_OK with elapsed_ms, or UNVERIFIED with a distinct reason
# @exitcode 0 only when every fixture produces its declared count and focus
gg_canary_run() {
  local corpus="$1" start_ms end_ms elapsed expected_total actual_total
  local fixture sidecar id expected_count expected_rows actual_output actual_count
  local expected_pairs actual_pairs check_name expected_focus actual_focus
  start_ms="$(gg_now_ms)"
  GG_CANARY_LAST_REASON=""

  if (( ${#GG_REGISTRY_IDS[@]} == 0 )); then
    if ! gg_registry_load "$GG_DEFAULT_REGISTRY"; then
      gg_canary_unverified "canary_registry_invalid" "$start_ms"
      return 1
    fi
  fi
  if ! gg_canary_corpus_readable "$corpus"; then
    gg_canary_unverified "canary_unreadable" "$start_ms" "corpus=$corpus"
    return 1
  fi
  if ! declare -F gg_canary_evaluate_fixture >/dev/null 2>&1; then
    gg_canary_unverified "canary_evaluator_missing" "$start_ms"
    return 1
  fi

  expected_total=$((${#GG_REGISTRY_IDS[@]} + 1))
  actual_total="$(find "$corpus" -maxdepth 1 -type f -name '*.json' -print | wc -l | tr -d '[:space:]')"
  if (( actual_total < expected_total )); then
    gg_canary_unverified "canary_short" "$start_ms" \
      "expected_fixtures=$expected_total actual_fixtures=$actual_total"
    return 1
  fi
  if (( actual_total > expected_total )); then
    gg_canary_unverified "canary_undeclared_fixture" "$start_ms" \
      "expected_fixtures=$expected_total actual_fixtures=$actual_total"
    return 1
  fi

  for id in baseline "${GG_REGISTRY_IDS[@]}"; do
    fixture="$corpus/$id.json"
    sidecar="$corpus/$id.expected.tsv"
    if [[ ! -f "$fixture" || ! -f "$sidecar" ]]; then
      gg_canary_unverified "canary_short" "$start_ms" "missing_fixture=$id"
      return 1
    fi
    if [[ ! -r "$fixture" || ! -r "$sidecar" ]]; then
      gg_canary_unverified "canary_unreadable" "$start_ms" "fixture=$id"
      return 1
    fi
    if ! gg_canary_shape_valid "$fixture"; then
      gg_canary_unverified "canary_shape_mismatch" "$start_ms" "fixture=$id"
      return 1
    fi

    if ! expected_count="$(awk -F '\t' '
      $1 == "expected_count" { count++; value=$2 }
      END { if (count != 1 || value !~ /^[0-9]+$/) exit 1; print value }
    ' "$sidecar")"; then
      gg_canary_unverified "canary_expectation_invalid" "$start_ms" "fixture=$id"
      return 1
    fi
    expected_rows="$(awk -F '\t' '$1 == "expected_violation" { count++ } END { print count+0 }' "$sidecar")"
    if [[ "$expected_count" != "$expected_rows" ]]; then
      gg_canary_unverified "canary_expectation_invalid" "$start_ms" \
        "fixture=$id expected_count=$expected_count focus_rows=$expected_rows"
      return 1
    fi
    if ! awk -F '\t' '
      $1 == "expected_count" { next }
      $1 == "expected_violation" && NF == 3 && $2 != "" && $3 != "" { next }
      { exit 1 }
    ' "$sidecar"; then
      gg_canary_unverified "canary_expectation_invalid" "$start_ms" "fixture=$id"
      return 1
    fi

    if ! actual_output="$(gg_canary_evaluate_fixture "$fixture")"; then
      gg_canary_unverified "canary_evaluator_error" "$start_ms" "fixture=$id"
      return 1
    fi
    if [[ -n "$actual_output" ]] && ! awk -F '\t' \
      'NF != 2 || $1 == "" || $2 == "" { exit 1 }' <<<"$actual_output"; then
      gg_canary_unverified "canary_result_invalid" "$start_ms" "fixture=$id"
      return 1
    fi
    if [[ -z "$actual_output" ]]; then
      actual_count=0
      actual_pairs=""
    else
      actual_count="$(awk 'NF { count++ } END { print count+0 }' <<<"$actual_output")"
      actual_pairs="$(LC_ALL=C sort <<<"$actual_output")"
    fi
    expected_pairs="$(awk -F '\t' '$1 == "expected_violation" { print $2 "\t" $3 }' \
      "$sidecar" | LC_ALL=C sort)"
    if [[ "$actual_count" != "$expected_count" || "$actual_pairs" != "$expected_pairs" ]]; then
      check_name="$(awk -F '\t' '$1 == "expected_violation" { print $2; exit }' "$sidecar")"
      [[ -z "$check_name" ]] && check_name="$id"
      expected_focus="$(awk -F '\t' '$1 == "expected_violation" { print $3; exit }' "$sidecar")"
      actual_focus="$(awk -F '\t' 'NF == 2 { print $2; exit }' <<<"$actual_output")"
      [[ -z "$expected_focus" ]] && expected_focus="-"
      [[ -z "$actual_focus" ]] && actual_focus="-"
      gg_canary_unverified "canary_result_mismatch" "$start_ms" \
        "check=$check_name expected_count=$expected_count actual_count=$actual_count expected_focus=$expected_focus actual_focus=$actual_focus"
      return 1
    fi
  done

  end_ms="$(gg_now_ms)"
  elapsed=$((end_ms - start_ms))
  (( elapsed < 0 )) && elapsed=0
  if (( elapsed >= 1000 )); then
    gg_canary_unverified "canary_cost_not_milliseconds" "$start_ms" \
      "measured_elapsed_ms=$elapsed corpus_too_large=1"
    return 1
  fi
  printf 'CANARY_OK fixtures=%s checks=%s elapsed_ms=%s\n' \
    "$expected_total" "${#GG_REGISTRY_IDS[@]}" "$elapsed"
  return 0
}
