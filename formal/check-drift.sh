#!/usr/bin/env bash
# formal/check-drift.sh — fail if covered sources changed without model/manifest touch.
# Escape hatch: record an explicit sentence in the change (not implemented as auto-parse).
# Usage: formal/check-drift.sh [base-ref]
#   base-ref defaults to origin/main or HEAD~1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COV="${ROOT}/formal/coverage.tsv"
BASE="${1:-}"
if [[ -z "${BASE}" ]]; then
  if git -C "${ROOT}" rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE="origin/main"
  else
    BASE="HEAD~1"
  fi
fi
# Collect changed paths vs BASE
mapfile -t CHANGED < <(git -C "${ROOT}" diff --name-only "${BASE}"...HEAD 2>/dev/null || git -C "${ROOT}" diff --name-only "${BASE}" HEAD)
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "drift: no changes vs ${BASE}"
  exit 0
fi
formal_touched=0
for p in "${CHANGED[@]}"; do
  case "${p}" in
    formal/*) formal_touched=1 ;;
  esac
done
fail=0
while IFS=$'\t' read -r model src notes; do
  [[ -z "${model}" || "${model}" == \#* || "${model}" == "model" ]] && continue
  : "${notes:-}"
  for p in "${CHANGED[@]}"; do
    if [[ "${p}" == "${src}" ]]; then
      if [[ "${formal_touched}" -eq 0 ]]; then
        echo "DRIFT: ${src} changed without any formal/ update (model=${model})"
        echo "  either update formal/specs/${model}.qnt / expectations.tsv or record why the abstraction is unaffected"
        fail=1
      else
        echo "drift: ${src} changed; formal/ also touched (model=${model}) — OK"
      fi
    fi
  done
done < "${COV}"
exit "${fail}"
