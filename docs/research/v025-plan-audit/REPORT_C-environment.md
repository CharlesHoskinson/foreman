# foreman v0.2.5 Environment & Feasibility Audit

Host: Windows 11 Pro 10.0.26200, Git Bash primary, WSL Ubuntu (root, no sudo
password) available. Read-only checks only — nothing installed, nothing
modified during the audit. (Architect installed Bun 1.3.14 + pueue 4.0.4
immediately after, per the recommended sequence below.)

## 1. Bun

**Not installed anywhere on this host at audit time.** Checked and confirmed
absent: `which bun` in Git Bash; `~/.bun`, `AppData\Local\bun`; `winget list`;
WSL Ubuntu.

**Availability confirmed:**

- `winget search bun` → **`Oven-sh.Bun` version `1.3.14` is in the winget
  catalog today**, along with `Oven-sh.Bun.Baseline`/`.Profile` CPU-variant
  packages, also at 1.3.14.
- GitHub releases: latest tag is `bun-v1.3.14`. Last 8 tags: 1.3.14 back to
  1.3.7 — **no 1.4.x has shipped yet.** The plan's "adopt 1.4.x only after
  2+ patch releases" soak rule is currently dormant (nothing to soak).
- Minor discrepancy worth a footnote: the GitHub tag `bun-v1.3.14` reports
  `published_at: 2026-05-13`, while `REPORT_compile.md` cites the bun.com
  blog announcement date as 2026-07-08. Likely a tag-vs-blog timing artifact,
  not a version-identity problem.

**Recommended pinned install paths (either works):**

1. **winget** (has the exact version today):
   `winget install --id Oven-sh.Bun --version 1.3.14 -e`. Caveat: winget does
   not enforce the pin after install — a later `winget upgrade --all` would
   bump it. The launcher's own version-assert-and-warn covers this at
   runtime, but the manifest install command should still specify
   `--version 1.3.14`, and tool-check should verify the exact version.
2. **Official installer script** — `https://bun.sh/install.ps1` exposes a
   `-Version` PowerShell parameter (default `"latest"`), accepting
   `"1.3.14"`, `"v1.3.14"`, or `"bun-v1.3.14"`. No `BUN_VERSION` env var;
   `-Version` is the only knob.

**Project-level pinning** (`.bun-version` + `"packageManager":
"bun@1.3.14"`) is the correct approach per `oven-sh/setup-bun`'s documented
convention and is what Task 1's scaffold plans to create.

## 2. pueue

**Not installed, not on PATH at audit time** (Git Bash and WSL both checked).

**Package manager availability: none on this host.**

