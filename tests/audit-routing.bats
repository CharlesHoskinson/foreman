#!/usr/bin/env bats
# @description Hermetic coverage for the shared cross-family auditor selector.
#   Vendor commands are local shims; no test reaches a live CLI or network.

bats_require_minimum_version 1.5.0
load helpers

LIB="$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/audit-call.sh"
COMMON="$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/common.sh"
AUDIT_RUN="$BATS_TEST_DIRNAME/../skills/foreman/scripts/audit-run.sh"

setup() {
  CONFIG="$BATS_TEST_TMPDIR/config.toml"
  SHIM="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$SHIM"
  export AC_TEST_CODEX_READY=1
  export AC_TEST_GROK_READY=1
  export AC_TEST_AGY_READY=1
  export AC_TEST_CLAUDE_READY=1
  write_vendor_shims
  PATH="$SHIM:$PATH"
  source "$COMMON"
  source "$LIB"
}

# @description Install deterministic authentication shims for all adapters.
write_vendor_shims() {
  cat >"$SHIM/codex" <<'SHIM'
#!/usr/bin/env bash
if [[ "${AC_TEST_CODEX_READY:-0}" == 1 && "${1:-} ${2:-}" == "login status" ]]; then
  printf 'Logged in using fixture credentials\n'
  exit 0
fi
printf 'Not logged in\n' >&2
exit 1
SHIM
  cat >"$SHIM/grok" <<'SHIM'
#!/usr/bin/env bash
if [[ "${AC_TEST_GROK_READY:-0}" == 1 && "${1:-}" == models ]]; then
  printf 'You are logged in with grok.com.\n'
  exit 0
fi
printf 'Not authenticated\n' >&2
exit 1
SHIM
  cat >"$SHIM/agy" <<'SHIM'
#!/usr/bin/env bash
if [[ "${AC_TEST_AGY_READY:-0}" == 1 && "${1:-}" == models ]]; then
  printf 'gemini-3.1-pro-high\nclaude-sonnet-4-6\n'
  exit 0
fi
printf 'Not authenticated\n' >&2
exit 1
SHIM
  cat >"$SHIM/claude" <<'SHIM'
#!/usr/bin/env bash
if [[ "${AC_TEST_CLAUDE_READY:-0}" == 1 && "${1:-} ${2:-}" == "auth status" ]]; then
  printf '{"loggedIn":true}\n'
  exit 0
fi
printf '{"loggedIn":false}\n' >&2
exit 1
SHIM
  chmod +x "$SHIM/codex" "$SHIM/grok" "$SHIM/agy" "$SHIM/claude"
}

# @description Run selection without a subshell so AC_* caller state survives.
# @arg $1 comma-separated worker vendors
select_auditor() {
  local workers="$1" out="$BATS_TEST_TMPDIR/selected.out"
  if ac_select_auditor "$CONFIG" "$workers" >"$out"; then
    SELECT_RC=0
  else
    SELECT_RC=$?
  fi
  SELECT_STDOUT="$(<"$out")"
}

# @description Seed the minimum host-side audit-run fixture in a throwaway repo.
setup_audit_run_fixture() {
  setup_tmp_repo
  setup_lock_trust_fixture
  AUDIT_TASK_ID="audit-routing-fixture"
  AUDIT_RD="$FOREMAN_HOME/runs/$AUDIT_TASK_ID"
  AUDIT_CODEX_MARKER="$BATS_TEST_TMPDIR/codex-executed"
  mkdir -p "$AUDIT_RD/evidence" "$REPO/.foreman"
  base_sha="$(git -C "$REPO" rev-parse HEAD)"
  cat >"$AUDIT_RD/meta.json" <<EOF
{"task_id":"$AUDIT_TASK_ID","repo_root":"$REPO","worktree":"$REPO","base_sha":"$base_sha","lane":"audit-routing"}
EOF
  : >"$AUDIT_RD/evidence/patch.diff"
}

