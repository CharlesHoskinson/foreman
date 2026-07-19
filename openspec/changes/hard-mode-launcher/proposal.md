# Change: hard-mode-launcher

**Disposition: APPROVED SPEC (executed next release, not in v0.2.7.5).** This
folder is complete and self-consistent so the next release can execute it
directly.

## Why

foreman's "hard mode" (untrusted/autonomous workers with host-side evidence
and a deterministic gate → PR) has had a stub `worker-run.sh` since v0.1.0 and
a partial `pr-open.sh`. Meanwhile v0.2.5 shipped a real process-ownership
launcher (foreman-launch, Job Objects/pidns), which supplies the supervision
hard mode was missing. Research (2026-07-18, cited in design.md) found a clear
2026 SOTA to adopt rather than invent: the devcontainer + egress-firewall
pattern (practical on today's Docker Desktop/WSL2), with Docker Sandboxes
(`sbx` microVM) as the kernel-isolation upgrade path.

## What changes

- **`worker-run.sh`** (currently a stub): foreman-launch supervises the
  worker; heartbeats mirrored into the event log; host-side evidence
  extraction (`git diff --stat`, transcript) with NO in-container commit. Two
  profiles: **launcher-only** (no container — the launcher + worktree +
  vendor-home isolation is the sandbox; the worker runs directly in the real
  worktree and shares the host's network, no firewalling) and **container**
  (the worker runs against a per-lane worktree file COPY, not a read-only
  bind of the canonical worktree, on an egress-capable bridge narrowed by a
  default-deny `init-firewall.sh` allowlist — never a bare disabled network),
  selectable by config; container is opt-in, launcher-only is the default so
  hard mode works without Docker.
- **`pr-open.sh`** (currently partial): push host-side ONLY after the gate
  passes; `gh pr create --draft --head <branch> --base main -F <body-file>`
  with a fine-grained PAT (Contents+PR write, single repo, expiring); the
  container/worker never holds push credentials; `gh pr ready` is a separate
  human/`pr-ready` gate. Keeps the v0.1.0 `gate-decision.json.pass` precondition.

## Impact

- Affected: `skills/foreman/scripts/worker-run.sh`,
  `skills/foreman/scripts/pr-open.sh`, a `sandbox/` devcontainer +
  `init-firewall.sh`, `tests/` (worker-run + pr-open bats),
  `references/security-model.md` + `orchestration-hardening.md`.
- Depends on: v0.2.5 launcher (present), v0.2.7.5 worktree-hardening (worktree
  copy hygiene) and posix-cascade-parity (WSL container supervision).
