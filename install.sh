#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=skills/foreman/scripts/lib/common.sh
source "$SCRIPT_DIR/skills/foreman/scripts/lib/common.sh"

SKIP_TOOLS=0
[[ "${1:-}" == "--skip-tools" ]] && SKIP_TOOLS=1

if [[ $SKIP_TOOLS -eq 0 ]]; then
  grep -qi microsoft /proc/version 2>/dev/null \
    || log "WARNING: not running under WSL2 — WSL2 is the reference environment"
  for c in git jq python3 flock docker; do require_cmd "$c"; done
fi

SKILLS_HOME="${FOREMAN_SKILLS_HOME:-$HOME/.agents/skills}"
CLAUDE_SKILLS="${FOREMAN_CLAUDE_SKILLS:-$HOME/.claude/skills}"

mkdir -p "$SKILLS_HOME" "$CLAUDE_SKILLS"
rm -rf "$SKILLS_HOME/foreman"
cp -r "$SCRIPT_DIR/skills/foreman" "$SKILLS_HOME/foreman"
mkdir -p "$SKILLS_HOME/foreman/sandbox"
cp -r "$SCRIPT_DIR/sandbox/." "$SKILLS_HOME/foreman/sandbox/"
ln -sfn "$SKILLS_HOME/foreman" "$CLAUDE_SKILLS/foreman"
log "skill installed: $SKILLS_HOME/foreman (claude symlink: $CLAUDE_SKILLS/foreman)"

if [[ $SKIP_TOOLS -eq 0 ]]; then
  # shellcheck disable=SC2015 # log() always succeeds; no if-then-else ambiguity
  python3 -m pip install --user --quiet scrapling && log "scrapling installed" \
    || log "WARNING: scrapling install failed (pip)"
  if [[ ! -d "$SKILLS_HOME/graphify" ]]; then
    # shellcheck disable=SC2015 # log() always succeeds; no if-then-else ambiguity
    git clone --depth 1 https://github.com/Graphify-Labs/graphify "$SKILLS_HOME/graphify" \
      && log "graphify installed" || log "WARNING: graphify clone failed"
  fi
  for v in claude codex grok; do
    # shellcheck disable=SC2015 # log() always succeeds; no if-then-else ambiguity
    command -v "$v" >/dev/null 2>&1 && log "vendor CLI present: $v" \
      || log "vendor CLI MISSING: $v"
  done
  log "build the worker image with: docker build -t foreman-worker:latest -f sandbox/Dockerfile.worker sandbox/"
fi
log "done"
