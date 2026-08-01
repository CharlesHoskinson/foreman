#!/usr/bin/env bash
# @description Evaluate recorded Tier 2 research fixtures and tier policy.
# This is an explicit, manual, offline evaluator. It has no vendor-call path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$SCRIPT_DIR/tier2_compare.py" "$@"
