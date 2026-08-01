#!/usr/bin/env bats
# @description Hermetic contract tests for the standalone vendor adapters.
#   Vendor commands are represented only by local shims; no test reaches a
#   live CLI, authentication service, model endpoint, or network resource.

bats_require_minimum_version 1.5.0

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

# @description Install version-only vendor shims for result-parser tests so no
#   live vendor binary, authentication service, or billable endpoint is used.
# @set RESULT_SHIM_DIR directory prepended to PATH by the calling test
make_result_version_shims() {
  local vendor
  RESULT_SHIM_DIR="$BATS_TEST_TMPDIR/result-version-bin"
  mkdir -p "$RESULT_SHIM_DIR"
  for vendor in "${VENDORS[@]}"; do
    cat >"$RESULT_SHIM_DIR/$vendor" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then
  printf '%s 0.0.0\n' "$(basename "$0")"
  exit 0
fi
exit 91
SHIM
    chmod +x "$RESULT_SHIM_DIR/$vendor"
  done
}

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

# @description Read one required adapter capability without treating an absent
#   key as an empty value. Duplicate declarations are also contract failures.
# @arg $1 capability map returned by adapter_caps
# @arg $2 capability key
# @stdout the capability value
# @exitcode 0 exactly one declaration; 1 missing or duplicate declaration
adapter_cap_value() {
  local caps="$1" wanted="$2" key value found=0 result=''
  while IFS='=' read -r key value; do
    if [ "$key" = "$wanted" ]; then
      found=$((found + 1))
      result="$value"
    fi
  done <<<"$caps"
  if [ "$found" -ne 1 ]; then
    printf 'adapter caps must declare %s exactly once (found %d)\n' \
      "$wanted" "$found" >&2
    return 1
  fi
  printf '%s\n' "$result"
}

# @description Install a vendor-named executable that records argv-independent
#   stdin evidence. It never delegates to a real vendor CLI.
# @arg $1 vendor executable name
# @set ADAPTER_PROBE_BIN directory to prepend to PATH
# @exitcode 0 shim created
make_adapter_invocation_shim() {
  local vendor="$1"
  ADAPTER_PROBE_BIN="$BATS_TEST_TMPDIR/invocation-bin-$vendor"
  mkdir -p "$ADAPTER_PROBE_BIN"
  cat >"$ADAPTER_PROBE_BIN/$vendor" <<'SHIM'
#!/usr/bin/env bash
stdin_target="$(readlink /proc/self/fd/0 2>/dev/null || true)"
printf '%s\n' "$stdin_target" >"$ADAPTER_PROBE_STDIN_TARGET"
cat >"$ADAPTER_PROBE_STDIN_COPY"
SHIM
  chmod +x "$ADAPTER_PROBE_BIN/$vendor"
}

# @description Run the built argv through lane-run.sh, the documented
#   production boundary that owns vendor-command stdin detachment, and assert
#   the shim actually observes /dev/null rather than inherited harness stdin.
# @arg $1 vendor id
# @arg $2 verb implement or audit
# @arg $3 stdin target report path
# @arg $4 stdin byte-copy path
# @exitcode 0 lane completed and fd 0 was /dev/null; 1 otherwise
assert_adapter_lane_null_stdin() {
  local vendor="$1" verb="$2" target_file="$3" copy_file="$4"
  local lane_run="$BATS_TEST_DIRNAME/../skills/foreman/scripts/lane-run.sh"
  local lane_home="$BATS_TEST_TMPDIR/$vendor-$verb-foreman-home"
  local lane_wt="$BATS_TEST_TMPDIR/$vendor-$verb-worktree"
  local inherited_stdin="$BATS_TEST_TMPDIR/$vendor-$verb-inherited-stdin"

  mkdir -p "$lane_wt"
  git -C "$lane_wt" init -q -b main
  git -C "$lane_wt" config user.email t6@example.com
  git -C "$lane_wt" config user.name "T6 Adapter Test"
  printf 'fixture\n' >"$lane_wt/fixture"
  git -C "$lane_wt" add fixture
  git -C "$lane_wt" commit -qm base
  printf 'INHERITED_STDIN_MUST_NOT_REACH_VENDOR\n' >"$inherited_stdin"

  run env -u LANE_VENDOR PATH="$ADAPTER_PROBE_BIN:$PATH" \
    FOREMAN_HOME="$lane_home" \
    FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/no-such-foreman-launch" \
    DURABLE_ENABLED=false DURABLE_CHECKPOINT_INTERVAL=0 \
    DURABLE_HEARTBEAT_INTERVAL=0 \
    ADAPTER_PROBE_STDIN_TARGET="$target_file" \
    ADAPTER_PROBE_STDIN_COPY="$copy_file" \
    bash "$lane_run" "t6-$vendor-$verb" lane-a "$lane_wt" -- \
    "${ADAPTER_ARGV[@]}" <"$inherited_stdin"
  [ "$status" -eq 0 ]
  [ "$(<"$target_file")" = /dev/null ]
  [ ! -s "$copy_file" ]
}

