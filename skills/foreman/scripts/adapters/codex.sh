#!/usr/bin/env bash
# @description Standalone Codex adapter. This file sources nothing and is safe
#   to source repeatedly. It always fills the indexed ADAPTER_ARGV array and
#   passes prompt contents positionally; a bare `-` would make `codex exec`
#   read stdin, but Foreman's launcher attaches stdin to the null device.
#   Implement runs are workspace-write and audits are read-only. This adapter
#   never emits danger-full-access or the sandbox-bypass escape hatch.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

# @description Build Codex argv for an implementation round.
# @arg $1 vendor expected vendor id: codex
# @arg $2 prompt_file file whose contents become one positional prompt argument
# @arg $3 workdir writable worktree and final-message location
# @set ADAPTER_ARGV complete Codex invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch
adapter_implement_argv() {
  local vendor="${1:-codex}" prompt_file="${2:-}" workdir="${3:-.}" prompt=''
  ADAPTER_ARGV=()
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if [[ -f "$prompt_file" ]]; then prompt="$(<"$prompt_file")"; fi
  ADAPTER_ARGV=(codex exec
    --sandbox workspace-write
    --skip-git-repo-check
    --output-last-message "$workdir/.foreman-last.txt"
    --model "${WC_CODEX_MODEL:-gpt-5.6-sol}"
    -c "model_reasoning_effort=${WC_CODEX_REASONING_EFFORT:-medium}"
    "$prompt")
}

# @description Build Codex argv for a read-only audit round.
# @arg $1 vendor expected vendor id: codex
# @arg $2 prompt_file file whose contents become one positional prompt argument
# @arg $3 workdir audited worktree passed to --cd
# @arg $4 schema_file verdict schema passed to --output-schema
# @arg $5 out_file final assistant message destination
# @set ADAPTER_ARGV complete Codex invocation as an indexed bash array
# @exitcode 0 argv built; 2 vendor mismatch
adapter_audit_argv() {
  local vendor="${1:-codex}" prompt_file="${2:-}" workdir="${3:-.}" prompt=''
  local schema_file="${4:-${BASH_SOURCE[0]%/*}/verdict.schema.json}"
  local out_file="${5:-$workdir/.foreman-audit-last.json}"
  ADAPTER_ARGV=()
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  if [[ -f "$prompt_file" ]]; then prompt="$(<"$prompt_file")"; fi
  ADAPTER_ARGV=(codex exec
    --model "${ADAPTER_CODEX_AUDIT_MODEL:-gpt-5.6-sol}"
    -c "model_reasoning_effort=${ADAPTER_CODEX_AUDIT_REASONING_EFFORT:-high}"
    --sandbox read-only
    --skip-git-repo-check
    --cd "$workdir"
    --output-schema "$schema_file"
    --output-last-message "$out_file"
    "$prompt")
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
# @arg $1 vendor expected vendor id: codex
# @exitcode 0 authenticated; 1 absent or unauthenticated; 2 vendor mismatch
adapter_auth_probe() {
  local vendor="${1:-codex}"
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  command -v codex >/dev/null 2>&1 || return 1
  codex login status >/dev/null 2>&1
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
  local vendor="${1:-codex}" candidate
  if [[ "$vendor" != codex ]]; then
    printf 'codex adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  for candidate in "${2:-}" "${3:-}" "${4:-}"; do
    [[ -n "$candidate" && -s "$candidate" ]] || continue
    if jq -e 'select(type == "object" and ((keys | sort) == ["findings","summary","verdict"]) and (.verdict == "APPROVED" or .verdict == "WARNING" or .verdict == "BLOCKED") and (.summary | type == "string") and (.findings | type == "array") and all(.findings[]; type == "object" and ((keys | sort) == ["evidence","file","line","severity","summary"]) and (.severity == "critical" or .severity == "high" or .severity == "medium" or .severity == "low") and (.file | type == "string") and (.line | if type == "number" then . == floor else false end) and (.summary | type == "string") and (.evidence | type == "string")))' "$candidate" 2>/dev/null; then
      return 0
    fi
  done
  printf 'codex adapter: non-conforming verdict or verdict missing\n' >&2
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
