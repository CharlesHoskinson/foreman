# Final whole-branch review: fix report

Worktree: `/root/fm-wt/integrate`. Branch: `integrate/v029-w1`.
Base at start: `093ca29`.

## Commits

| SHA | Subject |
| --- | --- |
| `f2e13976a0f3a08f9526d3ab4080d7092e02f2e0` | fix(session): stop three false-success paths in the recovery store |
| `880f0b9ce843900875ec04a0e326789f0445a5a3` | fix(audit): clear the watchdog PID after the timeout wait |
| `b7b75b50098515db584760a894fc631150163b5d` | feat(ci): run plugin-drift as an informational gate |
| `3ec2ae0b5ec2dedc62e004fb9ce50a9e9847dbd7` | docs(bugeventlog): record events 14-18 from tasks 6, 7 and 8 |

Author on all four: `Charles Hoskinson <charles.hoskinson@gmail.com>`.
No `Co-Authored-By` trailer:

```
$ git log -4 --format="%H %an <%ae>%n%b" | grep -i "co-authored" || echo "none"
none
```

---

## BLOCKER B1 — retire reported success for a measurement that does not exist

**Changed.** `skills/foreman/scripts/fm-session.py`, the `retire` branch. It now
reads the target row before the UPDATE, and refuses with exit 2 when the row is
absent. The UPDATE asserts `cur.rowcount == 1` and rolls back otherwise.

**Evidence, before the fix** (the reported reproduction):

```
$ fm-session.py retire 99 --by 1 --reason "nonexistent target"
measurement 99 retired, superseded by 1        # exit 0, zero rows updated
```

**Evidence, after the fix**, against the live store:

```
$ python3 skills/foreman/scripts/fm-session.py retire 99 --by 1 --reason "nonexistent target"
refusing: no measurement 99 to retire
exit=2
```

Test: `tests/session.bats` test 16, "retire refuses a measurement id that does
not exist". It also asserts the success line is absent, so a future change
cannot pass by exiting 2 and still printing it.

Note on provenance: the plan supplied this code verbatim. The instruction was
wrong, not the implementation.

---

## BLOCKER B2 — the ontology projector exported retired measurements as live

**Changed.** `project()` in `fm-session.py`. The measurements loop now skips a
row whose `superseded_by` is set, and emits a `Supersession` document for it
instead. The document carries `at` and `reason`, the same as the facts loop
above it. `Measurement` documents gained a `measurement_key` field
(`fm-measurement-<id>`), so the `Supersession` can name both sides. That mirrors
`claim_key` on `Claim`.

The projection is lossless, not merely filtered: the retirement survives as a
document.

**Evidence.** Against the live store, after retiring measurement 13 by 14:

```
live measurements: ['fm-measurement-5', 'fm-measurement-6', 'fm-measurement-7',
                    'fm-measurement-8', 'fm-measurement-10', 'fm-measurement-11',
                    'fm-measurement-12', 'fm-measurement-14']
measurement supersessions: [('Measurement/fm-measurement-2',  'Measurement/fm-measurement-10'),
                            ('Measurement/fm-measurement-9',  'Measurement/fm-measurement-10'),
                            ('Measurement/fm-measurement-13', 'Measurement/fm-measurement-14')]
```

`recover` reports 11 live rows. The projector emits 8 `Measurement` documents
and reports the other 3 on stderr:

```
$ fm-session.py project 2>&1 >/dev/null | grep "not projectable"
3 measurement(s) not projectable; record --num to include them
```

8 + 3 = 11. The two consumers now describe the same live set. The 3 reported
rows are pre-v2 rows with a NULL `value_num`; that path is the pre-existing,
deliberate "report rather than coerce" behaviour and is unchanged.

Test: `tests/session.bats` test 19, "project drops a retired measurement and
records the retirement". It asserts `"value": 11.0` is present, `"value": 26.0`
is absent, and that the `Supersession` names both measurement keys and the
reason text.

---

## BLOCKER B3 — retire permitted chains and cycles into already-retired rows

