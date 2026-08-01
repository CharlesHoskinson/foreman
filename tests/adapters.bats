#!/usr/bin/env bats
# @description Hermetic contract tests for the standalone vendor adapters.
#   Vendor commands are represented only by local shims; no test reaches a
#   live CLI, authentication service, model endpoint, or network resource.

ADAPTER_DIR="$BATS_TEST_DIRNAME/../skills/foreman/scripts/adapters"
VENDORS=(grok codex agy claude)
FUNCTIONS=(
  adapter_implement_argv
  adapter_audit_argv
  adapter_home_var
  adapter_auth_probe
  adapter_result_text
  adapter_result_verdict
  adapter_caps
)

# Intentional post-T2 additions to the frozen Grok implement argv.
# Added 2026-07-31: `grok agent` defaults to a shared ~/.grok/leader.sock, so
# --no-leader prevents a lane from coupling to another lane's leader process.
GROK_INTENTIONAL_ADDITIONS=(--no-leader)

# FROZEN copy of the pre-refactor builder — reference for the equivalence test.
# Do NOT update this to match the adapters. If both change together, the test
# compares new behaviour against itself and asserts nothing while still passing.
# If an adapter's argv must genuinely change: change the adapter, leave this
# frozen, and let the test FAIL. Then declare the addition in
# GROK_INTENTIONAL_ADDITIONS above, with the date and the reason.
# Verified faithful to the real pre-refactor builder when written.
# @description Reproduce the pre-T2 grok and codex implement builders exactly.
# @arg $1 vendor grok or codex
# @arg $2 prompt_file prompt path consumed by the legacy builder
# @arg $3 workdir worker working directory
# @set LEGACY_ARGV frozen pre-T2 invocation as an indexed bash array
legacy_implement_argv() {
  local vendor="$1" prompt_file="$2" workdir="$3"
  case "$vendor" in
    grok)
      LEGACY_ARGV=(grok --prompt-file "$prompt_file"
        -m "${WC_GROK_MODEL:-grok-4.5}"
        --allow "Write" --allow "Edit"
        --output-format plain
        --cwd "$workdir")
      ;;
    codex)
      LEGACY_ARGV=(codex exec
        --sandbox workspace-write
        --skip-git-repo-check
        --output-last-message "$workdir/.foreman-last.txt"
        --model "${WC_CODEX_MODEL:-gpt-5.6-sol}"
        -c "model_reasoning_effort=${WC_CODEX_REASONING_EFFORT:-medium}"
        "$(cat "$prompt_file")")
      ;;
  esac
}

# @description Assert two named indexed arrays have identical element bytes.
# @arg $1 expected_name name of the expected array
# @arg $2 actual_name name of the actual array
assert_argv_equal() {
  local -n expected_ref="$1" actual_ref="$2"
  local i
  [ "${#actual_ref[@]}" -eq "${#expected_ref[@]}" ]
  for i in "${!expected_ref[@]}"; do
    [ "${actual_ref[i]}" = "${expected_ref[i]}" ]
  done
}

@test "each adapter double-sources standalone and defines exactly seven contract functions" {
  local vendor actual expected
  expected="$(printf '%s\n' "${FUNCTIONS[@]}" | sort)"

  for vendor in "${VENDORS[@]}"; do
    run bash -c '
      source "$1"
      source "$1"
      declare -F | awk "{print \$3}" | grep "^adapter_" | sort
    ' _ "$ADAPTER_DIR/$vendor.sh"
    [ "$status" -eq 0 ]
    actual="$output"
    [ "$actual" = "$expected" ]
  done
}

@test "grok implement argv is indexed, grants Write and Edit, and disables the leader" {
  local prompt="$BATS_TEST_TMPDIR/prompt file.md"
  printf 'implement this safely\n' >"$prompt"
  source "$ADAPTER_DIR/grok.sh"

  adapter_implement_argv grok "$prompt" "/work tree"

  [[ "$(declare -p ADAPTER_ARGV)" == "declare -a "* ]]
  [ "${ADAPTER_ARGV[0]}" = grok ]
  [ "${ADAPTER_ARGV[1]}" = --prompt-file ]
  [ "${ADAPTER_ARGV[2]}" = "$prompt" ]
  [ "${ADAPTER_ARGV[5]}" = --allow ]
  [ "${ADAPTER_ARGV[6]}" = Write ]
  [ "${ADAPTER_ARGV[7]}" = --allow ]
  [ "${ADAPTER_ARGV[8]}" = Edit ]
  [[ " ${ADAPTER_ARGV[*]} " == *" --output-format plain "* ]]
  [[ " ${ADAPTER_ARGV[*]} " == *" --cwd /work tree "* ]]
  [[ " ${ADAPTER_ARGV[*]} " == *" --no-leader "* ]]
}

