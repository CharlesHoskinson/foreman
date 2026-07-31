# Task 8: Prove the plan did not break the suite

## 1. Step 1 — lanectl.sh ps (before starting)

```
$ bash tools/lanectl.sh ps
PID      STAT   CPU       ELAPSED    OWNER                  LABEL          CMD
```

No live lanes. Clear to proceed.

## 2. systemd-run command and unit name

The brief's exact command (unit `fm-suite-a1`) was attempted first and failed immediately:
`tests/run.sh` runs under `set -uo pipefail` and references `$HOME` at line 43
(`mkdir -p -- "$HOME/.foreman"` inside `acquire_bats_mutex`). systemd's system-manager
environment does not include `HOME` (`systemctl show-environment` shows only `LANG` and
`PATH`), so the unit died instantly with `tests/run.sh: line 43: HOME: unbound variable`.
This is an environment gap in the launch invocation, not a test failure.

Fix: added `--setenv=HOME=/root` and moved to a fresh unit name, `fm-suite-a2`, since
`fm-suite-a1` had already been consumed (and `--collect` removes finished/failed units,
so the name was free again, but a fresh name avoids any ambiguity).

Command actually used:

```
systemd-run --unit=fm-suite-a2 --collect \
  --property=WorkingDirectory=/root/fm-wt/integrate \
  --property=StandardOutput=file:/root/fm-logs/suite-a2.log \
  --property=StandardError=append:/root/fm-logs/suite-a2.log \
  --property=StandardInput=null \
  --setenv=HOME=/root \
  /usr/bin/flock /tmp/foreman-bats.lock /bin/bash tests/run.sh
```

Log file: `/root/fm-logs/suite-a2.log`

## 3. TOTAL and RESULT lines

```
TOTAL pass=486 fail=6 skip=19 tests=511 bare_skip=0 platform=wsl
REPORT /tmp/foreman-test-slices.tsv
RESULT FAIL test_failures=6
```

The suite **completed** (did not hang, did not time out). The verdict is **FAIL**,
driven by 6 individual test failures across 4 slices. This is reported as-is, not
smoothed into a pass.

## 4. Per-slice table (all 45 registered slices ran; none missing, none extra)

