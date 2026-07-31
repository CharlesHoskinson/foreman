# Task 3 report: retire a measurement proven wrong

## 1. Failing test run (Step 2)

Command: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/session.bats`

```
1..14
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
not ok 12 a retired measurement disappears from recovery and its successor remains
# (in test file tests/session.bats, line 157)
#   `[ "$status" -eq 0 ]' failed
# measurement 1
# measurement 2
ok 13 retire refuses without a reason
ok 14 retire refuses to point a measurement at itself
```

Exit code: 1.

Why: `retire` was not yet a registered subcommand. argparse rejected it as
an invalid choice for `sub`, which exits 2 before any retire logic runs.
Test 12 asserts `[ "$status" -eq 0 ]` right after `retire 1 --by 2 --reason
...`, so it failed on that assertion. That is the failure that proves the
feature is absent.

Test 13 ("retire refuses without a reason") passed here, but for the wrong
reason: an unknown subcommand also exits 2, so the assertion is
accidentally satisfied before `retire` exists. This was re-checked after
implementation (Step 6 below) and it still passes once `retire` is real,
which is what makes it meaningful.

Test 14 also passed at this point, because a no-op (unknown subcommand
call) leaves measurement 1 untouched, so `recover` still shows `= 26`. This
one is not flagged as "wrong reason" in the brief; it is a legitimate
before/after invariant.

## 2. Passing test run (Step 6)

Same command, after implementing the schema change, migration, `build_recovery()`
filter, and the `retire` CLI command:

```
1..14
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
```

14 tests, 0 failures. Exit code 0. Re-ran a second time after fixing
`tests/baseline.tsv` (see note in section 3) to confirm nothing regressed;
same result.

## 3. `tests/baseline.tsv` line 45

```
tests/session.bats	14
```

Proof the separator is a literal tab (not spaces), via the exact command
the brief specifies:

```
$ grep -P '^tests/session\.bats\t14$' tests/baseline.tsv
tests/session.bats	14
```

The `grep -P` pattern requires a literal `\t` to match, and it matched, so
the separator is a tab.

`git diff --stat tests/baseline.tsv` shows exactly one line changed
(1 insertion, 1 deletion), confirming no other row in the file was
disturbed.

Note: while editing this line I made one intermediate mistake with a bad
`sed -i` substitution that briefly corrupted the metric name on line 45 to
`tests/sessio.bats` (missing the `n`). This was caught immediately with
`diff` against a freshly rebuilt version of the line and corrected before
proceeding; it never reached a commit. The final committed line is exactly
`tests/session.bats\t14`, verified above.

## 4. Retiring the live wrong measurements

The brief's Step 8 (`retire 2 --by 9`) is stale: it predates Task 2's clean
re-measurement. Per updated instructions, both measurement 2 and
measurement 9 are retired, each superseded by measurement 10 (the clean
26 pass / 0 fail, file COMPLETED re-run Task 2 recorded after the leaked
processes were killed).

Command 1:
```
$ python3 skills/foreman/scripts/fm-session.py retire 2 --by 10 \
    --reason "measurement 2 read fresh=26 while the host environment was poisoned by two leaked processes holding stdin; the reading itself was untrustworthy regardless of the number it showed"
measurement 2 retired, superseded by 10
```

Command 2:
```
$ python3 skills/foreman/scripts/fm-session.py retire 9 --by 10 \
    --reason "measurement 9 recorded the run taken while the environment was still poisoned by the two leaked processes; it observed 11 pass then TIMEOUT at 600s, which is the poisoned reading, not the correct one"
measurement 9 retired, superseded by 10
```

`recover` output, measurements section (filtered to ids 2, 9, 10):

```
$ python3 skills/foreman/scripts/fm-session.py recover | grep -E "^\s+(OK|STALE|\?)\s+\[(2|9|10)\]"
  OK    [10] tests/audit-verdict.bats pass count = 26 pass / 0 fail, file COMPLETED