**Changed, part 1.** `retire` now refuses when `--by` is itself superseded,
with exit 2 and a message naming the successor.

**Changed, part 2.** `render()` in `fm-session.py`. The launch point had one
`else` branch that read "every measurement is fresh". Over zero rows that is a
true sentence that reads as an all-clear. There is now a third branch for the
empty live set:

```
LAUNCH POINT: no measurement is recorded, so nothing here is measured.
Measure before you quote a number. Then work the open obligations above.
```

The empty case is reachable: any new store hits it.

**Evidence, before the fix.** `retire 1 --by 2` then `retire 2 --by 1` both
returned 0, and `recover` printed `MEASUREMENTS — fresh=0 STALE=0 unknown=0`
followed by `LAUNCH POINT: every measurement is fresh.`

**Evidence, after the fix.** Test 17 asserts exit 2 and the string
"is itself superseded", and then asserts `recover` still shows `= 11` and not
`= 26`. Test 18 asserts the launch point does not say "every measurement is
fresh" on an empty store, and does say "no measurement is recorded".

Tests: `tests/session.bats` tests 17 and 18.

---

## BLOCKER B4 — ar_reap_watchdog signalled a PID the script no longer owned

**Changed.** `skills/foreman/scripts/audit-run.sh`, one line plus a comment:

```bash
if [[ -f "$AUDIT_TIMEOUT_MARKER" ]]; then
  wait "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
  # The wait reaped the watchdog, so this script no longer owns that PID.
  # The kernel can hand the same number to any process. Clearing it here
  # makes the reap below a no-op, instead of a signal to a stranger.
  AUDIT_WATCHDOG_PID=""
fi
ar_reap_watchdog
```

**How it was verified.** A full A/B was not run, because the change makes a
later block a no-op and cannot be observed by killing a stranger without
manufacturing a PID collision. Instead:

1. Read the guard. `ar_reap_watchdog` is wrapped in `if [[ -n
   "$AUDIT_WATCHDOG_PID" ]]`. An empty value skips the whole body, so the
   SIGSTOP, the `ps --ppid`, and the SIGKILL are all unreachable on that path.
   The function still ends `return 0`, so no exit path changes.
2. `bash -n skills/foreman/scripts/audit-run.sh` — OK.
3. `shellcheck --severity=error skills/foreman/scripts/audit-run.sh` — exit 0.
4. Ran both test files that exercise the timeout path, under the host mutex:

```
$ flock /tmp/foreman-bats.lock bash -c "bats tests/audit-verdict.bats; ...; bats tests/decision-events.bats; ..."
1..26
... 26 ok lines ...
AV_EXIT=0
1..10
not ok 3 gate-eval emits gate_decision on PASS and el_read consumes it
not ok 5 gate-eval still PASSes when emission fails; emission_failed recorded
DE_EXIT=1
```

`tests/audit-verdict.bats` is 26/26. It contains "timeout kills the whole audit
process group and records timeout", which is the exact branch changed.
`tests/decision-events.bats` is 8/10; the only failures are tests 3 and 5, the
pre-existing gate-eval-emission failures that are out of scope and untouched.
Test 10, "audit-run leaves no timeout watchdog behind after it returns", passes.

This closes item (1) of obligation 28. Item (2), reading
`/proc/<W>/task/<W>/children` instead of forking `ps`, is still open and is
recorded as such in fact 35.

---

## IMPORTANT I1 — obligation id 27 was missing from the store

**Changed.** Obligation 27 restored as a tombstone by a direct `INSERT` with an
explicit id, using `python3` and `sqlite3`. The CLI cannot set an id. The write
is an INSERT and never a DELETE. The row was then closed with the normal CLI
path, `fm-session.py close 27 --status done`.

The statement records: a review agent created a spurious row by misusing the
CLI; its original content was the literal string `"list"`; the agent removed it
with a direct SQL DELETE; and that DELETE violated the store's append-only
property, which the schema comment states as "Rows are never deleted".

**Evidence.**

