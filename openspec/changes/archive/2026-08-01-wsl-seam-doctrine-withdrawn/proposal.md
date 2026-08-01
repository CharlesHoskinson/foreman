# Change: wsl-seam-doctrine

## Why

Several field-learned rules about the Windows↔WSL seam exist as scattered,
partial doctrine rather than one uniform, codified set of rules, and one
concrete trap (exec-bit) has no guard at all:

- **Auth callbacks:** codex's `--device-auth` browser callback
  (localhost:1455) dying across the WSL boundary is already fixed by
  operator-foreground doctrine (`! codex login`) documented in
  `skills/foreman/references/lanes.md:97-102` and
  `skills/foreman/references/reference-environment.md:84-92`. That doctrine
  is codex-specific in its current phrasing; grok's `--device-code` flow
  (`skills/foreman/scripts/foreman-setup.sh:65`,
  `skills/foreman/references/lanes.md:61-66`) and any future vendor auth
  flow need the SAME uniform rule stated once, vendor-agnostically, plus the
  `::1`-not-forwarded (bind IPv4) gotcha noted alongside it.
- **Daemon lifecycle** (R3): `systemd=true` does NOT keep the WSL VM alive —
  a pueue/docker daemon dies with the VM unless a Windows-side handle holds
  it open. `skills/foreman/scripts/lane-queue.sh`'s `ensure` subcommand
  already re-spawns `pueued` on demand — this needs to be documented as the
  supported model on WSL, not left as an undocumented accident of the
  implementation.
- **Docker:** the container hard-mode host on WSL is Docker Desktop's WSL2
  backend (`skills/foreman/scripts/worker-run.sh:316`'s `require_cmd docker
  "hard mode container profile requires Docker Desktop/WSL2"`) — this needs
  to be stated as supported/verified doctrine, with the native
  `docker-ce`-on-WSL uninstall warning.
- **Exec-bit trap (internal, confirmed):** all 445 tracked files are git
  mode `100644` (verified via `git ls-files -s`); this works today only
  because every script is invoked `bash foo.sh` and `install.sh`'s chmod is
  a narrow glob (`chmod +x "$SKILL_SRC/scripts/"*.sh`,
  `install.sh:62-63`) — one direct-exec new script away from a WSL-only
  "Permission denied" that Windows can never surface or catch.
- **Platform detection drift:** three `case "$(uname -s)"` call sites exist
  (`skills/foreman/scripts/lane-run.sh:129-134`'s `lane_platform()`,
  `skills/foreman/scripts/lib/launch.sh:30`, and
  `skills/foreman/scripts/worker-run.sh:296`); the latter two already
  include a `*NT*` clause, but `lane_platform()` does not — a low-risk,
  optional consolidation.

## What changes

- **Auth callbacks:** a single uniform doctrine statement — any
  browser/`localhost`-callback auth flow touching a WSL-hosted process
  SHALL run operator-foreground (`! <login>`), never
  orchestrator-launched-and-detached; extend the existing codex-specific
  wording to explicitly cover grok `--device-code` and future vendors; note
  the `::1`-not-forwarded gotcha (bind IPv4) alongside it.
- **Daemon lifecycle:** document that `systemd=true` does NOT keep the WSL
  VM alive, and that `lane-queue.sh ensure`'s existing re-spawn-on-demand
  behavior is the supported model on WSL (not a persistent-across-idle
  daemon).
- **Docker:** document Docker Desktop's WSL2 backend as the
  supported/verified container host (`command -v docker && docker info`
  detection), including the uninstall-native-`docker-ce` warning.
- **Exec-bit hygiene:** a `tests/exec-bit.bats` (or a check in an existing
  test) asserting every script invoked by direct exec (not `bash foo.sh`) is
  either git mode `100755` or guarded by an `[[ -x ]]` check; document the
  "call via `bash` or add `+x`" rule.
- **Platform detection:** add the missing `*NT*` clause to `lane_platform()`
  (`lane-run.sh:129-134`), OR extract one shared `platform()` helper used by
  all three call sites — low-risk, optional, whichever the implementer finds
  lower-diff.

## Impact

- Affected (doctrine, low-risk code): `skills/foreman/references/lanes.md`,
  `skills/foreman/references/reference-environment.md`,
  `skills/foreman/scripts/lane-queue.sh` (doc comment only, no behavior
  change), `skills/foreman/scripts/worker-run.sh` (Docker doctrine doc
  comment), `skills/foreman/scripts/lane-run.sh:129-134` (`*NT*` clause or
  helper extraction), new `tests/exec-bit.bats`.
- No change to auth flow mechanics themselves (codex's is already correct);
  this package is documentation + one small consolidation + one new guard
  test.
