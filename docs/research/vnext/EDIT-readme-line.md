# Line Edit: README.md (Gottlieb pass)

## 1. Line Edits

- **Lines 7–9**
  - BEFORE: "An architect session routes self-contained five-part specs to implementer and auditor lanes, re-runs verification on the real tree, and ships only after an independent cold diff review."
  - AFTER: "An architect session routes five-part specs to implementer and auditor lanes, re-runs verification on the real tree, and ships only after an independent cold diff review."
  - WHY: "Self-contained" is filler here — the five-part form is what makes the handoff self-contained; the adjective restates the next section.

- **Lines 15–17**
  - BEFORE: "This README is the teaching document: what Foreman is, how the lifecycle works, and an honest account of what is shipped versus planned."
  - AFTER: "This README is the teaching document: what Foreman is, how the lifecycle works, and what is shipped versus planned."
  - WHY: "An honest account of" congratulates the prose; the blunt shipped/planned inventory already does that work.

- **Lines 25–26**
  - BEFORE: "The expensive session model burns tokens on boilerplate while you still need it for architecture decisions."
  - AFTER: "The expensive session model burns on boilerplate the tokens architecture decisions still need."
  - WHY: "While you still need it" softens the conflict; put waste and the scarce budget in one clause.

- **Lines 33–35**
  - BEFORE: "Foreman answers with a split. The **architect** (session model, typically Claude Fable or Opus) owns judgment: inventory, specs, routing, independent verification, ship-or-rework."
  - AFTER: "Foreman splits the work. The **architect** (session model, typically Claude Fable or Opus) owns judgment: inventory, specs, routing, independent verification, ship-or-rework."
  - WHY: "Answers with a split" is abstract marketing cadence; "splits the work" names the act.

- **Lines 38–40**
  - BEFORE: "Reports are claims. Digests of HEAD and `git status` before and after a worker run make silent no-ops visible."
  - AFTER: "Reports are claims. Digests of HEAD and `git status` before and after a worker run expose silent no-ops."
  - WHY: "Make … visible" is weaker than a verb that does the exposing; same meaning, fewer words.

- **Line 42**
  - BEFORE: "The default soft pairing is deliberate: Grok 4.5 implements, the architect re-runs checks, Codex GPT-5.6 Sol audits read-only, then the architect ships."
  - AFTER: "The default soft pairing: Grok 4.5 implements, the architect re-runs checks, Codex GPT-5.6 Sol audits read-only, then the architect ships."
  - WHY: "Is deliberate" tells the reader to admire the design; the colon list already shows the design.

- **Lines 76–78**
  - BEFORE: "The architect keeps context lean: emit specs, routing decisions, and short verdicts; do not re-type implementation bodies on the session model while a worker CLI is available."
  - AFTER: "The architect keeps context lean: emit specs, routing decisions, and short verdicts; do not re-type implementation on the session model while a worker CLI is available."
  - WHY: "Bodies" is vague anatomy for code; cut the dead noun.

- **Lines 80–82**
  - BEFORE: "Deletions and renames go in `ARCHITECT_ACTIONS` for the architect to apply — that rule prevents a worker from rewriting history or landing a half-finished commit the architect never reviewed."
  - AFTER: "Deletions and renames go in `ARCHITECT_ACTIONS` for the architect to apply — so a worker cannot rewrite history or land a half-finished commit the architect never reviewed."
  - WHY: "That rule prevents" is passive-abstract; "so a worker cannot" keeps the actor and the ban in one stroke.

- **Line 94**
  - BEFORE: "This is the operating frame the rest of the doc set hangs off."
  - AFTER: "This is the operating frame for the rest of the docs."
  - WHY: "Hangs off" is limp and slightly wrong; the frame supports the docs, it does not dangle them.

- **Lines 94–97**
  - BEFORE: "It runs identically on Windows and on WSL/Linux (full-WSL setup, section 7) — Use never starts until Setup has reported READY for the lanes it needs, and Cleanup closes every run that Setup opened."
  - AFTER: "It runs the same on Windows and WSL/Linux (full-WSL setup, section 7) — Use never starts until Setup has reported READY for the lanes it needs, and Cleanup closes every run that Setup opened."
  - WHY: "Identically" is an intensifier; "the same" is enough, and the second "on" is noise.

