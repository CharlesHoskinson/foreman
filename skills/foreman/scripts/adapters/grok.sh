#!/usr/bin/env bash
# @description Standalone Grok adapter. This file deliberately sources
#   nothing, so callers that already loaded readonly Foreman libraries can
#   source it repeatedly without collisions. All argv output is the indexed
#   ADAPTER_ARGV array. `--prompt-file` is one burst and exits; it never reads
#   stdin. Headless implementation must include separate `--allow Write` and
#   `--allow Edit` grants or tool calls are silently denied as an empty burst.
# shellcheck disable=SC2034  # ADAPTER_ARGV is the documented caller-consumed output.

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
  local vendor="${1:-grok}" candidate
  if [[ "$vendor" != grok ]]; then
    printf 'grok adapter: vendor mismatch: %s\n' "$vendor" >&2
    return 2
  fi
  for candidate in "${2:-}" "${3:-}" "${4:-}"; do
    [[ -n "$candidate" && -s "$candidate" ]] || continue
    if jq -e 'select(type == "object" and ((keys | sort) == ["findings","summary","verdict"]) and (.verdict == "APPROVED" or .verdict == "WARNING" or .verdict == "BLOCKED") and (.summary | type == "string") and (.findings | type == "array") and all(.findings[]; type == "object" and ((keys | sort) == ["evidence","file","line","severity","summary"]) and (.severity == "critical" or .severity == "high" or .severity == "medium" or .severity == "low") and (.file | type == "string") and (.line | if type == "number" then . == floor else false end) and (.summary | type == "string") and (.evidence | type == "string")))' "$candidate" 2>/dev/null; then
      return 0
    fi
  done
  printf 'grok adapter: non-conforming verdict or verdict missing\n' >&2
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
