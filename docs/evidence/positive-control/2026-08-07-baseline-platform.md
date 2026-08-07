# Positive-control record -- 2026-08-07

Produced at commit `be2077034da006a083c3defb46339a93fa0c0fd1`.

This is the observation backing the new row in
`tests/positive-control-registry.tsv` for `tests/run.sh::lookup_baseline` --
the check_id the repository's own inventory scanner assigns to this
function, which is what `tests/positive-control-todo.tsv` had been carrying
it under as an undemonstrated enforced gate. The demonstration itself is the
third `@test` in `tests/test-policy.bats`, "a platform absent from the
baseline is an actionable error", reproduced by hand below. It exists for
the same reason the 2026-08-06 record does: a registry row is only
meaningful if the check it names was actually watched producing the
negative answer on its known-bad arm and the positive answer on its
known-good arm.

## Why this control is required

`lookup_baseline` is the function this task changed from a one-argument,
platform-blind lookup to a two-argument, platform-keyed one. That change is
now a gate: it can refuse a slice run outright (`missing pass baseline for
<key> on <platform>`). A gate that was never observed refusing anything is
not proven to refuse anything -- this record is that observation, both arms,
same fixture, same commit.

## The two arms

Both arms run `tests/run.sh` against the same fixture file,
`tests/fixtures/policy/trivial.bats`, through the documented
`TEST_BASELINE_FILE` / `TEST_SKIP_BUDGET_FILE` / `TEST_SLICE_REPORT` seams.
What differs is the baseline table content, not the fixture -- which is
exactly what distinguishes "platform absent" from "platform present" as a
condition. Current platform on the host that produced this record: `wsl`.

### Known-bad arm: baseline row for a platform that does not match the host

baseline.tsv:
```
file	platform	expected_passes
tests/fixtures/policy/trivial.bats	nosuchplatform	1
```

Command:
```
TEST_BASELINE_FILE=.../baseline.tsv TEST_SKIP_BUDGET_FILE=.../skip.tsv \
  TEST_SLICE_REPORT=.../slices.tsv \
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
REPORT /tmp/pc-evidence.2GbHT4/slices.tsv
RESULT FAIL mode=enforce policy_failures=1
```
`EXIT=1`. `baseline_verdict=ERROR`, and the error message names both the key
and the platform, exactly as `lookup_baseline` sets `POLICY_ERROR`.

### Known-good arm: baseline rows for all three platforms, including the host's

baseline.tsv:
```
file	platform	expected_passes
tests/fixtures/policy/trivial.bats	linux	1
tests/fixtures/policy/trivial.bats	wsl	1
tests/fixtures/policy/trivial.bats	windows	1
```

Same command, pointed at this baseline. Verbatim output:
```
=== tests/fixtures/policy/trivial.bats ===
1..1
ok 1 trivial: passes
SLICE tests/fixtures/policy/trivial.bats platform=wsl pass=1 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=1 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS

TOTAL pass=1 fail=0 skip=0 tests=1 bare_skip=0 platform=wsl
REPORT /tmp/pc-evidence.2GbHT4/slices2.tsv
RESULT PASS mode=enforce
```
`EXIT=0`. `baseline_verdict=PASS`.

## What this demonstrates

Same fixture, same commit, two runs: absent-platform refuses with a named
key and platform; present-platform passes. The predicate discriminates. This
is also, verbatim, what `tests/test-policy.bats`'s own third `@test` checks
on every run of the suite -- this record is a standalone, hand-run
reproduction of that same test's two arms, captured once for the registry.
