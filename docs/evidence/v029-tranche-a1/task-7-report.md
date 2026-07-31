# Task 7 report: reap the leaked audit-run timeout watchdog

## 1. Step 1 evidence — the orphaned sleep, before any change

Reproduced with `systemd-run --unit=fm-leak` running
`bats tests/decision-events.bats -f 'one finding per finding'` (test 7) against the
unmodified script, under `flock /tmp/foreman-bats.lock`.

Snapshot taken 32s after launch (`/root/fm-logs/step1-evidence.txt`):

```
    PID     ELAPSED STAT COMMAND
 230204       00:32 Ss   /usr/bin/flock /tmp/foreman-bats.lock /bin/bash -c bats tests/decision-events.bats -f "one finding per finding"
 230206       00:32 S    bash /usr/libexec/bats-core/bats tests/decision-events.bats -f one finding per finding
 230213       00:32 S    bash /usr/libexec/bats-core/bats-exec-suite --dummy-flag -f one finding per finding /root/fm-wt/integrate/tests/decision-events.bats
 230214       00:32 S    bash /usr/libexec/bats-core/bats tests/decision-events.bats -f one finding per finding
 230215       00:32 S    bash /usr/libexec/bats-core/bats-format-cat --dummy-flag
 230216       00:32 S    cat
 230239       00:31 S    bash /usr/libexec/bats-core/bats-exec-file --dummy-flag 1 /root/fm-wt/integrate/tests/decision-events.bats /tmp/bats-run-W5do5W/test_list_file.txt
 230245       00:31 S    bash /usr/libexec/bats-core/bats-exec-test --dummy-flag /root/fm-wt/integrate/tests/decision-events.bats test_audit-2drun_emits_audit-2d5fverdict_and_one_finding_per_finding 1 1 1
 230800       00:26 S    sleep 1800.000
```

`sleep 1800.000` (PID 230800), 26s old and climbing, sitting under the bats process
tree while the fake `codex` in test 7 had already returned instantly. `systemctl stop
fm-leak` was used to clean up.

## 2. Root cause — the real code, not the brief's assumed shape

Contrary to the brief's assumption ("if the watchdog is backgrounded without its PID
being captured, capturing it is part of the fix"), the PID **was** already captured,
and an `EXIT`/`INT`/`TERM` trap (`ar_cleanup_processes`) already existed at
lines 92–111, already attempting to kill and wait on `AUDIT_WATCHDOG_PID`. No other
`trap` call existed anywhere else in the file to clobber it (`grep -n trap` found only
the three lines at 109–111).

The actual watchdog spawn (original lines ~388–412):

```bash
AUDIT_CHILD_PID=$!
(
  sleep "$AUDIT_TIMEOUT_S"
  if kill -0 "$AUDIT_CHILD_PID" 2>/dev/null; then
    printf 'timeout\n' >"${AUDIT_TIMEOUT_MARKER}.tmp.$$"
    mv -f "${AUDIT_TIMEOUT_MARKER}.tmp.$$" "$AUDIT_TIMEOUT_MARKER"
    kill -TERM -- "-$AUDIT_CHILD_PID" 2>/dev/null || true
    sleep 0.25
    kill -KILL -- "-$AUDIT_CHILD_PID" 2>/dev/null || true
  fi
) &
AUDIT_WATCHDOG_PID=$!
...
kill -TERM "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
wait "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
```

