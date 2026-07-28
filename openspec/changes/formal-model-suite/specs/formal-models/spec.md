# Spec delta — formal model suite

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Header shape follows the OpenSpec CLI's parseable form
(`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), per
`lock-primitive-hardening/tasks.md` T8.

## ADDED Requirements

### Requirement: the models typecheck in CI against a pinned toolchain

The three Quint models in `formal/specs/` — `lane_lifecycle.qnt`,
`eventlog_concurrency.qnt` and `audit_gate.qnt` — SHALL typecheck on every CI
run, against a recorded and pinned checker version.

WHEN the formal suite runs, it SHALL execute a typecheck for each model file
and SHALL fail the run IF any model does not typecheck.
The pinned versions SHALL be recorded as committed artefacts — today Quint
0.32.0 and Apalache 0.56.1, the versions under which every result in
`formal/reports/VERIFY-quint-architect.md` was obtained.
IF the resolved checker version differs from the pinned version, THEN the run
SHALL fail naming both versions, and SHALL NOT report a verdict obtained from
an unrecorded checker.
WHERE the checker is resolved through a version manager — on the reference box
`quint` resolves through an `fnm` multishell path that does not survive a new
shell — the job SHALL resolve it through a stable pinned path and SHALL fail
loudly IF that path is absent, rather than silently skipping the suite.

#### Scenario: a model that stops typechecking fails the build

- WHEN a change edits `audit_gate.qnt` and introduces a type error
- THEN the formal suite fails naming the file and the checker version
- AND no invariant result is reported for that model.

#### Scenario: an absent checker is a failure, not a skip

- WHEN the formal suite runs on a host where the pinned Quint binary is not at
  its recorded path
- THEN the run fails naming the expected path and the pinned version
- AND the run does not report success on the strength of having checked
  nothing.

### Requirement: every modelled defect is asserted to violate before the fix and to hold after it

The suite SHALL be driven by a committed expectation manifest whose rows each
name a model, a configuration, an invariant or witness, and the expected
outcome (VIOLATED or HOLDS).

WHEN the suite runs, it SHALL execute every row and compare the observed
outcome against the expected outcome.
IF a row expected to VIOLATE is observed to hold, THEN the run SHALL fail and
SHALL report that the model has lost its discriminating power — this is the
primary failure the suite exists to detect.
IF a row expected to HOLD is observed to violate, THEN the run SHALL fail and
SHALL report a regression in the modelled fix.
A row SHALL NOT be deleted or flipped to make the suite green; changing an
expected outcome SHALL be an explicit, reviewed edit to the manifest carried by
a change that explains it.

#### Scenario: a pre-fix configuration that stops violating fails the build

- WHEN someone edits `eventlog_concurrency.qnt` such that the `toctou`
  configuration no longer violates `mutual_exclusion`
- THEN the run fails naming the model, the configuration and the invariant
- AND the report states that the model no longer reproduces the defect it was
  written to reproduce.

#### Scenario: a regression in a modelled fix is caught

- WHEN a change to the audit-gate model causes `post_fix` to violate
  `no_stale_approved_merge`
- THEN the run fails naming that row
- AND the failure is attributed to the fix configuration, not to the pre-fix
  arm.

#### Scenario: the manifest cannot be silently relaxed

- WHEN a change flips an expected outcome from VIOLATED to HOLDS without a
  stated reason in the owning change
- THEN review rejects the change
- AND the manifest row retains its recorded provenance.

### Requirement: the manifest carries the architect-reproduced inventory

The expectation manifest SHALL be seeded with the inventory reproduced by the
architect on 2026-07-28 and recorded in
`formal/reports/VERIFY-quint-architect.md`.

For `eventlog_concurrency`: `toctou`/`mutual_exclusion` VIOLATED,
`toctou`/`seq_uniqueness` VIOLATED, `atomic`/`mutual_exclusion` HOLDS,
`atomic`/`seq_uniqueness` HOLDS.
For `audit_gate`: `pre_fix`/`no_stale_approved_merge` VIOLATED,
`pre_fix`/`no_unaudited_merge` VIOLATED, `post_fix`/both HOLDS;
`uncapped_errors`/`audit_attempts_bounded_by_three` VIOLATED,
`capped_errors`/`audit_attempts_bounded_by_three` HOLDS;
`post_fix`/`no_unverified_checks_merge` VIOLATED,
`post_fix`/`no_unverified_docs_merge` VIOLATED,
`post_fix_full_binding`/`no_unverified_checks_merge` HOLDS.
For `lane_lifecycle`: `init_prefix`/`step_prefix` VIOLATED against
`inv_round_done_requires_fresh_report` and against
`inv_no_completion_from_exit_code`;
`init_postfix`/`step_postfix_without_resume` HOLDS against
`inv_round_done_requires_fresh_report`;
`init_postfix`/`step_shipped_resume_bug` REACHABLE for
`witness_shipped_resume_loses_round_ownership`, and
`init_postfix`/`step_postfix` NOT REACHABLE for the same witness.
Each row SHALL record the entrypoint actually used. A result obtained from a
model's default `init`/`step` SHALL NOT be recorded against a named
configuration — the architect's first M1 assessment was wrong precisely because
the default entrypoint aliases the post-fix configuration.
WHERE a result was reported by a lane but not reproduced by the architect — the
M2 fail-open, compaction, NATS-token and lock-ordering findings, and the M3
gate-to-merge TOCTOU, merge-freshness, `WARNING`-authorises-merge and
cross-vendor-gateway findings — the row SHALL be marked unreproduced and SHALL
NOT gate the build until it has been re-run independently.

#### Scenario: the inventory CI asserts is the inventory that was measured

- WHEN the manifest is first committed
- THEN every gating row corresponds to a result reproduced by the architect and
  recorded in `VERIFY-quint-architect.md`
- AND every lane-reported but unreproduced result is present as a non-gating
  row marked unreproduced.

#### Scenario: a result from a default entrypoint is not credited to a named configuration

- WHEN a run is invoked without an explicit `--init`/`--step` entrypoint
- THEN the harness refuses to record the outcome against a named pre-fix or
  post-fix configuration
- AND reports which entrypoint was actually exercised.

### Requirement: a verdict is read from the checker's outcome line, never from a substring

The harness SHALL classify a checker run by matching the anchored outcome line
it emits, and SHALL NOT classify it by searching for a substring anywhere in
the output.

WHEN classifying a Quint run, the harness SHALL match `^\[violation\]` for a
violation and `^\[ok\]` for a clean result.
The harness SHALL NOT use an unanchored search for `violation`: Quint prints
`[ok] No violation found` on success, which contains that substring, so an
unanchored predicate reports every run — including every control arm — as
violated. This was measured on 2026-07-28 and briefly appeared to show the
`flock` remedy failing.
IF the output matches neither anchor, THEN the run SHALL be reported as ERROR
and SHALL NOT be reported as a pass or a violation.
Before the harness is trusted, it SHALL be demonstrated to classify one known
violating run and one known holding run correctly.

#### Scenario: a clean run is not misread as a violation

- WHEN the checker prints `[ok] No violation found`
- THEN the harness classifies the run as holding
- AND the control arm of the comparison is unaffected.

#### Scenario: an unparsable run is an error, not a pass

- WHEN the checker exits non-zero after printing a stack trace and no outcome
  line
- THEN the harness reports ERROR naming the model and configuration
- AND the suite does not count the row as satisfied.

### Requirement: a model that has drifted from its subsystem is a defect

Each model SHALL record the source files, and where practical the line ranges,
that it abstracts; and a change to a covered subsystem SHALL carry the model
update in the same change.

WHEN a change modifies a source file listed in a model's coverage record, the
change SHALL update that model and any affected manifest rows.
IF a covered source file changes and no model or manifest file changes in the
same change, THEN the gate SHALL fail naming the drift, and the change SHALL
either update the model or explicitly record why the abstraction is unaffected.
A drifted model SHALL NOT be cited as evidence in any proposal, design or
report — a stale model launders an out-of-date claim as formal evidence, which
is worse than having no model, because the claim now carries the authority of a
checker that never examined the current code.
WHERE a model action is cited as faithful to shipped code, the citation SHALL
name the file and line range it mirrors, as
`witness_shipped_resume_loses_round_ownership` does for
`lane-supervise.sh:343-345`.

#### Scenario: changing the gate without touching its model fails the gate

- WHEN a change edits `gate-eval.sh` and does not touch `audit_gate.qnt` or the
  expectation manifest
- THEN the gate fails naming the covered file and the model
- AND the change must either update the model or record why the abstraction is
  unaffected.

#### Scenario: a model claim with no source citation is rejected

- WHEN a report cites a model result as confirming a defect in shipped code
  without naming the file and line range the modelled action mirrors
- THEN review rejects the claim as unverified
- AND the result may still be reported as a property of the model alone.

### Requirement: results state their method and bound, and are never described as proofs

Every result the suite emits SHALL be accompanied by the method that produced
it and the bound that limits it.

WHEN the suite reports a row, it SHALL state either random simulation with its
sample count and trace length, or bounded model checking with its depth and
checker version.
A result showing no counterexample within N steps SHALL be reported as "no
counterexample within N steps" and SHALL NOT be reported as a proof, a
guarantee, or a claim that the system is correct.
The suite SHALL carry the standing limits of the current evidence: M2 and M3
simulation results rest on 20,000 and 10,000 samples respectively, Apalache
results are bounded to depths 8 to 12, and none of these establishes
correctness for all executions, fairness, torn writes, real subprocess kill, or
hash collisions.
A temporal-property failure that is a no-fairness stuttering artifact — M1's
`eventually_terminal` — SHALL be recorded as an artifact and SHALL NOT be cited
as a liveness defect.

#### Scenario: a bounded result carries its bound into the report

- WHEN Apalache finds no counterexample for `atomic`/`mutual_exclusion` within
  8 steps
- THEN the report states the depth, the checker version and the elapsed time
- AND describes the result as bounded satisfaction rather than proof.

#### Scenario: a release claim is not upgraded beyond its evidence

- WHEN a proposal cites a formal result as justification for a release decision
- THEN the citation reproduces the method and bound from the suite output
- AND the proposal makes no unbounded correctness claim on that basis.

### Requirement: a predicate observed to be vacuous is registered and cannot be reused

The suite SHALL maintain a registry of predicates known to pass vacuously for a
stated property, and SHALL refuse to accept a registered predicate as evidence
for that property.

WHEN a predicate is found to hold because the state it constrains never changes
in the scenario under test, it SHALL be added to the registry with the property
it was wrongly used for and the property that actually tests it.
The registry SHALL be seeded with `rework_rounds_bounded`, which constrains
`round`; in the infra-failure loop it was used to test, `round` never advances,
so the invariant is trivially true in exactly the failure it was meant to
detect. The property that actually tests it is
`audit_attempts_bounded_by_three`, which VIOLATES under `uncapped_errors`.
IF a manifest row or a report cites a registered predicate as evidence for its
registered property, THEN the run SHALL fail naming the registry entry and the
correct predicate.

#### Scenario: the non-termination question cannot be answered by the vacuous predicate again

- WHEN a row or report cites `rework_rounds_bounded` as evidence that the
  UNVERIFIED audit loop terminates
- THEN the run fails naming the registry entry
- AND directs the author to `audit_attempts_bounded_by_three`, whose violation
  under `uncapped_errors` is the actual answer.

### Requirement: lanes terminate processes by handle, never by pattern

A lane SHALL NOT terminate processes by matching a command-line pattern.

WHEN a lane needs to stop a checker it started, it SHALL terminate a process
identifier or process group it owns.
The suite SHALL NOT invoke `pkill -f` or an equivalent pattern kill: on
2026-07-28 `pkill -f "quint verify"` matched the issuing lane's own command
line and killed its shell, and would also have killed a sibling lane verifying
against the same Apalache server on port 8822.
WHERE lanes share a long-lived checker server, ownership of that server SHALL
be explicit, and a lane that does not own it SHALL NOT stop it.

#### Scenario: a lane cleanup does not kill its sibling

- WHEN two lanes verify concurrently against a shared Apalache server on port
  8822 and one lane cleans up
- THEN only the cleaning lane's own checker process is terminated
- AND the sibling lane's verification completes.

#### Scenario: a pattern kill is rejected in review

- WHEN a script in `formal/` or a lane recipe introduces `pkill -f`
- THEN the gate fails naming the call site
- AND the change substitutes an owned PID or process group.
