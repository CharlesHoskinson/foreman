#!/usr/bin/env bash
# Thin adapter → skills/foreman/runtime/dist/foreman-setup.js
# Domain logic lives in packages/orchestration/src/foreman-setup*.ts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/runtime/dist/foreman-setup.js"
exec "$NODE" "$BUNDLE" "$@"