`AUDIT_WATCHDOG_PID` is the PID of the `( ... ) &` **subshell**, not of the `sleep`
process running inside it. A non-interactive script's background job shares the
script's process group (no `setsid`/`set -m` in play), so `sleep` is a genuine child
of the subshell, not of the top-level script. When the subshell is killed with a
plain `kill -TERM $AUDIT_WATCHDOG_PID` while it is blocked inside `wait()` for its own
`sleep` child, the subshell dies but does **not** propagate the signal to that child.
The `sleep` process is simply orphaned (reparented to PID 1's namespace init), and
keeps running for the rest of the 1800 seconds. This was confirmed directly with an
isolated repro before touching any real code:

```
watchdog subshell pid: 238227
    PID    PPID STAT COMMAND
 238229  238227 S+   sleep 30
--- killing subshell 238227 ---
--- is subshell alive? ---
bash: line 11: kill: (238227) - No such process
subshell gone
--- searching for orphaned sleep 30 ---
 238229  238216 S+         00:00 sleep 30
```

The subshell (238227) died; `sleep 30` (238229) survived, reparented to PPID 238216.

## 3. The fix

Run the watchdog under its own `setsid` process group instead of a plain subshell, so
the wrapper and the `sleep` inside it share one group and can be reaped with a single
group-signal — the same convention the file already used for `AUDIT_CHILD_PID`
(the actual `codex` process). Verified empirically that `setsid bash -c 'sleep N; ...'`
puts both the wrapper and its `sleep` child in the same process group, and that
`kill -TERM -- "-$GROUP_PID"` reaps both:

```
watchdog group pid: 238748
--- processes in this group ---
 238748  238738  238748 Ss   bash -c sleep 30; echo after
 238750  238748  238748 S    sleep 30
--- killing group -238748 ---
--- searching for survivors ---
none found - fully reaped
```

New code (`skills/foreman/scripts/audit-run.sh`):

```bash
ar_reap_watchdog() {
  if [[ -n "$AUDIT_WATCHDOG_PID" ]]; then
    kill -TERM -- "-$AUDIT_WATCHDOG_PID" 2>/dev/null || true
    kill -KILL -- "-$AUDIT_WATCHDOG_PID" 2>/dev/null || true
    wait "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
    AUDIT_WATCHDOG_PID=""
  fi
  return 0
}

ar_cleanup_processes() {
  ar_reap_watchdog
  if [[ -n "$AUDIT_CHILD_PID" ]]; then
    ...
```

```bash
AUDIT_CHILD_PID=$!
setsid bash -c '
  sleep "$1"
  if kill -0 "$2" 2>/dev/null; then
    printf "timeout\n" >"$3.tmp.$$"
    mv -f "$3.tmp.$$" "$3"
    kill -TERM -- "-$2" 2>/dev/null || true
    sleep 0.25
    kill -KILL -- "-$2" 2>/dev/null || true
  fi
' _ "$AUDIT_TIMEOUT_S" "$AUDIT_CHILD_PID" "$AUDIT_TIMEOUT_MARKER" &
AUDIT_WATCHDOG_PID=$!

wait "$AUDIT_CHILD_PID"
EC=$?
ar_reap_watchdog
AUDIT_CHILD_PID=""
set -e
```

`ar_reap_watchdog` is called from three places: inline right after the audit child
exits (normal path), from `ar_cleanup_processes` (registered on `EXIT`, which also
fires from every `ar_fail` call since `ar_fail` ends in `exit`), and transitively from
`INT`/`TERM` since those traps call `exit 130`/`exit 143`, which also runs the `EXIT`
trap. All exit paths converge on the same reap.

## 4. Step 4 — failing-test evidence (pre-fix)

Running only the new regression test against the **unfixed** script hangs rather than
producing a clean failed assertion, because the orphaned `sleep` holds the captured
stdout/stderr pipe open and bats' output capture blocks on that pipe closing — this
matches the reported production symptom exactly. Wrapped in an outer `timeout 90` to
avoid an actual 30-minute wait:

```
running with a 90s outer timeout against the PRE-FIX script to prove the hang (expect timeout, not a clean pass/fail)
1..1
exit code: 124

real    1m30.032s
```

Exit 124 = killed by `timeout` after 90s of hanging. This is the negative control at
the test level, corroborating Step 1's direct process evidence.

## 5. Step 6 — passing-test evidence (post-fix), full per-test list

Full run of `tests/decision-events.bats` against the fixed script:

```
1..10
ok 1 T1 premise: el_emit accepts new types; el_read returns them; compact keeps them
ok 2 T1 known-bad: payload that is not JSON makes el_emit fail (no blank line)
not ok 3 gate-eval emits gate_decision on PASS and el_read consumes it
# (in test file tests/decision-events.bats, line 96)
#   `[ "$status" -eq 0 ]' failed
# /tmp/bats-run-zp5YVl/test/3/foreman-home/runs/run-pass
ok 4 gate-eval emits gate_decision on FAIL with reasons
not ok 5 gate-eval still PASSes when emission fails; emission_failed recorded
# (in test file tests/decision-events.bats, line 130)
#   `[ "$status" -eq 0 ]' failed
ok 6 gate-eval still FAILs when emission fails; outcome unchanged
ok 7 audit-run emits audit_verdict and one finding per finding
ok 8 audit-run emits audit_verdict on UNVERIFIED-like failure (nonzero exit)
ok 9 finding_outcome is a new event; original finding bytes unchanged
ok 10 audit-run leaves no timeout watchdog behind after it returns
```

10 tests declared (9 original + 1 new regression test). **8 pass, 2 fail.**
Tests 3 and 5 fail — both are the pre-existing `gate-eval` emission failures called
out in the task brief as belonging to a later plan; they were not touched. Test 7,
the one that used to hang for 30 minutes, now completes as part of the normal run.

## 6. Step 7 — timing

```
real    1m4.479s
user    0m7.593s
sys     0m4.815s
```

Confirmed twice, including one run after the commit landed:

```
real    1m4.707s
user    0m7.891s
sys     0m4.744s
```

~65 seconds, well inside the 600-second per-file timeout. Before the fix this file
never completed at all (it hung on test 7 until the outer suite timeout killed it).

## 7. Proof the orphaned sleep no longer survives

After the single-test run against the fixed script:

```
=== sleep processes after fixed-script single-test run ===
none found - watchdog fully reaped
```

After the full 10-test run:

```
=== confirm no leaked watchdog after this run ===
none found
```

Independent re-run of the Step 1 reproduction methodology (fresh unit name
`fm-leak-fixed`, since the original `fm-leak` name was already used) against the
**fixed** script:

```
started, sleeping 20
--- unit still running? ---
inactive
--- cgroup procs (expect empty/gone if finished) ---
cgroup gone (unit finished)
--- searching whole system for the watchdog signature sleep NNN.NNN ---
none found - no leak
```

The unit completed and was garbage-collected within the 20-second observation window
(versus sitting on a live `sleep 1800.000` before the fix), and no `sleep NNN.NNN`
process (the watchdog's signature) exists anywhere on the system afterward.

## 8. tests/baseline.tsv

Diff (only the `decision-events` row changed):

```
-tests/decision-events.bats	9
+tests/decision-events.bats	8
```

Tab proof:

```
$ grep -n "decision-events" tests/baseline.tsv | cat -A
4:tests/decision-events.bats^I8$
```

`^I` confirms a literal tab separator, `$` confirms no trailing whitespace/CR.

**Delta from 9, explained:** the brief's own suggested "previous count plus one" is
wrong, per the task's explicit correction, and the observed numbers confirm why. The
registered 9 was never actually achieved — the file always timed out on test 7 before
this fix, so no one had ever seen all declared tests run to completion. After the fix:
10 tests run (9 original + 1 new regression test added in this task). Of those 10,
**8 pass** and **2 fail** (tests 3 and 5, the pre-existing `gate-eval` emission
failures, out of scope for this plan — not fixed here). The baseline now records 8,
the number actually observed, not 10 and not the naive "9 + 1 = 10".

## 9. shellcheck output

Default invocation (`shellcheck skills/foreman/scripts/audit-run.sh`), exit code 1
because of pre-existing/info-level findings only — no error-level findings:

```
In skills/foreman/scripts/audit-run.sh line 14:
source "$SCRIPT_DIR/lib/common.sh"
       ^-------------------------^ SC1091 (info): Not following: lib/common.sh was not specified as input (see shellcheck -x).

In skills/foreman/scripts/audit-run.sh line 16:
source "$SCRIPT_DIR/lib/eventlog.sh"
       ^---------------------------^ SC1091 (info): Not following: lib/eventlog.sh was not specified as input (see shellcheck -x).

In skills/foreman/scripts/audit-run.sh line 18:
source "$SCRIPT_DIR/lib/telemetry.sh"
       ^----------------------------^ SC1091 (info): Not following: lib/telemetry.sh was not specified as input (see shellcheck -x).

In skills/foreman/scripts/audit-run.sh line 20:
source "$SCRIPT_DIR/lib/evidence.sh"
       ^---------------------------^ SC1091 (info): Not following: lib/evidence.sh was not specified as input (see shellcheck -x).

In skills/foreman/scripts/audit-run.sh line 409:
setsid bash -c '
               ^-- SC2016 (info): Expressions don't expand in single quotes, use double quotes for that.
```

`shellcheck --severity=error skills/foreman/scripts/audit-run.sh` → **exit 0, no
output** (no error-level findings).

Comparison against the pre-fix original confirms the four `SC1091` findings are
pre-existing (present before this change) and unrelated to this fix. This change adds
exactly one new finding, `SC2016` (info level), on the new `setsid bash -c '...'`
line — this is intentional and correct: the single quotes are deliberate, deferring
`$1`/`$2`/`$3` expansion to the spawned `bash -c` subprocess rather than expanding
them in the parent script.

## 10. git ls-tree

```
$ git ls-tree HEAD skills/foreman/scripts/audit-run.sh
100755 blob 0591562d8e66ff68a826ed69e805f8113d541d67	skills/foreman/scripts/audit-run.sh
```

Mode `100755` confirmed against the commit, not just the working tree. Staged via
`git add --chmod=+x skills/foreman/scripts/audit-run.sh` (not `git update-index
--chmod=+x` + plain `add`).

## 11. Commit

```
340b48244748988d15da808540a044c3fe37cc9e
```

Author: `Charles Hoskinson <charles.hoskinson@gmail.com>`. No `Co-Authored-By`
trailer. 3 files changed: `skills/foreman/scripts/audit-run.sh`,
`tests/decision-events.bats`, `tests/baseline.tsv`.

Session store: ran the single specified action —
`python3 skills/foreman/scripts/fm-session.py close 25 --status done` → `obligation
25 -> done`. No other session-store writes or deletes were made.

## 12. Not verified / concerns

- I did not run the full bats suite (per instruction — it takes a host-wide mutex).
  Only `tests/decision-events.bats` was run, under `flock /tmp/foreman-bats.lock`.
- Tests 3 and 5 (`gate-eval` emission) were confirmed failing, consistent with the
  brief's statement that they predate this plan. I did not investigate their root
  cause further since the brief explicitly says not to fix them here.
- The `SC1091` "not following" shellcheck findings are pre-existing and outside this
  task's scope (no `-x` flag or `# shellcheck source=` fix attempted beyond what
  already existed in the file for those four lines).