```
$ python3 /root/tombstone27.py
inserted: {'id': 27, 'status': 'open'}
ids: [1, 2, 3, ..., 25, 26, 27, 28, 29, 30, 31, 32]

$ fm-session.py close 27 --status done
obligation 27 -> done
{'id': 27, 'status': 'done', 'closed_ts': '2026-07-31T21:37:03Z'}
```

The id sequence is now contiguous from 1 to 32.

---

## IMPORTANT I2 — bugeventlog.md was three tasks behind

**Changed.** `bugeventlog.md`, five new dated sections appended at the end. They
follow the shape of Events 12 and 13: `## <date> — Event N: <title>`, a
`**Phase:**` line, prose subheadings, and a closing `### Enhancement`.

- Event 14: a review agent wrote to, and then DELETEd from, the live session
  store it was reviewing. `connect()` writes `schema_meta` on every invocation
  and runs the column migration, so no read-only path exists today.
- Event 15: the `audit-run.sh` watchdog fix took two rounds. The first fix
  (`setsid`) removed the original orphan and introduced two new leaks: it killed
  the watchdog inside its own TERM-to-KILL escalation window, and it detached
  the watchdog so a SIGKILL of the script leaked the sleep. Adversarial A/B
  review found both; no test did. The section also records the third defect
  (B4 above), which survived both rounds.
- Event 16: a guard's predicate matched its own documentation. `lock.bats`
  searched for the literal `pkill -f` and fired on a comment warning against
  `pkill -f`.
- Event 17: a WSL file-splice dropped a script's `100755` bit, and a bad
  `sed -i` briefly corrupted a `baseline.tsv` metric name to `tests/sessio.bats`.
- Event 18: the architect relayed an unverified claim (that obligation 24 was
  already closed); the implementer checked the store, found it open, and refused
  to reconcile silently.

**Append-only proof.**

```
$ git diff --numstat bugeventlog.md
185	0	bugeventlog.md
```

185 insertions, 0 deletions. Line count 2739 -> 2924. No existing section was
edited.

---

## IMPORTANT I3 — tools/plugin-drift.sh was wired to nothing

**Changed.** `tools/ci-local.sh` gained `gate_plugin_drift`, gate 7. It follows
the `lanes` gate: it always returns 0 and never fails CI. The installed-skill
path does not exist on a hosted runner, and failing CI for an absent directory
would report drift that does not exist.

- Install path: `${FOREMAN_INSTALLED_SKILL:-$HOME/.claude/skills/foreman}`.
- Skips, with the reason on the GATE line, when the checker is missing, the repo
  skill dir is missing, or the install path is absent.
- On drift it prints the checker's `MISSING` lines and a count.
- Header comment list updated to name gate 7.

**Evidence — all three paths.**

```
# install present, no drift (this host: /root/.claude/skills/foreman)
GATE plugin-drift PASS no drift (informational)
CI-LOCAL RESULT PASS gates_failed=0

# install absent (the hosted-runner case)
GATE plugin-drift SKIP install path absent: /nonexistent/skills/foreman
CI-LOCAL RESULT PASS gates_failed=0

# install present and 20 files behind (the Windows install)
MISSING scripts/lib/telemetry.sh
...
GATE plugin-drift PASS drift=20 file(s) missing from /mnt/c/Users/charl/.claude/skills/foreman (informational)
CI-LOCAL RESULT PASS gates_failed=0
```

The drift case reports and still leaves `gates_failed=0`, which is the required
informational behaviour.

---

## IMPORTANT I4 — the orphaned pre-migration store was silent

**Changed.** New function `warn_orphan_store(chosen)` in `fm-session.py`, called
from `db_path()`. It runs `git rev-parse --show-toplevel`, builds
`<toplevel>/.foreman/session.db`, and warns when that file exists and is not the
chosen path. Nothing is deleted.

The warning goes to **stderr**, because `recover --json` and `project` write
machine-readable stdout.

**Evidence.**

