#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=skills/foreman/scripts/lib/common.sh disable=SC1091
source "$SCRIPT_DIR/../skills/foreman/scripts/lib/common.sh"

NET=none ENV_FILE="" PROMPT="" NAME=""
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --network)  NET="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --prompt)   PROMPT="$2"; shift 2 ;;
    --name)     NAME="$2"; shift 2 ;;
    *) die "$EXIT_CONFIG" "unknown flag: $1" ;;
  esac
done
WT="${1:?usage: docker-run.sh [flags] WORKTREE IMAGE -- CMD...}"
IMAGE="${2:?missing IMAGE}"
[[ "${3:-}" == "--" ]] || die "$EXIT_CONFIG" "expected -- before command"
shift 3
[[ -d "$WT" ]] || die "$EXIT_CONFIG" "worktree not found: $WT"

if [[ "${FOREMAN_NO_SANDBOX:-0}" == "1" ]]; then
  log "WARNING: FOREMAN_NO_SANDBOX=1 — running WITHOUT container isolation"
  ( cd "$WT" && FOREMAN_PROMPT="${PROMPT:-}" "$@" )
  exit $?
fi

DOCKER_BIN="${DOCKER_BIN:-docker}"
require_cmd "$DOCKER_BIN" "install Docker in WSL2"

ARGS=(run --rm
  --network "$NET"
  --cap-drop ALL
  --security-opt no-new-privileges
  --pids-limit 512
  --memory 4g
  --read-only
  --tmpfs /tmp:size=1g
  --tmpfs /home/worker:size=1g
  -v "$WT:/workspace:rw"
  -w /workspace)
[[ -n "$ENV_FILE" ]] && ARGS+=(--env-file "$ENV_FILE")
[[ -n "$PROMPT"   ]] && ARGS+=(-v "$PROMPT:/task/prompt.md:ro")
[[ -n "$NAME"     ]] && ARGS+=(--name "$NAME")

exec "$DOCKER_BIN" "${ARGS[@]}" "$IMAGE" "$@"
