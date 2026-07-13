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
  echo 'grok --no-auto-update -p "$(cat "${FOREMAN_PROMPT:-/task/prompt.md}")" --output-format streaming-json --always-approve'
}

adapter_run_audit() {
  local prompt="$1" out="$2" tmp rc=0
  tmp="$(mktemp)"
  grok --no-auto-update -p "$(cat "$prompt")" --output-format json > "$tmp" || rc=$?
  # Grok has no schema forcing; the audit prompt demands bare verdict JSON as the
  # final answer. Scan the result with a real JSON decoder (handles nested braces
  # and braces inside strings) and keep the last object with a verdict key.
  if [[ $rc -eq 0 ]]; then
    jq -r '.result // .content // empty' "$tmp" 2>/dev/null | python3 -c '
import sys, json
text = sys.stdin.read()
dec = json.JSONDecoder()
best, i = None, 0
while True:
    j = text.find("{", i)
    if j < 0:
        break
    try:
        obj, end = dec.raw_decode(text[j:])
        if isinstance(obj, dict) and "verdict" in obj:
            best = obj
        i = j + max(end, 1)
    except ValueError:
        i = j + 1
if best is None:
    sys.exit(1)
print(json.dumps(best))
' > "$out" || rc=1
  fi
  rm -f "$tmp"
  return "$rc"
}

# --- session transport (spec 2026-07-13 §5): headless session ---
# Inherits the grok CLI's own login (subscription) auth; no key injection.
# Keyless login supported: `grok login --oauth` or `--device-auth` (headless/remote);
# no XAI_API_KEY required for session transport (verified 2026-07-13, grok login --help).
# No resume in v1: grok --continue is cwd-keyed, not id-keyed; every round is fresh.

adapter_session_run() {  # PROMPT_FILE WORKTREE RUN_DIR ROUND
  local prompt="$1" wt="$2" rd="$3" round="$4" rc=0
  group_timeout "${FOREMAN_SESSION_TIMEOUT_SEC:-1800}" \
    grok --no-auto-update --cwd "$wt" -p "$(cat "$prompt")" \
      --output-format streaming-json --always-approve \
    > "$rd/worker-events-round-$round.jsonl" || rc=$?
  return "$rc"
}

adapter_session_can_resume() { return 1; }  # RUN_DIR (unused)

adapter_session_resume() { adapter_session_run "$@"; }
