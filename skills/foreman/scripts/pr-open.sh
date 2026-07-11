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

# Validate every PR-body input up front, and capture interpolated values in
# simple-command assignments so a failure trips set -e (substitutions inside
# a heredoc redirect would fail silently — the observed status is cat's).
for f in evidence/commits.txt evidence/diff-stat.txt checks-result.json audit-verdict.json meta.json; do
  [[ -f "$RD/$f" ]] || die "$EXIT_CONFIG" "missing PR input: $RD/$f (run the pipeline first)"
done

WT="$(jq -r .worktree "$RD/meta.json")"
BRANCH="$(jq -r .branch "$RD/meta.json")"
CHECKS_LINE="$(jq -er '.status + " (`" + .command + "`, exit " + (.exit_code|tostring) + ")"' "$RD/checks-result.json")" \
  || die "$EXIT_CONFIG" "checks-result.json is not valid JSON"
AUDIT_VERDICT="$(jq -er .verdict "$RD/audit-verdict.json")" \
  || die "$EXIT_CONFIG" "audit-verdict.json is not valid JSON"
AUDIT_COUNT="$(jq -er '.findings | length' "$RD/audit-verdict.json")" \
  || die "$EXIT_CONFIG" "audit-verdict.json is not valid JSON"
COMMITS="$(cat "$RD/evidence/commits.txt")"
DIFF_STAT="$(cat "$RD/evidence/diff-stat.txt")"

cat > "$RD/pr-body.md" <<EOF
## Foreman evidence summary — task $TASK_ID

- **Independent checks:** $CHECKS_LINE
- **Cross-vendor audit:** $AUDIT_VERDICT, $AUDIT_COUNT finding(s)
- **Gate:** PASS (forbidden paths clean, protected-file hashes intact)
- **Commits:**
\`\`\`
$COMMITS
\`\`\`
- **Diff stat:**
\`\`\`
$DIFF_STAT
\`\`\`

CI remains the final merge authority. Evidence bundle: \`$RD\`
EOF

if ! git_nohooks -C "$WT" push -u origin "$BRANCH"; then
  die "$EXIT_FAIL" "git push failed for $BRANCH (branch is committed locally; push/open the PR manually with $RD/pr-body.md)"
fi

GH_BIN="${GH_BIN:-gh}"
if ! command -v "$GH_BIN" >/dev/null 2>&1; then
  log "branch is pushed ($BRANCH); gh not found — open the PR manually with body: $RD/pr-body.md"
  exit "$EXIT_MISSING_CLI"
fi

"$GH_BIN" pr create \
  --head "$BRANCH" \
  --title "[foreman:$TASK_ID] $(git_nohooks -C "$WT" log -1 --format=%s)" \
  --body-file "$RD/pr-body.md"
