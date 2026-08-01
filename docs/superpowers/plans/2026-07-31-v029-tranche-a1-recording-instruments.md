# v0.2.9 Tranche A.1 — The Recording Instruments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Foreman's own record-keeping trustworthy — recover the stranded defect ledger, let a wrong measurement be retired, stop the session store fragmenting per worktree, true up the obligations ledger, and stop the installed plugin shipping without its headline feature.

**Architecture:** Six independent deliverables against `skills/foreman/scripts/fm-session.py`, `bugeventlog.md`, and the plugin install. Each is test-first where it touches code, and each ends with a commit. Nothing here depends on the graph plane, the vendor plane, or the test plane — this plan ships on its own and every later plan depends on its output being believable.

**Tech Stack:** Python 3 (stdlib `sqlite3`, `argparse`, `subprocess`), Bash, bats-core, git plumbing, SQLite.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-31-v029-release-closeout-design.md` (committed at `557321f`). Where this plan and the spec disagree, the spec wins.
- **Working tree:** all work happens in `/root/fm-wt/integrate` on branch `integrate/v029-w1`. Do **not** work in `/root/foreman` — its index is damaged and holds unrecovered data until Task 1 completes.
- **Line endings:** the repo is total-LF. Every file written from Windows must be passed through `tr -d '\r'`. `tests/line-endings.bats` gates this.
- **Every new `.bats` file MUST be registered in BOTH `tests/baseline.tsv` and `tests/skip-budget.tsv`** (one row per platform: `linux`, `wsl`, `windows`). Eight files once shipped registered in neither; `tools/ci-local.sh` now reports this on every run.
- **Every changed test count MUST update `tests/baseline.tsv`.** The registered pass baseline is the tripwire that caught the `rod` sabotage; a stale baseline disables it.
- **Never run the full bats suite while lanes are running** — it takes the host-wide `/tmp/foreman-bats.lock` mutex and starves them.
- **Launch anything long-running under `systemd-run`, never `nohup … &` through `wsl -e bash -lc`** — the latter is silently reaped, leaving no process and no log.
- **Commit trailer:** do **not** add a `Co-Authored-By: Claude` trailer.
- **Author:** `git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com"`.
- **Writing standard:** ASD-STE100 Simplified Technical English (adopted at `f4b4fbd`) applies to all prose, including code comments and commit messages.

---

### Task 1: Recover the stranded defect ledger

**Files:**
- Modify: `bugeventlog.md` (in `/root/fm-wt/integrate`)
- Read-only source: stage 3 of `bugeventlog.md` in `/root/foreman`'s damaged index

**Interfaces:**
- Consumes: nothing.
- Produces: a `bugeventlog.md` in `integrate` containing every `## ` heading from both inputs. Every later task appends to this file.

**Why this is first:** 960 lines exist only in an unmerged index entry. Any `git reset --hard`, `git checkout` or `git clean` in `/root/foreman` destroys them permanently.

- [ ] **Step 1: Extract both sides and prove the claim before changing anything**

```bash
cd /root/foreman
git show :3:bugeventlog.md > /tmp/ledger-theirs.md
wc -l /tmp/ledger-theirs.md                      # expect 2604
wc -l /root/fm-wt/integrate/bugeventlog.md       # expect 1668
diff /root/fm-wt/integrate/bugeventlog.md /tmp/ledger-theirs.md | grep -c '^>'   # expect 960
diff /root/fm-wt/integrate/bugeventlog.md /tmp/ledger-theirs.md | grep -c '^<'   # expect 24
```

Expected: `2604`, `1668`, `960`, `24`. If any number differs, STOP and re-audit — the tree has changed since this plan was written.

- [ ] **Step 2: Capture the heading inventory of both sides**

```bash
grep '^## ' /root/fm-wt/integrate/bugeventlog.md | sort -u > /tmp/head-main.txt
grep '^## ' /tmp/ledger-theirs.md               | sort -u > /tmp/head-theirs.txt
wc -l /tmp/head-main.txt /tmp/head-theirs.txt
comm -23 /tmp/head-main.txt /tmp/head-theirs.txt    # headings ONLY on main
comm -13 /tmp/head-main.txt /tmp/head-theirs.txt    # headings ONLY in the damaged index
```

Record both `comm` outputs — they are the acceptance criteria for Step 4.

- [ ] **Step 3: Build the union, newest-side as the base**

The ledger is append-only and chronological. `/tmp/ledger-theirs.md` is the newer, longer side and already contains the older content, so it is the base. Re-insert only the headings `comm -23` reported as main-only, each with its section body, in date order.

```bash
cd /root/fm-wt/integrate
cp /tmp/ledger-theirs.md bugeventlog.union.md
# For each heading listed by `comm -23` in Step 2, copy its section from
# bugeventlog.md into bugeventlog.union.md at the position matching its date.
# Sections run from their '## ' line to the line before the next '## '.
```

