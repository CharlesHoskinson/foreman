#!/usr/bin/env bash
# Thin adapter for the Foreman Endstop Node.js runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/runtime/dist/execution-guard.js"

if [[ ! -f "$BUNDLE" ]]; then
  printf '%s\n' 'Foreman Endstop: NOT_READY (runtime missing)' >&2
  exit 1
fi

exec node "$BUNDLE" "$@"
