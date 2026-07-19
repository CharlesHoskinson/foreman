# Change: lifecycle-three-stage

## Why

Foreman today interleaves environment setup, model authentication, the
orchestration loop, and teardown ad hoc across the skill and scripts. Auth in
particular is discovered mid-run: a lane fails because grok isn't signed in,
or codex/claude auth has lapsed, and the failure surfaces deep inside a Use
round instead of at the door. This is the same class of problem the v0.2.5
prevention work attacked for process ownership — the fix is a defined
lifecycle with a gate between stages.

Foreman SHALL operate in three explicit, ordered stages:

1. **Setup & Environment** — tool-check → bootstrap → **model
   authentication** (grok, codex, claude, and any future vendor) → WSL
   provisioning → readiness assertion. Nothing in Use runs until Setup
   reports READY. Auth lives here and only here.
2. **Use** — the orchestration loop (spec → lane → verify → audit → gate →
   merge). Use ASSUMES an authenticated, provisioned environment; it never
   authenticates.
3. **Cleanup** — worktree removal (porcelain-checked), report archiving,
   daemon shutdown, gate-lock sweep, transient-state teardown.

The stages are the organizing frame the rest of v0.2.7.5 plugs into: auth
from grok-lane-activation and the vendor CLIs lands in Setup; the
worktree-hardening cleanup rules and daemon/lock teardown land in Cleanup;
the full-WSL install runs the same three stages on Linux.

## What changes

- SKILL.md restructured around the three stages, with the Setup readiness
  gate as a hard precondition to Use.
- A `foreman-setup` responsibility (script or documented skill step) that is
  idempotent, provisions + authenticates every configured vendor, and emits a
  machine-readable readiness verdict (extends tool-check).
- A `foreman-cleanup` responsibility that runs the teardown set deterministically
  (worktree porcelain-check + archive, `pueued`/gate-lock release, subprocess
  reaping) — the Cleanup counterpart to Setup.
- Auth doctrine centralized: each vendor's auth step (grok
  `login --device-code`/`XAI_API_KEY`, codex, claude) is a Setup step with a
  verified "authenticated?" probe, not an in-lane check.

## Impact

- Affected: `skills/foreman/SKILL.md`, a new `scripts/foreman-setup.sh` +
  `scripts/foreman-cleanup.sh` (or documented stage entries wrapping existing
  tool-check/bootstrap/wt-cleanup/lane-supervise), `env/tool-check.*`
  (readiness verdict incl. auth state), `references/reference-environment.md`
  and `orchestration-hardening.md` (the lifecycle doctrine),
  `tests/foreman-setup.bats` / `tests/foreman-cleanup.bats`.
- Cross-cutting: grok-lane-activation delegates auth to Setup;
  wsl-reliability-env-refresh runs the same three stages on WSL;
  worktree-hardening's cleanup rules are the Cleanup stage's content.
- Backward compatible: existing scripts keep working; the stages compose them.
