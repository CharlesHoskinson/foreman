#!/usr/bin/env bash
# Foreman dependency-drift reconciler - thin Node adapter.
# Domain logic lives in packages/orchestration/src/dependency-drift.ts
# (bundled as skills/foreman/runtime/dist/dependency-drift.js).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/skills/foreman/runtime/dist/dependency-drift.js"
exec "$NODE" "$BUNDLE" "$@"
