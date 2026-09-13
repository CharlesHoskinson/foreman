#!/usr/bin/env bash
# @description Standalone Codex adapter. This file sources nothing and is safe
#   to source repeatedly. It always fills the indexed ADAPTER_ARGV array.
#   Implement prompts are positional because Foreman's worker launcher attaches
#   stdin to the null device; audit argv ends in `-` so audit-run can preserve
#   its existing stdin prompt delivery. Implement runs are workspace-write and
#   audits are read-only. This adapter never emits an unrestricted sandbox mode
#   or sandbox escape hatch.
#   Codex documents both `codex exec PROMPT` and piping the prompt to stdin;
#   a positional `-` explicitly forces the latter. Implement rejects that idiom
#   because an open pipe can wait forever for EOF and the launcher supplies
#   /dev/null. Audit is the narrow legacy exception and redirects a finite
#   regular prompt file explicitly. Official source establishes that forced `-`
#   reads through EOF and errors on empty input; an open pipe with no EOF can
#   therefore hang. Any `-` outside the declared last prompt slot remains
#   unestablished rather than guessed at by this contract.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

# Codex forces the final audit message through --output-schema. Local
# validation remains defense in depth and protects fallback stream parsing.

# @description Record the Codex CLI version resolved on PATH and compare it
#   with adapter_caps. Version drift is deliberately INFO-only.
# @arg $1 vendor expected vendor id: codex
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
    _ADAPTER_RESULT_ERROR="codex adapter: cannot read verdict.schema.json"
    return 1
  fi
  if ! jq -e . "$candidate" >/dev/null 2>/dev/null; then
    _ADAPTER_RESULT_ERROR="codex adapter: invalid JSON in $stream"
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
  _ADAPTER_RESULT_ERROR="codex adapter: $stream JSON does not conform to verdict.schema.json"
  return 1
}

