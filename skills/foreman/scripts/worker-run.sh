#!/usr/bin/env bash
# IMPLEMENT stage — not fully shipped yet.
# Soft mode: use agents/grok-implementer.md or agents/codex-implementer.md instead.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

log "worker-run.sh is not implemented in this release."
log "Hard-mode containerized workers (Docker adapters) are still expanding."
log "Use soft mode: invoke grok-implementer or codex-implementer from the architect session."
log "See skills/foreman/SKILL.md § Soft mode and references/lanes.md."
exit "$EXIT_MISSING_CLI"
