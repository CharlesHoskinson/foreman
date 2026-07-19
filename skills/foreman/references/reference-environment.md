# Reference environment (Windows + WSL2)

Foreman’s **reference development environment** is:

| Layer | Role |
|---|---|
| **Windows host** | Soft-mode architect (Claude Code), Grok CLI, Codex CLI, git, Python ≥ 3.11 |
| **WSL2 Ubuntu** | Co-equal, fully-provisioned environment (v0.2.7.5 package 3): the same three-stage lifecycle (Setup/Use/Cleanup) runs identically to Windows -- WSL-native bats/shellcheck/bun/pueue/codex/grok/jq/node-npm, not a subset |

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
| Grok CLI | yes | should | WSL: `npm i -g @xai-official/grok` (WSL-native, v0.2.7.5 pkg-3) + `grok login --device-code`; Windows: manual vendor install + `grok login` |
| Codex CLI | yes | should | `npm i -g @openai/codex@latest` (both sides) + `codex login`; WSL install forces `@latest` so npm re-resolves the platform optionalDependency binary |
| Claude Code | should | optional | architect host |
| Node/npm | should | should | WSL: fnm-managed LTS (`env/bootstrap-wsl.sh`), not the apt package -- apt's node22/npm9.2.0 pairing was mismatched; Windows: winget |
| Docker CE | — | yes | native in WSL (not Desktop required) |
| flock / util-linux | — | yes | worktree serialization |
| shellcheck / bats | — | should | apt on both WSL (`shellcheck`, `bats`) and Windows (winget); harness quality |
| bun | — | should | pinned 1.3.14 both sides (1.4 is canary; do not upgrade) |
| pueue | — | should | WSL: GitHub release binary at `~/.foreman/tools/pueue/{pueue,pueued}` (v4.0.4, no apt package); Windows: same convention with `.exe` |
| gh | — | should | PR stage |
| Foreman skill links | yes | yes | `install.ps1` / `install.sh` |

Every WSL-native binary bootstrap-wsl.sh installs is also symlinked into
`/usr/local/bin` (ahead of `/usr/bin` in WSL's own compiled-in PATH, verified
present even under `env -i`), so it resolves the same regardless of shell
type -- `bash env/tool-check.sh` is a non-interactive, non-login invocation
that never sources `~/.bashrc`.

**Auth is never automated:** after install, user still runs `grok login` / `codex login`.

## Codex auth: headless vs interactive (v0.2.8.1)

Observed version: **0.144.x**. `codex login --device-auth` (the interactive
path) falls back to a **localhost:1455** browser callback flow, and its
local callback server dies the moment the launching shell is detached — it
must be **operator-run** in a persistent foreground shell (`! codex login`),
never launched by an orchestrator/automation and left to run detached.
`--device-auth`'s localhost callback flow is documented here to explain why
it must stay operator-run — it is NOT a headless option.

For unattended/headless auth, use `--with-api-key` instead, piping the key
on stdin (never as a CLI argument, never logged):

```bash
printenv OPENAI_API_KEY | codex login --with-api-key
```

## WSL interop: `appendWindowsPath` (v0.2.7.5 package 3)

`/etc/wsl.conf`'s `[interop]` section is set to `appendWindowsPath=false`.
Before this fix, `codex` (and any other npm-global CLI installed on both
sides) resolved the **Windows** npm shim leaked onto WSL's PATH by the
default `appendWindowsPath=true` behavior, not the WSL-native install --
`wsl codex --version` crashed with `Error: Missing optional dependency
@openai/codex-linux-x64` (that npm package's platform-specific optional
dependency is `win32`-gated, so the WSL-side node runtime can never satisfy
it). Fix: install codex/grok/markdownlint-cli2 WSL-native (via fnm's npm,
forcing `@latest` so npm re-resolves the per-platform optionalDependency
instead of trusting an already-satisfied top-level package) AND set
`appendWindowsPath=false` so the leaked shim is no longer even reachable.
Re-probe after any `/etc/wsl.conf` edit: `wsl --shutdown` then re-run the
affected command (WSL forgets nothing else across a shutdown; it is a VM
restart, not a data-loss operation).

No Windows tool needs to remain reachable via the WSL interop PATH:
`foreman-launch.exe` is resolved relative to the repo root by `lane-run.sh`
(never via PATH lookup), and the `pueue.exe`/`pueued.exe` staged path plus
`docs-check.sh`'s `lychee.exe` `LOCALAPPDATA` fallback are Windows-host-context
paths exercised only when those scripts run directly on Windows (Git-Bash) --
never reached through WSL interop in the first place.

## `.wslconfig` tuning (v0.2.7.5 package 3)

`C:\Users\charl\.wslconfig` `[wsl2]` (not repo-tracked -- documented here):

