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

TASK_ID="${1:?usage: checks-run.sh TASK_ID [WORKTREE_ID]}"
WORKTREE_ID="${2:-}"
RD="$(run_dir "$TASK_ID")"
require_cmd jq; require_cmd git; require_cmd tar
FOREMAN_TOOL_ROOT="${FOREMAN_TOOL_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
FOREMAN_TOOL_ROOT="$(cd "$FOREMAN_TOOL_ROOT" 2>/dev/null && pwd)" \
  || die "$EXIT_CONFIG" "invalid FOREMAN_TOOL_ROOT"

if [[ -f "$RD/meta.json" ]]; then
  WT="$(jq -er '.worktree | select(type == "string" and length > 0)' "$RD/meta.json")" \
    || die "$EXIT_CONFIG" "task metadata has no valid worktree: $TASK_ID"
  ROOT="$(jq -er '.repo_root | select(type == "string" and length > 0)' "$RD/meta.json")" \
    || die "$EXIT_CONFIG" "task metadata has no valid repo_root: $TASK_ID"
  BASE_SHA="$(jq -er '.base_sha | select(type == "string" and length > 0)' "$RD/meta.json")" \
    || die "$EXIT_CONFIG" "task metadata has no valid base_sha: $TASK_ID"
elif [[ -f "$RD/worktrees/index.json" ]]; then
  INDEX="$RD/worktrees/index.json"
  jq -e 'type == "array"' "$INDEX" >/dev/null \
    || die "$EXIT_CONFIG" "invalid worktree index for run: $TASK_ID"

  if [[ -n "$WORKTREE_ID" ]]; then
    MATCH_COUNT="$(jq --arg id "$WORKTREE_ID" '[.[] | select(.id == $id)] | length' "$INDEX")"
    [[ "$MATCH_COUNT" -gt 0 ]] \
      || die "$EXIT_CONFIG" "no worktree matches selector '$WORKTREE_ID' for run: $TASK_ID"
  else
    MATCH_COUNT="$(jq 'length' "$INDEX")"
    [[ "$MATCH_COUNT" -gt 0 ]] \
      || die "$EXIT_CONFIG" "worktree index is empty for run: $TASK_ID"
    die "$EXIT_CONFIG" "soft-mode run $TASK_ID requires an exact worktree selector as the second argument"
  fi
  [[ "$MATCH_COUNT" -eq 1 ]] \
    || die "$EXIT_CONFIG" "run $TASK_ID has $MATCH_COUNT worktrees; pass an exact worktree selector as the second argument"

  ENTRY="$(jq -c --arg id "$WORKTREE_ID" '.[] | select(.id == $id)' "$INDEX")"
  WT="$(jq -er '.worktree | select(type == "string" and length > 0)' <<<"$ENTRY")" \
    || die "$EXIT_CONFIG" "selected worktree has no valid worktree path: $TASK_ID"
  ROOT="$(jq -er '.repo_root | select(type == "string" and length > 0)' <<<"$ENTRY")" \
    || die "$EXIT_CONFIG" "selected worktree has no valid repo_root: $TASK_ID"
  BASE_SHA="$(jq -er '.base_sha | select(type == "string" and length > 0)' <<<"$ENTRY")" \
    || die "$EXIT_CONFIG" "selected worktree has no valid base_sha: $TASK_ID"
else
  die "$EXIT_CONFIG" "no such task or soft-mode run: $TASK_ID"
fi

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
  if git_nohooks -C "$WT" cat-file -e "$SHA:Makefile" 2>/dev/null \
      && git_nohooks -C "$WT" show "$SHA:Makefile" | grep -Eq '^[[:space:]]*check[[:space:]]*:'; then CMD="make check"
  elif git_nohooks -C "$WT" cat-file -e "$SHA:package.json"   2>/dev/null; then CMD="npm test"
  elif git_nohooks -C "$WT" cat-file -e "$SHA:go.mod"        2>/dev/null; then CMD="go test ./..."
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
ROOT_REAL="$(cd "$ROOT" 2>/dev/null && pwd)" \
  || die "$EXIT_CONFIG" "selected repo_root does not exist: $ROOT"
DOCS_CMD="$(toml_get "$CONFIG" checks.docs_command '' 2>/dev/null || true)"
if [[ "$ROOT_REAL" == "$FOREMAN_TOOL_ROOT" ]]; then
  ( cd "$TMP" && bash "$SCRIPT_DIR/docs-check.sh" --json "$RD/docs-check.json" ) || DOCS_RC=$?
elif [[ -n "$DOCS_CMD" ]]; then
  set +e
  ( cd "$TMP" && bash -lc "$DOCS_CMD" ) > "$RD/docs-check.log" 2>&1
  DOCS_RC=$?
  set -e
  DOCS_STATUS=fail; [[ "$DOCS_RC" -eq 0 ]] && DOCS_STATUS=pass
  jq -n \
    --arg status "$DOCS_STATUS" \
    --arg command "$DOCS_CMD" \
    --argjson exit_code "$DOCS_RC" \
    '{
       schema:"foreman.docs-check.v1",
       status:$status,
       policy:"target-docs-command",
       tools:{"target-docs":{status:$status, command:$command, exit_code:$exit_code}}
     }' > "$RD/docs-check.json"
else
  DOCS_STATUS=fail; [[ "$EC" -eq 0 ]] && DOCS_STATUS=pass
  [[ "$EC" -eq 0 ]] || DOCS_RC=1
  jq -n \
    --arg status "$DOCS_STATUS" \
    --arg command "$CMD" \
    --argjson exit_code "$EC" \
    '{
       schema:"foreman.docs-check.v1",
       status:$status,
       policy:"target-owned-check",
       tools:{"target-check":{status:$status, command:$command, exit_code:$exit_code}}
     }' > "$RD/docs-check.json"
fi
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
