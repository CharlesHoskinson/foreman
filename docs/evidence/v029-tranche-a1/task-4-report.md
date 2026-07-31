# Task 4 Report: One session store per repository, not per worktree

## 1. Failing test output (Step 2)

Command: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats -f "linked worktree"`

```
1..1
not ok 1 a linked worktree shares the repo's session store
# (in test file tests/session.bats, line 189)
#   `[[ "$output" == *"recorded from the main worktree"* ]]' failed
# fact 1
```

The linked worktree opened an empty database. `recover` only found the auto-recorded
"fact 1" (the git SHA note), not the fact written from the main worktree. This is the
expected failure signature.

## 2. Passing test run (Step 4)

Command: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats`

```
1..15
ok 1 recover on an empty store succeeds and reports no session
ok 2 begin mints a session and recover then reports it
ok 3 a fact survives recovery with its evidence
ok 4 a measurement is fresh, then STALE once a commit touches its scope
ok 5 a commit OUTSIDE the scope leaves the measurement fresh
ok 6 measure refuses without --scope (a measurement that cannot go stale is the original bug)
ok 7 supersede requires a reason and records it
ok 8 obligations appear until closed
ok 9 the launch point names unfresh measurements
ok 10 project emits typed documents and reports non-scalar values rather than coercing
ok 11 project renders a Supersession carrying at and reason
ok 12 a retired measurement disappears from recovery and its successor remains
ok 13 retire refuses without a reason
ok 14 retire refuses to point a measurement at itself
ok 15 a linked worktree shares the repo's session store
```

15 tests, 0 failures. Confirmed a second time after the follow-up permission-bit fix
commit (same result).

## 3. tests/baseline.tsv line 45

After edit:

```
tests/session.bats	15
```

Proof the separator is a literal TAB (`cat -A`, `^I` marks TAB):

```
$ sed -n '45p' tests/baseline.tsv | cat -A
tests/session.bats^I15$
```

Proof only that one line changed (`git diff` before commit):

```
$ git diff tests/baseline.tsv
diff --git a/tests/baseline.tsv b/tests/baseline.tsv
index e39d62f..98cbdfb 100644
--- a/tests/baseline.tsv
+++ b/tests/baseline.tsv
@@ -42,4 +42,4 @@ tests/wt-cleanup.bats	6
 tests/wt-merge.bats	11
 tests/wt-new.bats	14
 tests/audit-verdict.bats	26
-tests/session.bats	14
+tests/session.bats	15
```

Only the `tests/session.bats` row changed, from 14 to 15.

## 4. Row counts before/after the copy

Source, before copy (`/root/fm-wt/integrate/.foreman/session.db`):

```
facts 31
measurements 11
obligations 25
```

After `cp` (never `mv`), both paths:

```
== /root/fm-wt/integrate/.foreman/session.db ==
facts 31
measurements 11
obligations 25
== /root/foreman/.foreman/session.db ==
facts 31
measurements 11
obligations 25
```

All three table counts match exactly at both paths. The source database at
`/root/fm-wt/integrate/.foreman/session.db` was left in place, per the brief, and
was NOT deleted.

## 5. recover output from both worktrees (Step 6, negative control)

From `/root/fm-wt/integrate` (after the code change and the DB copy):

```
=== from integrate ===
/root/foreman/.git
FOREMAN RECOVERY  head=531d7603bbcf  at=2026-07-31T15:57:53Z
last session: 20260731T143323Z-41ab8f  started=2026-07-31T14:33:23Z  start_sha=ce522b7a891e  NOT ENDED
  note: Sprint close-out planning for v0.2.9: audit remaining scope, fix CI/CD, QA all features, tag the release

FACTS (31) — durable, true by construction
```

From `/root/fm-wt/rod` (a second, independent worktree), running the same script by
absolute path:

```
=== from /root/fm-wt/rod ===
/root/foreman/.git
FOREMAN RECOVERY  head=b0806875b357  at=2026-07-31T15:57:53Z
last session: 20260731T143323Z-41ab8f  started=2026-07-31T14:33:23Z  start_sha=ce522b7a891e  NOT ENDED
  note: Sprint close-out planning for v0.2.9: audit remaining scope, fix CI/CD, QA all features, tag the release

FACTS (31) — durable, true by construction
```

