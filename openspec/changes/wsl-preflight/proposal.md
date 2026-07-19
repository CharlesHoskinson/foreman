# Change: wsl-preflight

## Why

foreman silently depends on several WSL environment invariants that are
never checked. Two are severe and already known:

- **Filesystem boundary** (R2/R3): `/mnt/c` (9P/DrvFs) is 2-20x slower and
  lacks the fsync guarantees the event-log crash-safety model needs
  (`skills/foreman/references/durable-lanes.md:106-108`); no runtime guard
  today warns if `FOREMAN_HOME` or the active worktree resolves under
  `/mnt/*`.
- **Clock** (R3): the severe WSL2 sleep/resume clock drift was fixed
  upstream in WSL 2.1.1 (2024-01-22, microsoft/WSL#10006). foreman's
  v0.2.7.5 `env/wsl-clock-preflight.sh` + `env/wsl-clock-resync-task.xml`
  were built for that now-fixed severe-drift bug and are wired into NOTHING
  — neither `lane-run.sh` nor `foreman-setup.sh` reference them (R2's
  "single largest built-but-not-connected gap"). The residual problem today
  is a much smaller ~1-2s dual-NTP jitter (WSL `systemd-timesyncd` vs
  Hyper-V host sync), fixed by `timedatectl set-ntp false` inside WSL — the
  old heavy resync-task mechanism is no longer the right primary tool for
  the bug that remains.

Two more are conditional but real: **networking** — `localhostForwarding`
(default true) makes NAT-mode localhost callbacks work, but `::1` is NOT
forwarded (bind IPv4); mirrored mode shares `127.0.0.1` but is still
receiving port-tracking fixes upstream (2.9.3/2.9.4, mid-2026); NATS
`localhost:4222` needs same-side or mirrored networking
(`durable-lanes.md:99-105`). And **tool resolution** — `grok`/`codex`/`bun`/
`node` can resolve to a `/mnt/c` Windows shim shadowing the intended
WSL-native binary.

None of this is scattered doctrine to leave as tribal knowledge: it needs one
preflight script that runs before any of it can silently bite a lane.

## What changes

- New `skills/foreman/scripts/wsl-preflight.sh`: detects WSL via `grep -qi
  microsoft /proc/version` (a no-op, zero-cost pass-through off WSL). On WSL
  it checks, in order:
  - **Filesystem:** IF `FOREMAN_HOME` OR the active worktree resolves under
    `/mnt/*`, THEN refuse the run (fsync integrity is a hard invariant for
    the event log).
  - **Clock:** warn if the WSL build is < 2.1.1 (recommend `wsl --update`);
    detect the residual dual-NTP jitter condition and recommend `timedatectl
    set-ntp false` — this folds in the v0.2.7.5 drift check as the
    residual-jitter guard; the heavy `wsl-clock-resync-task.xml` mechanism is
    retired to an OPTIONAL documented operator step, no longer the primary
    mechanism.
  - **Networking (conditional):** WHERE a cross-boundary `localhost`
    dependency is configured (NATS `nats.url`, or an interactive login
    expected), verify mirrored mode OR NAT-with-`localhostForwarding` is
    active, and warn about the `::1`-not-forwarded gotcha.
  - **Tool resolution:** `command -v grok/codex/bun/node` SHALL resolve to a
    non-`/mnt/c` path, else warn of Windows-shim shadowing.
- Wired into `foreman-setup.sh` (Setup stage) and `lane-run.sh`'s lane-start
  (Use stage) — non-fatal warnings except the `/mnt/*` FOREMAN_HOME refusal,
  which is a hard stop.

## Impact

- Affected: new `skills/foreman/scripts/wsl-preflight.sh`,
  `skills/foreman/scripts/foreman-setup.sh`,
  `skills/foreman/scripts/lane-run.sh` (lane-start hook only), the existing
  `env/wsl-clock-preflight.sh` (folded in / superseded as the jitter guard),
  `env/wsl-clock-resync-task.xml` (demoted to optional documented step, not
  removed).
- New: `tests/wsl-preflight.bats`.
- The `/mnt/*` FOREMAN_HOME refusal is a hard behavior change on WSL only —
  see risk note in design.md; it must never fire for the Windows Git-Bash
  `/c/...` default.
