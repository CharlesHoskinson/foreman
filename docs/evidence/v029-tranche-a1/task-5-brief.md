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

