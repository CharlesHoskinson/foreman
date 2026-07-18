# Change: test-harness fork-tax reduction

## Why

On the MSYS2 / Git-Bash CI host each `fork+exec` of an external program costs
~100 ms. The bats suite pays this tax thousands of times over because several
per-test and per-source operations spawn external processes that compute
**host-constant** or **already-known** facts. Cutting those spawns shortens the
suite wall-clock with **zero change to what any test verifies** — same repos,
same isolation, same wrapper behavior, only fewer processes.

This change consolidates the coverage-neutral, test-only speedups that survived
adversarial audit (`~/.foreman/runs/dl2d/perf/R2-testharness-audit.md`):

- **B#1** — the jq-CRLF probe in `tests/helpers.bash` re-runs (`jq` + `od`) on
  every one of ~122 file sourcings. Memoize it to a run-scoped flag file.
- **B#2 (half-1)** — `setup_tmp_repo` rebuilds a throwaway git repo (`git init`
  - 2 commits, ~10 spawns) per test. Build it **once per file** into
  `BATS_FILE_TMPDIR` and `cp -r` it per test.
- **B#3** — `SCRIPTS="$(cd … && pwd)"` forks a subshell in every `setup` purely
  to canonicalize an already-absolute path. Replace with a plain assignment.
- **A** — two `lane-run.bats` kill tests inherit the default `LANE_KILL_GRACE=5`
  and burn ~5 real seconds each; pin `LANE_KILL_GRACE=1` (~4 s saved each).

## What changes

- Modify `tests/helpers.bash`: memoize the jq-CRLF probe (B#1); rewrite
  `setup_tmp_repo` to a per-file template + `cp -r` and drop the `cd&&pwd`
  subshell (B#2-half1 + B#3).
- Modify `tests/lane-run.bats`: drop the `cd&&pwd` subshell in `setup()` (B#3);
  add `export LANE_KILL_GRACE=1` to the `sweep_failed` and `sweep_unavailable`
  tests (A).
- Modify `tests/checkpoint.bats`, `tests/resume.bats`,
  `tests/durable-preflight.bats`, `tests/eventlog.bats`,
  `tests/nats-bridge.bats`: drop the `cd&&pwd` subshell in `setup()` (B#3).

**No production code changes. No `tests/run.sh` change. No new dependencies.**

## Out of scope (deferred to v0.2.5)

- **B#2 half-2** — converting the inline `git init` setups in
  checkpoint/resume/lane-run to a shared template helper. Deferred: the committed
  base-file content differs per file (`base` vs `x`, and `resume` asserts on it),
  and it would add churn to `lane-run.bats`, which this change already edits for A.
  Clean mechanical follow-up.
- **All of D (fast/slow tagging)** — tags have no consumer until the v0.2.5
  per-round gate wiring lands (`run.sh` injects no filter today), so they deliver
  no v0.2.0 wall-clock benefit. They belong with that wiring.
- **`watch.bats` B#3 one-liner** — excluded to avoid colliding with the in-flight
  WATCH_VTICK edit to the same `setup()` block; fold into WATCH_VTICK or apply
  after it merges.

## Impact

- Affected: `tests/helpers.bash`, `tests/lane-run.bats`, `tests/checkpoint.bats`,
  `tests/resume.bats`, `tests/durable-preflight.bats`, `tests/eventlog.bats`,
  `tests/nats-bridge.bats`.
- Risk: low. Every edit is coverage-neutral (argued per-file in `design.md`).
  Verification is the existing suite staying green plus before/after `time`.