# @description Build Codex argv for an implementation round.
# @arg $1 vendor expected vendor id: codex
# @arg $2 prompt_file file whose contents become one positional prompt argument
# @arg $3 workdir writable worktree and final-message location
# @arg $4 profile_flag optional -p or --profile; when present the profile owns
#   model, reasoning effort, and sandbox instead of the default WC_* settings
# @arg $5 profile_name profile in CODEX_HOME configuration
# @set ADAPTER_ARGV complete Codex invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch or malformed profile arguments
adapter_implement_argv() {
  local vendor="${1:-codex}" prompt_file="${2:-}" workdir="${3:-.}"
  local profile_flag="${4:-}" profile_name="${5:-}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if (( $# > 3 )); then
    if [[ "$profile_flag" != -p && "$profile_flag" != --profile ]] ||
       [[ -z "$profile_name" ]] || (( $# != 5 )); then
      printf 'codex adapter: expected -p/--profile NAME after workdir\n' >&2
      return 2
    fi
    ADAPTER_ARGV=(codex exec
      "$profile_flag" "$profile_name"
      --skip-git-repo-check
      --output-last-message "$workdir/.foreman-last.txt"
      "$(cat "$prompt_file")")
  else
    ADAPTER_ARGV=(codex exec
      --sandbox workspace-write
      --skip-git-repo-check
      --output-last-message "$workdir/.foreman-last.txt"
      --model "${WC_CODEX_MODEL:-gpt-5.6-sol}"
      -c "model_reasoning_effort=${WC_CODEX_REASONING_EFFORT:-medium}"
      "$(cat "$prompt_file")")
  fi
}

# @description Build Codex argv for a read-only audit round.
# @arg $1 vendor expected vendor id: codex
# @arg $2 prompt_file file that the audit caller redirects to stdin
# @arg $3 workdir audited worktree passed to --cd
# @arg $4 schema_file verdict schema passed to --output-schema
# @arg $5 out_file final assistant message destination
# @arg $6 audit_form optional prompt (default) or review-base
# @arg $7 base required branch/base ref when audit_form is review-base
# @set ADAPTER_ARGV complete Codex invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch or invalid audit form
adapter_audit_argv() {
  local vendor="${1:-codex}" workdir="${3:-.}"
  local schema_file="${4:-${BASH_SOURCE[0]%/*}/verdict.schema.json}"
  local out_file="${5:-$workdir/.foreman-audit-last.json}"
  local audit_form="${6:-prompt}" base="${7:-}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  ADAPTER_ARGV=(codex exec
    --model "${ADAPTER_CODEX_AUDIT_MODEL:-gpt-5.6-sol}"
    -c "model_reasoning_effort=${ADAPTER_CODEX_AUDIT_REASONING_EFFORT:-high}"
    --sandbox read-only
    --ephemeral
    --skip-git-repo-check
    --cd "$workdir"
    --output-schema "$schema_file"
    --output-last-message "$out_file")
  case "$audit_form" in
    prompt)
      if (( $# > 6 )); then
        ADAPTER_ARGV=()
        printf 'codex adapter: prompt audit form accepts no BASE\n' >&2
        return 2
      fi
      ;;
    review-base)
      if [[ -z "$base" ]] || (( $# != 7 )); then
        ADAPTER_ARGV=()
        printf 'codex adapter: review-base requires BASE\n' >&2
        return 2
      fi
      ;;
    *)
      ADAPTER_ARGV=()
      printf 'codex adapter: unknown audit form: %s\n' "$audit_form" >&2
      return 2
      ;;
  esac
  if [[ "$audit_form" == review-base ]]; then
    ADAPTER_ARGV+=(review --base "$base")
  fi
  ADAPTER_ARGV+=(-)
}

# @description Print the environment variable that relocates Codex state.
# @arg $1 vendor expected vendor id: codex
# @stdout CODEX_HOME
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_home_var() {
  local vendor="${1:-codex}"
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf 'CODEX_HOME\n'
}

# @description Probe Codex authentication without running a model inference.
#   A successful command is insufficient: explicit signed-in content is
#   required, and recognised signed-out wording wins over positive substrings.
# @arg $1 vendor expected vendor id: codex
# @exitcode 0 authenticated; 1 absent, unauthenticated, or indeterminate; 2 mismatch
adapter_auth_probe() {
  local vendor="${1:-codex}" out='' rc=0
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  command -v codex >/dev/null 2>&1 || return 1
  out="$(codex login status 2>&1)" || rc=$?
  (( rc == 0 )) || return 1
  out="${out,,}"
  if [[ "$out" == *'not logged in'* || "$out" == *'not authenticated'* ||
        "$out" == *'unauthenticated'* || "$out" == *'sign in'* ||
        "$out" == *'log in'* ]]; then
    return 1
  fi
  [[ "$out" == *'logged in using '* ]]
}

# @description Print final Codex assistant text from separate result streams.
# @arg $1 vendor expected vendor id: codex
# @arg $2 out_file explicit --output-last-message file, preferred when non-empty
# @arg $3 stdout_file captured stdout fallback
# @arg $4 stderr_file captured stderr, reported when no result exists
# @stdout final assistant text
# @exitcode 0 text found; 1 missing result; 2 vendor mismatch
adapter_result_text() {
  local vendor="${1:-codex}" out_file="${2:-}" stdout_file="${3:-}" stderr_file="${4:-}"
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  _adapter_report_cli_version "$vendor"
  if [[ -n "$out_file" && -s "$out_file" ]]; then cat -- "$out_file"; return 0; fi
  if [[ -n "$stdout_file" && -s "$stdout_file" ]]; then cat -- "$stdout_file"; return 0; fi
  if [[ -n "$stderr_file" && -s "$stderr_file" ]]; then
    printf 'codex adapter: result missing; stderr: ' >&2
    cat -- "$stderr_file" >&2
    return 1
  fi
  printf 'codex adapter: result text missing\n' >&2
  return 1
}

# @description Extract and validate a Codex verdict object from separate streams.
# @arg $1 vendor expected vendor id: codex
# @arg $2 out_file explicit final-message file
# @arg $3 stdout_file captured stdout
# @arg $4 stderr_file captured stderr
# @stdout schema-conforming verdict JSON
# @exitcode 0 valid verdict; 1 absent or non-conforming; 2 vendor mismatch
adapter_result_verdict() {
  local vendor="${1:-codex}" candidate stream failure=''
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
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
  printf '%s\n' "${failure:-codex adapter: verdict missing from out_file, stdout, and stderr}" >&2
  return 1
}

# @description Publish verified Codex capabilities as machine-readable k=v lines.
# @arg $1 vendor expected vendor id: codex
# @stdout capability map, one k=v entry per line
# @exitcode 0 vendor matches; 2 vendor mismatch
adapter_caps() {
  local vendor="${1:-codex}"
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  printf '%s\n' \
    'resume=true' \
    'schema=true' \
    'sandbox=implement:workspace-write,audit:read-only' \
    'cap_n=2' \
    'rc_unavailable=' \
    'prompt_flag=positional' \
    'prompt_flag_position=last' \
    'verified_cli_version=0.146.0'
}
