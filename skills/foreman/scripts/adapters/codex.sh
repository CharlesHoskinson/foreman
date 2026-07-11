#!/usr/bin/env bash
# OpenAI Codex adapter. NOTE: `codex review --json` does not exist (openai/codex#6432);
# structured audit goes through `codex exec --output-schema` instead.

adapter_vendor()  { echo codex; }
adapter_cli_bin() { echo codex; }
adapter_env_key() { echo OPENAI_API_KEY; }

adapter_worker_cmd() {
  # `-p` means --profile in codex; prompt goes on stdin ('-'). --json = JSONL events.
  echo 'codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox - < /task/prompt.md'
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
