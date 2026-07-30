#!/usr/bin/env bats
# @description three-outcome-verdicts audit artifact, timeout, attempt, and
# evidence-tree identity coverage. Run only through the host-wide Bats flock.
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  setup_lock_trust_fixture

  AUDIT_RUN="${AUDIT_RUN_UNDER_TEST:-$SCRIPTS/audit-run.sh}"
  GATE_EVAL="${GATE_EVAL_UNDER_TEST:-$SCRIPTS/gate-eval.sh}"
  TASK_ID="audit-fixture"
  RD="$FOREMAN_HOME/runs/$TASK_ID"
  SHIM="$BATS_TEST_TMPDIR/fake-bin"
  mkdir -p "$RD/evidence" "$SHIM" "$REPO/.foreman"

  BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
  cat >"$RD/meta.json" <<EOF
{"task_id":"$TASK_ID","repo_root":"$REPO","worktree":"$REPO","base_sha":"$BASE_SHA","lane":"audit-lane"}
EOF
  : >"$RD/evidence/patch.diff"
  write_config 1 3
  write_fake_codex

  export FAKE_CODEX_MODE=approved
  export FAKE_CODEX_WT="$REPO"
  export FAKE_CODEX_PID_FILE="$BATS_TEST_TMPDIR/fake-codex.pid"
  export FAKE_CODEX_MARKER="$BATS_TEST_TMPDIR/fake-codex.marker"
}

# @description Seed all three gate inputs with current diff/tree identities.
# @arg $1 verdict APPROVED|WARNING|BLOCKED|UNVERIFIED
# @arg $2 state complete|in_progress
# @arg $3 reason optional UNVERIFIED reason
# @arg $4 severity optional single finding severity
# @arg $5 summary optional single finding summary
seed_gate_fixture() {
  local verdict="$1" state="${2:-complete}" reason="${3:-}"
  local severity="${4:-}" summary="${5:-}"
  local patch="$BATS_TEST_TMPDIR/gate-current.diff"

  if ! declare -F die >/dev/null 2>&1; then
    source "$SCRIPTS/lib/common.sh"
  fi
  if ! declare -F evidence_tree_sha256 >/dev/null 2>&1; then
    source "$SCRIPTS/lib/evidence.sh"
  fi

  GATE_TASK_ID="gate-fixture"
  GATE_RD="$FOREMAN_HOME/runs/$GATE_TASK_ID"
  mkdir -p "$GATE_RD"
  git -c core.hooksPath= -C "$REPO" diff "$BASE_SHA...HEAD" >"$patch"
  GATE_DIFF_SHA="$(sha256sum "$patch" | awk '{print $1}')"
  GATE_TREE_SHA="$(evidence_tree_sha256 "$REPO")"
  GATE_ATTEMPT=7

  jq -cn \
    --arg worktree "$REPO" \
    --arg repo_root "$REPO" \
    --arg base_sha "$BASE_SHA" \
    '{worktree:$worktree, repo_root:$repo_root, base_sha:$base_sha, lane:"gate-lane"}' \
    >"$GATE_RD/meta.json"
  : >"$GATE_RD/hashes.txt"
  printf '%s\n' "$GATE_ATTEMPT" >"$GATE_RD/audit-attempt.current"
  jq -cn \
    --arg diff "$GATE_DIFF_SHA" \
    --arg tree "$GATE_TREE_SHA" \
    '{status:"pass", exit_code:0, diff_sha256:$diff, tree_sha256:$tree}' \
    >"$GATE_RD/checks-result.json"
  jq -cn \
    --arg diff "$GATE_DIFF_SHA" \
    --arg tree "$GATE_TREE_SHA" \
    '{status:"pass", diff_sha256:$diff, tree_sha256:$tree}' \
    >"$GATE_RD/docs-check.json"
  jq -cn \
    --arg verdict "$verdict" \
    --arg state "$state" \
    --arg reason "$reason" \
    --arg severity "$severity" \
    --arg summary "$summary" \
    --arg diff "$GATE_DIFF_SHA" \
    --arg tree "$GATE_TREE_SHA" \
    --argjson attempt "$GATE_ATTEMPT" \
    '{
       verdict:$verdict,
       state:$state,
       reason:$reason,
       summary:"gate fixture",
       findings:
         (if $severity == "" then []
          else [{severity:$severity, file:"src/example.sh", line:12,
                 summary:$summary, evidence:"fixture evidence"}] end),
       evidence:{
         diff_sha256:$diff,
         tree_sha256:$tree,
         base_sha:"lineage-only",
         head_sha:"lineage-only",
         attempt:$attempt
       }
     }' >"$GATE_RD/audit-verdict.json"
}

