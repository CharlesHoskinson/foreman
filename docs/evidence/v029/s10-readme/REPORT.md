# REPORT — readme-refresh, round 1

## 1. Apply three editorial reports' findings

**DONE.**

Sources: `docs/research/vnext/EDIT-readme-structural.md`,
`EDIT-readme-line.md`, `EDIT-readme-facts.md`.

### Structural (applied)

- Reordered to **twelve** H2 sections per structural §2.
- Moved **five-part spec** from old §9 to **§3**.
- Merged Setup/Use/Cleanup + quickstart into **§6**.
- Merged evidence + verification + docs stage + **checker soundness** into **§8**.
- Replaced old §14 with **§9 The record** (event log, work-DAG, knowledge
  plane, GraphStore/TerminusDB, context-block consumption).
- Relocated hard mode after evidence doctrine (**§10**).
- Re-keyed mental model on **model family**, not CLI name; retired "Four
  roles, four producers".
- Named-anchor links replace hard-numbered "section N" cross-refs.
- **Cut 1:** worktree exit-code table removed from README (point to
  `docs/USAGE.md`).
- **Cut 2:** Grok permission-mode flag walkthrough reduced to the principle
  (`DIG_B == DIG_A` / narrates while writing nothing).
- **Cut 3:** Nested Job Objects / NTSTATUS / jq-vs-python3 bullets removed
  from limits; pointer to `launcher/README.md` and
  `reference-environment.md`.
- Layout tree gained `formal/`.

### Factual (applied)

All flagged false/stale claims from `EDIT-readme-facts.md` §1 rewritten into
the new text (see §2 below). Material omissions from facts §6 folded into
hard-mode table notes, limits, quickstart, and worktree serialization.

### Line edit (mostly deferred)

BRIEF: structural and factual work only; **extended editorial pass deferred**.
Prose polish from `EDIT-readme-line.md` was not applied as a separate pass.
Incidental wording improvements landed only where a section was rewritten for
structure or truth.

### Disagreements — which report won

| Topic | Structural | Facts | Took | Why |
|---|---|---|---|---|
| GATE "Shipped — fail-closed" | Flagged as unsound | Precise rewrite: not fail-closed across rounds | **Facts** | Code confirms no freshness/diff bind (`gate-eval.sh`) |
| `worker-run.sh` stub | Still "next release" framing for launcher package | Implemented; needs built launcher | **Facts** | Script implements launcher-only + container |
| `pr-open.sh` partial stub | (not central) | Shipped draft PR path | **Facts** | `pr-open.sh` pushes + `gh pr create --draft` |
| hard-mode-launcher "none of this runs today" | Stale package path note | Profiles implemented | **Facts** | Scripts present; OOB still needs `foreman-launch` |
| Exit-code tables | Cut to USAGE | n/a | **Structural** | Teaching doc vs operator manual |
| Grok walkthrough length | Cut to principle | Unverifiable CLI behavior | **Structural** (+ facts: not re-asserted as verified) | Avoid per-CLI appendix + unbilled claim |
| Launcher trivia in limits | Cut | n/a | **Structural** | Doctrine-level limits over component trivia |
| OpenSpec "follows OpenSpec" | All 16 fail validate | 10 packages fail | **Observed now** | `/usr/local/bin/openspec validate --changes`: **33 total, 28 valid, 5 invalid** (WSL packages). README states observed state, not either historical count. |
| Line-edit sentence rewrites | n/a | n/a | **Deferred** | Out of round-1 README structural/factual scope |

Ambiguity Q1–Q4 from the line pass (`Four roles…`, v0.2.5 baseline, CMD/GATE
jargon, "host identity") were resolved in prose as:

- Census → model-family framing; no "four roles, four producers".
- v0.2.5 baseline → removed (profiles described as implemented, not pinned to
  that version phrase).
- CMD/GATE → relocated out of README with other launcher trivia.
- host identity → "host config home" / do not share config dir.

Formal human decision file (`README-ambiguity-decisions.md`) was **not**
created (T1 deferred).

---

## 2. Fix every factual claim the fact-check pass flagged

**DONE** (in `README.md`).

