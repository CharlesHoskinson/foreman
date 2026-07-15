#!/usr/bin/env bash
# Idempotent WSL/Ubuntu bootstrap for Foreman reference environment.
# Usage: bash env/bootstrap-wsl.sh [--profile soft|hard|full] [--yes]
# Safe defaults: apt update once; only installs missing must-tools.
set -euo pipefail

PROFILE="full"
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help)
      echo "usage: bootstrap-wsl.sh [--profile soft|hard|full] [--yes]"
      exit 0
      ;;
    *) echo "unknown: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[foreman-bootstrap] %s\n' "$*"; }

if [[ $YES -ne 1 ]]; then
  log "This will install missing packages for profile=$PROFILE (apt/npm as needed)."
  log "Re-run with --yes to proceed non-interactively."
  read -r -p "Continue? [y/N] " ans
  [[ "${ans:-}" =~ ^[Yy]$ ]] || { log "aborted"; exit 0; }
fi

export DEBIAN_FRONTEND=noninteractive
log "apt-get update..."
sudo apt-get update -y

have() { command -v "$1" >/dev/null 2>&1; }

install_apt() {
  local pkgs=("$@")
  local need=()
  local p
  for p in "${pkgs[@]}"; do
    if ! dpkg -s "$p" >/dev/null 2>&1; then need+=("$p"); fi
  done
  if [[ ${#need[@]} -gt 0 ]]; then
    log "apt install: ${need[*]}"
    sudo apt-get install -y "${need[@]}"
  else
    log "apt packages already present: ${pkgs[*]}"
  fi
}

# Base always useful
install_apt ca-certificates curl git jq util-linux coreutils python3 python3-pip python3-venv

# shellcheck / bats for hard/full
if [[ "$PROFILE" == "hard" || "$PROFILE" == "full" ]]; then
  install_apt shellcheck bats 2>/dev/null || install_apt shellcheck || true
  # bats package name varies
  have bats || sudo apt-get install -y bats || log "WARN: bats not available via apt"
fi

# Node via nodesource or apt nodejs (for npm/codex)
if ! have node || ! have npm; then
  if have npm; then
    log "npm present"
  else
    log "installing nodejs/npm via apt (LTS-ish distro package)"
    install_apt nodejs npm || {
      log "WARN: node/npm apt install failed — install fnm/node manually for codex npm install"
    }
  fi
fi

# Codex CLI
if ! have codex; then
  if have npm; then
    log "npm install -g @openai/codex"
    npm install -g @openai/codex || sudo npm install -g @openai/codex || log "WARN: codex npm install failed"
  else
    log "WARN: cannot install codex without npm"
  fi
else
  log "codex already present: $(codex --version 2>&1 | head -1)"
fi

# Grok — cannot fully auto-install without vendor installer; print hint
if ! have grok; then
  log "MISSING grok — install Grok Build from https://x.ai/cli then: grok login"
  log "If you have a Windows install, ensure it is on PATH inside WSL or install the Linux binary."
else
  log "grok already present: $(grok --version 2>&1 | head -1)"
fi

# Claude — hint only
if ! have claude; then
  log "OPTIONAL claude — install Claude Code if this WSL is the architect host"
else
  log "claude present: $(claude --version 2>&1 | head -1)"
fi

# Docker CE (hard/full) — conservative, only if missing
if [[ "$PROFILE" == "hard" || "$PROFILE" == "full" ]]; then
  if have docker && docker info >/dev/null 2>&1; then
    log "docker daemon OK"
  elif have docker; then
    log "docker binary present; ensuring service..."
    sudo systemctl enable --now docker 2>/dev/null || log "WARN: could not start docker (need systemd enabled WSL)"
  else
    log "installing docker-ce via get.docker.com convenience script"
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "${USER:-$(id -un)}" || true
    sudo systemctl enable --now docker 2>/dev/null || log "WARN: enable docker after systemd is active; then: wsl --shutdown"
    log "NOTE: re-login or wsl --shutdown for docker group membership"
  fi
fi

# gh optional
if [[ "$PROFILE" == "hard" || "$PROFILE" == "full" ]]; then
  if ! have gh; then
    install_apt gh 2>/dev/null || log "OPTIONAL: install GitHub CLI (gh) for pr-open"
  fi
fi

# Foreman skill link
if [[ -x "$ROOT/install.sh" ]]; then
  log "running install.sh (skill + agents)"
  bash "$ROOT/install.sh"
elif [[ -f "$ROOT/install.sh" ]]; then
  bash "$ROOT/install.sh"
else
  log "WARN: install.sh missing"
fi

# FOREMAN_HOME
mkdir -p "${HOME}/.foreman/runs"

log "re-running tool-check..."
bash "$ROOT/env/tool-check.sh" --profile "$PROFILE" --json --out "${HOME}/.foreman/last-tool-check.json" \
  || log "tool-check reports not fully ready — see ${HOME}/.foreman/last-tool-check.json"

log "bootstrap finished for profile=$PROFILE"
log "Auth still required if missing: grok login ; codex login ; claude auth"
