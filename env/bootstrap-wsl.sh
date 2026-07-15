#!/usr/bin/env bash
# Idempotent WSL/Ubuntu bootstrap for Foreman reference environment.
# Usage: bash env/bootstrap-wsl.sh [--profile soft|hard|full|durable] [--yes]
# Safe defaults: apt update once; only installs missing must-tools.
set -euo pipefail

PROFILE="full"
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help)
      echo "usage: bootstrap-wsl.sh [--profile soft|hard|full|durable] [--yes]"
      exit 0
      ;;
    *) echo "unknown: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# @description Print a message with the Foreman bootstrap prefix.
# @arg $1 message message text; additional arguments are joined with spaces
# @stdout the prefixed bootstrap message
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

# @description Test whether an executable is available on PATH.
# @arg $1 command executable name to resolve
# @exitcode 0 if the executable is available; nonzero otherwise
have() { command -v "$1" >/dev/null 2>&1; }

# @description Install only the requested Debian packages that are not already registered by dpkg.
# @arg $1 package Debian package name; additional package names are also accepted
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
install_apt ca-certificates curl git jq util-linux coreutils bash python3 python3-pip python3-venv

# Durable-lanes transport (optional at runtime, installed by the durable profile)
if [[ "$PROFILE" == "durable" ]]; then
  if ! have nats-server; then
    log "installing nats-server from binaries.nats.dev"
    curl -fsSL https://binaries.nats.dev/nats-io/nats-server/v2@latest | sh
  else
    log "nats-server already present"
  fi
  if ! have nats; then
    log "installing nats CLI from binaries.nats.dev"
    curl -sf https://binaries.nats.dev/nats-io/natscli/nats@latest | sh
  else
    log "nats CLI already present"
  fi
fi

# shellcheck / bats for hard/full
if [[ "$PROFILE" == "hard" || "$PROFILE" == "full" ]]; then
  install_apt shellcheck bats 2>/dev/null || install_apt shellcheck || true
  # bats package name varies
  have bats || sudo apt-get install -y bats || log "WARN: bats not available via apt"
fi

if ! have bats && [[ ! -x "$HOME/.foreman/tools/bats-core/bin/bats" ]]; then
  log "installing bats-core via git clone (test harness for tests/run.sh)"
  git clone --depth 1 https://github.com/bats-core/bats-core "$HOME/.foreman/tools/bats-core" \
    || log "WARN: bats-core clone failed"
else
  log "bats present (PATH or ~/.foreman/tools/bats-core)"
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

# Documentation tools (soft/full docs group)
if [[ "$PROFILE" == "soft" || "$PROFILE" == "full" ]]; then
  if ! have markdownlint-cli2; then
    if have npm; then
      log "npm install -g markdownlint-cli2"
      npm install -g markdownlint-cli2 || sudo npm install -g markdownlint-cli2 || log "WARN: markdownlint-cli2 install failed"
    else
      log "WARN: cannot install markdownlint-cli2 without npm"
    fi
  else
    log "markdownlint-cli2 already present"
  fi

  if ! { have codespell && codespell --version >/dev/null 2>&1; } \
    && ! python3 -m codespell_lib --version >/dev/null 2>&1 \
    && ! python -m codespell_lib --version >/dev/null 2>&1; then
    log "pip3 install --user codespell"
    pip3 install --user codespell || python3 -m pip install --user codespell || log "WARN: codespell install failed"
  else
    log "codespell present (CLI or Python module)"
  fi

  if ! have lychee; then
    if have cargo; then
      log "cargo install lychee --locked"
      cargo install lychee --locked \
        || { have cargo-binstall && cargo binstall -y lychee; } \
        || log "WARN: lychee install failed"
    else
      log "WARN: cargo missing — install Rust, then: cargo install lychee --locked"
    fi
  else
    log "lychee already present"
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