# @description Assert one supported builder's prompt carrier occurs exactly
#   once at the caps-declared position, and any stdin sentinel occupies only
#   that declared prompt slot. Then execute the argv through a shim to prove
#   its non-prompt invocation attaches stdin to /dev/null.
# @arg $1 vendor id
# @arg $2 verb implement or audit
# @exitcode 0 contract holds or unsupported verb refuses by name; 1 otherwise
assert_adapter_verb_prompt_contract() {
  local vendor="$1" verb="$2"
  local prompt_file="$BATS_TEST_TMPDIR/$vendor-$verb-prompt.md"
  local schema="$ADAPTER_DIR/verdict.schema.json"
  local out="$BATS_TEST_TMPDIR/$vendor-$verb-result.json"
  local stderr_file="$BATS_TEST_TMPDIR/$vendor-$verb-builder.stderr"
  local prompt_text="T6_PROMPT_${vendor}_${verb}_ONLY"
  local caps prompt_flag prompt_position supported rc=0
  local carrier='' carrier_index=-1 flag_count=0 carrier_count=0 dash_count=0
  local prompt_text_count=0
  local i n target_file copy_file

  printf '%s' "$prompt_text" >"$prompt_file"
  source "$ADAPTER_DIR/$vendor.sh"
  caps="$(adapter_caps "$vendor")"
  prompt_flag="$(adapter_cap_value "$caps" prompt_flag)"
  prompt_position="$(adapter_cap_value "$caps" prompt_flag_position)"

  if [ "$verb" = implement ]; then
    if adapter_implement_argv "$vendor" "$prompt_file" "/work tree" \
      2>"$stderr_file"; then
      rc=0
    else
      rc=$?
    fi
  else
    if adapter_audit_argv "$vendor" "$prompt_file" "/work tree" \
      "$schema" "$out" 2>"$stderr_file"; then
      rc=0
    else
      rc=$?
    fi
  fi

  if [ "$rc" -ne 0 ]; then
    [ "$vendor" = claude ]
    supported="$(adapter_cap_value "$caps" "$verb")"
    [ "$supported" = false ]
    [ "$prompt_flag" = unsupported ]
    [ "$prompt_position" = unsupported ]
    [ "${#ADAPTER_ARGV[@]}" -eq 0 ]
    [[ "$(<"$stderr_file")" == *"$vendor $verb unsupported"* ]]
    return 0
  fi

  if supported="$(adapter_cap_value "$caps" "$verb" 2>/dev/null)"; then
    [ "$supported" != false ]
  fi
  [[ "$(declare -p ADAPTER_ARGV)" == "declare -a "* ]]
  n="${#ADAPTER_ARGV[@]}"
  [ "$n" -gt 0 ]

  case "$prompt_position" in
    flag-value)
      [ "$prompt_flag" != positional ]
      for i in "${!ADAPTER_ARGV[@]}"; do
        if [ "${ADAPTER_ARGV[i]}" = "$prompt_flag" ]; then
          flag_count=$((flag_count + 1))
          carrier_index=$((i + 1))
        fi
      done
      [ "$flag_count" -eq 1 ]
      [ "$carrier_index" -lt "$n" ]
      carrier="${ADAPTER_ARGV[carrier_index]}"
      [ "$carrier" = "$prompt_file" ]
      ;;
    last)
      carrier_index=$((n - 1))
      carrier="${ADAPTER_ARGV[carrier_index]}"
      if [ "$prompt_flag" != positional ]; then
        [ "$n" -ge 2 ]
        [ "${ADAPTER_ARGV[n-2]}" = "$prompt_flag" ]
      else
        [ "$n" -ge 2 ]
        [[ "${ADAPTER_ARGV[n-2]}" != -* ]]
      fi
      if [ "$carrier" != - ]; then
        [ "$carrier" = "$prompt_text" ]
      fi
      ;;
    *)
      printf 'unsupported prompt_flag_position for %s %s: %s\n' \
        "$vendor" "$verb" "$prompt_position" >&2
      return 1
      ;;
  esac

  for i in "${!ADAPTER_ARGV[@]}"; do
    [ "${ADAPTER_ARGV[i]}" = "$carrier" ] && carrier_count=$((carrier_count + 1))
    [ "${ADAPTER_ARGV[i]}" = "$prompt_text" ] && \
      prompt_text_count=$((prompt_text_count + 1))
    if [ "${ADAPTER_ARGV[i]}" = - ]; then
      dash_count=$((dash_count + 1))
      [ "$verb" = audit ]
      [ "$prompt_flag" = positional ]
      [ "$prompt_position" = last ]
      [ "$i" -eq "$carrier_index" ]
    fi
  done
  [ "$carrier_count" -eq 1 ]
  if [ "$carrier" = - ]; then
    [ "$dash_count" -eq 1 ]
    [ "$prompt_text_count" -eq 0 ]
  else
    [ "$dash_count" -eq 0 ]
    if [ "$carrier" = "$prompt_text" ]; then
      [ "$prompt_text_count" -eq 1 ]
    else
      [ "$prompt_text_count" -eq 0 ]
    fi
  fi

  make_adapter_invocation_shim "$vendor"
  target_file="$BATS_TEST_TMPDIR/$vendor-$verb-stdin-target"
  copy_file="$BATS_TEST_TMPDIR/$vendor-$verb-stdin-copy"
  if [ "$carrier" = - ]; then
    run env PATH="$ADAPTER_PROBE_BIN:$PATH" \
      ADAPTER_PROBE_STDIN_TARGET="$target_file" \
      ADAPTER_PROBE_STDIN_COPY="$copy_file" \
      "${ADAPTER_ARGV[@]}" <"$prompt_file"
    [ "$status" -eq 0 ]
    cmp -s "$prompt_file" "$copy_file"
  fi

  # Redirecting lane-run.sh's vendor child from anything other than /dev/null
  # turns every supported combination red when the shim reports the real fd.
  assert_adapter_lane_null_stdin "$vendor" "$verb" "$target_file" "$copy_file"
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
  local stderr_file="$BATS_TEST_TMPDIR/stderr"
  printf 'final assistant text\n' >"$out"
  printf 'stream transcript\n' >"$stdout"
  : >"$stderr_file"
  make_result_version_shims
  PATH="$RESULT_SHIM_DIR:$PATH"

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"
    run --separate-stderr adapter_result_text "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -eq 0 ]
    [ "$output" = "final assistant text" ]
  done

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"

    printf '{"verdict":"APPROVED","summary":"clean","findings":[]}\n' >"$out"
    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | jq -r .verdict)" = APPROVED ]

    printf '{"verdict":"UNVERIFIED","summary":"bad","findings":[]}\n' >"$out"
    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"verdict.schema.json"* ]]

    printf '%s\n' \
      '{"verdict":"BLOCKED","summary":"fractional line","findings":[' \
      '{"severity":"high","file":"x.sh","line":1.5,"summary":"bad line","evidence":"fixture"}' \
      ']}' >"$out"
    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"verdict.schema.json"* ]]

    printf '%s\n' \
      '{"verdict":"APPROVED","summary":"first object","findings":[]}' \
      '{"verdict":"BLOCKED","summary":"second object","findings":[]}' >"$out"
    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"verdict.schema.json"* ]]
  done
}

