#!/usr/bin/env bash
# Collect FOREMAN_REPORT.* from all worktrees for a run into host run dir,
# write CONSOLIDATED.md for the architect. Does NOT remove worktrees.
# Usage: wt-consolidate.sh RUN_ID
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

RUN_ID="${1:?usage: wt-consolidate.sh RUN_ID}"
RD="$(run_dir "$RUN_ID")"
[[ -d "$RD/worktrees" ]] || die "$EXIT_CONFIG" "no worktrees index for $RUN_ID (run wt-new first)"
if ! command -v jq >/dev/null 2>&1; then
  require_cmd python3 "or install jq"
fi

json_get() {
  # json_get FILE KEY
  local file="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.[$k] // empty' "$file"
  else
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$file" "$key"
  fi
}

mkdir -p "$RD/reports"
OUT="$RD/CONSOLIDATED.md"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)"

{
  echo "# Foreman consolidated report - run \`$RUN_ID\`"
  echo
  echo "- generated: $NOW"
  echo "- run_dir: \`$RD\`"
  echo
  echo "## Worktrees"
  echo
} > "$OUT"

count=0
shopt -s nullglob
for meta in "$RD"/worktrees/*.json; do
  [[ "$(basename "$meta")" == "index.json" ]] && continue
  WT="$(json_get "$meta" worktree)"
  ROLE="$(json_get "$meta" role)"
  ID="$(json_get "$meta" id)"
  BRANCH="$(json_get "$meta" branch)"
  [[ -d "$WT" ]] || { log "WARN: missing worktree $WT"; continue; }

  dest_md="$RD/reports/${ID}.md"
  dest_json="$RD/reports/${ID}.json"
  if [[ -f "$WT/FOREMAN_REPORT.md" ]]; then
    cp -f "$WT/FOREMAN_REPORT.md" "$dest_md"
  else
    echo "(no FOREMAN_REPORT.md in $WT)" > "$dest_md"
  fi
  if [[ -f "$WT/FOREMAN_REPORT.json" ]]; then
    cp -f "$WT/FOREMAN_REPORT.json" "$dest_json"
  fi

  {
    echo "### \`$ID\` ($ROLE)"
    echo
    echo "- worktree: \`$WT\`"
    echo "- branch: \`$BRANCH\`"
    echo "- report: \`reports/${ID}.md\`"
    echo
    if [[ -f "$dest_md" ]]; then
      echo "<details><summary>Report body</summary>"
      echo
      head -n 200 "$dest_md" 2>/dev/null || cat "$dest_md"
      echo
      echo "</details>"
      echo
    fi
  } >> "$OUT"
  count=$((count + 1))
done

{
  echo "## Architect actions"
  echo
  echo "1. Read each report under \`reports/\`."
  echo "2. Resolve conflicts / open questions."
  echo "3. Merge implement branches only after audit APPROVED (if any)."
  echo "4. Run cleanup: \`scripts/wt-cleanup.sh $RUN_ID\` (archives reports first)."
  echo
  echo "worktrees_consolidated: $count"
} >> "$OUT"

if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg run "$RUN_ID" \
    --arg now "$NOW" \
    --argjson n "$count" \
    '{schema:"foreman.consolidate.v1", run_id:$run, time:$now, report_count:$n, consolidated:"CONSOLIDATED.md"}' \
    > "$RD/consolidate-meta.json"
else
  python3 -c 'import json,sys; json.dump({"schema":"foreman.consolidate.v1","run_id":sys.argv[1],"time":sys.argv[2],"report_count":int(sys.argv[3]),"consolidated":"CONSOLIDATED.md"}, open(sys.argv[4],"w"), indent=2)' \
    "$RUN_ID" "$NOW" "$count" "$RD/consolidate-meta.json"
fi

log "consolidated $count reports -> $OUT"
echo "$OUT"
