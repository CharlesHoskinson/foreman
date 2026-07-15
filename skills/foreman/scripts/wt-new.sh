#!/usr/bin/env bash
# Create an isolated git worktree for a parallel Foreman agent role.
# Usage: wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]
# Roles: search | plan | audit | implement | advisor | misc
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

RUN_ID="${1:?usage: wt-new.sh RUN_ID ROLE [SLUG] [BASE_REF]}"
ROLE="${2:?role required}"
SLUG="${3:-}"
BASE="${4:-HEAD}"

[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "$EXIT_CONFIG" "bad run id: $RUN_ID"
wt_role_ok "$ROLE" || die "$EXIT_CONFIG" "bad role: $ROLE (search|plan|audit|implement|advisor|misc)"
[[ -z "$SLUG" || "$SLUG" =~ ^[A-Za-z0-9._-]+$ ]] || die "$EXIT_CONFIG" "bad slug"

require_cmd git
# jq preferred; python3 fallback for Windows hosts without jq
if ! command -v jq >/dev/null 2>&1; then
  require_cmd python3 "or install jq"
fi

ROOT="$(git_nohooks rev-parse --show-toplevel)"
RD="$(run_dir "$RUN_ID")"
mkdir -p "$RD/reports" "$RD/worktrees"

WT="$(wt_path "$ROOT" "$RUN_ID" "$ROLE" "$SLUG")"
BRANCH="$(wt_branch "$RUN_ID" "$ROLE" "$SLUG")"
BASE_SHA="$(git_nohooks -C "$ROOT" rev-parse "${BASE}^{commit}")"

if [[ -e "$WT" ]]; then
  die "$EXIT_CONFIG" "worktree path already exists: $WT"
fi

# git worktree add prints progress to stdout — keep it off the path echo
wt_with_lock "$ROOT" \
  git -c core.hooksPath= -C "$ROOT" worktree add "$WT" -b "$BRANCH" "$BASE_SHA" >/dev/null

git_nohooks -C "$ROOT" config extensions.worktreeConfig true 2>/dev/null || true
git_nohooks -C "$WT" config --worktree core.hooksPath '' 2>/dev/null || true

# Scaffold report files so agents always have a target
cat > "$WT/FOREMAN_REPORT.md" <<EOF
# FOREMAN_REPORT

- run_id: $RUN_ID
- role: $ROLE
- slug: ${SLUG:-}
- branch: $BRANCH
- worktree: $WT
- base_sha: $BASE_SHA
- status: in_progress

## Summary
(agent: replace)

## Findings
(agent: replace)

## Evidence
(agent: paths, commands, quotes)

## Open questions
(agent: or none)
EOF

cat > "$WT/FOREMAN_REPORT.json" <<EOF
{
  "schema": "foreman.worktree-report.v1",
  "run_id": "$RUN_ID",
  "role": "$ROLE",
  "slug": "${SLUG:-}",
  "branch": "$BRANCH",
  "worktree": "$WT",
  "base_sha": "$BASE_SHA",
  "status": "in_progress",
  "summary": "",
  "findings": [],
  "evidence": [],
  "open_questions": []
}
EOF

META_ID="${ROLE}${SLUG:+-$SLUG}"
META_FILE="$RD/worktrees/${META_ID}.json"
if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg id "$META_ID" \
    --arg role "$ROLE" \
    --arg slug "${SLUG:-}" \
    --arg wt "$WT" \
    --arg branch "$BRANCH" \
    --arg base "$BASE_SHA" \
    --arg root "$ROOT" \
    '{id:$id, role:$role, slug:$slug, worktree:$wt, branch:$branch, base_sha:$base, repo_root:$root, status:"ready"}' \
    > "$META_FILE"
else
  python3 - "$META_FILE" "$META_ID" "$ROLE" "${SLUG:-}" "$WT" "$BRANCH" "$BASE_SHA" "$ROOT" <<'PY'
import json, sys
path, mid, role, slug, wt, branch, base, root = sys.argv[1:]
json.dump({"id":mid,"role":role,"slug":slug,"worktree":wt,"branch":branch,"base_sha":base,"repo_root":root,"status":"ready"}, open(path,"w"), indent=2)
open(path,"a").write("\n")
PY
fi

# Append to index
IDX="$RD/worktrees/index.json"
if command -v jq >/dev/null 2>&1; then
  if [[ -f "$IDX" ]]; then
    jq --slurpfile n "$META_FILE" '. + $n' "$IDX" > "$IDX.tmp" && mv "$IDX.tmp" "$IDX"
  else
    jq -n --slurpfile n "$META_FILE" '$n' > "$IDX"
  fi
else
  python3 - "$IDX" "$META_FILE" <<'PY'
import json, sys, os
idx, meta = sys.argv[1], sys.argv[2]
item = json.load(open(meta))
data = json.load(open(idx)) if os.path.isfile(idx) else []
data.append(item)
json.dump(data, open(idx,"w"), indent=2)
open(idx,"a").write("\n")
PY
fi

log "worktree ready: $WT"
log "branch: $BRANCH"
log "report: $WT/FOREMAN_REPORT.md"
echo "$WT"