@test "verdict extraction preserves the stream carrying payload or failure" {
  local vendor out="$BATS_TEST_TMPDIR/out" stdout="$BATS_TEST_TMPDIR/stdout"
  local stderr_file="$BATS_TEST_TMPDIR/stderr"
  : >"$out"
  make_result_version_shims
  PATH="$RESULT_SHIM_DIR:$PATH"

  for vendor in "${VENDORS[@]}"; do
    source "$ADAPTER_DIR/$vendor.sh"

    printf 'human transcript, not JSON\n' >"$stdout"
    printf '{"verdict":"WARNING","summary":"stderr payload","findings":[]}\n' >"$stderr_file"
    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | jq -r .summary)" = "stderr payload" ]

    : >"$stdout"
    printf '{"error":"vendor failed despite rc 0"}\n' >"$stderr_file"
    run --separate-stderr adapter_result_text "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"stderr"* ]]

    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"stderr"* ]]
    [[ "$stderr" == *"verdict.schema.json"* ]]
  done
}

@test "verdict validation consumes the colocated schema instead of a duplicated predicate" {
  local vendor fixture_dir adapter out stdout stderr_file
  out="$BATS_TEST_TMPDIR/out"
  stdout="$BATS_TEST_TMPDIR/stdout"
  stderr_file="$BATS_TEST_TMPDIR/stderr"
  printf '{"verdict":"APPROVED","summary":"would pass a duplicated validator","findings":[]}\n' >"$out"
  : >"$stdout"
  : >"$stderr_file"
  make_result_version_shims
  PATH="$RESULT_SHIM_DIR:$PATH"

  for vendor in "${VENDORS[@]}"; do
    fixture_dir="$BATS_TEST_TMPDIR/schema-$vendor"
    mkdir -p "$fixture_dir"
    adapter="$fixture_dir/$vendor.sh"
    cp "$ADAPTER_DIR/$vendor.sh" "$adapter"
    printf '%s\n' \
      '{"type":"object","required":["verdict","findings","summary"],' \
      '"properties":{"verdict":{"type":"string","enum":["BLOCKED"]},' \
      '"summary":{"type":"string"},"findings":{"type":"array","items":{"type":"object"}}},' \
      '"additionalProperties":false}' >"$fixture_dir/verdict.schema.json"

    source "$adapter"
    run --separate-stderr adapter_result_verdict "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"verdict.schema.json"* ]]
  done
}

