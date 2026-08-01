#!/usr/bin/env bash
# @description Standalone Antigravity CLI (`agy`) adapter. It sources nothing
#   and fills only the indexed ADAPTER_ARGV argv output. `--print` consumes the
#   prompt as its value and must be the final flag/value pair; placing a
#   positional prompt before a valueless `--print` hangs instead of erroring.
#   Isolation is intentionally reported as partial: GEMINI_CLI_HOME is a no-op
#   for agy, while relocating HOME moves mutable state but not the OAuth token.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

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
  local vendor="${1:-agy}" candidate
  if [[ "$vendor" != agy ]]; then
    printf 'agy adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  for candidate in "${2:-}" "${3:-}" "${4:-}"; do
    [[ -n "$candidate" && -s "$candidate" ]] || continue
    if jq -e 'select(type == "object" and ((keys | sort) == ["findings","summary","verdict"]) and (.verdict == "APPROVED" or .verdict == "WARNING" or .verdict == "BLOCKED") and (.summary | type == "string") and (.findings | type == "array") and all(.findings[]; type == "object" and ((keys | sort) == ["evidence","file","line","severity","summary"]) and (.severity == "critical" or .severity == "high" or .severity == "medium" or .severity == "low") and (.file | type == "string") and (.line | if type == "number" then . == floor else false end) and (.summary | type == "string") and (.evidence | type == "string")))' "$candidate" 2>/dev/null; then
      return 0
    fi
  done
  printf 'agy adapter: non-conforming verdict or verdict missing\n' >&2
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