@test "grok and codex implement argv match the frozen builder plus declared additions byte for byte" {
  local vendor prompt="$BATS_TEST_TMPDIR/prompt file.md"
  local -a expected
  printf 'first line\nsecond line\n\n' >"$prompt"
  WC_GROK_MODEL="grok-test-model"
  WC_CODEX_MODEL="codex-test-model"
  WC_CODEX_REASONING_EFFORT="high"
  source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/worker-cmd.sh"

  for vendor in grok codex; do
    legacy_implement_argv "$vendor" "$prompt" "/work tree"
    expected=("${LEGACY_ARGV[@]}")
    if [ "$vendor" = grok ]; then
      expected+=("${GROK_INTENTIONAL_ADDITIONS[@]}")
    fi
    source "$ADAPTER_DIR/$vendor.sh"
    adapter_implement_argv "$vendor" "$prompt" "/work tree"
    assert_argv_equal expected ADAPTER_ARGV
    [[ "$(declare -p ADAPTER_ARGV)" == "declare -a "* ]]
    wc_build_argv "$vendor" "$prompt" "/work tree"
    assert_argv_equal expected WC_ARGV
    [[ "$(declare -p WC_ARGV)" == "declare -a "* ]]
  done
}

@test "worker command compatibility shim delegates implement argv to each supported adapter" {
  local vendor prompt="$BATS_TEST_TMPDIR/prompt.md"
  local -a expected
  printf 'delegate this\n' >"$prompt"
  source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/worker-cmd.sh"

  for vendor in grok codex agy; do
    source "$ADAPTER_DIR/$vendor.sh"
    adapter_implement_argv "$vendor" "$prompt" "/work tree"
    expected=("${ADAPTER_ARGV[@]}")
    wc_build_argv "$vendor" "$prompt" "/work tree"
    assert_argv_equal expected WC_ARGV
    [[ "$(declare -p WC_ARGV)" == "declare -a "* ]]
  done
}

@test "codex implement profile passthrough accepts -p and --profile" {
  local flag prompt="$BATS_TEST_TMPDIR/prompt.md"
  local -a expected
  printf 'use repository profile\n' >"$prompt"
  source "$ADAPTER_DIR/codex.sh"

  for flag in -p --profile; do
    adapter_implement_argv codex "$prompt" "/work tree" "$flag" repo-worker
    expected=(codex exec "$flag" repo-worker
      --skip-git-repo-check
      --output-last-message "/work tree/.foreman-last.txt"
      "use repository profile")
    assert_argv_equal expected ADAPTER_ARGV
  done
}

@test "codex uses workspace-write for implement and read-only for audit" {
  local prompt="$BATS_TEST_TMPDIR/prompt.md"
  local schema="$ADAPTER_DIR/verdict.schema.json"
  local out="$BATS_TEST_TMPDIR/result.json"
  printf 'review this diff\n' >"$prompt"
  source "$ADAPTER_DIR/codex.sh"

  adapter_implement_argv codex "$prompt" "/work tree"
  [[ " ${ADAPTER_ARGV[*]} " == *" --sandbox workspace-write "* ]]
  [[ " ${ADAPTER_ARGV[*]} " != *" danger-full-access "* ]]
  [[ "${ADAPTER_ARGV[*]}" == *"review this diff"* ]]

  adapter_audit_argv codex "$prompt" "/work tree" "$schema" "$out"
  [[ " ${ADAPTER_ARGV[*]} " == *" --sandbox read-only "* ]]
  [[ " ${ADAPTER_ARGV[*]} " != *" danger-full-access "* ]]
  [[ " ${ADAPTER_ARGV[*]} " == *" --ephemeral "* ]]
  [[ " ${ADAPTER_ARGV[*]} " == *" --output-schema $schema "* ]]
  [[ " ${ADAPTER_ARGV[*]} " == *" --output-last-message $out "* ]]
  [ "${ADAPTER_ARGV[${#ADAPTER_ARGV[@]}-1]}" = - ]
}

