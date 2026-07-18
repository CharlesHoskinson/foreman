# Tasks — docs-readme-refresh

Implementer: Sonnet 5 · Audit: Opus 4.8. Sequenced LAST — documents the whole
shipped v0.2.7.5 surface. Every shown command verified against the code.

- [ ] **1. Inventory + ground-truth** — enumerate the current surface from
  SKILL.md/references/scripts; list every command/flag/path the docs will
  show and verify each against the code (no invented flags).
- [ ] **2. README.md** — rewrite to the current product: three-stage
  lifecycle, soft/hard modes as shipped, vendor lanes incl. grok, Windows +
  WSL quickstarts (full-WSL), honest capabilities-and-limits.
- [ ] **3. docs/USAGE.md** — full operating guide: Setup (incl. auth) → Use →
  Cleanup, vendor recipes, pueue/gate doctrine, worktree/WSL troubleshooting;
  consistent with the reference docs.
- [ ] **4. CLAUDE.md** — reconcile the architect doctrine with the shipped
  lifecycle + lanes.
- [ ] **5. References** — index + cross-link orchestration-hardening +
  reference-environment + lifecycle; fix stale links; `docs/INSTALL.md` if
  warranted.
- [ ] **6. Humanizer pass** — install + run `blader/humanizer` (`/plugin
  marketplace add blader/humanizer`, `/plugin install humanizer@humanizer`,
  `/humanizer`) over README + USAGE + INSTALL; wording only, no technical
  change; if uninstallable, state the blocker + name the substitute skill.
- [ ] **7. Verify** — `docs-check.sh` green (markdownlint/codespell/lychee, no
  broken links); spot-run the documented quickstarts on Windows AND WSL;
  Opus audits ground-truth fidelity + prose.

Acceptance: README + USAGE + CLAUDE.md + references reflect the shipped
v0.2.7.5 surface with verified commands; humanizer pass applied; docs-check
green; both quickstarts run as written. Archive on ship.
