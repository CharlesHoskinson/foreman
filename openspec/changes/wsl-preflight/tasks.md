# Tasks — wsl-preflight

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. `wsl-preflight.sh` skeleton** — new
  `skills/foreman/scripts/wsl-preflight.sh`; WSL detection via `grep -qi
  microsoft /proc/version`; no-op exit 0 when not WSL.
- [ ] **2. Filesystem check (FOREMAN_HOME-only hard refuse, with override)**
  — resolve `FOREMAN_HOME` with `realpath -m` (handles a not-yet-created
  directory and symlinks; do NOT use `cd "$FOREMAN_HOME" && pwd`). IF
  `FOREMAN_HOME` resolves under `/mnt/*`, refuse with an actionable message
  (fsync integrity + how to relocate `FOREMAN_HOME`) UNLESS
  `FOREMAN_ALLOW_MNT_HOME=1` is set, in which case loud-warn and proceed. The
  active worktree is a SEPARATE, warn-only check (perf) — a `/mnt/*`
  worktree is never refused, only `FOREMAN_HOME` is. Confirm the refusal
  never fires for the Windows Git-Bash `/c/...` default.
- [ ] **3. Clock check (pivot)** — warn if WSL build < 2.1.1 (`wsl
  --update`); fold in the v0.2.7.5 `env/wsl-clock-preflight.sh` drift logic
  as the residual dual-NTP jitter guard, recommending `timedatectl set-ntp
  false`; document `env/wsl-clock-resync-task.xml` as an OPTIONAL operator
  step, no longer wired in as primary.
- [ ] **4. Networking check (conditional, warn-only)** — WHERE a
  cross-boundary `localhost` dependency is configured (NATS `nats.url`, or
  an interactive login expected), verify mirrored mode OR
  NAT-with-`localhostForwarding` — prefer `wslinfo --networking-mode` (WSL ≥
  2.0.9) when present, falling back to a heuristic otherwise; warn about
  `::1` not being forwarded.
- [ ] **5. Tool-resolution check (warn-only)** — `command -v
  grok/codex/bun/node` SHALL resolve to a non-`/mnt/c` path; warn on a
  `/mnt/c` match (Windows shim shadowing).
- [ ] **6. Wire into Setup and Use** — call the preflight from
  `foreman-setup.sh` (Setup) and from `lane-run.sh`'s lane-start (Use),
  before any timestamped event log write; confirm all checks except the
  `/mnt/*` refusal are non-fatal.
- [ ] **7. Bats** — `tests/wsl-preflight.bats`: off-WSL no-op; `/mnt/*`
  FOREMAN_HOME refusal fires and blocks; `FOREMAN_ALLOW_MNT_HOME=1` overrides
  the refusal (loud-warn, exit 0); a `/mnt/*` worktree with a native
  `FOREMAN_HOME` only warns, never blocks; non-`/mnt/*` FOREMAN_HOME passes;
  Windows Git-Bash `/c/...` shape never triggers refusal (with or without the
  override set); clock/networking/tool checks warn under their trigger
  conditions.
- [ ] **8. Live WSL verification** — re-probe the `/mnt/*` FOREMAN_HOME
  refusal against a real `/mnt/*` path on the WSL2 host, both with and
  without `FOREMAN_ALLOW_MNT_HOME=1`; paste evidence.
- [ ] **9. Verify** — `bash -n`; bats under the mutex; `docs-check.sh`.

Acceptance: a `/mnt/*` FOREMAN_HOME is refused with an actionable message on
WSL only (never on Windows Git-Bash), with a `FOREMAN_ALLOW_MNT_HOME=1`
loud-warn override; a `/mnt/*` worktree is warn-only, never refused; stale
WSL build and residual clock jitter are warned, not silently ignored;
conditional networking (preferring `wslinfo --networking-mode` when present)
and tool warnings fire correctly; wired into both Setup and lane-start before
any event-log write; bats + live-WSL evidence attached.