- [ ] **Step 4: Verify the union loses nothing**

```bash
cd /root/fm-wt/integrate
grep '^## ' bugeventlog.union.md | sort -u > /tmp/head-union.txt
comm -23 /tmp/head-main.txt   /tmp/head-union.txt    # MUST be empty
comm -23 /tmp/head-theirs.txt /tmp/head-union.txt    # MUST be empty
```

Expected: both commands print nothing. A non-empty result means a section was dropped — fix before continuing. This is the negative control for this task: it fails loudly if the union is lossy.

- [ ] **Step 5: Install the union and commit**

```bash
cd /root/fm-wt/integrate
tr -d '\r' < bugeventlog.union.md > bugeventlog.md
rm bugeventlog.union.md
git add bugeventlog.md
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "docs(ledger): recover 960 stranded bugeventlog lines from the damaged index

The 2026-07-30 run — eleven named defect events plus a 2026-07-29 entry — existed
only in stage 3 of an unmerged index entry at /root/foreman, left after a host
crash-reboot. origin/main stopped at 2026-07-29. Reconstructed as a chronological
union: every heading from both sides is present, asserted by comm."
```

- [ ] **Step 6: Clear the damaged index, only now that the content is safe**

```bash
cd /root/foreman
git checkout --ours tools/lanectl.sh && git add tools/lanectl.sh   # keep the committed 305-line version
git show HEAD:tools/lanectl.sh | diff - tools/lanectl.sh && echo "lanectl matches HEAD"
git checkout HEAD -- bugeventlog.md && git add bugeventlog.md
git status --short          # expect no UU rows
git stash list              # record anything present; do not drop
```

Then fast-forward `main`:

```bash
cd /root/foreman && git pull --ff-only origin main && git log --oneline -1
```

- [ ] **Step 7: Close the obligation with evidence**

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py close 18 --status done
```

---

### Task 2: Record the obligation-16 verdict as a scoped measurement

**Files:**
- Modify: `.foreman/session.db` (via the CLI only — never hand-edit)
- Read-only: `/root/fm-logs/ob16-0731.log`

**Interfaces:**
- Consumes: Task 1's committed ledger (the finding is appended to it).
- Produces: two measurements with `--scope`, and a fact recording causation.

- [ ] **Step 1: Read the completed experiment**

```bash
systemctl is-active fm-ob16                      # expect: inactive (finished)
awk '/===SPLIT===/{f=1;next} !f{print}' /root/fm-logs/ob16-0731.log | grep -c '^ok'
awk '/===SPLIT===/{f=1}f' /root/fm-logs/ob16-0731.log | grep -c '^ok'
awk '/===SPLIT===/{f=1}f' /root/fm-logs/ob16-0731.log | grep '^not ok'
```

The first count is `audit-verdict.bats` (expect 26). The second and third describe `decision-events.bats`.

- [ ] **Step 2: Record both measurements, each with a path scope**

`--scope` is mandatory: a measurement that cannot be shown stale defeats the mechanism.

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py measure \
  "tests/audit-verdict.bats pass count" "26 pass / 0 fail, file COMPLETED" \
  --command "flock /tmp/foreman-bats.lock bats tests/audit-verdict.bats" \
  --scope tests/audit-verdict.bats \
  --scope skills/foreman/scripts/audit-run.sh \
  --scope skills/foreman/scripts/gate-eval.sh

python3 skills/foreman/scripts/fm-session.py measure \
  "tests/decision-events.bats pass count" "<fill from Step 1: N pass / M fail>" \
  --command "flock /tmp/foreman-bats.lock bats tests/decision-events.bats" \
  --scope tests/decision-events.bats \
  --scope skills/foreman/scripts/gate-eval.sh \
  --scope skills/foreman/scripts/lib/eventlog.sh
```

- [ ] **Step 3: Record the causation fact**

```bash
python3 skills/foreman/scripts/fm-session.py fact \
  "The 2026-07-30 600s TIMEOUTs were caused by the two leaked SIGTERM-immune codex shims holding stdin, not by an intrinsic deadlock. With the shims dead, tests/audit-verdict.bats completes 26/26" \
  --evidence "/root/fm-logs/ob16-0731.log; systemd-run unit fm-ob16 with StandardInput=null"
```

- [ ] **Step 4: Append the finding to the ledger and commit**

Append a `## 2026-07-31 — ` section to `bugeventlog.md` recording: a measurement can be invalidated by host state with no commit touching its scope, so `recover` reported it fresh; and the checkpoint's instruction to prefer measurement 9 over measurement 2 was wrong, because measurement 9 was the poisoned reading.

