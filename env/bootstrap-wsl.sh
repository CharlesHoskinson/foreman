#!/usr/bin/env bash
# Idempotent WSL/Ubuntu bootstrap for Foreman reference environment.
# Usage: bash env/bootstrap-wsl.sh [--profile soft|hard|full|durable] [--yes]
# Safe defaults: apt update once; only installs missing must-tools.
# v0.2.7.5 package-3 (wsl-reliability-env-refresh) Task 1: full WSL-native
# provisioner -- adds fnm-managed node/npm (fixes the apt npm-9.2.0-vs-node-22
# mismatch), bun (pinned 1.3.14), pueue (GitHub release binary), and
# WSL-native codex/grok via npm (fixes the Windows-npm-shim PATH leak, see
# Task 2's appendWindowsPath=false). Every install below is idempotent
# (skip-if-present-and-correct) and every WSL-native binary is symlinked into
# /usr/local/bin at the end so it resolves the same regardless of shell type
# (login/non-login, interactive/non-interactive) or PATH-leak state.
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

# @description Check whether a command resolves to a WSL-native binary (not
#   a /mnt/... Windows-mounted one) and actually runs. A bare `have` check is
#   not enough on this host: while appendWindowsPath is still true (pre-Task-2
#   wsl.conf fix) or before a tool is reprovisioned, `have` can be satisfied by
#   a leaked Windows-side shim (codex, grok, markdownlint-cli2 were all
#   observed doing this during this task's proof) which then either crashes
#   (codex: "Missing optional dependency @openai/codex-linux-x64") or silently
#   never gets a WSL-native install because the bare-`have` guard already
#   looked satisfied. See Task 2 (wsl-reliability-env-refresh) for the
#   companion appendWindowsPath=false fix.
# @arg $1 command name
# @exitcode 0 native and runnable; 1 otherwise (missing, or resolves under /mnt)
native_ok() {
  local resolved
  have "$1" || return 1
  resolved="$(command -v "$1")"
  [[ "$resolved" != /mnt/* ]] || return 1
  "$1" --version >/dev/null 2>&1
}

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

# Base always useful. util-linux-extra carries `hwclock` on this Ubuntu
# release (split out of the base util-linux package) -- needed by the Task 4
# clock-sync resume hook (env/wsl-clock-resync-task.xml runs `hwclock -s`
# inside WSL); discovered missing (dpkg -L util-linux has no bin/sbin
# entries for it at all) while wiring up that hook for real.
install_apt ca-certificates curl git jq util-linux util-linux-extra coreutils bash python3 python3-pip python3-venv

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

# Static-analysis + test-harness tools for hard/full profiles.
# NOTE: a comment line starting with the literal words "shellcheck " right
# after the "#" is parsed by the shellcheck(1) tool itself as one of ITS OWN
# inline directives (e.g. "# shellcheck disable=SC2034") -- an earlier
# revision of this comment collided with that syntax (SC1072/SC1073 parse
# errors), only caught once shellcheck was actually wired up and run for
# real on this host during this task (see FOREMAN_REPORT.md).
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

# Node/npm via fnm (WSL-native, matched pair) -- v0.2.7.5 package-3 Task 1.
# Ubuntu's apt nodejs+npm pairing has drifted (node 22 + npm 9.2.0 -- npm
# shipped with node 22 is normally 10.x+); fnm gives a coherent, current pair
# and is the manifest's documented install_wsl route. Skip-if-present: an
# existing fnm-managed LTS install is reused, not reinstalled. Guarded on
# non-durable profiles only (durable's must-list is git/jq/coreutils/bash).
NODE_BIN_DIR=""
if [[ "$PROFILE" != "durable" ]]; then
  FNM_ROOT="$HOME/.foreman/tools/fnm"
  if [[ ! -x "$FNM_ROOT/fnm" ]]; then
    log "installing fnm (node version manager) to $FNM_ROOT"
    mkdir -p "$FNM_ROOT"
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$FNM_ROOT" --skip-shell \
      || log "WARN: fnm install failed (network?) -- will fall back to apt nodejs/npm"
  fi

  if [[ -x "$FNM_ROOT/fnm" ]]; then
    export FNM_DIR="$FNM_ROOT"
    export PATH="$FNM_ROOT:$PATH"
    if ! "$FNM_ROOT/fnm" list 2>/dev/null | grep -q 'v[0-9]'; then
      log "fnm install --lts"
      # One retry: an occasional transient zip-extraction failure was observed
      # during this task's proof (cold cache / first-run hiccup, not
      # reproducible on retry) -- cheap insurance, not a masking loop.
      "$FNM_ROOT/fnm" install --lts || {
        log "fnm install --lts failed once — retrying"
        "$FNM_ROOT/fnm" install --lts || log "WARN: fnm install --lts failed twice (network?)"
      }
    fi
    FNM_LTS_VER="$("$FNM_ROOT/fnm" list 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1)"
    if [[ -n "$FNM_LTS_VER" ]]; then
      "$FNM_ROOT/fnm" default "$FNM_LTS_VER" >/dev/null 2>&1 || true
      NODE_BIN_DIR="$FNM_ROOT/node-versions/$FNM_LTS_VER/installation/bin"
    fi
  fi

  if [[ -n "$NODE_BIN_DIR" && -x "$NODE_BIN_DIR/node" ]]; then
    export PATH="$NODE_BIN_DIR:$PATH"
    log "fnm-managed node: $("$NODE_BIN_DIR/node" --version) / npm $("$NODE_BIN_DIR/npm" --version)"
  else
    NODE_BIN_DIR=""
    log "fnm unavailable -- falling back to apt nodejs/npm (may keep the node/npm version mismatch)"
    install_apt nodejs npm || log "WARN: node/npm apt install failed — install fnm/node manually for codex npm install"
  fi
fi

# Bun -- HELD at 1.3.14 (1.4 is canary-only; do NOT upgrade in this change).
if [[ "$PROFILE" == "full" ]]; then
  if have bun && [[ "$(bun --version 2>&1)" == "1.3.14" ]]; then
    log "bun 1.3.14 already present"
  else
    log "installing bun 1.3.14 (pinned; official install script)"
    curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14" || log "WARN: bun install failed"
  fi
fi

# pueue -- WSL-native GitHub release binary (held at 4.0.4; no apt package;
# mirrors the Windows-side ~/.foreman/tools/pueue/{pueue.exe,pueued.exe}
# convention, minus the .exe extension).
if [[ "$PROFILE" == "full" ]]; then
  PUEUE_VER="4.0.4"
  PUEUE_DIR="$HOME/.foreman/tools/pueue"
  if [[ -x "$PUEUE_DIR/pueue" ]] && "$PUEUE_DIR/pueue" --version 2>&1 | grep -q "$PUEUE_VER"; then
    log "pueue $PUEUE_VER already present (WSL-native, $PUEUE_DIR)"
  else
    log "installing pueue $PUEUE_VER (GitHub release binary) to $PUEUE_DIR"
    mkdir -p "$PUEUE_DIR"
    if curl -fsSL -o "$PUEUE_DIR/pueue.new" "https://github.com/Nukesor/pueue/releases/download/v${PUEUE_VER}/pueue-x86_64-unknown-linux-musl" \
      && curl -fsSL -o "$PUEUE_DIR/pueued.new" "https://github.com/Nukesor/pueue/releases/download/v${PUEUE_VER}/pueued-x86_64-unknown-linux-musl"; then
      chmod +x "$PUEUE_DIR/pueue.new" "$PUEUE_DIR/pueued.new"
      mv -f "$PUEUE_DIR/pueue.new" "$PUEUE_DIR/pueue"
      mv -f "$PUEUE_DIR/pueued.new" "$PUEUE_DIR/pueued"
    else
      log "WARN: pueue download failed"
      rm -f "$PUEUE_DIR/pueue.new" "$PUEUE_DIR/pueued.new"
    fi
  fi
fi

# Documentation tools (soft/full docs group)
if [[ "$PROFILE" == "soft" || "$PROFILE" == "full" ]]; then
  if ! native_ok markdownlint-cli2; then
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
    # apt first (Debian ships a `codespell` package directly) -- avoids the
    # PEP 668 "externally-managed-environment" refusal newer Ubuntu/Debian
    # pip hits without --break-system-packages, observed during this task's
    # proof (Python 3.14 on Ubuntu 26.04).
    if install_apt codespell 2>/dev/null && have codespell; then
      log "codespell installed via apt"
    else
      log "pip3 install --user --break-system-packages codespell"
      pip3 install --user --break-system-packages codespell \
        || python3 -m pip install --user --break-system-packages codespell \
        || log "WARN: codespell install failed"
    fi
  else
    log "codespell present (CLI or Python module)"
  fi

  if ! native_ok lychee; then
    # GitHub release binary (musl static build) -- avoids requiring a full
    # Rust/cargo toolchain just for one CLI tool; same approach as pueue
    # above and as the Windows side (winget installs a prebuilt binary too).
    LYCHEE_VER="0.24.2"
    LYCHEE_DIR="$HOME/.foreman/tools/lychee"
    log "installing lychee $LYCHEE_VER (GitHub release binary) to $LYCHEE_DIR"
    mkdir -p "$LYCHEE_DIR"
    if curl -fsSL -o "$LYCHEE_DIR/lychee.tar.gz" \
      "https://github.com/lycheeverse/lychee/releases/download/lychee-v${LYCHEE_VER}/lychee-x86_64-unknown-linux-musl.tar.gz"; then
      # Release tarball nests the binary under a
      # lychee-x86_64-unknown-linux-musl/ directory -- --strip-components=1
      # plus an explicit member path pulls out just the binary.
      if tar -xzf "$LYCHEE_DIR/lychee.tar.gz" -C "$LYCHEE_DIR" --strip-components=1 \
        "lychee-x86_64-unknown-linux-musl/lychee"; then
        chmod +x "$LYCHEE_DIR/lychee"
      else
        log "WARN: lychee archive extraction failed"
      fi
      rm -f "$LYCHEE_DIR/lychee.tar.gz"
    else
      log "WARN: lychee download failed"
    fi
  else
    log "lychee already present (native): $(lychee --version 2>&1 | head -1)"
  fi
fi

# Codex CLI -- WSL-native. `@latest` (not a bare package name) is deliberate:
# an already-satisfied top-level package can otherwise let npm skip
# re-resolving the platform optionalDependency
# (@openai/codex-<os>-<arch>), which is exactly how this host's earlier
# apt-npm-provisioned install ended up without @openai/codex-linux-x64 and
# crashed with "Missing optional dependency" -- reproduced and confirmed
# during this task's proof (see FOREMAN_REPORT.md).
if native_ok codex; then
  log "codex already present (native): $(codex --version 2>&1 | head -1)"
elif have npm; then
  log "npm install -g @openai/codex@latest (WSL-native; forces optionalDependency platform-binary resolution)"
  npm install -g @openai/codex@latest || log "WARN: codex npm install failed"
else
  log "WARN: cannot install codex without a WSL-native npm (node/fnm step above failed)"
fi

# Grok Build CLI -- WSL-native via the npm mirror (avoids the
# Cloudflare-walled x.ai/cli host; verified route:
# openspec/changes/grok-lane-activation/design.md). Previously this script
# only printed a manual-install hint; v0.2.7.5 package 3 makes this a real
# WSL-native install like codex's, so `grok` never needs to fall back to a
# Windows-side binary leaking across the WSL interop PATH.
if native_ok grok; then
  log "grok already present (native): $(grok --version 2>&1 | head -1)"
elif have npm; then
  log "npm install -g @xai-official/grok@latest"
  npm install -g @xai-official/grok@latest || log "WARN: grok npm install failed"
  log "after install: grok login --device-code"
else
  log "WARN: cannot install grok without a WSL-native npm (node/fnm step above failed)"
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

# gh -- official cli.github.com apt repo, not Ubuntu's universe package.
# Discovered during Task 5 dependency reconciliation: Ubuntu 26.04's own
# `gh` package is pinned at 2.46.0-4 with no newer apt candidate (stuck;
# it does not track upstream releases), while upstream was already at
# 2.96.0 -- a real, non-cosmetic version gap (security fixes per the
# dependency table). The official repo also means future `apt-get upgrade`
# actually keeps gh current, instead of being silently stuck again.
if [[ "$PROFILE" == "hard" || "$PROFILE" == "full" ]]; then
  if [[ ! -f /etc/apt/sources.list.d/github-cli.list ]]; then
    log "adding official GitHub CLI apt repo (cli.github.com)"
    mkdir -p /etc/apt/keyrings && chmod 755 /etc/apt/keyrings
    if curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; then
      chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
      sudo apt-get update -y
      # Not install_apt: gh may already be installed from Ubuntu's stale
      # universe package (dpkg -s would already succeed, so install_apt's
      # skip-if-present guard would never see the newly-available, newer
      # candidate) -- `apt-get install` on an already-installed package
      # upgrades it to the current candidate, which is exactly what a
      # freshly-added repo needs.
      log "installing/upgrading gh from the official repo"
      sudo apt-get install -y gh || log "WARN: gh install from the official repo failed"
    else
      log "WARN: could not fetch the GitHub CLI apt keyring; falling back to Ubuntu's gh package"
      install_apt gh 2>/dev/null || log "OPTIONAL: install GitHub CLI (gh) for pr-open"
    fi
  else
    install_apt gh 2>/dev/null || log "OPTIONAL: install GitHub CLI (gh) for pr-open"
  fi
fi

# @description Symlink a WSL-native binary into /usr/local/bin, when present.
#   WSL's own compiled-in native PATH already includes /usr/local/sbin and
#   /usr/local/bin ahead of /usr/sbin and /usr/bin (verified empirically:
#   even `env -i wsl -u root -- bash -c ...` sees it — it is injected at the
#   WSL-interop level, not by any shell rc file), so a symlink placed here
#   resolves identically regardless of shell type (login/non-login,
#   interactive/non-interactive) — which matters because `bash
#   env/tool-check.sh` and CI-style invocations are non-interactive and never
#   source ~/.bashrc. This is belt-and-braces alongside the Task 2
#   appendWindowsPath=false fix, and is what makes fnm/bun/pueue/codex/grok
#   resolve without requiring any shell profile to be sourced first.
# @arg $1 the desired command name on PATH
# @arg $2 the real (WSL-native) binary's path
link_native() {
  local name="$1" src="$2"
  [[ -x "$src" ]] || return 0
  ln -sf "$src" "/usr/local/bin/$name"
}

if [[ -n "$NODE_BIN_DIR" ]]; then
  link_native node "$NODE_BIN_DIR/node"
  link_native npm  "$NODE_BIN_DIR/npm"
  link_native npx  "$NODE_BIN_DIR/npx"
fi
if have npm; then
  npm_g_bin="$(npm prefix -g 2>/dev/null)/bin"
  link_native codex "$npm_g_bin/codex"
  link_native grok  "$npm_g_bin/grok"
  link_native markdownlint-cli2 "$npm_g_bin/markdownlint-cli2"
fi
link_native bun    "$HOME/.bun/bin/bun"
link_native pueue  "$HOME/.foreman/tools/pueue/pueue"
link_native pueued "$HOME/.foreman/tools/pueue/pueued"
link_native lychee "$HOME/.foreman/tools/lychee/lychee"

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