- `processors=20` (was `24`) -- reserves host CPU headroom below the host's
  24 logical CPUs. This is a wall-clock-flake mitigation: `bugeventlog.md`'s
  2026-07-17 entries document concurrent bats suites corrupting wall-clock
  tests under full CPU contention; leaving 4 logical CPUs free for the host
  reduces (does not replace) that contention, alongside the existing gate
  mutex.
- `networkingMode=mirrored` + `dnsTunneling=true` -- verified active:
  `wslinfo --networking-mode` reports `mirrored`; `ip addr` inside WSL shows
  the host's real adapters (`eth1`/`eth2`, not a single NAT'd `eth0`);
  `/etc/resolv.conf`'s `nameserver 10.255.255.254` is the dnsTunneling proxy
  sentinel address, not a NAT gateway IP.
- `autoMemoryReclaim=gradual` -- background VM-memory-pressure behavior with
  no single-command instant probe; accepted without a `.wslconfig` parse
  error (confirmed by the same `wsl --shutdown` + clean reboot that verified
  the other settings above).
- `sparseVhd=true` -- sets the default for **newly created** WSL disks. This
  distro's `ext4.vhdx` predates the setting and `fsutil sparse queryflag`
  confirms it is NOT sparse; `wsl --manage Ubuntu-26.04 --set-sparse true`
  refused with "potential data corruption" on this WSL version (2.7.8.0),
  requiring an explicit `--allow-unsafe` to force retroactive conversion.
  Deliberately NOT passed -- a data-corruption warning is not a call to
  override silently. `sparseVhd=true` still stays in `.wslconfig` per the
  spec (governs any future fresh distro/disk); retroactively converting
  *this* disk is left to the user, `--allow-unsafe` and all.
- `memory=64GB` unchanged (host-starvation guard, kept per the plan).
- `virtiofs` intentionally NOT enabled (still buggy per current WSL release
  notes; a throwaway-distro trial only, never the primary distro).

## Clock-sync: protecting the event log across sleep/resume (v0.2.7.5 package 3)

WSL2's guest clock can lag the host's real clock after a Windows sleep/resume
cycle (the VM is paused during sleep and does not automatically catch up on
its own) -- a drifted clock would corrupt the foreman event log's timestamp
ordering invariants if a lane wrote a timestamped event while the two clocks
disagreed. Two complementary pieces:

- **Reactive (last-line guard):** `env/wsl-clock-preflight.sh
  [--threshold SECONDS] [--resync]` compares a WSL-side clock reading
  against a host-side reading and, past the threshold (default 5s), either
  resyncs (`--resync`, runs `hwclock -s`) or refuses + alerts (default) --
  never letting a timestamped write proceed while the clocks disagree.
  Fully injectable clock seam for tests (`WSL_CLOCK_CMD`/`HOST_CLOCK_CMD`/
  `CLOCK_RESYNC_CMD`, same family as `watch.sh`'s own `WATCH_CLOCK_CMD`
  seam) -- `tests/wsl-clock-preflight.bats` mocks a skewed clock
  deterministically, never touching the real system clock. Not yet wired
  into `foreman-setup.sh`/`lane-run.sh`'s own lane-start path (out of this
  package's file-ownership scope -- those scripts belong to the
  lifecycle-three-stage / grok-lane-activation packages); intended
  integration point for whichever of those next touches lane start: call
  this script and refuse to proceed on a nonzero exit, mirroring the
  auth-readiness gate's own pattern.
