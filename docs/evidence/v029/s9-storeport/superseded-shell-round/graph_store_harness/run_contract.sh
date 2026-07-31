#!/usr/bin/env bash
# @description GraphStore port contract harness.
#   Runs the backend-agnostic suite against files-only (must PASS) and against
#   the broken stub (must FAIL for real contract reasons).
#   Exit non-zero if any required outcome is wrong.
#
# Usage:
#   bash tests/graph_store/run_contract.sh
#   bash tests/graph_store/run_contract.sh --files-only-only
#   bash tests/graph_store/run_contract.sh --stub-only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_PARENT="$ROOT/skills/foreman"
export PYTHONPATH="${PKG_PARENT}${PYTHONPATH:+:$PYTHONPATH}"

mode="all"
for a in "$@"; do
  case "$a" in
    --files-only-only) mode="files" ;;
    --stub-only) mode="stub" ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $a" >&2
      exit 2
      ;;
  esac
done

fail=0

if [[ "$mode" == "all" || "$mode" == "files" ]]; then
  echo "=== contract suite: files_only (must PASS) ==="
  if ! python3 -m graph_store.contract_suite files_only; then
    echo "HARNESS FAIL: files_only suite did not pass" >&2
    fail=1
  fi
fi

if [[ "$mode" == "all" || "$mode" == "stub" ]]; then
  echo "=== contract suite: stub (must FAIL — soundness) ==="
  if ! python3 -m graph_store.contract_suite stub --expect-fail; then
    echo "HARNESS FAIL: stub did not fail the suite soundly" >&2
    fail=1
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo "HARNESS FAILED" >&2
  exit 1
fi
echo "HARNESS OK"
exit 0
