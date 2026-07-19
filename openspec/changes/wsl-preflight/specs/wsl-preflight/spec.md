# Spec delta — WSL preflight

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: the preflight runs before any event-log write and refuses an unsafe FOREMAN_HOME (FOREMAN_HOME only, override available)

WHEN a lane starts on WSL, the wsl-preflight SHALL run before any
timestamped event is written to the event log. IF `FOREMAN_HOME` (where the
event log lives — NOT the worktree) resolves under `/mnt/*`, THEN foreman
SHALL refuse the run, citing fsync integrity as the reason, UNLESS
`FOREMAN_ALLOW_MNT_HOME=1` is set, in which case it SHALL loud-warn and
proceed instead of refusing.

- The refusal SHALL apply to `FOREMAN_HOME` only. A worktree resolving under
  `/mnt/*` SHALL only be WARNed (perf), never refused — a worktree may
  legitimately live on `/mnt` for Windows-side inspection, and the fsync
  concern is specific to the event log under `FOREMAN_HOME`.
- `FOREMAN_HOME` SHALL be resolved with `realpath -m` (handles a
  not-yet-created directory and symlinks), NOT `cd "$FOREMAN_HOME" && pwd`
  (which requires the directory to already exist).
- The preflight SHALL be a no-op (exit 0 immediately) when not running under
  WSL.
- The `/mnt/*` refusal SHALL NOT fire for the Windows Git-Bash default
  (`/c/...`) — it applies to WSL `/mnt/*` paths only, and never fires on a
  Git-Bash host regardless of `FOREMAN_ALLOW_MNT_HOME`.

#### Scenario: /mnt/* FOREMAN_HOME is refused before the event log is touched

- WHEN a lane starts on WSL with `FOREMAN_HOME` resolving under `/mnt/c/...`
  AND `FOREMAN_ALLOW_MNT_HOME` is not set
- THEN the wsl-preflight refuses the run citing fsync integrity
- AND no timestamped event is written to the event log for that attempt.

#### Scenario: FOREMAN_ALLOW_MNT_HOME=1 overrides the refusal with a loud warning

- WHEN a lane starts on WSL with `FOREMAN_HOME` resolving under `/mnt/c/...`
  AND `FOREMAN_ALLOW_MNT_HOME=1` is set
- THEN the wsl-preflight does NOT refuse the run
- AND it loud-warns that `FOREMAN_HOME` is on `/mnt` without fsync
  guarantees
- AND the run proceeds.

#### Scenario: a /mnt/* worktree is warned, never refused

- WHEN a lane starts on WSL with `FOREMAN_HOME` on ext4 but the active
  worktree resolving under `/mnt/*`
- THEN the preflight warns about `/mnt` performance
- AND it does NOT refuse the run (the refusal is FOREMAN_HOME-specific, not
  worktree-specific).

#### Scenario: a native-filesystem FOREMAN_HOME proceeds

- WHEN a lane starts on WSL with `FOREMAN_HOME` resolving under the WSL ext4
  root (not `/mnt/*`)
- THEN the preflight does not refuse the run
- AND WHEN the same lane starts on Windows Git-Bash with the default `/c/...`
  path
- THEN the preflight does not refuse the run either, regardless of
  `FOREMAN_ALLOW_MNT_HOME`.

## ADDED Requirement: the preflight warns on a stale WSL build

IF the WSL build is < 2.1.1, THEN the wsl-preflight SHALL warn to run `wsl
--update`.

- The preflight SHALL additionally detect the residual dual-NTP jitter
  condition (WSL `systemd-timesyncd` vs Hyper-V host sync) and recommend
  `timedatectl set-ntp false` inside WSL.

#### Scenario: stale WSL build triggers an update warning

- WHEN the wsl-preflight runs on a WSL build reporting a version < 2.1.1
- THEN it warns the operator to run `wsl --update`
- AND the warning is non-fatal (the run proceeds).

## ADDED Requirement: the preflight warns on cross-boundary networking and tool-resolution risk

WHERE a cross-boundary `localhost` dependency is configured (NATS
`nats.url`, or an interactive login expected) AND neither mirrored
networking mode nor NAT-with-`localhostForwarding` is active, THEN the
wsl-preflight SHALL warn.

- The preflight SHOULD use `wslinfo --networking-mode` (available on WSL ≥
  2.0.9) to detect the active networking mode when the `wslinfo` binary is
  present, falling back to a best-effort heuristic when it is unavailable;
  this detection is warn-only, never fatal.
- `command -v grok/codex/bun/node` SHALL resolve to a non-`/mnt/c` path;
  WHERE a match resolves under `/mnt/c`, the preflight SHALL warn that a
  Windows shim may be shadowing the WSL-native binary.

#### Scenario: unforwarded localhost dependency triggers a warning

- WHEN a cross-boundary `localhost` dependency (e.g. `nats.url`) is
  configured AND the preflight detects neither mirrored mode nor NAT with
  `localhostForwarding` active
- THEN it warns the operator, noting the `::1`-not-forwarded gotcha
- AND the warning is non-fatal.

#### Scenario: a Windows-shimmed tool triggers a warning

- WHEN `command -v grok` (or codex/bun/node) resolves to a path under
  `/mnt/c`
- THEN the preflight warns that the WSL-native binary may be shadowed
- AND the warning is non-fatal.
