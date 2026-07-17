# Spec — test-harness fork-tax reduction (EARS)

Capability: the Foreman bats test harness. These requirements constrain the
test-support code (`tests/helpers.bash` and per-file `setup`) only. Production
scripts under `skills/foreman/scripts/**` MUST NOT change.

## Requirement: jq-CRLF probe is computed at most once per run

The harness SHALL determine whether the host's `jq` emits CRLF at most once per
`bats` run and reuse the cached decision for all subsequent test sourcings.

- WHEN `helpers.bash` is sourced and `jq` is not on `PATH`, the harness SHALL NOT
  define the `jq` wrapper (unchanged from today).
- WHILE the run-scoped CRLF flag file already exists, WHEN `helpers.bash` is
  re-sourced, the harness SHALL read the decision with a shell builtin and spawn
  no external process for the probe.
- WHERE the host's `jq` emits CRLF, the harness SHALL define the CR-stripping `jq`
  wrapper exactly as before; WHERE it does not (or `jq` is broken/absent), the
  harness SHALL leave `jq` unwrapped.
- The probe SHALL NOT spawn `od`.

### Scenario: repeated sourcing spawns the probe once

- GIVEN a run of the full suite on a CRLF-emitting jq host
- WHEN every helper-loading test file is sourced n+1 times
- THEN the `jq -c .` probe process is spawned at most once for the whole run
- AND the CR-stripping `jq` wrapper is active in every helper-loading test
- AND every jq-parsing assertion passes exactly as before the change

### Scenario: jq absent leaves jq unwrapped

- GIVEN a host with no `jq` on `PATH`
- WHEN `helpers.bash` is sourced
- THEN no `jq` wrapper function is defined (identical to prior behavior)

## Requirement: per-test git repo is copied from a per-file template

WHEN `setup_tmp_repo` is called, the harness SHALL provision each test an
independent, fully-mutable git repository copied from a template built once per
test file, without invoking `git init`/`git commit` per test.

- The harness SHALL build the template once into `BATS_FILE_TMPDIR` (guarded by a
  directory-existence check) and `cp -r` it into `BATS_TEST_TMPDIR` per test.
- Each per-test repo SHALL be independently committable and share no inode with
  the template or any sibling test's repo.
- The template SHALL carry the same default branch (`main`), committer identity,
  neutralized hooks, seed `README.md`, and copied `.markdownlint-cli2.jsonc` /
  `.codespellrc` fixtures as the prior per-test build.
- The public contract (`REPO`, `SCRIPTS`, `FOREMAN_HOME` exported) SHALL be
  unchanged so existing callers need no edits.

### Scenario: two tests get isolated repos

- GIVEN two tests in one file that both call `setup_tmp_repo`
- WHEN each commits different content into its `$REPO`
- THEN neither commit is visible in the other test's repo
- AND both tests pass exactly as before the change

## Requirement: SCRIPTS is assigned without a subshell

The harness SHALL set `SCRIPTS` to `"$BATS_TEST_DIRNAME/../skills/foreman/scripts"`
by plain assignment, without a `$(cd … && pwd)` subshell.

- This applies in `tests/helpers.bash` and in the `setup()` of `lane-run.bats`,
  `checkpoint.bats`, `resume.bats`, `durable-preflight.bats`, `eventlog.bats`, and
  `nats-bridge.bats`.
- IF `watch.bats` is concurrently modified by WATCH_VTICK, THEN this change SHALL
  NOT edit `watch.bats` (its one-liner is folded into WATCH_VTICK instead).

### Scenario: scripts still resolve and run

- GIVEN a test whose `setup` assigns the non-canonicalized `SCRIPTS`
- WHEN the test invokes `bash "$SCRIPTS/<script>.sh"` or sources `"$SCRIPTS/lib/…"`
- THEN the script runs and resolves its own directory correctly
- AND every assertion passes exactly as before the change

## Requirement: kill-escalation tests use a bounded grace of 1 second

WHEN the `sweep_failed` and `sweep_unavailable` `lane-run.bats` tests drive
`kill_cmd_bounded`, they SHALL set `LANE_KILL_GRACE=1` instead of inheriting the
default 5.

- The KILL escalation SHALL still fire (the CMD ignores TERM and outlives the
  grace), and the folded single-alert assertions (`payload.sweep` and
  `payload.tree_kill`) SHALL still hold deterministically.
- The production default `LANE_KILL_GRACE=5` SHALL NOT change.

### Scenario: sweep_failed still emits exactly one sweep_failed alert

- GIVEN the `sweep_failed` test with `LANE_KILL_GRACE=1` and a TERM-ignoring CMD
- WHEN the test sends TERM to `lane-run.sh` after `cmd-started`/`cmd-pid` appear
- THEN `kill_cmd_bounded` waits ~1 s, escalates to KILL, and emits exactly one
  `alert` with `payload.sweep == "sweep_failed"` and
  `payload.tree_kill == "best_effort"`
- AND the test completes ~4 s faster than at grace 5
