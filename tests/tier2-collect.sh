#!/usr/bin/env bash
# @description Explicit manual Tier 2 collector. Never invoke automatically.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$SCRIPT_DIR/tier2_collect.py" "$@"
