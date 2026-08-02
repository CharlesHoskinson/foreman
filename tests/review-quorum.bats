#!/usr/bin/env bats
# @description Tests for lib/review-quorum.sh — port of Council
#   evaluateAutomaticQuorum. Raw reviewer count MUST NOT satisfy diversity.
bats_require_minimum_version 1.5.0
load helpers

setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  # shellcheck source=/dev/null
  source "$SCRIPTS/lib/review-quorum.sh"
}

@test "three admissible all anthropic is QUORUM_NOT_MET domains=1" {
  json='[{"admissible":true,"failureDomain":"anthropic"},{"admissible":true,"failureDomain":"anthropic"},{"admissible":true,"failureDomain":"anthropic"}]'
  run rq_evaluate "$json"
  [ "$status" -ne 0 ]
  [ "$output" = "QUORUM_NOT_MET admissible=3 domains=1" ]
}

@test "three admissible across anthropic openai xai is QUORUM_MET" {
  json='[{"admissible":true,"failureDomain":"anthropic"},{"admissible":true,"failureDomain":"openai"},{"admissible":true,"failureDomain":"xai"}]'
  run rq_evaluate "$json"
  [ "$status" -eq 0 ]
  [ "$output" = "QUORUM_MET admissible=3 domains=3" ]
}

@test "one inadmissible plus two admissible across two families is QUORUM_NOT_MET admissible=2" {
  json='[{"admissible":false,"failureDomain":"anthropic"},{"admissible":true,"failureDomain":"openai"},{"admissible":true,"failureDomain":"xai"}]'
  run rq_evaluate "$json"
  [ "$status" -ne 0 ]
  [ "$output" = "QUORUM_NOT_MET admissible=2 domains=2" ]
}

@test "empty array is QUORUM_NOT_MET admissible=0 domains=0" {
  run rq_evaluate '[]'
  [ "$status" -ne 0 ]
  [ "$output" = "QUORUM_NOT_MET admissible=0 domains=0" ]
}

@test "admissible entries with failureDomain null do not raise the domain count" {
  # Three null domains alone contribute zero domains.
  json='[{"admissible":true,"failureDomain":null},{"admissible":true,"failureDomain":null},{"admissible":true,"failureDomain":null}]'
  run rq_evaluate "$json"
  [ "$status" -ne 0 ]
  [ "$output" = "QUORUM_NOT_MET admissible=3 domains=0" ]

  # Nulls mixed with one real family still leave domains=1.
  json='[{"admissible":true,"failureDomain":"anthropic"},{"admissible":true,"failureDomain":null},{"admissible":true,"failureDomain":null}]'
  run rq_evaluate "$json"
  [ "$status" -ne 0 ]
  [ "$output" = "QUORUM_NOT_MET admissible=3 domains=1" ]
}