```bash
cd /root/fm-wt/integrate
git add bugeventlog.md
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "docs(ledger): the suite timeouts were host state, not a deadlock"
python3 skills/foreman/scripts/fm-session.py close 16 --status done
```

---

### Task 3: Let a wrong measurement be retired (obligation 21)

**Files:**
- Modify: `skills/foreman/scripts/fm-session.py` (SCHEMA block, `connect()` migration loop, `build_recovery()`, `main()`)
- Test: `tests/session.bats`
- Modify: `tests/baseline.tsv:45`

**Interfaces:**
- Consumes: nothing.
- Produces: CLI `fm-session.py retire <measurement_id> --by <measurement_id> --reason TEXT`, exit 0 on success, exit 2 on refusal. `build_recovery()` excludes retired measurements from `measurements` and from all `counts`.

**Why:** `supersede` takes a `fact_id` only. Measurement 2 currently prints `OK/fresh = 26` directly above measurement 9, which observed `11 + TIMEOUT` for the same metric. A reader scanning `OK` rows still quotes the wrong number.

**Design note:** a measurement is not replaced by a new *statement* — its successor is already a row. So the operation points an old row at a newer row. Rows are never deleted; the ledger stays append-only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/session.bats`:

```bash
@test "a retired measurement disappears from recovery and its successor remains" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  $SESS measure "suite pass count" "11" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 1 --by 2 --reason "host state poisoned the first reading"
  [ "$status" -eq 0 ]
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" != *"= 26"* ]]
  [[ "$output" == *"= 11"* ]]
}

@test "retire refuses without a reason" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  $SESS measure "suite pass count" "11" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 1 --by 2
  [ "$status" -eq 2 ]
}

