#!/usr/bin/env bash
# xAI Grok Build adapter. NOTE: output format is `streaming-json` (not Claude's
# `stream-json`). The community superagent-ai/grok-cli shares ~/.grok/ but uses
# --prompt/--format; we require the xAI binary (checked by `grok --version` in install.sh).

adapter_vendor()  { echo grok; }
adapter_cli_bin() { echo grok; }
adapter_env_key() { echo XAI_API_KEY; }

adapter_worker_cmd() {
  # shellcheck disable=SC2016
  # Single quotes intentional: command string is evaluated later in container context.
  echo 'grok --no-auto-update -p "$(cat /task/prompt.md)" --output-format streaming-json --always-approve'
}

adapter_run_audit() {
  local prompt="$1" out="$2" tmp
  tmp="$(mktemp)"
  grok --no-auto-update -p "$(cat "$prompt")" --output-format json > "$tmp"
  # Grok has no schema forcing; the audit prompt demands bare verdict JSON as the
  # final answer. Extract the last JSON object with a verdict key from the result.
  jq -r '.result // .content // empty' "$tmp" 2>/dev/null \
    | python3 -c '
import sys, json, re
text = sys.stdin.read()
matches = re.findall(r"\{[^{}]*\"verdict\"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.S)
print(matches[-1] if matches else "{}")
' > "$out"
  rm -f "$tmp"
}