- I did not test the watchdog's actual-timeout path end-to-end (i.e. configuring
  `audit.timeout_min` low enough that the watchdog fires and kills a genuinely slow
  fake `codex`) beyond what test 7/8's existing coverage exercises; the reap logic
  itself (`ar_reap_watchdog`) is exercised identically regardless of which branch
  (timeout vs. normal completion) is taken, and the group-kill mechanism was verified
  directly against a standalone repro (Section 3) rather than via a new dedicated
  bats case for the timeout-firing branch specifically.

---

## Task 7 — review round 2: six findings

Commit: `fd0ebef` — `fix(audit): repair two process leaks that the watchdog fix introduced`
Branch: `integrate/v029-w1`. Files changed: `skills/foreman/scripts/audit-run.sh`,
`tests/decision-events.bats`. `tests/baseline.tsv` needed no change (see below).

Three script variants were compared in every experiment:

| Label | Source | What it is |
|---|---|---|
| A | working tree / `fd0ebef` | this change |
| B | `340b482` | the reviewed change, with the two regressions |
| C | `340b482^` | the original code, with the orphan-sleep bug |

Process discovery in every harness reads `/proc/<pid>/environ`, `/proc/<pid>/comm`
and `ps` with explicit `pid`/`pgid`/`sid` columns. No harness uses `pgrep -f` or
`pkill -f`. Every kill is by exact PID.

