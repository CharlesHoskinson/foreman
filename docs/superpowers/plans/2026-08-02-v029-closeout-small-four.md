# v0.2.9.0 Close-out — Criteria 6, 9, 10, 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four hours-scale tag criteria — Session DB freshness, Documentation, Plugin, and Record — so the only remaining blockers are the large ones (4, 7) and the owner decisions.

**Architecture:** Foreman is the execution plane: grok-4.5 implements each task in a worktree, the architect verifies independently from the code that consumes each fact, and Council reviews with a 3-domain quorum. Council stays advisory — `gate-eval.sh` and `merge-gate.sh` remain the only release authorities.

**Tech Stack:** Bash 5, Bats, jq, sqlite3, Python 3, OpenSpec, `fm-session.py`.

## Global Constraints

- Council is advisory. It MUST NOT write `audit-verdict.json` and MUST NOT gate the release.
- A reviewer MUST NOT share a model family with the implementer. `ac_select_auditor` is the only selector; `agy` must be pinned to `gemini-3.6-flash-high` (family `google`) before classification, because `agy models` also serves `claude-*` and `gpt-oss-*` and would otherwise collide.
- Sync the lane worktree to `main` before every dispatch and every review round. A stale base produced two false HIGH findings on 2026-08-01.
- Every new or edited shell file needs mode `100755` in the git index. Seven exec-bit drops happened in one session; `tools/repo-hygiene.sh` catches modified files and `tests/line-endings.bats` owns the authoritative inventory.
- Prompts crossing the Windows→WSL boundary travel as **files**, never as shell arguments. Inline prompts arrive empty and waste vendor rounds.
- No numeric claim lands without the command that re-derives it.
- `FOREMAN_CI_BATS=1 bash tools/ci-local.sh` must report `CI-LOCAL RESULT PASS gates_failed=0` before any commit that touches tracked files.

---

## Corrections this plan starts from

Three checklist annotations are stale and mislead anyone reading them:

| Criterion | Claim | Truth |
|---|---|---|
| 9 | `markdownlint=fail`, 45 findings | `docs-check` is fully green; markdownlint is 0 |
| 10 | "Blocked on a human decision (obligation 24)" | Obligation 24 is `done`; `plugin-drift` reports no drift |
| 12 | implies release art outstanding | `assets/v029-total-georgecall.png` is committed |

Task 1 fixes the annotations before anything else, so later tasks are not planned against fiction.

---

### Task 1: Correct the three stale criterion annotations

**Files:**

- Modify: `checklist.md` (criterion 9 note, criterion 10 note, criterion 12 note)

**Interfaces:**

- Consumes: nothing.
- Produces: an accurate checklist. Tasks 3 and 4 read criteria 9 and 10 from it.

- [ ] **Step 1: Re-derive each claim**

```bash
bash skills/foreman/scripts/docs-check.sh | grep '^docs-check:'
bash tools/plugin-drift.sh ~/.claude/skills/foreman skills/foreman | tail -1
sqlite3 .foreman/session.db "select id, status from obligations where id = 24;"
ls assets/
```

- [ ] **Step 2: Replace each note with the measured state and its command**

Criterion 9's note becomes the current `docs-check` line plus the command. Criterion 10's note drops the obligation-24 blocker and states the drift result plus its command. Criterion 12's note names the committed art path.

- [ ] **Step 3: Verify no numeric claim lacks a command**

```bash
grep -nE '\*\*[0-9]+' checklist.md | head -20
```

- [ ] **Step 4: Commit**

```bash
git add checklist.md
git commit -m "checklist: correct three stale criterion annotations against measured state"
```

---

### Task 2: Criterion 6 — refresh the 51 stale measurements

**Files:**

- Create: `skills/foreman/scripts/freshness-sweep.sh`
- Test: `tests/freshness-sweep.bats`
- Modify: `tests/baseline.tsv`, `tests/skip-budget.tsv`

**Interfaces:**

