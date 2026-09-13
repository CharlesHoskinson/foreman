#!/usr/bin/env bash
# @description Standalone Claude contract placeholder for the currently
#   half-wired vendor. It sources nothing and is safe to source repeatedly.
#   T7 owns the finish-or-remove decision, so this adapter refuses both argv
#   builders rather than inventing runnable flags. CLAUDE_CONFIG_DIR alone is
#   insufficient isolation; a distinct HOME would be required. Capability
#   values describe Foreman support today, not every feature of Claude's CLI.
#   Claude documents `cat file | claude -p "query"` as its stdin-piping idiom.
#   This contract refuses it: both builders are unsupported, and any future
#   builder must keep the task in argv while the launcher supplies /dev/null so
#   an inherited open pipe cannot masquerade as a working lane. The outcome of
#   a misordered Claude invocation is unestablished; no real CLI was probed.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

# Claude schema enforcement is absent from Foreman's unsupported builder.
# The standalone result parser therefore treats local verdict.schema.json
# validation as load-bearing without claiming the audit verb can run.

# @description Record the Claude CLI version resolved on PATH and compare it
#   with adapter_caps. Version drift is deliberately INFO-only.
# @arg $1 vendor expected vendor id: claude
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
    _ADAPTER_RESULT_ERROR="claude adapter: cannot read verdict.schema.json"
    return 1
  fi
  if ! jq -e . "$candidate" >/dev/null 2>/dev/null; then
    _ADAPTER_RESULT_ERROR="claude adapter: invalid JSON in $stream"
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
  _ADAPTER_RESULT_ERROR="claude adapter: $stream JSON does not conform to verdict.schema.json"
  return 1
}

# @description Refuse Claude implementation argv until the T7 decision lands.
# @arg $1 vendor expected vendor id: claude
# @arg $2 prompt_file reserved common-contract prompt path
# @arg $3 workdir reserved common-contract worktree path
# @set ADAPTER_ARGV empty indexed bash array
# @exitcode 2 Claude implementation is deliberately unsupported
adapter_implement_argv() {
  local vendor="${1:-claude}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf 'claude implement unsupported: T7 must finish or remove the half-wired lane\n' >&2
  return 2
}

# @description Refuse Claude audit argv until the T7 decision lands.
# @arg $1 vendor expected vendor id: claude
# @arg $2 prompt_file reserved common-contract prompt path
# @arg $3 workdir reserved common-contract worktree path
# @arg $4 schema_file reserved common-contract verdict schema path
# @arg $5 out_file reserved common-contract result path
# @set ADAPTER_ARGV empty indexed bash array
# @exitcode 2 Claude audit is deliberately unsupported
adapter_audit_argv() {
  local vendor="${1:-claude}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf 'claude audit unsupported: T7 must finish or remove the half-wired lane\n' >&2
  return 2
}

# @description Print the state root Claude would require if T7 finishes it.
#   CLAUDE_CONFIG_DIR alone does not isolate ~/.claude.json, so HOME is the
#   honest required lever even though the current lane does not supply it.
# @arg $1 vendor expected vendor id: claude
# @stdout HOME
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_home_var() {
  local vendor="${1:-claude}"
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf 'HOME\n'
}

# @description Probe Claude authentication without running a model inference.
#   The status command must succeed and return valid JSON whose loggedIn field
#   is true; missing, malformed, or false content fails closed with a reason.
# @arg $1 vendor expected vendor id: claude
# @exitcode 0 authenticated; 1 absent, unauthenticated, or indeterminate; 2 mismatch
adapter_auth_probe() {
  local vendor="${1:-claude}" out='' rc=0
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if ! command -v claude >/dev/null 2>&1; then
    printf 'claude adapter: auth status unavailable because claude is absent\n' >&2
    return 1
  fi
  out="$(claude auth status 2>&1)" || rc=$?
  if (( rc != 0 )); then
    printf 'claude adapter: auth status command did not succeed\n' >&2
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    printf 'claude adapter: cannot verify auth status JSON because jq is absent\n' >&2
    return 1
  fi
  if jq -e 'type == "object" and .loggedIn == true' <<<"$out" >/dev/null 2>&1; then
    return 0
  fi
  printf 'claude adapter: auth status did not contain loggedIn=true\n' >&2
  return 1
}

# @description Print final Claude assistant text from separate result streams.
#   This parser is defined for contract completeness but no current builder
#   can produce a Claude run until T7 resolves support.
# @arg $1 vendor expected vendor id: claude
# @arg $2 out_file explicit final-result file, preferred when non-empty
# @arg $3 stdout_file captured stdout fallback
# @arg $4 stderr_file captured stderr, reported when no result exists
# @stdout final assistant text
# @exitcode 0 text found; 1 missing result; 2 vendor mismatch
adapter_result_text() {
  local vendor="${1:-claude}" out_file="${2:-}" stdout_file="${3:-}" stderr_file="${4:-}"
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  _adapter_report_cli_version "$vendor"
  if [[ -n "$out_file" && -s "$out_file" ]]; then cat -- "$out_file"; return 0; fi
  if [[ -n "$stdout_file" && -s "$stdout_file" ]]; then cat -- "$stdout_file"; return 0; fi
  if [[ -n "$stderr_file" && -s "$stderr_file" ]]; then
    printf 'claude adapter: result missing; stderr: ' >&2
    cat -- "$stderr_file" >&2
    return 1
  fi
  printf 'claude adapter: result text missing\n' >&2
  return 1
}

# @description Extract and validate a Claude verdict object from separate streams.
#   This parser is present without claiming the unsupported builder can run.
# @arg $1 vendor expected vendor id: claude
# @arg $2 out_file explicit result file
# @arg $3 stdout_file captured stdout
# @arg $4 stderr_file captured stderr
# @stdout schema-conforming verdict JSON
# @exitcode 0 valid verdict; 1 absent or non-conforming; 2 vendor mismatch
adapter_result_verdict() {
  local vendor="${1:-claude}" candidate stream failure=''
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
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
  printf '%s\n' "${failure:-claude adapter: verdict missing from out_file, stdout, and stderr}" >&2
  return 1
}

# @description Publish the deliberately unsupported Claude capability map.
# @arg $1 vendor expected vendor id: claude
# @stdout capability map, one k=v entry per line
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_caps() {
  local vendor="${1:-claude}"
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf '%s\n' \
    'resume=false' \
    'schema=false' \
    'sandbox=unsupported' \
    'cap_n=0' \
    'rc_unavailable=' \
    'prompt_flag=unsupported' \
    'prompt_flag_position=unsupported' \
    'verified_cli_version=unverified' \
    'implement=false' \
    'audit=false' \
    'isolation=requires-separate-HOME' \
    'claude_config_dir_sufficient=false'
}
