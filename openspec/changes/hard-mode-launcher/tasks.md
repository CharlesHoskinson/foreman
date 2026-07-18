# Tasks — hard-mode-launcher (approved spec, next-release execution)

Implementer: Sonnet 5 · Audit: Opus 4.8. Do NOT start until v0.2.7.5's
worktree-hardening + posix-cascade-parity have landed.

- [ ] **1. worker-run launcher-only profile** — foreman-launch supervises the
  worker against a worktree copy, network none, heartbeats → event log,
  host-side evidence extraction, no in-sandbox commit; bats.
- [ ] **2. worker-run container profile** — devcontainer + `init-firewall.sh`
  default-deny egress allowlist; opt-in via config; the launcher supervises
  the container process; bats (Docker-guarded, skip if absent).
- [ ] **3. pr-open completion** — gate precondition → host-side push →
  `gh pr create --draft -F body-file` with a fine-grained scoped PAT; worker
  never holds credentials; `gh pr ready` separate; bats for the gate-refuse
  and draft-create paths (gh-guarded).
- [ ] **4. Least-privilege plumbing** — no docker.sock, no host secrets to the
  worker; scoped token only to host-side gh.
- [ ] **5. Docs** — security-model.md + orchestration-hardening.md hard-mode
  section (profiles, mount/network policy, PR flow).
- [ ] **6. Verify** — bats under the mutex; `tests/run.sh`; `docs-check.sh`;
  a launcher-only hard-mode task run end-to-end as the proof.

Acceptance: worker-run + pr-open shipped (both profiles; launcher-only
proven), least-privilege enforced, gate precondition preserved, suite +
docs-check green.
