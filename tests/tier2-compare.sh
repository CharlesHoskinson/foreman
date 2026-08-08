#!/usr/bin/env bash
# @description Evaluate recorded Tier 2 research fixtures and tier policy.
# This is an explicit, manual, offline evaluator. It has no vendor-call path.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/skills/foreman/runtime/dist/tier2-compare.js"
exec "$NODE" "$BUNDLE" "$@"
