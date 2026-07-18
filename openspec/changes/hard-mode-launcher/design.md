# Design — hard-mode-launcher (approved spec)

## Research basis (2026-07-18, cited)

- **Sandbox SOTA:** Anthropic OS-level+proxy ("srt", bubblewrap/Seatbelt +
  egress proxy allowlist); Codex 3-mode sandbox (read-only/workspace-write/
  danger-full — don't nest inside a container); Docker Sandboxes `sbx`
  microVM (GA Jan 2026, Windows 11 x86_64, control CLI unreachable from
  inside the VM); devcontainer + `init-firewall.sh` (default-deny iptables/
  ipset allowlist — the lightest pattern practical on Docker Desktop/WSL2
  today). Refs: anthropic.com/engineering/claude-code-sandboxing,
  developers.openai.com/codex/concepts/sandboxing,
  docker.com/products/docker-sandboxes, anthropics/claude-code
  .devcontainer/init-firewall.sh.
- **Mounts/network:** worktree copy not read-only bind (dagger/container-use
  pattern — matches foreman's existing `wt_path`/`wt_branch`); network
  default none; never mount docker.sock or host secrets.
- **gh PR automation:** `-F/--body-file` (accepts `-`) not `-b` string
  (the #1 anti-pattern); `--draft`/`--head`/`--base`/`--label`; fine-grained
  PAT (Contents:write + PR:write, single repo, expiring) not classic PAT/
  GITHUB_TOKEN. Ref: cli.github.com/manual/gh_pr_create.
- **Diff gating:** branch-per-agent + host `git checkout` review; the
  "3-checkpoint" Gate-3 diff-before-push. foreman's pr-open already gates on
  `gate-decision.json.pass`. Don't sign commits inside the container.
- **Windows host:** keep worktrees on WSL ext4 (9P slow for small-file git);
  Docker Desktop WSL2 backend adds daemon-hop latency (fine for per-run
  volume).

## Approach

Adopt the devcontainer+firewall pattern as the container profile and make
launcher-only the default so hard mode works with zero new install on top of
v0.2.5's launcher. worker-run leans on the existing worktree helpers +
event-log schema (heartbeat mirroring); pr-open completes the host-side,
draft-only, scoped-token flow behind the existing gate precondition.

Why approved-spec, not implemented in v0.2.7.5: it depends on this release's
worktree-hardening (copy hygiene) and posix-cascade-parity (WSL container
supervision) landing first, and it is a larger surface than the five
implemented packages — sequencing it next keeps v0.2.7.5 shippable in one
cycle (the user's chosen ratio).

## Execution (next release)

Implementer: Sonnet 5 · Audit: Opus 4.8. Container profile requires the WSL
reliability work; launcher-only profile can be built and proven first.
