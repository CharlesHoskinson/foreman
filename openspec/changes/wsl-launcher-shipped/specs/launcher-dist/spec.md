# Spec delta — launcher shipped on WSL

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: Setup builds the POSIX launcher when absent

WHEN `foreman-setup` or `bootstrap-wsl.sh` runs on WSL, the implementer SHALL
ensure `launcher/dist/foreman-launch` exists, building it (`cd launcher &&
bun run build:posix`) when `bun` is present on PATH and the binary is
currently absent.

- WHERE `launcher/dist/foreman-launch` already exists and is executable, the
  build step SHALL be a no-op (skip, logged).
- WHERE `bun` is absent from PATH, the build step SHALL skip with a logged
  warning rather than failing Setup.

#### Scenario: fresh WSL clone gets a built launcher

- WHEN `bootstrap-wsl.sh` (or `foreman-setup`) runs on a fresh WSL clone with
  `bun` on PATH and no `launcher/dist/foreman-launch`
- THEN the build step runs `bun run build:posix` inside `launcher/`
- AND `launcher/dist/foreman-launch` exists and is executable afterward.

#### Scenario: build step is idempotent and bun-tolerant

- WHEN the build step runs a second time with the binary already present
- THEN it skips the build and logs a no-op notice
- AND WHEN `bun` is absent from PATH instead
- THEN it skips the build, logs a warning, and Setup does NOT fail solely for
  this reason.

### Requirement: readiness reports the launcher's absence loudly, DEGRADED (not NOT-READY) when bun is also absent

WHEN a Use lane starts on WSL WHERE `launcher/dist/foreman-launch` is absent
AND `bun` is present on PATH, `env/tool-check.sh` SHALL report NOT-READY
(hard/full profile) naming the `bun run build:posix` build step, rather than
silently passing readiness. WHERE `bun` is ALSO absent — `bun` is only a
`should_full`-tier tool (`env/tool-check.sh:279`), not a `must` tool — THEN
tool-check SHALL instead emit a loud DEGRADED warning, NOT a hard NOT-READY,
so readiness is never permanently blocked on a should-tier tool the operator
may not have installed.

- `env/reference-manifest.toml` SHALL carry a `foreman-launch` entry so the
  tool is part of the checked inventory.

#### Scenario: tool-check surfaces a missing launcher when bun can build it

- WHEN `tool-check` runs the hard/full profile on WSL with
  `launcher/dist/foreman-launch` absent AND `bun` present on PATH
- THEN the verdict is NOT-READY
- AND the message names the `bun run build:posix` build step.

#### Scenario: tool-check degrades rather than blocks when bun is also absent

- WHEN `tool-check` runs the hard/full profile on WSL with
  `launcher/dist/foreman-launch` absent AND `bun` ALSO absent from PATH
- THEN the verdict is a loud DEGRADED warning, not a hard NOT-READY
- AND readiness is not permanently blocked solely because the should-tier
  `bun` tool is missing.

### Requirement: the frozen launcher-absent degraded fallback is unchanged

The frozen `lane-run.sh` launcher-absent degraded fallback SHALL remain
byte-unchanged: the exact `{kind:"degraded",reason:"launcher_absent"}` alert
event payload and its control flow (one alert per round, lane proceeds
without the pidns kill-cascade) SHALL NOT be altered by this change. The
implementer MAY add a Setup-actionable hint (the build command) only to the
accompanying human-facing log/stderr line.

#### Scenario: degraded alert payload is untouched

- WHEN a lane starts on WSL with the launcher genuinely absent (e.g. `bun`
  unavailable so Setup could not build it)
- THEN `lane-run.sh` emits `{kind:"degraded",reason:"launcher_absent"}`
  exactly as before
- AND the lane runs without the pidns kill-cascade, unchanged from
  pre-change behavior
- AND the accompanying log line additionally names the build command.
