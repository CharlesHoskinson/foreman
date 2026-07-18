# Vendor concurrency results (T5b — deferred, destructive)

STATUS: **UNVERIFIED**. This document is a stub. T5a (isolation plumbing —
wt-new.sh's per-lane `vendor-home` provisioning + lane-run.sh's
`LANE_VENDOR`/`LANE_CONFIG_DIR` env passthrough) wires the mechanism only;
it does **not** establish whether per-lane `GROK_HOME`/`CODEX_HOME` actually
prevents cross-lane interference under a real vendor CLI. That destructive
verdict is T5b: run manually, once per vendor, on throwaway specs — never
gated into T5a completion, and never automated into CI or a bats suite.

## Protocol (run manually, per vendor)

1. Cut N=2 (then N=3 if N=2 is clean) throwaway-spec lane worktrees via
   `wt-new.sh` for the **same** vendor (e.g. two `implement` lanes, both
   destined to run with `LANE_VENDOR=grok`).
2. Dispatch each through `lane-run.sh` with `LANE_VENDOR` set and
   `LANE_CONFIG_DIR` left at its wt-new-provisioned default — i.e. each
   lane gets its own `<wt>/.harness/vendor-home/<vendor>/`.
3. Run the lanes concurrently against the same vendor's pueue group (grok
   and codex are both capped at `parallel=1` today — this protocol is also
   what would justify raising that cap for a given vendor).
4. Observe and record concrete evidence (transcripts, diffs, timing, any
   auth/cache state written OUTSIDE the HOME-style env var): does the
   vendor CLI actually isolate cleanly with separate per-lane config dirs,
   or does it still cross-contaminate (shared caches, lock files, auth
   state, rate-limit state, etc. living somewhere other than the
   HOME-style dir)?
5. Repeat at N=3 only if N=2 came back clean.
6. Pueue caps (`grok`/`codex` parallel) are raised **only** on green
   (clean, reproducible) results for that specific vendor, recorded as a
   row below. Until then, the standing doctrine (grok=1, codex=1) holds
   unconditionally.

## Constraints

- Destructive and real-CLI-only: this is explicitly NOT the fake-shim
  coverage in `tests/vendor-isolation.bats` (which proves the plumbing
  wires through correctly, not that isolation actually holds under a real
  vendor process). Never run this protocol in CI or any automated gate.
- The codex half of this protocol CAN run now (codex CLI present on this
  host as of 2026-07-18). The grok half is BLOCKED: the grok CLI is absent
  on this host (see
  `docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md`,
  Task 5 / environment status section). Until a run is recorded for a
  given vendor, that vendor's row stays absent and its cap stays at 1.

## Results

| Vendor | N | Date | Isolation clean? | Notes | Cap after |
|--------|---|------|-------------------|-------|-----------|
| _(none yet — table intentionally empty)_ | | | | | |

No results are recorded above. Do not raise the `grok`/`codex` pueue caps
above 1 on the strength of T5a's plumbing tests alone — that requires a
genuine, reproducible run recorded as a row in this table.
