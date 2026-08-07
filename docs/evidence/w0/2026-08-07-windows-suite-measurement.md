# Windows full-suite Bats measurement — 2026-08-07

First observation of the Bats suite's real state on Windows. No CI run on any
branch had ever produced Windows per-slice pass counts before this run.

## Run

- Run ID: `31199790530`
- URL: https://github.com/CharlesHoskinson/foreman/actions/runs/31199790530
- Triggered by commit `c0b8bd1` (test(ci): measure the full Bats suite on
  Windows, still non-gating), pushed to `main`.
- Wall clock: `2026-08-07T16:54:21Z` → `2026-08-07T17:47:34Z` = **53m13s**
  (job step `gates-windows`: 53m8s). Command:
  `gh run view 31199790530 --json url,createdAt,updatedAt,status,conclusion`
- Result: `completed` / `success` (the probe step is `continue-on-error: true`,
  so this reflects the workflow surviving, not the suite passing).

## Verbatim probe-step output

From the "Probe the bats suite on Windows (non-gating)" step log. Command:
`gh run view 31199790530 --log > joblog.txt` then
`grep 'Probe the bats suite' joblog.txt`.

```
bats: Bats 1.11.0
timeout: /usr/bin/timeout
...
TOTAL pass=444 fail=270 skip=26 tests=740 bare_skip=0 platform=windows
REPORT /tmp/foreman-test-slices.tsv
RESULT ERROR runner_errors=1
run.sh rc=2
D:\a\_temp\7a3ee87e-17ee-4840-8df9-8f81368f7644.sh: line 11: : No such file or directory
slice report: ABSENT lines
```

## The artifact-publish bug found by this run, and its fix

`REPORT /tmp/foreman-test-slices.tsv` — not a `runner.temp` path.
`TEST_SLICE_REPORT`/`TEST_TAP_LOG` are declared in the `env:` block of the
**gating step** ("Run the shared gate definition with Git Bash"), not at job
level. The probe step run in this measurement did not inherit them, so
`tests/run.sh` fell back to its own default path (`${TMPDIR:-/tmp}/foreman-test-slices.tsv`
per `tests/run.sh:14`). The upload step globs
`${{ runner.temp }}/foreman-test-slices.tsv`, which matched nothing, so the
published artifact contained only `formal/out/*` — confirmed by downloading it:

```
gh run download -R CharlesHoskinson/foreman 31199790530 \
  -n gates-windows-reports-31199790530 -D /tmp/win-artifact-verify
find /tmp/win-artifact-verify -type f
```
→ 19 files, all under `formal/out/`; no `foreman-test-slices.tsv`.

The trailing `line 11: : No such file or directory` is
`wc -l < "$TEST_SLICE_REPORT"` with the variable unset.