| slice | pass | baseline | match | notes |
|---|---|---|---|---|
| tests/audit-verdict.bats | 26 | 26 | yes | |
| tests/checkpoint.bats | 6 | 6 | yes | |
| tests/config.bats | 16 | 16 | yes | |
| tests/decision-events.bats | 8 | 8 | yes (pass count) | fail=2 (tests 3, 5) — **expected, pre-existing, out of scope** per gate-eval emission; test=FAIL but baseline_verdict=PASS |
| tests/docs-check.bats | 5 | 5 | yes | |
| tests/durable-preflight.bats | 8 | 8 | yes | |
| tests/eventlog.bats | 34 | 34 | yes | skip=1 (budgeted) |
| tests/evidence.bats | 2 | 2 | yes | |
| tests/foreman-cleanup.bats | 5 | 5 | yes | |
| tests/foreman-setup.bats | 4 | 3 | **MISMATCH (+1, harmless)** | pass exceeds baseline; baseline_verdict=PASS |
| tests/gate-eval.bats | 1 | 1 | yes | |
| tests/git-guards.bats | 5 | 5 | yes | |
| tests/graph-project.bats | 10 | 10 | yes | |
| tests/grok-lane.bats | 10 | 11 | **MISMATCH (-1)** | test 11 failed: "grok Use route is refused citing Setup when unauthenticated". File untouched by any of this plan's 7 tasks (git log). Passed at 11/11 in the 2026-07-30 pre-plan run logs (fullsuite-0730-run6.log, merged-0730.log). Appears order/host-state sensitive — surfaces only under the real full-suite mutex run, not previously observed because the full suite never completed before. Not caused by this plan's diffs. |
| tests/grok-multiround.bats | 5 | 5 | yes | |
| tests/lane-queue.bats | 21 | 21 | yes | skip=2 (budgeted) |
| tests/lane-run.bats | 30 | 30 | yes | skip=3 (budgeted) |
| tests/lane-supervise.bats | 17 | 17 | yes | |
| tests/launch-lib.bats | 3 | 3 | yes | |
| tests/launcher.bats | 4 | 4 | yes | skip=10 (compiled launcher exe not built — budgeted) |
| tests/lifecycle-gate.bats | 2 | 3 | **MISMATCH (-1)** | test 1 failed: "Use refuses a not-ready grok lane at the door, citing Setup". Same shape as grok-lane.bats#11. File untouched by this plan; passed 3/3 in the 2026-07-30 pre-plan logs. Same order/host-state-sensitive pattern. |
| tests/line-endings.bats | 5 | 5 | yes | |
| tests/lock.bats | 12 | 13 | **MISMATCH (-1)** | test 13 failed: "operational scripts never use pkill -f pattern matching". **Root cause found and confirmed**: `skills/foreman/scripts/audit-run.sh` line 123, added by this plan's Task 7 (commit `340b482`), reads `# ... Never use pkill -f here, because it matches other agents' command lines.` — the explanatory comment contains the literal string `pkill -f`, which trips the file's own static `rg` guard against that pattern. **This is a real regression introduced by Task 7 of this plan**, not a pre-existing issue. |
| tests/maintenance.bats | 8 | 8 | yes | |
| tests/merge-gate.bats | 11 | 11 | yes | |
| tests/nats-bridge.bats | 12 | 12 | yes | |
| tests/plugin-drift.bats | 3 | 3 | yes | new file added by this plan (Task 6); at registered baseline |
| tests/pr-open.bats | 6 | 6 | yes | |
| tests/readme-structure.bats | 12 | 12 | yes | |
| tests/release-metrics.bats | 13 | 13 | yes | |
| tests/resume.bats | 10 | 10 | yes | |
| tests/round-ownership.bats | 8 | 8 | yes | |
| tests/session.bats | 15 | 15 | yes | this plan added 4 tests (11→15); confirmed at 15 |
| tests/soft-mode-target.bats | 3 | 3 | yes | |
| tests/telemetry.bats | 9 | 9 | yes | |
| tests/tool-check-auth.bats | 9 | 9 | yes | |
| tests/vendor-concurrency-test.bats | 16 | 16 | yes | |
| tests/vendor-isolation.bats | 7 | 8 | **MISMATCH (-1)** | test 7 failed: "lane-run (LANE_VENDOR=claude, fake launcher shim): CLAUDE_CONFIG_DIR exported, normalized". File untouched by this plan; passed 8/8 in the 2026-07-30 pre-plan logs. Same order/host-state-sensitive pattern as grok-lane/lifecycle-gate. |
| tests/watch.bats | 59 | 59 | yes | |
| tests/worker-cmd.bats | 3 | 3 | yes | |
| tests/worker-run.bats | 5 | 5 | yes | |
| tests/wsl-clock-preflight.bats | 7 | 7 | yes | |
| tests/wt-cleanup.bats | 6 | 6 | yes | skip=1 (budgeted) |
| tests/wt-merge.bats | 11 | 11 | yes | |
| tests/wt-new.bats | 14 | 14 | yes | |

**Summary of mismatches:** 5 slices below or above registered baseline:
- `tests/foreman-setup.bats`: +1 (harmless, exceeds floor)
- `tests/grok-lane.bats`: -1 (pre-existing, file untouched by plan, order/host-sensitive)
- `tests/lifecycle-gate.bats`: -1 (pre-existing, file untouched by plan, order/host-sensitive)
- `tests/lock.bats`: -1 (**real regression from this plan's Task 7** — comment text collision with the file's own static guard)
- `tests/vendor-isolation.bats`: -1 (pre-existing, file untouched by plan, order/host-sensitive)

`tests/decision-events.bats` matches its baseline pass count (8/8) but carries 2 known,
pre-existing, explicitly-expected failures in gate-eval emission (tests 3 and 5),
per this task's brief resolution. Confirmed against the log: identical failure text
and line numbers as documented.

## 5. Per-file timeout check

No slice hit the 600-second per-file timeout. Grepped the full log for `timeout` —
every occurrence is a test name/assertion about timeout behavior (e.g. "timeout kills
the whole audit process group"), not a runner-level timeout event. All 45 slices
produced a `SLICE ... baseline_verdict=...` line, i.e., every file ran to completion.

## 6. Wall-clock time

From `journalctl -u fm-suite-a2`:

```
2026-07-31T13:55:52-06:00  Started fm-suite-a2.service
2026-07-31T14:15:05-06:00  Main process exited, code=exited, status=1/FAILURE
2026-07-31T14:15:05-06:00  Consumed 6min 46.444s CPU time over 19min 12.844s wall clock time, 833.9M memory peak.
```

**Total wall-clock: 19 minutes 13 seconds** (systemd-reported: 19min 12.844s).
Exit status 1 corresponds to `RESULT FAIL` (nonzero because of the 6 test failures),
not a crash or hang.

## 7. Measurement and session

```
$ python3 skills/foreman/scripts/fm-session.py measure "full suite after Tranche A.1" "<full outcome string, see below>" \
    --command "systemd-run --unit=fm-suite-a2 ... /usr/bin/flock /tmp/foreman-bats.lock /bin/bash tests/run.sh" \
    --scope tests --scope skills/foreman/scripts --scope tools