```

Only measurement 10 appears. Measurements 2 and 9 are absent from both the
`measurements` list and the `fresh` count in `counts` (fresh dropped to 6,
consistent with both retired rows being excluded from the tally).

Full measurements block from `recover` after both retirements:

```
MEASUREMENTS — fresh=6 STALE=3 unknown=0
  OK    [11] tests/decision-events.bats pass count = 4 pass / 2 fail / INCOMPLETE - stopped at test 7 of 9, blocked on the leaked audit-run watchdog
       no commit has touched its scope since measurement  (measured 2026-07-31T15:28:25Z @ 2adcc740a1d4)
  OK    [10] tests/audit-verdict.bats pass count = 26 pass / 0 fail, file COMPLETED
       no commit has touched its scope since measurement  (measured 2026-07-31T15:28:16Z @ 2adcc740a1d4)
  OK    [8] full suite (partial run, stopped early) = 7 of 41 slices observed: 2 TIMEOUT at 600s (audit-verdict pass=11 vs baseline 26; decision-events pass=4 fail=2 vs baseline 9), other 5 PASS
       no commit has touched its scope since measurement  (measured 2026-07-30T22:50:49Z @ 9adb990a329e)
  OK    [7] shellcheck warning baseline = 13 warnings across 48 files, 0 errors
       no commit has touched its scope since measurement  (measured 2026-07-30T22:37:23Z @ 9adb990a329e)
  OK    [6] openspec strict validation = 30 packages valid, 0 invalid (3 terminusdb packages archived, not regressed)
       no commit has touched its scope since measurement  (measured 2026-07-30T22:37:16Z @ 9adb990a329e)
  OK    [5] ci-local gates green (bats off) = 5
       no commit has touched its scope since measurement  (measured 2026-07-30T22:22:41Z @ f6d577dbee5d)
  STALE [4] shellcheck warning baseline = 12 warnings across 48 files
       5 commit(s) touched its scope since measurement  (measured 2026-07-30T20:50:25Z @ 4b549197bc39)
       re-run: bash tools/ci-local.sh --quick
  STALE [3] openspec strict validation = 33 packages valid, 0 invalid
       2 commit(s) touched its scope since measurement  (measured 2026-07-30T20:50:25Z @ 4b549197bc39)
       re-run: for d in openspec/changes/*/; do /usr/local/bin/openspec validate $(basename $d) --strict; done
  STALE [1] full suite (merged tree) = 447 pass / 0 fail / 19 skip
       5 commit(s) touched its scope since measurement  (measured 2026-07-30T20:50:25Z @ 4b549197bc39)
       re-run: nohup setsid flock /tmp/foreman-bats.lock bash tests/run.sh > LOG 2>&1 < /dev/null &
```

(Rows 2, 9 are absent, as required. `.foreman/session.db` is gitignored,
so these retirements are not part of the commit diff -- they are state in
the local database, same as every other `measure`/`fact`/`obligation`
write this store has ever recorded.)

## 5. Commit

SHA: `531d7603bbcf6507dd0497d7fec089dbeb2b1094`

Author: Charles Hoskinson <charles.hoskinson@gmail.com> (no Co-Authored-By
trailer).

Files: `skills/foreman/scripts/fm-session.py`, `tests/session.bats`,
`tests/baseline.tsv` (3 files changed, 65 insertions, 3 deletions).

Commit message deviates from the brief's literal text in one place: the
brief's message describes a single `retire 2 --by 9`, which is the plan's
original (now-superseded) instruction. The committed message instead
describes the corrected operation actually performed -- retiring both
measurement 2 and measurement 9, each superseded by measurement 10 -- per
the task instructions' explicit resolution of that discrepancy.

Obligation 21 was closed after the commit:
```
$ python3 skills/foreman/scripts/fm-session.py close 21 --status done
obligation 21 -> done
```
This is a database-only write (not part of the git commit), consistent
with how `close` has always worked for this store.

## 6. Not verified / caveats

- The full bats suite was intentionally not run, per instructions (it
  takes a host-wide mutex). Only `tests/session.bats` was run, under
  `flock /tmp/foreman-bats.lock`.
- I did not independently re-verify the provenance of measurements 2, 9,
  and 10 beyond reading them back out of the store (i.e. I did not re-run
  `tests/audit-verdict.bats` myself); I relied on the task instructions'
  characterization of which reading is correct and the existing fact/
  measurement rows already in the store (fact 19, measurement 8) that
  corroborate the same story.
- One transient mistake during editing `tests/baseline.tsv` (a bad `sed -i`
  that briefly corrupted line 45's metric name) is disclosed above; it was
  caught and fixed before commit, and the final baseline file was diffed
  to confirm only line 45 changed.
