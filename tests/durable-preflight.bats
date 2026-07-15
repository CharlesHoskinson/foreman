#!/usr/bin/env bats
setup() { SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"; source "$SCRIPTS/durable-preflight.sh"; }

@test "dp_verify reports OK for a present dependency" {
  run bash -c 'source "'"$SCRIPTS"'/durable-preflight.sh"; dp_one git "true" "hint"'
  [ "$status" -eq 0 ]; [[ "$output" == OK* ]]
}
@test "dp_one reports MISSING with the install hint when the check fails" {
  run dp_one faketool "command-that-does-not-exist-xyz --version" "scoop install faketool"
  [[ "$output" == "MISSING faketool"* ]]
  [[ "$output" == *"scoop install faketool"* ]]
}
@test "preflight exits 3 when a required dep is missing" {
  run bash "$SCRIPTS/durable-preflight.sh" --require faketool-xyz
  [ "$status" -eq 3 ]
}
@test "preflight exits 0 and lists deps when all required present" {
  run bash "$SCRIPTS/durable-preflight.sh"   # git/jq/coreutils/bash present in CI
  [ "$status" -eq 0 ]
  [[ "$output" == *"git"* ]] && [[ "$output" == *"jq"* ]]
}
@test "--json emits a machine-readable object" {
  run bash "$SCRIPTS/durable-preflight.sh" --json
  echo "$output" | jq -e '.deps | type == "array"'
}
@test "missing optional deps do not truncate the table" {
  # All six dep ids are always printed; optional misses leave exit 0
  run bash "$SCRIPTS/durable-preflight.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"git"* ]]
  [[ "$output" == *"jq"* ]]
  [[ "$output" == *"coreutils"* ]]
  [[ "$output" == *"bash"* ]]
  [[ "$output" == *"nats-server"* ]]
  [[ "$output" == *"nats-cli"* ]]
  # At least six status lines
  lines=$(printf '%s\n' "$output" | grep -cE '^(OK|MISSING) ')
  [ "$lines" -ge 6 ]
}
@test "--require rejects injection and exits 2" {
  pwned="$BATS_TEST_TMPDIR/pwned_xyz"
  run bash "$SCRIPTS/durable-preflight.sh" --require '../evil; touch '"$pwned"
  [ "$status" -eq 2 ]
  [ ! -f "$pwned" ]
}
@test "preflight ids align with manifest (coreutils, nats-cli)" {
  run bash "$SCRIPTS/durable-preflight.sh"
  [[ "$output" == *"coreutils"* ]]
  [[ "$output" == *"nats-cli"* ]]
  [[ "$output" != *" stdbuf"* ]]
  # nats-cli is the id; bare "nats " as an id line must not appear
  ! printf '%s\n' "$output" | grep -qE '^(OK|MISSING) nats( |$)'
}