Both report `FACTS (31)` — the same count, from two different worktrees. `git
rev-parse --path-format=absolute --git-common-dir` also resolved to the identical
`/root/foreman/.git` from both. The `head=` line differs only because each worktree
is checked out at a different commit; that is expected and unrelated to the store
path.

Before the removal of the orphaned empty DB (see step 6 below), I also confirmed the
orphan really was empty (0/0/0 in all three tables) before deleting it, so nothing
was lost:

```
$ python3 -c "... count(*) from facts/measurements/obligations ..." /root/fm-wt/integrate-wt-xps-run-implement-xps/.foreman/session.db
facts 0
measurements 0
obligations 0
```

## 6. find /root -maxdepth 5 -name session.db (final state)

```
/root/foreman/.foreman/session.db
/root/fm-wt/integrate/.foreman/session.db
```

Exactly the two expected files: the new canonical path under `/root/foreman`, and the
old populated one under `/root/fm-wt/integrate`, kept in place per the brief. The
orphaned empty DB at `/root/fm-wt/integrate-wt-xps-run-implement-xps/.foreman/session.db`
was removed.

## 7. supersede 16 output (Step 7)

```
$ python3 skills/foreman/scripts/fm-session.py supersede 16 \
  "The session store keyed on --git-common-dir and is shared by every worktree. Fragmentation was realised, not latent: two session.db files existed before the fix" \
  --evidence "fm-session.py repo_root uses --path-format=absolute --git-common-dir; tests/session.bats \"a linked worktree shares the repo session store\"" \
  --reason "fact 16 called the fragmentation latent and not yet realised; two databases already existed, and the fix fact 23 specified was never applied to line 126"

fact 16 superseded by 32
```

## 8. Commit SHA

Two commits were made for this task:

1. `a16b3520bd89dcd7593a100433489add0ca3c8b2` — the intended change: `fix(session): key
   the store on the common git dir, not the worktree top level`. Touches
   `skills/foreman/scripts/fm-session.py`, `tests/session.bats`,
   `tests/baseline.tsv`. Author: Charles Hoskinson <charles.hoskinson@gmail.com>.

2. `ca56916ed6c43841a87dc323ac9f45596ef3c268` — a follow-up, same-session fix:
   `fix(session): restore the executable bit on fm-session.py`. See concern #1
   below for why this was needed.

**Primary commit SHA for Task 4: `a16b3520bd89dcd7593a100433489add0ca3c8b2`.**
The working tree's HEAD after both commits is `ca56916ed6c43841a87dc323ac9f45596ef3c268`.

## 9. Concerns / things not fully verifiable

1. **Accidental file-mode change, then corrected.** The Write-tool-cannot-reach-`/root`
   constraint meant the code edit to `fm-session.py` had to be done by writing the new
   `repo_root()` body to a Windows temp file and splicing it into the target file with
   `head`/`cat`/`tail` inside WSL. That splice created a fresh file and did not preserve
   the original executable bit (`100755` -> `100644`), which I did not notice until
   inspecting `git show --stat` after the first commit. I corrected it with a second,
   minimal commit (`ca56916`) that only restores the executable bit, no code change. I
   flag this because it means the first commit's diff briefly included an unintended
   `old mode 100755` / `new mode 100644` line — visible if anyone inspects `a16b352`
   in isolation rather than the branch tip.
2. I did not run the full `bats` suite (per instructions, host-wide mutex) — only
   `tests/session.bats`, under `flock /tmp/foreman-bats.lock`, twice (once before the
   permission fix, once after). Both runs: 15/15 passing.
3. `git status --short` was checked after staging and after each commit; both times it
   showed exactly the intended files and, after the commits, a clean tree.
4. I did not delete `/root/fm-wt/integrate/.foreman/session.db` (the old populated DB),
   per instructions — it remains in place until a later session confirms the new path
   works cleanly on its own.
