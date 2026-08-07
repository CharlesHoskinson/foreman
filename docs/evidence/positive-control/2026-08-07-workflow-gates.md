# Positive-control record -- 2026-08-07 -- CI workflow gates

Covers four of the fourteen gates listed under `.github/workflows/` in
`tests/positive-control-todo.tsv`: `formal.yml::Classifier self-test (no
models)`, `formal.yml::Run formal suite`, `gates-linux.yml::Run Council
Node 24 gate`, and `gates-linux.yml::Build POSIX launcher`. The other ten
are deferred in the todo file with specific reasons -- see that file's
`reason` column, not this record.

For each gate below, the workflow step's `run:` block delegates to a real,
independently invocable script or binary. Every arm runs that real script or
binary, unmodified, against two committed inputs differing in exactly one
property. No gate logic is reimplemented anywhere in this record. Current
platform: `wsl` (WSL2, Ubuntu).

## Gate 1: `formal.yml::Classifier self-test (no models)`

### Predicate

The step runs `bash formal/run-checks.sh --self-test`. Its core job is to
verify that `classify_output`, the function every other formal-suite row
depends on, tells a real violation from a real non-violation using only the
anchored `^[violation]`/`^[ok]` markers -- never an unanchored substring
match on the word "violation" (the success line is literally "[ok] No
violation found", the exact false-positive shape recorded elsewhere in this
repository's evidence rules). It must reject (classify as VIOLATED) a log
that contains a real anchored violation marker, and accept (classify as
HOLDS) a log that contains a real anchored ok marker.

### Fixture pair

No new fixtures were needed. `formal/fixtures/classifier-violating.txt` and
`formal/fixtures/classifier-holding.txt` are pre-existing, already-committed
fixtures that `run_classifier_controls` (part of `--self-test`) already
reads for its own internal control. They differ in exactly the one property
`classify_output` reads: the anchored marker line.

### Method

`classify_output()`'s literal body was extracted read-only with `sed` from
the live `formal/run-checks.sh` (same technique as the prior tool-check.sh
record) and invoked directly against both fixtures in the same session.

```
sed -n '/^classify_output() {/,/^}/p' formal/run-checks.sh > /tmp/classify_fn.sh
bash -c 'source /tmp/classify_fn.sh; classify_output "$1"' _ formal/fixtures/classifier-violating.txt
bash -c 'source /tmp/classify_fn.sh; classify_output "$1"' _ formal/fixtures/classifier-holding.txt
```

### Known-bad arm (`classifier-violating.txt`)

Verbatim output:
```
VIOLATED
```
NEGATIVE (the real-violation fixture is correctly flagged), as required.

### Known-good arm (`classifier-holding.txt`)

Verbatim output:
```
HOLDS
```
POSITIVE, as required.

## Gate 2: `formal.yml::Run formal suite`

### Predicate

The step runs `bash formal/run-checks.sh --tier "${tier}"`, which executes
real Quint models per `formal/expectations.tsv` and fails the suite when any
row's real, observed classifier outcome does not match that row's recorded
`expected` column. It must reject a manifest row whose `expected` value
disagrees with the model's real, observed behaviour, and accept a row whose
`expected` value agrees with it.

### Fixture pair

`formal/run-checks.sh` has no override seam for `EXPECTATIONS` (unlike
`tests/run.sh`'s `TEST_BASELINE_FILE`), so the real script (an unmodified
copy, not the tracked repo file) was pointed at two committed fixture
manifests by copying the whole `formal/` tree -- specs, fixtures,
`vacuous-predicates.tsv`, `coverage.tsv`, everything `run-checks.sh`
resolves relative to its own `SCRIPT_DIR` -- to a scratch directory and
swapping only `expectations.tsv` there. The real, tracked
`formal/expectations.tsv` was never touched.

`tests/fixtures/workflows/formal-expectations-good.tsv` and
`.../formal-expectations-bad.tsv` are single-row manifests for
`eventlog_concurrency main=toctou mutual_exclusion`, `method=simulation`,
`bound=2000x20` -- this repo's own `eventlog_concurrency.qnt` model
genuinely violates `mutual_exclusion` under the pre-fix `toctou` entrypoint
(this is `formal/expectations.tsv` row 1's real, committed expectation).
The two fixtures differ in exactly the one property `run_manifest` reads,
the `expected` column: the good fixture says `VIOLATED` (matching the
model's real behaviour); the bad fixture says `HOLDS` (deliberately wrong).

### Method

```
rm -rf /tmp/formal-copy
cp -r formal /tmp/formal-copy
cp tests/fixtures/workflows/formal-expectations-bad.tsv /tmp/formal-copy/expectations.tsv
bash /tmp/formal-copy/run-checks.sh --tier commit --row 1
```

### Known-bad arm (expected=HOLDS, deliberately wrong)

Verbatim relevant output:
```
formal: --- row 1: eventlog_concurrency main=toctou mutual_exclusion expect=HOLDS method=simulation bound=2000x20 ---
formal:   method: simulation bound=2000x20 Quint 0.32.0 — [violation] observed
formal: FAIL: row 1: regression in modelled fix: expected HOLDS (→ HOLDS) but observed VIOLATED
formal:   logfile: /tmp/formal-copy/out/row-1-eventlog_concurrency-mutual_exclusion.log
[violation] Found an issue (83ms at 663 traces/second).
formal: wrote /tmp/formal-copy/out/report.tsv and /tmp/formal-copy/out/report.json
formal: === summary: run=1 matched=0 skipped=0 failures=1 tier=commit ===
formal: SUITE FAILED
```
`EXIT=1`. NEGATIVE, as required.

### Known-good arm (expected=VIOLATED, matches real model behaviour)

Same procedure, fixture swapped to `formal-expectations-good.tsv` against a
fresh copy of `formal/`. Verbatim relevant output:
```
formal: --- row 1: eventlog_concurrency main=toctou mutual_exclusion expect=VIOLATED method=simulation bound=2000x20 ---
formal:   method: simulation bound=2000x20 Quint 0.32.0 — [violation] observed
formal:   MATCH observed=VIOLATED expected=VIOLATED (3s)
formal: wrote /tmp/formal-copy/out/report.tsv and /tmp/formal-copy/out/report.json
formal: === summary: run=1 matched=1 skipped=0 failures=0 tier=commit ===
formal: SUITE PASSED
```
`EXIT=0`. POSITIVE, as required.

## Gate 3: `gates-linux.yml::Run Council Node 24 gate`

### Predicate

The step runs, in `components/council`: `pnpm install --frozen-lockfile`,
`pnpm check`, then `openspec validate --all --strict --no-interactive`.
`pnpm check`'s first sub-step is `prettier --check`, using the project's
own `.prettierrc.json` (`singleQuote: false`). The gate must reject a file
that violates the project's real Prettier config and accept one that
conforms to it.

### Fixture pair

`tests/fixtures/workflows/council-prettier-bad.ts` and
`.../council-prettier-good.ts` are byte-identical except for the one
property Prettier's `singleQuote: false` rule reads -- quote style:
`export const greeting = 'hello';` (bad, single quotes) vs
`export const greeting = "hello";` (good, double quotes).

### Method

Invoked the real `prettier` binary from `components/council`'s own
`node_modules` (`corepack pnpm exec`) with the project's own committed
config, against each fixture path, in the same session.

```
cd components/council
corepack pnpm exec prettier --config .prettierrc.json --check ../../tests/fixtures/workflows/council-prettier-bad.ts
corepack pnpm exec prettier --config .prettierrc.json --check ../../tests/fixtures/workflows/council-prettier-good.ts
```

### Known-bad arm

Verbatim output:
```
Checking formatting...
[warn] ../../tests/fixtures/workflows/council-prettier-bad.ts
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```
`RC=1`. NEGATIVE, as required.

### Known-good arm

Verbatim output:
```
Checking formatting...
All matched files use Prettier code style!
```
`RC=0`. POSITIVE, as required.

As independent corroboration that the real gate (not just its first
sub-step) is sound on this tree, `corepack pnpm check` was also run
end-to-end, unmodified, against the real committed council tree in the same
session: 39 test files / 1126 tests passed, lint/typecheck/format/build/test
all green, `RC=0`.

## Gate 4: `gates-linux.yml::Build POSIX launcher`

### Predicate

The step runs, from `launcher/`: `bun build --compile
--target=bun-linux-x64 --no-compile-autoload-dotenv
--no-compile-autoload-bunfig src/launch.ts --outfile dist/foreman-launch`,
then asserts the output is executable. It must reject a TypeScript entry
file Bun's bundler cannot parse, and accept the real, committed entry point.

### Fixture pair

`tests/fixtures/workflows/launcher-build-bad.ts` is deliberately unparsable
TypeScript (an unclosed parameter list). `launcher/src/launch.ts`, the
real, already-committed entry point, is the known-good arm unmodified --
reusing the real target is stronger provenance than a synthetic "good"
copy would be.

### Method

The literal `bun build --compile` invocation from the workflow step, run
against each entry file in the same session (`--outfile` redirected to a
scratch path so neither arm touches the tracked `launcher/dist/`, which is
gitignored build output).

```
bun build --compile --target=bun-linux-x64 --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  tests/fixtures/workflows/launcher-build-bad.ts --outfile /tmp/launcher-bad-out
bun build --compile --target=bun-linux-x64 --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  launcher/src/launch.ts --outfile /tmp/launcher-good-out
```

### Known-bad arm

Verbatim output:
```
4 |   return 1
             ^
error: Expected "}" but found "1"
    at .../tests/fixtures/workflows/launcher-build-bad.ts:4:10

4 |   return 1
              ^
error: Expected ")" but found end of file
    at .../tests/fixtures/workflows/launcher-build-bad.ts:4:11
```
`EXIT=1`, no output file produced (`/tmp/launcher-bad-out` absent). NEGATIVE, as required.

### Known-good arm

Verbatim output:
```
  [47ms]  bundle  5 modules
[1343ms] compile  /tmp/launcher-good-out
```
`EXIT=0`, `/tmp/launcher-good-out` present and executable (`-rwxr-xr-x`,
94595200 bytes). POSITIVE, as required.

## What this demonstrates

All four gates were exercised as the real script or binary the workflow step
actually invokes, unmodified, against two committed inputs differing in
exactly the one property each predicate reads, in live sessions immediately
before this record was written. The remaining ten gates in this task's scope
are deferred in `tests/positive-control-todo.tsv` with reasons specific to
each: inline provisioning that would mutate this shared host's global state,
a step with no assertion capable of failing, orchestration whose full
reproduction would read other concurrently-running lanes' worktrees, and
steps whose predicate requires an actual `windows-latest` runner this
WSL/Linux worktree cannot reach.
