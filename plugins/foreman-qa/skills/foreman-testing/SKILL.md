---
name: foreman-testing
description: Use when running, extending, or debugging the Foreman bats suite - covers the gate mutex, baseline and skip-budget ratchets, positive controls, and bats assertion semantics.
---

# foreman-testing

Operational rules for running and extending the Foreman bats suite
(`tests/*.bats`, driven by `tests/run.sh`). Every rule here was learned by
something breaking; follow them exactly, do not rediscover them.

## Running tests

Run everything through `tests/run.sh`, or take the mutex yourself:

```bash
flock /root/.foreman/gate.lock bats --formatter tap tests/some.bats
# or, for the full policy-aware run:
tests/run.sh
```

- **A raw `flock ... bats ...` wrapper can deadlock** on files that shell
  out to `tests/run.sh` themselves (`tests/test-policy.bats` does):
  `tests/run.sh`'s own mutex is reentrant via an exported
  `FOREMAN_BATS_MUTEX_HELD`, but a bare outer `flock` never sets it, so
  the nested call blocks on a lock its own parent holds. Prefer
  `bash tests/run.sh <files>`. Full mechanism: `references/bats-traps.md`.
- **Exactly one bats runner at a time, host-wide.** `tests/run.sh` takes
  `$HOME/.foreman/gate.lock` via `flock` before running anything (falls
  back to an atomic `mkdir` lock when `flock` is unavailable). Concurrent
  runs flake the timing-sensitive tests, notably `tests/watch.bats` and
  `tests/lane-run.bats`.
- **Keep the host quiet during a gate run.** A concurrent build or agent
  spawn can flake the VTICK fake-clock timing assertions in `watch.bats`
  even while the mutex is held, because CPU contention stretches the real
  wall-clock scheduling slack those assertions bound.
- **Per-file timeout is 600s** (`TEST_FILE_TIMEOUT_S`, `--kill-after=30`).
  A file that hangs is killed and recorded as `TIMEOUT` in the slice
  report rather than left to hang the host. See
  `references/bats-traps.md` for why this exists.

## Assertion semantics -- the biggest trap

Bats runs every test body under `errexit`. A **bare command's exit status
is a complete assertion** -- `grep -q pattern file` and a `jq -e` filter
piped to `/dev/null` each fail the test on their own if they exit
non-zero. No `assert_*` helper or bracket-test wrapper is required or
implied. A test-quality scanner that only recognizes bracket tests or
`assert_*` calls as "real checks" undercounts real checks. Full detail
and a measured example: `references/bats-traps.md`.

- **Never write a bare `skip`.** Always `skip "reason"`. Use the
  `require_*` helpers in `tests/lib/preconditions.bash`
  (`require_platform`, `require_tool`, `require_non_root`, `require_built`,
  `require_no_live_vendor`) -- each skips with an actionable reason instead
  of a bare one.
- **Never put a literal `@test` at column 0 inside a heredoc** in a
  `.bats` file. Bats parses `.bats` files line-wise; a heredoc-embedded
  `@test` reads as a new test declaration and silently breaks the
  enclosing test. Build such fixtures with `printf` instead -- see
  `references/bats-traps.md`.

## Ratchets: baseline and skip-budget

`tests/baseline.tsv` (one expected pass count per file) and
`tests/skip-budget.tsv` (permitted skips per file x platform, platform is
`linux|wsl|windows`) are edited **deliberately**, never regenerated from a
run. Adding a new `.bats` file requires one `tests/baseline.tsv` row and
three `tests/skip-budget.tsv` rows (one per platform) -- `tests/run.sh`
errors on a file missing either. Full mechanics:
`references/gate-and-ratchets.md`.

- Raising a baseline **tightens** it -- correct when a file legitimately
  gained tests.
- Lowering a baseline is a **regression** and needs justification.
- Host-dependent counts are real (`tests/nats-bridge.bats` needs
  `nats-server`/`nats` on PATH; CI installs pinned versions). Do not "fix"
  a baseline to match an incomplete environment -- install the dependency
  instead.

## Gate mode: shadow vs enforce

`tests/run.sh` defaults `TEST_GATE_MODE=shadow`. In shadow mode,
skip-budget, pass-baseline, and bare-skip failures do **not** affect exit
status -- a run can print `RESULT ERROR runner_errors=1` and still exit 0.
**Never read the exit code alone; read the `RESULT` and `TOTAL` lines.**
Enforcing the gate (`TEST_GATE_MODE=enforce`) is tag criterion 2 and
requires the suite to complete on three consecutive runs first.

## Controls: proving a check discriminates

A check that only passes on known-good input proves nothing alone -- a
hard-wired `exit 0` would pass too. `tests/lib/positive-control.bash`
proves a check answers differently on a known-bad and a known-good input
in the same run; a check that classifies both arms identically is
rejected. `tests/lib/check-inventory.sh` sweeps the whole tree (never a
diff) into `tests/.check-inventory.tsv`; every `check_id` must appear in
`tests/positive-control-registry.tsv` or the shrinking
`tests/positive-control-todo.tsv`, or the build fails.
`tests/inject-regressions.sh` seeds known defects into an isolated
`git archive HEAD` copy -- the working tree is never mutated -- and
asserts the owning slice fails for each. Full detail:
`references/gate-and-ratchets.md`.

## Style

Markdown here must satisfy `markdownlint-cli2` per the repo's
`.markdownlint-cli2.jsonc`: no consecutive blank lines (MD012), fenced
code blocks carry a language, headings are surrounded by blank lines,
single trailing newline.
