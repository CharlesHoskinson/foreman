# Positive-control record -- 2026-08-08

Covers the three `tests/run.sh` gates left in `tests/positive-control-todo.tsv`
after W0: `validate_baseline_file`, `validate_skip_budget_file`, and
`lookup_skip_budget`. Each is demonstrated by running `tests/run.sh` twice
against the same fixture test file, `tests/fixtures/policy/trivial.bats`,
varying only the one datum the gate under test actually reads and holding
every other seam constant. Current platform on the host that produced this
record: `wsl`.

## Gate 1: `validate_baseline_file`

### Predicate

Reads only the first line of `BASELINE_FILE` and requires it to equal
exactly `file<TAB>platform<TAB>expected_passes`; row content is never
inspected by this function. On any other header text, or a missing file, it
prints an `ERROR` and returns 2, which `tests/run.sh` treats as a hard exit
before any Bats file runs (`validate_baseline_file || exit $?`, tests/run.sh
line 216 in this tree).

### Fixture pair

`tests/fixtures/policy/baseline-header-bad.tsv` vs
`tests/fixtures/policy/baseline-header-good.tsv`. The body rows are
byte-identical (three platform rows for `trivial.bats`); the only difference
is the header line: the bad fixture keeps the pre-platform-keying two-column
header (`file<TAB>expected_passes`), the good fixture carries the current
three-column header. `TEST_SKIP_BUDGET_FILE` is held constant at
`tests/fixtures/policy/skip-budget-platform-good.tsv` (valid, matching row)
in both arms so it cannot contribute a second, confounding failure.

Bad fixture (`baseline-header-bad.tsv`):
```
file	expected_passes
tests/fixtures/policy/trivial.bats	linux	1
tests/fixtures/policy/trivial.bats	wsl	1
tests/fixtures/policy/trivial.bats	windows	1
```

Good fixture (`baseline-header-good.tsv`):
```
file	platform	expected_passes
tests/fixtures/policy/trivial.bats	linux	1
tests/fixtures/policy/trivial.bats	wsl	1
tests/fixtures/policy/trivial.bats	windows	1
```

### Known-bad arm

Command:
```
TEST_BASELINE_FILE=tests/fixtures/policy/baseline-header-bad.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/policy/skip-budget-platform-good.tsv \
  TEST_SLICE_REPORT=/tmp/g1-bad-slices.tsv \
  bash tests/run.sh tests/fixtures/policy/trivial.bats
```

Verbatim output:
```
ERROR baseline header must be: file<TAB>platform<TAB>expected_passes
EXIT=2
```
No Bats file ran; the gate refused before test selection. NEGATIVE, as required.

### Known-good arm

Same command, pointed at `baseline-header-good.tsv`. Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=1 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/g1-good-slices.tsv
RESULT PASS mode=enforce
EXIT=0
```
POSITIVE, as required.

## Gate 2: `validate_skip_budget_file`

### Predicate

Reads only the first line of `SKIP_BUDGET_FILE` and requires it to equal
exactly `file<TAB>platform<TAB>permitted_skips`; row content is never
inspected. On any other header text, or a missing file, it prints an `ERROR`
and returns 2, exiting `tests/run.sh` before any Bats file runs
(`validate_skip_budget_file || exit $?`, tests/run.sh line 217 in this tree).

### Fixture pair

`tests/fixtures/policy/skip-budget-header-bad.tsv` vs
`tests/fixtures/policy/skip-budget-header-good.tsv`. Body row identical
(one `wsl` row); the only difference is the header line, which drops the
`platform` column name in the bad fixture. `TEST_BASELINE_FILE` is held
constant at `tests/fixtures/policy/baseline-header-good.tsv` (valid,
matching row) in both arms.

Bad fixture (`skip-budget-header-bad.tsv`):
```
file	permitted_skips
tests/fixtures/policy/trivial.bats	wsl	0
```

Good fixture (`skip-budget-header-good.tsv`):
```
file	platform	permitted_skips
tests/fixtures/policy/trivial.bats	wsl	0
```

### Known-bad arm

Command:
```
TEST_BASELINE_FILE=tests/fixtures/policy/baseline-header-good.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/policy/skip-budget-header-bad.tsv \
  TEST_SLICE_REPORT=/tmp/g2-bad-slices.tsv \
  bash tests/run.sh tests/fixtures/policy/trivial.bats
```

Verbatim output:
```
ERROR skip-budget header must be: file<TAB>platform<TAB>permitted_skips
EXIT=2
```
NEGATIVE, as required.

### Known-good arm

Same command, pointed at `skip-budget-header-good.tsv`. Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=1 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/g2-good-slices.tsv
RESULT PASS mode=enforce
EXIT=0
```
POSITIVE, as required.

## Gate 3: `lookup_skip_budget`

### Predicate

Given a repository-relative slice key and the current platform, looks for
exactly one row of `SKIP_BUDGET_FILE` (header already validated) whose first
two columns match; sets `POLICY_ERROR="missing skip budget for $key on
$platform"` and returns 1 when no row matches (also rejects duplicates and
non-numeric values). Called per file as `lookup_skip_budget "$key"
"$platform"` (tests/run.sh line 369 in this tree); on failure the slice's
`budget_verdict` becomes `ERROR` and the run counts a policy failure.

### Fixture pair

`tests/fixtures/policy/skip-budget-platform-bad.tsv` vs
`tests/fixtures/policy/skip-budget-platform-good.tsv`, mirroring the
already-registered `lookup_baseline` control. Both have the identical,
valid three-column header, so `validate_skip_budget_file` passes on both
arms; what differs is the row content -- the bad table has a row only for
`nosuchplatform`, the good table has rows for `linux`, `wsl`, and
`windows`. `TEST_BASELINE_FILE` is held constant at
`tests/fixtures/policy/baseline-header-good.tsv` (valid, matching row) in
both arms so it cannot contribute a second, confounding error.

Bad fixture (`skip-budget-platform-bad.tsv`):
```
file	platform	permitted_skips
tests/fixtures/policy/trivial.bats	nosuchplatform	0
```

Good fixture (`skip-budget-platform-good.tsv`):
```
file	platform	permitted_skips
tests/fixtures/policy/trivial.bats	linux	0
tests/fixtures/policy/trivial.bats	wsl	0
tests/fixtures/policy/trivial.bats	windows	0
```

### Known-bad arm

Command:
```
TEST_BASELINE_FILE=tests/fixtures/policy/baseline-header-good.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/policy/skip-budget-platform-bad.tsv \
  TEST_SLICE_REPORT=/tmp/g3-bad-slices.tsv \
  bash tests/run.sh tests/fixtures/policy/trivial.bats
```

Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
ERROR missing skip budget for tests/fixtures/policy/trivial.bats on wsl
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=MISSING slack=UNCOMPUTABLE baseline=1 delta=0 test=PASS budget_verdict=ERROR baseline_verdict=PASS

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/g3-bad-slices.tsv
RESULT FAIL mode=enforce policy_failures=1
EXIT=1
```
`budget_verdict=ERROR`, `policy_failures=1`, `EXIT=1`. NEGATIVE, as required.

### Known-good arm

Same command, pointed at `skip-budget-platform-good.tsv`. Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=1 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/g3-good-slices.tsv
RESULT PASS mode=enforce
EXIT=0
```
`budget_verdict=PASS`, `EXIT=0`. POSITIVE, as required.

## What this demonstrates

All three arms held every seam constant except the one datum the gate under
test reads: a header string for gates 1 and 2, a table row for gate 3. Each
gate refuses on the bad fixture and accepts on the matching good fixture in
the same session, with no other confounding variable changed between arms.
