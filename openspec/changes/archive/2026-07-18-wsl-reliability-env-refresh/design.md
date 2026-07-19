# Design — wsl-reliability-env-refresh

## Research basis (2026-07-18, probed live)

WSL 2.7.8.0, kernel 6.18.33.1-1, Ubuntu 26.04. `.wslconfig` = memory=64GB /
processors=24 / swap=32GB only. `/mnt/c` = 9p (not virtiofs). resolv.conf =
NAT nameserver (mirrored networking OFF). Root-only, no `[user]` block. WSL
PATH carries 62 `/mnt/c` entries → WSL `codex` resolves the Windows shim and
crashes on the missing Linux native dep (LIVE BUG). shellcheck absent both
sides despite the manifest's claim (STALE). grok/bun absent from the current
Windows shell + WSL.

Practices (cited): ext4 placement beats 9p 5–10x for small-file git;
virtiofs not GA (open bugs) — trial only. `networkingMode=mirrored` +
`dnsTunneling=true` for localhost/VPN interop; `autoMemoryReclaim=gradual`
over dropcache; `sparseVhd=true` to cap vhdx. `processors=24` on 24 CPUs =
zero host headroom → wall-clock flake. Clock freezes on S0 sleep (GH #10006)
→ `hwclock -s` resume hook / preflight; systemd-timesyncd available. wsl.exe
interop hangs often = Defender scanning VHDX → path exclusions. Root-only →
create non-root user via `[user] default=` but every `/root/...` install
must be chown'd/reinstalled first.

Dependency table (installed → stable → action): git hold; node align WSL to
24; npm reprovision WSL (9.2.0 mismatch); Bun HOLD 1.3.14 (1.4 canary,
panics); pueue 4.0.4 hold; bats-core re-clone on WSL (missing); docker WSL
29.5.3→29.6.1; gh 2.92.0→2.96.0 (security); shellcheck INSTALL (not found);
jq/python3/lychee/codespell/markdownlint hold.

## Approach

Config/env/manifest changes plus WSL-side installs, each verified by a probe.
The two live bugs (WSL codex, stale manifest) are fixed first. `.wslconfig`
and `/etc/wsl.conf` edits are applied and re-probed. The clock-sync hook is
a small resume-triggered artifact + a lane-start preflight guard. The
root→non-root migration is inventoried only — flipping the default user
breaks every `/root/...` path and is its own audited change.

## Execution

Implementer: **Sonnet 5**. Audit: **Opus 4.8**. Because this touches host/WSL
config (harder to unit-test), acceptance leans on probe evidence: each
requirement's scenario re-probed and pasted; the manifest reconciliation
diffed against live `--version` output.
