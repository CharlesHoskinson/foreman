# Spec delta — full WSL setup + reliability + dependency refresh

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: WSL is a fully-provisioned, co-equal foreman environment

The implementer SHALL make `env/bootstrap-wsl.sh` a complete native
provisioner so that, after it runs, foreman's Setup stage reports READY inside
WSL and the full three-stage lifecycle (Setup → Use → Cleanup) runs there
identically to Windows.

- Bootstrap SHALL install every foreman tool WSL-native (bats-core,
  shellcheck, bun, pueue, codex, grok, jq, node/npm via fnm) — no foreman tool
  SHALL depend on a Windows PATH leak to resolve inside WSL.
- WHEN `foreman-setup` runs inside WSL on a bootstrapped instance, the
  readiness verdict SHALL be READY (tools present + vendors authenticated) for
  the hard/full profile, not just soft.
- Windows SHALL remain a fully-supported target; this requirement ADDS WSL as
  co-equal, it does not remove Windows support.

#### Scenario: foreman is fully usable inside WSL

- WHEN `bootstrap-wsl.sh` then `foreman-setup` run in the WSL distro
- THEN tool-check hard/full reports READY on WSL
- AND a trivial Use round + Cleanup complete inside WSL without invoking any
  Windows-side tool.

## ADDED Requirement: WSL codex resolves to a native install, not the Windows shim

The implementer SHALL install `codex` natively inside the WSL distro and set
`appendWindowsPath=false` (or reorder PATH) for the foreman distro so that
`codex` on the WSL side does NOT resolve to the Windows npm-global shim.

- WHEN `command -v codex` runs inside WSL, it SHALL resolve to the WSL-native
  binary, and `codex --version` SHALL succeed (no "Missing optional
  dependency @openai/codex-linux-x64").
- The same PATH change SHALL be verified not to break WSL access to Windows
  tools the foreman WSL path legitimately needs (document any that must stay).

#### Scenario: WSL codex runs

- WHEN `wsl codex --version` is invoked
- THEN it prints a version and exits 0, resolving the native binary.

## ADDED Requirement: .wslconfig is tuned for an agent host

The implementer SHALL update `.wslconfig` to add `networkingMode=mirrored`,
`dnsTunneling=true`, `autoMemoryReclaim=gradual`, and `sparseVhd=true`, and
SHALL reduce `processors` from 24 to ~20 to reserve host CPU headroom.

- The change SHALL keep the `memory` ceiling (host-starvation guard) and
  SHALL document that `processors` < host-logical-CPU count is the
  wall-clock-flake mitigation.
- WHERE a setting is release-experimental (e.g. virtiofs), the implementer
  SHALL NOT enable it in the primary distro (documented as a throwaway-distro
  trial only).

## ADDED Requirement: the event log survives post-sleep clock drift

WHEN the Windows host resumes from sleep, the implementer SHALL ensure the WSL
VM clock is re-synced (`hwclock -s` via a resume-triggered hook, or a foreman
preflight that compares WSL vs host time before writing event-log entries).

- IF WSL time differs from host time beyond a small threshold at lane start,
  THEN the preflight SHALL re-sync (or refuse + alert) before any timestamped
  event is written, so the event log's ordering invariants hold.

## ADDED Requirement: shellcheck and WSL bats-core are actually present

The implementer SHALL install shellcheck on both the Windows and WSL sides and
clone bats-core under the WSL foreman tools dir, and SHALL correct
`env/reference-manifest.toml` so every tool entry reflects a probe-verified
reality (no claimed-but-absent tools).

- WHEN `tool-check` runs the hard/full profile on WSL, bats and shellcheck
  SHALL report present.
- The manifest SHALL carry a probe-verified date for the reconciliation.

## ADDED Requirement: dependency versions are reconciled to verified currency

The implementer SHALL reconcile the toolchain: hold Bun at 1.3.14 (1.4 is
canary-only — the 2-patch soak rule is unmet), hold pueue 4.0.4 / jq /
python3 / lychee / codespell / markdownlint-cli2 (current), upgrade gh
(security fixes) and WSL docker (minor), and reprovision WSL node/npm to
resolve the npm-9.2.0-vs-node-22 mismatch.

- IF a tool is at current stable, THEN the manifest SHALL mark it held with
  the verified version; the implementer SHALL NOT upgrade Bun to 1.4 in this
  change.

## ADDED Requirement: the root→non-root migration is inventoried, not executed

The implementer SHALL produce an inventory of every `/root/...`-hardcoded path
and root-owned install that a non-root-user migration would break, and SHALL
document the migration as a follow-up change — this change SHALL NOT flip the
default user.

#### Scenario: inventory exists, user unchanged

- WHEN this change ships
- THEN a migration inventory exists in the reference
- AND `/etc/wsl.conf` still has no `[user] default=` (unchanged), the flip
  deferred to its own audited change.
