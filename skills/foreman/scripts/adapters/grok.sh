#!/usr/bin/env bash
# @description Standalone Grok adapter. This file deliberately sources
#   nothing, so callers that already loaded readonly Foreman libraries can
#   source it repeatedly without collisions. All argv output is the indexed
#   ADAPTER_ARGV array. `--prompt-file` is one burst and exits; it never reads
#   stdin. Headless implementation must include separate `--allow Write` and
#   `--allow Edit` grants or tool calls are silently denied as an empty burst.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

# Grok forces the audit schema for JSON output. The adapter still validates
# the captured object locally so stderr diagnostics can never masquerade as a
# forced verdict.

# @description Record the Grok CLI version resolved on PATH and compare it
#   with adapter_caps. Version drift is deliberately INFO-only.
# @arg $1 vendor expected vendor id: grok
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
    _ADAPTER_RESULT_ERROR="grok adapter: cannot read verdict.schema.json"
    return 1
  fi
  if ! jq -e . "$candidate" >/dev/null 2>/dev/null; then
    _ADAPTER_RESULT_ERROR="grok adapter: invalid JSON in $stream"
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
  _ADAPTER_RESULT_ERROR="grok adapter: $stream JSON does not conform to verdict.schema.json"
  return 1
}

# @description Build Grok argv for one implementation burst.
# @arg $1 vendor expected vendor id: grok
# @arg $2 prompt_file prompt file passed directly to --prompt-file
# @arg $3 workdir working directory passed to --cwd
# @set ADAPTER_ARGV complete Grok invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch
adapter_implement_argv() {
  local vendor="${1:-grok}" prompt_file="${2:-}" workdir="${3:-.}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  # NOTE: `grok --prompt-file` is a SINGLE agentic burst — a spec that must
  # read/introspect before writing can exhaust the burst on orientation and
  # write nothing (an "empty-burst" round). Keep hard-mode worker specs
  # write-first; for genuinely exploratory work route through
  # skills/foreman/scripts/grok-multiround.sh (bounded re-prompt loop).
  ADAPTER_ARGV=(grok --prompt-file "$prompt_file"
    -m "${WC_GROK_MODEL:-grok-4.5}"
    --allow Write --allow Edit
    --output-format plain
    --cwd "$workdir"
    --no-leader)
}

# @description Build read-only Grok argv for an audit burst.
# @arg $1 vendor expected vendor id: grok
# @arg $2 prompt_file audit prompt file passed directly to --prompt-file
# @arg $3 workdir audited working directory
# @arg $4 schema_file verdict JSON schema file; its contents are passed inline
# @arg $5 out_file reserved common-contract result path; Grok writes stdout
# @set ADAPTER_ARGV complete Grok invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch
adapter_audit_argv() {
  local vendor="${1:-grok}" prompt_file="${2:-}" workdir="${3:-.}"
  local schema_file="${4:-${BASH_SOURCE[0]%/*}/verdict.schema.json}" schema='{}'
  ADAPTER_ARGV=()
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if [[ -f "$schema_file" ]]; then
    schema="$(<"$schema_file")"
  fi
  ADAPTER_ARGV=(grok --prompt-file "$prompt_file"
    -m "${ADAPTER_GROK_AUDIT_MODEL:-${WC_GROK_MODEL:-grok-4.5}}"
    --permission-mode plan
    --json-schema "$schema" --no-leader
    --output-format json
    --cwd "$workdir")
}

# @description Print the environment variable that relocates Grok state.
# @arg $1 vendor expected vendor id: grok
# @stdout GROK_HOME
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_home_var() {
  local vendor="${1:-grok}"
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf 'GROK_HOME\n'
}

# @description Probe Grok authentication without running a billed inference.
#   `grok models` has no trustworthy auth exit code and can hang after its
#   banner, so the probe is bounded, negative phrases win, and the exact
#   positive "logged in" signal is required even when timeout returns 124.
# @arg $1 vendor expected vendor id: grok
# @exitcode 0 authenticated; 1 absent, unauthenticated, or indeterminate; 2 mismatch
adapter_auth_probe() {
  local vendor="${1:-grok}" out='' rc=0 timeout_cmd=''
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  command -v grok >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then
    timeout_cmd=timeout
  elif command -v gtimeout >/dev/null 2>&1; then
    timeout_cmd=gtimeout
  else
    return 1
  fi
  out="$("$timeout_cmd" 10 grok models 2>&1)" || rc=$?
  out="${out,,}"
  if [[ "$out" == *'not authenticated'* || "$out" == *'sign in'* || "$out" == *'log in'* ]]; then
    return 1
  fi
  [[ "$out" == *'logged in'* ]] && return 0
  (( rc == 0 )) || return 1
  return 1
}

# @description Print final Grok assistant text from separate result streams.
# @arg $1 vendor expected vendor id: grok
# @arg $2 out_file explicit final-result file, preferred when non-empty
# @arg $3 stdout_file captured stdout, used when out_file is empty
# @arg $4 stderr_file captured stderr, reported as an error when no result exists
# @stdout final assistant text
# @exitcode 0 text found; 1 missing result; 2 vendor mismatch
adapter_result_text() {
  local vendor="${1:-grok}" out_file="${2:-}" stdout_file="${3:-}" stderr_file="${4:-}"
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  _adapter_report_cli_version "$vendor"
  if [[ -n "$out_file" && -s "$out_file" ]]; then cat -- "$out_file"; return 0; fi
  if [[ -n "$stdout_file" && -s "$stdout_file" ]]; then cat -- "$stdout_file"; return 0; fi
  if [[ -n "$stderr_file" && -s "$stderr_file" ]]; then
    printf 'grok adapter: result missing; stderr: ' >&2
    cat -- "$stderr_file" >&2
    return 1
  fi
  printf 'grok adapter: result text missing\n' >&2
  return 1
}

# @description Extract and validate a Grok verdict object from separate streams.
# @arg $1 vendor expected vendor id: grok
# @arg $2 out_file explicit result file
# @arg $3 stdout_file captured stdout
# @arg $4 stderr_file captured stderr
# @stdout schema-conforming verdict JSON
# @exitcode 0 valid verdict; 1 absent or non-conforming; 2 vendor mismatch
adapter_result_verdict() {
  local vendor="${1:-grok}" candidate stream failure=''
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
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
  printf '%s\n' "${failure:-grok adapter: verdict missing from out_file, stdout, and stderr}" >&2
  return 1
}

# @description Publish verified Grok capabilities as machine-readable k=v lines.
# @arg $1 vendor expected vendor id: grok
# @stdout capability map, one k=v entry per line
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_caps() {
  local vendor="${1:-grok}"
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf '%s\n' \
    'resume=false' \
    'schema=true' \
    'sandbox=implement:allow-Write+Edit,audit:plan' \
    'cap_n=3' \
    'rc_unavailable=' \
    'prompt_flag=--prompt-file' \
    'prompt_flag_position=flag-value' \
    'verified_cli_version=0.2.114' \
    'single_burst=true'
}
