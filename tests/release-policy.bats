#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

setup() {
  ADAPTER="$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/release-policy.sh"
}

release_values() {
  printf '%s\n' \
    "/state root" \
    "root-contract" \
    "$(printf 'a%.0s' {1..64})" \
    "$(printf 'b%.0s' {1..64})" \
    "v040-t9-release" \
    "integrate" \
    "$(printf 'c%.0s' {1..64})" \
    "v040" \
    "release" \
    "v040-release-program" \
    "/repo [candidate]" \
    "$(printf '1%.0s' {1..40})" \
    "/register host/coverage.toml" \
    "/authority/evidence.json"
}

@test "release-policy adapter forwards the exact fixed block and byte streams" {
  mapfile -t values < <(release_values)
  capture="$BATS_TEST_TMPDIR/argv"
  fake_bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/node" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CAPTURE"
printf 'policy-out\n'
printf 'policy-err\n' >&2
exit 7
EOF
  chmod +x "$fake_bin/node"

  CAPTURE="$capture" PATH="$fake_bin:$PATH" run --separate-stderr \
    bash "$ADAPTER" "${values[@]}"

  [ "$status" -eq 7 ]
  [ "$output" = "policy-out" ]
  [ "$stderr" = "policy-err" ]
  mapfile -t forwarded < "$capture"
  expected_artifact="$(cd "$BATS_TEST_DIRNAME/../skills/foreman" && pwd -P)/runtime/dist/release-policy.js"
  [ "${forwarded[0]}" = "$expected_artifact" ]
  [ "${forwarded[1]}" = "check" ]
  [ "${#forwarded[@]}" -eq 30 ]
  [ "${forwarded[2]}" = "--endstop-state-root" ]
  [ "${forwarded[3]}" = "${values[0]}" ]
  [ "${forwarded[22]}" = "--release-repo" ]
  [ "${forwarded[23]}" = "${values[10]}" ]
  [ "${forwarded[28]}" = "--release-evidence" ]
  [ "${forwarded[29]}" = "${values[13]}" ]
}

@test "release-policy adapter rejects missing arguments before Node" {
  run --separate-stderr bash "$ADAPTER" /state
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"invalid invocation"* ]]
}

@test "release-policy adapter fails closed when the runtime artifact is missing" {
  copied="$BATS_TEST_TMPDIR/skill/scripts/lib"
  mkdir -p "$copied"
  cp "$ADAPTER" "$copied/release-policy.sh"
  mapfile -t values < <(release_values)

  run --separate-stderr bash "$copied/release-policy.sh" "${values[@]}"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"runtime artifact missing"* ]]
}
