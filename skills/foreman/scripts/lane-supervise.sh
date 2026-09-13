#!/usr/bin/env bash
# Thin adapter → skills/foreman/runtime/dist/lane-supervise.js
# Domain logic lives in packages/orchestration/src/supervisor*.ts (R5D).
#
# Usage (shell sugar): lane-supervise.sh [--dry-run] (--once RUN | --all)
# The adapter injects --state-root from FOREMAN_HOME and forwards the rest
# to the Node supervisor CLI:
#   lane-supervise.js --state-root ROOT [--dry-run] (--once RUN | --all)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
BUNDLE="$ROOT/runtime/dist/lane-supervise.js"
if [ -z "$NODE" ]; then echo "lane-supervise: node is required" >&2; exit 3; fi
if [ ! -f "$BUNDLE" ]; then echo "lane-supervise: runtime bundle missing" >&2; exit 3; fi
# shellcheck source=lib/common.sh
# FOREMAN_HOME default matches lib/common.sh without sourcing product code.
FOREMAN_HOME="${FOREMAN_HOME:-$HOME/.foreman}"
exec "$NODE" "$BUNDLE" --state-root "$FOREMAN_HOME" "$@"
