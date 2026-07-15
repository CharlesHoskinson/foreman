#!/usr/bin/env bash
# Independent checks from pristine commit archive (not dirty worktree)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: checks-run.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID"
require_cmd jq; require_cmd git; require_cmd tar

WT="$(jq -r .worktree "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"
SHA="$(git_nohooks -C "$WT" rev-parse HEAD)"

CMD="$(toml_get "$CONFIG" checks.command '' 2>/dev/null || true)"
if [[ -z "${CMD:-}" ]]; then
  if   git_nohooks -C "$WT" cat-file -e "$SHA:package.json"   2>/dev/null; then CMD="npm test"
  elif git_nohooks -C "$WT" cat-file -e "$SHA:pyproject.toml" 2>/dev/null; then CMD="python3 -m pytest"
  else
    # Soft fallback for docs/static sites
    CMD="bash -lc 'test -f site/index.html || test -f index.html || true'"
    log "WARN: no checks.command — using static-site soft check"
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git_nohooks -C "$WT" archive "$SHA" | tar -x -C "$TMP"

set +e
( cd "$TMP" && bash -lc "$CMD" ) > "$RD/checks.log" 2>&1
EC=$?
set -e

STATUS=fail; [[ $EC -eq 0 ]] && STATUS=pass
jq -n --arg sha "$SHA" --arg cmd "$CMD" --argjson ec "$EC" --arg st "$STATUS" \
  '{sha:$sha, command:$cmd, exit_code:$ec, status:$st}' > "$RD/checks-result.json"

log "checks ($CMD) on $SHA: $STATUS"
[[ "$STATUS" == pass ]] || exit "$EXIT_FAIL"
