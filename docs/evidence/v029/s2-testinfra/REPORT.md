# T1 + T2 implementation report

Date: 2026-07-29  
Worktree: `/root/fm-wt/s2-testinfra`  
Scope: `test-infrastructure-hardening` T1 and T2 only

No graph was generated or rebuilt. No commit was created. T3 and later tasks
were not implemented.

## Delivered

- `tests/lib/preconditions.bash`
  - `require_platform`
  - `require_tool`
  - `require_non_root`
  - `require_built`
  - `require_no_live_vendor`
  - shdoc on every function
- `tests/run.sh`
  - runs selected Bats files as separate slices under the host-wide mutex
  - parses anchored TAP result lines
  - records pass/fail/skip and bare-skip counts per file
  - compares exact file/platform skip budgets and exact file pass baselines
  - reports budget slack
  - atomically emits a machine-readable TSV report
  - defaults to `TEST_GATE_MODE=shadow`; `TEST_GATE_MODE=enforce` gates the
    new policy verdicts
  - continues to exit non-zero for actual Bats failures in both modes
  - never regenerates either committed policy file
- `tests/baseline.tsv`
  - 33 exact file rows, 382 expected passes
- `tests/skip-budget.tsv`
  - 33 files × `linux`, `wsl`, and `windows` = 99 exact rows
  - initial T1/T2 budgets are zero; T3 owns annotations and the corresponding
    platform budget updates
- `tests/fixtures/test-infrastructure/` and
  `tests/selftest-test-infrastructure.sh`
  - known-good and known-bad inputs for all mandatory T1/T2 controls
  - the harness accumulates failures and exits non-zero if any case fails
- `openspec/changes/test-infrastructure-hardening/tasks.md`
  - T1 and T2 boxes marked complete; no later boxes changed

No baseline regeneration command was added. Therefore there is no automatic
or failing-run path that can rewrite `tests/baseline.tsv`.

## Test-first negative observations

### T1 before implementation

Command:

```bash
bash tests/selftest-test-infrastructure.sh preconditions
```

Actual output before `tests/lib/preconditions.bash` existed:

```text
SELFTEST FAIL: precondition helpers: expected exit 0, got 1
SELFTEST FAIL: require_platform reason: missing output: requires platform fixture-platform
SELFTEST FAIL: require_tool reason: missing output: requires tool foreman-fixture-tool; install with: install foreman-fixture-tool
SELFTEST FAIL: require_non_root reason: missing output: requires a non-root user
SELFTEST FAIL: require_built reason: missing output: requires built artefact
SELFTEST FAIL: require_built command: missing output: build with: npm run build:fixture
SELFTEST FAIL: require_no_live_vendor reason: missing output: requires no live foreman-fixture-vendor process
SELFTEST RESULT: FAIL (7 case(s))
observed_exit=1
```

### T2 before implementation

Command:

```bash
env FOREMAN_BATS_MUTEX_HELD=1 \
  TEST_GATE_MODE=enforce \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-within.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-within.tsv \
  TEST_SLICE_REPORT="$t2_red_dir/report.tsv" \
  timeout 2 bash tests/run.sh \
  tests/fixtures/test-infrastructure/reasoned-skip.bats
```

Actual artifact check against the old runner:

```text
RED CHECK EXPECTED FAIL: per-slice report absent (runner_exit=1)
```

The negative check itself exited 1.

## Mandatory verification evidence

### T1 helper reasons

Command:

```bash
flock "$HOME/.foreman/gate.lock" \
  bats --formatter tap \
  tests/fixtures/test-infrastructure/preconditions.bats
```

Actual output:

```text
1..5
ok 1 require_platform names the unmet platform # skip requires platform fixture-platform; current platform is wsl
ok 2 require_tool names the missing tool and install command # skip requires tool foreman-fixture-tool; install with: install foreman-fixture-tool
ok 3 require_non_root names the privilege requirement when root # skip requires a non-root user; rerun the test as an unprivileged user
ok 4 require_built names the missing artefact and build command # skip requires built artefact /tmp/.../missing-dist; build with: npm run build:fixture
ok 5 require_no_live_vendor names the live vendor # skip requires no live foreman-fixture-vendor process; stop foreman-fixture-vendor before running this test
command_exit=0
```

### 1. Bare skip without a reason is a failure

Command:

```bash
env TEST_GATE_MODE=enforce \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-bare.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-bare.tsv \
  TEST_SLICE_REPORT="$evidence_dir/report.tsv" \
  bash tests/run.sh tests/fixtures/test-infrastructure/bare-skip.bats
```

Actual output:

```text
ok 1 bare skip is invalid # skip
FAIL bare skip without reason: tests/fixtures/test-infrastructure/bare-skip.bats count=1
FAIL skip budget: tests/fixtures/test-infrastructure/bare-skip.bats actual=1 budget=0 excess=1
SLICE tests/fixtures/test-infrastructure/bare-skip.bats platform=wsl pass=0 fail=0 skip=1 bare_skip=1 budget=0 slack=-1 baseline=0 delta=0 test=FAIL budget_verdict=FAIL baseline_verdict=PASS
RESULT FAIL mode=enforce policy_failures=2
command_exit=1
```

