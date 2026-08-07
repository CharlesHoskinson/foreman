#!/usr/bin/env bash
# Thin adapter → skills/foreman/runtime/dist/foreman-setup.js
# Domain logic lives in packages/orchestration/src/foreman-setup*.ts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
BUNDLE="$ROOT/runtime/dist/foreman-setup.js"
if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi
if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi
exec "$NODE" "$BUNDLE" "$@"
