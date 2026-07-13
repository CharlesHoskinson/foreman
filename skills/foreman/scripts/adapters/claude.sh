#!/usr/bin/env bash
# Claude Code adapter. Sourced by worker-run.sh / audit-run.sh.

adapter_vendor()  { echo claude; }
adapter_cli_bin() { echo claude; }
adapter_env_key() { echo ANTHROPIC_API_KEY; }

# Full-auto is safe ONLY because the container is the boundary (spec §7 S1).
adapter_worker_cmd() {
  # shellcheck disable=SC2016
  # Single quotes intentional: command string is evaluated later in container context.
  echo 'claude -p "$(cat "${FOREMAN_PROMPT:-/task/prompt.md}")" --output-format stream-json --verbose --dangerously-skip-permissions'
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

# --- session transport (spec 2026-07-13 §5): native headless session ---
# Subscription (claude.ai login) auth; no API key. Runs on the HOST with
# Bash allowed: mcp mode defends the merge, not the host — see
# references/security-model.md. NOT --dangerously-skip-permissions.

_claude_session_flags() {
  echo "--output-format stream-json --verbose --permission-mode acceptEdits --allowedTools Bash,Edit,Write,Read,Glob,Grep,TodoWrite"
}

adapter_session_run() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0
  local ev="$rd/worker-events-round-$round.jsonl"
  # shellcheck disable=SC2046 # _claude_session_flags is a fixed, space-safe flag list
  ( cd "$wt" && timeout --signal=KILL "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" \
      claude -p "$(cat "$prompt")" $(_claude_session_flags) > "$ev" ) || rc=$?
  jq -r 'select(.type=="system" and .subtype=="init") | .session_id // empty' "$ev" 2>/dev/null \
    | head -1 > "$rd/claude-session-id" || true
  [[ -s "$rd/claude-session-id" ]] || rm -f "$rd/claude-session-id"
  return "$rc"
}

adapter_session_can_resume() { [[ -s "$1/claude-session-id" ]]; }  # RUN_DIR

adapter_session_resume() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0
  local ev="$rd/worker-events-round-$round.jsonl"
  # shellcheck disable=SC2046
  ( cd "$wt" && timeout --signal=KILL "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" \
      claude -p "$(cat "$prompt")" --resume "$(cat "$rd/claude-session-id")" \
      $(_claude_session_flags) > "$ev" ) || rc=$?
  return "$rc"
}
