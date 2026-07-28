# Spec delta — test infrastructure

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.
Header shape follows the OpenSpec CLI's parseable form (see
`lock-primitive-hardening/tasks.md` T8 for the repo-wide conformance debt).

## ADDED Requirements

### Requirement: an unmet precondition skips with a reason, and never fails

A test SHALL declare the platform, privilege, tool and build preconditions it
needs, and the harness SHALL skip it with a stated reason when they are unmet.

IF a test requires a platform the host is not (Windows dialect on Linux, or
POSIX-only behaviour on Git-Bash), THEN it SHALL skip naming the required
platform, and SHALL NOT report a failure.
IF a test requires a tool absent from the host, THEN it SHALL skip naming the
tool and the install instruction.
IF a test requires an unprivileged user and `EUID` is 0, THEN it SHALL skip
naming the privilege requirement.
IF a test requires a build artefact that is absent, THEN it SHALL either
trigger the build or skip naming the artefact and the build command.
A skipped test SHALL state its reason in the TAP output; a bare skip with no
reason SHALL be treated as a failure.

#### Scenario: Windows-dialect tests skip on Linux instead of failing

- WHEN the suite runs on WSL/Linux and reaches a test asserting Windows pueue
  `.exe` quoting, backslashed `LANE_CONFIG_DIR` normalisation, or the
  `taskkill //T` grandchild sweep
- THEN each test skips with a reason naming the required platform
- AND the suite's failure count is unaffected by them.

#### Scenario: a root-only environment skips permission-based injection

- WHEN the suite runs as root and reaches a test that induces failure by
  removing write permission
- THEN the test skips with a reason naming the non-root requirement
- AND it does not report a pass.

#### Scenario: a missing build artefact is named, not mistaken for a defect

- WHEN the suite runs on a clone where `launcher/dist` has never been built
  and reaches a test resolving the committed launcher binary
- THEN the test skips naming `launcher/dist` and the `build:posix` command,
  or the harness builds it first
- AND the test does not fail as though the launcher were broken.

### Requirement: skips are budgeted so coverage cannot erode silently

Each test file SHALL declare, per platform, the number of its tests that may
legitimately skip.

WHEN the suite finishes, the runner SHALL compare actual skips against the
declared budget for the running platform.
IF the actual skip count for a file exceeds its declared budget, THEN the run
SHALL fail, naming the file and the excess.
IF a file's actual skip count is persistently below its budget, THEN the
runner SHALL report the slack so the budget can be tightened.
The runner SHALL print total pass, fail and skip counts, and SHALL NOT report
success on a run whose skip total exceeds the global budget.

#### Scenario: converting a failure into a skip is caught

- WHEN a test that previously ran is annotated with a precondition that makes
  it skip on the CI platform, pushing its file over budget
- THEN the run fails naming that file and the excess
- AND the failure is attributable to the coverage loss, not to a product
  defect.

### Requirement: a slice regression fails the run regardless of the aggregate

The runner SHALL record per-file pass/fail/skip counts and compare them
against a committed baseline.

WHEN a test file's pass count falls below its baseline, THEN the run SHALL
fail naming that file, even WHILE the aggregate pass rate remains within
normal variation.
The baseline SHALL be a committed artefact, updated deliberately as part of a
change, and SHALL NOT be regenerated automatically from a failing run.

#### Scenario: a subsystem breaking entirely is caught despite a flat aggregate

- WHEN one test file's tests all fail while the other 32 files pass, moving
  the aggregate by only a few percent
- THEN the run fails naming the regressed file
- AND the report shows the per-slice delta, not only the total.

### Requirement: unit tests depend on no live vendor, network, or credential

A test in the unit tier SHALL NOT require vendor authentication, network
access, or a live model call.

WHERE a code path probes live vendor readiness, the unit test SHALL stub the
probe.
IF a test genuinely requires a live vendor, THEN it SHALL be tagged as an
integration test and SHALL be excluded from the default run.

#### Scenario: the grok readiness probe is stubbed in unit tests

- WHEN the grok-lane and vendor-isolation unit tests run on a host with no
  grok authentication and no network
- THEN they pass or skip on a declared precondition
- AND no test invokes `grok models`.

### Requirement: timing tests are deterministic under load

