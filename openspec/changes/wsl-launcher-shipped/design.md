# Design — wsl-launcher-shipped

Parent design: `docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`
(package P1).

## Citations (load-bearing)

- `launcher/dist/` gitignored: `.gitignore:26`.
- Build target present but never invoked: `launcher/package.json:11`
  (`build:posix` → `bun build --compile --target=bun-linux-x64
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig src/launch.ts
  --outfile dist/foreman-launch`).
- Resolvers that fail closed today on a fresh WSL clone:
  `skills/foreman/scripts/lib/launch.sh:18-45` (`fl_resolve_launcher`,
  independent resolver used by `worker-run.sh`) and
  `skills/foreman/scripts/lane-run.sh:542-564` (`lane_resolve_launcher`,
  precedence: `FOREMAN_LAUNCH` env override > repo-relative
  `launcher/dist/foreman-launch(.exe)` > PATH > absent).
- Degraded fallback, currently silent-and-frozen:
  `skills/foreman/scripts/lane-run.sh:962-969` — absent resolution emits
  exactly one `{kind:"degraded",reason:"launcher_absent"}` alert event per
  round and proceeds without the pidns kill-cascade.
- No readiness coverage: `env/tool-check.sh` and `env/reference-manifest.toml`
  have no `foreman-launch` entry (confirmed by grep — zero matches).

## Approach

Treat "launcher present on WSL" as a Setup-stage deliverable, not an
operator-remembered manual step:

1. **Build-if-absent in Setup.** `bootstrap-wsl.sh` (and/or
   `foreman-setup.sh`, whichever owns the WSL provisioning path) runs
   `(cd launcher && bun run build:posix)` idempotently: skip silently if
   `launcher/dist/foreman-launch` already exists and is executable; skip with
   a logged warning (not a hard failure) if `bun` is not on PATH, since bun
   absence is itself a separate tool-check finding.
2. **Readiness coverage.** Add a `foreman-launch` entry to
   `env/reference-manifest.toml` and a probe in `env/tool-check.sh` that,
   specifically on `posix`/WSL platform, treats the launcher's absence as a
   NOT-READY (hard/full profile) or an unmistakable degraded warning — never
   a silent pass. The probe names the exact build command in its message.
3. **Actionable degraded hint.** The existing `lane-run.sh:962-969` alert path
   is frozen (its JSON payload and control flow must not change — other
   packages and tests depend on the exact `{kind:"degraded",
   reason:"launcher_absent"}` shape). This package only adds a
   Setup-actionable hint to the human-facing log/stderr line emitted
   alongside it, pointing at the build step.
4. **Docs.** `docs/INSTALL.md`, `docs/USAGE.md`'s POSIX-cascade
   troubleshooting section, and `launcher/README.md` state that Setup builds
   the launcher automatically and give the manual fallback command.

## Key decision

Do not touch `lane-run.sh`'s degraded-path *behavior* — v0.2.7.5 explicitly
froze this fallback as documented, tested contract surface. This package's
job is upstream of that path: make the absence rare (build it in Setup) and
loud (readiness verdict + hint), not to redesign the fallback itself.

## Verification

A bats fixture simulating a fresh WSL clone (`launcher/dist/` absent, `bun`
present) proves: (1) the build step produces
`launcher/dist/foreman-launch` and is a no-op on a second run; (2) with `bun`
absent, the step logs and skips rather than failing Setup; (3) tool-check's
hard/full verdict is NOT-READY / loudly degraded when the binary is missing,
citing the build command; (4) `lane-run.sh`'s
`{kind:"degraded",reason:"launcher_absent"}` alert payload is byte-identical
to the pre-change behavior when the launcher is genuinely absent.
