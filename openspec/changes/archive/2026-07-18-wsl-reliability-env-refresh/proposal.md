# Change: wsl-reliability-env-refresh (full WSL setup + reliability + deps)

## Why

Directive (2026-07-18): move foreman to a **full WSL setup** so it covers both
the Windows and Linux use cases — WSL becomes a first-class, fully-provisioned
foreman environment (not just the POSIX helper), running the same three-stage
lifecycle (Setup → Use → Cleanup) as Windows. This makes the POSIX pidns
launcher and the v0.3.0 session-transport lanes native, and gives Linux users
a supported install path.

Today the WSL side is under-tuned and drifted. A read-only research + probe
lane (2026-07-18) found two live bugs and several reliability gaps:

- **Live bug:** WSL-side `codex` resolves the Windows npm-global shim through
  a 62-entry `/mnt/c` PATH leak and crashes (`Missing optional dependency
  @openai/codex-linux-x64`).
- **Live bug:** `env/reference-manifest.toml` claims shellcheck was installed
  2026-07-17; it is present on neither side.
- `.wslconfig` sets only memory/CPU/swap — no networkingMode, autoMemoryReclaim,
  sparseVhd; `processors=24` on a 24-logical-CPU host reserves zero host
  headroom (the wall-clock-flake class).
- WSL clock drifts after host sleep — directly threatens foreman's
  timestamp-based event log.
- bats-core is not cloned on the WSL side (hard/full profile can't run there);
  WSL npm is anomalously old (9.2.0 vs node 22).

## What changes

**Full WSL setup (headline):** `env/bootstrap-wsl.sh` becomes a complete
native provisioner — every foreman tool installed WSL-native (bats-core,
shellcheck, bun, pueue, codex, grok, jq, node/npm via fnm), no reliance on
Windows PATH leakage — so `foreman-setup` (Setup stage) reports READY inside
WSL and the full three-stage lifecycle runs there identically to Windows.
Windows remains fully supported; this adds Linux/WSL as a co-equal target.

Plus the research's prioritized reliability actions (see design.md):

1. Fix WSL-native `codex` install; set `appendWindowsPath=false` for the
   foreman distro (stops the PATH leak).
2. `.wslconfig`: add `networkingMode=mirrored`, `dnsTunneling=true`,
   `autoMemoryReclaim=gradual`, `sparseVhd=true`; drop `processors` to ~20.
3. Install shellcheck for real (both sides); correct the manifest.
4. Re-clone bats-core under WSL for the hard/full profile.
5. Reprovision WSL node/npm (via fnm) to fix the version mismatch.
6. Add a sleep-resume `hwclock -s` sync hook protecting the event log.
7. Add Windows Defender exclusions for the WSL VHDX + hot ext4 paths.
8. Inventory (do NOT execute) the root→non-root user migration.

Plus a dependency reconciliation: hold Bun 1.3.14 (1.4 still canary), hold
pueue/jq/python3/lychee/codespell/markdownlint (current), upgrade gh (security)
and WSL docker (minor); update the manifest to match reality with a
probe-verified date.

## Impact

- Affected: `.wslconfig`, `/etc/wsl.conf` (appendWindowsPath, planned [user]),
  `env/reference-manifest.toml`, `env/tool-check.sh` (WSL probes),
  `env/bootstrap-wsl.sh` (codex/shellcheck/bats/fnm), a resume-hook artifact,
  `references/reference-environment.md`.
- The root→non-root migration is INVENTORIED here and EXECUTED in a later
  change (breaks `/root/...`-hardcoded paths — needs its own audited pass).
