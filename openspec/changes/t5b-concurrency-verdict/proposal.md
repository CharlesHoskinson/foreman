# Change: t5b-concurrency-verdict

## Why

v0.2.5's T5a shipped vendor-config isolation *plumbing* but left T5b — the
destructive verdict on whether N>1 concurrent instances of the same vendor
CLI are safe — UNVERIFIED (grok CLI was absent; `docs/research/
vendor-concurrency-results.md` is a stub). pueue caps stay grok=1/codex=1 as
a result. Grok is now installed and verified, so the matrix can run.

Research (2026-07-18, cited in design.md) already answers the Claude Code arm
from a large public issue base — concurrent instances corrupt shared state
and `CLAUDE_CONFIG_DIR` alone does not isolate it — so Claude Code's verdict
is settled without local destruction. This change runs the grok and codex
arms destructively under containment and records verdicts that gate any pueue
cap increase.

## What changes

- Execute the N=2,3 destructive concurrency matrix for grok and codex on
  throwaway repos with isolated config dirs and lowest-tier auth.
- Populate `docs/research/vendor-concurrency-results.md` with per-vendor
  verdicts, observed signals, and the abort log.
- Raise pueue group caps ONLY for a vendor with a green N-result; UNVERIFIED
  vendors stay at 1 (documented).
- IF grok greens, flip the one-line doctrine promoting grok to default
  implementer (the promotion deferred from grok-lane-activation).

## Impact

- Affected: `docs/research/vendor-concurrency-results.md`,
  `skills/foreman/scripts/lane-queue.sh` (group cap defaults ONLY if a green
  verdict justifies it), `.foreman/config.toml` / `config/foreman.toml.example`
  (documented caps), `CLAUDE.md` / `SKILL.md` (default-lane doctrine IF grok
  greens).
- Safety-first: no cap is raised without recorded green evidence; the default
  posture on any doubt is to keep the cap at 1.
