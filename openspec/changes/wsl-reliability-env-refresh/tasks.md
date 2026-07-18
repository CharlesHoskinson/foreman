# Tasks — wsl-reliability-env-refresh

Implementer: Sonnet 5 · Audit: Opus 4.8. Host/WSL config work — verify by
re-probe, paste evidence.

- [ ] **1. WSL codex fix** — native install + `appendWindowsPath=false` (or
  PATH reorder); re-probe `wsl codex --version` succeeds; document any
  Windows tools WSL must retain.
- [ ] **2. .wslconfig tuning** — add mirrored networking, dnsTunneling,
  autoMemoryReclaim=gradual, sparseVhd; processors 24→~20; `wsl --shutdown`
  + re-probe.
- [ ] **3. shellcheck** — install both sides; correct the manifest entry.
- [ ] **4. WSL bats-core** — clone under the WSL foreman tools dir; hard/full
  tool-check reports present on WSL.
- [ ] **5. WSL node/npm** — reprovision via fnm; re-probe versions aligned.
- [ ] **6. Clock-sync hook** — resume-triggered `hwclock -s` + a lane-start
  preflight comparing WSL vs host time before any timestamped event; test the
  preflight's re-sync/refuse path.
- [ ] **7. Defender exclusions** — document VHDX + hot ext4 path exclusions.
- [ ] **8. Dependency reconciliation** — apply the hold/upgrade table (gh +
  docker up; Bun HELD at 1.3.14); manifest carries a probe-verified date.
- [ ] **9. Root→non-root inventory** — enumerate `/root/...`-hardcoded paths
  + root-owned installs; document as a follow-up change; do NOT flip the user.
- [ ] **10. Verify** — `tool-check` hard/full on both sides; `bash -n` on
  touched scripts; `docs-check.sh`; paste re-probe evidence per requirement.

Acceptance: WSL codex bug fixed; .wslconfig + manifest reconciled to reality;
clock-sync hook present; bats/shellcheck present on WSL; dependency table
applied (Bun held); migration inventoried not executed; probes pasted.
Archive on ship.
