# Design — wsl-preflight

Parent design: `docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`
(package P3).

## Citations (load-bearing)

- **Filesystem integrity:** `skills/foreman/references/durable-lanes.md:106-108`
  — `store_dir`/`events.jsonl`/`stream.ndjson` must live on a native
  filesystem (WSL ext4 root, or the Windows-native path under Git Bash),
  never `/mnt/c/...`, for fsync integrity. No runtime guard exists today.
- **Clock (SOTA, R3):** WSL 2.1.1 (2024-01-22, microsoft/WSL#10006) fixed the
  severe sleep/resume clock drift that motivated the original v0.2.7.5
  design. The residual problem is a ~1-2s dual-NTP jitter (WSL
  `systemd-timesyncd` racing Hyper-V host time sync); the documented fix is
  `timedatectl set-ntp false` inside the WSL distro. foreman's
  `env/wsl-clock-preflight.sh` and `env/wsl-clock-resync-task.xml` are BUILT
  but referenced by nothing (`grep` of `foreman-setup.sh`/`lane-run.sh`
  confirms zero matches) — R2's largest built-but-not-connected gap.
- **Networking (SOTA, R2/R3):** `localhostForwarding` (default `true`) makes
  a NAT-mode `localhost` callback reachable across the boundary, but `::1`
  is NOT forwarded (only IPv4 `127.0.0.1` binds work); mirrored networking
  mode shares `127.0.0.1` directly but is still receiving port-tracking
  fixes upstream as of 2.9.3/2.9.4 (mid-2026) — recommend, don't require, per
  the parent design's open-questions note. `durable-lanes.md`'s Windows/WSL
  notes: mirrored mode makes `localhost:4222` (NATS) reachable across the
  boundary; NAT mode does not.
- **Tool resolution (SOTA, R2/R4):** vendor CLIs (`grok`, `codex`, `bun`,
  `node`) can resolve to a `/mnt/c` Windows shim shadowing the WSL-native
  binary — the same class of bug as the already-fixed WSL `codex` PATH leak
  (`appendWindowsPath=false`, documented per-machine in
  `env/reference-manifest.toml` but not yet a repo-tracked guarantee; see
  the sibling wsl-tool-path-persistence package for the persistence fix —
  this package only *detects and warns*).

## Approach

One script, two call sites, non-fatal by default:

1. **`skills/foreman/scripts/wsl-preflight.sh`.** Detects WSL with `grep -qi
   microsoft /proc/version`; if not WSL, exits 0 immediately (zero-cost
   no-op on Windows/Git-Bash and native Linux CI). On WSL, runs four checks
   in order — filesystem (hard refuse), clock (warn), networking (warn,
   conditional), tool resolution (warn) — and prints one line per finding.
2. **Filesystem check is the one hard invariant.** IF `FOREMAN_HOME` or the
   currently active worktree path resolves under `/mnt/*`, the script exits
   non-zero with a message naming the fsync-integrity reason and how to
   relocate `FOREMAN_HOME` (per `durable-lanes.md`'s existing guidance).
   Everything else is a warning, not a refusal.
3. **Clock check is the P3 pivot.** Instead of running the heavy
   `wsl-clock-resync-task.xml` Scheduled Task as the primary mechanism, the
   preflight (a) warns if the WSL kernel/build reports < 2.1.1 (recommend
   `wsl --update`), and (b) detects the residual dual-NTP jitter condition
   and recommends `timedatectl set-ntp false`. The existing
   `env/wsl-clock-preflight.sh` logic is folded in here as the jitter-guard
   implementation; `wsl-clock-resync-task.xml` is retired to an OPTIONAL,
   documented-only operator step (not removed, not auto-installed).
4. **Networking check is conditional.** Only runs when a cross-boundary
   `localhost` dependency is actually configured (a `nats.url` pointing at
   `localhost`/`127.0.0.1`, or an interactive vendor login expected this
   session). It verifies mirrored mode is active OR NAT +
   `localhostForwarding` is active, and separately warns about the
   `::1`-not-forwarded gotcha regardless of mode.
5. **Tool-resolution check.** For each of `grok`/`codex`/`bun`/`node`,
   `command -v` is resolved and the result checked against `/mnt/c`; a match
   warns that the WSL-native binary may be shadowed by a Windows shim.
6. **Wiring.** `foreman-setup.sh` calls the preflight once during Setup;
   `lane-run.sh` calls it at lane-start, before any timestamped event is
   written to the event log — so a refusal never lets a lane begin writing
   under a `/mnt/*` FOREMAN_HOME.

## Key decisions

- The filesystem refusal is scoped to `/mnt/*` specifically — it must never
  fire for the Windows Git-Bash default (`/c/...`), which is a different,
  legitimate path shape. This is the parent design's explicit risk note.
- Mirrored networking is recommended, not required, because it is still
  receiving upstream fixes (2.9.3/2.9.4) — NAT + `localhostForwarding`
  remains a valid, warned-not-blocked configuration.
- The heavy Scheduled-Task resync mechanism is demoted, not deleted: some
  operators may still want proactive resync, so it stays as documented,
  optional tooling rather than something the preflight installs or depends
  on.

## Verification

`tests/wsl-preflight.bats` proves: off-WSL no-op; on a WSL-shaped fixture,
the `/mnt/*` FOREMAN_HOME refusal fires and blocks the run; a non-`/mnt/*`
FOREMAN_HOME passes; the Windows Git-Bash `/c/...` shape never triggers the
refusal; clock/networking/tool-resolution checks warn (non-fatal) under
their respective trigger conditions. Per the parent design's testing bias,
the `/mnt/*` refusal is additionally verified live against a real `/mnt/*`
`FOREMAN_HOME` on the WSL2 host.
