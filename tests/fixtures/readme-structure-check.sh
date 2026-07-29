#!/usr/bin/env bash
# @description Assert README.md structural invariants for readme-refresh.
#   Exit 0 only if every required section is present in order.
#   Exit non-zero on any failure (harness: any case fail => non-zero).
#   Bind success to file content, not to an agent's account of the file.
set -euo pipefail

TARGET="${1:?usage: readme-structure-check.sh PATH_TO_README}"
[[ -f "$TARGET" ]] || { echo "FAIL: not a file: $TARGET" >&2; exit 2; }

# Required H2 headings, in order. Exact prefixes after "## N. ".
REQUIRED=(
  "1. What Foreman is and the problem it solves"
  "2. The mental model"
  "3. The five-part spec"
  "4. Lanes and vendor routing"
  "5. Soft mode — the loop that runs today"
  "6. Setup → Use → Cleanup, and the quickstart"
  "7. Worktree isolation"
  "8. Reports are claims: evidence, verification, audit, checker soundness"
  "9. The record: event log, work-DAG, knowledge plane, store"
  "10. Hard mode — status"
  "11. Honest capabilities and limits"
  "12. Further reading, security, layout, license, lineage"
)

failures=0
last_line=0

for want in "${REQUIRED[@]}"; do
  # Match "## N. Title" at line start. Use fixed-string after the number for
  # em-dash safety.
  # shellcheck disable=SC2016
  hit="$(grep -n -F "## ${want}" "$TARGET" | head -1 || true)"
  if [[ -z "$hit" ]]; then
    echo "FAIL: missing required section: ## ${want}" >&2
    failures=$((failures + 1))
    continue
  fi
  line="${hit%%:*}"
  if [[ "$line" -le "$last_line" ]]; then
    echo "FAIL: section order violated: ## ${want} at line ${line}, previous section ended at line ${last_line}" >&2
    failures=$((failures + 1))
  fi
  last_line="$line"
done

if [[ "$failures" -gt 0 ]]; then
  echo "FAIL: ${failures} structural invariant(s) violated in ${TARGET}" >&2
  exit 1
fi

echo "OK: all ${#REQUIRED[@]} required sections present in order in ${TARGET}"
exit 0