@test "actual CLI version is recorded and drift is INFO-only" {
  local shim="$BATS_TEST_TMPDIR/version-bin" vendor
  local out="$BATS_TEST_TMPDIR/out" stdout="$BATS_TEST_TMPDIR/stdout"
  local stderr_file="$BATS_TEST_TMPDIR/stderr"
  mkdir -p "$shim"
  printf '{"verdict":"APPROVED","summary":"valid","findings":[]}\n' >"$out"
  : >"$stdout"
  : >"$stderr_file"

  for vendor in "${VENDORS[@]}"; do
    cat >"$shim/$vendor" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then
  printf '%s 99.0.0\n' "$(basename "$0")"
  exit 17
fi
exit 91
SHIM
    chmod +x "$shim/$vendor"

    run --separate-stderr env PATH="$shim:$PATH" bash -c \
      'source "$1"; adapter_result_verdict "$2" "$3" "$4" "$5"' \
      _ "$ADAPTER_DIR/$vendor.sh" "$vendor" "$out" "$stdout" "$stderr_file"
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | jq -r .verdict)" = APPROVED ]
    [[ "$stderr" == *"INFO"* ]]
    [[ "$stderr" == *"cli_version=99.0.0"* ]]
    [[ "$stderr" == *"verified_cli_version="* ]]
    [[ "$stderr" == *"mismatch"* ]]
  done
}