A test SHALL NOT depend on wall-clock timing that a loaded host can perturb.

WHERE a test asserts stall, heartbeat or phase-threshold behaviour, it SHALL
drive the injectable clock rather than sleeping.
IF a test is observed to pass in isolation and fail under parallel load, THEN
it SHALL be treated as a defective test and either made deterministic or
quarantined with a tracking note — it SHALL NOT be left in the default run.

#### Scenario: a load-sensitive test is made deterministic

- WHEN the suite runs on a host under heavy concurrent load
- THEN tests asserting sequence monotonicity and stall transitions produce the
  same verdict as on an idle host.

### Requirement: the suite runs in CI on both supported platforms

CI SHALL run the bats suite on `ubuntu-latest` and on `windows-latest` under
`shell: bash`.

The CI job SHALL publish the per-slice report as a build artefact.
IF the suite fails on either platform, THEN the job SHALL fail.
The Windows job SHALL exercise the Git-Bash fallback paths that the Linux job
cannot reach.

#### Scenario: a Linux-only regression is caught by the Windows job

- WHEN a change passes on `ubuntu-latest` but breaks a Git-Bash fallback path
- THEN the `windows-latest` job fails naming the affected slice.

### Requirement: the test suite proves it can detect the defects it claims to

The repo SHALL provide a regression-injection harness that seeds known defects
and asserts the owning slice detects each one.

WHEN the injection harness runs, it SHALL report, per seeded defect, whether
the owning slice failed.
IF a seeded defect does not cause its owning slice to fail, THEN the harness
SHALL report that slice as providing no protection for that defect class.
The harness SHALL be runnable on demand and SHALL NOT be part of the default
suite.

#### Scenario: a test that cannot fail is exposed

- WHEN the injection harness seeds a defect that the owning slice is supposed
  to cover, and the slice still passes
- THEN the harness reports that defect class as unprotected
- AND names the slice that was expected to catch it.

### Requirement: a check is trusted only after it has been observed failing

Every gate, probe, assertion or verdict predicate introduced by this release
SHALL be demonstrated to FAIL against a known-bad input before it is relied on.

WHEN a new check is added, the change SHALL supply a positive control: an input
the check is required to reject, and evidence that it did reject it.
IF a check has never been observed failing, THEN it SHALL NOT be cited as
evidence that the property it names holds — a check that cannot fail and a
check that passes are indistinguishable from their output.
The positive control SHALL exercise the predicate, not merely the surrounding
plumbing: a control that would also be rejected by a check with the wrong
predicate provides no discrimination.
WHERE the check is a comparison against a control arm, the control arm SHALL be
shown to produce the opposite classification in the same run.

#### Scenario: a checker that classifies every run as failing is exposed

- WHEN a pass/fail predicate is added and is run against one input it must
  reject and one it must accept
- THEN it classifies them differently
- AND a predicate that classifies both identically is rejected before use.

#### Scenario: an unanchored substring predicate is caught by its control arm

- WHEN a predicate searches for `violation` anywhere in checker output that
  reads `[ok] No violation found` on success
- THEN the positive control arm, which is known to hold, is classified as
  violated
- AND the discrepancy fails the check's own acceptance rather than being
  reported as a result.

#### Scenario: a gate added without a positive control does not merge

- WHEN a change introduces a new gate or probe and supplies no evidence of it
  failing against a known-bad input
- THEN the change is rejected naming the check
- AND the check is not counted as coverage.

### Requirement: a success predicate binds to an artifact and its content

A lane, gate or check SHALL determine success from the artifact it was required
to produce and from that artifact's content, and SHALL NOT determine success
from a process exit code, an unanchored substring match, or an agent's own
account of its state.

WHEN a lane completes, its success predicate SHALL assert the deliverable
exists and that its content satisfies the stated criteria.
IF an exit code and the artifact disagree, THEN the artifact SHALL decide.
The predicate SHALL NOT accept a model's or a script's self-report of
completion as evidence of completion.
WHERE output is parsed for a verdict, the predicate SHALL match an anchored
outcome token and SHALL treat output matching no known token as an ERROR,
never as a pass.
This generalises the artifact-binding rule `three-outcome-verdicts` applies to
`audit-verdict.json` to every lane and every check in the release.

#### Scenario: a lane that exits 0 having written nothing is a failure

