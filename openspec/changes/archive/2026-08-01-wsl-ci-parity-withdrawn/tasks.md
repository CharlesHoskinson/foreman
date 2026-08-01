# Tasks — wsl-ci-parity

Implementer: Sonnet 5 · Audit: Opus 4.8. Land after wsl-launcher-shipped and
crlf-extensionless-hardening (consumes both).

- [ ] **1. `ubuntu-latest` job** — new `.github/workflows/ci.yml`: checkout,
  install bun, build the POSIX launcher (`bun run build:posix`), run
  `shellcheck`, run the bats suite under explicit `bash` (incl.
  `tests/launcher.bats`'s pidns family and `tests/line-endings.bats`), smoke
  test `install.sh`.
- [ ] **2. `windows-latest` job** — `defaults.run.shell: bash`; `shellcheck`
  + the line-endings check (the Git-Bash half); deliberately narrower than
  the Ubuntu job.
- [x] **3. Explicit `bash` + explicit tool paths** — confirm every step
  needing `pipefail` declares `shell: bash`; no step relies on `~/.bashrc`
  being sourced; tool dirs (bun, bats-core, shellcheck) are put on PATH by
  the workflow's own steps.
- [ ] **4. `install.sh` smoke test** — analogous in spirit to
  `windows-smoke.yml`'s `install.ps1` junction-resolution assertion, adapted
  to `install.sh`'s POSIX symlink/junction equivalent.
- [ ] **5. Verify** — trigger the new workflow on a scratch PR/branch and
  confirm both jobs run and pass on the current (post-P1/P2) tree;
  `docs-check.sh`.

Acceptance: `ci.yml` runs shellcheck + the full bats suite + the launcher
build + an `install.sh` smoke test on `ubuntu-latest`, and shellcheck + the
line-endings check on `windows-latest` (`shell: bash`), on every PR touching
shell scripts or the launcher; no step depends on `~/.bashrc`.