| Old claim | Resolution in new README |
|---|---|
| ships only after independent cold diff | Soft: instructed for non-trivial; trivial may skip with reason. Hard: audit not bound to current diff |
| Hard mode IMPLEMENT is a stub | Implemented; needs built/supplied `foreman-launch` |
| USAGE is every command/flag | Soft-mode walkthrough + selected reference |
| same-vendor audit forbidden as system property | Doctrine + soft architect enforcement; hard check miswired / not bound to actual worker vendor |
| run dir never inside worktree | Defaults to `~/.foreman/runs/<id>/`; keep `FOREMAN_HOME` outside worktrees |
| workers never run git writes (as OS fact) | Instructed; soft mode does not technically prevent; architect verifies |
| `blocked_same_vendor` as wrapper stop | Prompt instructs when told worker was Codex; architect verifies provenance |
| lifecycle global state machine | Operating discipline; not a global enforced state machine |
| "always a Setup-stage finding" | Only when `lane-run.sh` + `LANE_VENDOR` set |
| pueued stop / lock sweep | Marker inert if never created; rmdir without staleness/ownership check |
| codex-implementer high | medium; high for correctness-critical |
| Grok Build 0.2.103 | Bootstrap installs current npm release (observed host: 0.2.114) |
| main checkout never implementer target | Default worktree; `soft_mode.target=live` uses checkout |
| Cleanup always removes worktrees | Attempts remove; dirty left unless `--force` |
| fail-closed at every stage | Not fail-closed across audit rounds |
| audit enforces vendor ≠ worker | Compares config keys, not actual hard worker vendor |
| pr-open partial stub / hand PR | Shipped draft PR after gate + PAT + HTTPS origin |
| bats needs WSL or Git Bash only | Bash + bats; native Linux/WSL/Git Bash; not plain PowerShell |
| `./install.sh` | `bash install.sh` (mode 100644) |
| only two PS entry points | Also `install.ps1`, `launcher/build.ps1` |
| soft bootstrap installs everything + edits wsl.conf | Soft toolset only; no `/etc/wsl.conf` edit |
| merge refuses dirty | Staged index / overlap / conflict; unrelated unstaged OK |
| `--commit` creates merge commit | Ordinary commit from squash; may first commit worktree pending |
| flock serialize always | flock when available; fail-open ~30s on index mutex |
| WARNING findings attach to PR body | Does not auto-attach; put in `pr-body.md` |
| maintenance `--apply` only reports | `--apply` replaces vendored skills from `~/.claude/skills` |
| OpenSpec conventions fully followed | OpenSpec-like; some packages fail validate (5 observed invalid) |

Omissions added: gate freshness note, hard IMPLEMENT launcher prerequisite,
uutils mkdir lock defect, `durable.enabled` inert, Claude half-wired,
no CI bats, install.sh dirtying clone, root `mode` doctrine-only, telemetry
gap, formal models (count = 4 from `formal/specs/*.qnt`), agy residuals,
TerminusDB longevity framing.

---

## 3. Add tests/readme-structure.bats

**DONE.**

Files:

- `tests/readme-structure.bats` — 12 tests
- `tests/fixtures/readme-structure-check.sh` — content-bound structure checker

### Checker soundness (observed fail before trust)

```text
# known-bad (missing sections) — MUST fail
bash tests/fixtures/readme-structure-check.sh <truncated-readme>
→ FAIL: missing required section: …
→ exit=1

# known-bad (reordered) — MUST fail  
→ FAIL: section order violated …
→ exit=1

# real README — MUST pass
bash tests/fixtures/readme-structure-check.sh README.md
→ OK: all 12 required sections present in order
→ exit=0
```

Bats under flock:

```text
flock /tmp/foreman-bats.lock bats tests/readme-structure.bats
1..12
ok 1..3  (known-bad fail cases + harness non-zero)
ok 4..12 (positive README invariants)
bats_exit=0
```

Harness rule: checker exits non-zero when any invariant fails (`failures > 0`
→ `exit 1`). Bats known-bad cases assert `$status -ne 0`.

**Deferred vs full tasks.md T3:** did not add a full `readme` stage inside
`docs-check.sh`, claim ledger, prose ceilings, or per-check fixture matrix for
every T3 bullet. Round-1 BRIEF asked for `tests/readme-structure.bats`
asserting structural invariants with observed-fail soundness.

---

## 4. Verify every command in the README actually runs

**DONE** (commands executed; real output quoted).

| Command | Result |
|---|---|
| `bash -n install.sh` | OK (syntax) |
| `./install.sh` (bare) | `Permission denied` (mode `100644`) — why README uses `bash install.sh` |
| `bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane grok` | Exit **0**; ends with `READY: yes`, `LANE_READY: grok=yes`, `SETUP: READY`. Tool table: git/python3/grok 0.2.114/codex 0.146.0/claude 2.1.220/node/npm/jq/docs tools ok |
| `bash skills/foreman/scripts/foreman-setup.sh` (no args) | Runs tool-check default soft; exit 0 |
| `bash env/bootstrap-wsl.sh` (no `--yes`) | Prints: `This will install missing packages for profile=full … Re-run with --yes` (does not mutate without `--yes`) |
| `bash skills/foreman/scripts/wt-new.sh "$RUN" implement smoke-cmd` | Exit **0**; worktree created under `/root/fm-wt/s10-readme-wt-…` |
| `bash skills/foreman/scripts/wt-cleanup.sh "$RUN" --force` | Exit **0** but consolidate step printed `Permission denied` on `wt-consolidate.sh` (scripts mode `100644` — same class as install.sh). Worktree/branch cleaned manually afterward |
| `bash skills/foreman/scripts/docs-check.sh` | Exit **1** whole-repo: pre-existing markdownlint/codespell/comments failures outside this package (see §6) |
| `bash skills/foreman/scripts/maintenance.sh --stage graph` | Exit **0**; reported graph stage stale (extract warnings) — command runs |
| `graphify query "what is foreman" --budget 50` | Runs; returns Foreman node from README (command present on PATH) |
| `markdownlint-cli2 README.md` | **0 issues** |
| `codespell README.md` | exit **0** |
| `lychee --offline --no-progress README.md` | `23 OK, 0 Errors` |
| `/usr/local/bin/openspec validate --changes --json --no-interactive` | 33 total, 28 valid, 5 invalid |

