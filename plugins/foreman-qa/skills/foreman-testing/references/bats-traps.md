# Bats traps

Detailed mechanics behind the `SKILL.md` running-tests and
assertion-semantics rules.

## The gate mutex

`tests/run.sh` acquires `$HOME/.foreman/gate.lock` via `flock` before
running any file (`acquire_bats_mutex` in `tests/run.sh`), falling back to
an atomic `mkdir` lock when `flock` is unavailable (the Git Bash path).
Running bats directly, outside `tests/run.sh`, still needs the same lock:

```bash
flock /root/.foreman/gate.lock bats --formatter tap tests/watch.bats
```

Two bats runners racing the same host flake timing-sensitive tests --
`tests/watch.bats` and `tests/lane-run.bats` are the ones known to be
sensitive, because both assert on elapsed wall-clock/scheduling behavior.
A concurrent build or agent spawn can flake the same assertions even with
the mutex held, because CPU contention stretches real wall-clock timing
that the mutex does not isolate. Keep the host otherwise quiet while a
gate run is in flight.

## Per-file timeout

`tests/run.sh` runs each file under
`timeout --kill-after=30 ${TEST_FILE_TIMEOUT_S:-600}`. A file that exceeds
600s is sent TERM, then KILL 30s later if it ignores TERM, and is recorded
as `test_verdict=TIMEOUT` in the slice report -- never left to hang. The
comment at that call site in `tests/run.sh` (marked `R1`) documents why:
`tests/decision-events.bats` once hung 31 minutes on a single test while
holding the host-wide mutex, and three unrelated verifications queued
behind it with no output. A gate that can hang forever is worse than no
gate, because silence reads as progress; a bounded timeout converts a
deadlock into an actionable failure.

## Assertion semantics

Every bats test body runs under `errexit` (`set -e` semantics). A bare
command IS the assertion -- nothing else is required:

```bash
@test "known-bad: zero-cost unavailable must not be produced by tl_usage_block" {
  local u
  u="$(tl_usage_block codex gpt-5.6-sol high unavailable 0 0 0 0)"
  jq -e '.source == "unavailable"' <<<"$u" >/dev/null
  jq -e 'has("cost_usd") | not' <<<"$u" >/dev/null
  jq -e 'has("input_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("output_tokens") | not' <<<"$u" >/dev/null
  jq -e 'has("cached_tokens") | not' <<<"$u" >/dev/null
}
```

(`tests/telemetry.bats`.) This test body contains zero bracket tests and
zero `assert_*` calls, yet it makes five real assertions: any one `jq -e`
failing exits non-zero under `errexit` and fails the test. A test-quality
scanner that pattern-matches only for bracket tests or `assert_*` helpers
scores this test, and 14 others like it across the suite, as bodiless.
Measured: such a scan undercounted 15 genuine checks this way, this test
among them.

When you write or review a bats test, `grep -q ...`, `jq -e ... >/dev/null`,
`diff -q ...`, and any other command whose exit code encodes pass/fail is
a complete, sufficient assertion. Do not add a redundant status-code
bracket-test wrapper around it -- it adds nothing under `errexit` and
obscures which line is the actual check.

## Never a bare skip

`skip` with no argument prints a bare `# SKIP` in the TAP output with no
reason, and `tests/run.sh` counts it as a **bare skip** -- a policy
failure on its own, separate from the skip-budget check. Always call
`skip` with a string argument describing what is missing and how to fix
it, never `skip` with no argument at all.

`tests/lib/preconditions.bash` provides these helpers; use them instead
of writing an ad hoc `command -v` check with a bare or vague skip:

- `require_platform PLATFORM` -- skip unless the host is `windows`, `wsl`,
  `linux`, or `posix` (linux or wsl).
- `require_tool NAME [INSTALL_HINT]` -- skip unless `NAME` is on PATH.
- `require_non_root` -- skip when running as root and the test needs
  permission behavior root bypasses.
- `require_built PATH [BUILD_HINT]` -- skip unless a build artefact
  exists.
- `require_no_live_vendor [NAMES...]` -- skip if a named vendor process
  (default `grok`, `codex`, `claude`) is currently running.

## The heredoc test-declaration trap

Never build a `.bats` fixture with a heredoc that puts a literal test
declaration at column 0 in a `.bats` file. Bats parses `.bats` files
line-wise; a test declaration on its own line inside a heredoc reads as a
NEW test and silently breaks the enclosing test that built the fixture.
For example, this is WRONG:

```bash
# WRONG -- bats parses .bats files line-wise; the @test on its own line
# inside this heredoc reads as a NEW test declaration and silently breaks
# the enclosing test.
cat > "$WORK/x.bats" <<'INNEREOF'
@test "a sample check" {
  [ 1 -eq 1 ]
}
INNEREOF
```

Build it with `printf` instead, exactly as `tests/positive-control.bats` does:

```bash
printf '@test "a sample check" {\n  [ 1 -eq 1 ]\n}\n' >"$WORK/min/tests/x.bats"
```

The comment at that call site is the canonical statement of the trap:
"Built with printf, deliberately. A heredoc would put a literal `@test`
at column 0 inside this file, and bats parses .bats line-wise -- it reads
that as a NEW test declaration and silently breaks the enclosing test."