- WHEN a headless lane exits 0 with a completion message and its required
  deliverable does not exist
- THEN the lane is recorded as failed naming the missing artifact
- AND the exit code is not cited as evidence of success.

#### Scenario: an agent's self-report is not evidence

- WHEN a lane reports that its work is complete and its own existence check
  for the deliverable printed absent
- THEN the harness records the lane as failed
- AND the self-report is retained as context, not as a verdict.

#### Scenario: unparsable checker output is an error, not a pass

- WHEN a checker crashes or changes its output format so no known outcome token
  appears
- THEN the result is recorded as ERROR naming the check
- AND the run does not report success.

### Requirement: an assertion that holds vacuously is reported as vacuous, not as a pass

WHERE an invariant, assertion or gate condition holds because its precondition
was never reached, or because the state it constrains never changed during the
scenario under test, the harness SHALL report it as vacuous rather than as a
pass.

WHEN an assertion passes, the harness SHALL where practicable report whether
its precondition was reached and whether the state it constrains varied.
IF an assertion is satisfied without its precondition ever being reached, THEN
it SHALL be reported as vacuous and SHALL NOT count toward the coverage of the
property it names.
WHERE full vacuity detection is impractical for a given check, the positive
control SHALL be required instead, and the check SHALL NOT be trusted without
one — an untestable-for-vacuity check with no positive control provides no
evidence at all.
A predicate observed to be vacuous for a stated property SHALL be recorded, with
the property that actually tests it, so the same predicate is not reused for the
same purpose.

#### Scenario: an invariant that is trivially true in the failure it targets is caught

- WHEN a property bounding a counter is used to test a loop in which that
  counter never advances
- THEN the check is reported as vacuous for that property
- AND the conclusion drawn from it is withdrawn rather than published.

#### Scenario: a check with no vacuity detection requires a positive control

- WHEN a new assertion cannot practically be instrumented for precondition
  reachability
- THEN it is accepted only with a positive control demonstrating it failing
  against a known-bad input
- AND without one it is not counted as coverage.

### Requirement: a result that would change a release decision is corroborated independently

WHERE a check's result would change a release decision — shipping, blocking, or
declaring a defect fixed or refuted — it SHALL be corroborated by at least one
independent check using a different predicate, a different mechanism, or a
different actor.

WHEN a corroborating check disagrees with the primary result, the release
decision SHALL be held and the discrepancy resolved before either result is
reported.
The corroborating check SHALL NOT share the primary check's predicate: two runs
of the same wrong predicate agree with each other and establish nothing.
IF no independent corroboration is available, THEN the result SHALL be reported
with that limitation stated, and SHALL NOT be described as verified.
Cross-checking is required because it is the only mechanism that has actually
worked: on 2026-07-28 four checks in one session returned confident wrong
answers — an unanchored `violation` substring predicate, a vacuously-true
counter bound, a bounded run against the wrong step function, and an audit lane
whose success predicate was its exit code — and **none was caught by the check
itself.** Every one was caught by comparison against an independent result.

#### Scenario: a fix that appears to have failed is checked against a second predicate

- WHEN a check reports that a remedy failed, and a second check with a
  different predicate reports that it held
- THEN the release decision is held until the discrepancy is resolved
- AND neither result is published as verified in the meantime.

#### Scenario: an uncorroborated result is reported as uncorroborated

- WHEN a result that would change a release decision has no independent
  corroboration available
- THEN it is reported with that limitation stated
- AND it is not described as verified.

## MODIFIED Requirements

### Requirement: installing the skill leaves the repository clean

`install.sh:61-63` sets the exec bit on scripts in the repo working tree,
leaving every installed clone permanently dirty under `core.filemode=true`.

The installer SHALL NOT modify tracked files in the repository working tree.
WHERE the exec bit is required, it SHALL be carried in the git index (owned by
`crlf-extensionless-hardening`) rather than applied at install time.
WHEN `install.sh` completes on a clean clone, `git status --porcelain` SHALL
be empty.

#### Scenario: running Foreman on Foreman is not poisoned by the installer

- WHEN `install.sh` runs against a clean clone
- THEN `git status --porcelain` is empty afterwards
- AND the dirty-guards in `wt-cleanup`, `resume` and `wt-merge` see a clean
  tree.