measurement 13
```

Value string recorded (verbatim, not a bare pass count):

> TOTAL pass=486 fail=6 skip=19 tests=511 bare_skip=0 platform=wsl; RESULT FAIL
> test_failures=6 (2 known pre-existing decision-events.bats gate-eval-emission
> failures, out of scope, expected; plus 4 new fails: lock.bats-1 caused by Task 7's
> audit-run.sh comment literally containing the string pkill -f, tripping its static
> no-pkill-f check -- a real regression from this plan; grok-lane.bats-1,
> lifecycle-gate.bats-1, vendor-isolation.bats-1 all pre-existing/order-dependent,
> files untouched by this plan, previously observed passing only in per-file/merged
> runs, never in a completed full-suite run); wall clock 19m13s; no per-file 600s
> timeouts hit; session.bats=15/15 and plugin-drift.bats=3/3 both match baseline; all
> 45 registered slices ran, zero missing

Session ended:

```
$ python3 skills/foreman/scripts/fm-session.py end
session ended: 20260731T143323Z-41ab8f
```

Scope paths passed: `tests`, `skills/foreman/scripts`, `tools`.

## 8. git push

Only the working branch was pushed, per instructions. `main` was deliberately **not**
pushed (the brief's Step 5 includes `git push origin integrate/v029-w1:main`; that
decision is being held by the requester and was skipped here).

```
$ git status
On branch integrate/v029-w1
nothing to commit, working tree clean

$ git push origin integrate/v029-w1
To https://github.com/CharlesHoskinson/foreman
   dbf81b3..fd0ebef  integrate/v029-w1 -> integrate/v029-w1
```

## 9. What could not be verified / open items

- **Root cause for the three order/host-sensitive failures** (grok-lane.bats#11,
  lifecycle-gate.bats#1, vendor-isolation.bats#7) was not fully diagnosed beyond:
  confirming (a) none of the three files were touched by any commit in this plan
  (`git log` on each file stops well before the plan's first task commit), and
  (b) each passed at its registered baseline in the 2026-07-30 pre-plan log files
  under `/root/fm-logs/` (fullsuite-0730-run6.log, merged-0730.log). Those older
  logs may themselves be merged/per-file runs rather than genuine host-mutex full
  runs, so I cannot rule out that this is the first time these three tests have ever
  been exercised under real full-suite concurrency/load. I did not attempt to rerun
  them in isolation to confirm flakiness, since that would mean a second full-suite
  invocation and the task only calls for one authoritative run.
- **`tests/foreman-setup.bats` at 4 vs. baseline 3** was not investigated for why it
  now exceeds its floor by one — harmless for the FAIL verdict but a baseline drift
  worth someone updating `baseline.tsv` for.
- Per instructions, I did not modify `tests/lock.bats`, `audit-run.sh`, or any other
  test/product file to make the suite pass — all four extra failures are reported,
  not fixed.
