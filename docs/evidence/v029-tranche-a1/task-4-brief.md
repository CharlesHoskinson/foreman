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

