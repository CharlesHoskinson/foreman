# Design — wsl-ci-parity

Parent design: `docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`
(package P5).

## Citations (load-bearing)

- **CI void (internal):** the bats suite, including the real
  `tests/launcher.bats` pidns family, runs on NO CI platform today;
  `install.sh` has no smoke test; only `.github/workflows/windows-smoke.yml`
  (`install.ps1`, `runs-on: windows-latest`, `shell: pwsh`, asserts the
  foreman skill junction resolves) exists. WSL protections have been
  verified by hand, once.
- **`ubuntu-latest` as the practical WSL proxy (SOTA, R4):** no first-party
  WSL GitHub Actions runner exists; `ubuntu-latest` (LF line endings, real
  bash userland) is the documented, practical stand-in for exercising
  WSL-shaped bash behavior in CI.
- **Explicit `bash` for `pipefail` (SOTA, R4):** the implicit
  non-Windows-runner default shell does not enable `pipefail`; a workflow
  step must declare `shell: bash` (or `defaults.run.shell: bash`) explicitly
  for `set -o pipefail` semantics to actually take effect — directly
  relevant given P2 is closing exactly a `pipefail`-related bug class.
- **`--noprofile --norc` (SOTA, R4):** GitHub Actions' bash steps run
  non-interactively without sourcing `~/.bashrc` — the same non-interactive
  shell shape as a foreman lane (see wsl-tool-path-persistence), so CI must
  source tool paths explicitly, never assume a profile file ran.

## Approach

1. **New `ubuntu-latest` job** in `.github/workflows/ci.yml`: checkout,
   install `bun` (needed for `bun run build:posix` — this package's CI job
   is the second consumer of P1's build step, after Setup), run
   `shellcheck` across the shell scripts, run the bats suite under
   `bash` explicitly (so `pipefail` holds) including `tests/launcher.bats`'s
   pidns family and `tests/line-endings.bats` (P2), and a smoke test of
   `install.sh` analogous in spirit to `windows-smoke.yml`'s
   `install.ps1` junction-resolution assertion.
2. **New `windows-latest` job** with `defaults.run.shell: bash` (the
   Git-Bash half): `shellcheck` plus the line-endings check. This is
   deliberately narrower than the Ubuntu job — it exercises the Git-Bash
   userland specifically, not a second full bats run, to keep CI time
   reasonable while still catching a CRLF/`pipefail` regression on the
   Windows-native shell path too.
3. **Explicit `bash` everywhere; tool paths sourced explicitly.** Every step
   that needs `pipefail` declares `shell: bash`; nothing in CI relies on
   `~/.bashrc` — tool directories (bun, bats-core, shellcheck) are put on
   PATH by the workflow's own setup steps, matching the same discipline
   wsl-tool-path-persistence establishes for lanes.
4. **Sequenced last.** Per the parent design's explicit ordering, this
   package lands after P1 (so there is a build step to invoke), P2 (so there
   is a `tests/line-endings.bats` to run), and ideally P3/P4, so the CI
   workflow encodes the release's finished surface rather than a moving
   target.

## Key decision

Keep the Windows job narrow (lint + line-endings only, not a full bats run)
rather than duplicating the entire Ubuntu suite on `windows-latest` —
`windows-smoke.yml` already covers `install.ps1`'s Windows-native path, and
the parent design frames `windows-latest` + `shell: bash` specifically as
"the Git-Bash half," not a second WSL proxy.

## Verification

CI itself is the verification artifact: a PR touching shell scripts or the
launcher triggers both jobs; the Ubuntu job's failure output should show a
launcher build failure, a shellcheck finding, a bats failure (including the
pidns family), or an `install.sh` smoke failure distinctly; the Windows job
similarly isolates a Git-Bash-side line-ending or shellcheck regression.
