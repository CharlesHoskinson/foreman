#!/usr/bin/env bash
# Claude Code adapter. Sourced by worker-run.sh / audit-run.sh.

adapter_vendor()  { echo claude; }
adapter_cli_bin() { echo claude; }
adapter_env_key() { echo ANTHROPIC_API_KEY; }

# Full-auto is safe ONLY because the container is the boundary (spec §7 S1).
adapter_worker_cmd() {
  # shellcheck disable=SC2016
  # Single quotes intentional: command string is evaluated later in container context.
  echo 'claude -p "$(cat /task/prompt.md)" --output-format stream-json --verbose --dangerously-skip-permissions'
}

adapter_run_audit() {
  local prompt="$1" out="$2" schema tmp rc=0
  schema="$(dirname "${BASH_SOURCE[0]}")/verdict.schema.json"
  tmp="$(mktemp)"
  claude -p "$(cat "$prompt")" \
    --output-format json \
    --json-schema "$schema" \
    --allowedTools "Read,Grep,Glob" \
    > "$tmp" || rc=$?
  if [[ $rc -eq 0 ]]; then
    jq '.structured_output' "$tmp" > "$out" || rc=1
  fi
  rm -f "$tmp"
  return "$rc"
}
