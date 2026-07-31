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

