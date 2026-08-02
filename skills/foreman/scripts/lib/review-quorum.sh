#!/usr/bin/env bash
# Quorum over reviewer verdicts. Ported from Council's evaluateAutomaticQuorum
# (components/council/packages/domain/src/quorum.ts) so the two planes cannot
# drift on the rule that matters most: raw reviewer COUNT must not satisfy
# diversity. Three admissible reviewers from one vendor family is one failure
# domain and does not close a review.
#
# Defaults match evaluateAutomaticQuorum: minimumProposals=3, minimumDomains=2.
# A null failureDomain counts as no domain (does not raise the domain count).
# A non-integer or non-positive threshold is refused, not coerced.
#
# Usage (source this file):
#   rq_evaluate <verdicts_json> [minimumProposals] [minimumDomains]
# Prints:
#   QUORUM_MET admissible=<n> domains=<n>     (exit 0)
#   QUORUM_NOT_MET admissible=<n> domains=<n> (exit 1)
#   error on invalid threshold / JSON        (exit 2)

# @description Return 0 iff $1 is a positive safe integer (digits only, >0).
# @arg $1 threshold candidate
_rq_is_positive_int() {
  local t="${1-}"
  [[ "$t" =~ ^[1-9][0-9]*$ ]] || return 1
  # Guard absurd magnitude that would overflow bash arithmetic.
  (( t <= 2147483647 )) || return 1
  return 0
}

# @description Evaluate automatic quorum over a JSON array of verdict objects
#   with fields admissible (bool) and failureDomain (string|null).
# @arg $1 verdicts_json JSON array
# @arg $2 minimumProposals optional, default 3
# @arg $3 minimumDomains optional, default 2
# @stdout QUORUM_MET|QUORUM_NOT_MET admissible=<n> domains=<n>
# @exitcode 0 quorum met, 1 not met, 2 invalid policy or input
rq_evaluate() {
  local json="${1-}"
  local min_proposals="${2:-3}"
  local min_domains="${3:-2}"

  if [[ -z "$json" ]]; then
    printf 'rq_evaluate: verdicts_json is required\n' >&2
    return 2
  fi

  if ! _rq_is_positive_int "$min_proposals"; then
    printf 'rq_evaluate: invalid minimumProposals (non-integer or non-positive): %s\n' \
      "$min_proposals" >&2
    return 2
  fi
  if ! _rq_is_positive_int "$min_domains"; then
    printf 'rq_evaluate: invalid minimumDomains (non-integer or non-positive): %s\n' \
      "$min_domains" >&2
    return 2
  fi

  local counts
  # Count only admissible:true toward both totals. Null failureDomain is
  # dropped before unique, so it never raises the domain count.
  if ! counts="$(printf '%s' "$json" | jq -c '
      ( [.[] | select(.admissible == true)] | length ) as $a
      | ( [.[] | select(.admissible == true) | .failureDomain | select(. != null)]
          | unique | length ) as $d
      | {admissible:$a, domains:$d}
    ' 2>/dev/null)"; then
    printf 'rq_evaluate: verdicts_json is not valid JSON\n' >&2
    return 2
  fi

  local admissible domains
  admissible="$(printf '%s' "$counts" | jq -r '.admissible')"
  domains="$(printf '%s' "$counts" | jq -r '.domains')"

  if (( admissible >= min_proposals && domains >= min_domains )); then
    printf 'QUORUM_MET admissible=%s domains=%s\n' "$admissible" "$domains"
    return 0
  fi
  printf 'QUORUM_NOT_MET admissible=%s domains=%s\n' "$admissible" "$domains"
  return 1
}