@test "retire refuses to point a measurement at itself" {
  cd "$REPO"
  $SESS measure "suite pass count" "26" --command "bats t.bats" --scope src/a.sh
  run $SESS retire 1 --by 1 --reason "nonsense"
  [ "$status" -eq 2 ]
  run $SESS recover
  [[ "$output" == *"= 26"* ]]
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats`
Expected: FAIL. `argparse` rejects `retire` as an invalid choice and exits 2, so the first test fails on its `[ "$status" -eq 0 ]` assertion. That first failure is the one that proves the feature is absent.

Note the second test (`retire refuses without a reason`) passes here **for the wrong reason** — it asserts exit 2, and an unknown subcommand also exits 2. Re-check it after Step 5: it must still pass once `retire` exists, which is what makes it meaningful.

- [ ] **Step 3: Add the columns to the schema and the migration loop**

In `skills/foreman/scripts/fm-session.py`, inside the `measurements` table in the `SCHEMA` string, after `value_num    REAL`, add:

```sql
  ,
  -- v3: a measurement proven wrong must be retirable. Its successor is already
  -- a row, so this points the old row at the new one. Rows are never deleted.
  superseded_by    INTEGER REFERENCES measurements(id),
  superseded_at    TEXT,
  supersede_reason TEXT
```

In `connect()`, extend the migration tuple list:

```python
    for table, col, decl in (
        ("facts", "superseded_at", "TEXT"),
        ("facts", "supersede_reason", "TEXT"),
        ("measurements", "value_num", "REAL"),
        ("measurements", "superseded_by", "INTEGER"),
        ("measurements", "superseded_at", "TEXT"),
        ("measurements", "supersede_reason", "TEXT"),
    ):
```

Bump the version constant:

```python
SCHEMA_VERSION = 3
```

- [ ] **Step 4: Exclude retired rows from recovery**

In `build_recovery()`, change the measurements query:

```python
    for r in cur.execute(
        "SELECT * FROM measurements WHERE superseded_by IS NULL ORDER BY id DESC"
    ).fetchall():
```

- [ ] **Step 5: Add the CLI command**

In `main()`, after the `supersede` parser block:

```python
    p = sub.add_parser("retire")
    p.add_argument("measurement_id", type=int)
    p.add_argument("--by", type=int, required=True,
                   help="id of the measurement that supersedes this one")
    p.add_argument("--reason", required=True,
                   help="why the old measurement stopped being true; required -- "
                        "an unexplained retirement is unauditable")
```

And before `return 2` at the end of the dispatch chain:

```python
    if a.cmd == "retire":
        if a.by == a.measurement_id:
            print("refusing: a measurement cannot supersede itself", file=sys.stderr)
            return 2
        row = cur.execute("SELECT id FROM measurements WHERE id=?", (a.by,)).fetchone()
        if row is None:
            print(f"refusing: no measurement {a.by} to supersede it", file=sys.stderr)
            return 2
        cur.execute(
            "UPDATE measurements SET superseded_by=?, superseded_at=?, "
            "supersede_reason=? WHERE id=?",
            (a.by, now_iso(), a.reason, a.measurement_id))
        conn.commit()
        print(f"measurement {a.measurement_id} retired, superseded by {a.by}")
        return 0
```

Add the usage line to the module docstring, under the existing `supersede` line:

```
#   fm-session.py retire <measurement_id> --by <id> --reason TEXT
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats`
Expected: PASS, `14 tests, 0 failures`.

- [ ] **Step 7: Update the registered baseline**

Change `tests/baseline.tsv:45` from `tests/session.bats	11` to `tests/session.bats	14`. The separator is a literal TAB.

Run: `cd /root/fm-wt/integrate && grep -P '^tests/session\.bats\t14$' tests/baseline.tsv`
Expected: the line prints. No output means the separator is not a tab.

- [ ] **Step 8: Retire the live wrong measurement**

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py retire 2 --by 9 \
  --reason "measurement 2 read 26 as fresh while the same file was poisoned by two leaked codex shims holding stdin; measurement 9 observed the poisoned run and Task 2 re-measured it clean"
python3 skills/foreman/scripts/fm-session.py recover | head -40
```

Expected: measurement 2 no longer appears.

- [ ] **Step 9: Commit**

```bash
cd /root/fm-wt/integrate
git add skills/foreman/scripts/fm-session.py tests/session.bats tests/baseline.tsv
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "feat(session): retire a measurement proven wrong

supersede took a fact_id only, so a measurement shown to be false stayed in
recover output reading OK/fresh forever. Measurement 2 printed 26 directly above
measurement 9, which observed 11+TIMEOUT for the same metric. A measurement's
successor is already a row, so retire points the old row at the new one; rows are
never deleted."
python3 skills/foreman/scripts/fm-session.py close 21 --status done
```

---

### Task 4: One session store per repository, not per worktree (fact 16 / fact 28)

**Files:**
- Modify: `skills/foreman/scripts/fm-session.py:123-131` (`repo_root()`)
- Test: `tests/session.bats`
- Modify: `tests/baseline.tsv:45`

**Interfaces:**
- Consumes: Task 3's schema (the migration loop runs against whichever DB is opened).
- Produces: `repo_root()` returns the same path from a repo and from all of its linked worktrees.

**Why:** `repo_root()` uses `git rev-parse --show-toplevel`, which differs per worktree, so each worktree gets its own `session.db`. Two already exist. Fact 23 measured the fix — `--git-common-dir` returns `/root/foreman/.git` identically from all 14 worktrees.

- [ ] **Step 1: Write the failing test**

Append to `tests/session.bats`:

```bash
@test "a linked worktree shares the repo's session store" {
  cd "$REPO"
  unset FOREMAN_SESSION_DB
  $SESS fact "recorded from the main worktree"
  git -C "$REPO" worktree add -q "$BATS_TEST_TMPDIR/wt" -b side
  cd "$BATS_TEST_TMPDIR/wt"
  run $SESS recover
  [ "$status" -eq 0 ]
  [[ "$output" == *"recorded from the main worktree"* ]]
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats -f "linked worktree"`
Expected: FAIL — the worktree opens an empty database, so the statement is absent.

- [ ] **Step 3: Key the store on the common git directory**

Replace `repo_root()` in `skills/foreman/scripts/fm-session.py`:

```python
def repo_root():
    """The directory holding the COMMON git dir, identical from every worktree.

    --show-toplevel differs per worktree, which gave each worktree its own
    session.db and fragmented the store. --git-common-dir returns the same
    path from all of them. --path-format=absolute is required: the bare form
    returns a relative '.git' from the main worktree."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(out).resolve().parent
    except Exception:
        return Path.cwd()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats`
Expected: PASS, `15 tests, 0 failures`.

- [ ] **Step 5: Update the baseline**

Change `tests/baseline.tsv:45` to `tests/session.bats	15` (literal TAB).

- [ ] **Step 6: Migrate the live databases**

The store now resolves to `/root/foreman/.foreman/session.db`. The populated DB is at `/root/fm-wt/integrate/.foreman/session.db`.

```bash
mkdir -p /root/foreman/.foreman
cp /root/fm-wt/integrate/.foreman/session.db /root/foreman/.foreman/session.db
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py recover | head -5      # facts present
cd /root/fm-wt/rod
python3 /root/fm-wt/integrate/skills/foreman/scripts/fm-session.py recover | head -5
```

Expected: both print the same `FACTS (N)` count. That is the negative control — before this change the second command showed an empty store.

Then remove the now-orphaned empty DB:

```bash
rm -f /root/fm-wt/integrate-wt-xps-run-implement-xps/.foreman/session.db
find /root -maxdepth 5 -name session.db      # expect: integrate and /root/foreman only
```

Keep `/root/fm-wt/integrate/.foreman/session.db` in place until the next session begins cleanly from the new path, then delete it.

- [ ] **Step 7: Supersede the stale fact and commit**

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py supersede 16 \
  "The session store keyed on --git-common-dir and is shared by every worktree. Fragmentation was realised, not latent: two session.db files existed before the fix" \
  --evidence "fm-session.py repo_root uses --path-format=absolute --git-common-dir; tests/session.bats 'a linked worktree shares the repo session store'" \
  --reason "fact 16 called the fragmentation latent and not yet realised; two databases already existed, and the fix fact 23 specified was never applied to line 126"

git add skills/foreman/scripts/fm-session.py tests/session.bats tests/baseline.tsv
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "fix(session): key the store on the common git dir, not the worktree top level

--show-toplevel differs per worktree, so each worktree opened its own session.db.
Two already existed, one of them empty. Fact 23 measured --git-common-dir as
identical from all 14 worktrees and that decision was never applied to the code."
```

---

### Task 5: True up the obligations ledger

**Files:**
- Modify: `.foreman/session.db` (via the CLI only)

**Interfaces:**
- Consumes: Tasks 3 and 4 (obligations 21 and 16 are closed by those tasks).
- Produces: an obligations list where every open row is genuinely owed.

**Why:** three obligations are already implemented and still read open. The list is the TODO that drives this sprint, and it is itself a stale record — the defect class the store exists to eliminate, occurring inside the store.

- [ ] **Step 1: Verify each claim against the tree before closing anything**

```bash
cd /root/fm-wt/integrate
grep -n "superseded_at\|supersede_reason" skills/foreman/scripts/fm-session.py | head -3   # ob 8
grep -n "value_num" skills/foreman/scripts/fm-session.py | head -3                          # ob 9
grep -n "^def project" skills/foreman/scripts/fm-session.py                                 # ob 10
```

Expected: `facts.superseded_at`/`supersede_reason` present; `measurements.value_num` present; `def project(conn)` at line 320. Do not close an obligation whose command returns nothing — that is the defect being fixed.

- [ ] **Step 2: Close the three completed obligations**

```bash
cd /root/fm-wt/integrate
S=skills/foreman/scripts/fm-session.py
python3 $S close 8  --status done
python3 $S close 9  --status done
python3 $S close 10 --status done
```

- [ ] **Step 3: Record why obligation 10 could not be closed as written**

Obligation 10 says "write the SQLite→TerminusDB projector". TerminusDB was withdrawn at `b3bbdc3`. The projector exists and targets the SQLite ontology.

```bash
python3 $S fact \
  "Obligation 10 named TerminusDB as the projector target after TerminusDB was withdrawn at b3bbdc3. The projector exists at fm-session.py:320 and targets the SQLite ontology. Closing an obligation requires checking its premise, not only its verb" \
  --evidence "grep -n '^def project' fm-session.py = 320; openspec/changes/archive/2026-07-30-terminusdb-withdrawn-*"
```

- [ ] **Step 4: Confirm the remaining open list is genuinely owed**

```bash
python3 $S recover | sed -n '/^OBLIGATIONS/,$p'
```

Read every remaining row. For any row whose statement no longer matches the tree, close it with evidence or supersede the fact behind it. Do not leave a row you could not verify.

- [ ] **Step 5: Append the finding to the ledger and commit**

Append a `## 2026-07-31 — ` section to `bugeventlog.md`: the obligations ledger carried three completed items as open because closure is manual and unbound to evidence; the enhancement is to bind `close` to a verification command recorded alongside the closure.

```bash
git add bugeventlog.md
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "docs(ledger): the obligations list carried three completed items as open"
```

---

### Task 6: Stop the plugin shipping without its headline feature

**Files:**
- Create: `tools/plugin-drift.sh`
- Create: `tests/plugin-drift.bats`
- Modify: `tests/baseline.tsv`, `tests/skip-budget.tsv`

**Not a CI gate, deliberately:** the installed-skill path does not exist on a hosted runner, so this runs locally and at release time. Registering it as a `ci-local` gate would make it fail on every CI run for a reason unrelated to the tree.

**Interfaces:**
- Consumes: nothing.
- Produces: `tools/plugin-drift.sh <installed-dir> <repo-skill-dir>` — exit 0 when no repo file is missing from the install, exit 1 otherwise, printing one `MISSING <relpath>` line per absent file.

**Why:** `~/.claude/skills/foreman` is a junction to `C:\Users\charl\foreman\skills\foreman`, the stale Windows checkout. It has no `ontology/`, no `fm-session.py`, no `lane-complete-check.sh`, no `graph-project.sh`. The installed plugin cannot do session recovery or ontology at all.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin-drift.bats`:

```bash
#!/usr/bin/env bats
# @description Tests for tools/plugin-drift.sh, which fails when the installed
#   skill is missing files the repo ships. The installed plugin once lacked the
#   entire session store and ontology while reporting no problem at all.

setup() {
  DRIFT="$BATS_TEST_DIRNAME/../tools/plugin-drift.sh"
  REPO_SKILL="$BATS_TEST_TMPDIR/repo-skill"
  INSTALLED="$BATS_TEST_TMPDIR/installed"
  mkdir -p "$REPO_SKILL/scripts" "$REPO_SKILL/ontology" "$INSTALLED/scripts"
  echo a > "$REPO_SKILL/scripts/fm-session.py"
  echo b > "$REPO_SKILL/ontology/schema.sql"
  echo a > "$INSTALLED/scripts/fm-session.py"
}

@test "drift is detected when the install is missing a repo file" {
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MISSING ontology/schema.sql"* ]]
}

@test "a complete install reports no drift" {
  mkdir -p "$INSTALLED/ontology"
  echo b > "$INSTALLED/ontology/schema.sql"
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no drift"* ]]
}
```

The first test is the negative control: it proves the checker fires on a known-bad input.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/plugin-drift.bats`
Expected: FAIL — both tests error, because `tools/plugin-drift.sh` does not exist.

- [ ] **Step 3: Write the checker**

Create `tools/plugin-drift.sh`:

```bash
#!/usr/bin/env bash
# @description Fail when the installed foreman skill is missing files the repo
#   ships. The installed plugin once lacked fm-session.py and the whole ontology
#   directory while nothing reported a problem.
# @arg $1 installed skill directory
# @arg $2 repo skill directory (skills/foreman)
# @exitcode 0 no drift; 1 drift found; 2 usage error
set -euo pipefail

installed="${1:-}"
repo="${2:-}"
if [[ -z "$installed" || -z "$repo" ]]; then
  echo "usage: plugin-drift.sh INSTALLED_DIR REPO_SKILL_DIR" >&2
  exit 2
fi
if [[ ! -d "$repo" ]]; then
  echo "not a directory: $repo" >&2
  exit 2
fi
if [[ ! -d "$installed" ]]; then
  echo "MISSING (entire install): $installed" >&2
  exit 1
fi

missing=0
while IFS= read -r rel; do
  if [[ ! -e "$installed/$rel" ]]; then
    echo "MISSING $rel"
    missing=$((missing + 1))
  fi
done < <(cd "$repo" && find . -type f -printf '%P\n' | sort)

if (( missing > 0 )); then
  echo "plugin-drift: $missing file(s) missing from the install"
  exit 1
fi
echo "plugin-drift: no drift"
```

Then: `chmod +x tools/plugin-drift.sh` and stage the mode with `git add --chmod=+x tools/plugin-drift.sh` — `git update-index --chmod=+x` followed by a plain `git add` silently reverts the mode.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/plugin-drift.bats`
Expected: PASS, `2 tests, 0 failures`.

- [ ] **Step 5: Register the new test file in BOTH policy files**

Add to `tests/baseline.tsv` (literal TAB): `tests/plugin-drift.bats	2`

Add three rows to `tests/skip-budget.tsv` (literal TABs):

```
tests/plugin-drift.bats	linux	0
tests/plugin-drift.bats	wsl	0
tests/plugin-drift.bats	windows	0
```

Run: `cd /root/fm-wt/integrate && bash tools/ci-local.sh --quick`
Expected: `CI-LOCAL RESULT PASS gates_failed=0`, with no unregistered-file report.

- [ ] **Step 6: Run the checker against the real install and record the result**

```bash
cd /root/fm-wt/integrate
bash tools/plugin-drift.sh /mnt/c/Users/charl/.claude/skills/foreman skills/foreman
```

Expected: exit 1, listing `ontology/schema.sql`, `scripts/fm-session.py`,
`scripts/lane-complete-check.sh`, `scripts/graph-project.sh` among others.

```bash
python3 skills/foreman/scripts/fm-session.py measure \
  "installed plugin files missing vs repo" "<count from the run above>" \
  --command "bash tools/plugin-drift.sh /mnt/c/Users/charl/.claude/skills/foreman skills/foreman" \
  --scope skills/foreman \
  --scope tools/plugin-drift.sh
```

- [ ] **Step 7: Repoint the install at a current checkout**

The junction targets the stale `C:\Users\charl\foreman`. Update that checkout, then re-verify:

```powershell
git -C C:\Users\charl\foreman fetch origin
git -C C:\Users\charl\foreman status --short
git -C C:\Users\charl\foreman pull --ff-only origin main
```

If the pull is refused because that tree is dirty or divergent, STOP and report — do not force. Re-run Step 6; expect `plugin-drift: no drift`.

- [ ] **Step 8: Commit**

```bash
cd /root/fm-wt/integrate
git add tools/plugin-drift.sh tests/plugin-drift.bats tests/baseline.tsv tests/skip-budget.tsv
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "feat(install): fail when the installed skill is missing repo files

The installed plugin is a junction to a stale checkout with no ontology
directory and no fm-session.py, so session recovery and the ontology were
absent from the shipped product while nothing reported a problem. The first
test is the negative control: it proves the checker fires on a known-bad input."
python3 skills/foreman/scripts/fm-session.py close 24 --status done
```

---

### Task 7: Reap the leaked audit-run timeout watchdog

**Files:**
- Modify: `skills/foreman/scripts/audit-run.sh:366-400`
- Test: `tests/decision-events.bats`

**Interfaces:**
- Consumes: nothing.
- Produces: `audit-run.sh` leaves no `sleep` process behind after it returns, on every exit path.

**Why this is the highest-leverage task in the plan.** `audit-run.sh:390` spawns a watchdog `sleep "$AUDIT_TIMEOUT_S"` — `audit.timeout_min` (default 30) × 60 = **1800 seconds** — and never reaps it when the audit returns. `tests/decision-events.bats` test 7 uses a fake `codex` that returns instantly, then blocks on the orphaned watchdog for 30 minutes. The per-file timeout is 600s, so **that file times out on every run**, the suite can never complete, the bats gate can never be re-enabled, and tag criterion 2 can never be met. In production the same leak leaves a 30-minute `sleep` behind after every audit.

- [ ] **Step 1: Reproduce the leak directly, before changing anything**

```bash
cd /root/fm-wt/integrate
systemd-run --unit=fm-leak --collect --property=StandardInput=null \
  --property=WorkingDirectory=/root/fm-wt/integrate \
  --property=StandardOutput=file:/root/fm-logs/leak.log \
  /usr/bin/flock /tmp/foreman-bats.lock \
  /bin/bash -c "bats tests/decision-events.bats -f 'one finding per finding'"
sleep 20
cat /sys/fs/cgroup/system.slice/fm-leak.service/cgroup.procs | \
  xargs -r ps -o pid,etime,args -p | grep sleep
systemctl stop fm-leak
```

Expected: a `sleep 1800.000` process is present. That is the negative control for this task — it must disappear in Step 5.

- [ ] **Step 2: Read the current watchdog block**

```bash
sed -n '360,405p' skills/foreman/scripts/audit-run.sh
```

Identify the variable holding the watchdog's PID. If the watchdog is backgrounded without its PID being captured, capturing it is part of the fix.

- [ ] **Step 3: Write the failing test**

Append to `tests/decision-events.bats`:

```bash
@test "audit-run leaves no timeout watchdog behind after it returns" {
  local fake_bin="$BATS_TEST_TMPDIR/fakebin-reap"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/codex" <<'FAKE'
#!/usr/bin/env bash
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '{"verdict":"APPROVED","summary":"ok","findings":[]}\n' > "$out"
FAKE
  chmod +x "$fake_bin/codex"
  export PATH="$fake_bin:$PATH"

  local rd base before after
  rd="$(seed_run run-audit-reap)"
  base="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$rd/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$base","lane":"audit-lane"}
EOF
  mkdir -p "$REPO/.foreman"

  before="$(pgrep -c -x sleep || true)"
  run bash "$SCRIPTS/audit-run.sh" run-audit-reap
  after="$(pgrep -c -x sleep || true)"

  # The watchdog must not outlive the audit. Compare counts, never pkill:
  # pgrep -f matches other agents' command lines.
  [ "${after:-0}" -le "${before:-0}" ]
}
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/decision-events.bats -f "no timeout watchdog"`
Expected: FAIL — `after` exceeds `before`, because the watchdog survived.

- [ ] **Step 5: Reap the watchdog on every exit path**

In `skills/foreman/scripts/audit-run.sh`, capture the watchdog PID when it is backgrounded:

```bash
  sleep "$AUDIT_TIMEOUT_S" &
  AUDIT_WATCHDOG_PID=$!
