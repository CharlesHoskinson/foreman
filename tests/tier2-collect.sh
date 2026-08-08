#!/usr/bin/env bash
# @description Explicit manual Tier 2 collector. Never invoke automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/skills/foreman/runtime/dist/tier2-collect.js"
exec "$NODE" "$BUNDLE" "$@"