### Finding 1 (Important) — the TERM-to-KILL escalation was dead on the timeout path

**Change.** `audit-run.sh` now waits for the watchdog before it reaps, when the
timeout marker exists:

```bash
wait "$AUDIT_CHILD_PID"
EC=$?
# On a real timeout the watchdog is mid-escalation. Wait for it to finish.
# An immediate reap would stop it inside the 0.25 s window, and then a
# descendant that ignores TERM would survive the audit.
if [[ -f "$AUDIT_TIMEOUT_MARKER" ]]; then
  wait "$AUDIT_WATCHDOG_PID" 2>/dev/null || true
fi
ar_reap_watchdog
```

**Covering test.** `/root/ab.sh escalation`. `audit.timeout_min = 0.05`. The fake
`codex` blocks and leaves a descendant that runs `trap "" TERM` and then blocks on
a `read` against a FIFO it holds open itself, so it has no child process and only
SIGKILL ends it.

**Command and output.**

```
$ bash /root/ab.sh escalation /root/regressed-audit-run.sh "B: 340b482 regressed (setsid watchdog)"
=== B: 340b482 regressed (setsid watchdog) / escalation ===
variant: /root/regressed-audit-run.sh
audit-run exit=1 after 9s
audit-run: [foreman] evidence collected to /tmp/fm-ab.WMTFDZ/foreman-home/runs/run-ab/evidence
audit-run: [foreman] ERROR: codex audit exceeded 0.05 minute timeout
TERM-ignoring descendant pid=476556
 476556  476553  476553       6 bash
RESULT: descendant SURVIVED
--- cleanup: kill every remaining experiment process by exact PID ---
residual (excluding this harness's own ps/awk children):
=== end B: 340b482 regressed (setsid watchdog) / escalation ===

$ bash /root/ab.sh escalation /root/new-audit-run.sh "A: fixed (this change)"
=== A: fixed (this change) / escalation ===
variant: /root/new-audit-run.sh
audit-run exit=1 after 9s
audit-run: [foreman] evidence collected to /tmp/fm-ab.KtMoBG/foreman-home/runs/run-ab/evidence
audit-run: [foreman] ERROR: codex audit exceeded 0.05 minute timeout
TERM-ignoring descendant pid=478768
RESULT: descendant was REAPED
--- cleanup: kill every remaining experiment process by exact PID ---
residual (excluding this harness's own ps/awk children):
=== end A: fixed (this change) / escalation ===

$ bash /root/ab.sh escalation /root/orig-audit-run.sh "C: 340b482^ original"
=== C: 340b482^ original / escalation ===
variant: /root/orig-audit-run.sh
audit-run exit=1 after 9s
audit-run: [foreman] evidence collected to /tmp/fm-ab.FrRNyD/foreman-home/runs/run-ab/evidence
audit-run: [foreman] ERROR: codex audit exceeded 0.05 minute timeout
TERM-ignoring descendant pid=483140
RESULT: descendant was REAPED
--- cleanup: kill every remaining experiment process by exact PID ---
residual (excluding this harness's own ps/awk children):
=== end C: 340b482^ original / escalation ===
```