```

Then reap it in a trap so no exit path leaks it — normal return, `ar_fail`, or signal:

```bash
ar_reap_watchdog() {
  if [[ -n "${AUDIT_WATCHDOG_PID:-}" ]] && kill -0 "$AUDIT_WATCHDOG_PID" 2>/dev/null; then
    kill "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
    wait "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
  fi
  AUDIT_WATCHDOG_PID=""
}
trap ar_reap_watchdog EXIT INT TERM
```

Kill by the captured PID only. Never `pkill -f sleep` — `pgrep`/`pkill -f` match their own command line and other agents' prompt text.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/decision-events.bats`
Expected: PASS on the new test. Tests 3 and 5 (`gate-eval still PASSes when emission fails` and its FAIL counterpart) were **already failing before this plan** — record their status, do not fix them here. They belong to Plan 2.

- [ ] **Step 7: Prove the file now completes inside the per-file timeout**

```bash
cd /root/fm-wt/integrate
time flock /tmp/foreman-bats.lock bats tests/decision-events.bats
```

Expected: completes in well under 600s. Before this fix it blocked for 1800s.

- [ ] **Step 8: Update the baseline and commit**

Update the `tests/decision-events.bats` row in `tests/baseline.tsv` to its new registered pass count (previous count plus one). Two known failures remain; the baseline records observed passes, not aspiration.