@test "codex audit defaults to stdin prompt delivery and selects cold review by base" {
  local prompt="$BATS_TEST_TMPDIR/prompt.md"
  local schema="$ADAPTER_DIR/verdict.schema.json"
  local out="$BATS_TEST_TMPDIR/result.json"
  local -a expected
  printf 'soft-mode acceptance criteria\n' >"$prompt"
  source "$ADAPTER_DIR/codex.sh"
  ADAPTER_CODEX_AUDIT_MODEL=codex-audit-test
  ADAPTER_CODEX_AUDIT_REASONING_EFFORT=xhigh

  adapter_audit_argv codex "$prompt" "/work tree" "$schema" "$out"
  expected=(codex exec
    --model codex-audit-test
    -c model_reasoning_effort=xhigh
    --sandbox read-only
    --ephemeral
    --skip-git-repo-check
    --cd "/work tree"
    --output-schema "$schema"
    --output-last-message "$out"
    -)
  assert_argv_equal expected ADAPTER_ARGV

  adapter_audit_argv codex "$prompt" "/work tree" "$schema" "$out" review-base main
  expected=(codex exec
    --model codex-audit-test
    -c model_reasoning_effort=xhigh
    --sandbox read-only
    --ephemeral
    --skip-git-repo-check
    --cd "/work tree"
    --output-schema "$schema"
    --output-last-message "$out"
    review --base main
    -)
  assert_argv_equal expected ADAPTER_ARGV

  run adapter_audit_argv codex "$prompt" "/work tree" "$schema" "$out" review-base
  [ "$status" -eq 2 ]
  [[ "$output" == *"review-base requires BASE"* ]]
}

@test "audit runner delegates argv while preserving stdin and process control" {
  local runner="$BATS_TEST_DIRNAME/../skills/foreman/scripts/audit-run.sh"

  run grep -F 'source "$SCRIPT_DIR/adapters/codex.sh"' "$runner"
  [ "$status" -eq 0 ]
  run grep -F 'adapter_audit_argv codex "$PROMPT" "$WT" "$SCHEMA" "$AUDIT_OUT_TMP"' "$runner"
  [ "$status" -eq 0 ]
  run grep -F 'setsid "${ADAPTER_ARGV[@]}" <"$PROMPT" 2>"$AUDIT_ERR_TMP" &' "$runner"
  [ "$status" -eq 0 ]
  run grep -F 'AUDIT_CHILD_PID=$!' "$runner"
  [ "$status" -eq 0 ]
}

@test "agy uses HOME and keeps --print plus its prompt as the final two argv elements" {
  local prompt="$BATS_TEST_TMPDIR/prompt.md"
  local schema="$ADAPTER_DIR/verdict.schema.json"
  local out="$BATS_TEST_TMPDIR/result.json"
  local n
  printf 'agy prompt with spaces\n' >"$prompt"
  source "$ADAPTER_DIR/agy.sh"

  [ "$(adapter_home_var agy)" = HOME ]

  adapter_implement_argv agy "$prompt" "/work tree"
  n="${#ADAPTER_ARGV[@]}"
  [[ " ${ADAPTER_ARGV[*]} " == *" --mode accept-edits "* ]]
  [[ " ${ADAPTER_ARGV[*]} " != *" --dangerously-skip-permissions "* ]]
  [ "${ADAPTER_ARGV[n-2]}" = --print ]
  [ "${ADAPTER_ARGV[n-1]}" = "agy prompt with spaces" ]

  adapter_audit_argv agy "$prompt" "/work tree" "$schema" "$out"
  n="${#ADAPTER_ARGV[@]}"
  [ "${ADAPTER_ARGV[n-2]}" = --print ]
  [ "${ADAPTER_ARGV[n-1]}" = "agy prompt with spaces" ]
}

@test "claude exposes the interface but refuses unsupported implement and audit builders" {
  source "$ADAPTER_DIR/claude.sh"

  run adapter_implement_argv claude /prompt /work
  [ "$status" -ne 0 ]
  [[ "$output" == *"claude implement unsupported"* ]]

  run adapter_audit_argv claude /prompt /work /schema /out
  [ "$status" -ne 0 ]
  [[ "$output" == *"claude audit unsupported"* ]]
}