This reproduces the reviewer's A/B exactly, and A now matches C. Fixed.

### Finding 2 (Important) — setsid made a SIGKILL of the script leak the watchdog

**Mechanism chosen.** The watchdog returns to a plain `( ... ) &` subshell in the
script's own process group, and it becomes self-terminating.

- `ar_watchdog_wait` sleeps in one-second slices. After every slice it runs
  `kill -0` against the parent script and against the auditor. Either one gone
  ends the watchdog inside one second, with no external signal. Fractional
  timeouts keep their precision through a final `sleep "$frac"`, so the
  `timeout_min = 0.02` fixture still behaves.
- The watchdog is in the script's group again, so any process-group sweep reaps
  it and its `sleep` together. This was the reviewer's stated preference.
- `ar_reap_watchdog` no longer signals a group. It sends SIGSTOP first, so the
  frozen watchdog cannot start another `sleep` while the function reads its
  child list from `ps -o pid= --ppid`. It then SIGKILLs the watchdog and that
  child by exact PID. The original orphan therefore cannot return: nothing
  depends on a killed shell signalling its own child.

Obligation 25 named `timeout(1)` and `kill -0 $PPID` polling as the durable
options. The watchdog does more than kill. It publishes a timeout marker and it
escalates against a foreign process group, so `timeout(1)` does not fit. The
poll plus short slices is the option that does.

**Covering test.** `/root/ab.sh sigkill`. It starts `audit-run.sh` under `setsid`
so the script leads its own group, waits 4 s for the watchdog to be live, then
SIGKILLs the whole group and classifies the survivors by session id. The auditor
is a deliberate `setsid` session of its own, so a group kill never reached it
before this change either. Survivors in the auditor's session are not a watchdog
leak and are labelled as such.

**Command and output (B, regressed).**

