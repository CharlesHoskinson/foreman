# Task 1 report — recover the stranded defect ledger

Status: DONE
Worktree: `/root/fm-wt/integrate`, branch `integrate/v029-w1`
Commit: `2adcc740a1d4231e96c0c03c759ef084316f0bff`

## 1. Step 1 numbers — observed against expected

| Measurement | Expected | Observed | Match |
|---|---|---|---|
| `wc -l /tmp/ledger-theirs.md` | 2604 | 2604 | yes |
| `wc -l /root/fm-wt/integrate/bugeventlog.md` | 1668 | 1668 | yes |
| `diff ... \| grep -c '^>'` | 960 | 960 | yes |
| `diff ... \| grep -c '^<'` | 24 | 24 | yes |

All four numbers matched. No re-audit was needed. No deviation was made.

The unmerged index entry was confirmed before extraction. `git ls-files -u` in
`/root/foreman` listed three stages for `bugeventlog.md` and three stages for
`tools/lanectl.sh`. Stage 3 of `bugeventlog.md` is blob
`6b9c979359fbc64334f01c4cba213c66908eb2ca`.

Both inputs were already LF-only. `grep -c $'\r'` returned 0 for each file.

## 2. Step 2 output

Heading counts: `/tmp/head-main.txt` 64, `/tmp/head-theirs.txt` 79.

### `comm -23 /tmp/head-main.txt /tmp/head-theirs.txt` — only on main

```
## 2026-07-29 — terminusdb-schema (s9-tdbschema) package authoring
```

### `comm -13 /tmp/head-main.txt /tmp/head-theirs.txt` — only in the damaged index

```
## 2026-07-29 — Monitor watchdog died on the Git Bash path trap
## 2026-07-29 — PowerShell ate `$(...)` and a fixture built into the repo root
## 2026-07-29 — PowerShell rejects `<` at parse time, before WSL is reached
## 2026-07-29 — Stall watchdog fired a false positive on both cleanup lanes
## 2026-07-30 · Wave-1 dispatch, Project Feynman
## 2026-07-30 — Event 10: a GATING formal control is nondeterministic, and nobody could have known
## 2026-07-30 — Event 11: three-lens adversarial review corrected the architect on both open blockers
## 2026-07-30 — Event 1: `grok-multiround` reported success for a lane that implemented nothing
## 2026-07-30 — Event 2: architect killed three lanes at 18 minutes, repeating the immediately preceding entry's lesson
## 2026-07-30 — Event 3: the 41-file suite had never completed, and was masking six failures
## 2026-07-30 — Event 4: `tests/run.sh` returns a different verdict for the same tree depending on how it was launched
## 2026-07-30 — Event 5: eight test files were merged registered in neither policy file
## 2026-07-30 — Event 6: single-turn grok cannot read-then-write, so "go read the spec" lanes always empty-burst
## 2026-07-30 — Event 7: grok lane success is a step function in spec closure — one deliverable per dispatch
## 2026-07-30 — Event 8: "one deliverable" is necessary but NOT sufficient — a counterexample
## 2026-07-30 — Event 9: a lane left sabotaged code in the worktree after a destructive proof and reported success
```

## 3. Step 3 — how the union was built

`/tmp/ledger-theirs.md` was the base. Exactly one section was re-inserted.

The main-only section is lines 1644 to 1668 of the pre-change
`/root/fm-wt/integrate/bugeventlog.md`. It runs to the end of that file.

Section order in `/tmp/ledger-theirs.md` is ascending by date. The last
`2026-07-29` section starts at line 1710 and ends at line 1737. The first
`2026-07-30` section starts at line 1738. The re-inserted section carries the
date `2026-07-29`. It was therefore placed after line 1737 and before the old
line 1738. This puts it after all other `2026-07-29` sections, as instructed for
a date tie.

One blank line was added after the re-inserted section. This matches the
separator used between all other sections.

No existing section was reordered, reworded, deduplicated or edited.

Resulting length: 2630 lines (2604 + 25 section lines + 1 separator line).

## 4. Step 4 output — the acceptance test

```
$ comm -23 /tmp/head-main.txt   /tmp/head-union.txt
$ comm -23 /tmp/head-theirs.txt /tmp/head-union.txt
$
```

Both commands printed nothing. The test was silent on the first run. No fix
round was needed.

`/tmp/head-union.txt` holds 80 unique headings. This is 79 from the damaged
index plus the 1 main-only heading.

Two extra checks were made. They are stronger than the heading test, because
they compare every line and not only headings.

```
$ diff /tmp/ledger-theirs.md bugeventlog.union.md | grep -c '^<'
0
$ diff /tmp/ledger-theirs.md bugeventlog.union.md | grep -c '^>'
26
$ diff bugeventlog.md bugeventlog.union.md | grep -c '^<'
0
```

