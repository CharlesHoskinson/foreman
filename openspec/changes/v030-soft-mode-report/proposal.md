# Change: v030-soft-mode-report

**Disposition: APPROVED SPEC (executed next release, not in v0.2.7.5).**

## Why

v0.3.0 (session transport — subscription-session workers via codex
mcp-server threadId continuity, `claude -p/--resume`, grok headless) exists on
remote branch `dev/foreman-v1` but a 2026-07-16 review BLOCKED direct merge:
the branch shares NO git ancestry with main (55-commit parallel history), and
main's architecture evolved past the shape the series splices into (soft-mode,
no `adapters/` dir, divergent `lib/common.sh`). The architect decision —
revive hard mode vs port into soft-mode — is settled: **port into soft-mode**
(matches where main actually went; the launcher now supplies the process
ownership the branch's session workers need).

Research (2026-07-18, cited in design.md) verified the re-port mechanism and
the current MCP invocations, and sized the surface.

## What changes

- Re-port `dev/foreman-v1`'s session-transport surface onto main's current
  soft-mode + launcher architecture using per-commit `git format-patch |
  git am -3` (works without a common ancestor; preserves per-commit
  provenance), each ported commit stamped `Ports: dev/foreman-v1@<sha>`.
- Adapters (`adapters/*.sh`, `mcp/mcp-session.py`) spawn vendor sessions VIA
  foreman-launch; sessions ride `lane-run --round`.
- Resolve the 2 real conflicts (`lib/common.sh` diverged +66%; `install.sh`)
  by semantic 3-way merge against main's current shape.
- Execute the branch's never-run live-acceptance step (its Task 11,
  `docs/demo-log.md`) — MANDATORY before merge — against a live `codex
  mcp-server` to verify the real tool schema.

## Impact

- Affected (ported IN): `skills/foreman/scripts/adapters/` (4 adapters +
  verdict.schema.json), `skills/foreman/scripts/mcp/mcp-session.py`,
  `sandbox/`, 11 new `.bats`; MODIFIED by 3-way: `lib/common.sh`, `install.sh`.
- Depends on: v0.2.5 launcher; v0.2.7.5 posix-cascade-parity (sessions run on
  WSL through the POSIX launcher) and wsl-reliability-env-refresh (WSL is the
  session host).
- The MCP tool schema is UNVERIFIED-until-live-acceptance; grok headless resume
  on the branch is unverified against xAI docs — both gate the merge.