### 2. Reasoned skip within budget passes and is reported

Command:

```bash
env TEST_GATE_MODE=enforce \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-within.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-within.tsv \
  TEST_SLICE_REPORT="$evidence_dir/report.tsv" \
  bash tests/run.sh tests/fixtures/test-infrastructure/reasoned-skip.bats
```

Actual human output:

```text
ok 1 ordinary pass
ok 2 reasoned skip is auditable # skip requires fixture capability; install with fixture-setup
SLICE tests/fixtures/test-infrastructure/reasoned-skip.bats platform=wsl pass=1 fail=0 skip=1 bare_skip=0 budget=1 slack=0 baseline=1 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS
RESULT PASS mode=enforce
command_exit=0
```

Actual machine report:

```text
file	platform	pass	fail	skip	bare_skip	skip_budget	budget_slack	baseline	pass_delta	test_verdict	budget_verdict	baseline_verdict	skip_reasons
tests/fixtures/test-infrastructure/reasoned-skip.bats	wsl	1	0	1	0	1	0	1	0	PASS	PASS	PASS	requires fixture capability; install with fixture-setup
```

### 3. Skip budget excess fails and names the file and budget

Command:

```bash
env TEST_GATE_MODE=enforce \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-within.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-over.tsv \
  TEST_SLICE_REPORT="$evidence_dir/report.tsv" \
  bash tests/run.sh tests/fixtures/test-infrastructure/reasoned-skip.bats
```

Actual output:

```text
FAIL skip budget: tests/fixtures/test-infrastructure/reasoned-skip.bats actual=1 budget=0 excess=1
SLICE tests/fixtures/test-infrastructure/reasoned-skip.bats platform=wsl pass=1 fail=0 skip=1 bare_skip=0 budget=0 slack=-1 baseline=1 delta=0 test=PASS budget_verdict=FAIL baseline_verdict=PASS
RESULT FAIL mode=enforce policy_failures=1
command_exit=1
```

### 4. Per-file pass regression fails and names actual and baseline

Command:

```bash
env TEST_GATE_MODE=enforce \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-below.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-within.tsv \
  TEST_SLICE_REPORT="$evidence_dir/report.tsv" \
  bash tests/run.sh tests/fixtures/test-infrastructure/reasoned-skip.bats
```

Actual output:

```text
FAIL pass baseline: tests/fixtures/test-infrastructure/reasoned-skip.bats actual=1 baseline=2 deficit=1
SLICE tests/fixtures/test-infrastructure/reasoned-skip.bats platform=wsl pass=1 fail=0 skip=1 bare_skip=0 budget=1 slack=0 baseline=2 delta=-1 test=PASS budget_verdict=PASS baseline_verdict=FAIL
RESULT FAIL mode=enforce policy_failures=1
command_exit=1
```

### 5. Aggregate blindness is fixed

Command:

```bash
env TEST_GATE_MODE=enforce \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-aggregate.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-aggregate.tsv \
  TEST_SLICE_REPORT="$evidence_dir/report.tsv" \
  bash tests/run.sh \
  tests/fixtures/test-infrastructure/healthy-slice.bats \
  tests/fixtures/test-infrastructure/regressed-slice.bats

awk -F '\t' 'NR > 1 {
  pass += $3
  total += $3 + $4 + $5
}
END {
  printf "independent_aggregate_check: pass=%d total=%d rate=%.2f%% threshold=95%% verdict=%s\n",
    pass, total, 100 * pass / total,
    (100 * pass / total >= 95 ? "PASS" : "FAIL")
}' "$evidence_dir/report.tsv"
```

Actual output:

```text
SLICE tests/fixtures/test-infrastructure/healthy-slice.bats platform=wsl pass=32 fail=0 skip=0 bare_skip=0 budget=0 slack=0 baseline=32 delta=0 test=PASS budget_verdict=PASS baseline_verdict=PASS
FAIL pass baseline: tests/fixtures/test-infrastructure/regressed-slice.bats actual=0 baseline=1 deficit=1
SLICE tests/fixtures/test-infrastructure/regressed-slice.bats platform=wsl pass=0 fail=0 skip=1 bare_skip=0 budget=1 slack=0 baseline=1 delta=-1 test=PASS budget_verdict=PASS baseline_verdict=FAIL
TOTAL pass=32 fail=0 skip=1 tests=33 bare_skip=0 platform=wsl
RESULT FAIL mode=enforce policy_failures=1
independent_aggregate_check: pass=32 total=33 rate=96.97% threshold=95% verdict=PASS
command_exit=1
```

The aggregate threshold accepts the run, while the owning slice rejects it.

### 6. Shadow reports; enforce gates

Combined over-budget and below-baseline shadow command:

```bash
env TEST_GATE_MODE=shadow \
  TEST_BASELINE_FILE=tests/fixtures/test-infrastructure/policy/baseline-below.tsv \
  TEST_SKIP_BUDGET_FILE=tests/fixtures/test-infrastructure/policy/skip-over.tsv \
  TEST_SLICE_REPORT="$evidence_dir/report.tsv" \
  bash tests/run.sh tests/fixtures/test-infrastructure/reasoned-skip.bats
```

Actual output:

```text
FAIL skip budget: tests/fixtures/test-infrastructure/reasoned-skip.bats actual=1 budget=0 excess=1
FAIL pass baseline: tests/fixtures/test-infrastructure/reasoned-skip.bats actual=1 baseline=2 deficit=1
RESULT SHADOW mode=shadow policy_failures=2 exit=0
command_exit=0
```

Bare-skip shadow actual output:

```text
FAIL bare skip without reason: tests/fixtures/test-infrastructure/bare-skip.bats count=1
FAIL skip budget: tests/fixtures/test-infrastructure/bare-skip.bats actual=1 budget=0 excess=1
RESULT SHADOW mode=shadow policy_failures=2 exit=0
command_exit=0
```

The corresponding enforce runs are items 1, 3, and 4 above; each exited 1.

### 7. The evidence harness itself exits non-zero

Command:

```bash
SELFTEST_FORCE_FAILURE=1 bash tests/selftest-test-infrastructure.sh all
```

Actual output:

```text
SELFTEST FAIL: forced known-bad harness input
SELFTEST RESULT: FAIL (1 case(s))
forced_harness_exit=1
```

Normal command:

```bash
bash tests/selftest-test-infrastructure.sh all
```

Actual output:

```text
SELFTEST RESULT: PASS
selftest_exit=0
```

### 8. Shellcheck

Command:

```bash
shellcheck \
  tests/run.sh \
  tests/lib/preconditions.bash \
  tests/selftest-test-infrastructure.sh
```

Actual output:

```text
shellcheck_exit=0
```

## Real-suite dogfood result

Command:

```bash
TEST_SLICE_REPORT=/tmp/s2-testinfra-full-report.tsv bash tests/run.sh
```

Actual final output:

```text
TOTAL pass=337 fail=30 skip=15 tests=382 bare_skip=0 platform=wsl
REPORT /tmp/s2-testinfra-full-report.tsv
RESULT FAIL test_failures=30
```

The command exited 1. This is not reported as green. Shadow mode defers only
the newly introduced policy failures; it does not suppress actual Bats
failures.

Independent report-content check:

```bash
wc -l /tmp/s2-testinfra-full-report.tsv
awk -F '\t' 'NR > 1 {
  rows++
  pass += $3
  fail += $4
  skip += $5
  bare += $6
}
END {
  printf "rows=%d pass=%d fail=%d skip=%d bare_skip=%d tests=%d\n",
    rows, pass, fail, skip, bare, pass + fail + skip
}' /tmp/s2-testinfra-full-report.tsv
```

Actual output:

```text
34 /tmp/s2-testinfra-full-report.tsv
rows=33 pass=337 fail=30 skip=15 bare_skip=0 tests=382
```

The real-suite failures are pre-existing product, platform, build-artifact,
and test-validity failures that T3 and later packages own. Examples visibly
caught per slice include:

- `tests/eventlog.bats`: 32 pass / 3 fail, baseline deficit 3
- `tests/lane-queue.bats`: 21 pass / 1 fail / 1 skip, budget excess 1,
  baseline deficit 2
- `tests/lane-run.bats`: 30 pass / 1 fail / 2 skip, budget excess 2,
  baseline deficit 3
- `tests/launcher.bats`: 4 pass / 10 skip, budget excess 10,
  baseline deficit 10
- `tests/nats-bridge.bats`: 0 pass / 12 fail, baseline deficit 12
- `tests/wt-cleanup.bats`: 0 pass / 7 fail, baseline deficit 7

I did not alter those tests or their product code because that would exceed
T1/T2.

## Structural checks

Baseline and budget inventory:

```text
baseline_files=33 baseline_sum=382
skip_rows=99 skip_files=33 linux=33 wsl=33 windows=33
Bats count: 382
```

OpenSpec command:

```bash
/usr/local/bin/openspec validate test-infrastructure-hardening --strict
```

Actual output:

```text
Change 'test-infrastructure-hardening' is valid
openspec_exit=0
```

## Blockers and limitations

- The complete repository suite is red on this WSL host: 30 actual failures.
  They remain red by design and are outside T1/T2.
- Initial skip budgets are zero. Existing skips are therefore visible policy
  failures in shadow mode until T3 performs the specified annotation sweep and
  deliberate per-platform budget update.
- Only WSL was available in this worktree session. Linux and Git-Bash/Windows
  policy rows were created, but this round did not fabricate platform-run
  evidence for hosts that were not available.
