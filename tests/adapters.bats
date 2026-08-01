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

@test "grok implement argv is indexed and grants Write and Edit as separate argv values" {
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
  [[ " ${ADAPTER_ARGV[*]} " == *" --output-schema $schema "* ]]
  [[ " ${ADAPTER_ARGV[*]} " == *" --output-last-message $out "* ]]
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
  [[ "$caps" == *$'isolation=partial\n'* ]]
  [[ "$caps" == *'oauth_token_isolated=false' ]]

  source "$ADAPTER_DIR/claude.sh"
  caps="$(adapter_caps claude)"
  [[ "$caps" == *$'cap_n=0\n'* ]]
  [[ "$caps" == *$'implement=false\n'* ]]
  [[ "$caps" == *$'audit=false\n'* || "$caps" == *'audit=false' ]]
}

@test "all supported argv builders keep stdin out of the prompt path" {
  local vendor verb item prompt="$BATS_TEST_TMPDIR/prompt.md"
  local schema="$ADAPTER_DIR/verdict.schema.json"
  local out="$BATS_TEST_TMPDIR/result.json"
  printf 'never stdin\n' >"$prompt"

  for vendor in grok codex agy; do
    source "$ADAPTER_DIR/$vendor.sh"
    for verb in implement audit; do
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

  cat >"$shim/grok" <<'SHIM'
#!/usr/bin/env bash
printf 'temporary service response\n'
SHIM
  chmod +x "$shim/grok"
  source "$ADAPTER_DIR/grok.sh"
  run env PATH="$shim:$PATH" bash -c 'source "$1"; adapter_auth_probe grok' _ "$ADAPTER_DIR/grok.sh"
  [ "$status" -ne 0 ]

  cat >"$shim/agy" <<'SHIM'
#!/usr/bin/env bash
printf 'request completed\n'
SHIM
  chmod +x "$shim/agy"
  run env PATH="$shim:$PATH" bash -c 'source "$1"; adapter_auth_probe agy' _ "$ADAPTER_DIR/agy.sh"
  [ "$status" -ne 0 ]
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
