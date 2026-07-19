# Change: wsl-tool-path-persistence

## Why

Correct vendor-CLI tool resolution on WSL is currently an
operator-remembered manual step, not a Setup guarantee:

- **Wrong-shell PATH advice** (R2/R4): grok currently needs a manual `export
  PATH="/c/root/.local:$PATH"` — this is a Git-Bash-only path shape and is
  simply wrong on WSL (`ROADMAP.md:126` and multiple specs/plans repeat this
  snippet without a WSL analog).
- **Non-interactive lane shells don't source `~/.bashrc`** (R2/R4): so any
  tool-directory PATH fix that lives only in a profile file never reaches a
  lane's non-interactive shell — tool dirs must be persisted for lanes
  explicitly.
- **Per-machine, not repo-tracked fix already exists** (R2): WSL codex once
  resolved the Windows npm shim via the `appendWindowsPath` leak; the fix
  (`appendWindowsPath=false` in `/etc/wsl.conf`) is documented and applied
  per-machine (`env/reference-manifest.toml`,
  `skills/foreman/references/reference-environment.md`) but is not a
  repo-tracked guarantee that survives a fresh WSL distro.
- **Live-network-coupled unit test** (R2): the `timeout 10 grok models`
  readiness probe (`env/tool-check.sh:69`) couples grok-lane/vendor-isolation
  UNIT tests to live network/PATH reachability, which is the wrong
  dependency for a unit test.

## What changes

- `foreman-setup.sh`/`bootstrap-wsl.sh` writes a foreman-owned env file
  (e.g. `~/.foreman/env.sh`) that prepends the WSL-native tool dirs (grok,
  codex, bun, node, `/usr/local/bin`) ahead of anything else on PATH — and
  lanes explicitly source it, since non-interactive shells skip
  `~/.bashrc`. On WSL, `appendWindowsPath=false` remains the documented
  per-machine recommendation; foreman does not require it, but the env
  file's PATH ordering SHALL win regardless of that setting.
- Stub/decouple the `timeout 10 grok models` readiness probe
  (`env/tool-check.sh:69`) so grok-lane and vendor-isolation UNIT tests do
  not depend on live grok reachability — a mock/seam is introduced for the
  unit-test path, while the live probe remains for real readiness checks.
- Fix the `/c/root/.local` doc snippet across `ROADMAP.md` and specs to give
  the WSL analog (grok resolved via foreman's env file / `/usr/local/bin`,
  not `/c/root/.local`, which is Git-Bash-only).

## Impact

- Affected: `skills/foreman/scripts/foreman-setup.sh`,
  `env/bootstrap-wsl.sh`, new `~/.foreman/env.sh` (generated, not tracked),
  `env/tool-check.sh` (readiness-probe seam), `ROADMAP.md:126` and any
  sibling specs repeating the `/c/root/.local` snippet.
- New/updated: `tests/grok-lane.bats`, `tests/vendor-isolation.bats`
  (decoupled from live network), a new persistence-focused bats file.
- Depends on: wsl-preflight's tool-resolution warning (detects the problem);
  this package fixes it by making resolution correct-by-construction for
  lanes.