```bash
cd /root/fm-wt/integrate
git add skills/foreman/scripts/audit-run.sh tests/decision-events.bats tests/baseline.tsv
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "fix(audit): reap the timeout watchdog instead of leaking it

audit-run.sh backgrounded sleep AUDIT_TIMEOUT_S (30 min by default) and never
reaped it, so every audit left a 30-minute sleep behind and decision-events.bats
test 7 blocked on the orphan. That file exceeded the 600s per-file timeout on
every run, so the suite could never complete and the bats gate could never be
re-enabled. Reaped by captured PID in a trap covering every exit path."
python3 skills/foreman/scripts/fm-session.py close 25 --status done
```

---

### Task 8: Prove the plan did not break the suite

**Files:** none modified.

**Interfaces:**
- Consumes: every preceding task.
- Produces: a scoped measurement of the full suite.

- [ ] **Step 1: Confirm no lanes are running**

```bash
cd /root/fm-wt/integrate && bash tools/lanectl.sh ps
```

Expected: no live lanes. If any are live, WAIT — the suite takes the host-wide mutex and starves them.

- [ ] **Step 2: Run the full suite detached, with stdin from /dev/null**

The suite returns a different verdict for the same tree depending on how it is launched.

```bash
systemd-run --unit=fm-suite-a1 --collect \
  --property=WorkingDirectory=/root/fm-wt/integrate \
  --property=StandardOutput=file:/root/fm-logs/suite-a1.log \
  --property=StandardError=append:/root/fm-logs/suite-a1.log \
  --property=StandardInput=null \
  /usr/bin/flock /tmp/foreman-bats.lock /bin/bash tests/run.sh
```

