# Tasks — lifecycle-three-stage

Implementer: Sonnet 5 · Audit: Opus 4.8 · gate mutex on every bats run.
Foundational — land the stage skeleton first; other v0.2.7.5 packages attach
to it.

- [ ] **1. Readiness verdict** — extend `env/tool-check.*` with per-vendor
  auth probes and a structured verdict (MISSING / OUTDATED / NOT-AUTHENTICATED
  / READY), lane-scoped so a caller can ask "is lane X ready?".
- [ ] **2. foreman-setup** — idempotent `scripts/foreman-setup.sh` composing
  tool-check → bootstrap → vendor auth (grok device-code/XAI_API_KEY probe,
  codex, claude) → WSL provisioning entry → READY; emits the verdict; bats for
  the not-authenticated → NOT-READY and idempotent-rerun scenarios.
- [ ] **3. foreman-cleanup** — idempotent `scripts/foreman-cleanup.sh`:
  SIGINT subprocs → wt-cleanup (porcelain + archive) → gate-lock/owned-pueued
  release → stale-lock sweep; bats for dirty-work-preserved and
  idempotent-rerun.
- [ ] **4. Use readiness gate** — Use refuses to route to a lane whose Setup
  verdict is not READY, citing Setup; bats.
- [ ] **5. SKILL.md restructure** — Setup & Environment → Use → Cleanup as the
  operating frame; auth is a Setup concern; the same stages run on Windows and
  WSL; point at the reference doctrine.
- [ ] **6. Auth centralization** — move grok's device-code/key auth out of any
  in-lane precondition into Setup (coordinate with grok-lane-activation);
  document the per-vendor auth step + probe.
- [ ] **7. Verify** — bats under the mutex; `tests/run.sh`; `docs-check.sh`;
  a full Setup→(trivial)Use→Cleanup pass as the package proof.

Acceptance: three stages documented + invocable; Setup owns auth and gates
Use; Cleanup is deterministic and idempotent; readiness verdict distinguishes
NOT-AUTHENTICATED; suite + docs-check green. Archive on ship.
