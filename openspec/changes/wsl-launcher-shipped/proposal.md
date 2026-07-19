# Change: wsl-launcher-shipped

## Why

The v0.2.5 POSIX launcher (`foreman-launch`, setsid process-group cascade) is
the entire mechanism behind the v0.2.7.5 posix-cascade-parity guarantee — but
on a fresh WSL clone it is silently absent. `launcher/dist/` is gitignored
(`.gitignore:26`) and `build:posix` exists in `launcher/package.json:11`
(`bun build --compile --target=bun-linux-x64 ... --outfile dist/foreman-launch`)
but nothing runs it: not `env/bootstrap-wsl.sh`, not `foreman-setup.sh`, not
CI. `env/tool-check.sh` and `env/reference-manifest.toml` carry no
`foreman-launch` entry (confirmed absent by grep). So `fl_resolve_launcher`
(`skills/foreman/scripts/lib/launch.sh:18-45`) and `lane_resolve_launcher`
(`skills/foreman/scripts/lane-run.sh:542-564`) both fail to resolve a
candidate on a fresh WSL clone, and `lane-run.sh:962-969` emits
`{kind:"degraded",reason:"launcher_absent"}` and runs the lane WITHOUT the
pidns kill-cascade — the exact guarantee v0.2.7.5 built — silently, with no
readiness signal blocking the run.

This is not a broken-code bug; the launcher build and the resolvers are
already correct. It is a shipping gap: a built protection that never gets
built, checked, or surfaced to the operator.

## What changes

- `env/bootstrap-wsl.sh` (and/or `foreman-setup.sh`) gains an idempotent
  build-if-absent step: `(cd launcher && bun run build:posix)` producing
  `launcher/dist/foreman-launch`, skipping (with a logged notice) if the
  binary is already present or if `bun` is absent.
- `env/tool-check.sh` and `env/reference-manifest.toml` gain a
  `foreman-launch` entry: on WSL (`posix` platform) the hard/full readiness
  verdict is NOT-READY (or an equivalently loud degraded warning) when the
  launcher is absent, naming the build step.
- `lane-run.sh`'s existing `launcher_absent` degraded alert gains a
  Setup-actionable hint (the build command) in its message/log surface — no
  behavior change to the frozen `{kind:"degraded",reason:"launcher_absent"}`
  event payload or fallback path itself.
- Docs (`docs/INSTALL.md`, `docs/USAGE.md` POSIX-cascade troubleshooting
  section, `launcher/README.md`) state the build step and that Setup performs
  it automatically.

## Impact

- Affected: `env/bootstrap-wsl.sh`, `skills/foreman/scripts/foreman-setup.sh`,
  `env/tool-check.sh`, `env/reference-manifest.toml`,
  `skills/foreman/scripts/lane-run.sh` (degraded-alert hint only, not the
  frozen alert payload), `docs/INSTALL.md`, `docs/USAGE.md`,
  `launcher/README.md`.
- New: a bats regression proving the build-if-absent step and the
  readiness-verdict change on a WSL-shaped (`posix`) fixture.
- Depends on: v0.2.5 launcher (`launcher/package.json`'s `build:posix`
  target), v0.2.7.5 posix-cascade-parity (`lane-run.sh` resolver/alert
  contract, which stays byte-unchanged for its degraded path).
