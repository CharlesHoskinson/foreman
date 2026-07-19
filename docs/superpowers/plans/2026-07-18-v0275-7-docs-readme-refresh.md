# docs-readme-refresh Implementation Plan (v0.2.7.5 · package 7/7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS: `openspec/changes/archive/2026-07-18-docs-readme-refresh/specs/documentation/spec.md`.
> Sequenced LAST — documents the whole shipped v0.2.7.5 surface (all six other
> packages must be merged first).

**Goal:** Bring README, USAGE, CLAUDE.md, and the reference set up to the
shipped surface (three-stage lifecycle, soft/hard modes, vendor lanes incl.
grok, Windows + WSL quickstarts), with every command verified against code,
then a blader/humanizer prose pass.

**Architecture:** Ground-truth first (derive every command/flag/path from
SKILL.md/references/scripts/usage lines — no invented flags), organize the
README and USAGE around Setup → Use → Cleanup with side-by-side Windows/WSL
quickstarts, cross-link the reference set, then humanize the prose without
touching technical content.

**Tech Stack:** Markdown, `docs-check.sh` (markdownlint/codespell/lychee),
the `blader/humanizer` Claude Code plugin.

## Global constraints

Documentation-only — NO script/behavior change. Every command/flag/path shown
MUST be verified against the shipped code (run it or mark it platform-specific).
docs-check must be green. The humanizer pass changes wording only.

## File structure

- Modify `README.md` — the product overview + quickstarts.
- Modify `docs/USAGE.md` — the full operating guide.
- Modify `CLAUDE.md` — architect doctrine reconciled to the lifecycle.
- Modify `skills/foreman/references/*` — index + cross-links, fix stale links.
- Create `docs/INSTALL.md` (if the install story outgrows the README).

---

### Task 1: ground-truth inventory

- [ ] **Step 1** — Enumerate the current surface: every user-facing command,
  flag, path, and env var from SKILL.md, the reference docs, and the scripts'
  usage lines. Produce a checklist. VERIFY each against the code (`--help`/
  usage/grep) — flag any that no longer exists.
- [ ] **Step 2: Commit** the inventory note under the change folder (working
  artifact).

---

### Task 2: README.md

- [ ] **Step 1** — Rewrite README to the current product: what foreman is; the
  three-stage lifecycle (Setup & Environment → Use → Cleanup); soft/hard modes
  as they SHIP (hard mode = the approved-spec launcher profile, not the old
  container stub); the vendor lanes incl. grok; Windows AND WSL/Linux
  quickstarts (full-WSL); an honest capabilities-and-limits section (T5b
  UNVERIFIED vendors capped at 1; POSIX asymmetry closed via pidns; container
  hard-mode as the upgrade path).
- [ ] **Step 2** — Verify each shown command runs (or is clearly
  platform-marked). No invented flags.
- [ ] **Step 3: docs-check + Commit** `git commit -m "docs: README to the v0.2.7.5 shipped surface"`.

---

### Task 3: docs/USAGE.md

- [ ] **Step 1** — Full operating guide organized by stage: run Setup (incl.
  model auth via `grok login --device-code`), drive a Use round, run Cleanup;
  the vendor lane recipes; the pueue/`gate` mutex doctrine; troubleshooting
  (the worktree + WSL guard bundle). Consistent with
  `orchestration-hardening.md` + `reference-environment.md` (no contradictions).
- [ ] **Step 2: docs-check + Commit** `git commit -m "docs: USAGE end-to-end lifecycle guide"`.

---

### Task 4: CLAUDE.md + references

- [ ] **Step 1** — Reconcile `CLAUDE.md` architect doctrine with the shipped
  lifecycle + lanes (grok live; Setup gate before Use; Cleanup closes every
  run; current-era model routing accurate).
- [ ] **Step 2** — Index + cross-link the reference set
  (orchestration-hardening, reference-environment, lifecycle); fix stale
  links; add `docs/INSTALL.md` if warranted.
- [ ] **Step 3: docs-check (lychee catches broken links) + Commit**
  `git commit -m "docs: CLAUDE.md + reference set reconciled and cross-linked"`.

---

### Task 5: humanizer pass

NOTE (audit correction): `docs-check.sh` runs markdownlint-cli2 + codespell +
lychee + comment-coverage — there is NO AI-slop detector in it. The humanizer
improves prose quality but docs-check CANNOT measure "slop"; the quality bar
here is the Task-6 Opus review, not a docs-check signal. `blader/humanizer` is
an INTERACTIVE `/humanizer` slash-command — in a headless Sonnet lane it may
not be invocable; the honest fallback (below) is expected to fire.

- [ ] **Step 1** — Attempt install: `/plugin marketplace add blader/humanizer`
  then `/plugin install humanizer@humanizer`. If it cannot be installed OR
  cannot be invoked headlessly, STATE the blocker explicitly in the report and
  apply the closest available prose skill (e.g. russellian-style for
  tightening), NAMING the substitution — never silently skip the pass.
- [ ] **Step 2** — Run the humanizer (or substitute) over README + USAGE +
  INSTALL. Wording ONLY — no command, flag, path, or claim changes. WHERE a
  rewrite would alter a technical claim, keep the claim and adjust only the
  surrounding prose.
- [ ] **Step 3: docs-check** — Expected green (markdownlint/codespell/lychee/
  comments). Diff-review that no technical token changed. (docs-check does NOT
  score prose naturalness — that is Task 6's Opus review.)
- [ ] **Step 4: Commit** `git commit -m "docs: humanizer prose pass over README/USAGE/INSTALL"`.

---

### Task 6: acceptance

- [ ] **Step 1** — Spot-run the documented quickstarts on Windows AND WSL: each
  runs as written with no undocumented step. Capture as the package proof.
- [ ] **Step 2: docs-check** green (markdownlint/codespell/lychee, no broken
  links). Opus audits ground-truth fidelity (no invented flags/paths) + prose.
- [ ] **Step 3: Commit** the proof.

## Self-review

- Coverage: R(README both platforms)→T2; R(USAGE lifecycle)→T3; R(CLAUDE.md)→
  T4; R(humanizer)→T5; R(consistent+link-clean)→T4,T6. All covered.
- No invented flags: T1 ground-truths, T2/T6 verify commands run — this
  discipline is enforced by the Task-6 Opus review (there is no automated
  invented-flag gate).
- Humanizer: pinned to `blader/humanizer` (name-pinned, no SHA — a moving
  target) with a stated headless-lane fallback. The spec's "AI-slop bar" was
  corrected: docs-check does NOT measure slop; prose quality is Opus-reviewed
  (audit fix — update the OpenSpec spec's scenario text to match at archive
  time).

## Acceptance

README + USAGE + CLAUDE.md + references reflect the shipped surface with
verified commands; humanizer pass applied; docs-check green; both quickstarts
run as written. Archive on ship.
