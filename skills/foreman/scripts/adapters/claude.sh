#!/usr/bin/env bash
# @description Standalone Claude contract placeholder for the currently
#   half-wired vendor. It sources nothing and is safe to source repeatedly.
#   T7 owns the finish-or-remove decision, so this adapter refuses both argv
#   builders rather than inventing runnable flags. CLAUDE_CONFIG_DIR alone is
#   insufficient isolation; a distinct HOME would be required. Capability
#   values describe Foreman support today, not every feature of Claude's CLI.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

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
# @arg $1 vendor expected vendor id: claude
# @exitcode 0 authenticated; 1 absent or unauthenticated; 2 vendor mismatch
adapter_auth_probe() {
  local vendor="${1:-claude}"
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  command -v claude >/dev/null 2>&1 || return 1
  claude auth status >/dev/null 2>&1
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
  local vendor="${1:-claude}" candidate
  if [[ "$vendor" != claude ]]; then
    printf 'claude adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  for candidate in "${2:-}" "${3:-}" "${4:-}"; do
    [[ -n "$candidate" && -s "$candidate" ]] || continue
    if jq -e 'select(type == "object" and ((keys | sort) == ["findings","summary","verdict"]) and (.verdict == "APPROVED" or .verdict == "WARNING" or .verdict == "BLOCKED") and (.summary | type == "string") and (.findings | type == "array") and all(.findings[]; type == "object" and ((keys | sort) == ["evidence","file","line","severity","summary"]) and (.severity == "critical" or .severity == "high" or .severity == "medium" or .severity == "low") and (.file | type == "string") and (.line | if type == "number" then . == floor else false end) and (.summary | type == "string") and (.evidence | type == "string")))' "$candidate" 2>/dev/null; then
      return 0
    fi
  done
  printf 'claude adapter: non-conforming verdict or verdict missing\n' >&2
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
