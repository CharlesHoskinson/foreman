# Tasks — test-harness fork-tax reduction

Apply in this order (disjoint regions; trivial/reversible first). Test-only; no
production code, no `tests/run.sh` change.

## 1. B#3 — drop the `$(cd&&pwd)` SCRIPTS subshell (6 files)

In the `setup()` of each file below, replace
`SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"` with
`SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"`:

- [ ] `tests/lane-run.bats` (line ~8)
- [ ] `tests/checkpoint.bats` (line ~5)
- [ ] `tests/resume.bats` (line ~8)
- [ ] `tests/durable-preflight.bats`
- [ ] `tests/eventlog.bats`
- [ ] `tests/nats-bridge.bats` (line ~64)
- [ ] Do NOT touch `tests/watch.bats` (folded into WATCH_VTICK)

## 2. A — pin `LANE_KILL_GRACE=1` (tests/lane-run.bats)

- [ ] Test `sweep_failed` (~line 356): add `export LANE_KILL_GRACE=1` after
      `export LANE_PROC_ROOT="$proc_root"`
- [ ] Test `sweep_unavailable` (~line 404): add `export LANE_KILL_GRACE=1` after
      the `export LANE_PROC_ROOT="$BATS_TEST_TMPDIR/empty-proc"` / `mkdir -p` block
- [ ] Leave test 186 (`LANE_KILL_GRACE=2`) unchanged

## 3. B#1 — memoize the jq-CRLF probe (tests/helpers.bash)

- [ ] Replace lines 9-13 with the memoized form (run-scoped flag file, `read`
      builtin on the cached path, `od` removed, atomic `mv` publish) per
      `design.md` Edit 1
- [ ] Keep the `command -v jq` guard and the wrapper body byte-identical

## 4. B#2 half-1 + B#3(line 32) — template + `cp -r` (tests/helpers.bash)

- [ ] Rewrite `setup_tmp_repo` (lines 19-34) to build the template once into
      `BATS_FILE_TMPDIR` and `cp -r` per test, with a plain `SCRIPTS=` assignment,
      per `design.md` Edit 2
- [ ] Keep exported names `REPO`, `SCRIPTS`, `FOREMAN_HOME` unchanged (callers
      untouched)

## 5. Verification (run by the orchestrator, NOT during a live gate)

> Do not run bats while another wall-clock-sensitive gate is live on the host.

- [ ] `bash tests/run.sh` exits 0 with the same test count as before
- [ ] Before/after `time bash tests/run.sh tests/lane-run.bats` (A + B#3)
- [ ] Before/after `time bash tests/run.sh tests/checkpoint.bats` (B#3 + B#1)
- [ ] Before/after `time bash tests/run.sh tests/docs-check.bats` (B#2 half-1)
- [ ] Before/after `time bash tests/run.sh tests/maintenance.bats` (B#2 half-1)
- [ ] Confirm every `time` delta is non-positive and no assertion changed

## Deferred to v0.2.5 (not in this change)

- [ ] B#2 half-2 — inline `git init` setups in checkpoint/resume/lane-run → shared
      template helper (base-file content differs per file; overlaps A on lane-run)
- [ ] All of D — fast/slow bats tags (no consumer until the per-round gate wiring)
- [ ] `watch.bats` SCRIPTS one-liner — fold into WATCH_VTICK
