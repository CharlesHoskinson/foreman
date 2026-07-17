# Change: el_emit spawn reduction

## Why

On the MSYS2 / Git-Bash host, every `fork+exec` of an external program costs
~100 ms and is ~10–30× a Linux fork (each spawn is a full Windows-PE process
creation). `el_emit` (`skills/foreman/scripts/lib/eventlog.sh`) is the single
most-called function in the durable-lanes harness: one call per `prompt`,
`heartbeat`, `checkpoint`, `round_done`, and `alert`, per lane, for the whole
run — thousands of calls per real run and per test suite.

Several external spawns on `el_emit`'s happy path compute a value that a bash
builtin can produce with **zero** spawns and **byte-identical** output. Removing
them shortens every emit with **no change to the emitted event-log format,
sequence numbering, mutex, or CAS semantics** — the event log is the source of
truth for durable lanes, so byte-for-byte preservation is the hard requirement.

This change bundles the four reductions that survived adversarial audit
(`~/.foreman/runs/dl2d/perf/R2-el-emit-audit.md`, derived from the investigation
`~/.foreman/runs/dl2d/perf/C-hotpath-spawns.md`):

- **F1** — replace the `printf | tr -d '\r'` CR-strip pipeline with the
  parameter-expansion `${raw//$'\r'/}` (removes a `tr` exec + a pipe subshell +
  a `printf` builtin per emit).
- **F2** — replace `$(cat "$seqf" …)` with an existence-guarded
  `$(<"$seqf")` (removes a `cat` exec + a `$( )` fork per emit; bash special-
  cases `$(<file)` to read in-process). This is inside the mutex, so it also
  shortens lock-hold time.
- **F3** — guard the per-emit `mkdir -p "$rd"` with `[[ -d "$rd" ]] ||` (removes
  a `mkdir` exec on the common path where the dir already exists).
- **F4** — inline `run_dir` as `rd="$FOREMAN_HOME/runs/$run"` (removes a subshell
  fork per emit; precedent: `watch.sh:184` already inlines this path).

## What changes

- Modify **one function**, `el_emit`, in
  `skills/foreman/scripts/lib/eventlog.sh` (F1–F4). No other function changes.
- `run_dir` (`common.sh:37`) is **not** modified; `el_init`, `el_read`, and the
  `el_cursor_*` helpers are **not** modified.

**No change to the emitted JSON, field set, field values, line ordering, the
`.seq` reservation (tmp+rename CAS), or the `mkdir`/`rmdir` seq mutex.**

## Out of scope (deferred to v0.2.5)

- **F5** — `date -u` → `printf '%(…)T'` for the `ts` field. Correct on-host but
  it rewrites a serialized output field that consumers parse (`watch.sh` feeds
  `ts` to `date -d`); it needs its own cross-platform (WSL / Git Bash) test
  before it can claim byte-identity as a guarantee. Not a pure internal spawn
  cut. Deferred, not rejected.
- **F6** — `checkpoint.sh` git plumbing. Every git spawn is a distinct
  load-bearing tree/CAS step; none collapse without changing snapshot or CAS
  semantics. No safe lever.

## Impact

- Affected code: `skills/foreman/scripts/lib/eventlog.sh` (`el_emit` only).
- Affected tests (guards, unchanged): `tests/eventlog.bats`, `tests/lane-run.bats`.
- Net: happy-path external execs on `el_emit` drop **7 → 4** (`mkdir` lock,
  `jq`, `mv`, `rmdir` remain — all required), plus two forks removed.
- Risk: low. Byte-identical event-log output; verification is the existing
  `eventlog.bats` + `lane-run.bats` suites (which assert the emitted JSON)
  staying green.
