#!/usr/bin/env bash
# OpenAI Codex adapter. NOTE: `codex review --json` does not exist (openai/codex#6432);
# structured audit goes through `codex exec --output-schema` instead.

adapter_vendor()  { echo codex; }
adapter_cli_bin() { echo codex; }
adapter_env_key() { echo OPENAI_API_KEY; }

adapter_worker_cmd() {
  # `-p` means --profile in codex; prompt goes on stdin ('-'). --json = JSONL events.
  # shellcheck disable=SC2016
  # Single quotes intentional: command string is evaluated later in container context.
  echo 'codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox - < "${FOREMAN_PROMPT:-/task/prompt.md}"'
}

adapter_run_audit() {
  local prompt="$1" out="$2" schema
  schema="$(dirname "${BASH_SOURCE[0]}")/verdict.schema.json"
  codex exec \
    --sandbox read-only \
    --skip-git-repo-check \
    --output-schema "$schema" \
    --output-last-message "$out" \
    - < "$prompt" >/dev/null
}

# --- session transport (spec 2026-07-13 §5): real MCP against `codex mcp-server` ---
# Subscription (ChatGPT-login) auth; no API key. threadId gives the worker
# session memory across rework rounds — container mode cannot do that.

_codex_mcp_client() { echo "$(dirname "${BASH_SOURCE[0]}")/../mcp/mcp-session.py"; }

adapter_session_run() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0 args
  args="$(jq -n --rawfile p "$prompt" --arg cwd "$wt" \
    '{prompt: $p, cwd: $cwd, sandbox: "workspace-write", "approval-policy": "never"}')"
  python3 "$(_codex_mcp_client)" --server-cmd "codex mcp-server" --tool codex \
    --args-json "$args" \
    --events-out "$rd/worker-events-round-$round.jsonl" \
    --result-out "$rd/session-result-round-$round.json" \
    --timeout-sec "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" || rc=$?
  jq -r '[.. | .threadId? // empty] | first // empty' \
    "$rd/session-result-round-$round.json" 2>/dev/null > "$rd/thread-id" || true
  [[ -s "$rd/thread-id" ]] || rm -f "$rd/thread-id"
  return "$rc"
}

adapter_session_can_resume() { [[ -s "$1/thread-id" ]]; }  # RUN_DIR

adapter_session_resume() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0 args
  args="$(jq -n --rawfile p "$prompt" --rawfile tid "$rd/thread-id" \
    '{threadId: ($tid | rtrimstr("\n")), prompt: $p}')"
  python3 "$(_codex_mcp_client)" --server-cmd "codex mcp-server" --tool codex-reply \
    --args-json "$args" \
    --events-out "$rd/worker-events-round-$round.jsonl" \
    --result-out "$rd/session-result-round-$round.json" \
    --timeout-sec "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" || rc=$?
  return "$rc"
}