```
$ bash /root/ab.sh sigkill /root/regressed-audit-run.sh "B: 340b482 regressed (setsid watchdog)"
=== B: 340b482 regressed (setsid watchdog) / sigkill ===
variant: /root/regressed-audit-run.sh
script pid=490332 pgid=490332
--- experiment processes before the kill (pid/comm/args) ---
490332	bash	bash /tmp/fm-ab.uN9ajL/scripts/audit-run.sh run-ab
491117	bash	bash /tmp/fm-ab.uN9ajL/fakebin/codex exec --model gpt-5.6-sol ...
491118	bash	bash -c   sleep "$1" ... _ 1800.000 491117 .../audit-timeout.1
491120	sleep	sleep 1800.000
491121	bash	bash -c   fifo="$1.fifo" ... _ /tmp/fm-ab.uN9ajL/descendant.pid
491123	sleep	sleep 300
--- SIGKILL the whole process group ---
--- experiment processes after the SIGKILL (pid/sid/comm) ---
auditor pid=491117 sid=491117 (its own setsid
session by design; a group kill of the script never reached it)
  pid=491117 sid=491117 comm=bash
  pid=491118 sid=491118 comm=bash
  pid=491120 sid=491118 comm=sleep
  pid=491121 sid=491117 comm=bash
  pid=491123 sid=491117 comm=sleep
--- survivors outside the auditor session (watchdog leak candidates) ---
491118	bash	bash -c
491120	sleep	sleep 1800.000
RESULT: LEAKED
--- cleanup: kill every remaining experiment process by exact PID ---
residual (excluding this harness's own ps/awk children):
=== end B: 340b482 regressed (setsid watchdog) / sigkill ===
```

The watchdog wrapper 491118 and its `sleep 1800.000` survive in session 491118,
which is neither the script's group nor the auditor's session. That is the
reviewer's `LEAKED: sleep 1800.000`.

**Command and output (A, fixed).**

```
$ bash /root/ab.sh sigkill /root/new-audit-run.sh "A: fixed (this change)"
=== A: fixed (this change) / sigkill ===
variant: /root/new-audit-run.sh
script pid=497229 pgid=497229
--- experiment processes before the kill (pid/comm/args) ---
497229	bash	bash /tmp/fm-ab.4Ja24B/scripts/audit-run.sh run-ab
497692	bash	bash /tmp/fm-ab.4Ja24B/fakebin/codex exec --model gpt-5.6-sol ...
497693	bash	bash /tmp/fm-ab.4Ja24B/scripts/audit-run.sh run-ab
497697	bash	bash -c   fifo="$1.fifo" ... _ /tmp/fm-ab.4Ja24B/descendant.pid
497698	sleep	sleep 300
497824	sleep	sleep 1
--- SIGKILL the whole process group ---
--- experiment processes after the SIGKILL (pid/sid/comm) ---
auditor pid=497692 sid=497692 (its own setsid
session by design; a group kill of the script never reached it)
  pid=497692 sid=497692 comm=bash
  pid=497697 sid=497692 comm=bash
  pid=497698 sid=497692 comm=sleep
--- survivors outside the auditor session (watchdog leak candidates) ---
(none)
RESULT: no watchdog and no sleep survived the group SIGKILL
--- cleanup: kill every remaining experiment process by exact PID ---
residual (excluding this harness's own ps/awk children):
=== end A: fixed (this change) / sigkill ===
```

The pre-kill listing shows the watchdog subshell 497693 and its `sleep 1` inside
the script's own group. Both are gone after the group kill. Variant C behaves the
same way:

```
$ bash /root/ab.sh sigkill /root/orig-audit-run.sh "C: 340b482^ original"
--- survivors outside the auditor session (watchdog leak candidates) ---
(none)
RESULT: no watchdog and no sleep survived the group SIGKILL
```

Fixed, and the original orphan does not return. See the bats evidence below.

### Finding 3 (Minor) — `$$` in the watchdog orphaned the marker temp file

**Change.** The parent shell names the file once and the watchdog writes that
exact path:

```bash
AUDIT_TIMEOUT_MARKER="${RD}/audit-timeout.${ATTEMPT}"
# Name the marker temp file once, in this shell. The watchdog writes
# that exact path, so the cleanup code always finds it again.
AUDIT_TIMEOUT_MARKER_TMP="${AUDIT_TIMEOUT_MARKER}.tmp.$$"
rm -f "$AUDIT_TIMEOUT_MARKER" "$AUDIT_TIMEOUT_MARKER_TMP"
```