- Consumes: `fm-session.py freshness --stale-only --format tsv` (columns: `id metric value verdict reason command scope sha timestamp`).
- Produces: `freshness-sweep.sh [--dry-run]` printing one line per stale measurement — `id | metric | RERUN|SKIP | reason` — and, without `--dry-run`, re-recording each re-runnable one via `fm-session.py measure`.

The criterion requires **every measurement fresh at the tag commit**. 51 of 85 are stale. Every stale one carries a recorded command — that was measured and is why this is hours, not days.

- [ ] **Step 1: Write the failing test**

```bash
@test "sweep lists every stale measurement with its recorded command" {
  run bash "$SCRIPTS/freshness-sweep.sh" --dry-run
  [ "$status" -eq 0 ]
  # One line per stale row, and none may be blank-commanded silently.
  stale_n="$(python3 "$SCRIPTS/fm-session.py" freshness --stale-only --format tsv | tail -n +2 | wc -l)"
  listed="$(printf '%s\n' "$output" | grep -cE '^[0-9]+ \|')"
  [ "$listed" -eq "$stale_n" ]
}

@test "a measurement with no recorded command is reported SKIP, never silently dropped" {
  run bash "$SCRIPTS/freshness-sweep.sh" --dry-run
  [ "$status" -eq 0 ]
  ! printf '%s\n' "$output" | grep -qE '\|\s*$'
}

@test "dry-run writes nothing to the store" {
  before="$(sha256sum .foreman/session.ndjson | cut -d' ' -f1)"
  run bash "$SCRIPTS/freshness-sweep.sh" --dry-run
  after="$(sha256sum .foreman/session.ndjson | cut -d' ' -f1)"
  [ "$before" = "$after" ]
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bats tests/freshness-sweep.bats` — FAIL, script absent.

- [ ] **Step 3: Implement**

```bash
#!/usr/bin/env bash
# Re-run every stale measurement's recorded command and re-record the result.
# Criterion 6 requires every measurement fresh AT THE TAG COMMIT, and staleness
# is the resting state -- 51 of 85 were stale when this was written.
#
# It does NOT execute commands automatically without --apply: a recorded command
# is arbitrary shell captured at some past commit, and running 51 of them
# unattended is a different and riskier feature than reporting them.
set -uo pipefail
DRY=1; [ "${1:-}" = "--apply" ] && DRY=0
FM="python3 skills/foreman/scripts/fm-session.py"

$FM freshness --stale-only --format tsv | tail -n +2 | while IFS=$'\t' read -r id metric value verdict reason command scope sha ts; do
  if [ -z "$command" ]; then
    printf '%s | %s | SKIP | no recorded command\n' "$id" "$metric"
    continue
  fi
  printf '%s | %s | RERUN | %s\n' "$id" "$metric" "$command"
  [ "$DRY" -eq 1 ] && continue
  out="$(eval "$command" 2>&1 | tail -1)"
  $FM measure "$metric" "$out" --scope "$scope" --command "$command" >/dev/null
done
```

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Dry-run the real sweep and read every line**

```bash
bash skills/foreman/scripts/freshness-sweep.sh --dry-run | tee /tmp/sweep-plan.txt
grep -c RERUN /tmp/sweep-plan.txt
grep    SKIP  /tmp/sweep-plan.txt
```

Any `SKIP` is an owner decision — a measurement with no re-runnable command cannot be refreshed and must be retired with a reason instead.

- [ ] **Step 6: Set the exec bit and commit**

```bash
chmod +x skills/foreman/scripts/freshness-sweep.sh
git update-index --chmod=+x skills/foreman/scripts/freshness-sweep.sh
git add skills/foreman/scripts/freshness-sweep.sh tests/freshness-sweep.bats tests/baseline.tsv tests/skip-budget.tsv
git commit -m "feat(session): sweep stale measurements, reporting rather than auto-running"
```

**Note:** the sweep is run with `--apply` at the tag commit, not before. Running it now re-records against a non-tag SHA and the measurements go stale again on the next commit.

---

### Task 3: Criterion 9 — zero live references to the withdrawn store

