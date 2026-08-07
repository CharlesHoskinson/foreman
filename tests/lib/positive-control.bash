#!/usr/bin/env bash
# @description The helper a check uses to prove it discriminates. A check that
#   passes its known-good input tells you nothing on its own: a predicate
#   hard-wired to succeed passes that arm too. The control is only meaningful
#   when both arms run in the SAME invocation and disagree.
#
#   Failure mode this exists to catch, measured on 2026-07-28: an unanchored
#   `violation` substring predicate matched the string `[ok] No violation
#   found`, so the check reported a violation on clean output and reported one
#   on dirty output too. It classified both arms identically and was green for
#   weeks.

# @description Assert a check produces the negative answer on the known-bad arm
#   and the positive answer on the known-good arm, in the same run.
# @arg $1 check_id, matching a row in tests/positive-control-registry.tsv
# @arg $2 path to the known-bad input (the check MUST reject this)
# @arg $3 path to the known-good input (the check MUST accept this)
# @arg $@ after --, the command; the input path is appended as its last argument
# @exitcode 0 when the check discriminates
# @exitcode 1 when it does not, naming which arm misbehaved
assert_positive_control() {
  local check_id="${1:?assert_positive_control requires a check_id}"
  local known_bad="${2:?assert_positive_control requires a known-bad input}"
  local known_good="${3:?assert_positive_control requires a known-good input}"
  shift 3
  [[ "${1:-}" == "--" ]] && shift

  if [[ ! -e "$known_bad" ]]; then
    printf 'positive-control %s: known_bad_input does not exist: %s\n' \
      "$check_id" "$known_bad" >&2
    return 1
  fi
  if [[ ! -e "$known_good" ]]; then
    printf 'positive-control %s: known_good_input does not exist: %s\n' \
      "$check_id" "$known_good" >&2
    return 1
  fi

  local bad_rc good_rc
  "$@" "$known_bad" >/dev/null 2>&1
  bad_rc=$?
  "$@" "$known_good" >/dev/null 2>&1
  good_rc=$?

  # The discrimination property first: a check that answers both arms the same
  # way is rejected even when one arm happens to carry the expected code.
  if [[ "$bad_rc" -eq "$good_rc" ]]; then
    printf 'positive-control %s: DOES NOT DISCRIMINATE -- known-bad and known-good both exited %d\n' \
      "$check_id" "$bad_rc" >&2
    return 1
  fi
  if [[ "$bad_rc" -eq 0 ]]; then
    printf 'positive-control %s: accepted the known-bad input (exit 0): %s\n' \
      "$check_id" "$known_bad" >&2
    return 1
  fi
  if [[ "$good_rc" -ne 0 ]]; then
    printf 'positive-control %s: rejected the known-good input (exit %d): %s\n' \
      "$check_id" "$good_rc" "$known_good" >&2
    return 1
  fi
  return 0
}

# @description Same contract, but the check is judged on an anchored outcome
#   token in its OUTPUT rather than on its exit status. Use this wherever a
#   script reports a verdict and exits 0 regardless -- an exit-code control
#   over such a check is itself vacuous.
# @arg $1 check_id
# @arg $2 path to the known-bad input
# @arg $3 path to the known-good input
# @arg $4 anchored token that MUST appear for the known-bad arm
# @arg $5 anchored token that MUST appear for the known-good arm
# @arg $@ after --, the command; the input path is appended
assert_positive_control_token() {
  local check_id="${1:?}" known_bad="${2:?}" known_good="${3:?}"
  local bad_token="${4:?}" good_token="${5:?}"
  shift 5
  [[ "${1:-}" == "--" ]] && shift

  local bad_out good_out
  bad_out="$("$@" "$known_bad" 2>&1)"
  good_out="$("$@" "$known_good" 2>&1)"

  if [[ "$bad_out" == "$good_out" ]]; then
    printf 'positive-control %s: DOES NOT DISCRIMINATE -- identical output on both arms\n' \
      "$check_id" >&2
    return 1
  fi
  if ! grep -qF -- "$bad_token" <<<"$bad_out"; then
    printf 'positive-control %s: known-bad arm did not emit %s\n' "$check_id" "$bad_token" >&2
    return 1
  fi
  if ! grep -qF -- "$good_token" <<<"$good_out"; then
    printf 'positive-control %s: known-good arm did not emit %s\n' "$check_id" "$good_token" >&2
    return 1
  fi
  return 0
}
