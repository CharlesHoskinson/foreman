#!/usr/bin/env bash
# Foreman reference-env inventory (Linux / WSL) — thin Node adapter.
# Domain logic lives in packages/orchestration/src/tool-check*.ts
# (bundled as skills/foreman/runtime/dist/tool-check.js).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/skills/foreman/runtime/dist/tool-check.js"
exec "$NODE" "$BUNDLE" "$@"