`ar_cleanup_processes` now removes `$AUDIT_TIMEOUT_MARKER_TMP` instead of a
re-derived `${AUDIT_TIMEOUT_MARKER}.tmp.$$`.

**Covering test.** `/root/f3.sh`. It kills a watchdog between the `printf` and the
`mv`, in each naming form, then runs that form's own cleanup line verbatim.

**Command and output.**

```
$ bash /root/f3.sh
=== B: 340b482 form — the watchdog derives the name from its own $$ ===
run dir after cleanup:
  audit-timeout.0.tmp.503227
RESULT: ORPHANED TEMP FILE

=== A: fixed form — the parent names the file once and passes it in ===
run dir after cleanup:
RESULT: clean
```

Fixed.

### Finding 4 (Minor) — the regression assertion was host-wide and unreachable

**Change.** `tests/decision-events.bats` now:

1. Adds a `sleeps_in_pgroup` helper that lists `sleep` PIDs in one process
   group, from `ps -eo pid=,pgid=,comm=`. No `pgrep`.
2. Samples that set before and after the run and compares the two sets with
   `comm -13`, so no foreign `sleep` can change the verdict.
3. Runs the script through a detached runner that closes every inherited
   descriptor above fd 2 and sends stdout and stderr to a file. Bats leaks its
   own output pipe on fd 3 into test children. A leaked watchdog held that pipe
   and blocked `run`, which is exactly why the old assertion never executed.
4. Uses `timeout --foreground`. Plain `timeout` puts its child in a NEW process
   group. That alone made a first version of this test pass against the leaking
   script, so the flag is load-bearing.
5. Kills any leak by exact PID before asserting, so a failing run leaves nothing
   on the host.
6. Also asserts `-f "$rd/audit-verdict.json"`, so an early exit cannot pass the
   test trivially.

**Negative control — the test must fail against the pre-fix script.**

```
$ cp /tmp/prefix-audit-run.sh skills/foreman/scripts/audit-run.sh   # 340b482^
$ time flock /tmp/foreman-bats.lock bats tests/decision-events.bats -f "no timeout watchdog"
1..1
not ok 1 audit-run leaves no timeout watchdog behind after it returns
# (in test file tests/decision-events.bats, line 341)
#   `[ -z "$leaked" ]' failed

real	0m8.288s
```

It fails, it fails on the leak assertion rather than on a hang, and it finishes
in 8 seconds instead of blocking for 1800.

**Positive control — the same test against this change.**

```
$ flock /tmp/foreman-bats.lock bats tests/decision-events.bats -f "no timeout watchdog"
1..1
ok 1 audit-run leaves no timeout watchdog behind after it returns
```

Fixed.

### Finding 5 (Minor) — two comments broke `skills/ste/SKILL.md` rule 6.3

`skills/ste/SKILL.md` was read first. Rule 6.3 caps a descriptive sentence at 25
words, 3.6 requires the active voice, and 3.4 forbids auxiliary-verb
constructions.

`audit-run.sh:95-98` (31 words, passive, em-dash splice) became four short
sentences, longest 10 words:

```
# Process-control globals are set only while the auditor is live. An
# external TERM cancels an in-flight audit. It reaps the dedicated auditor
# process group. The published in-progress verdict stays byte-identical.
```

`audit-run.sh:403-406` (31 words, passive, em-dash splice) was replaced outright
by the Finding 2 rewrite. The block comment above the watchdog is now four
sentences, longest 18 words, all active, no em-dash:

```
# The watchdog stays in this script's own process group. A process-group
# sweep therefore reaches it, and shellcheck can read the body. It ends by
# itself when this script or the auditor goes away, so no external signal
# is necessary. ar_reap_watchdog still kills it and its "sleep" by exact
# PID on every ordinary exit path.
```

The surviving escalation comment kept a "may ... ignore" auxiliary construction
from the old code, so it was rewritten as well: "Signal the whole group first.
Escalate after 0.25 seconds, because a descendant can ignore TERM."

No new or edited comment sentence in the file exceeds 25 words, and none
contains an em-dash.

### Finding 6 (Minor) — the watchdog body was not shellcheck-visible

Resolved by the Finding 2 fix: the watchdog is an inline subshell again, so
shellcheck parses it.

**Covering test.** `/root/f6.py` injects the same defect into each variant's
watchdog body. It removes the closing `fi` of the watchdog's `if`, then runs
`shellcheck --severity=error` and `bash -n` over both.

**Command and output.**

```
$ python3 /root/f6.py
=== B (340b482, watchdog inside a single-quoted bash -c string) ===
injected defect: removed the closing 'fi' of the watchdog's if
  $ shellcheck --severity=error f6-B.sh
    exit=0
  $ bash -n f6-B.sh
    exit=0

