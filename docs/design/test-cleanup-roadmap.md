# Test suite cleanup roadmap

Status: the bats suite is **OFF as a CI gate** (`tools/ci-local.sh`, 2026-07-30).
Nothing is deleted. `FOREMAN_CI_BATS=1 bash tools/ci-local.sh` still runs it.

## Why it was turned off

It does not merely fail. **It deadlocks.**

`tests/decision-events.bats` hung for 31 minutes on
`audit-run emits audit-verdict on UNVERIFIED-like failure (nonzero exit)` while
holding the host-wide bats mutex. Three unrelated verification commands queued
behind it and produced no output for 38, 28 and 4 minutes respectively. The
operator (me) reported "the suite is running" three times. It was queued, not
running.

A gate that can hang indefinitely is worse than no gate: every downstream
verification becomes a silent wait, and silence reads as progress.

## Root causes, in the order they should be fixed

### R1 — a hanging test can take the whole pipeline down
**Severity: critical.** One test with no timeout blocks every other verification
on the host, because `tests/run.sh` takes a host-wide mutex for the whole run.

Fix: a per-file timeout inside `tests/run.sh`, so one wedged file fails that
slice instead of the suite. `timeout` is already a dependency (`env/tool-check.sh`).
This is the single highest-value change on this list — it converts a deadlock
into a failure, and a failure is actionable.

### R2 — `audit-run.sh` feeds codex on stdin
**Severity: high.** `audit-run.sh:387` uses `- <"$PROMPT"`, violating the
never-stdin invariant stated at `worker-cmd.sh:2-6` and `launcher/README.md:32-33`.
A fixture that supplies no stdin blocks forever. This is the probable direct
cause of the `decision-events` hang.

Fix belongs to `vendor-adapter-contract`, which owns the invocation shape. Until
then, every audit-path test must redirect stdin from `/dev/null`.

### R3 — the suite's verdict depends on how it was launched
**Severity: high, already documented** (AGENT_TRAPS §10). `lane-run` test 8
passes standalone and under `run.sh` alone, and fails as one of 41 files under
load. Setup-liveness bounds are too tight.

Fix: audit every bounded wait in `tests/*.bats`. A setup timeout is not the
property under test and should be generous; only the asserted property is tight.

### R4 — platform-coupled tests fail instead of skipping
**Severity: medium, partially fixed.** Four were fixed on 2026-07-30 with
capability probes (`taskkill`, `cygpath`, PATHEXT). The pattern must be applied
to the rest rather than assumed complete.

Fix: every test that asserts platform behaviour carries a capability guard —
probe the capability, never match on `uname`.

### R5 — the policy layer is calibrated for one host
**Severity: medium.** `baseline.tsv` has no platform column, so one number must
hold everywhere. Windows-recorded baselines were unreachable on WSL; the current
values are the WSL floor, which under-gates every other platform.

Fix: add a platform column, mirroring `skip-budget.tsv`. Requires a header change
in `tests/run.sh` (`validate_baseline_file`).

### R6 — tests written by the lane that wrote the code
**Severity: medium.** 26 of the `audit-verdict.bats` tests were written by the
same lane that wrote `audit-run.sh`. Green there proves internal consistency, not
correctness. The `rod` near-miss was caught by a *registered baseline*, not by the
lane's own tests.

Fix: for each suite, name one assertion that would fail if the implementation
were subtly wrong, and verify it fails against an injected defect. This repo
already requires that of checkers; it has never been applied to the test suite
itself.

### R7 — unsound assertions
**Severity: low, but embarrassing.** Three written on 2026-07-30 alone: a bare
`STALE` substring that the counts header always contains; an absence assertion
defeated by bats merging stderr into `$output`; an ambient-`PATH` `grep -c` with
no baseline.

Fix: a review pass for assertions that match summary lines or inherited state.

## Order of work

1. **R1** — per-file timeout. Nothing else can be diagnosed reliably until a
   wedged file cannot hold the host.
2. **R2** — stdin redirect on audit-path tests. Removes the known hang.
3. Re-run the full suite. Only now is a red/green result meaningful.
4. **R3** — widen setup-liveness bounds.
5. **R4** — capability guards on the remaining platform-coupled tests.
6. **R6** — injected-defect check per suite.
7. **R5** — platform column in `baseline.tsv`.
8. **R7** — assertion review.
9. Re-enable the gate: delete `FOREMAN_CI_BATS` and restore the unconditional call.

## The exit criterion

The gate goes back on when the suite **completes** — with a bounded worst case —
on three consecutive runs without operator intervention. Not when it passes.
Passing is necessary; terminating is the property that was actually missing.
