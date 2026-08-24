#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

set_release_block() {
  local action="${1:-integrate}" commit="${2:-$(git rev-parse HEAD)}"
  RELEASE_BLOCK=(
    --endstop-state-root "$FOREMAN_HOME/state"
    --endstop-contract-id root-contract
    --endstop-contract-sha "$(printf 'a%.0s' {1..64})"
    --endstop-family-sha "$(printf 'b%.0s' {1..64})"
    --endstop-child-id v040-t9-release
    --endstop-action "$action"
    --endstop-candidate-sha "$(printf 'c%.0s' {1..64})"
    --release-program v040
    --release-phase release
    --release-owner v040-release-program
    --release-repo "$REPO"
    --release-candidate-commit "$commit"
    --release-register "$REPO/coverage.toml"
    --release-evidence "$REPO/evidence.json"
  )
}

seed_pass_gate() {
  local rd="$FOREMAN_HOME/runs/$1" base diff_sha tree_sha
  mkdir -p "$rd"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/telemetry.sh"
  source "$SCRIPTS/lib/evidence.sh"
  base="$(git rev-parse HEAD)"
  diff_sha="$(tl_diff_sha256 "$REPO" "$base")"
  tree_sha="$(evidence_tree_sha256 "$REPO")"
  printf '%s\n' "{\"worktree\":\"$REPO\",\"repo_root\":\"$REPO\",\"base_sha\":\"$base\",\"lane\":\"gate\"}" > "$rd/meta.json"
  : > "$rd/hashes.txt"
  printf '1\n' > "$rd/audit-attempt.current"
  jq -cn --arg diff "$diff_sha" --arg tree "$tree_sha" \
    '{status:"pass",exit_code:0,diff_sha256:$diff,tree_sha256:$tree}' > "$rd/checks-result.json"
  jq -cn --arg diff "$diff_sha" --arg tree "$tree_sha" \
    '{verdict:"APPROVED",findings:[],state:"complete",evidence:{diff_sha256:$diff,tree_sha256:$tree,attempt:1}}' > "$rd/audit-verdict.json"
  jq -cn --arg diff "$diff_sha" --arg tree "$tree_sha" \
    '{status:"pass",diff_sha256:$diff,tree_sha256:$tree}' > "$rd/docs-check.json"
}

install_fake_node() {
  local fake_bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/node" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$POLICY_CALLS"
printf '{"_tag":"Admitted","schemaVersion":1}\n'
exit "${POLICY_EXIT:-0}"
EOF
  chmod +x "$fake_bin/node"
  export PATH="$fake_bin:$PATH"
  export POLICY_CALLS="$BATS_TEST_TMPDIR/policy-calls"
}

@test "gate-eval fails when docs-check result is absent" {
  RD="$FOREMAN_HOME/runs/run1"
  mkdir -p "$RD"
  BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$RD/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$BASE_SHA"}
EOF
  : > "$RD/hashes.txt"
  printf '{"status":"pass","exit_code":0}\n' > "$RD/checks-result.json"
  printf '{"verdict":"APPROVED"}\n' > "$RD/audit-verdict.json"

  install_fake_node
  set_release_block integrate
  run bash "$SCRIPTS/gate-eval.sh" run1 "${RELEASE_BLOCK[@]}"
  [ "$status" -ne 0 ]
  [ ! -e "$POLICY_CALLS" ]
  grep -q 'docs-check missing (fail closed)' "$RD/gate-decision.json"
}

@test "gate-eval runs release policy only after the complete general gate passes" {
  seed_pass_gate run-release
  install_fake_node
  set_release_block integrate

  run bash "$SCRIPTS/gate-eval.sh" run-release "${RELEASE_BLOCK[@]}"
  [ "$status" -eq 0 ]
  [ -f "$POLICY_CALLS" ]
  grep -qx 'check' "$POLICY_CALLS"
  jq -e '.pass == true and .release_policy_result != null' \
    "$FOREMAN_HOME/runs/run-release/gate-decision.json" >/dev/null
}

@test "gate-eval refuses a verify block after general success without running policy" {
  seed_pass_gate run-wrong-action
  install_fake_node
  set_release_block verify

  run bash "$SCRIPTS/gate-eval.sh" run-wrong-action "${RELEASE_BLOCK[@]}"
  [ "$status" -ne 0 ]
  [ ! -e "$POLICY_CALLS" ]
  grep -q 'expected integrate' "$FOREMAN_HOME/runs/run-wrong-action/gate-decision.json"
}

@test "gate-eval records compiled release-policy refusal after general success" {
  seed_pass_gate run-policy-refused
  install_fake_node
  export POLICY_EXIT=1
  set_release_block integrate

  run bash "$SCRIPTS/gate-eval.sh" run-policy-refused "${RELEASE_BLOCK[@]}"
  [ "$status" -ne 0 ]
  [ -f "$POLICY_CALLS" ]
  grep -q 'release policy refused integration' \
    "$FOREMAN_HOME/runs/run-policy-refused/gate-decision.json"
}