- **Proactive (resume hook):** `env/wsl-clock-resync-task.xml` is a Windows
  Scheduled Task template that fires on Event ID 1 from
  `Microsoft-Windows-Power-Troubleshooter` (the standard resume-from-sleep
  signal) and runs `wsl.exe -u root -- hwclock -s`. XML-well-formedness
  validated (`python3 -m xml.dom.minidom`); **NOT live-registered** on this
  host -- `Register-ScheduledTask` was refused by the current session's
  auto-mode permission classifier as a persistent, host-wide Task Scheduler
  change, and this was NOT worked around (per doctrine: document the
  blocker, do not force it). Install manually when ready:
  `schtasks /Create /TN "Foreman-WSL-Clock-Resync" /XML env\wsl-clock-resync-task.xml`
  (edit the template's `<UserId>` placeholder to the real account first).
  `hwclock` itself was missing from this WSL distro until this task
  (`util-linux-extra` -- Ubuntu split it out of the base `util-linux`
  package); `env/bootstrap-wsl.sh` now installs it.

## Architect report template

After tool-check, emit:

```text
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

## root->non-root migration inventory (v0.2.7.5 package 3, Task 6 — INVENTORY ONLY)

The foreman WSL distro's default user is `root` (`/etc/wsl.conf` has no
`[user]` section, and this task did not add one — the flip itself is
explicitly OUT of scope here, deferred to its own audited follow-up change).
This section is a probe-verified inventory of what such a flip would break,
so that follow-up change starts from facts, not guesses.

**`/root` is mode `0700` (`drwx------`), root-owned.** Every tool this
package installed WSL-native lives somewhere under it, and a non-root user
has *zero* filesystem access to any of it -- not "needs a permission fix",
genuinely unreadable:

| Path | Contents | Size (probe) |
|---|---|---|
| `/root/.foreman/tools/fnm/` | fnm + the fnm-managed node/npm | part of 235M `/root/.foreman` |
| `/root/.foreman/tools/bats-core/` | bats-core git clone (portability fallback) | (same) |
| `/root/.foreman/tools/pueue/{pueue,pueued}` | pueue v4.0.4 binaries | (same) |
| `/root/.foreman/tools/lychee/lychee` | lychee 0.24.2 binary | (same) |
| `/root/.foreman/runs/` | **event log + checkpoint state** (`FOREMAN_HOME`) | (same) |
| `/root/.bun/` | bun 1.3.14 | 89M |
| `/root/.local/lib/node_modules/` | npm -g global installs: `@openai/codex`, `@xai-official/grok`, `markdownlint-cli2`, plus unrelated non-foreman tools (`snarkjs`, others) sharing this same prefix | 4.0G total `/root/.local` (this WSL instance is a shared multi-project box, not foreman-dedicated -- see also `.cargo`/`.ghcup`/`.elan`/`.julia`/`.conda`/`.nix-profile`/`.hermes`/`.midnight-mongo` at `/root`'s top level, all unrelated to foreman) |
| `/root/.npmrc` | `prefix=/root/.local` (why npm -g lands there) | 20B |
| `/root/.codex/`, `/root/.grok/` | vendor auth/config + cache | 32K / 148M |
| `/root/.claude/skills/foreman`, `/root/.agents/skills/foreman`, `/root/.grok/skills/foreman` | foreman skill symlinks (`install.sh` output) | small |

**`/usr/local/bin` symlinks all resolve into `/root`** (this package's own
Task 1 fix, `link_native()` in `env/bootstrap-wsl.sh`): `node`, `npm`, `npx`,
`bun`, `codex`, `grok`, `markdownlint-cli2`, `pueue`, `pueued`, `lychee` are
every one a symlink whose target is under `/root/...`. A non-root default
user would find all ten silently broken (dangling symlink: target exists,
but is unreadable/unreachable by permission, not merely absent) the instant
the default user flipped, even though `/usr/local/bin` itself is
world-readable.

**Other root-owned/root-implicit state a flip would need to address:**

- **Docker group membership** — `/var/run/docker.sock` is `root:docker`
  mode `0660`. Root never needed group membership (root bypasses the
  check); a new non-root default user needs `usermod -aG docker <user>`,
  which `env/bootstrap-wsl.sh`'s docker section currently only runs in its
  fresh-install branch, not unconditionally.
- **Passwordless `sudo`** — every `sudo apt-get`/`sudo systemctl` call
  throughout `env/bootstrap-wsl.sh` is a no-op check for root (root doesn't
  need `sudo` at all) but would prompt for a password for a real non-root
  user unless a `NOPASSWD` sudoers rule is provisioned first.
  `/etc/sudoers.d/` currently has only the stock README -- no such rule
  exists for any account today.
- **No existing non-root human account** — `/etc/passwd` has no UID>=1000
  user besides the unrelated `nixbld1..32` Nix build users. A flip needs a
  real target account created first, not just a `wsl.conf` edit.
- **FOREMAN_HOME is `$HOME`-relative already** (`FOREMAN_HOME="${FOREMAN_HOME:-$HOME/.foreman}"`,
  `skills/foreman/scripts/lib/common.sh`) -- this one is NOT a migration
  blocker: a new user gets a fresh, empty `.foreman/` automatically. The
  risk is losing root's *existing* run history/checkpoints, not a code
  dependency on the literal path `/root`.
- **The resume-triggered clock-sync task is migration-safe by construction**:
  `env/wsl-clock-resync-task.xml` hardcodes `wsl.exe -u root -- hwclock -s`
  (an explicit `-u root`, not "whatever the default user is"), so it keeps
  working unchanged regardless of what the interactive default user is, as
  long as the `root` account itself still exists (it always does in a WSL
  distro).
- No repo script hardcodes a `/root/...` path (grep-verified) — the
  coupling is entirely in root-owned files ON DISK from this task's own
  installs, not in code.

**Recommended shape for the follow-up change (not executed here):** rather
than attempting to `chown -R`/migrate `/root`'s entangled, multi-project
home directory (4.6G+ of unrelated tool installs sharing it), the lower-risk
path is almost certainly to (a) create the new non-root account + grant it
passwordless sudo + docker group membership, then (b) re-run
`env/bootstrap-wsl.sh --profile full --yes` AS that user -- every install in
it is already skip-if-present idempotent, so it naturally (re)provisions
foreman's own tools under the new user's `$HOME` without touching root's
copies at all, and (c) only then flip `/etc/wsl.conf`'s `[user] default=`.
Root's own `/root` tree (and everything else living there) is untouched
either way.
