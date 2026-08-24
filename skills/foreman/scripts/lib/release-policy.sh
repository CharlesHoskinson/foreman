#!/usr/bin/env bash
# Thin compatibility adapter for the compiled v0.4 release policy.
set -euo pipefail

readonly EXIT_CONFIG=2
readonly EXIT_MISSING_CLI=3

if (( $# != 14 )); then
  printf 'release-policy: invalid invocation\n' >&2
  exit "$EXIT_CONFIG"
fi

SCRIPT_DIR="$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)"
SKILL_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly ARTIFACT="$SKILL_ROOT/runtime/dist/release-policy.js"
if [[ ! -f "$ARTIFACT" ]]; then
  printf 'release-policy: runtime artifact missing\n' >&2
  exit "$EXIT_CONFIG"
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  printf 'release-policy: Node runtime missing\n' >&2
  exit "$EXIT_MISSING_CLI"
fi

exec "$NODE_BIN" "$ARTIFACT" check \
  --endstop-state-root "$1" \
  --endstop-contract-id "$2" \
  --endstop-contract-sha "$3" \
  --endstop-family-sha "$4" \
  --endstop-child-id "$5" \
  --endstop-action "$6" \
  --endstop-candidate-sha "$7" \
  --release-program "$8" \
  --release-phase "$9" \
  --release-owner "${10}" \
  --release-repo "${11}" \
  --release-candidate-commit "${12}" \
  --release-register "${13}" \
  --release-evidence "${14}"
