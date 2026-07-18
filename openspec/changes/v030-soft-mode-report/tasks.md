# Tasks — v030-soft-mode-report (approved spec, next-release execution)

Implementer: Sonnet 5 · Audit: Opus 4.8. Start after v0.2.7.5's
posix-cascade-parity + wsl-reliability-env-refresh land.

- [ ] **1. Port scaffolding** — `git format-patch` the branch's
  session-transport commits; establish the `git am -3` flow; confirm blobs
  resolve locally (branch is fetched).
- [ ] **2. New subtrees** — port `adapters/*`, `mcp/mcp-session.py`,
  `sandbox/`, 11 .bats via am -3, each commit stamped `Ports:
  dev/foreman-v1@<sha>`; design-fit adapters against main's soft-mode
  dispatch (spawn via foreman-launch, ride lane-run --round).
- [ ] **3. Conflict files (focused audit)** — semantic 3-way resolve
  `lib/common.sh` (preserve main's helpers + branch's group_timeout/
  watchdog-reap intent) and `install.sh`; Opus audits these two specifically.
- [ ] **4. Live acceptance (merge gate)** — run the branch's Task 11 against a
  live `codex mcp-server`; verify tool names/threadId/output; record in
  `docs/demo-log.md`; correct adapters + re-run on any schema drift; verify or
  mark-unsupported grok headless resume.
- [ ] **5. Regression** — full existing suite stays green; new .bats additive.
- [ ] **6. Verify** — bats under the mutex; `tests/run.sh`; `docs-check.sh`.

Acceptance: session-transport surface ported onto soft-mode with per-commit
provenance; 2 conflict files resolved + audited; live acceptance green (real
MCP schema verified); no v0.2.x regression. This unblocks the v0.3.0 tag.
