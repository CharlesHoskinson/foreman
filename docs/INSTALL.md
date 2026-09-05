# Install

The install story is two independent steps: **link the skill/agents** into
your tool homes (`install.ps1` / `install.sh`, this page), then **run Setup**
(tool inventory + bootstrap + vendor auth — [`docs/USAGE.md`](USAGE.md)
section 1). This page covers the first step in full and points at the
second; the README's section 8 has the condensed side-by-side quickstart if
you just want the short form.

## What install does

Both `install.ps1` (Windows) and `install.sh` (WSL/macOS/Linux) do the same
four things:

1. Link every directory under `skills/` into:
   - `~/.claude/skills/<name>`
   - `~/.agents/skills/<name>` (portable Agent Skills home)
   - `~/.grok/skills/<name>`
2. Copy `agents/*.md` into `~/.claude/agents/`.
3. Create `~/.foreman/runs` for host run state.
4. Print the next commands to run (tool-check, bootstrap, boot the
   architect).

**Honest-link behavior** — if a destination already exists as a real
directory (not a junction/symlink), install **skips it with a warning** and
never replaces it. That protects local overlays such as `*.local.md`
cookie vaults or private per-repo customizations. A destination that is
already a link pointing at this checkout (or at a shared common-skills tree
reached via `git rev-parse --git-common-dir`, e.g. from a worktree) is left
as-is — re-running install is idempotent.

Soft mode uses Claude Code as the typical architect host, but Claude Code is
not required by the harness itself — orchestration works from Grok or Codex
instead. Authenticated `grok` (default implementer) and authenticated
`codex` (default auditor, GPT-5.6 Sol) remain required for their lanes.
Missing lanes report `STATUS: unavailable`; they never silently become
Claude.

## Windows

```powershell
cd path\to\foreman
.\install.ps1
```

Uses `mklink /J` (directory junctions — do not require admin for
user-profile destinations). Links land under `$env:USERPROFILE\.claude\...`,
`\.agents\...`, `\.grok\...`.

Then Setup:

```powershell
.\env\tool-check.ps1 -Profile soft -Json -Out $env:USERPROFILE\.foreman\last-tool-check.json
# if not ready:
.\env\bootstrap-windows.ps1 -Profile soft -Yes
.\env\tool-check.ps1 -Profile soft
```

`skills/foreman/scripts/*.sh` (the lifecycle wrapper scripts, `wt-*.sh`,
`lane-*.sh`, `docs-check.sh`, and everything else under
`skills/foreman/scripts/`) are bash — run them under **Git Bash**, not
PowerShell, on Windows. Only the `env/*.ps1` scripts are PowerShell-native.
`install.sh` additionally marks those scripts executable
(`chmod +x`); `install.ps1` has no equivalent step since NTFS has no exec
bit — Git Bash resolves them via the shebang regardless.

## WSL / macOS / Linux

```bash
cd /path/to/foreman
chmod +x install.sh
./install.sh
```

Uses `ln -s` (symlinks). Links land under `${HOME}/.claude/...`,
`/.agents/...`, `/.grok/...`.

Then Setup — full WSL-native provisioning first, then the composed
readiness wrapper:

```bash
bash env/bootstrap-wsl.sh --profile soft --yes   # or hard | full | durable
bash skills/foreman/scripts/foreman-setup.sh --profile soft
```

On WSL, Setup builds `launcher/dist/foreman-launch` automatically when the
binary is absent and `bun` is available. The build is idempotent: an executable
already on disk is left untouched. If Setup warns that `bun` is unavailable,
install the pinned Bun version and use the manual fallback:

```bash
cd launcher && bun run build:posix
```

As of v0.2.7.5 (`wsl-reliability-env-refresh`), `bootstrap-wsl.sh` is a
**complete WSL-native provisioner** — bats-core, shellcheck, bun (pinned
1.3.14), pueue (GitHub release binary staged under
`~/.foreman/tools/pueue/`, no apt package), codex/grok (npm, forced
`@latest` so the platform-specific optional dependency re-resolves
correctly), jq, node/npm via fnm (not the apt package — apt's node22/npm9.2
pairing was mismatched), and `hwclock` (split out of base `util-linux` on
this distro). Every one of those binaries is symlinked into
`/usr/local/bin`, ahead of `/usr/bin` in WSL's compiled-in PATH, so `bash
env/tool-check.sh` resolves them identically whether or not the invoking
shell is interactive/login. `/etc/wsl.conf`'s `[interop]
appendWindowsPath=false` stops a leaked Windows npm shim (`codex`/`grok`
installed on both sides) from shadowing the WSL-native binary — before this
fix, WSL-side `codex` crashed with `Missing optional dependency
@openai/codex-linux-x64` because it was actually running the Windows shim.

WSL is a **co-equal, fully-provisioned environment**, not a POSIX helper
subset of Windows: the same three-stage lifecycle (Setup → Use → Cleanup)
runs identically there, per `skills/foreman/references/reference-environment.md`.

## Authentication (both platforms)

Setup owns vendor authentication and never automates it — you run the login
yourself, once per vendor, then Setup re-verifies:

| Vendor | Command |
|---|---|
| grok | `grok login --device-code` (browser-free device flow; alias `--device-auth`) — or set `XAI_API_KEY` |
| codex | `codex login` |
| claude | `claude auth login` |

## Boot the architect

```powershell
cd path\to\foreman
claude
```

```text
/model claude-fable-5-1
/foreman
```

Use the canonical model ID. Foreman does not accept the `fable` alias as
evidence that Fable 5.1 ran.

Restate the goal and mode in one short paragraph. Soft unless
`.foreman/config.toml` sets `mode = "hard"` or you ask for hard mode. From
here, follow [`docs/USAGE.md`](USAGE.md) for the full Use-round walkthrough
and [`README.md`](../README.md) for the mental model and honest
capabilities/limits.

## Uninstall

No automated uninstall script exists. The install scripts only create
junctions/symlinks (never copy the skill body itself, except `agents/*.md`),
so removing them is a manual, low-risk operation:

- Remove the `<name>` junction/symlink under each of `~/.claude/skills/`,
  `~/.agents/skills/`, `~/.grok/skills/` for any skill you no longer want
  linked (install never touches a real directory at that spot, so it stays
  safe to leave or remove yourself).
- Delete the copied files under `~/.claude/agents/` that match
  `agents/*.md` in this repo, if you want them gone.
- `~/.foreman/runs/` holds host-side run state (reports, event logs,
  evidence) independent of the skill links — remove it separately if you
  want a clean slate; nothing in install re-creates it destructively (it is
  `mkdir -p`, never a wipe).

## Troubleshooting

See [`docs/USAGE.md`](USAGE.md) section 8 for the full troubleshooting list
(Grok headless writes nothing, the concurrent-worktree git guards, the POSIX
launcher cascade, Codex timeouts, `jq` on Windows, bats location, lychee
PATH on fresh shells). The two install-specific gotchas:

- **A destination already exists as a real directory.** Install skips it
  with a warning rather than deleting your content — back up or remove the
  directory yourself, then re-run install.
- **PATH not refreshed after a bootstrap install.** Open a **new** shell
  after `bootstrap-windows.ps1`/`bootstrap-wsl.sh` installs a tool (winget,
  npm -g, or a GitHub-release binary) so the current shell's PATH cache
  picks it up before you re-run tool-check.
