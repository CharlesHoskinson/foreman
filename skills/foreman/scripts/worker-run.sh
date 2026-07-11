#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: worker-run.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID (run task-new.sh first)"
require_cmd jq; require_cmd git; require_cmd timeout

WT="$(jq -r .worktree "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"

# --- vendor selection: config, else first other-vendor CLI installed (spec §4) ---
VENDOR="$(toml_get "$CONFIG" worker.vendor '')"
if [[ -z "$VENDOR" ]]; then
  for v in claude codex grok; do
    [[ "$v" == "${FOREMAN_ORCHESTRATOR:-}" ]] && continue
    if command -v "$v" >/dev/null 2>&1; then VENDOR="$v"; break; fi
  done
fi
[[ -n "$VENDOR" ]] || die "$EXIT_MISSING_CLI" "no worker CLI found (install claude, codex, or grok)"
[[ "$VENDOR" == "${FOREMAN_ORCHESTRATOR:-__unset__}" ]] \
  && die "$EXIT_CONFIG" "worker vendor ($VENDOR) must differ from orchestrator"
# shellcheck source=adapters/claude.sh disable=SC1091
source "$SCRIPT_DIR/adapters/$VENDOR.sh"

# --- round number ---
ROUND=1
while [[ -f "$RD/worker-round-$ROUND.json" ]]; do ROUND=$((ROUND + 1)); done

# --- assemble prompt from files (never interpolate into shell; spec §6.3) ---
PROMPT="$RD/prompt-round-$ROUND.md"
{
  cat "$RD/task.md"
  [[ -f "$RD/plan.md" ]] && { printf '\n---\n# Plan\n'; cat "$RD/plan.md"; }
  for f in "$RD"/rework-*.md; do
    [[ -f "$f" ]] && { printf '\n---\n# Rework findings (%s)\n' "$(basename "$f")"; cat "$f"; }
  done
} > "$PROMPT"

# --- single-vendor API key env file (spec §7 S6) ---
KEY_NAME="$(adapter_env_key)"
ENV_FILE="$RD/env"
( umask 177; echo "$KEY_NAME=${!KEY_NAME:-}" > "$ENV_FILE" )
cleanup() { rm -f "$ENV_FILE"; }
trap cleanup EXIT

TIMEOUT_MIN="$(toml_get "$CONFIG" limits.round_timeout_min 30)"
IMAGE="${FOREMAN_WORKER_IMAGE:-foreman-worker:latest}"
CNAME="foreman-$TASK_ID-r$ROUND"

HEAD_BEFORE="$(git_nohooks -C "$WT" rev-parse HEAD)"

set +e
timeout --signal=KILL "$((TIMEOUT_MIN * 60))" \
  "$SCRIPT_DIR/../../../sandbox/docker-run.sh" \
    --env-file "$ENV_FILE" --prompt "$PROMPT" --name "$CNAME" \
    "$WT" "$IMAGE" -- bash -lc "$(adapter_worker_cmd)" \
  > "$RD/worker-events-round-$ROUND.jsonl" 2> "$RD/worker-stderr-round-$ROUND.log"
EXIT_CODE=$?
set -e
if [[ $EXIT_CODE -eq 137 ]] && [[ "${FOREMAN_NO_SANDBOX:-0}" != "1" ]]; then
  "${DOCKER_BIN:-docker}" rm -f "$CNAME" >/dev/null 2>&1 || true
  log "round timed out after ${TIMEOUT_MIN}m"
fi

HEAD_AFTER="$(git_nohooks -C "$WT" rev-parse HEAD)"
CLEAN=false; [[ -z "$(git_nohooks -C "$WT" status --porcelain)" ]] && CLEAN=true
COMMITTED=false; [[ "$HEAD_BEFORE" != "$HEAD_AFTER" ]] && COMMITTED=true

STATUS=fail
[[ $EXIT_CODE -eq 0 && "$COMMITTED" == true && "$CLEAN" == true ]] && STATUS=ok

jq -n --argjson round "$ROUND" --arg vendor "$VENDOR" \
      --arg hb "$HEAD_BEFORE" --arg ha "$HEAD_AFTER" \
      --argjson committed "$COMMITTED" --argjson clean "$CLEAN" \
      --argjson ec "$EXIT_CODE" --arg status "$STATUS" \
      '{round:$round, vendor:$vendor, head_before:$hb, head_after:$ha,
        committed:$committed, clean:$clean, exit_code:$ec, status:$status}' \
  > "$RD/worker-round-$ROUND.json"

log "worker round $ROUND ($VENDOR): $STATUS (committed=$COMMITTED clean=$CLEAN exit=$EXIT_CODE)"
[[ "$STATUS" == ok ]] || exit "$EXIT_FAIL"