# @description Run the gate fixture and leave status/output in Bats variables.
run_gate() {
  run bash "$GATE_EVAL" "$GATE_TASK_ID"
}

# @description Return one recorded gate reason matching a substring.
# @arg $1 fixed substring
gate_reason_matching() {
  local needle="$1"
  jq -r --arg needle "$needle" \
    '.reasons[] | select(contains($needle))' "$GATE_RD/gate-decision.json"
}

write_config() {
  local timeout_min="$1" max_attempts="$2"
  cat >"$REPO/.foreman/config.toml" <<EOF
[worker]
vendor = "grok"
[audit]
vendor = "codex"
model = "gpt-5.6-sol"
timeout_min = $timeout_min
[limits]
round_timeout_min = 30
max_audit_attempts = $max_attempts
EOF
}

write_fake_codex() {
  cat >"$SHIM/codex" <<'FAKE'
#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "--version" ]]; then
  echo "codex-test 1.0"
  exit 0
fi

out=""
while (($#)); do
  case "$1" in
    --output-last-message) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done

case "${FAKE_CODEX_MODE:-approved}" in
  nonzero)
    exit 42
    ;;
  empty)
    exit 0
    ;;
  no_json)
    printf 'the auditor returned prose only\n' >"$out"
    ;;
  invalid_json)
    printf '{"verdict":\n' >"$out"
    ;;
  invalid_verdict)
    printf '{"verdict":"MAYBE","summary":"bad vocabulary","findings":[]}\n' >"$out"
    ;;
  mutate)
    touch "$FAKE_CODEX_WT/auditor-mutated"
    printf '{"verdict":"APPROVED","summary":"ok","findings":[]}\n' >"$out"
    ;;
  block)
    printf '%s\n' "$$" >"$FAKE_CODEX_PID_FILE"
    while :; do sleep 1; done
    ;;
  timeout)
    (
      trap '' TERM
      printf '%s\n' "$BASHPID" >"$FAKE_CODEX_PID_FILE"
      while :; do
        date +%s%N >"$FAKE_CODEX_MARKER"
        sleep 0.1
      done
    ) &
    while :; do sleep 1; done
    ;;
  finding)
    cat >"$out" <<'JSON'
{"verdict":"WARNING","summary":"one issue","findings":[{"severity":"high","file":"src/a.sh","line":17,"summary":"  Race   CONDITION!!!  ","evidence":"observed interleaving"}]}
JSON
    ;;
  approved)
    printf '{"verdict":"APPROVED","summary":"ok","findings":[]}\n' >"$out"
    ;;
  *)
    echo "unknown FAKE_CODEX_MODE=$FAKE_CODEX_MODE" >&2
    exit 98
    ;;
esac
FAKE
  chmod +x "$SHIM/codex"
}

run_audit() {
  local mode="$1"
  FAKE_CODEX_MODE="$mode" run env \
    PATH="$SHIM:$PATH" \
    FAKE_CODEX_MODE="$mode" \
    FAKE_CODEX_WT="$FAKE_CODEX_WT" \
    FAKE_CODEX_PID_FILE="$FAKE_CODEX_PID_FILE" \
    FAKE_CODEX_MARKER="$FAKE_CODEX_MARKER" \
    bash "$AUDIT_RUN" "$TASK_ID"
}

assert_unverified_reason() {
  local reason="$1"
  jq -e --arg reason "$reason" \
    '.verdict == "UNVERIFIED"
     and .state == "complete"
     and .reason == $reason
     and (.evidence.attempt | type == "number")
     and (.duration_s | type == "number")' \
    "$RD/audit-verdict.json" >/dev/null
}

