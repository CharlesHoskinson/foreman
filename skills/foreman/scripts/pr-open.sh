#!/usr/bin/env bash
# PR stage — not fully shipped (requires gh + remote).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: pr-open.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/gate-decision.json" ]] || die "$EXIT_CONFIG" "run gate-eval.sh first"
[[ "$(jq -r .pass "$RD/gate-decision.json" 2>/dev/null || echo false)" == "true" ]] \
  || die "$EXIT_FAIL" "gate has not passed — refusing to open PR"

log "pr-open.sh automation is partial in this release."
log "Gate PASSED for task $TASK_ID. Evidence: $RD"
log "Manually: push branch from worktree and open PR with evidence summary."
if [[ -f "$RD/evidence/diff-stat.txt" ]]; then
  log "diff-stat:"
  cat "$RD/evidence/diff-stat.txt" >&2 || true
fi
if command -v gh >/dev/null 2>&1; then
  log "gh is installed — implement full pr create in a future release (see design plan)."
else
  log "gh not found — open PR manually."
fi
exit "$EXIT_MISSING_CLI"