**Not executed (state-changing / credentials / out of scope):**

- Full `bash install.sh` (would chmod 33 files and dirty the dogfood tree)
- `bash env/bootstrap-wsl.sh --profile soft --yes` (package install)
- Windows PowerShell commands (`install.ps1`, `tool-check.ps1`, …) — no
  PowerShell exercise on this Linux host; flags/paths confirmed present in tree
- Live vendor auth logins
- Hard-mode `worker-run` / `gate-eval` / `pr-open` end-to-end (need task
  envelope + built launcher + PAT)

---

## 5. Unverifiable claims (marked, not left asserted)

**DONE.**

In README, the following are framed as doctrine, historical record, or design
claim rather than verified shipped behavior:

| Topic | How marked |
|---|---|
| Single-model session failure modes | Teaching problem statement, not a repo property |
| Default soft pairing / model names | Routing doctrine; availability not proven by code |
| Advisor ~300 words | "prompt contract (not enforced by a length checker)" |
| Decorrelated failure modes | "design claim, not a shipped benchmark" |
| Grok whole-repo upload "unrefuted" | Kept as unrefuted preflight rationale, not proven here |
| T5b concurrency GREEN | Historical authorized run + caps; live repro needs credentials |
| POSIX cascade "kernel-enforced" | Design + local Bats; full platform matrix not claimed |
| Graph token savings 45–77% | **Removed** (no raw measurements found) |
| Grok acceptEdits silent ignore | **Not re-asserted**; principle only |
| maintenance workflow never exercised by real release | **Not re-asserted** (unprovable absence) |

---

## 6. Docs gate clean (markdownlint-cli2, codespell, lychee)

**PARTIAL — README clean; whole-repo docs-check still red on pre-existing debt.**

| Tool | Scope | Result |
|---|---|---|
| markdownlint-cli2 | `README.md` | 0 issues |
| codespell | `README.md` | exit 0 |
| lychee --offline | `README.md` | 23 OK, 0 Errors |
| `docs-check.sh` | whole repo | exit 1: pre-existing issues in `AGENT_TRAPS.md`, `bugeventlog.md`, `formal/reports/*`, `openspec/changes/terminusdb-schema/*` (disjointness), `tools/lanectl.sh` undocumented functions. **None introduced by README rewrite.** |

Round-1 scope is README-only; fixing unrelated formal/tools debt was not
done. `REPORT.md` uses blank lines under headings so it does not add MD022
noise if scanned.

---

## 7. Deferred editorial work

**DONE (inventory of deferrals).**

| Item | Why deferred |
|---|---|
| Full Gottlieb line-edit pass (`EDIT-readme-line.md` 32 sentence rewrites) | BRIEF: structural + factual only |
| `docs/STYLE.md` + prose ceiling enforcement (T8) | Extended editorial |
| `docs/research/vnext/README-ambiguity-decisions.md` (T1) | Human-attributed decisions file not required for round-1 prose resolutions |
| `README-claim-ledger.tsv` + doctrine-claims registration (T2) | Ledger package work beyond README text |
| `docs-check.sh` `readme` stage + full known-bad fixture matrix (T3) | Partial: structure bats only |
| Actually relocating exit-code tables / tool tables **into** `docs/USAGE.md` (T5) | README-only scope; pointers only |
| Moving launcher bullets **into** `launcher/README.md` body | Pointer only; files already document these |
| Cross-family independent fact-check audit lane (T9) | Requires architect-routed audit after this rewrite |
| `doctrine-check.sh` registration (T10) | Depends on doctrine-reality-drift package landing |
| Full 62-checkbox tasks.md completion | Explicit round-1 scope cut |

### What this round owns

- Restructured, fact-corrected `README.md` (12 sections)
- `tests/readme-structure.bats` + checker fixture with observed-fail soundness
- This `REPORT.md`

### No git commit. No graphify refresh/update (query was used only as a
command-existence check for the README command list).