=== A (this change, watchdog inline in a subshell) ===
injected defect: removed the closing 'fi' of the watchdog's if
  $ shellcheck --severity=error f6-A.sh
    exit=1
    | In /tmp/f6-A.sh line 444:
    |   if ar_watchdog_wait "$AUDIT_TIMEOUT_S" "$AUDIT_CHILD_PID" "$$"; then
    |   ^-- SC1046 (error): Couldn't find 'fi' for this 'if'.
    |   ^-- SC1073 (error): Couldn't parse this if expression. Fix to allow more checks.
  $ bash -n f6-A.sh
    exit=2
    | /tmp/f6-A.sh: line 453: syntax error near unexpected token `)'
    | /tmp/f6-A.sh: line 453: `) &'
```

The regressed form hides a hard syntax error from both tools. This change does
not. Fixed.

### The original orphan has not returned

```
$ cd /root/fm-wt/integrate
$ (time flock /tmp/foreman-bats.lock bats tests/decision-events.bats) 2>&1 | tail -20
1..10
ok 1 T1 premise: el_emit accepts new types; el_read returns them; compact keeps them
ok 2 T1 known-bad: payload that is not JSON makes el_emit fail (no blank line)
not ok 3 gate-eval emits gate_decision on PASS and el_read consumes it
# (in test file tests/decision-events.bats, line 106)
#   `[ "$status" -eq 0 ]' failed
# /tmp/bats-run-6fYFAM/test/3/foreman-home/runs/run-pass
ok 4 gate-eval emits gate_decision on FAIL with reasons
not ok 5 gate-eval still PASSes when emission fails; emission_failed recorded
# (in test file tests/decision-events.bats, line 140)
#   `[ "$status" -eq 0 ]' failed
ok 6 gate-eval still FAILs when emission fails; outcome unchanged
ok 7 audit-run emits audit_verdict and one finding per finding
ok 8 audit-run emits audit_verdict on UNVERIFIED-like failure (nonzero exit)
ok 9 finding_outcome is a new event; original finding bytes unchanged
ok 10 audit-run leaves no timeout watchdog behind after it returns

real	1m4.134s
user	0m7.622s
sys	0m4.749s
--- sleeps after ---
 544466       7 sleep           sleep 20
```

10 tests, 8 pass, 64 seconds against a 600-second per-file limit. The only
`sleep` alive afterwards is a 7-second-old `sleep 20` from another agent's
polling loop, not a watchdog. Tests 3 and 5 are the pre-existing failures and
were not touched.

### Gates

```
$ shellcheck --severity=error skills/foreman/scripts/audit-run.sh
$ echo $?
0

$ git ls-tree HEAD skills/foreman/scripts/audit-run.sh
100755 blob a73185ed099ee245c83e7f7eb1b7ae7e8f831b0c	skills/foreman/scripts/audit-run.sh

$ grep -n "decision-events" tests/baseline.tsv | cat -A
4:tests/decision-events.bats^I8$

$ for f in skills/foreman/scripts/audit-run.sh tests/decision-events.bats tests/baseline.tsv; do
    printf "%s CR=%s\n" "$f" "$(grep -c $'\r' "$f" || true)"; done
skills/foreman/scripts/audit-run.sh CR=0
tests/decision-events.bats CR=0
tests/baseline.tsv CR=0
```

The mode is `100755`, staged with `git add --chmod=+x`. The baseline row is a
literal TAB (`^I`) and still reads 8, the count observed above, so no baseline
edit was needed. The session store at `/root/foreman/.foreman/session.db` was not
read or written.

### Cleanup

Every harness kills its own processes by exact PID and prints the residual set.
All residual listings were empty. A host-wide `ps` sweep for `sleep 1800` after
the work found none.