- `winget search pueue` → not in the winget catalog.
- `scoop` itself is not installed on this host, and pueue isn't confirmed in
  any scoop bucket (upstream README doesn't mention Scoop/Chocolatey).
- **GitHub releases is the only route.** Latest → **v4.0.4** (2026-03-02).
  Windows assets: `pueue-x86_64-pc-windows-msvc.exe` and
  `pueued-x86_64-pc-windows-msvc.exe` (statically linked). Cargo install is
  a fallback.

**Groups/parallel limits — confirmed supported**, matching the plan: README
documents task groups managed via `pueue group add/remove` and
`pueue parallel <N> [--group <name>]`. This directly supports the
`grok`(1)/`codex`(1)/`claude`(3)/`misc` design.

**Windows support**: README states "Windows is fully supported and working
fine for quite a while."

**pueued autostart on Windows — genuinely undocumented upstream.** The only
shipped service unit (`systemd.pueued.service`) is Linux-only. This is a real
doctrine gap the plan must decide, not just an install step — options: a
Scheduled Task (`schtasks /create` at logon), a Startup-folder shortcut, or
relying on the client auto-spawning `pueued` on first command (common pueue
behavior elsewhere, but not confirmed for this version/platform — worth an
empirical one-off test before committing to it as doctrine).

## 3. REPORT_compile.md / REPORT_ffi.md — caveats vs. plan's Global Constraints

Both reports read in full. The plan's Global Constraints carry most
load-bearing items faithfully: Bun pin + soak rule, `#31941`
no-hot-FFI-polling, the six-call FFI surface + verified Win32 constants
(144-byte buffer / offset 16 / `0x2000` / class 9 / `0x0101`), bigint-handle
discipline, `#18416`/`#17406`/`#18193` compile flags, non-reproducible-builds
→ CI-artifact-plus-SHA256, signtool signing, LGPL notice.

**Omissions found** (recorded in the research reports, not carried into the
plan):

| # | Caveat (report) | Relevance |
|---|---|---|
| 1 | `#19916` `--windows-icon`/`--windows-hide-console` broken on Win11 | Task 3's build.ps1 uses `--windows-icon` per the recipe; flags may silently no-op |
| 2 | `#21560` idle RSS drift over hours; "worth a 24h soak test" | The launcher is a long-lived supervisor — exactly this scenario |
| 3 | `Bun.isStandaloneExecutable` returned `undefined` on 1.3.14; use `Bun.main.includes("$bunfs")` fallback | Needed if launch.ts ever detects compiled mode |
| 4 | `#12970` compiled exe strips `\\` from env vars on Windows | T5 introduces per-lane `GROK_HOME`/`CODEX_HOME` Windows-path env vars — exactly the shape this bites |
| 5 | `#20013` dynamic `import()` fails in single-file exe | Low risk if launch.ts stays static-import-only, but not stated as a rule |
| 6 | `--no-compile-autoload-dotenv` / `--no-compile-autoload-bunfig` determinism flags | Default runtime autoload of `.env`/`bunfig.toml` is a determinism concern the plan doesn't address |
| 7 | "Last handle" caveat — a duplicated/inherited job handle delays KILL_ON_JOB_CLOSE teardown | One line of doctrine: never set handle-inheritance on Bun.spawn |
| 8 | `GetLastError()` must be read immediately after a failing call, before any other Bun API touches the thread | The Task 1 code follows the ordering, but the rule isn't stated — future edits could break it unknowingly |
| 9 | "EXACTLY six kernel32 calls" wording vs Task 1's seven dlopen'd symbols (adds `GetLastError`) | Documentation inconsistency; carve out `GetLastError` as diagnostics-only |

Everything else in both reports (struct-by-pointer marshaling, `#28055` no
ARM64, `#30717` embedded-dlopen regression, the grandchild race +
`CREATE_SUSPENDED` escalation path, `koffi`/`ffi-napi` fallback ladder) **is**
faithfully represented in the plan.

## 4. signtool

**Present**: `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`
(SDK 10.0.26100.0; older SDKs also present). Not on PATH by default. Matches
the plan's split: CI signs releases; unsigned is acceptable for local dev
(compile report: unsigned test exe ran without Defender interference, n=1).
No gap.

## 5. env/reference-manifest.toml integration

Structure (schema_version 1): flat `[[tools]]` array — `id`, `profile`,
`where`, `check`, `install_wsl`, `install_windows`, `required`, optional
`notes`/`min_version`. Profiles under `[profiles.X]` as `must`/`should`
id-lists. **The check scripts don't parse the TOML generically** — each tool
id has a hand-written branch in `tool-check.ps1` (lines 48-191) and
`tool-check.sh` — so adding bun/pueue to the manifest is necessary but not
sufficient; matching branches must be added to both scripts.

No `bun`/`pueue` entries exist. No `launcher/` directory, no
`launcher/dist/` gitignore entry (Task 1 not started — consistent).

Proposed entries follow the existing lychee/nats-server pattern (winget for
Windows, direct-binary for anything without a package manager); pueue's
Windows install is the repo's **first raw-download tool** — bootstrap needs a
new `DownloadBinary`-style helper (closest analog: bats-core's
git-clone-into-`~/.foreman/tools/` in bootstrap-wsl.sh:90).

**Manifest schema gap:** no exact-version-pin mechanism exists (only
`min_version` threshold compares, hand-written per tool). Bun's "assert
exactly 1.3.14, warn on drift" needs either a new `pin_version` field or
bespoke logic in both check scripts. The doctrine task must decide the shape.

## 6. CI / GitHub Actions

**Only `.github/workflows/maintenance.yml` exists** — release/cron/dispatch
triggers, `ubuntu-latest`, opens an issue on upstream drift. No building, no
artifacts, no signing.

For "CI builds once, publishes artifact + SHA256," an entirely new workflow
is needed, and per `#18416` (cross-compiled `--bytecode` segfaults) it must
run on `windows-latest`. It needs: `oven-sh/setup-bun` with
`bun-version: 1.3.14`, run `launcher/build.ps1`, optionally signtool (needs a
code-signing cert + secret — **no cert acquisition plan exists anywhere in
the repo**, open question), `Get-FileHash` SHA256 published alongside the
artifact.

## GAPS (blocking or open before T0/T1)

1. **pueue has no package-manager install route** — direct GitHub-binary
   download; bootstrap-windows.ps1 needs a new `DownloadBinary`-style helper.
2. **pueued Windows autostart is undocumented upstream** — a design decision
   (Scheduled Task vs Startup shortcut vs lazy client-autospawn), needing one
   empirical check before locking doctrine.
3. **No exact-version-pin mechanism in manifest/tool-check** — new
   `pin_version` field or bespoke logic; decide shape before implementing.
4. **winget Bun install is not self-pinning** — `winget upgrade --all` can
   move the system bun off 1.3.14; tool-check must verify the exact version.
5. **Zero CI build/release pipeline exists** — the windows-latest
   build/sign/publish workflow is greenfield; no code-signing cert referenced
   anywhere.
6. **Global Constraints omissions** (section 3, 9 items) — none block Task 1
   code, but patch the plan before the plan-time audit gate.
7. Non-blocking: `launcher/` and `.gitignore` `launcher/dist/` are Task 1/3
   deliverables, correctly absent today.

## Recommended install command sequence (architect-run)

```powershell
# --- Bun 1.3.14, pinned ---
winget install --id Oven-sh.Bun --version 1.3.14 -e --accept-package-agreements --accept-source-agreements
bun --version   # must print 1.3.14

# --- pueue + pueued v4.0.4 (no package manager; direct GitHub binaries) ---
New-Item -ItemType Directory -Force -Path "$HOME\.foreman\tools\pueue"
Invoke-WebRequest -Uri "https://github.com/Nukesor/pueue/releases/download/v4.0.4/pueue-x86_64-pc-windows-msvc.exe"  -OutFile "$HOME\.foreman\tools\pueue\pueue.exe"
Invoke-WebRequest -Uri "https://github.com/Nukesor/pueue/releases/download/v4.0.4/pueued-x86_64-pc-windows-msvc.exe" -OutFile "$HOME\.foreman\tools\pueue\pueued.exe"
# add to user PATH; decide/verify autostart doctrine before relying on it:
pueue --version
pueue group add grok; pueue group add codex; pueue group add claude; pueue group add misc; pueue group add gate
pueue parallel 1 --group grok
pueue parallel 1 --group codex
pueue parallel 3 --group claude
pueue parallel 1 --group gate
```

Status note (2026-07-18): Bun 1.3.14 verified installed via winget; pueue
4.0.4 binaries verified at `~/.foreman/tools/pueue/`. Groups/daemon doctrine
deferred to T0 implementation.
