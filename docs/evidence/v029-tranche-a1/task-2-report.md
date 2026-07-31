# Task 2 report — Record the obligation-16 verdict as a scoped measurement

## 1. Log-derived counts

Commands run:

```bash
systemctl is-active fm-ob16
# -> inactive

awk '/===SPLIT===/{f=1;next} !f{print}' /root/fm-logs/ob16-0731.log | grep -c '^ok'
# -> 26   (tests/audit-verdict.bats)

awk '/===SPLIT===/{f=1}f' /root/fm-logs/ob16-0731.log | grep -c '^ok'
# -> 4    (tests/decision-events.bats section)

awk '/===SPLIT===/{f=1}f' /root/fm-logs/ob16-0731.log | grep '^not ok'
# -> not ok 3 gate-eval emits gate_decision on PASS and el_read consumes it
# -> not ok 5 gate-eval still PASSes when emission fails; emission_failed recorded

grep -n '^1\.\.' /root/fm-logs/ob16-0731.log
# -> line 1:  1..26   (audit-verdict.bats plan)
# -> line 29: 1..9    (decision-events.bats plan)
```

Also inspected the raw decision-events section (`awk '/===SPLIT===/{f=1}f' ... | sed -n '1,40p'`)
to see which test numbers actually ran: `ok 1`, `ok 2`, `not ok 3`, `ok 4`,
`not ok 5`, `ok 6`, then the log ends — no `ok 7`/`8`/`9` and no further plan
lines. That confirms:

- **audit-verdict.bats**: 26 pass / 0 fail. `1..26` declared, 26 `ok` lines
  before the `===SPLIT===` marker, no `not ok` in that section. COMPLETED.
- **decision-events.bats**: `1..9` declared. Only tests 1,2,3,4,5,6 ran.
  4 pass (1,2,4,6), 2 fail (3,5). Tests 7, 8, 9 never appear in the log —
  consistent with the brief's account that test 7 blocked on the leaked
  1800s `audit-run.sh` watchdog and the run was stopped there.

Value string recorded (see below): `4 pass / 2 fail / INCOMPLETE - stopped at
test 7 of 9, blocked on the leaked audit-run watchdog`.

## 2. Measurements recorded

```bash
cd /root/fm-wt/integrate

python3 skills/foreman/scripts/fm-session.py measure \
  "tests/audit-verdict.bats pass count" "26 pass / 0 fail, file COMPLETED" \
  --command "flock /tmp/foreman-bats.lock bats tests/audit-verdict.bats" \
  --scope tests/audit-verdict.bats \
  --scope skills/foreman/scripts/audit-run.sh \
  --scope skills/foreman/scripts/gate-eval.sh
# -> measurement 10

python3 skills/foreman/scripts/fm-session.py measure \
  "tests/decision-events.bats pass count" \
  "4 pass / 2 fail / INCOMPLETE - stopped at test 7 of 9, blocked on the leaked audit-run watchdog" \
  --command "flock /tmp/foreman-bats.lock bats tests/decision-events.bats" \
  --scope tests/decision-events.bats \
  --scope skills/foreman/scripts/gate-eval.sh \
  --scope skills/foreman/scripts/lib/eventlog.sh
# -> measurement 11
```

**Measurement IDs: 10 and 11.**

Scope lists given:

- Measurement 10 (`tests/audit-verdict.bats pass count`): `tests/audit-verdict.bats`,
  `skills/foreman/scripts/audit-run.sh`, `skills/foreman/scripts/gate-eval.sh`
- Measurement 11 (`tests/decision-events.bats pass count`): `tests/decision-events.bats`,
  `skills/foreman/scripts/gate-eval.sh`, `skills/foreman/scripts/lib/eventlog.sh`

Confirmed present and fresh in `fm-session.py recover` output after recording,
both showing `no commit has touched its scope since measurement`.

## 3. Pre-existing items verified, not duplicated

- **Facts 30 and 31**: confirmed present via
  `python3 skills/foreman/scripts/fm-session.py recover | head -60` (the FACTS
  section lists `[31] Obligation 16 verdict is SPLIT...` and
  `[30] audit-run.sh:390 leaks its timeout watchdog...`). Did not add a new
  causation fact.
- **Obligation 16 closure**: confirmed via direct sqlite query
  (`SELECT id, status, closed_ts FROM obligations WHERE id=16` ->
  `(16, 'done', '2026-07-31T15:10:06Z')`), and independently by its absence
  from the `recover` OBLIGATIONS (open/blocked) listing. Did not run `close 16`
  again.
- **`fm-ob16` unit**: confirmed `systemctl is-active fm-ob16` returns
  `inactive`, as expected for a finished experiment.

## 4. Ledger entry and commit

Appended a new section, `## 2026-07-31 — Event 12: the shims were the cause,
not the deadlock — measurement 2 was right, the checkpoint's advice was
wrong`, to the end of `bugeventlog.md` (after the existing Event 11 section,
nothing above it touched). It records:

1. The freshness mechanism is git-commit-only, so a measurement can be
   invalidated by host state (leaked processes) with no commit touching its
   scope, and `recover` still reports it fresh (ties to fact 19, obligation 20).
2. `CHECKPOINT-2026-07-30-evening.md`'s instruction "Do not quote measurement
   2. Prefer measurement 9" was wrong. Measurement 9 (11 pass then TIMEOUT)
   was the poisoned reading, taken while two leaked codex shims held stdin.
   Measurement 2's value of 26 was correct, now reconfirmed by measurement 10
   (26/0, COMPLETED) once the shims were dead.
3. `tests/decision-events.bats` (measurement 11) is a separate, still-open
   problem (fact 30 / obligation 25), recorded as incomplete rather than as a
   bare pass count.

Verified the file has no CR bytes after the append
(`grep -c $'\r' bugeventlog.md` -> 0; `file bugeventlog.md` -> `Unicode text,
UTF-8 text`), and that `git diff --stat` shows only `51 insertions(+)`, 0
deletions, confirming append-only.

Commit:

```bash
git add bugeventlog.md
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "docs(ledger): the suite timeouts were host state, not a deadlock"
```

**Commit SHA: `af2b63d`**

Obligation 16 was NOT re-closed (already `done` from before this session, per
section 3 above).

## 5. Not verified / could not check

- I did not independently re-run the bats suites myself (per instructions, the
  suite takes a host-wide mutex and I was told not to run it). All counts come
  from reading `/root/fm-logs/ob16-0731.log`, which I read directly with `awk`/
  `grep`/`sed` as shown above.
- I did not inspect the internals of `audit-run.sh:390`'s watchdog leak beyond
  what fact 30 already documents; that remains obligation 25's job (a later
  task), not this one.
- I trusted the log file's content as given (not independently re-generated),
  since the brief states the experiment was already run and the unit already
  stopped; I only verified the counts derived from it, not the experiment's
  execution itself.
