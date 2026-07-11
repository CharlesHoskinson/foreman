#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TASK_ID="${1:?usage: pr-open.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/gate-decision.json" ]] || die "$EXIT_CONFIG" "run gate-eval.sh first"
[[ "$(jq -r .pass "$RD/gate-decision.json")" == "true" ]] \
  || die "$EXIT_FAIL" "gate has not passed — refusing to open PR"
require_cmd jq; require_cmd git

WT="$(jq -r .worktree "$RD/meta.json")"
BRANCH="$(jq -r .branch "$RD/meta.json")"

cat > "$RD/pr-body.md" <<EOF
## Foreman evidence summary — task $TASK_ID

- **Independent checks:** $(jq -r '.status + " (`" + .command + "`, exit " + (.exit_code|tostring) + ")"' "$RD/checks-result.json")
- **Cross-vendor audit:** $(jq -r .verdict "$RD/audit-verdict.json"), $(jq '.findings | length' "$RD/audit-verdict.json") finding(s)
- **Gate:** PASS (forbidden paths clean, protected-file hashes intact)
- **Commits:**
\`\`\`
$(cat "$RD/evidence/commits.txt")
\`\`\`
- **Diff stat:**
\`\`\`
$(cat "$RD/evidence/diff-stat.txt")
\`\`\`

CI remains the final merge authority. Evidence bundle: \`$RD\`
EOF

git_nohooks -C "$WT" push -u origin "$BRANCH"

GH_BIN="${GH_BIN:-gh}"
if ! command -v "$GH_BIN" >/dev/null 2>&1; then
  log "branch is pushed ($BRANCH); gh not found — open the PR manually with body: $RD/pr-body.md"
  exit "$EXIT_MISSING_CLI"
fi

"$GH_BIN" pr create \
  --head "$BRANCH" \
  --title "[foreman:$TASK_ID] $(git_nohooks -C "$WT" log -1 --format=%s)" \
  --body-file "$RD/pr-body.md"