@test "verdict validation fails closed when the colocated schema is unavailable" {
  local vendor sandbox
  local good="$BATS_TEST_TMPDIR/good.json"
  printf '{"verdict":"APPROVED","summary":"valid","findings":[]}\n' >"$good"

  for vendor in "${VENDORS[@]}"; do
    # Copy the adapter into a sandbox. The helper resolves its schema as
    # "${BASH_SOURCE[0]%/*}/verdict.schema.json", i.e. next to the adapter file,
    # so a copy lets us remove the schema WITHOUT touching the tracked one. A
    # test that deletes a repo file and restores it strands the tree when it
    # fails midway.
    sandbox="$BATS_TEST_TMPDIR/$vendor-sandbox"
    mkdir -p "$sandbox"
    cp "$ADAPTER_DIR/$vendor.sh" "$sandbox/"
    cp "$ADAPTER_DIR/verdict.schema.json" "$sandbox/"

    # baseline: with the schema in place a valid verdict is accepted, so the
    # rejections below are attributable to the schema and nothing else
    run bash -c 'source "$1"; adapter_result_verdict "$2" "$3" /dev/null /dev/null' \
      _ "$sandbox/$vendor.sh" "$vendor" "$good"
    [ "$status" -eq 0 ]

    # schema MISSING -> must reject
    rm -f "$sandbox/verdict.schema.json"
    run bash -c 'source "$1"; adapter_result_verdict "$2" "$3" /dev/null /dev/null' \
      _ "$sandbox/$vendor.sh" "$vendor" "$good"
    [ "$status" -ne 0 ]
    [[ "$output" == *"cannot read verdict.schema.json"* ]]

    # schema UNREADABLE -> must reject. A dangling symlink is used deliberately
    # instead of chmod 000: this suite runs as root on WSL, and root bypasses
    # the mode bits, so a chmod-based control reads as readable and would assert
    # nothing while still passing.
    ln -s /nonexistent/nope.json "$sandbox/verdict.schema.json"
    run bash -c 'source "$1"; adapter_result_verdict "$2" "$3" /dev/null /dev/null' \
      _ "$sandbox/$vendor.sh" "$vendor" "$good"
    [ "$status" -ne 0 ]
    [[ "$output" == *"cannot read verdict.schema.json"* ]]
  done
}

@test "the duplicated adapter helpers stay identical across vendors" {
  local fn vendor body first
  # The adapters source nothing by design, so these helpers are copy-pasted into
  # all four files. Nothing else keeps the copies in step; this does.
  for fn in _adapter_report_cli_version _adapter_validate_verdict_file; do
    first=""
    for vendor in "${VENDORS[@]}"; do
      # normalise the vendor's own name out — the copies legitimately differ
      # only in the error strings that name the vendor
      body="$(sed -n "/^$fn()/,/^}/p" "$ADAPTER_DIR/$vendor.sh" | sed "s/\\b$vendor\\b/VENDOR/g")"
      [ -n "$body" ]
      if [ -z "$first" ]; then
        first="$body"
      else
        [ "$body" = "$first" ]
      fi
    done
  done
}

# Adding a bare `-`, duplicating the prompt path, or moving its flag/value
# pair makes this test fail before any Grok process could start.
@test "T6 grok implement prompt and null-stdin contract" {
  assert_adapter_verb_prompt_contract grok implement
}

# Appending a bare `-` or duplicating the --prompt-file carrier turns this red.
@test "T6 grok audit prompt and null-stdin contract" {
  assert_adapter_verb_prompt_contract grok audit
}

# Replacing the final positional prompt with `-` or duplicating it turns red.
@test "T6 codex implement prompt and null-stdin contract" {
  assert_adapter_verb_prompt_contract codex implement
}

# Moving Codex audit's legitimate `-` away from the caps-declared last slot,
# or adding a second stdin sentinel, turns this red without hardcoding Codex.
@test "T6 codex audit prompt and null-stdin contract" {
  assert_adapter_verb_prompt_contract codex audit
}

# Moving anything after the final --print value, or duplicating it, turns red.
@test "T6 agy implement prompt and null-stdin contract" {
  assert_adapter_verb_prompt_contract agy implement
}

# A valueless/misordered audit --print or a duplicate prompt turns this red.
@test "T6 agy audit prompt and null-stdin contract" {
  assert_adapter_verb_prompt_contract agy audit
}

# Returning success, omitting implement=false, or losing the named refusal
# turns this unsupported-combination assertion red.
@test "T6 claude implement refusal contract" {
  assert_adapter_verb_prompt_contract claude implement
}

# Returning success, omitting audit=false, or losing the named refusal turns
# this unsupported-combination assertion red.
@test "T6 claude audit refusal contract" {
  assert_adapter_verb_prompt_contract claude audit
}
