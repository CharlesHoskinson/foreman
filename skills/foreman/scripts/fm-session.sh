#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
ENTRY="$HERE/runtime/dist/fm-session.js"
if [ -z "$NODE" ]; then echo "fm-session: node is required" >&2; exit 3; fi
if [ ! -f "$ENTRY" ]; then echo "fm-session: runtime bundle missing" >&2; exit 3; fi
exec "$NODE" "$ENTRY" "$@"
