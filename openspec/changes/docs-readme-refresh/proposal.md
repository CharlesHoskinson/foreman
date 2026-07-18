# Change: docs-readme-refresh

## Why

Foreman's documentation has fallen behind the code. README.md and docs/ still
describe the v0.1.0/v0.2.0 surface; they do not cover v0.2.5's
orchestration-hardening stack (launcher, round ownership, watch v2,
auto-resume, pueue admission) or v0.2.7.5's usability work (the three-stage
lifecycle, grok lanes, full WSL setup, POSIX parity, worktree hardening). A
release that makes foreman genuinely usable needs docs a new user can follow
end-to-end. The prose also reads machine-generated in places; it needs a
humanizer pass so it reads like a person wrote it.

## What changes

- **README.md** — rewritten to the current product: what foreman is, the
  three-stage lifecycle (Setup & Environment → Use → Cleanup), the soft/hard
  modes as they actually ship, quickstart for BOTH Windows and WSL/Linux
  (full-WSL setup), the vendor lanes incl. grok, and an honest capabilities +
  limits section.
- **docs/USAGE.md** — the full operating guide updated to the lifecycle: how
  to run Setup (incl. model auth), drive a Use round, and Cleanup; the vendor
  lane recipes; the pueue/gate doctrine; troubleshooting (the worktree/WSL
  guard bundle).
- **CLAUDE.md** — the architect doctrine reconciled with the shipped
  lifecycle + lanes (grok now live; Sonnet/Opus era pin; the three stages).
- **References** — index/cross-link the v0.2.5 + v0.2.7.5 reference docs
  (orchestration-hardening, reference-environment) into a coherent doc set;
  fix stale links.
- **Humanizer pass** — run the `blader/humanizer` skill over the user-facing
  prose (README, USAGE, INSTALL) so it reads naturally and passes the
  docs-check AI-slop bar, without changing technical content. The skill
  detects 33 AI-writing indicators and does an audit + second-rewrite pass;
  install `/plugin marketplace add blader/humanizer` then
  `/plugin install humanizer@humanizer`, invoke `/humanizer`.

## Impact

- Affected: `README.md`, `docs/USAGE.md`, `CLAUDE.md`,
  `skills/foreman/references/*` (index + cross-links), possibly
  `docs/INSTALL.md` (new, WSL + Windows).
- Documentation-only: no script/behavior change; every command and path shown
  SHALL be verified against the shipped code (no invented flags).
- Sequenced LAST in v0.2.7.5 (documents the whole shipped surface, incl. the
  other packages).