@test "every capability map contains the required keys and records proven limits honestly" {
  local vendor caps key
  local required=(
    resume schema sandbox cap_n rc_unavailable prompt_flag
    prompt_flag_position verified_cli_version
  )

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"
    caps="$(adapter_caps "$vendor")"
    for key in "${required[@]}"; do
      [[ "$caps" == *$'\n'"$key="* || "$caps" == "$key="* ]]
    done
  done

  source "$ADAPTER_DIR/grok.sh"
  caps="$(adapter_caps grok)"
  [[ "$caps" == *$'cap_n=3\n'* ]]
  [[ "$caps" == *'single_burst=true' ]]

  source "$ADAPTER_DIR/codex.sh"
  caps="$(adapter_caps codex)"
  [[ "$caps" == *$'cap_n=2\n'* ]]
  [[ "$caps" == *'sandbox=implement:workspace-write,audit:read-only'* ]]

  source "$ADAPTER_DIR/agy.sh"
  caps="$(adapter_caps agy)"
  [[ "$caps" == *$'cap_n=1\n'* ]]
  [[ "$caps" == *'sandbox=implement:accept-edits,audit:plan'* ]]
  [[ "$caps" == *$'isolation=partial\n'* ]]
  [[ "$caps" == *'oauth_token_isolated=false' ]]

  source "$ADAPTER_DIR/claude.sh"
  caps="$(adapter_caps claude)"
  [[ "$caps" == *$'cap_n=0\n'* ]]
  [[ "$caps" == *$'implement=false\n'* ]]
  [[ "$caps" == *$'audit=false\n'* || "$caps" == *'audit=false' ]]
}

@test "implement builders and non-codex audit builders keep stdin out of the prompt path" {
  local vendor verb item prompt="$BATS_TEST_TMPDIR/prompt.md"
  local schema="$ADAPTER_DIR/verdict.schema.json"
  local out="$BATS_TEST_TMPDIR/result.json"
  printf 'never stdin\n' >"$prompt"

  for vendor in grok codex agy; do
    source "$ADAPTER_DIR/$vendor.sh"
    for verb in implement audit; do
      if [ "$vendor:$verb" = codex:audit ]; then
        continue
      fi
      if [ "$verb" = implement ]; then
        adapter_implement_argv "$vendor" "$prompt" /work
      else
        adapter_audit_argv "$vendor" "$prompt" /work "$schema" "$out"
      fi
      [[ "$(declare -p ADAPTER_ARGV)" == "declare -a "* ]]
      for item in "${ADAPTER_ARGV[@]}"; do
        [ "$item" != - ]
      done
    done
  done
}

@test "auth probes are shimmed, positive-signal based, and never bill" {
  local shim="$BATS_TEST_TMPDIR/bin" vendor
  mkdir -p "$shim"
  for vendor in "${VENDORS[@]}"; do
    cat >"$shim/$vendor" <<'SHIM'
#!/usr/bin/env bash
case "$(basename "$0"):$*" in
  "grok:models") printf 'You are logged in with grok.com.\n' ;;
  "codex:login status") printf 'Logged in using ChatGPT\n' ;;
  "agy:models") printf 'gemini-3.1-pro-high\nclaude-sonnet-4-6\n' ;;
  "claude:auth status") printf '{"loggedIn":true}\n' ;;
  *) exit 91 ;;
esac
SHIM
    chmod +x "$shim/$vendor"
  done

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"
    PATH="$shim:$PATH" adapter_auth_probe "$vendor"
  done

  for vendor in "${VENDORS[@]}"; do
    cat >"$shim/$vendor" <<'SHIM'
#!/usr/bin/env bash
printf 'You are not authenticated.\n'
exit 0
SHIM
    chmod +x "$shim/$vendor"
    run env PATH="$shim:$PATH" bash -c 'source "$1"; adapter_auth_probe "$2"' \
      _ "$ADAPTER_DIR/$vendor.sh" "$vendor"
    [ "$status" -ne 0 ]
  done
}

@test "result extractors prefer the explicit output and reject invalid verdicts" {
  local vendor out="$BATS_TEST_TMPDIR/out" stdout="$BATS_TEST_TMPDIR/stdout"
  local stderr="$BATS_TEST_TMPDIR/stderr"
  printf 'final assistant text\n' >"$out"
  printf 'stream transcript\n' >"$stdout"
  : >"$stderr"

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"
    run adapter_result_text "$vendor" "$out" "$stdout" "$stderr"
    [ "$status" -eq 0 ]
    [ "$output" = "final assistant text" ]
  done

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"

    printf '{"verdict":"APPROVED","summary":"clean","findings":[]}\n' >"$out"
    run adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | jq -r .verdict)" = APPROVED ]

    printf '{"verdict":"UNVERIFIED","summary":"bad","findings":[]}\n' >"$out"
    run adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr"
    [ "$status" -ne 0 ]
    [[ "$output" == *"non-conforming verdict"* ]]

    printf '%s\n' \
      '{"verdict":"BLOCKED","summary":"fractional line","findings":[' \
      '{"severity":"high","file":"x.sh","line":1.5,"summary":"bad line","evidence":"fixture"}' \
      ']}' >"$out"
    run adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr"
    [ "$status" -ne 0 ]
    [[ "$output" == *"non-conforming verdict"* ]]
  done
}
