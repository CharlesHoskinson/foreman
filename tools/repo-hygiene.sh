#!/usr/bin/env bash
# Foreman repository hygiene checks - thin Node adapter.
# Domain logic lives in packages/policy/src/repo-hygiene.ts
# (bundled as skills/foreman/runtime/dist/repo-hygiene.js).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/skills/foreman/runtime/dist/repo-hygiene.js"
exec "$NODE" "$BUNDLE" "$@"
