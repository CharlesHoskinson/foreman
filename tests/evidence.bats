#!/usr/bin/env bats
# @description T1 evidence-mechanism bats wrapper. The full controls live in
#   tests/probes/evidence-mechanism.sh (so they can also run outside bats).
#   Every bats invocation on this host must be gated through
#   flock /tmp/foreman-bats.lock (see AGENT_TRAPS.md).
load helpers

@test "evidence mechanism probe (all T1 controls)" {
  run bash "$BATS_TEST_DIRNAME/probes/evidence-mechanism.sh"
  echo "$output"
  [ "$status" -eq 0 ]
}

@test "evidence harness exits non-zero on injected failure" {
  run env FAIL_CASE=1 bash "$BATS_TEST_DIRNAME/probes/evidence-mechanism.sh"
  echo "$output"
  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL: FAIL_CASE"* ]]
}
