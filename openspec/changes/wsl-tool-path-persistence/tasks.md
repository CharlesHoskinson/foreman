# Tasks — wsl-tool-path-persistence

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. Foreman-owned env file** — Setup
  (`skills/foreman/scripts/foreman-setup.sh` / `env/bootstrap-wsl.sh`) writes
  an idempotent `~/.foreman/env.sh` that prepends the resolved WSL-native
  tool dirs (grok, codex, bun, node, `/usr/local/bin`) onto PATH.
- [ ] **2. Lane sourcing** — the lane launch path sources
  `~/.foreman/env.sh` explicitly before invoking a vendor CLI, since
  non-interactive shells skip `~/.bashrc`; confirm PATH ordering wins even
  when `appendWindowsPath=true` leaks a Windows shim in.
- [ ] **3. Readiness-probe seam** — generalize the existing
  `write_authed_grok_shim` pattern so grok-lane and vendor-isolation UNIT
  tests do not depend on live grok reachability; confirm any remaining
  live-binary test stays skip-guarded and is not required for the unit
  suite to pass.
- [ ] **4. Doc snippet fix** — replace/correct the `/c/root/.local` PATH
  snippet in `ROADMAP.md:126` and the affected specs
  (`docs/research/vendor-concurrency-results.md`,
  `docs/superpowers/plans/2026-07-19-v0281-field-fixes.md`,
  `docs/superpowers/specs/2026-07-19-v0281-field-fixes-design.md`) with the
  WSL analog, keeping the Git-Bash form only where explicitly labeled as
  Windows-specific.
- [ ] **5. Bats** — a persistence-focused bats file proving a
  non-interactive shell sourcing only `~/.foreman/env.sh` resolves
  grok/codex/bun/node to WSL-native paths even with a `/mnt/c` shim earlier
  on the inherited PATH.
- [ ] **6. Verify** — `tests/grok-lane.bats` and `tests/vendor-isolation.bats`
  pass with no network access; `bash -n`; `docs-check.sh`.

Acceptance: vendor CLI resolution on WSL is a Setup-time guarantee, not an
operator `export`; unit tests for grok-lane/vendor-isolation never require
live network reachability; the `/c/root/.local` snippet no longer appears as
generic WSL guidance.
