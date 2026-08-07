# Positive-control record -- 2026-08-07

Produced at commit `be2077034da006a083c3defb46339a93fa0c0fd1`, refreshed
against the corrected registry row on branch `w0/positive-control-fix`.

This is the observation backing the row in
`tests/positive-control-registry.tsv` for `tests/run.sh::lookup_baseline` --
the check_id the repository's own inventory scanner assigns to this
function. `lookup_baseline` is the function this task changed from a
one-argument, platform-blind lookup to a two-argument, platform-keyed one.
That change is now a gate: it can refuse a slice run outright (`missing
pass baseline for <key> on <platform>`). A gate that was never observed
refusing anything is not proven to refuse anything.

## Why the prior version of this record was wrong

The registry row originally named `tests/fixtures/policy/trivial.bats` as
BOTH the known-bad and the known-good input. That cannot demonstrate
discrimination: the fixture under test is a fixed input to `lookup_baseline`
only through the platform-baseline TABLE, not through the `.bats` file
itself. Varying the `.bats` file (which this row did not even do -- it
named the identical path twice) changes nothing `lookup_baseline` reads.
The actual discriminator is the CONTENT of the pass-baseline table: whether
it carries a row for the running platform.

This record replaces that row's known_bad_input / known_good_input with two
real, committed fixture tables:

- `tests/fixtures/policy/baseline-platform-bad.tsv` -- a baseline table with
  the correct three-column header but no row for any real platform (only
  `nosuchplatform`).
- `tests/fixtures/policy/baseline-platform-good.tsv` -- a baseline table
  with rows for `linux`, `wsl`, and `windows`, so the lookup succeeds on any
  host.

## The two arms

Both arms run `tests/run.sh` against the same fixture test file,
`tests/fixtures/policy/trivial.bats`, through the documented
`TEST_BASELINE_FILE` / `TEST_SKIP_BUDGET_FILE` / `TEST_SLICE_REPORT` seams.
What differs between the arms is the baseline table content
(`TEST_BASELINE_FILE`), which is exactly what distinguishes "platform
absent" from "platform present" as a condition. The skip-budget table is
held constant across both arms, with a valid `wsl` row, so it cannot
contribute a second, confounding error. Current platform on the host that
produced this record: `wsl`.

### Known-bad arm: `tests/fixtures/policy/baseline-platform-bad.tsv`

Fixture content:
```
file	platform	expected_passes
tests/fixtures/policy/trivial.bats	nosuchplatform	1
```

Command (skip.tsv is a throwaway temp file with one valid `wsl` row, held
constant across both arms):
```
WORK=$(mktemp -d)
printf 'file\tplatform\tpermitted_skips\ntests/fixtures/policy/trivial.bats\twsl\t0\n' > "$WORK/skip.tsv"
TEST_BASELINE_FILE=tests/fixtures/policy/baseline-platform-bad.tsv \
  TEST_SKIP_BUDGET_FILE="$WORK/skip.tsv" \
  TEST_SLICE_REPORT="$WORK/slices-bad.tsv" \
  bash tests/run.sh tests/fixtures/policy/trivial.bats
```

Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
ERROR missing pass baseline for tests/fixtures/policy/trivial.bats on wsl
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=MISSING delta=UNCOMPUTABLE test=PASS budget_verdict=PASS baseline_verdict=ERROR

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/tmp.JffQvJzAhB/slices-bad.tsv
RESULT FAIL mode=enforce policy_failures=1
EXIT=1
```
`baseline_verdict=ERROR`, `policy_failures=1`, `EXIT=1`. The error names both
the key and the platform, exactly as `lookup_baseline` sets `POLICY_ERROR`.
NEGATIVE, as required.

### Known-good arm: `tests/fixtures/policy/baseline-platform-good.tsv`

Fixture content:
```
file	platform	expected_passes
tests/fixtures/policy/trivial.bats	linux	1
tests/fixtures/policy/trivial.bats	wsl	1
tests/fixtures/policy/trivial.bats	windows	1
```

Same command, pointed at this baseline table (same skip.tsv construction).
Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=1 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/tmp.4v6TCi44sk/slices-good.tsv
RESULT PASS mode=enforce
EXIT=0
```
`baseline_verdict=PASS`, `EXIT=0`. POSITIVE, as required.

## What this demonstrates

Same fixture test file, same skip-budget content, two runs, differing only
in the pass-baseline table: absent-platform refuses with a named key and
platform; present-platform passes. The predicate discriminates on the input
it actually reads -- the baseline table -- not on an input it ignores. This
supersedes the 2026-08-07 record that preceded it, which named the same
`.bats` file as both known-bad and known-good and could not, by
construction, demonstrate discrimination.