- **Lines 110–114**
  - BEFORE: "`foreman-setup.sh` composes `env/tool-check.sh` rather than reimplementing it, prints one `<vendor>: NOT-READY -- run <instruction>` line per unauthenticated vendor (`grok login --device-code`, `codex login`, `claude auth login`), and **never authenticates anything itself** — device/interactive auth is always an operator action Setup only instructs."
  - AFTER: "`foreman-setup.sh` composes `env/tool-check.sh` rather than reimplementing it, prints one `<vendor>: NOT-READY -- run <instruction>` line per unauthenticated vendor (`grok login --device-code`, `codex login`, `claude auth login`), and **never authenticates** — device/interactive auth stays the operator's job; Setup only prints the instruction."
  - WHY: "Anything itself" pads the ban; "is always an operator action Setup only instructs" hides the operator behind a noun pile.

- **Lines 117–119**
  - BEFORE: "Idempotent: a second run against an unchanged, already-ready host changes nothing and re-reports READY."
  - AFTER: "Idempotent: a second run against an already-ready host changes nothing and re-reports READY."
  - WHY: "Unchanged" restates "already-ready"; one adjective does the job.

- **Lines 127–128**
  - BEFORE: "Use assumes an authenticated, provisioned environment and never authenticates. This is a real gate, not just a report:"
  - AFTER: "Use assumes an authenticated, provisioned environment and never authenticates. This is a real gate, not a report:"
  - WHY: "Just" is a softener that weakens the contrast the sentence wants.

- **Lines 144–145**
  - BEFORE: "1. Best-effort SIGINT of any lane subprocess this run's event log still shows alive, before any worktree is touched."
  - AFTER: "1. Best-effort SIGINT of any lane subprocess this run's event log still shows alive — before any worktree is touched."
  - WHY: The comma under-separates a hard ordering rule; the dash marks the sequence the reader must not miss.

- **Lines 149–151**
  - BEFORE: "3. Stop a foreman-owned `pueued` only if this run started it (never a blind `pueue shutdown` — the daemon is shared, host-wide state other runs may depend on)."
  - AFTER: "3. Stop a foreman-owned `pueued` only if this run started it (never a blind `pueue shutdown` — other runs may still need the shared daemon)."
  - WHY: "Host-wide state other runs may depend on" is abstract inventory language; say who still needs what.

- **Lines 155–157**
  - BEFORE: "Idempotent and dirty-safe: an uncommitted worktree survives Cleanup (its reports are archived first, never discarded), and a re-run after interruption finishes the remaining teardown without error."
  - AFTER: "Idempotent and dirty-safe: Cleanup archives reports first and leaves an uncommitted worktree intact; a re-run after interruption finishes the remaining teardown without error."
  - WHY: Parenthetical "never discarded" restates "archived first"; put the archive act first so the survival claim does not need a double negative.

- **Lines 172–173**
  - BEFORE: "A worktree-secrets preflight refuses to spawn a grok lane over a tree containing `.env` files or private-key material, since the CLI's whole-repo-upload behavior is unrefuted."
  - AFTER: "A worktree-secrets preflight refuses to spawn a grok lane over a tree containing `.env` files or private-key material, because the CLI's whole-repo-upload behavior is unrefuted."
  - WHY: "Since" reads temporal; the reason is causal. Keep "unrefuted" — that bluntness is the voice.

- **Lines 190–191**
  - BEFORE: "If a lane returns `unavailable` or `timeout`, re-route and say so in the session. Never absorb a vendor substitution under the original lane's name."
  - AFTER: "If a lane returns `unavailable` or `timeout`, re-route and say so in the session. Never hide a vendor substitution under the original lane's name."
  - WHY: "Absorb" is vague body metaphor; "hide" names the actual failure (silent renaming of who did the work).

- **Lines 230–232**
  - BEFORE: "`BLOCKED` means rework: corrected spec back to the implementer lane, not hand-patching on the architect model."
  - AFTER: "`BLOCKED` means rework: send a corrected spec back to the implementer lane; do not hand-patch on the architect model."
  - WHY: The telegraphic "corrected spec back to" drops the verb; the architect is the actor who sends.

- **Lines 259–263**
  - BEFORE: "`openspec/changes/hard-mode-launcher/` is recorded **\"APPROVED SPEC (executed next release, not in v0.2.7.5)\"** — a next-release design, chosen over inventing hard mode's IMPLEMENT stage here so this release stays shippable in one cycle."
  - AFTER: "`openspec/changes/hard-mode-launcher/` is recorded **\"APPROVED SPEC (executed next release, not in v0.2.7.5)\"** — a next-release design. This release leaves IMPLEMENT as a stub so the rest ships in one cycle."
  - WHY: "Chosen over inventing … here so …" stacks motive, alternative, and schedule into one subordinate pile; two sentences restore who chose what for what.