```
$ python3 skills/foreman/scripts/fm-session.py recover >/dev/null
WARNING: an orphaned session store sits at /root/fm-wt/integrate/.foreman/session.db.
Nothing reads it. The store in use is /root/foreman/.foreman/session.db.
```

Both paths are named. Machine-readable output is unaffected: the `project`
NDJSON parse used for the B2 evidence above ran with `2>/dev/null` and with
stderr separated, and both produced valid JSON on every line.

---

## Small one 1 — the store-default docstring

**Changed.** `fm-session.py` header, the `Env:` block. It said
`default <repo>/.foreman/session.db`, which contradicts `repo_root()`. It now
says the default is `.foreman/session.db` beside the COMMON git dir, so every
worktree of one repository shares a single store.

---

## Small one 2 — measurement 13's value text was self-contradicting

Measurement 13 said "plus 4 new fails" and then described 3 of the 4 as
pre-existing. It also read the pre-fix run at `fd0ebef`, before `093ca29` fixed
the `lock.bats` guard.

**Changed.** The row was not edited. A new measurement 14 was recorded from
`/root/fm-logs/suite-final-0731.log`, and measurement 13 was retired by it
through the CLI.

The accurate numbers from that log:

```
SLICE tests/decision-events.bats  pass=8  fail=2  test=FAIL
SLICE tests/vendor-isolation.bats pass=7  fail=1  test=FAIL
SLICE tests/lock.bats             pass=13 fail=0  test=PASS
SLICE tests/grok-lane.bats        pass=11 fail=0  test=PASS
SLICE tests/lifecycle-gate.bats   pass=3  fail=0  test=PASS
SLICE tests/session.bats          pass=15 fail=0  test=PASS
SLICE tests/plugin-drift.bats     pass=3  fail=0  test=PASS
TOTAL pass=489 fail=3 skip=19 tests=511 bare_skip=0 platform=wsl
RESULT FAIL test_failures=3
```

Measurement 14's value states 489 pass / 3 fail / 19 skip of 511 tests, names
all three failures as pre-existing and out of scope, and states that zero
failures come from this plan.

```
$ fm-session.py retire 13 --by 14 --reason "..."
measurement 13 retired, superseded by 14
```

Fact 35 was also recorded, covering the B4 fix and stating that item (2) of
obligation 28 is still open.

---

## Testing

### tests/session.bats — negative control, before the fix

Every new test was written first and run against the unfixed code.

