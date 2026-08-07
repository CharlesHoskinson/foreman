# Gate mode and ratchets

Detailed mechanics behind the `SKILL.md` ratchets, gate-mode, and controls
rules.

## baseline.tsv and skip-budget.tsv

Headers are validated exactly by `tests/run.sh` (`validate_baseline_file`,
`validate_skip_budget_file`):

```text
tests/baseline.tsv:     file<TAB>expected_passes
tests/skip-budget.tsv:  file<TAB>platform<TAB>permitted_skips
```

`platform` is one of `linux`, `wsl`, `windows`
(`tests/lib/preconditions.bash`, `preconditions_platform`). Both files are
looked up by exact match on the repo-relative file key (`lookup_baseline`,
`lookup_skip_budget`); a missing or duplicate row is a policy failure with
an actionable message ("missing pass baseline for ...", "duplicate skip
budget for ... on ...").

**Adding a new `.bats` file requires:**

- one row in `tests/baseline.tsv`
- three rows in `tests/skip-budget.tsv`, one per platform (`linux`,
  `wsl`, `windows`)

Skip either and `tests/run.sh` reports a policy failure for that file (an
`ERROR` verdict on the missing side: `budget_verdict=ERROR` or
`baseline_verdict=ERROR` in the slice report).

Both files are committed and edited by hand when a file's test count
changes for a real reason -- never regenerated from a run's observed
counts. Treat a proposed edit to either file the way you would treat a
schema migration:

- **Raising a baseline number tightens the ratchet.** Correct when the
  file legitimately gained passing tests.
- **Lowering a baseline number is a regression** -- it means fewer tests
  pass than before. It needs a stated reason, such as a test being
  deliberately removed, not "the suite got worse and this hides it."
- **Host-dependent counts are real, not bugs to paper over.**
  `tests/nats-bridge.bats` requires `nats-server` and `nats` (the NATS
  CLI) on PATH -- its `setup()` skips every test in the file with the
  reason "nats-server/nats not installed" when either is missing. CI
  installs pinned versions (`nats-server` v2.14.4, `nats` CLI v0.4.0; see
  `.github/workflows/gates-linux.yml`, step "Install NATS test
  dependencies"). If your host lacks them, install `nats-server` and
  `nats` rather than editing `tests/baseline.tsv` or
  `tests/skip-budget.tsv` to accept an incomplete run -- that hides the
  gap instead of fixing it.

## Gate mode: shadow vs enforce

`tests/run.sh` reads `TEST_GATE_MODE`, default `shadow`. The two modes
differ only in whether **policy failures** (skip-budget excess, baseline
deficit, bare skips) affect the process exit code. A real test failure
(`fail_count > 0`) or a runner error (unparsable TAP, a `TIMEOUT`) affects
the exit code in both modes.

In shadow mode a run can print `RESULT ERROR runner_errors=1` or
`RESULT SHADOW mode=shadow policy_failures=N` and still exit 0. **Do not
gate any automation on the bare exit code** -- read the printed `RESULT`
line and the `TOTAL pass=... fail=... skip=... tests=... bare_skip=...`
line instead; both are printed on every run regardless of mode.

`.github/workflows/gates-linux.yml` deliberately keeps `TEST_GATE_MODE`
unset (shadow), with the comment that enforcing it is tag criterion 2 and
requires three consecutive green runs. Do not flip the default to
`enforce` until that bar is met.

## Positive and negative controls

Two complementary control mechanisms already exist in this repo; use them
rather than hand-rolling a check-quality test.

### Positive controls: does the check discriminate?

`tests/lib/positive-control.bash` provides `assert_positive_control` and
`assert_positive_control_token`. Both run the check under test against a
known-bad input and a known-good input in the same invocation, and reject
unless the two arms disagree. A check that returns the same verdict on
both arms is rejected even if one arm happens to carry the expected exit
code -- passing the good arm alone proves nothing, since a hard-wired
success exit code would pass it too.

The motivating incident, documented in the helper's own header comment:
an unanchored substring predicate for the word "violation" matched the
string "[ok] No violation found", so it reported a violation on both
clean and dirty output. It stayed green for weeks because nothing ever
exercised a known-bad arm in the same run as a known-good one.

Usage contract:

```bash
assert_positive_control "$check_id" "$known_bad" "$known_good" -- "$check_command"
```

Both arms must differ in the property the check actually reads, not
merely in name or path. A registry row for
`tests/run.sh::lookup_baseline` once named the same fixture,
`tests/fixtures/policy/trivial.bats`, as both `known_bad_input` and
`known_good_input` -- the exact defect this mechanism exists to catch,
committed into the mechanism itself. `lookup_baseline` reads the
pass-baseline *table*, not the `.bats` file path, so naming the same file
twice could not have demonstrated discrimination no matter which file
was named. The fix replaced both arms with baseline tables that differ
in the one property the function reads -- one omits a row for the
running platform, one carries it
(`docs/evidence/positive-control/2026-08-07-baseline-platform.md`).
Naming two different files is not sufficient; the difference has to
reach the code path the check exercises.

### The inventory and the registry

`tests/lib/check-inventory.sh` sweeps the whole repository tree at the
commit under test -- never a diff -- and writes
`tests/.check-inventory.tsv` (derived, uncommitted). `check_id` is
`<repo-relative path>::<check name>`. A diff-scoped sweep would silently
omit every check the diff did not touch, which is exactly what would let
an unregistered gate pass as covered.

Every `check_id` the inventory finds must appear in one of two committed
files:

- `tests/positive-control-registry.tsv` -- checks that already have a
  positive control, with columns `check_id`, `kind`, `known_bad_input`,
  `known_good_input`, `control_record`, `demonstrated_at`.
- `tests/positive-control-todo.tsv` -- a shrinking ratchet of checks that
  do not have one yet, with columns `check_id`, `kind`, `reason`.

A check in neither file fails the build (`tests/lib/check-registry-compare.sh`).
Moving a row from the todo file to the registry is progress; adding a new
row to the todo file for a genuinely new, not-yet-controlled check is
acceptable -- shrinking the todo file over time is the goal.

### Negative controls: does the SUITE catch a real defect?

`tests/inject-regressions.sh` is the complementary check at the suite
level: positive controls prove one check can tell good from bad input;
this proves the suite can tell good from bad implementation. It seeds
known defects into an isolated `git archive HEAD` extraction in a temp
directory -- the working tree is never touched, so an interrupted run
cannot leave a seeded defect behind -- and asserts the owning test slice
fails for each seeded defect. Any seeded defect whose owning slice stays
green is reported as an UNPROTECTED DEFECT CLASS and fails the script.

## A TIMEOUT slice's counts are partial, not a result

The runner wraps each file in a 600 second timeout. A file that hangs is killed
and scored `TIMEOUT`, and the pass, fail and skip numbers it reports describe
**how far it got before it died** — not what the file does.

Measured case. `tests/nats-bridge.bats` holds 12 tests, all `slow`-tagged, all
skipping from one `setup()` when `nats-server` is absent:

- With `nats-server` installed: `pass=12 fail=0 skip=0`, baseline 12, delta 0.
- Without it, in a run where the file hung: `pass=0 fail=0 skip=4`,
  `delta=-12`, verdict `TIMEOUT`, budget `FAIL`, baseline `FAIL`.

Reading that `skip=4` as "four tests skip on this host" is wrong twice over:
the file has twelve, and the four is simply where the clock ran out.

So: never lower a baseline to match a TIMEOUT slice, and never quote its counts
as a host characteristic. Fix the hang or install the missing dependency, then
re-measure. CI installs `nats-server` at a pinned version for exactly this
reason.
