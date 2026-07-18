# Tasks — posix-cascade-parity

Implementer: Sonnet 5 · Audit: Opus 4.8 · gate mutex on every bats run.
POSIX work runs on WSL; Windows build stays frozen.

- [ ] **1. pidns bootstrap** — invoke the POSIX launcher under `unshare --pid
  --mount-proc --fork --kill-child`; detect `unshare` availability and fall
  back to `setsid`+pgid with a logged degraded marker on absence/failure.
- [ ] **2. Subreaper net** — `prctl(PR_SET_CHILD_SUBREAPER,1)` via bun:ffi
  libc dlopen at launcher startup; continue + log on failure.
- [ ] **3. Contract preservation** — confirm exit codes (child/124/125),
  heartbeat schema, and stdio passthrough are byte-identical to the Windows
  build under the pidns wrapper; `--mount-proc` gives a correct `/proc`.
- [ ] **4. WSL kill-shot test** — `tests/launcher.bats` WSL-guarded case:
  CMD spawns a `setsid`+double-fork escapee; kill the launcher; assert zero
  survivors of the recorded pids; assert the pgid-only fallback path is
  correctly downgrade-logged when `unshare` is forced absent.
- [ ] **5. Docs** — update `launcher/README.md` (asymmetry → closed via
  pidns; reverse edge; subreaper; fallback ladder + honest availability
  notes) and `references/orchestration-hardening.md`.
- [ ] **6. Verify** — `bash -n`; bun test (launcher unit); WSL bats under the
  mutex; `docs-check.sh`. Windows `tests/launcher.bats` unchanged.

Acceptance: killing the pidns-wrapped launcher leaves zero survivors of a
double-fork/setsid escapee tree on WSL; fallback path logs its downgrade;
contract unchanged; docs updated. Archive on ship.