wait_for_in_progress() {
  local i
  for ((i=0; i<100; i++)); do
    if [[ -s "$RD/audit-verdict.json" ]] \
      && jq -e '.verdict == "UNVERIFIED" and .state == "in_progress"' \
        "$RD/audit-verdict.json" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

stop_background_audit() {
  local runner_pid="$1" fake_pid="" pgid="" own_pgid=""
  if [[ -s "$FAKE_CODEX_PID_FILE" ]]; then
    fake_pid="$(<"$FAKE_CODEX_PID_FILE")"
    pgid="$(ps -o pgid= -p "$fake_pid" 2>/dev/null | tr -d ' ' || true)"
    own_pgid="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ' || true)"
    if [[ -n "$pgid" && "$pgid" != "$own_pgid" ]]; then
      kill -TERM -- "-$pgid" 2>/dev/null || true
      sleep 0.1
      kill -KILL -- "-$pgid" 2>/dev/null || true
    elif [[ -n "$fake_pid" ]]; then
      kill -TERM "$fake_pid" 2>/dev/null || true
    fi
  fi
  kill -TERM "$runner_pid" 2>/dev/null || true
  wait "$runner_pid" 2>/dev/null || true
}

@test "non-zero codex exit writes complete UNVERIFIED artifact" {
  run_audit nonzero
  [ "$status" -ne 0 ]
  assert_unverified_reason nonzero_exit
}

@test "timeout kills the whole audit process group and records timeout" {
  # 0.02 minutes = 1.2 seconds; the production wrapper adds a short kill grace.
  write_config 0.02 3
  run_audit timeout
  [ "$status" -ne 0 ]
  assert_unverified_reason timeout
  [ -s "$FAKE_CODEX_PID_FILE" ]
  child_pid="$(<"$FAKE_CODEX_PID_FILE")"
  for _ in {1..30}; do
    ps -p "$child_pid" -o pid= >/dev/null 2>&1 || break
    sleep 0.1
  done
  ! ps -p "$child_pid" -o pid= >/dev/null 2>&1
}

@test "empty codex output writes complete UNVERIFIED artifact" {
  run_audit empty
  [ "$status" -ne 0 ]
  assert_unverified_reason empty_output
}

@test "output with no JSON object writes complete UNVERIFIED artifact" {
  run_audit no_json
  [ "$status" -ne 0 ]
  assert_unverified_reason no_json_object
}

@test "malformed JSON object writes no_json_object UNVERIFIED artifact" {
  run_audit invalid_json
  [ "$status" -ne 0 ]
  assert_unverified_reason no_json_object
}

@test "out-of-vocabulary verdict writes complete UNVERIFIED artifact" {
  run_audit invalid_verdict
  [ "$status" -ne 0 ]
  assert_unverified_reason invalid_verdict_value
}

@test "auditor worktree mutation writes complete UNVERIFIED artifact" {
  run_audit mutate
  [ "$status" -ne 0 ]
  assert_unverified_reason worktree_mutation
}

@test "missing codex CLI writes missing_cli artifact and exits with missing-CLI status" {
  local no_codex_bin="$BATS_TEST_TMPDIR/no-codex-bin"
  mkdir -p "$no_codex_bin"
  ln -s "$(type -P jq)" "$no_codex_bin/jq"
  run env \
    PATH="$no_codex_bin:/usr/bin:/bin" \
    FOREMAN_HOME="$FOREMAN_HOME" \
    FOREMAN_TOOL_CHECK_JSON="$FOREMAN_TOOL_CHECK_JSON" \
    FOREMAN_LOCK_MANIFEST="$FOREMAN_LOCK_MANIFEST" \
    FOREMAN_LOCK_DISABLE_LOCAL_PROBE="$FOREMAN_LOCK_DISABLE_LOCAL_PROBE" \
    bash "$AUDIT_RUN" "$TASK_ID"
  [ "$status" -eq 3 ]
  assert_unverified_reason missing_cli
}

@test "current UNVERIFIED in_progress attempt is published before codex finishes" {
  FAKE_CODEX_MODE=block PATH="$SHIM:$PATH" \
    bash "$AUDIT_RUN" "$TASK_ID" >"$BATS_TEST_TMPDIR/audit.log" 2>&1 &
  runner_pid=$!
  wait_for_in_progress
  attempt="$(jq -r '.evidence.attempt' "$RD/audit-verdict.json")"
  [ "$attempt" -ge 1 ]
  before="$(sha256sum "$RD/audit-verdict.json" | awk '{print $1}')"
  stop_background_audit "$runner_pid"
  after="$(sha256sum "$RD/audit-verdict.json" | awk '{print $1}')"
  [ "$after" = "$before" ]
  jq -e --argjson attempt "$attempt" \
    '.verdict == "UNVERIFIED"
     and .state == "in_progress"
     and .evidence.attempt == $attempt' \
    "$RD/audit-verdict.json" >/dev/null
}

@test "fresh in-progress publish replaces a stale APPROVED verdict" {
  cat >"$RD/audit-verdict.json" <<'JSON'
{"verdict":"APPROVED","state":"complete","evidence":{"diff_sha256":"old","tree_sha256":"old","base_sha":"old","head_sha":"old","attempt":99}}
JSON
  FAKE_CODEX_MODE=block PATH="$SHIM:$PATH" \
    bash "$AUDIT_RUN" "$TASK_ID" >"$BATS_TEST_TMPDIR/audit-stale.log" 2>&1 &
  runner_pid=$!
  wait_for_in_progress
  jq -e \
    '.verdict == "UNVERIFIED"
     and .state == "in_progress"
     and .evidence.attempt != 99' \
    "$RD/audit-verdict.json" >/dev/null
  stop_background_audit "$runner_pid"
}

@test "artifact finding id is byte-identical to tl_finding_id" {
  source "$SCRIPTS/lib/telemetry.sh"
  expected="$(tl_finding_id "src/a.sh" 17 high "  Race   CONDITION!!!  ")"
  run_audit finding
  [ "$status" -eq 0 ]
  actual="$(jq -r '.findings[0].id' "$RD/audit-verdict.json")"
  [ "$actual" = "$expected" ]
  jq -e \
    '.findings[0]
     == {"severity":"high","file":"src/a.sh","line":17,
         "summary":"  Race   CONDITION!!!  ",
         "evidence":"observed interleaving",
         "id":.findings[0].id}' \
    "$RD/audit-verdict.json" >/dev/null
}

@test "consecutive UNVERIFIED attempts abandon at the cap and a real verdict resets the counter" {
  write_config 1 2
  run_audit empty
  [ "$status" -ne 0 ]
  [ "$(<"$RD/audit-attempts-unverified.count")" -eq 1 ]
  run_audit empty
  [ "$status" -ne 0 ]
  [ "$(<"$RD/audit-attempts-unverified.count")" -eq 2 ]
  jq -e \
    '.state == "Abandoned"
     and .reason == "audit_attempts_exhausted"
     and .attempts == 2' \
    "$RD/task-state.json" >/dev/null

  run_audit approved
  [ "$status" -eq 0 ]
  [ "$(<"$RD/audit-attempts-unverified.count")" -eq 0 ]
  # Abandoned is terminal: a later direct audit probe resets the consecutive
  # counter but does not erase the independently-readable terminal record.
  jq -e '.state == "Abandoned"' "$RD/task-state.json" >/dev/null
}

@test "evidence_tree_sha256 is stable and includes an untracked file" {
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/evidence.sh"
  first="$(evidence_tree_sha256 "$REPO")"
  second="$(evidence_tree_sha256 "$REPO")"
  [ "$second" = "$first" ]
  printf 'untracked\n' >"$REPO/only-untracked.txt"
  changed="$(evidence_tree_sha256 "$REPO")"
  [ "$changed" != "$first" ]
  [[ "$first" =~ ^[0-9a-f]{64}$ ]]
  [[ "$changed" =~ ^[0-9a-f]{64}$ ]]
}

@test "gate passes a complete current APPROVED verdict and current checks/docs" {
  seed_gate_fixture APPROVED complete
  run_gate
  [ "$status" -eq 0 ]
  jq -e '.pass == true and .reasons == []' "$GATE_RD/gate-decision.json" >/dev/null
}

@test "gate rejects an audit verdict bound to a different diff" {
  seed_gate_fixture APPROVED complete
  jq '.evidence.diff_sha256 = "stale-diff"' \
    "$GATE_RD/audit-verdict.json" >"$GATE_RD/audit-verdict.tmp"
  mv "$GATE_RD/audit-verdict.tmp" "$GATE_RD/audit-verdict.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "audit verdict diff hash mismatch" >/dev/null
}

@test "gate rejects an audit verdict bound to a different evaluated tree" {
  seed_gate_fixture APPROVED complete
  jq '.evidence.tree_sha256 = "stale-tree"' \
    "$GATE_RD/audit-verdict.json" >"$GATE_RD/audit-verdict.tmp"
  mv "$GATE_RD/audit-verdict.tmp" "$GATE_RD/audit-verdict.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "audit verdict evaluated-tree mismatch" >/dev/null
}

@test "gate rejects an audit verdict from a superseded attempt" {
  seed_gate_fixture APPROVED complete
  jq '.evidence.attempt = 6' \
    "$GATE_RD/audit-verdict.json" >"$GATE_RD/audit-verdict.tmp"
  mv "$GATE_RD/audit-verdict.tmp" "$GATE_RD/audit-verdict.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "audit verdict attempt superseded or unfinished" >/dev/null
}

@test "gate rejects an in-progress audit even when every identity matches" {
  seed_gate_fixture APPROVED in_progress
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "audit verdict incomplete" >/dev/null
}

@test "UNVERIFIED and BLOCKED gate reasons remain distinct" {
  seed_gate_fixture UNVERIFIED complete timeout
  run_gate
  [ "$status" -ne 0 ]
  unverified_reason="$(gate_reason_matching "audit verdict UNVERIFIED")"
  [[ "$unverified_reason" == *"timeout"* ]]

  seed_gate_fixture BLOCKED complete
  run_gate
  [ "$status" -ne 0 ]
  blocked_reason="$(gate_reason_matching "audit verdict BLOCKED")"
  [ -n "$blocked_reason" ]
  [ "$unverified_reason" != "$blocked_reason" ]
}

@test "Abandoned audit-attempt state rejects an otherwise current APPROVED verdict under permissive policy" {
  seed_gate_fixture APPROVED complete
  cat >>"$REPO/.foreman/config.toml" <<'EOF'
[audit.policy]
warning_low_resolved = "merge"
warning_medium = "merge"
blocked = "merge"
unverified = "merge"
EOF
  printf '%s\n' \
    '{"state":"Abandoned","reason":"audit_attempts_exhausted","attempts":3}' \
    >"$GATE_RD/task-state.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "Abandoned" >/dev/null
  gate_reason_matching "audit_attempts_exhausted" >/dev/null
}

@test "stale checks-result diff cannot authorize a current APPROVED verdict" {
  seed_gate_fixture APPROVED complete
  jq '.diff_sha256 = "round-n-diff"' \
    "$GATE_RD/checks-result.json" >"$GATE_RD/checks-result.tmp"
  mv "$GATE_RD/checks-result.tmp" "$GATE_RD/checks-result.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "checks-result diff hash mismatch" >/dev/null
}

@test "stale docs-check diff cannot authorize a current APPROVED verdict" {
  seed_gate_fixture APPROVED complete
  jq '.diff_sha256 = "round-n-diff"' \
    "$GATE_RD/docs-check.json" >"$GATE_RD/docs-check.tmp"
  mv "$GATE_RD/docs-check.tmp" "$GATE_RD/docs-check.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "docs-check diff hash mismatch" >/dev/null
}

@test "stale checks-result tree cannot authorize a current APPROVED verdict" {
  seed_gate_fixture APPROVED complete
  jq '.tree_sha256 = "different-tree"' \
    "$GATE_RD/checks-result.json" >"$GATE_RD/checks-result.tmp"
  mv "$GATE_RD/checks-result.tmp" "$GATE_RD/checks-result.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "checks-result evaluated-tree mismatch" >/dev/null
}

@test "stale docs-check tree cannot authorize a current APPROVED verdict" {
  seed_gate_fixture APPROVED complete
  jq '.tree_sha256 = "different-tree"' \
    "$GATE_RD/docs-check.json" >"$GATE_RD/docs-check.tmp"
  mv "$GATE_RD/docs-check.tmp" "$GATE_RD/docs-check.json"
  run_gate
  [ "$status" -ne 0 ]
  gate_reason_matching "docs-check evaluated-tree mismatch" >/dev/null
}

@test "default policy permits a low-only WARNING" {
  seed_gate_fixture WARNING complete "" low "Low residual"
  run_gate
  [ "$status" -eq 0 ]
  jq -e '.pass == true' "$GATE_RD/gate-decision.json" >/dev/null
}

@test "default policy rejects a medium WARNING and names the finding" {
  seed_gate_fixture WARNING complete "" medium "Needs a lock"
  run_gate
  [ "$status" -ne 0 ]
  reason="$(gate_reason_matching "audit WARNING unresolved finding")"
  [[ "$reason" == *"Needs a lock"* ]]
}