No line of either input is absent from the union. The union adds 26 lines to the
damaged-index side and removes none.

## 5. Step 5 — install and commit

```
$ tr -d '\r' < bugeventlog.union.md > bugeventlog.md
$ rm bugeventlog.union.md
$ git add bugeventlog.md
$ git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" commit -F /tmp/commitmsg.txt
[integrate/v029-w1 2adcc74] docs(ledger): recover 960 stranded bugeventlog lines from the damaged index
 1 file changed, 962 insertions(+)
```

Commit SHA: `2adcc740a1d4231e96c0c03c759ef084316f0bff`
Committed `wc -l bugeventlog.md`: **2630**
`git status --short` after the commit: empty.

The commit message text is the exact text given in the brief. It was passed with
`-F` from a file, not with `-m` inline. The file was written on the Windows host
and passed through `tr -d '\r'`. This avoids the inline-quoting trap. No
`Co-Authored-By` trailer was added.

## 6. Step 6 — clear the damaged index

Two read-only backups were taken first, before any index change:

```
$ git show :2:tools/lanectl.sh > /tmp/lanectl-stage2.sh   # 305 lines
$ git show :3:tools/lanectl.sh > /tmp/lanectl-stage3.sh   # 210 lines
$ git show HEAD:tools/lanectl.sh | wc -l                  # 305
```

Stage 2 has the same length as HEAD. Stage 3 holds a 210-line variant. The brief
tells us to keep the committed 305-line version. The 210-line stage-3 variant is
kept at `/tmp/lanectl-stage3.sh` in case it is wanted later. This backup is an
addition to the brief. It is read-only and it changes nothing.

Then the brief commands ran:

```
$ git checkout --ours tools/lanectl.sh && git add tools/lanectl.sh
$ git show HEAD:tools/lanectl.sh | diff - tools/lanectl.sh && echo "lanectl matches HEAD"
lanectl matches HEAD
$ git checkout HEAD -- bugeventlog.md && git add bugeventlog.md
```

### `git status --short` in `/root/foreman`

```
M  skills/graphify/SKILL.md
?? bin/
```

No `UU` row is present. `git ls-files -u` returns nothing. The damaged index is
clear.

### `git stash list`

```
stash@{0}: On main: wip 2026-07-30 pre-merge
stash@{1}: WIP on integrate/v029-w1: 6400b8f fix(modes): exec bit on libraries added by concurrently-merged branches
stash@{2}: WIP on s1/lock-L1-helper: 94eb08d fix(lock): close three defects the previous rework introduced
```

All three stashes are present. None was dropped or cleared.

### `git pull --ff-only origin main`

```
From https://github.com/CharlesHoskinson/foreman
 * branch            main       -> FETCH_HEAD
Updating f6d577d..dbf81b3
Fast-forward
 CHECKPOINT-2026-07-30-evening.md                   | 188 +++++
 docs/design/PROMPT-project-registry.md             | 175 ++++
 ...-07-31-v029-tranche-a1-recording-instruments.md | 934 +++++++++++++++++++++
 .../2026-07-31-v029-release-closeout-design.md     | 535 ++++++++++++
 4 files changed, 1832 insertions(+)
```

Exit code 0. `git log --oneline -1` now reports:

```
dbf81b3 docs(plan): add the audit-run watchdog reap as Tranche A.1 task 7
```

The fast-forward succeeded. Working-tree status after the pull is unchanged:
`M  skills/graphify/SKILL.md` and `?? bin/`.

No `git reset --hard`, `git checkout .`, `git checkout -- .`, `git clean`,
`git stash drop`, `git stash clear` or `git merge --abort` was run at any point.

## 7. Step 7 — close the obligation

```
$ python3 skills/foreman/scripts/fm-session.py close 18 --status done
obligation 18 -> done
```

Exit code 0. This wrote nothing into the worktree. `git status --short` in
`/root/fm-wt/integrate` stayed empty after the call.

## 8. Items not verified

- The full bats suite was not run. The plan forbids it, because it takes a
  host-wide mutex. `tests/line-endings.bats` was therefore not executed. Instead,
  CR absence was measured directly. `grep -c $'\r'` returns 0 on the committed
  `bugeventlog.md`, on both inputs and on the commit-message file.
- The content of the 960 recovered lines was not reviewed for factual accuracy.
  The task is a recovery, not an edit. The lines were copied without change.
- `.git/AUTO_MERGE` is still present in `/root/foreman`. It is a leftover ref
  from the `ort` merge strategy. `MERGE_HEAD` is absent, so no merge is in
  progress, and the fast-forward pull was accepted. This leftover was not
  removed, because removal is not in the brief.
- Stash contents were listed but not inspected. The brief says to record them and
  not to drop them.
- The date-ordering rule was applied to one section only. One section was the
  full main-only set. No general ordering pass was made, and none was needed.