- **Lines 266–269**
  - BEFORE: "**launcher-only (the planned default)** — `foreman-launch` supervises the worker against a per-lane worktree copy, network default none, no Docker required. Hard mode would work out of the box on top of what v0.2.5 already shipped."
  - AFTER: "**launcher-only (the planned default)** — `foreman-launch` supervises the worker against a per-lane worktree copy, network default none, no Docker required. Hard mode would run on what v0.2.5 already shipped."
  - WHY: "Work out of the box on top of" is stock phrase on stock phrase; one verb is enough.

- **Lines 274–276**
  - BEFORE: "Either profile: no in-sandbox commit (evidence is extracted host-side); the worker never holds push credentials; `pr-open.sh` would push and open a **draft** PR host-side only after the gate passes, using a fine-grained, single-repo, expiring token."
  - AFTER: "Either profile forbids in-sandbox commits (evidence is extracted host-side); the worker never holds push credentials; `pr-open.sh` would push and open a **draft** PR host-side only after the gate passes, using a fine-grained, single-repo, expiring token."
  - WHY: "Either profile: no …" is a label, not a sentence; give the profiles a verb.

- **Line 335**
  - BEFORE: "Both platforms run the same three stages. The condensed form:"
  - AFTER: "Both platforms run the same three stages:"
  - WHY: "The condensed form:" announces a table the table already is; dead throat-clearing.

- **Lines 394–396**
  - BEFORE: "`skills/foreman/scripts/*.sh` are bash scripts on both platforms — Git Bash on Windows, the native shell on WSL/Linux; only `env/tool-check.ps1` and `env/bootstrap-windows.ps1` are PowerShell-native. WSL is a co-equal, fully-provisioned target as of v0.2.7.5 (`wsl-reliability-env-refresh`):"
  - AFTER: "`skills/foreman/scripts/*.sh` are bash scripts on both platforms — Git Bash on Windows, the native shell on WSL/Linux; only `env/tool-check.ps1` and `env/bootstrap-windows.ps1` are PowerShell-native. WSL is a fully provisioned peer as of v0.2.7.5 (`wsl-reliability-env-refresh`):"
  - WHY: "Co-equal" is stiff Latinate; "peer" is concrete. "Target" is abstract aiming language for a platform people run on.

- **Lines 403–404**
  - BEFORE: "The full command-by-command walkthrough (recon, implement, audit, land, the five-part spec template, every script's exit codes, troubleshooting) lives in [`docs/USAGE.md`](docs/USAGE.md); the fuller install/bootstrap story is in [`docs/INSTALL.md`](docs/INSTALL.md)."
  - AFTER: "The command-by-command walkthrough (recon, implement, audit, land, the five-part spec template, every script's exit codes, troubleshooting) lives in [`docs/USAGE.md`](docs/USAGE.md); the install/bootstrap story is in [`docs/INSTALL.md`](docs/INSTALL.md)."
  - WHY: "Full" and "fuller" are intensifiers competing with each other; the paths already mark completeness.

- **Lines 507–508**
  - BEFORE: "Lane reports are claims, not proof. The evidence contract makes a silent no-op visible:"
  - AFTER: "Lane reports are claims, not proof. The evidence contract exposes a silent no-op:"
  - WHY: Same "make visible" weakness as lines 38–40; and "Reports are claims" has already landed twice by here — the second half of the pair ("not proof") is the new work, keep it; tighten the follow-on.

- **Lines 542–544**
  - BEFORE: "Capitalized rule prefixes auto-approve file writes and edits only. Shell stays gated: Grok still cannot delete/rename files, chmod, or run verification for you."
  - AFTER: "Capitalized rule prefixes auto-approve file writes and edits only. Shell stays gated: Grok still cannot delete or rename files, chmod, or run verification for you."
  - WHY: "Delete/rename" is slash-jargon in a sentence that already lists parallel bans; "or" matches the rest of the list.

- **Lines 557–559**
  - BEFORE: "Required when any of: multi-file/multi-step deliverable, security-sensitive paths (auth, crypto, network, secrets, shell), before declaring a multi-step task done, or after a race between implementers."
  - AFTER: "Required for a multi-file or multi-step deliverable; for security-sensitive paths (auth, crypto, network, secrets, shell); before declaring a multi-step task done; or after a race between implementers."
  - WHY: "When any of:" is not English; the list mixes noun phrases and temporal clauses without a governing verb pattern.

- **Lines 587–589**
  - BEFORE: "Exit codes: `0` all pass, `1` findings, `2` required tool missing (fail closed) — a missing linter never silently \"passes.\""
  - AFTER: "Exit codes: `0` all pass, `1` findings, `2` required tool missing (fail closed) — a missing linter never \"passes.\""
  - WHY: "Silently" is redundant once the scare-quotes already mark the fake pass; the section has already overused the silent/silently tic.

