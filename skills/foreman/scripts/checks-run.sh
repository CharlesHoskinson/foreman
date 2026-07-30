#!/usr/bin/env bash
# Independent checks from pristine commit archive (not dirty worktree)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/telemetry.sh
source "$SCRIPT_DIR/lib/telemetry.sh"
# shellcheck source=lib/evidence.sh
source "$SCRIPT_DIR/lib/evidence.sh"

TASK_ID="${1:?usage: checks-run.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID"
require_cmd jq; require_cmd git; require_cmd tar

WT="$(jq -r .worktree "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"
SHA="$(git_nohooks -C "$WT" rev-parse HEAD)"

if ! DIFF_SHA256="$(tl_diff_sha256 "$WT" "$BASE_SHA")"; then
  die "$EXIT_FAIL" "could not compute checks diff identity"
fi
tree_tmp="$(mktemp)"
if evidence_tree_sha256 "$WT" >"$tree_tmp"; then
  TREE_SHA256="$(<"$tree_tmp")"
  rm -f "$tree_tmp"
else
  tree_reason="${EVIDENCE_REASON:-tree-identity-uncomputable}"
  rm -f "$tree_tmp"
  die "$EXIT_FAIL" "could not compute checks tree identity ($tree_reason)"
fi

CMD="$(toml_get "$CONFIG" checks.command '' 2>/dev/null || true)"
if [[ -z "${CMD:-}" ]]; then
  if   git_nohooks -C "$WT" cat-file -e "$SHA:package.json"   2>/dev/null; then CMD="npm test"
  elif git_nohooks -C "$WT" cat-file -e "$SHA:pyproject.toml" 2>/dev/null; then CMD="python3 -m pytest"
  else
    die "$EXIT_CONFIG" "unknown stack: set [checks] command in .foreman/config.toml (refusing always-green fallback)"
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git_nohooks -C "$WT" archive "$SHA" | tar -x -C "$TMP"

set +e
( cd "$TMP" && bash -lc "$CMD" ) > "$RD/checks.log" 2>&1
EC=$?
set -e

# Docs/comment quality gate (fail-closed; JSON consumed by gate-eval)
DOCS_RC=0
bash "$SCRIPT_DIR/docs-check.sh" --json "$RD/docs-check.json" || DOCS_RC=$?
if [[ -f "$RD/docs-check.json" ]]; then
  docs_tmp="${RD}/docs-check.json.tmp.$$"
  # No attempt field: docs-check.json is not produced by an audit attempt.
  jq \
    --arg diff_sha256 "$DIFF_SHA256" \
    --arg tree_sha256 "$TREE_SHA256" \
    '. + {diff_sha256:$diff_sha256, tree_sha256:$tree_sha256}' \
    "$RD/docs-check.json" >"$docs_tmp"
  mv -f "$docs_tmp" "$RD/docs-check.json"
fi

STATUS=fail; [[ $EC -eq 0 ]] && STATUS=pass
# No attempt field: checks-result.json is not produced by an audit attempt.
jq -n \
  --arg sha "$SHA" \
  --arg cmd "$CMD" \
  --argjson ec "$EC" \
  --arg st "$STATUS" \
  --argjson docs_rc "$DOCS_RC" \
  --arg diff_sha256 "$DIFF_SHA256" \
  --arg tree_sha256 "$TREE_SHA256" \
  '{
     sha:$sha,
     command:$cmd,
     exit_code:$ec,
     status:$st,
     docs_rc:$docs_rc,
     diff_sha256:$diff_sha256,
     tree_sha256:$tree_sha256
   }' >"$RD/checks-result.json"

log "checks ($CMD) on $SHA: $STATUS"
[[ "$STATUS" == pass ]] || exit "$EXIT_FAIL"