**Files:**

- Modify: `openspec/changes/readme-refresh/specs/documentation/spec.md`
- Modify: `openspec/changes/readme-refresh/design.md`
- Modify: `openspec/changes/readme-refresh/tasks.md`
- Modify: `skills/foreman/graph_store/README.md`
- Modify: `skills/checkpoint/SKILL.md`
- Modify: `docs/design/session-store-ontology-links.md`
- Do not touch: `docs/evidence/**`, `docs/research/**`, `docs/superpowers/**`, `openspec/changes/archive/**`, `bugeventlog.md`, `devlog/**` — dated history, exempt by the criterion's own wording

**Interfaces:**

- Consumes: nothing.
- Produces: a repo where the check below returns only dated-history paths.

`docs-check` is already green. The open half is "zero live references to the withdrawn store outside dated history". TerminusDB was withdrawn on 2026-07-30; the materialisation is `skills/foreman/ontology/schema.sql` (SQLite).

`graph-store-port` and `work-dag-projection` are **dated design evidence recording the withdrawal** — a previous review established that rewriting them destroys provenance. Leave them; they are history in an openspec directory rather than live doctrine.

- [ ] **Step 1: Write the failing check**

```bash
grep -rln "TerminusDB" --include='*.md' . \
  | grep -v '^./.git' \
  | grep -vE 'docs/(evidence|research|superpowers)|openspec/changes/archive|bugeventlog|devlog|graph-store-port|work-dag-projection'
```

Expected now: `AGENT_TRAPS.md`, `checklist.md`, `docs/design/session-store-ontology-links.md`, `skills/checkpoint/SKILL.md`, `skills/foreman/graph_store/README.md`, `README.md`, `readme-refresh/*`.

- [ ] **Step 2: Rewrite each live reference against SQLite**

For each, state what the store actually is and cite `skills/foreman/ontology/schema.sql`. Where the reference is historical narrative inside a live document (`AGENT_TRAPS.md`), mark it as dated rather than deleting the lesson.

- [ ] **Step 3: Re-run the check**

Expected: only `graph-store-port` and `work-dag-projection` remain, both dated design evidence.

- [ ] **Step 4: Verify the docs gate**

```bash
bash skills/foreman/scripts/docs-check.sh | grep '^docs-check:'
openspec validate readme-refresh --strict
```

- [ ] **Step 5: Commit**

```bash
git commit -m "docs: retire live TerminusDB references; the store is SQLite"
```

---

### Task 4: Criterion 10 — prove the plugin claim holds beyond this host

**Files:**

- Modify: `tests/plugin-drift.bats`
- Modify: `checklist.md` (tick criterion 10)

**Interfaces:**

- Consumes: `tools/plugin-drift.sh INSTALLED_DIR REPO_SKILL_DIR`.
- Produces: a test proving drift is *detected*, not merely absent.

The criterion says the installed skill resolves to a current checkout and the drift check passes. Both are true here, and obligation 24 — its stated blocker — is `done`. What is missing is evidence that the check can fail: a drift check that has never been observed failing is not evidence, and this exact plugin once resolved to **zero files** while the repo shipped 76.

- [ ] **Step 1: Write the failing test**

