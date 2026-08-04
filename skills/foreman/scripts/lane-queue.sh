#!/usr/bin/env bash
# Thin adapter → skills/foreman/runtime/dist/lane-queue.js
# (@foreman/orchestration queue admission).
#
# Topology source (caps pinned by authenticated T5b destructive-concurrency
# GREEN rows, docs/research/vendor-concurrency-results.md, 2026-07-18):
# for spec in grok:3 codex:2 misc:2 gate:1 agy:1
# Do not raise grok/codex without a GREEN row at the higher N.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BUNDLE="$ROOT/runtime/dist/lane-queue.js"
exec "$NODE" "$BUNDLE" "$@"
