# Reference environment (Windows + WSL2)

Foreman’s **reference development environment** is:

| Layer | Role |
|---|---|
| **Windows host** | Soft-mode architect (Claude Code), Grok CLI, Codex CLI, git, Python ≥ 3.11 |
| **WSL2 Ubuntu** | Hard-mode bash harness, jq, Docker CE, shellcheck/bats, optional gh |

Related machine setup (optional full laptop bootstrap): `C:\Users\charl\wsl-setup\`  
Foreman-specific inventory lives in this repo under `env/`.

## Profiles

| Profile | Use when |
|---|---|
| `soft` | Default daily Foreman: Grok implement + Codex audit |
| `hard` | WSL harness + Docker worker path |
| `full` | Soft + hard on the same reference box |

Source of truth: `env/reference-manifest.toml`.

## Pre-implementation gate (architect duty)

**Before any multi-step implementation**, the Foreman architect (Fable preferred) must:

1. **Inventory** — run tool-check for the active profile  
2. **Report** — show READY / MISSING / OUTDATED to the user  
3. **Install** — if not ready, run bootstrap (ask once unless user said “just fix it”)  
4. **Re-check** — only then write five-part specs and spawn implementers  

Do **not** start `grok-implementer` / hard INIT while must-tools are missing.

### Commands

**Windows (PowerShell), soft:**

```powershell
cd C:\Users\charl\foreman   # or your clone
.\env\tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json
# if not ready:
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

**WSL, hard/full:**

```bash
cd /mnt/c/Users/charl/foreman   # adjust path
bash env/tool-check.sh --profile hard --json --out ~/.foreman/last-tool-check.json
bash env/bootstrap-wsl.sh --profile hard --yes
bash env/tool-check.sh --profile hard
```

Exit codes: `0` = READY, `1` = not ready.

## What bootstrap installs (high level)

| Tool | Soft | Hard | Notes |
|---|---|---|---|
| git | yes | yes | winget / apt |
| Python ≥ 3.11 + tomllib | yes | yes | hard scripts need tomllib |
| jq | should | yes | gate / meta.json |
| Grok CLI | yes | should | manual vendor install + `grok login` |
| Codex CLI | yes | should | `npm i -g @openai/codex` + `codex login` |
| Claude Code | should | optional | architect host |
| Node/npm | should | should | to install codex |
| Docker CE | — | yes | native in WSL (not Desktop required) |
| flock / util-linux | — | yes | worktree serialization |
| shellcheck / bats | — | should | harness quality |
| gh | — | should | PR stage |
| Foreman skill links | yes | yes | `install.ps1` / `install.sh` |

**Auth is never automated:** after install, user still runs `grok login` / `codex login`.

## Architect report template

After tool-check, emit:

```
ENV INVENTORY
profile: soft|hard|full
READY: yes|no
MISSING: ...
OUTDATED: ...
DEGRADED: ...
ACTION: none | ran bootstrap-windows | ran bootstrap-wsl | needs user: <login/manual>
RECHECK: path to last-tool-check.json
```

## Relationship to general wsl-setup

`wsl-setup/` is a **full machine** runbook (Ubuntu 26.04, Nix, YubiKey, languages).  
`env/bootstrap-wsl.sh` is a **minimal Foreman delta**: jq, docker, codex, skill install, harness deps. Prefer wsl-setup first on a greenfield PC; use `env/` on every Foreman session for inventory + gap fill.
