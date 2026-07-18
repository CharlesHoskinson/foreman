# Design — lifecycle-three-stage

## Motivation

Directive (2026-07-18): auth for grok or any model that needs it belongs in a
Setup phase that gets the models and environment ready; foreman should operate
in three stages — Setup & Environment, Use, Cleanup; the same lifecycle runs
on Windows and WSL (full-WSL setup).

This generalizes the v0.2.5 lesson (make failure structural, not
discipline-dependent) to the whole run: rather than each lane discovering
missing tools / lapsed auth mid-round, a Setup gate proves readiness once, Use
assumes it, and Cleanup guarantees teardown.

## Approach

The three stages COMPOSE existing machinery — they are an organizing frame,
not a rewrite:

- **Setup & Environment** = `tool-check` (extended with per-vendor auth probes
  + a structured readiness verdict) → `bootstrap-*` (installs) → vendor auth
  (grok `login --device-code`/`XAI_API_KEY` probe, codex auth probe, claude
  auth probe) → WSL provisioning (full-WSL package) → READY/NOT-READY.
  Idempotent; a `foreman-setup.sh` wrapper or documented skill step.
- **Use** = the existing soft-mode loop, now preceded by a readiness assertion
  keyed on the lanes a task will use. Use never authenticates.
- **Cleanup** = an ordered teardown wrapper: SIGINT lane subprocs → wt-cleanup
  (porcelain-check + archive, from worktree-hardening) → gate-lock / owned
  `pueued` release → stale-lock sweep. Idempotent; a `foreman-cleanup.sh`.

Auth-state probes (minimal, non-destructive): grok = a `grok`
whoami/`--version`+session check or a trivial `-p` ping under the lane's
`GROK_HOME`; codex/claude = their documented auth-status checks. The probe
verifies auth *works*, not merely that a token file/env var exists.

The readiness verdict extends tool-check's existing MISSING/OUTDATED vocabulary
with NOT-AUTHENTICATED and a lane-scoped READY, so a caller can ask "is the
grok lane ready?" and gate on it.

## Sequencing

This package is foundational for v0.2.7.5: the stages are where the other
packages attach (auth from grok-lane-activation → Setup; teardown from
worktree-hardening → Cleanup; full-WSL install → Setup on Linux). Land the
lifecycle skeleton first, then the other packages populate the stages.

## Execution

Implementer: **Sonnet 5**. Audit: **Opus 4.8**. Acceptance: a Setup run on a
partially-unauthenticated host yields the correct per-vendor verdict and Use
refuses the not-ready lane; a Cleanup run preserves dirty work and is
idempotent.