# @description Replace the selector's codex command shim with an audit-capable
#   process that records execution and writes a valid verdict.
write_audit_codex_shim() {
  cat >"$SHIM/codex" <<'SHIM'
#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "--version" ]]; then
  printf 'codex-test 1.0\n'
  exit 0
fi
printf 'codex\n' >"$AUDIT_CODEX_MARKER"
out=""
while (($#)); do
  case "$1" in
    --output-last-message) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '{"verdict":"APPROVED","summary":"ok","findings":[]}\n' >"$out"
SHIM
  chmod +x "$SHIM/codex"
}

# @description Run audit-run with only hermetic vendor commands on PATH.
run_audit_runner() {
  run env \
    PATH="$SHIM:$PATH" \
    AUDIT_CODEX_MARKER="$AUDIT_CODEX_MARKER" \
    FOREMAN_HOME="$FOREMAN_HOME" \
    FOREMAN_TOOL_CHECK_JSON="$FOREMAN_TOOL_CHECK_JSON" \
    FOREMAN_LOCK_MANIFEST="$FOREMAN_LOCK_MANIFEST" \
    FOREMAN_LOCK_DISABLE_LOCAL_PROBE="$FOREMAN_LOCK_DISABLE_LOCAL_PROBE" \
    bash "$AUDIT_RUN" "$AUDIT_TASK_ID"
}

@test "model family follows the selected model, including gateway models" {
  [ "$(ac_model_family agy claude-opus-4-6-thinking)" = anthropic ]
  [ "$(ac_model_family agy gemini-3.1-pro-high)" = google ]
  [ "$(ac_model_family agy gpt-oss-120b-medium)" = openai ]
  [ "$(ac_model_family codex gpt-5.6-sol)" = openai ]
  [ "$(ac_model_family grok grok-4.5)" = xai ]
}

@test "unclassifiable model family is unknown" {
  [ "$(ac_model_family agy future-model-without-lineage)" = unknown ]
}

@test "configured candidates are selected in lexical adapter order" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "claude"
model = "claude-sonnet-4-6"
[audit]
vendors = ["grok", "codex"]
model_grok = "grok-4.5"
model_codex = "gpt-5.6-sol"
TOML
  select_auditor claude
  [ "$SELECT_RC" -eq 0 ]
  [ "$SELECT_STDOUT" = codex ]
  [ "$AC_AUDITOR" = codex ]
  [ "$AC_STATUS" = SELECTED ]
  [ -z "$AC_REASON" ]
}

@test "every worker arm is removed and every refusal is named" {
  cat >"$CONFIG" <<'TOML'
[worker]
model_codex = "gpt-5.6-sol"
model_grok = "grok-4.5"
[audit]
vendors = ["grok", "codex"]
model_grok = "claude-sonnet-4-6"
model_codex = "gemini-3.1-pro-high"
TOML
  select_auditor 'codex,grok'
  [ "$SELECT_RC" -ne 0 ]
  [ -z "$SELECT_STDOUT" ]
  [ -z "$AC_AUDITOR" ]
  [ "$AC_STATUS" = REFUSED ]
  [[ "$AC_REASON" == *"codex: worker vendor"* ]]
  [[ "$AC_REASON" == *"grok: worker vendor"* ]]
}

@test "gateway same-family trap is refused despite different vendor names" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "claude"
model = "claude-sonnet-4-6"
[audit]
vendor = "agy"
model = "claude-opus-4-6-thinking"
TOML
  select_auditor claude
  [ "$SELECT_RC" -ne 0 ]
  [[ "$AC_REASON" == *"agy: model family anthropic matches worker claude family anthropic"* ]]
}

@test "unknown auditor model fails closed and is named" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "grok"
model = "grok-4.5"
[audit]
vendor = "agy"
model = "future-model-without-lineage"
TOML
  select_auditor grok
  [ "$SELECT_RC" -ne 0 ]
  [[ "$AC_REASON" == *"agy: model future-model-without-lineage has unknown family"* ]]
}

