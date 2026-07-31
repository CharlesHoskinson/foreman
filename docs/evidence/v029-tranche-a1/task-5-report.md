# Task 5 report — True up the obligations ledger

Branch: `integrate/v029-w1`. Store: `/root/foreman/.foreman/session.db`
(resolved automatically by `fm-session.py`). The retained pre-migration copy
at `/root/fm-wt/integrate/.foreman/session.db` was not touched (verified: its
mtime stayed at 09:53, before this task started, while the canonical store's
mtime advanced to 10:22 as edits landed).

## 1. Step 1 — verification commands before closing anything

```
$ grep -n "superseded_at\|supersede_reason" skills/foreman/scripts/fm-session.py | head -3
84:  superseded_at   TEXT,
85:  supersede_reason TEXT
106:  superseded_at    TEXT,

$ grep -n "value_num" skills/foreman/scripts/fm-session.py | head -3
99:  -- value_num carries the projectable scalar; NULL means "not a scalar", which
101:  value_num    REAL
179:        ("measurements", "value_num", "REAL"),

$ grep -n "^def project" skills/foreman/scripts/fm-session.py
336:def project(conn):
```

Note: the brief's expected line for `def project` was 320; the tree currently
has it at 336 (14 lines of drift from intervening edits in earlier tasks).
The function itself is present and unambiguous, so this does not change the
verdict — obligation 10's verb is satisfied. Read the function body
(`fm-session.py:336-`) to confirm what it actually emits (see obligation 10
below).

All three premises verified present. Proceeded to close.

## 2. Obligations 8, 9, 10 — evidence and close output

**Obligation 8** — `facts.superseded_at` and `facts.supersede_reason` exist as
real columns (schema lines 84-85, and again at 106 for a second table). A
superseded fact can carry both a timestamp and a reason.

**Obligation 9** — `measurements.value_num` exists as a `REAL` column
(line 101), separate from the free-text `value` column, exactly as the
obligation asked (split numeric value from text detail).

**Obligation 10** — `def project(conn)` exists at line 336. Read in full: it
emits NDJSON documents (`@type: Claim`, `Measurement`, `Supersession`) that
join `facts`/`measurements`/`superseded_*` against the ontology vocabulary
described in `docs/design/session-store-ontology-links.md`. The vocabulary
(Claim, Measurement, Supersession, Provenance) is the same vocabulary now
implemented as SQLite tables in `skills/foreman/ontology/schema.sql`
(commit `b3bbdc3`, "SQLite ontology replaces TerminusDB, which is withdrawn").
The projector's docstring still says "Emit TerminusDB documents for the
ontology" — a stale comment, not touched by this task since the brief only
asked for a fact recording the premise mismatch, not a code edit.

Close commands and output:

```
$ python3 skills/foreman/scripts/fm-session.py close 8 --status done
obligation 8 -> done
$ python3 skills/foreman/scripts/fm-session.py close 9 --status done
obligation 9 -> done
$ python3 skills/foreman/scripts/fm-session.py close 10 --status done
obligation 10 -> done
```

Step 3 fact recorded:

```
$ python3 skills/foreman/scripts/fm-session.py fact \
  "Obligation 10 named TerminusDB as the projector target after TerminusDB was withdrawn at b3bbdc3. The projector exists at fm-session.py:336 and targets the SQLite ontology. Closing an obligation requires checking its premise, not only its verb" \
  --evidence "grep -n '^def project' fm-session.py = 336; openspec/changes/archive/2026-07-30-terminusdb-withdrawn-*"
fact 33
```

**Fact ID for obligation 10's obsolete premise: fact 33.**

## 3. Step 4 — every remaining open/blocked obligation, verdict and evidence

Baseline before this task's Step 4 review: `open=18 blocked=4` (after closing
8/9/10, before closing 22). Final: `open=14 blocked=4`, 4 rows closed total
this task (8, 9, 10, 22).

