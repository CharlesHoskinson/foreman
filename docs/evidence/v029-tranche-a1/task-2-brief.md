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