@test "scalar audit vendor remains a one-candidate configuration" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "grok"
model = "grok-4.5"
[audit]
vendor = "codex"
model = "gpt-5.6-sol"
TOML
  select_auditor grok
  [ "$SELECT_RC" -eq 0 ]
  [ "$SELECT_STDOUT" = codex ]
}

@test "negative control rule 2 prints worker mutation and refuses worker vendor" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "codex"
model = "claude-sonnet-4-6"
[audit]
vendor = "codex"
model = "gpt-5.6-sol"
TOML
  mutated_workers=codex
  printf 'mutation: WORKER_VENDORS_CSV=%s\n' "$mutated_workers"
  select_auditor "$mutated_workers"
  printf 'refusal: %s\n' "$AC_REASON"
  [ "$SELECT_RC" -ne 0 ]
  [[ "$AC_REASON" == *"codex: worker vendor"* ]]
  [[ "$AC_REASON" != *"matches worker"* ]]
}

@test "negative control rule 3 prints model mutation and refuses same family" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "claude"
model = "claude-sonnet-4-6"
[audit]
vendor = "agy"
model = "claude-opus-4-6-thinking"
TOML
  mutated_model="$(toml_get "$CONFIG" audit.model)"
  printf 'mutation: audit.model=%s\n' "$mutated_model"
  select_auditor claude
  printf 'refusal: %s\n' "$AC_REASON"
  [ "$mutated_model" = claude-opus-4-6-thinking ]
  [ "$SELECT_RC" -ne 0 ]
  [[ "$AC_REASON" == *"agy: model family anthropic matches worker claude family anthropic"* ]]
}

@test "negative control rule 4 prints readiness mutation and refuses unready candidate" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "grok"
model = "grok-4.5"
[audit]
vendor = "codex"
model = "gpt-5.6-sol"
TOML
  PATH=/usr/bin:/bin
  printf 'mutation: candidate_executable=%s\n' "$(command -v codex 2>/dev/null || printf absent)"
  select_auditor grok
  printf 'refusal: %s\n' "$AC_REASON"
  [ "$(command -v codex 2>/dev/null || printf absent)" = absent ]
  [ "$SELECT_RC" -ne 0 ]
  [[ "$AC_REASON" == *"codex: not ready"* ]]
  [[ "$AC_REASON" != *"matches worker"* ]]
}

@test "codex worker selects a ready non-codex auditor" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "codex"
model = "gpt-5.6-sol"
[audit]
vendors = ["codex", "grok"]
model_codex = "gpt-5.6-sol"
model_grok = "grok-4.5"
TOML
  select_auditor codex
  printf 'worker.vendor=codex selected=%s\n' "$SELECT_STDOUT"
  [ "$SELECT_RC" -eq 0 ]
  [ "$SELECT_STDOUT" = grok ]
}

@test "same inputs select one distinct result across ten runs" {
  cat >"$CONFIG" <<'TOML'
[worker]
vendor = "claude"
model = "claude-sonnet-4-6"
[audit]
vendors = ["grok", "codex"]
model_grok = "grok-4.5"
model_codex = "gpt-5.6-sol"
TOML
  results="$BATS_TEST_TMPDIR/results"
  : >"$results"
  for _ in {1..10}; do
    select_auditor claude
    [ "$SELECT_RC" -eq 0 ]
    printf '%s\n' "$SELECT_STDOUT" >>"$results"
  done
  distinct="$(sort -u "$results" | wc -l)"
  printf 'runs=10 distinct_results=%s selected=%s\n' "$distinct" "$(head -n 1 "$results")"
  [ "$distinct" -eq 1 ]
  [ "$(<"$results")" = $'codex\ncodex\ncodex\ncodex\ncodex\ncodex\ncodex\ncodex\ncodex\ncodex' ]
}

