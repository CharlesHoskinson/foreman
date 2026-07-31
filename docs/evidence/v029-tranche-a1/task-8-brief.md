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

