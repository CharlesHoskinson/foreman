#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: checks-run.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID"
require_cmd jq; require_cmd git; require_cmd tar

WT="$(jq -er .worktree "$RD/meta.json")" \
  || die "$EXIT_CONFIG" "meta.json is not valid JSON: $RD/meta.json"
ROOT="$(jq -er .repo_root "$RD/meta.json")" \
  || die "$EXIT_CONFIG" "meta.json is not valid JSON: $RD/meta.json"
CONFIG="$ROOT/.foreman/config.toml"
SHA="$(git_nohooks -C "$WT" rev-parse HEAD)"

# Check command: config, else autodetect, else refuse loudly (spec §5, §9).
CMD="$(toml_get "$CONFIG" checks.command '')"
if [[ -z "$CMD" ]]; then
  if   git_nohooks -C "$WT" cat-file -e "$SHA:package.json"   2>/dev/null; then CMD="npm test"
  elif git_nohooks -C "$WT" cat-file -e "$SHA:pyproject.toml" 2>/dev/null; then CMD="python3 -m pytest"
  else die "$EXIT_CONFIG" "unknown stack: set [checks] command in .foreman/config.toml"
  fi
fi

# Pristine checkout of the worker's COMMIT — never the dirty worktree (spec §6.4).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git_nohooks -C "$WT" archive "$SHA" | tar -x -C "$TMP"

IMAGE="${FOREMAN_WORKER_IMAGE:-foreman-worker:latest}"
set +e
"$(docker_run_wrapper)" --network none \
  "$TMP" "$IMAGE" -- bash -lc "$CMD" > "$RD/checks.log" 2>&1
EC=$?
set -e

STATUS=fail; [[ $EC -eq 0 ]] && STATUS=pass
jq -n --arg sha "$SHA" --arg cmd "$CMD" --argjson ec "$EC" --arg st "$STATUS" \
  '{sha:$sha, command:$cmd, exit_code:$ec, status:$st}' > "$RD/checks-result.json"

log "checks ($CMD) on $SHA: $STATUS"
[[ "$STATUS" == pass ]] || exit "$EXIT_FAIL"
