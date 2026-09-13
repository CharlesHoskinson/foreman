#!/usr/bin/env bash
# @description Standalone Antigravity CLI (`agy`) adapter. It sources nothing
#   and fills only the indexed ADAPTER_ARGV argv output. `--print` consumes the
#   prompt as its value and must be the final flag/value pair; placing a
#   positional prompt before a valueless `--print` hangs instead of erroring.
#   Isolation is intentionally reported as partial: GEMINI_CLI_HOME is a no-op
#   for agy, while relocating HOME moves mutable state but not the OAuth token.
#   Google's documented headless idiom is `agy --print "PROMPT"`; no documented
#   shell stdin-piping prompt idiom was established. Foreman refuses inherited
#   stdin and invokes that flag/value form with /dev/null. A misplaced positional
#   prompt followed by valueless `--print` was safely established to hang, not
#   error, so both the final position and value attachment are load-bearing.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

# agy's schema forcing is partial: it covers only the final result in
# stream-json mode. Audit argv deliberately selects plain JSON, and this
# adapter's local verdict.schema.json validation is still load-bearing.

# @description Record the agy CLI version resolved on PATH and compare it
#   with adapter_caps. Version drift is deliberately INFO-only.
# @arg $1 vendor expected vendor id: agy
# @set ADAPTER_CLI_VERSION parsed CLI version, or unknown
# @set ADAPTER_VERSION_INFO comparison message emitted to stderr
# @exitcode 0 always; version discovery and mismatch never fail a result
_adapter_report_cli_version() {
  local vendor="$1" raw='' expected='' key='' value=''
  ADAPTER_CLI_VERSION=unknown
  raw="$("$vendor" --version 2>/dev/null)" || :
  if [[ "$raw" =~ ([0-9]+([.][0-9]+){1,3}([-+][[:alnum:]_.-]+)?) ]]; then
    ADAPTER_CLI_VERSION="${BASH_REMATCH[1]}"
  fi
  while IFS='=' read -r key value; do
    [[ "$key" == verified_cli_version ]] && expected="$value"
  done < <(adapter_caps "$vendor")
  if [[ "$ADAPTER_CLI_VERSION" == "$expected" ]]; then
    ADAPTER_VERSION_INFO="INFO: $vendor cli_version=$ADAPTER_CLI_VERSION verified_cli_version=$expected match"
  else
    ADAPTER_VERSION_INFO="INFO: $vendor cli_version=$ADAPTER_CLI_VERSION verified_cli_version=$expected mismatch (non-fatal)"
  fi
  printf '%s\n' "$ADAPTER_VERSION_INFO" >&2
  return 0
}

