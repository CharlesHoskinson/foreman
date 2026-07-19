# Design — docs-readme-refresh

## Motivation

Directive (2026-07-18): a full documentation + README update for this release,
run through a humanizer pass. Foreman is finally usable end-to-end; the docs
must let a new user (on Windows or WSL/Linux) get from clone to a completed
Use round without tribal knowledge, and read like a human wrote them.

## Approach

- **Ground-truth first:** derive every command/flag/path from the shipped code
  (SKILL.md, references, scripts, `--help`/usage lines). No invented flags —
  the same rule the reference docs already follow. Verify each shown command
  actually runs (or is clearly marked platform-specific).
- **Lifecycle as the spine:** README and USAGE are organized around Setup &
  Environment → Use → Cleanup, matching the shipped operating model, with the
  Windows and WSL quickstarts side by side (full-WSL setup).
- **Consistency pass:** cross-link the v0.2.5 (`orchestration-hardening.md`)
  and v0.2.7.5 (`reference-environment.md`, lifecycle) references into one
  coherent set; fix stale links; a new `docs/INSTALL.md` if the install story
  is too big for the README.
- **Humanizer pass LAST:** once technical content is settled, run the
  `blader/humanizer` skill (github.com/blader/humanizer — a Claude Code
  plugin: `/plugin marketplace add blader/humanizer` + `/plugin install
  humanizer@humanizer`, invoke `/humanizer`; it audits for 33 AI-writing
  indicators then does a second rewrite) over README + USAGE + INSTALL for
  natural phrasing and to clear the docs-check AI-slop signal — wording only,
  never a command or claim. If it cannot be installed on the implementing
  host, state the blocker and apply the closest available prose skill, naming
  the substitution.

Sequenced LAST in v0.2.7.5: it documents the whole shipped surface including
every other package, so it lands after them.

## Execution

Implementer: **Sonnet 5**. Audit: **Opus 4.8** — the audit here checks
ground-truth fidelity (no invented flags/paths, commands actually run) as much
as prose quality, plus a docs-check gate.
