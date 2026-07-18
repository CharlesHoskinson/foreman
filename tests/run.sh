#!/usr/bin/env bash
# @description Run the Foreman bats suite. Finds bats on PATH or ~/.foreman/tools/bats-core.
#   FAST=1 bash tests/run.sh runs only the non-"slow"-tagged subset (via
#   --filter-tags '!slow') for a quick inner-loop check; default (FAST unset)
#   runs the full suite, unchanged.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BATS="${BATS:-$(command -v bats || true)}"
if [[ -z "$BATS" && -x "$HOME/.foreman/tools/bats-core/bin/bats" ]]; then
  BATS="$HOME/.foreman/tools/bats-core/bin/bats"
fi
if [[ -z "$BATS" ]]; then
  echo "bats not found. Install: git clone https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core" >&2
  exit 2
fi
if [[ "${FAST:-0}" == 1 ]]; then
  exec "$BATS" --filter-tags '!slow' "$@" .
fi
exec "$BATS" "$@" .