# @description Validate one captured JSON file against the colocated verdict
#   schema without trusting a pipeline status.
# @arg $1 stream stream label used in a conformance error
# @arg $2 candidate captured stream file
# @set _ADAPTER_VERDICT_JSON compact validated JSON on success
# @set _ADAPTER_RESULT_ERROR stream-specific validation error on failure
# @exitcode 0 conforming object; 1 invalid JSON, missing schema, or non-conformance
_adapter_validate_verdict_file() {
  local stream="$1" candidate="$2"
  local schema_file="${BASH_SOURCE[0]%/*}/verdict.schema.json" payload=''
  _ADAPTER_VERDICT_JSON=''
  _ADAPTER_RESULT_ERROR=''
  if [[ ! -r "$schema_file" ]]; then
    _ADAPTER_RESULT_ERROR="agy adapter: cannot read verdict.schema.json"
    return 1
  fi
  if ! jq -e . "$candidate" >/dev/null 2>/dev/null; then
    _ADAPTER_RESULT_ERROR="agy adapter: invalid JSON in $stream"
    return 1
  fi
  if payload="$(jq -sce --slurpfile schema "$schema_file" '
    def is_type($value; $wanted):
      if $wanted == "object" then ($value | type) == "object"
      elif $wanted == "array" then ($value | type) == "array"
      elif $wanted == "string" then ($value | type) == "string"
      elif $wanted == "integer" then (($value | type) == "number" and $value == ($value | floor))
      elif $wanted == "number" then ($value | type) == "number"
      elif $wanted == "boolean" then ($value | type) == "boolean"
      elif $wanted == "null" then $value == null
      else false end;
    def conforms($value; $rule):
      (if $rule | has("type") then is_type($value; $rule.type) else true end) and
      (if $rule | has("enum") then ($rule.enum | index($value)) != null else true end) and
      (if ($rule.type // "") == "object" and (($value | type) == "object") then
         (($rule.required // []) | all(. as $key | $value | has($key))) and
         (if $rule.additionalProperties == false then
            ((($value | keys_unsorted) - (($rule.properties // {}) | keys_unsorted)) | length) == 0
          else true end) and
         (($rule.properties // {}) | to_entries | all(. as $property |
           if $value | has($property.key)
           then conforms($value[$property.key]; $property.value)
           else true end))
       else true end) and
      (if ($rule.type // "") == "array" and (($value | type) == "array") and ($rule | has("items"))
       then ($value | all(.[]; conforms(.; $rule.items)))
       else true end);
    if (length == 1 and conforms(.[0]; $schema[0]))
    then .[0] else error("verdict.schema.json conformance failure") end
  ' "$candidate" 2>/dev/null)" && [[ -n "$payload" ]]; then
    _ADAPTER_VERDICT_JSON="$payload"
    return 0
  fi
  _ADAPTER_RESULT_ERROR="agy adapter: $stream JSON does not conform to verdict.schema.json"
  return 1
}

# @description Build agy argv for an implementation round.
# @arg $1 vendor expected vendor id: agy
# @arg $2 prompt_file file whose contents become the trailing --print value
# @arg $3 workdir working directory exposed with --add-dir
# @set ADAPTER_ARGV complete agy invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch
adapter_implement_argv() {
  local vendor="${1:-agy}" prompt_file="${2:-}" workdir="${3:-.}" prompt=''
  ADAPTER_ARGV=()
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if [[ -f "$prompt_file" ]]; then prompt="$(<"$prompt_file")"; fi
  # Antigravity CLI (Google lane). NOT @google/gemini-cli -- different
  # flags, exit codes and isolation behaviour; agy is the OAuth-authenticated
  # CLI this shop uses (/root/.local/bin/agy).
  #
  # TRAP: --print takes the PROMPT as its value, so it MUST stay LAST. Any
  # flag placed after it is consumed as the prompt text and the lane fails
  # silently. Do not reorder these for tidiness.
  #
  # agy has no --cwd; the working directory is expressed with --add-dir.
  # agy encodes reasoning effort IN the model name (`agy models` on this
  # host lists gemini-3.1-pro-high / -low, gemini-3.6-flash-high/-medium/-low
  # ...). There is therefore no separate --effort passed here: supplying both
  # a suffixed model and --effort states the same thing twice and invites the
  # two to disagree. Override the whole choice via WC_AGY_MODEL.
  # Verified against `agy models` 2026-07-30 -- an unlisted name is rejected
  # at run time, so this default must stay a name that command prints.
  # Auto-approve posture is --mode accept-edits; the unrestricted permission
  # bypass was deliberately removed as a default.
  ADAPTER_ARGV=(agy
    --model "${WC_AGY_MODEL:-gemini-3.1-pro-high}"
    --mode accept-edits
    --add-dir "$workdir"
    --output-format text
    --print "$prompt")
}

# @description Build agy argv for a plan-mode audit round.
# @arg $1 vendor expected vendor id: agy
# @arg $2 prompt_file file whose contents become the trailing --print value
# @arg $3 workdir audited working directory exposed with --add-dir
# @arg $4 schema_file verdict schema passed to --json-schema
# @arg $5 out_file reserved common-contract path; agy writes captured stdout
# @set ADAPTER_ARGV complete agy invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch
adapter_audit_argv() {
  local vendor="${1:-agy}" prompt_file="${2:-}" workdir="${3:-.}" prompt=''
  local schema_file="${4:-${BASH_SOURCE[0]%/*}/verdict.schema.json}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if [[ -f "$prompt_file" ]]; then prompt="$(<"$prompt_file")"; fi
  # TRAP: --print takes the PROMPT as its value, so it MUST stay LAST. Any
  # flag placed after it is consumed as the prompt text and the lane fails
  # silently.
  ADAPTER_ARGV=(agy
    --model "${ADAPTER_AGY_AUDIT_MODEL:-${WC_AGY_MODEL:-gemini-3.1-pro-high}}"
    --mode plan
    --add-dir "$workdir"
    --json-schema "$schema_file"
    --output-format json
    --print "$prompt")
}

# @description Print agy's imperfect state-isolation lever.
#   HOME relocates mutable state; GEMINI_CLI_HOME does nothing, and the OAuth
#   token does not follow a relocated HOME, so callers must seed or refuse it.
# @arg $1 vendor expected vendor id: agy
# @stdout HOME
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_home_var() {
  local vendor="${1:-agy}"
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf 'HOME\n'
}

# @description Probe agy authentication with bounded, non-billing `agy models`.
#   Exit 1 is also agy's general error, so success requires rc 0 and a positive
#   model-family token; absence of a known negative phrase is never enough.
# @arg $1 vendor expected vendor id: agy
# @exitcode 0 authenticated; 1 absent, unauthenticated, or indeterminate; 2 mismatch
adapter_auth_probe() {
  local vendor="${1:-agy}" out='' rc=0 timeout_cmd=''
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  command -v agy >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then
    timeout_cmd=timeout
  elif command -v gtimeout >/dev/null 2>&1; then
    timeout_cmd=gtimeout
  else
    return 1
  fi
  out="$("$timeout_cmd" 10 agy models 2>&1)" || rc=$?
  (( rc == 0 )) || return 1
  out="${out,,}"
  if [[ "$out" == *'please sign in'* || "$out" == *'not authenticated'* || "$out" == *'unauthorized'* ]]; then
    return 1
  fi
  [[ "$out" =~ (gemini|claude|gpt)[-_.[:alnum:]]+ ]]
}

# @description Print final agy assistant text from separate result streams.
# @arg $1 vendor expected vendor id: agy
# @arg $2 out_file explicit final-result file, preferred when non-empty
# @arg $3 stdout_file captured stdout fallback
# @arg $4 stderr_file captured stderr, reported when no result exists
# @stdout final assistant text
# @exitcode 0 text found; 1 missing result; 2 vendor mismatch
adapter_result_text() {
  local vendor="${1:-agy}" out_file="${2:-}" stdout_file="${3:-}" stderr_file="${4:-}"
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  _adapter_report_cli_version "$vendor"
  if [[ -n "$out_file" && -s "$out_file" ]]; then cat -- "$out_file"; return 0; fi
  if [[ -n "$stdout_file" && -s "$stdout_file" ]]; then cat -- "$stdout_file"; return 0; fi
  if [[ -n "$stderr_file" && -s "$stderr_file" ]]; then
    printf 'agy adapter: result missing; stderr: ' >&2
    cat -- "$stderr_file" >&2
    return 1
  fi
  printf 'agy adapter: result text missing\n' >&2
  return 1
}

# @description Extract and validate an agy verdict object from separate streams.
# @arg $1 vendor expected vendor id: agy
# @arg $2 out_file explicit result file
# @arg $3 stdout_file captured stdout
# @arg $4 stderr_file captured stderr
# @stdout schema-conforming verdict JSON
# @exitcode 0 valid verdict; 1 absent or non-conforming; 2 vendor mismatch
adapter_result_verdict() {
  local vendor="${1:-agy}" candidate stream failure=''
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  _adapter_report_cli_version "$vendor"
  for stream in out_file stdout stderr; do
    case "$stream" in
      out_file) candidate="${2:-}" ;;
      stdout) candidate="${3:-}" ;;
      stderr) candidate="${4:-}" ;;
    esac
    [[ -n "$candidate" && -s "$candidate" ]] || continue
    if _adapter_validate_verdict_file "$stream" "$candidate"; then
      printf '%s\n' "$_ADAPTER_VERDICT_JSON"
      return 0
    fi
    [[ -n "$failure" ]] || failure="$_ADAPTER_RESULT_ERROR"
  done
  printf '%s\n' "${failure:-agy adapter: verdict missing from out_file, stdout, and stderr}" >&2
  return 1
}

# @description Publish agy capabilities and its unresolved isolation gap as k=v.
#   Implementation uses accept-edits mode and retains normal permission checks.
# @arg $1 vendor expected vendor id: agy
# @stdout capability map, one k=v entry per line
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_caps() {
  local vendor="${1:-agy}"
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf '%s\n' \
    'resume=true' \
    'schema=true' \
    'sandbox=implement:accept-edits,audit:plan' \
    'cap_n=1' \
    'rc_unavailable=' \
    'prompt_flag=--print' \
    'prompt_flag_position=last' \
    'verified_cli_version=1.1.8' \
    'isolation=partial' \
    'home_var=HOME' \
    'gemini_cli_home_effective=false' \
    'oauth_token_isolated=false'
}