@test "audit-run delegates its refusal decision to the shared selector" {
  run grep -F 'source "$SCRIPT_DIR/lib/audit-call.sh"' "$AUDIT_RUN"
  [ "$status" -eq 0 ]
  run grep -F 'ac_select_auditor "$CONFIG" "$WORKER_VENDOR"' "$AUDIT_RUN"
  [ "$status" -eq 0 ]
  run grep -F 'ar_fail "$EXIT_CONFIG" invalid_audit_vendor "$AC_REASON"' "$AUDIT_RUN"
  [ "$status" -eq 0 ]
  run grep -F 'AUDIT_VENDOR" == "$WORKER_VENDOR' "$AUDIT_RUN"
  [ "$status" -ne 0 ]
  run grep -F 'audit-run currently only auto-invokes Codex' "$AUDIT_RUN"
  [ "$status" -ne 0 ]
}

@test "selected non-codex auditor refuses when its invocation is not wired" {
  setup_audit_run_fixture
  write_audit_codex_shim
  cat >"$REPO/.foreman/config.toml" <<'TOML'
[worker]
vendor = "codex"
model = "gpt-5.6-sol"
[audit]
vendors = ["grok", "codex"]
model = "grok-4.5"
model_grok = "grok-4.5"
model_codex = "gpt-5.6-sol"
TOML

  run_audit_runner
  recorded_vendor="$(jq -r '.vendor' "$AUDIT_RD/audit-verdict.json")"
  recorded_reason="$(jq -r '.reason' "$AUDIT_RD/audit-verdict.json")"
  if [[ -e "$AUDIT_CODEX_MARKER" ]]; then executed=codex; else executed=none; fi
  printf 'status=%s reason=%s selected_vendor=%s executed=%s\n' \
    "$status" "$recorded_reason" "$recorded_vendor" "$executed"
  printf 'message=%s\n' "$output"

  [ "$status" -eq 3 ]
  [ "$recorded_reason" = missing_cli ]
  [ "$recorded_vendor" = grok ]
  [ "$executed" = none ]
  [[ "$output" == *"selection succeeded"* ]]
  [[ "$output" == *"invocation is not wired"* ]]
  [[ "$output" == *"grok"* ]]
}

@test "same-vendor audit selection still refuses as invalid configuration" {
  setup_audit_run_fixture
  write_audit_codex_shim
  cat >"$REPO/.foreman/config.toml" <<'TOML'
[worker]
vendor = "codex"
model = "gpt-5.6-sol"
[audit]
vendor = "codex"
model = "gpt-5.6-sol"
TOML

  run_audit_runner
  recorded_reason="$(jq -r '.reason' "$AUDIT_RD/audit-verdict.json")"
  printf 'status=%s reason=%s message=%s\n' "$status" "$recorded_reason" "$output"

  [ "$status" -eq 2 ]
  [ "$recorded_reason" = invalid_audit_vendor ]
  [[ "$output" == *"codex: worker vendor"* ]]
  [ ! -e "$AUDIT_CODEX_MARKER" ]
}

@test "ordinary codex auditor path still runs end to end" {
  setup_audit_run_fixture
  write_audit_codex_shim
  cat >"$REPO/.foreman/config.toml" <<'TOML'
[worker]
vendor = "grok"
model = "grok-4.5"
[audit]
vendor = "codex"
model = "gpt-5.6-sol"
TOML

  run_audit_runner
  recorded_vendor="$(jq -r '.vendor' "$AUDIT_RD/audit-verdict.json")"
  recorded_verdict="$(jq -r '.verdict' "$AUDIT_RD/audit-verdict.json")"
  printf 'status=%s vendor=%s verdict=%s executed=%s\n' \
    "$status" "$recorded_vendor" "$recorded_verdict" "$(<"$AUDIT_CODEX_MARKER")"

  [ "$status" -eq 0 ]
  [ "$recorded_vendor" = codex ]
  [ "$recorded_verdict" = APPROVED ]
  [ "$(<"$AUDIT_CODEX_MARKER")" = codex ]
}
