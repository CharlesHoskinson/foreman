# Change: wsl-ci-parity

## Why

Every WSL protection this release ships (or has already shipped) is verified
by hand, once, and never again: the bats suite — including the real
`tests/launcher.bats` pidns family — runs on NO CI platform today (internal
audit); `install.sh` has no smoke test; only `windows-smoke.yml`
(`install.ps1`) exists in `.github/workflows/`. This is the exact class of
bug the parent design's other packages are fixing (P1's launcher, P2's
line-endings) — "passes on Windows/shims, breaks on real WSL" — and without
CI coverage it will silently regress the moment this release ships.

SOTA (R4): `ubuntu-latest` (LF line endings, real bash) is the standard,
practical proxy for WSL2's userland in GitHub Actions (no first-party WSL
runner exists); pair it with a `windows-latest` job using `shell: bash` for
the Git-Bash half. Two specific gotchas the SOTA research flags: explicit
`bash` (not the implicit non-Windows-runner shell) is required for
`pipefail` to actually take effect, and `--noprofile --norc` in CI's
non-interactive bash means `~/.bashrc` is never sourced — so tool paths must
be sourced explicitly in CI, exactly as they must be in a real lane (see the
sibling wsl-tool-path-persistence package).

## What changes

- `.github/workflows/ci.yml` (new): an `ubuntu-latest` job that checks out,
  builds the POSIX launcher (`bun run build:posix`), runs `shellcheck`, the
  bats suite (including `tests/launcher.bats`'s pidns family and the new
  `tests/line-endings.bats`), and smoke-tests `install.sh`; a
  `windows-latest` job with `defaults.run.shell: bash` running `shellcheck`
  plus the line-endings check (the Git-Bash half).
- Explicit `bash` shell declared everywhere in the workflow (so `pipefail`
  is honored); tool paths sourced explicitly in CI steps — no reliance on
  `~/.bashrc`.

## Impact

- Affected: new `.github/workflows/ci.yml`; existing
  `.github/workflows/windows-smoke.yml` (install.ps1 smoke test — kept,
  referenced as the pattern the new `install.sh` smoke test follows) and
  `.github/workflows/maintenance.yml` (unaffected, reviewed for overlap).
- Consumes: wsl-launcher-shipped's `bun run build:posix` step,
  crlf-extensionless-hardening's `tests/line-endings.bats`, and the existing
  `tests/launcher.bats` pidns family — this package is sequenced LAST
  because it encodes the finished surface of P1/P2 (and benefits from P3/P4
  landing first too).
- Depends on: P1 (launcher build step), P2 (line-endings test),
  P3/P4 (recommended to land first per the parent design's sequencing, so CI
  encodes the finished surface).
