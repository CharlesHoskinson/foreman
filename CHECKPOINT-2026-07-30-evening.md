# CHECKPOINT — 2026-07-30 evening stop

**The DB is authoritative. This file is a reading aid, not a source of truth.**
If anything here disagrees with `fm-session.py recover`, the DB wins — that is
the whole point of the store, and this file is exactly the kind of prose it was
built to replace.

Resume with:

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py begin --note "what you are about to do"
```

Session closed: `20260730T222519Z-da94ed`. Branch `integrate/v029-w1` @ `9adb990`.

---

## Read this before you quote any number

`recover` prints **measurement [2] `tests/audit-verdict.bats pass count = 26`
with validity `OK` (fresh)**. That number is wrong. Re-running the file this
session produced **11 passes then a 600s TIMEOUT** (measurement [9], fact 19).

It reads fresh because freshness is computed **only** as "has a commit touched
this scope?" — and no commit had. The thing that changed was the host, not the
tree. Two leaked processes were holding stdin.

This is a false-green in the freshness indicator, which is the precise defect
the store exists to prevent, arriving through a non-git door. It is recorded as
obligation 20 (the model gap) and obligation 21 (why the bad row cannot be
retired: `supersede` accepts a `fact_id` only, so there is no way to supersede a
measurement).

**Do not quote measurement 2. Prefer measurement 9.**

---

## What actually happened this session

### Merged — this is the answer to "is everything merged"

`origin/main`: `f6d577d` → **`9adb990`** (fast-forward, docs-only).

```bash
git log --oneline -1 origin/main    # -> 9adb990
```

Pushed as `git push origin 9adb990:main` rather than by updating the local
branch, because `main` is checked out at `/root/foreman` and that tree could not
be updated safely — see the warning below.

Nothing else was written. No product code changed this session.
`/root/fm-wt/integrate` is clean.

### ⚠ `/root/foreman` is in a damaged state — left untouched deliberately

```
UU bugeventlog.md
UU tools/lanectl.sh
M  skills/graphify/SKILL.md
?? bin/lane.sh
```

`UU` means unmerged index entries — but **there is no `MERGE_HEAD`**, so no merge
is in progress. That signature is consistent with an operation interrupted
mid-flight (this machine has recorded WSL2 crash-reboot instability under load).

I did not resolve, commit, reset, or clean any of it. Obligation 18, blocked on
a human decision. Local `main` stays 1 commit behind `origin/main` until it is
sorted. **Do not `git reset --hard` here without reading `bugeventlog.md` and
`tools/lanectl.sh` first** — `bugeventlog.md` is the append-only ledger.

### The suite: stopped early, 2 of 7 slices TIMEOUT

Log: `/root/fm-logs/resume-0730-full.log`

```
TIMEOUT tests/audit-verdict.bats  exceeded 600s
SLICE   tests/audit-verdict.bats  pass=11 baseline=26 delta=-15 test=TIMEOUT baseline_verdict=FAIL
TIMEOUT tests/decision-events.bats exceeded 600s
SLICE   tests/decision-events.bats pass=4 fail=2 baseline=9 delta=-5 test=TIMEOUT baseline_verdict=FAIL
```

Five other slices passed clean (checkpoint, config, docs-check, durable-preflight).
I stopped the run at 7/41 to release the host mutex for the stop. The mutex is
free; no bats or `run.sh` processes survive.

This is R1 working as designed — it converted two hangs into named, bounded
failures instead of letting them hold the host. `tests/run.sh:285` names
`decision-events.bats` by name as the file that once hung 31 minutes.

### Two leaked shims killed

```
2233313  bash /tmp/bats-run-6VZb3Q/test/1/fake-bin/codex exec … -   (started 12:27, 4h+)
2272396  bash /tmp/manual-shim-timeout/codex exec … -               (started 12:35, 4h+)
```

Both from the terminated `tov` lane, both blocked on the trailing `-` stdin arg.
**Both ignored SIGTERM and needed SIGKILL** — which independently corroborates
why `tests/run.sh:296` uses `timeout --kill-after=30`. Killed by explicit PID,
never `pkill -f`, per `lanectl.sh:cmd_reap` doctrine.

**Causation is PLAUSIBLE, NOT PROVEN.** The shims were alive during both
TIMEOUTs, and both timing-out files are in the codex/audit-shim area. That is
suggestive, not evidence. Obligation 16 is the experiment: re-run those two
files now that the shims are dead and see whether they pass.

---

## The feature: UNSTARTED, nothing to salvage

Obligation 17. Worktree `/root/fm-wt/integrate-wt-xps-run-implement-xps`,
branch `foreman/xps-run/implement/xps`: **0 commits, 0 dirty files, no
`DESIGN.md`.** A Sonnet lane read the spec and traps and was stopped one turn
before its first write. Its `FOREMAN_REPORT.md` is the untouched `wt-new`
template. There is nothing to audit and nothing to recover — re-dispatch from
scratch or delete the worktree.

### Which spec is canonical

**`docs/design/PROMPT-project-registry.md`** (yours, committed at `9adb990`, 175
lines, five questions). That one wins.

`/root/fm-specs/SPEC-cross-project-session-store.md` (376 lines) is a derivative
I wrote *before* seeing yours. It overlaps on questions 1–3 and defers your
questions 4 (what recover returns) and 5 (migration) to a later dispatch. Fact
22 records the precedence. Do not dispatch both.

### Design decisions already made — fact 23

| field | value | role |
|---|---|---|
| `project_key` | `realpath` of `git rev-parse --git-common-dir` | identity; every row references it |
| `project_name` | basename of the dir containing the git dir → `foreman`; override `FOREMAN_PROJECT_NAME`; stored once at registration | display label only |

Chosen on measurement, not preference: `--git-common-dir` returns
`/root/foreman/.git` identically from all 14 worktrees, while `--show-toplevel`
differs per worktree.

**The rule: nothing may be keyed on `project_name`.** Names collide, get
renamed, and are user-editable; keying on one merges two unrelated projects'
facts silently. Note your prompt's §3 candidate list does not include
`--git-common-dir` — that candidate came from measuring the two commands, and is
worth adding when you next touch the prompt.

---

## Cleared this session — do not re-investigate

- **openspec 33 → 30 is archival, not regression.** `b3bbdc3` moved the three
  `terminusdb-withdrawn-*` packages into `openspec/changes/archive/`, which the
  gate skips by name (`tools/ci-local.sh:113`). Facts 16–17, measurement 6.
- **shellcheck 12 → 13 is one dead assignment**, `tools/lanectl.sh:222` —
  `owner` is parsed from the lane filename and never printed by the progress
  `printf`. The gate fails only on error-level, so it is informational. Fact 18,
  obligation 19. Not fixed, deliberately: editing the tree while the suite was
  measuring it would have invalidated the run.
- **`--scope` is not silently dropping paths.** The skill documents repeated
  `--scope A --scope B` and `fm-session.py:418` is `action="append"`. Suspected
  bug, checked, cleared.
- **Obligation 7 closed.** It claimed the 2026-07-29 devlog audit "still reads
  VERDICT: PENDING". `AUDIT-devlog-2026-07-30.md` exists and reads
  `VERDICT: BLOCKED` at lines 11 and 377; the file it named never existed. Closed
  only after opening the file — the obligation's own premise was an unverified
  claim about an unopened artifact.

## Current gate state

```
CI-LOCAL RESULT PASS gates_failed=0     (at 9adb990, bats OFF as a gate by design)
```

`tools/ci-local.sh` is the verification authority; remote CI is unavailable
(no GitHub Actions credits). The bats suite is deliberately not a gate — it
deadlocks, per `f11f059`.

## Cheapest next actions

1. **Obligation 16** — re-run the two timed-out files with the shims dead. One
   command, settles the causation question, and tells you whether the suite is
   healthy again.
2. **Obligation 19** — delete one dead line in `tools/lanectl.sh`, restores the
   12-warning baseline.
3. **Obligation 17/15** — re-dispatch the project registry against
   `docs/design/PROMPT-project-registry.md`.
4. **Obligation 18** — decide what to do with `/root/foreman`'s index.