```
$ flock /tmp/foreman-bats.lock bats tests/session.bats
1..19
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
not ok 16 retire refuses a measurement id that does not exist
# (in test file tests/session.bats, line 198)
#   `[ "$status" -eq 2 ]' failed
# measurement 1
not ok 17 retire refuses to supersede with an already-retired measurement
# (in test file tests/session.bats, line 213)
#   `[ "$status" -eq 2 ]' failed
# measurement 1
# measurement 2
# measurement 1 retired, superseded by 2
not ok 18 the launch point does not claim freshness when no measurement exists
# (in test file tests/session.bats, line 227)
#   `[[ "$output" != *"every measurement is fresh"* ]]' failed
not ok 19 project drops a retired measurement and records the retirement
# (in test file tests/session.bats, line 242)
#   `[[ "$output" != *'"value": 26.0'* ]]' failed
# measurement 1
# measurement 2
# measurement 1 retired, superseded by 2
EXIT=1
```

15 pass, 4 fail. Each failure is the defect it was written for. The failure of
test 17 shows the second `retire` succeeding. The failure of test 19 shows the
retired `26.0` still exported as a live Measurement.

### tests/session.bats — after the fix

```
$ flock /tmp/foreman-bats.lock bats tests/session.bats
1..19
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
ok 16 retire refuses a measurement id that does not exist
ok 17 retire refuses to supersede with an already-retired measurement
ok 18 the launch point does not claim freshness when no measurement exists
ok 19 project drops a retired measurement and records the retirement
EXIT=0
```

19/19. No existing test was modified.

### Other affected test files

```
### tests/line-endings.bats     5/5 ok
### tests/docs-check.bats       5/5 ok
### tests/lock.bats            13/13 ok
### tests/plugin-drift.bats     3/3 ok
### tests/session.bats         19/19 ok
### tests/readme-structure.bats 12/12 ok
```

The full 19-minute suite was not run, per the brief.

### tests/baseline.tsv

Row updated 15 -> 19. Separator verified as a literal TAB with `cat -A`
(`^I` is the tab, `$` is the line end, and there is no `^M`):

```
$ grep -n "session.bats" tests/baseline.tsv | cat -A
45:tests/session.bats^I19$
```

---

## Constraint checks

### shellcheck

```
$ shellcheck --severity=error skills/foreman/scripts/audit-run.sh tools/ci-local.sh tools/plugin-drift.sh tests/session.bats
SC_EXIT=0
```

No output, exit 0. The repo-wide gate is unchanged at 13 warnings, 0 errors:

```
GATE shellcheck PASS warnings=13 files=49
```

### Executable modes in the git index

```
$ git ls-files -s skills/foreman/scripts/fm-session.py skills/foreman/scripts/audit-run.sh tools/ci-local.sh
100755 a10b34b71ab16448825e3505ad948674a48731b1 0	skills/foreman/scripts/audit-run.sh
100755 21e8873a7c39b7a2e6c8fac916b068b514cda7e6 0	skills/foreman/scripts/fm-session.py
100755 05b9ec533b98e5443ebeff58bae811ea38900f18 0	tools/ci-local.sh
```

Staged with `chmod +x` then `git add --chmod=+x`.
`git update-index --chmod=+x` was not used.

### Line endings

```
bugeventlog.md CR=0
skills/foreman/scripts/audit-run.sh CR=0
skills/foreman/scripts/fm-session.py CR=0
tests/baseline.tsv CR=0
tests/session.bats CR=0
tools/ci-local.sh CR=0
```

`tests/line-endings.bats` is 5/5.

### Out-of-scope files

`decision-events.bats` tests 3 and 5, `grok-lane.bats`, `lifecycle-gate.bats`
and `vendor-isolation.bats` were not touched.

```
$ git diff --stat 093ca29..HEAD
 bugeventlog.md                       | 185 +++++++++++++++++++++++++++++++++++
 skills/foreman/scripts/audit-run.sh  |   4 +
 skills/foreman/scripts/fm-session.py |  79 ++++++++++++++-
 tests/baseline.tsv                   |   2 +-
 tests/session.bats                   |  58 +++++++++++
 tools/ci-local.sh                    |  45 +++++++++
 6 files changed, 369 insertions(+), 4 deletions(-)
```

### ci-local

```
GATE shellcheck PASS warnings=13 files=49
GATE openspec PASS packages_valid=30
GATE formal SKIP --quick
GATE bats OFF suite disabled as a gate (deadlocks; FOREMAN_CI_BATS=1 to run)
GATE install PASS disposable_HOME_smoke
GATE lanes PASS checked=6 complete=2 incomplete=4 (informational)
GATE plugin-drift PASS no drift (informational)
CI-LOCAL RESULT PASS gates_failed=0
```

Working tree clean after all four commits.

---

## Concerns

1. `connect()` still writes on every invocation. Event 14's enhancement — a
   real read-only mode — is not implemented. A reviewer still cannot read the
   store without changing it. This is the root cause behind I1 and it remains
   open.
2. The orphaned store at `/root/fm-wt/integrate/.foreman/session.db` is now
   loud, but it is still there. The warning prints on every CLI invocation from
   that worktree, including inside scripts that call the CLI in a loop.
3. Item (2) of obligation 28 (`/proc/<W>/task/<W>/children` instead of forking
   `ps`) is still open. It is a separate ~10 ms race and was out of scope here.
4. Measurement 14 will go STALE immediately: the commits in this report touch
   `tests` and `skills/foreman/scripts`, which are in its scope. That is
   correct behaviour, not a defect. The suite needs a re-run before its numbers
   are quoted again, and the count will differ because `session.bats` grew from
   15 to 19.