| Ob | Verdict | Evidence checked |
|---|---|---|
| 1 | **owed** | "three-outcome-verdicts dispatches 3-5: wt-consolidate.sh (T6), T7 doctrine pass." `openspec/changes/three-outcome-verdicts/tasks.md` T6/T7 checkboxes unchecked. `grep -n "finding.*id\|stable.*id" skills/foreman/scripts/wt-consolidate.sh` returns nothing — no id-based merge exists. `grep -n UNVERIFIED skills/foreman/SKILL.md` returns nothing — no doctrine pass landed. Genuinely open. |
| 2 | **owed (blocked)** | "wt-merge.sh gate-to-merge TOCTOU (T11) needs its own package." T11 in `three-outcome-verdicts/tasks.md` is unchecked; its blocker reasoning ("highest architectural risk item; re-orders commit-then-merge") still applies. Left blocked as instructed for architectural items. |
| 3 | **owed, premise partly stale (blocked)** | Statement names `terminusdb-adapter, terminusdb-operations, graph-* cluster, knowledge-plane-refresh`. `find openspec/changes -maxdepth 1 -iname "*terminusdb*"` returns nothing active — both `terminusdb-adapter` and `terminusdb-operations` only exist under `openspec/changes/archive/2026-07-30-terminusdb-withdrawn-*`, i.e. withdrawn, not "unimplemented." The other two named items (`graph-* cluster`, `knowledge-plane-refresh`) are real and still reference TerminusDB in their specs (confirmed live grep below, obligation 23). Did **not** close: real, blocked work remains under this row and the "architect diagnosis per lane" this row is blocked on is exactly what should correct the stale TerminusDB naming — closing now would drop that remaining scope. Recorded as a partial-staleness note rather than a full obsolete-premise closure (unlike obligation 10, the verb is not fully satisfied here). |
| 4 | **owed** | `openspec/changes/regression-harness-tiers/tasks.md` — every checkbox across all tiers is unchecked (`[ ]`), confirming "unimplemented." |
| 5 | **owed** | `docs/research/vnext/DECISIONS-resolved.md:407,434` documents the `skills/superpowers/tests/**` (30-file) exclusion by pattern-level reason. The D11-correction section (line 619+) rules a wildcard exclusion is an unverified claim about every match unless each is individually verified and enumerated (it did this for the sibling `skills/superpowers/skills/*/scripts/**` pattern, catching a real miss). No equivalent per-file enumeration/verification exists for the `tests/**` pattern. Still open. |
| 6 | **owed** | `tests/baseline.tsv` header is `file\texpected_passes` — no platform column. Confirmed. |
| 8 | **already done — closed** | See section 2. |
| 9 | **already done — closed** | See section 2. |
| 10 | **already done — closed, premise obsolete recorded (fact 33)** | See section 2. |
| 11 | **owed (blocked)** | `audit-run.sh:387` is `- <"$PROMPT" 2>"$AUDIT_ERR_TMP" &` — codex is still fed via stdin redirect. `vendor-adapter-contract` package exists (not archived). Blocker text ("symptom contained by R1 timeout; do not rush") still applies — left blocked. |
| 12 | **owed** | `docs/design/test-cleanup-roadmap.md` lists R1-R7; R1 is fixed (fact 13), R2 confirmed still open (ob 11 above). Re-enable criterion is "suite COMPLETES on 3 consecutive runs" — the bats suite currently cannot complete at all (obligation 25, still open, is its blocker). Genuinely open. |
| 13 | **owed** | Checked `devlog/2026-07-29.md` (180 lines) and `bugeventlog.md` for a correction block matching `AUDIT-devlog-2026-07-30.md`'s VERDICT: BLOCKED remedy — none found (`grep -n "CORRECTION\|Rule 6\|never-completed\|wrong count" devlog/2026-07-29.md` returns nothing). The remedy has not been written. Genuinely open. |
| 14 | **owed (part of 1)** | "wt-merge.sh TOCTOU (own package)" — same T11 gap confirmed under obligation 2/11's check. Genuinely open; overlaps in subject with ob 1 and ob 2 but each names a distinct undone piece (T6/T7 vs T11), so left as-is rather than merged. |
| 15 | **owed** | `docs/design/PROMPT-project-registry.md` exists (design only). `grep -rln "project_registry\|project registry" skills/foreman/scripts/*.py skills/foreman/scripts/*.sh` and a repo-wide filename search for `*project-registry*` outside `docs/` both return nothing — no implementation exists anywhere in the tree. Genuinely open. |
| 17 | **owed** | Worktree `/root/fm-wt/integrate-wt-xps-run-implement-xps` on branch `foreman/xps-run/implement/xps`: `git log --oneline integrate/v029-w1..HEAD` = 0 lines, `git status --porcelain -uall` = 0 lines. Matches the row's claim exactly ("0 commits and 0 dirty files"). Genuinely open. |
| 19 | **owed** | `sed -n '218,226p' tools/lanectl.sh` shows `owner="${base%%.*}"` assigned and never referenced in the later `printf` (which uses `label, now, delta, hbage, changed, last` only). `shellcheck tools/lanectl.sh` still emits `SC2034 ... owner appears unused`. Genuinely open, not yet fixed. |
| 20 | **left as-is (blocked)** | Not touched — brief did not ask for a change here and its own blocker text ("belongs with the project-registry work") is corroborated by obligation 15 above still being open. |
| 22 | **already done — closed** | Statement was "close obligations 8, 9 and 10 with evidence ... ob 10 names the withdrawn TerminusDB as its target" — exactly the work performed in Steps 2-3 of this task. Closed: `python3 fm-session.py close 22 --status done` -> `obligation 22 -> done`. |
| 23 | **owed** | `grep -rl TerminusDB` across `openspec/changes/{graph-dogfood,graph-eval-falsification,graph-store-port,readme-refresh}` returns hits in every file of all four packages (design.md/proposal.md/tasks.md/specs). None have been rewritten against the SQLite ontology. `ROADMAP.md` still self-contradicts (line 177 "TerminusDB is OUT" vs line 468 "TerminusDB ships" — fact 29), corroborating that this rewrite has not happened. Genuinely open. |
| 24 | **owed — flagging a briefing discrepancy** | I was told obligations 16, 18, 21 **and 24** were already closed by earlier tasks and not to touch them. 16, 18, 21 are indeed absent from the obligations list (closed, confirmed). **Obligation 24 was not** — `recover` lists it `[24] (open) Repoint the installed plugin junction...` both before and after this task's edits. Verified directly: `Get-Item ~/.claude/skills/foreman` still shows `LinkType Junction, Target: C:\Users\charl\foreman\skills\foreman`, and that target still lacks `ontology/` and `scripts/fm-session.py` (both `Test-Path` = False), matching fact 27 exactly. This also matches the task list, where "Task 6: Plugin drift check" is still `pending`. I left it open (did not reopen anything — it was never closed) and did not perform Task 6's work, since that belongs to a later task. Flagging this so the discrepancy in my briefing is on record. |
| 25 | **left open (per instructions)** | Verified current state matches the row: `audit-run.sh:387-398` still spawns the `sleep "$AUDIT_TIMEOUT_S"` watchdog with no reap path shown at the returning branch. Left open; belongs to Task 7. |
| 26 | **left open (per instructions)** | Verified: `lib/config.sh:181` still uses `git rev-parse --show-toplevel` while the session store (Task 4) moved to `--git-common-dir`. Left open; belongs to later work. |