**This is fixed** in commit `8d0162b`, which adds an `env:` block to the probe
step duplicating `TEST_SLICE_REPORT`/`TEST_TAP_LOG` from the gating step (the
gating step's own env block is untouched). The fix was not re-verified with a
second CI run for this task — that is future work's job when it next needs a
published slice-report artifact; the totals below come from data recovered
from run 31199790530's raw log, not from the artifact.

## How the data was recovered

The artifact was empty, but `tests/run.sh` prints one `SLICE ...` TAP-summary
line per file to stdout regardless of where it writes the TSV, and every
slice's line survived in the job log. Reconstruction:

```
gh run view 31199790530 --log > joblog.txt
grep 'Probe the bats suite' joblog.txt | grep -oP '(?<=Z )SLICE.*' > win-slices-raw.txt
wc -l < win-slices-raw.txt   # 57
```

Each `SLICE` line was reformatted into the same 14-column TSV
`tests/run.sh:267` writes
(`file\tplatform\tpass\tfail\tskip\tbare_skip\tskip_budget\tbudget_slack\tbaseline\tpass_delta\ttest_verdict\tbudget_verdict\tbaseline_verdict\tskip_reasons`),
producing `windows-slices.tsv` (57 rows). The totals below were computed
independently from that file and cross-checked against the job log's own
`TOTAL` line; they match exactly.

## Slice count

```
grep 'Probe the bats suite' joblog.txt | grep -oP '(?<=Z )SLICE.*' | wc -l
```
→ **57 slices**.

`main` at the commit this run measured (`c0b8bd1`) has exactly 57 top-level
`.bats` files under `tests/`:

```
git ls-tree -r --name-only HEAD -- tests | grep -E '^tests/[^/]+\.bats$' | wc -l
```
→ **57**. No slice is missing. (The working tree also has an *untracked*
`tests/test-policy.bats`, part of Task 1's in-progress work — it is correctly
absent from this run because CI checked out the committed `main`, which does
not include it.)

## Totals

```
awk -F'\t' 'NR>1{p+=$3;f+=$4;s+=$5} END{print "pass="p" fail="f" skip="s" rows="NR-1}' \
  windows-slices.tsv
```
→ `pass=444 fail=270 skip=26 rows=57`

Matches the job log's own line exactly:
`TOTAL pass=444 fail=270 skip=26 tests=740 bare_skip=0 platform=windows`.

Verdict breakdown (`awk -F'\t' 'NR>1{print $11}' windows-slices.tsv | sort | uniq -c`):

| test_verdict | count |
|---|---|
| PASS | 26 |
| FAIL | 30 |
| TIMEOUT | 1 |

27 of 57 slices (26 PASS + the 1 TIMEOUT slice, which recorded 0 failures
before being killed) ran with zero observed test failures. 30 slices have at
least one failure.

## The runner error (`runner_errors=1`)

`tests/run.sh` counts a "runner error" (as opposed to an ordinary test
failure) when a slice times out, produces unparsable TAP, or exits nonzero
with no TAP failure recorded (`tests/run.sh:334-356`). Exactly one slice hit
this:

```
grep -nE 'TIMEOUT .* exceeded|ERROR unparsable TAP|ERROR Bats exited' joblog.txt
```
→ `TIMEOUT tests/tier1-replay.bats exceeded 600s`

`tests/tier1-replay.bats` hit the per-file 600s bound before finishing;
`bats_status` was 124/137-class, so `run.sh` recorded `test_verdict=TIMEOUT`
(row: `pass=8 fail=0 skip=0 ... baseline=11 delta=-3 test=TIMEOUT
budget_verdict=PASS baseline_verdict=FAIL`) rather than counting it toward the
FAIL/PASS totals in the normal way. This is why `runner_errors=1` even though
no slice's `fail` column shows an unusual value for it.

## Complete list of slices whose `fail` column is not 0

Command:
```
awk -F'\t' 'NR>1 && $4!=0 {print}' windows-slices.tsv | sort -t$'\t' -k4,4nr
```
30 rows, format `file  platform  pass  fail  skip  bare_skip  skip_budget  budget_slack  baseline  pass_delta  test_verdict  budget_verdict  baseline_verdict  skip_reasons`:

```
tests/eventlog.bats	windows	0	35	0	0	0	0	34	-34	FAIL	PASS	FAIL	
tests/lane-run.bats	windows	0	35	0	0	0	0	32	-32	FAIL	PASS	FAIL	
tests/watch.bats	windows	24	35	0	0	0	0	59	-35	FAIL	PASS	FAIL	
tests/audit-verdict.bats	windows	0	26	0	0	0	0	26	-26	FAIL	PASS	FAIL	
tests/lane-supervise.bats	windows	3	14	0	0	0	0	17	-14	FAIL	PASS	FAIL	
tests/wt-new.bats	windows	0	14	0	0	0	0	14	-14	FAIL	PASS	FAIL	
tests/launcher.bats	windows	0	10	4	0	0	-4	4	-4	FAIL	FAIL	FAIL	
tests/vendor-isolation.bats	windows	0	10	0	0	0	0	8	-8	FAIL	PASS	FAIL	
tests/wt-merge.bats	windows	1	10	0	0	0	0	11	-10	FAIL	PASS	FAIL	
tests/merge-gate.bats	windows	2	9	0	0	0	0	11	-9	FAIL	PASS	FAIL	
tests/audit-routing.bats	windows	14	8	0	0	0	0	22	-8	FAIL	PASS	FAIL	
tests/decision-events.bats	windows	3	7	0	0	0	0	10	-7	FAIL	PASS	FAIL	
tests/lock.bats	windows	6	7	0	0	0	0	13	-7	FAIL	PASS	FAIL	
tests/resume.bats	windows	3	7	0	0	0	0	10	-7	FAIL	PASS	FAIL	
tests/wt-cleanup.bats	windows	0	7	0	0	0	0	6	-6	FAIL	PASS	FAIL	
tests/docs-check.bats	windows	12	5	0	0	0	0	17	-5	FAIL	PASS	FAIL	
tests/grok-lane.bats	windows	7	5	0	0	0	0	12	-5	FAIL	PASS	FAIL	
tests/foreman-cleanup.bats	windows	1	4	0	0	0	0	5	-4	FAIL	PASS	FAIL	
tests/session.bats	windows	30	4	0	0	0	0	34	-4	FAIL	PASS	FAIL	
tests/gate-ground.bats	windows	26	3	0	0	0	0	29	-3	FAIL	PASS	FAIL	
tests/telemetry.bats	windows	6	3	0	0	0	0	9	-3	FAIL	PASS	FAIL	
tests/worker-run.bats	windows	2	3	0	0	0	0	5	-3	FAIL	PASS	FAIL	
tests/council-localization.bats	windows	9	2	0	0	0	0	11	-2	FAIL	PASS	FAIL	
tests/adapters.bats	windows	26	1	0	0	0	0	27	-1	FAIL	PASS	FAIL	
tests/evidence.bats	windows	1	1	0	0	0	0	2	-1	FAIL	PASS	FAIL	
tests/fit-report.bats	windows	17	1	0	0	0	0	18	-1	FAIL	PASS	FAIL	
tests/lane-review-bundle.bats	windows	11	1	0	0	0	0	12	-1	FAIL	PASS	FAIL	
tests/line-endings.bats	windows	5	1	0	0	0	0	6	-1	FAIL	PASS	FAIL	
tests/maintenance.bats	windows	8	1	0	0	0	0	9	-1	FAIL	PASS	FAIL	
tests/tier2-compare.bats	windows	26	1	0	0	0	0	27	-1	FAIL	PASS	FAIL	
```

`tests/tier1-replay.bats` (the TIMEOUT slice, `fail=0`) is **not** in this
list because its `fail` column is 0, but it is not a passing slice — see the
runner-error section above.

## Zero-pass slices

`awk -F'\t' 'NR>1 && $3==0 {print}' windows-slices.tsv` → 9 slices:

| slice | pass | fail | skip | test_verdict |
|---|---|---|---|---|
| tests/audit-verdict.bats | 0 | 26 | 0 | FAIL |
| tests/eventlog.bats | 0 | 35 | 0 | FAIL |
| tests/lane-run.bats | 0 | 35 | 0 | FAIL |
| tests/launcher.bats | 0 | 10 | 4 | FAIL |
| tests/nats-bridge.bats | 0 | 0 | 12 | PASS (all-skip; budget_verdict=FAIL) |
| tests/round-ownership.bats | 0 | 0 | 8 | PASS (all-skip; budget_verdict=FAIL) |
| tests/vendor-isolation.bats | 0 | 10 | 0 | FAIL |
| tests/wt-cleanup.bats | 0 | 7 | 0 | FAIL |
| tests/wt-new.bats | 0 | 14 | 0 | FAIL |

`nats-bridge.bats` and `round-ownership.bats` show `test_verdict=PASS`
because `tests/run.sh` only marks `FAIL` on an observed `not ok`; both slices
skipped every test on Windows instead of failing any, but their skip counts
exceed the permitted skip budget, so `budget_verdict=FAIL`.

## Failure-cause frequency (missing tooling vs. real defects)

Command (grep over the probe-step log for the known missing-tool error text):

```
grep 'Probe the bats suite' joblog.txt | grep -c 'flock binary not found'
grep 'Probe the bats suite' joblog.txt | grep -c 'launcher/dist: No such file or directory'
grep 'Probe the bats suite' joblog.txt | grep -c 'sqlite3: command not found'
```

| Cause | Occurrences | Affected slices (representative) |
|---|---|---|
| `flock` binary not found (`setup_lock_trust_fixture`) | **134** | eventlog, lane-run, lock, wt-cleanup, wt-merge, wt-new, and others that share the lock-trust fixture |
| `cd: .../launcher/dist: No such file or directory` (launcher not built on this runner) | **10** | launcher.bats |
| `sqlite3: command not found` | **3** | session.bats (3 of its 4 failures) |

**147 of 270 failures (54%) trace to two runner-provisioning gaps — `flock`
and `sqlite3` are absent from the Windows runner image, and the launcher's
`dist/` was never built in this job — not to product defects.** Reporting
"270 failures" without this breakdown would misrepresent the suite's actual
state on Windows.

A few additional, smaller-count causes were also observed in the log and are
distinct from the three above:
- `session.bats`'s 4th failure (not one of its 3 `sqlite3` failures) is a
  Windows path-mangling bug: Python received
  `C:\d\a\foreman\foreman\skills\foreman\scripts\fm-session.py` (a Git-Bash
  POSIX path incorrectly converted to a Windows path) and raised
  `FileNotFoundError`.
- `worker-run.bats`'s 3 failures include two `grep: .../events.jsonl: No such
  file or directory` — consistent with the same "launcher not built" gap as
  `launcher.bats`, but surfacing as a missing runtime artifact rather than the
  `cd` error.
- `adapters.bats`'s 1 failure is `ln -s /nonexistent/nope.json ...` — an
  intentional negative-path test asserting `ln` fails on a nonexistent
  target; Windows' `ln` fails with a different message than the assertion
  expects, so this is a message-format assertion mismatch, not missing
  tooling.

The remaining ~119 failures (270 − 147 − 4 identified above) were not
individually triaged in this task; per the brief, root-causing and fixing is
Task 8's decision, not this task's.

## Summary

- 27 of 57 slices ran clean (0 failures) on Windows.
- 30 of 57 slices have at least one Bats failure; the complete list is above.
- 1 slice (`tier1-replay.bats`) exceeded the 600s per-file timeout and was
  killed, counted as `runner_errors=1`, not as an ordinary pass or fail.
- At least 147 of the 270 total failures are attributable to two
  runner-provisioning gaps (`flock`, `sqlite3` absent; launcher `dist/` not
  built), not to test or product defects.
- The measurement run itself completed within the 60-minute cap (53m13s wall
  clock) — no timeout finding to report for the workflow job.
- A real, separate bug was found and fixed in this task: the probe step
  never inherited `TEST_SLICE_REPORT`/`TEST_TAP_LOG`, so this run's artifact
  published no slice report at all. All numbers above were recovered from the
  job's raw log, not from the (empty) artifact. The fix (commit `8d0162b`)
  is unverified by a second CI run — a future run that needs the published
  artifact should confirm it lands.

## Commits

- `c0b8bd1` — test(ci): measure the full Bats suite on Windows, still
  non-gating (widened the probe from a 2-file smoke to the full shadow-mode
  suite; this is the commit run 31199790530 measured).
- `8d0162b` — fix(ci): give the Windows probe step its own
  `TEST_SLICE_REPORT` env (fixes the artifact-publish bug found by this run).
- (this document's commit)