- **Lines 602–604**
  - BEFORE: "Measured saving versus raw file reads: 45-77% of tokens on budget-capped queries."
  - AFTER: "Measured savings versus raw file reads: 45–77% of tokens on budget-capped queries."
  - WHY: Grammar — "saving" should be plural for a measured range; tiny fix, real defect.

- **Lines 623–626**
  - BEFORE: "Soft mode runs implementer CLIs on the host with their native sandboxes only. Hard mode's shipped stages (CHECK/EVIDENCE/AUDIT/GATE) add host-side evidence that is never mounted into a worker, forbidden-path and hash gates, and cold-diff audit; its planned IMPLEMENT upgrade (section 6) would add Docker worker constraints as an opt-in profile."
  - AFTER: "Soft mode runs implementer CLIs on the host with their native sandboxes only. Hard mode's shipped stages (CHECK/EVIDENCE/AUDIT/GATE) add host-side evidence never mounted into a worker, forbidden-path and hash gates, and cold-diff audit. The planned IMPLEMENT upgrade (section 6) would add Docker worker constraints as an opt-in profile."
  - WHY: One sentence tries to carry three shipped additions and a future upgrade; split so the upgrade does not hide inside the shipped list.

- **Lines 627–628**
  - BEFORE: "Containers share the host/WSL2 kernel — defense-in-depth, not a hard boundary."
  - AFTER: "Containers share the host/WSL2 kernel — defense in depth, not a hard boundary."
  - WHY: Keep the blunt limit; drop the compound-jargon hyphenation that pretends "defense-in-depth" is a product feature name.

## 2. Recurring Tics

### 2.1 The contrastive snap: "X, not Y"
Rough count: **~14** clear instances.

The document's signature move — and often its strength. It fails when both poles are abstract process nouns rather than concrete acts.

Examples:
- **Line 128**: "This is a real gate, not just a report"
- **Line 174**: "its concurrency is **capped, not promoted**"
- **Lines 277–278**: "read it as the documented direction, not a capability you can invoke"
- **Line 319**: "Documented, not silently absorbed."
- **Line 507**: "Lane reports are claims, not proof."

Habit fix: keep the snap when Y is a concrete false comfort the reader might reach for; cut or rewrite when Y only renames X.

### 2.2 "Silent" / "silently" as moral intensifier
Rough count: **~7** (`silent no-ops`, `silently claiming`, `silently absorbed`, `silently assumed`, `silently ignores`, `silently "passes"`, plus the evidence-contract reprises).

The product story is about making silence visible, so the word earns some uses. It becomes a tic when every failure mode gets the same adverb instead of a concrete verb (refuses, drops, masks, ignores).

Examples:
- **Lines 38–40**: "make silent no-ops visible"
- **Lines 300–302**: "rather than silently claiming the stronger guarantee"
- **Lines 529–530**: "but **silently ignores** it"
- **Line 588**: "a missing linter never silently \"passes.\""

Habit fix: reserve "silent/silently" for the evidence-contract motif; elsewhere name the mechanism (ignore, mask, skip, fake-pass).

### 2.3 "Never" as sentence engine
Rough count: **~22** (`never implements`, `never lives`, `never run`, `never starts`, `never authenticates`, `Never absorb`, `never the implementer target`, `NEVER run git write`, etc.).

This is voice, not error — the blunt bans are a virtue. The cost is monotony: when every third rule opens with "never," the reader stops ranking severity.

Examples:
- **Line 38**: "An **advisor** is consulted only at commitment boundaries and never implements."
- **Lines 127–128**: "Use assumes an authenticated, provisioned environment and never authenticates."
- **Line 225**: "The main checkout is never the implementer target."
- **Lines 428–429**: "NEVER run git write commands."

Habit fix: keep the hard bans; vary secondary ones with positive form ("workers leave commits to the architect") so "never" still lands when it matters.

### 2.4 Em-dash cargo: secondary facts packed into primary sentences
Rough count: **dozens** of em-dashes; the problem cases are the ones that insert a second sentence's worth of fact into the first.

Examples:
- **Lines 110–114**: setup composition, NOT-READY format, auth ban, and operator duty in one dash-hinged unit
- **Lines 282–293**: concurrency numbers, test date, authorization, GREEN criteria, pueue caps, and Claude Code HOME rule in one bullet
- **Lines 303–310**: single-pid signal, grandchild reparent, MSYS limit, second-pass sweep, and "not a hard gate" in one bullet

