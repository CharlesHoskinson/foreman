# Positive-control record — 2026-08-06

Produced at commit `5fa45124b33fb287336094db154cda1357e852f4`.

A registry row is only meaningful if the check it names was actually observed
producing the **negative** answer on its known-bad arm and the **positive**
answer on its known-good arm **in the same run**. This file is that
observation for the two rows in `tests/positive-control-registry.tsv`.

## Why a control is required at all

The measured failure this machinery exists to catch, from 2026-07-28: an
unanchored `violation` substring predicate was checked against the string
`[ok] No violation found`. It matched. The predicate reported a violation on
clean output exactly as it did on dirty output — it classified both arms
identically and stayed green for weeks. A check that cannot fail is not
coverage, and no amount of passing runs distinguishes it from one that works.

## Row 1 — `tests/lib/positive-control.bash::assert_positive_control`

- known-bad input: `tests/fixtures/positive-control/unanchored-bad.txt`
  (`ERROR: violation at line 3`)
- known-good input: `tests/fixtures/positive-control/unanchored-good.txt`
  (`[ok] No violation found`)

Three arms were run against the helper in one invocation:

| Arm | Predicate under control | Expected | Observed |
|---|---|---|---|
| 1 | unanchored `grep -q 'violation'` | rejected | **rejected** — `DOES NOT DISCRIMINATE -- known-bad and known-good both exited 1` |
| 2 | anchored `grep -qE '^ERROR.*violation'` | accepted | **accepted** |
| 3 | nonexistent known-bad path | refused | **refused** — `known_bad_input does not exist` |

`SELFTEST_RESULT: 0 failures`

Arm 1 is the load-bearing one: it reproduces the 2026-07-28 defect and shows
the helper rejecting it. Arm 3 matters because a control that silently skips
when its fixture is missing degrades to no control at all.

## Row 2 — `tests/lib/check-inventory.sh::check-inventory`

- known-bad input: `tests/fixtures/positive-control/empty-tree` (a tree with no
  checks in it)
- known-good input: `tests/fixtures/positive-control/minimal-tree` (one bats
  `@test`)

| Arm | Expected | Observed |
|---|---|---|
| empty tree | non-zero exit, `inventory-empty` | **non-zero**, `inventory-empty` |
| minimal tree | exit 0, one row | **exit 0**, `tests/sample.bats::a sample check` |

The empty arm is the one worth stating plainly: an empty inventory must fail
with `inventory-empty` rather than report "no unregistered checks". A green
build over an empty inventory carries no coverage information, and reporting it
as success is how a coverage claim becomes a lie.

## Scope of what these two rows attest

They attest to the machinery, not to the repository's checks. At this commit
the full-repository inventory holds **773** members across four kinds:

| kind | members | enforced |
|---|---:|---|
| assertion | 727 | no |
| gate | 21 + machinery | yes |
| verdict-predicate | 16 | no |
| probe | 9 | yes |

Enforcement covers `gate` and `probe`. The other two kinds are inventoried and
reported but do not fail the build. Demanding a control fixture for 727 bats
assertions on day one would replace the release with a fixture-authoring
program — the outcome the owner ruled against when choosing a gate-scoped
registry over repo-wide mutation testing.

Everything enforced but not yet controlled is listed in
`tests/positive-control-todo.tsv`. That file only shrinks. A check in neither
the registry nor the todo file **fails the build**, which is the property the
whole mechanism exists for: a new gate added without a control cannot land
quietly.

## Known grammar gaps

The recognizer is not exhaustive and must never be described as such.

- The first implementation omitted `tests/run.sh` as a gate source even though
  the spec names it. The skip-budget check was therefore invisible. Caught by
  the spec's own four-check acceptance fixture, and closed.
- The first implementation scored 15 real checks as bodiless because it looked
  for assertion *helpers*. Bats runs under errexit, so a bare `grep -q` or
  `jq -e` **is** the assertion; `telemetry.bats "known-bad: zero-cost
  unavailable must not be produced by tl_usage_block"` asserts five times that
  way and calls no helper. Closed by treating any executable line as an
  assertion.
- Linear scripts declare no functions, so a function-scoped sweep inventories
  nothing for them. This hid `gate-eval.sh` and thirteen verdict-parsing
  scripts including `merge-gate.sh`. Closed by falling back to the script name.

Each of these was a silent under-count found by running the tool against the
real tree. A predicate reachable only through a wrapper this grammar does not
recognise is still not covered.
