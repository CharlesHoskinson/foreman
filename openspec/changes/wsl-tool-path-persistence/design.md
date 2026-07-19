# Design — wsl-tool-path-persistence

Parent design: `docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`
(package P4).

## Citations (load-bearing)

- Wrong-shell PATH snippet repeated as canonical guidance: `ROADMAP.md:126`
  (`` `/c/root/.local`, not on the default inherited PATH — a Setup-stage
  concern ``); the same `/c/root/.local` snippet also appears in
  `docs/research/vendor-concurrency-results.md:81`,
  `docs/superpowers/plans/2026-07-19-v0281-field-fixes.md:37,356`, and
  `docs/superpowers/specs/2026-07-19-v0281-field-fixes-design.md:173` — all
  Git-Bash-only, wrong on WSL.
- Non-interactive shells skip `~/.bashrc` (R2/R4) — any PATH fix that only
  lives in a profile file never reaches a lane's non-interactive shell.
- `appendWindowsPath=false` is already the documented, applied-per-machine
  fix for the WSL `codex` Windows-shim leak (`env/reference-manifest.toml`
  notes, `skills/foreman/references/reference-environment.md:101-113`), but
  it is a per-machine `/etc/wsl.conf` setting, not something a fresh WSL
  distro gets automatically from this repo.
- The live-network-coupled readiness probe: `env/tool-check.sh:69` runs
  `timeout 10 grok models` as (per its own comment at line 45) the only
  exit-code-based auth signal grok has; `tests/grok-lane.bats:93` documents
  the coupling between `--version` and this same auth probe.

## Approach

1. **A foreman-owned env file, sourced explicitly by lanes.** Setup
   (`foreman-setup.sh` / `bootstrap-wsl.sh`) writes `~/.foreman/env.sh`
   (idempotent, regenerated each Setup run) that prepends the resolved
   WSL-native tool directories for grok, codex, bun, node, and
   `/usr/local/bin` onto PATH. Because non-interactive lane shells do not
   source `~/.bashrc`, `lane-run.sh` (or whatever spawns the lane's shell)
   sources `~/.foreman/env.sh` explicitly before invoking the vendor CLI —
   this makes correct resolution a property of how foreman launches lanes,
   not something the operator must remember to export.
2. **PATH ordering wins regardless of `appendWindowsPath`.** foreman does
   not require `appendWindowsPath=false` (that remains a documented,
   optional per-machine optimization) — but because `~/.foreman/env.sh`
   prepends the WSL-native dirs, even a distro with `appendWindowsPath=true`
   (Windows PATH leaking in) resolves the foreman-managed binaries first.
3. **Decouple the readiness probe from unit tests.** The `timeout 10 grok
   models` call in `env/tool-check.sh:69` stays as the real
   live-reachability probe for actual readiness checks. `tests/grok-lane.bats`
   already has a partial seam (`write_authed_grok_shim`, a deterministic
   always-authenticated grok stub answering `--version` and `grok models`)
   — this package generalizes that seam so every grok-lane and
   vendor-isolation UNIT test path uses it (or an equivalent mock), and any
   remaining live-binary test (e.g. `vendor-isolation.bats`'s existing
   skip-guarded real-binary case) stays skip-guarded and is never required
   for the unit suite to pass — a unit test SHALL NOT require network
   reachability to pass.
4. **Fix the doc snippet everywhere it's wrong.** Replace the bare
   `/c/root/.local` PATH snippet in `ROADMAP.md` and the affected specs with
   the WSL analog: grok resolved via `~/.foreman/env.sh` / `/usr/local/bin`,
   with the Git-Bash `/c/root/.local` form kept only where it is actually
   the correct platform (Windows Git-Bash), clearly labeled as such.

## Key decision

Persistence lives in an env file sourced by the lane launcher, not in
`~/.bashrc` — because the parent design explicitly identifies non-interactive
shell sourcing as the mechanism that's broken today; fixing it via profile
files would silently fail for exactly the lanes that need it most.

## Verification

`tests/grok-lane.bats` / `tests/vendor-isolation.bats` pass with no network
access (mock seam). A new persistence bats file proves: a non-interactive
shell that sources only `~/.foreman/env.sh` (not `~/.bashrc`) resolves
`grok`/`codex`/`bun`/`node` to WSL-native paths even when a `/mnt/c` shim is
present earlier on the inherited PATH. The `/c/root/.local` snippet is
grepped across docs and confirmed either fixed or explicitly scoped to
Windows Git-Bash only.