```bash
@test "plugin-drift FAILS when the installed tree is missing a file" {
  tmp="$BATS_TEST_TMPDIR/installed"
  cp -r "$REPO/skills/foreman" "$tmp"
  rm -f "$tmp/SKILL.md"
  run bash "$REPO/tools/plugin-drift.sh" "$tmp" "$REPO/skills/foreman"
  [ "$status" -ne 0 ]
  [[ "$output" == *"MISSING"* ]]
}

@test "plugin-drift FAILS when the installed tree resolves to zero files" {
  tmp="$BATS_TEST_TMPDIR/empty"
  mkdir -p "$tmp"
  run bash "$REPO/tools/plugin-drift.sh" "$tmp" "$REPO/skills/foreman"
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 2: Run and confirm they fail if the guard is absent**

- [ ] **Step 3: Make them pass** — if `plugin-drift.sh` already fails correctly, the tests pass immediately and the work is the evidence, not a code change. Record that outcome rather than inventing a change.

- [ ] **Step 4: Tick criterion 10 with the commands**

Replace its note with the drift result, the two failure-mode tests, and the fact that obligation 24 is closed.

- [ ] **Step 5: Commit**

```bash
git add tests/plugin-drift.bats checklist.md tests/baseline.tsv
git commit -m "test(plugin-drift): prove the check can fail, and tick criterion 10"
```

---

### Task 5: Criterion 12 — the record

**Files:**

- Modify: `ROADMAP.md` (v0.2.9 stage → released)
- Modify: `devlog/2026-08-02.md` (correction block)
- Modify: `checklist.md`
- Modify: `docs/releases/v0.2.9.0-notes.md`

**Interfaces:**

- Consumes: `docs/RESIDUALS.md`, which the release notes must link.
- Produces: a tagged release.

Criterion 12 requires: ROADMAP marked released; the devlog correction block (obligation 13); `bugeventlog.md` complete; `v0.2.9` tagged **Total GeorgeCall** with the committed release art at `assets/v029-total-georgecall.png`.

**Obligation 13 is an owner decision and blocks this task**: it asks what happens to the stale Windows checkout at `C:\foreman`. Its unique work is rescued and landed; what remains is CRLF-seam noise. Do not tag until it is answered.

- [ ] **Step 1: Write the devlog correction block**

A dated section listing every claim corrected during the release, with what it claimed and what was true. Source it from `bugeventlog.md`'s 2026-08-02 entries and the superseded facts in the session store:

```bash
sqlite3 .foreman/session.db \
  "select id, supersede_reason from facts where superseded_by is not null;"
```

- [ ] **Step 2: Mark the ROADMAP stage released** — with the tag SHA, once tagged.

- [ ] **Step 3: Complete the release notes** — every criterion's final state, the residuals link, and the Tier 2 paragraph already drafted.

- [ ] **Step 4: Run the sweep with `--apply` at the tag commit**

This is where Task 2 is spent. Measurements refreshed at any earlier SHA go stale again.

- [ ] **Step 5: Full gate, then tag**

```bash
FOREMAN_CI_BATS=1 bash tools/ci-local.sh
git tag -a v0.2.9 -m "Total GeorgeCall"
```

- [ ] **Step 6: Commit and push**

---

## Execution: how each task runs

For every task, in order:

1. **Sync** the lane worktree to `main`.
2. **Dispatch** grok-4.5 with the task as a five-part spec, passed as a file.
3. **Verify** independently — derive each fact from the code that consumes it, never by re-running the spec's own commands. That distinction is why seven of eight findings in one audit traced to the architect's spec.
4. **Bundle** the round: `lane-review-bundle.sh WORKTREE main OUT_DIR`.
5. **Review** with 3 domains: codex/openai, agy pinned `gemini-3.6-flash-high`/google, claude/anthropic. grok is the implementer and is excluded as an author.
6. **Rework** on `changes_requested`; land on `approved` with quorum met.
7. **Record** every defect the plane itself exhibits in `devlog/` and `bugeventlog.md`.

## Self-review

**Spec coverage.** Criterion 6 → Task 2 (+ Step 4 of Task 5 for the tag-commit sweep). Criterion 9 → Task 3. Criterion 10 → Task 4. Criterion 12 → Task 5. Stale annotations → Task 1.

**Placeholders.** Task 5 Steps 2–3 describe content rather than showing it, because their content depends on the tag SHA and on obligation 13's answer; both are named as inputs rather than left vague.

**Type consistency.** `freshness-sweep.sh` reads the TSV column order declared in Task 2's Interfaces and is used only there and in Task 5 Step 4.

## What this does NOT close

Criteria 1, 4, 5, 7, 8 remain. Criterion 7 needs the graph plane and by its own design runs last — it is the criterion that decides the release date, and whether it belongs in v0.2.9.0 at all is a scope call, not a work item.
