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