Habit fix: one claim per sentence in the limits section; the honesty already does the work — density is not the same as rigor.

## 3. Best-Written Passage

**Lines 527–531** (Motivating bug: Grok headless write cancellation):

> **Motivating bug: Grok headless write cancellation.** The Grok CLI's `--permission-mode` flag only honors `bypassPermissions` and `default`. The CLI accepts `--permission-mode acceptEdits` on the command line but **silently ignores** it. In headless runs, tool calls that would prompt are auto-cancelled — the model narrates edits while writing nothing; `DIG_B == DIG_A`.

This is the document at full strength. Short sentences advance one fact each: what the flag claims, what it actually accepts, what it ignores, what headless runs do. The killer clause — "the model narrates edits while writing nothing" — is concrete (narrates / writing), parallel, and visual; then the digests (`DIG_B == DIG_A`) pin the story to the evidence contract without restating "reports are claims." Rhythm is claim–tightening–payoff, not abstract process language. Even "silently" earns its keep here because the defect *is* silent acceptance.

## 4. Worst-Written Passage

**Lines 282–293** (Grok/codex concurrency bullet):

> - **Grok concurrency is verified to 3 lanes; codex to 2.** The real-vendor destructive concurrency test (T5b) was run live on 2026-07-18 under an explicit user authorization to use the shared, signed-in account. grok came back GREEN at N=2 and N=3 (every lane returned its exact reply, no 429 under the shared quota, session state path-isolated, auth intact after); codex came back GREEN at N=2 (no port collision in one-shot `exec` mode, auth intact, SQLite-serialized state). The `grok` pueue group is therefore raised to `parallel=3` and `codex` to `parallel=2` — each only to its proven-green N (`docs/research/vendor-concurrency-results.md`). Claude Code is separately ruled `REQUIRES-SEPARATE-HOME` from the public issue record (concurrent instances race on `.claude.json`) — run one Claude Code architect session per host identity, not several sharing a config dir.

**Diagnosis:** One bullet tries to be a test log, a capacity decision, a citation, and a Claude Code operational rule. Parentheticals swallow the GREEN criteria until the main clause loses its subject. "Came back GREEN" is fine once; stacking N=2/N=3 criteria inside commas turns proof into sludge. The Claude Code HOME rule is a different limit bolted on with "separately" — a second topic wearing the first topic's bullet.

**Rewrite:**

> - **Grok concurrency is verified to 3 lanes; codex to 2.** Live destructive test T5b (2026-07-18, shared signed-in account, user-authorized) returned GREEN for grok at N=2 and N=3 and for codex at N=2. Grok criteria: exact per-lane replies, no 429 under shared quota, path-isolated session state, auth intact after. Codex criteria: no port collision in one-shot `exec`, auth intact, SQLite-serialized state. Pueue caps follow those proven N values only: `grok` `parallel=3`, `codex` `parallel=2` (`docs/research/vendor-concurrency-results.md`).
> - **Claude Code needs a separate home.** Public issue record: concurrent instances race on `.claude.json` (`REQUIRES-SEPARATE-HOME`). Run one Claude Code architect session per host identity; do not share a config dir across sessions.

## 5. Unresolved Ambiguities

1. **Lines 50–51 — "Four roles, four producers"**  
   The diagram shows an architect plus four lane boxes (two implementers, auditor, advisor). Unclear whether "four roles" and "four producers" name the same set, whether the architect counts as a role but not a producer, or whether the two implementers count as one role. Cannot line-edit without knowing the intended census.

2. **Lines 268–269 — baseline "v0.2.5" inside a v0.2.7.5-era README**  
   "Hard mode would work out of the box on top of what v0.2.5 already shipped." Elsewhere the text anchors behavior to v0.2.7.5. Whether v0.2.5 is intentional (launcher baseline) or a stale pin is a meaning question, not a prose one — author must choose the version the sentence is about.

3. **Lines 311–315 — `CMD` and `GATE` in the launcher chain**  
   "`foreman-launch(--detach) → lane-run.sh → foreman-launch (CMD) → foreman-launch(GATE)`" uses CMD and GATE as if the reader already knows those process roles. Without expansion in-sentence, a line edit cannot choose between leaving jargon, spelling out "command child" / "gate child", or pointing at `launcher/README.md`.

4. **Line 293 — "per host identity"**  
   "Run one Claude Code architect session per host identity, not several sharing a config dir." Unclear whether "host identity" means OS user, machine, `$HOME`, or Claude config path. The second half (config dir) is clear; the first half is not.

---

*End of Gottlieb line pass. Scope held to sentence-level rewrite; no section moves, no claim verification against the tree.*