- [ ] **Step 3: Wait for it and read the result**

```bash
systemctl is-active fm-suite-a1          # poll until inactive
grep -E '^TOTAL|^RESULT' /root/fm-logs/suite-a1.log
```

Expected: `RESULT PASS`, `fail=0`, `bare_skip=0`, and **zero policy failures** — every slice must meet its registered baseline.

Do not compare against a remembered total. This plan adds exactly **six** tests (three in Task 3, one in Task 4, two in Task 6), so the correct check is per-slice, not aggregate:

```bash
grep -E 'session\.bats|plugin-drift\.bats' /root/fm-logs/suite-a1.log
```

Expected: `tests/session.bats` at 15 and `tests/plugin-drift.bats` at 2, each matching its `baseline.tsv` row. An aggregate that looks right while a slice is short is exactly the failure the per-slice baseline exists to catch: a seeded regression moves an aggregate by 1.7–5.9 pp while the owning slice drops 25–91 pp.

- [ ] **Step 4: Record it and end the session**

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py measure \
  "full suite after Tranche A.1" "<TOTAL line from Step 3>" \
  --command "systemd-run ... flock /tmp/foreman-bats.lock bash tests/run.sh" \
  --scope tests --scope skills/foreman/scripts --scope tools
python3 skills/foreman/scripts/fm-session.py end
```

- [ ] **Step 5: Push**

```bash
cd /root/fm-wt/integrate
git push origin integrate/v029-w1
git push origin integrate/v029-w1:main
```

---

## Plan series

This plan is one of six. Each produces working, testable software on its own.

| Plan | Scope | Depends on |
|---|---|---|
| **1. Recording instruments** (this plan) | ledger recovery, measurement retirement, store key, ledger true-up, plugin drift | — |
| **2. Tranche A.2 — telemetry spine** | `three-outcome-verdicts` dispatches 3–5, `decision-lineage-and-telemetry` 4b | Plan 1 |
| **3. CI/CD** | one gate definition, `gates-linux` + `gates-windows`, recorded red runs, `wsl-ci-parity` un-rescoped | Plan 1 |
| **4. Tranche B — vendor plane** | `vendor-adapter-contract` → `cross-vendor-audit-routing` → `audit-groundedness-gate`, strictly serial | Plan 2 |
| **5. Tranche C — test plane** | `regression-harness-tiers`, R3–R7 cleanup, negative-control registry, bats gate back ON | Plans 1, 3 |
| **6. Tranche D — graph plane** | SQLite spec rewrite first, then `knowledge-plane-refresh`, `graph-context-builder`, `graph-dogfood`, `graph-eval-falsification` last | Plans 2, 5 |

The documentation sprint (spec §7) runs as a final pass across Plans 3–6, because a doc pass written before the code it describes would need rewriting.