## 4. Final `recover` obligations section

```
OBLIGATIONS — open=14 blocked=4
  [26] (open) After Task 4, .foreman/ names two different directories depending on the file: session.db is repo-common (--git-common-dir) while config.toml is still per-worktree (--show-toplevel) in lib/config.sh cfg_load and its callers worker-run.sh:67, checks-run.sh:20, audit-run.sh:31, gate-eval.sh:30, task-new.sh:36, wt-new.sh:63. Decide whether config follows the store or stays per-worktree, and make it explicit
  [25] (open) Reap the audit-run.sh timeout watchdog when the audit returns (or replace the sleep-based watchdog with timeout). This is the single blocker preventing the bats suite from completing, and therefore blocks re-enabling the bats gate and tag criterion 2
  [24] (open) Repoint the installed plugin junction at a current checkout and add an installed-vs-repo drift check
  [23] (open) Rewrite the graph-plane specs (graph-dogfood, graph-eval-falsification, graph-store-port, readme-refresh) against the SQLite ontology BEFORE any Tranche D lane is dispatched
  [20] (blocked) Freshness is blind to host state: measurement_validity computes staleness ONLY from git commits touching scope, so a leaked process or environment change invalidates a measurement while recover still prints it fresh. This is the same false-green class the store exists to prevent, arriving by a non-git door. Decide whether measurements need a host-state or TTL dimension
       blocked by: architectural; belongs with the project-registry work, not before it
  [19] (open) tools/lanectl.sh:222 has a dead SC2034 assignment: owner is parsed from the lane filename and never printed by the progress printf. Removing it restores the shellcheck baseline from 13 to 12. Deliberately NOT fixed this session to avoid editing the tree while the suite was measuring it
  [17] (open) cross-project-session-store dispatch 1 is UNSTARTED. Worktree /root/fm-wt/integrate-wt-xps-run-implement-xps exists on branch foreman/xps-run/implement/xps with 0 commits and 0 dirty files; the Sonnet lane was stopped mid-turn just before its first write. Nothing to salvage, nothing to audit. Re-dispatch against docs/design/PROMPT-project-registry.md
  [15] (open) Implement the project registry: sessions bound to projects so Foreman works across many repos. Design prompt at docs/design/PROMPT-project-registry.md
  [14] (open) three-outcome-verdicts dispatches 3-5 owed incl. wt-merge.sh TOCTOU (own package)
  [13] (open) devlog 2026-07-29 correction block owed: never-completed suite, six test-side failures, three wrong counts, Rule 6 exception
  [12] (open) R3-R7 test cleanup per docs/design/test-cleanup-roadmap.md; re-enable the gate only when the suite COMPLETES on 3 consecutive runs
  [11] (blocked) R2: audit-run.sh:387 feeds codex on stdin; belongs to vendor-adapter-contract - fixture and live path both depend on current form
       blocked by: symptom contained by R1 timeout; do not rush
  [6] (open) baseline.tsv has no platform column, so one number must hold on every platform; baseline is currently the WSL floor
  [5] (open) skills/superpowers/tests/** suppresses 30 bash-shebang files from the crlf exec-bit inventory on a per-file reason never individually verified
  [4] (open) regression-harness-tiers (41 tasks) unimplemented
  [3] (blocked) terminusdb-adapter, terminusdb-operations, graph-* cluster, knowledge-plane-refresh unimplemented
       blocked by: large greenfield; task lists do not dispatch, needs architect diagnosis per lane
  [2] (blocked) wt-merge.sh gate-to-merge TOCTOU (T11) needs its own package with its own audit
       blocked by: highest architectural risk item; re-orders commit-then-merge
  [1] (open) three-outcome-verdicts dispatches 3-5 owed: wt-consolidate.sh (T6), T7 doctrine pass
```

## 5. Commit

```
$ git add bugeventlog.md
$ git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "docs(ledger): the obligations list carried three completed items as open"
[integrate/v029-w1 f93e549] docs(ledger): the obligations list carried three completed items as open
 1 file changed, 58 insertions(+)
```

SHA: `f93e54945f8a12d270d2c9fcbba25bbb96f27a45`

## 6. What could not be verified

Nothing was left unverified by omission — every remaining open/blocked row got
a tree check (table in section 3). The one thing genuinely outside this
task's authority to fix: obligation 3's premise is partly stale
(`terminusdb-adapter`/`terminusdb-operations` withdrawn) but the row also
covers real remaining work (`graph-* cluster`, `knowledge-plane-refresh`), so
it was not closed — closing it would have silently dropped genuine scope. It
is flagged in the table above rather than resolved, since resolving it
requires the "architect diagnosis per lane" the row is already blocked on,
not a grep.

The `def project` line-number drift (320 expected vs 336 actual) and the
obligation-24 briefing discrepancy (told "already closed", found genuinely
open) are both stated plainly above rather than silently reconciled.
