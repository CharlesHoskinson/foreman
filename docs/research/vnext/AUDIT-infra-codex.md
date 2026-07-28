# Foreman v0.2.9 Infrastructure OpenSpec Audit

## Verdict

**BLOCKED.** The eight packages are structurally valid, and most of their
bounded Quint results reproduce, but the implementation contract is not yet
sound. Several gates use predicates that do not establish the claims they make:
a prior approval can survive an interrupted same-diff re-audit, a
`git status --porcelain` digest cannot establish either content mutation or
audit-report production, and the proposed positive-control registry can be
self-asserted without mechanical coverage. There are also direct contradictions
with `RECONCILE.md` (R4, R9, R10, R13, R14 and R15), conflicting ownership and
definitions for M5 and write evidence, and requirements whose alternatives or
inputs are underspecified. A competent implementer would have to invent
security- and correctness-critical semantics. `openspec validate --strict`
passing does not address any of these failures.

## Blocking findings

### 1. Audit freshness is not bound to the current audit attempt or evaluated tree

- **Package/file:** `three-outcome-verdicts`;
  `design.md:37-60`, `proposal.md:96-101`, `tasks.md:34,59,138-141`.
- **What is wrong:** The gate predicate is only `diff_sha256`. The design writes
  a new verdict by temporary file plus rename and deliberately leaves the prior
  artifact intact until the rename. If an audit of an unchanged diff is killed
  before the rename, the previous `APPROVED` has the same diff hash and remains
  gate-valid. A rebase onto a different base may also produce a byte-identical
  patch while changing the resulting tree and the dependencies against which
  the audit, checks and docs check ran. The design expressly treats that old
  evidence as valid. The formal model abstracts this as `DiffId`, so it cannot
  falsify the real predicate.
- **Why it matters:** The package's central claim—no stale or unaudited
  merge—can pass loudly after an interrupted re-audit or against a materially
  different tree.
- **Concrete fix:** Before spawning an audit, atomically publish a
  current-attempt `UNVERIFIED`/in-progress record. Bind audit, checks, docs and
  merge to a canonical evaluated-tree identity such as `HEAD^{tree}`, the
  current audit attempt, base identity, command/config identity and relevant
  toolchain identity. Specify the canonical hash input, including untracked
  files, staged/unstaged content, modes and binary files. Add positive controls
  for same-diff interruption and byte-identical-patch/different-tree rebases.

### 2. The shared write-evidence predicate is unsound and has two owners

- **Package/file:** `evidence-contracts/tasks.md:1-7,12-13`;
  `vendor-adapter-contract/design.md:91-98`,
  `vendor-adapter-contract/specs/vendor-adapters/spec.md:205-219`, and
  `vendor-adapter-contract/tasks.md:69-78`.
- **What is wrong:** Both packages claim the shared digest and bounded
  multi-round loop (`lib/evidence.sh` / `vendor-multiround.sh`). Their concrete
  predicate is based on the hash of `git status --porcelain`. That output does
  not change when an already-dirty file is edited again, or when a pre-created
  untracked report skeleton is filled in. Conversely, creating only a skeleton
  changes the digest and can satisfy the predicate without completing the
  artifact. The field log records this exact false-negative class at
  `bugeventlog.md:1167-1207`.
- **Why it matters:** The package about evidence fidelity uses a predicate that
  does not entail its claim. Duplicate ownership also lets incompatible helper
  semantics land independently.
- **Concrete fix:** Assign one package as the implementation owner and make the
  other a consumer. Use content snapshots, not status strings. Define
  lane-specific evidence contracts: implementation changes the expected tree
  content; audit keeps the reviewed worktree unchanged and produces a
  schema-valid external verdict/report; planning and research produce named,
  complete artifacts. Bind the success decision to those artifact schemas and
  hashes, with a planted-write positive control.

### 3. `evidence-contracts` would reject correct audits and accept partial packages

- **Package/file:** `evidence-contracts/tasks.md:2-5,13`,
  `specs/evidence-contracts/spec.md:19-20,47-50`;
  `cross-vendor-audit-routing/specs/audit-routing/spec.md:178-205`.
- **What is wrong:** One workspace-change predicate is imposed on implement,
  audit, planning and research lanes. A correct read-only auditor writes its
  report outside the reviewed worktree, so its workspace digest should remain
  unchanged. Meanwhile, changing one of four required planning files changes
  the digest and ends the loop even if the package remains incomplete.
  “Additional artifact/content checks where the lane type defines them” does
  not define those interfaces.
- **Why it matters:** The exact empty/partial-lane incident the package cites is
  not closed, while a conforming audit lane can be classified as failure.
- **Concrete fix:** Define an explicit evidence-root and completeness schema for
  every lane type, including required files, validation command and report
  location. Record termination metadata on every attempt, not only
  unchanged-digest failures. Test both partial-package and correct-external-
  audit cases.

### 4. `round-ownership-default` still contradicts reconciliation R9

- **Package/file:** `round-ownership-default/proposal.md:44-49,68-81`;
  `tasks.md:12-13,36-42`; `specs/round-ownership/spec.md:13-21,126-146`;
  `RECONCILE.md:300-310`.
- **What is wrong:** The first requirement unconditionally refuses any
  durable-enabled invocation without `--round`; the later requirement permits
  an unowned durable-enabled invocation through an escape hatch. The refusal is
  not qualified by that exception. The interface is merely “an explicit
  unowned-dispatch flag”; no exact flag name or grammar is specified.
  Additionally, the task is premised on “exactly two `DURABLE_ENABLED`
  occurrences,” but the cited lines are a config-map entry and a lowercase
  allow-list entry, not two dormant consumers.
- **Why it matters:** Refusal and success are required for the same state, so
  different implementers can produce opposite compliant behaviours. The stale
  count premise can also self-stop T1.
- **Concrete fix:** Name the escape-hatch flag and required reason exactly once;
  make the default-refusal requirement explicitly conditional on its absence;
  add malformed/missing-config hard-coded fallback cases; replace the literal
  count premise with a semantic consumer test. Add the KC-12 measurement and
  task required by R9, or remove the claimed dependency.

### 5. Lock fallback does not consume the atomicity evidence required by R4

- **Package/file:** `lock-primitive-hardening/tasks.md:9-17,42-48`;
  `specs/locking/spec.md:49-69`; `RECONCILE.md:196-205`.
- **What is wrong:** The helper selects `mkdir` when `flock` is unavailable,
  while the atomicity probe is only added to host inventory. No task requires
  the helper to consume a recorded successful probe or perform its own bounded
  probe. There is no helper-level negative scenario for “probe failed and
  `flock` unavailable.”
- **Why it matters:** A host can be declared not ready yet still run the helper
  fail-open on the known non-atomic primitive. That is the exact defect R4
  ordered the amendment to close.
- **Concrete fix:** Make helper initialization require a fresh, successful
  probe record or run a bounded local probe. Refuse lock acquisition if neither
  trustworthy primitive is available. Add the required negative scenario and
  assert exactly one acquisition/release in the successful fallback case.

### 6. Lock nesting and reclamation contracts are contradictory or unsafe

- **Package/file:** `lock-primitive-hardening/specs/locking/spec.md:186-223`;
  `design.md:54-63,201-211`; `tasks.md:26,158-166,170-177`.
- **What is wrong:** The spec says the durable core shall never hold one
  Foreman lock while acquiring another, then defines an order for future code
  that holds both. Separately, NATS bridge recovery is delegated to `el_init`,
  whose contract is to run once before concurrent emitters and reclaim all run
  locks. A bridge crash during an active run cannot safely rerun global
  initialization to reclaim one lock. “Every stale Foreman lock” also exceeds
  the tasks: `.index.lock` can survive `SIGKILL` under the `mkdir` fallback but
  has no reclamation task.
- **Why it matters:** The implementer must choose between mutually exclusive
  locking policies, and the prescribed recovery can delete live locks or leave
  the worktree index permanently wedged.
- **Concrete fix:** Choose flat locking or explicitly permitted ordered nesting,
  not both. Give the NATS bridge a dedicated owner-aware recovery operation
  that cannot reclaim unrelated live locks. Enumerate every lock in scope and
  specify crash recovery for each, including `.index.lock`.

### 7. M5 has conflicting definitions and owners

- **Package/file:** `release-metrics/specs/release-metrics/spec.md:119-155`,
  `tasks.md:76-85`; `graph-eval-falsification/design.md:129-145`,
  `specs/evaluation/spec.md:167-199`, `tasks.md:80-89`.
- **What is wrong:** `release-metrics` defines M5 over defects discovered after
  merge or `BLOCKED`/`WARNING` audit findings unique relative to the
  implementer's reread. `graph-eval-falsification` defines M5 over
  gate-blocking findings unique relative to deterministic checks and the
  architect. These have different populations, comparators and denominators,
  yet both packages claim the identifier and report computation.
- **Why it matters:** The same release can report two incompatible “M5” values,
  and an implementer cannot know which schema or owner is authoritative.
- **Concrete fix:** Leave one M5 definition and owner. The reconciled graph
  package already owns computation; make `release-metrics` consume that exact
  record or give its different metric a new identifier and explicit source.

### 8. Several metrics are not computable from their declared dependencies

- **Package/file:** `release-metrics/specs/release-metrics/spec.md:75-118,
  157-190,267-274`; `tasks.md:44-72,88-95`;
  `decision-lineage-and-telemetry/tasks.md:54-88`.
- **What is wrong:** M4 calls queue/implement/audit/gate “mutually exclusive,
  collectively exhaustive” and then adds a fifth `unaccounted` phase. M1's
  companion “architect-authored decision share” has no per-line authorship
  event. The claimed sigma source—three repeated Tier-2 vendor runs—does not
  create repeated unchanged-code windows for release metrics such as cost,
  mortality or wall-clock duration. M3, M5, M6, M7 and M8 also omit
  zero-denominator `IF ... THEN` behavior.
- **Why it matters:** The report generator cannot implement the published
  formulas without inventing event attribution, populations and undefined
  arithmetic.
- **Concrete fix:** Define an exhaustive phase taxonomy, add the missing
  authorship event or drop that companion, define the sampling population and
  minimum `n` per metric, and specify “uncomputable” behavior for every zero
  denominator.

### 9. Tier 0 and Tier 1 acceptance are unfalsifiable as written

- **Package/file:** `regression-harness-tiers/specs/regression-harness/spec.md:
  55-70,109-127`; `tasks.md:8-13,21-31`.
- **What is wrong:** Tier 0 requires an owning-slice drop “materially larger”
  than “normal noise” with no numerical definition. Tier 1 must cover “every
  distinct failure class” in `bugeventlog.md` while targeting only 10–12
  cases. The log contains substantially more and includes non-vendor classes
  such as CRLF, shell parsing, lock races, concurrent Bats load and detached
  HEAD; many cannot be represented by a recorded vendor transcript/decision
  trace.
- **Why it matters:** A green gate cannot establish coverage, and no implementer
  can know which failures belong to the corpus.
- **Concrete fix:** Publish a closed taxonomy and scope Tier 1 to
  vendor-response/decision failures; map all other classes to deterministic
  fixtures. Replace “materially larger” and “normal noise” with a fixed
  statistic and threshold, including the zero-noise case.

### 10. Tier budgets and statistical gates are not executable

- **Package/file:** `regression-harness-tiers/proposal.md:38-54`;
  `specs/regression-harness/spec.md` Tier 2/budget requirements; its
  `tasks.md` budget and bootstrap tasks.
- **What is wrong:** Requirements demand explicit maxima, but use phrases such
  as “seconds,” “low seconds,” “material margin” and “maintainer approved.”
  Tier 2 uses only `N=3` paid runs, compares a delta to measured variance in one
  place and confidence-interval width in another, and assumes a pinned model
  name pins a changing vendor backend.
- **Why it matters:** A release gate cannot decide pass/fail reproducibly, and a
  confidence interval over three external runs is not a defensible regression
  threshold.
- **Concrete fix:** State numeric wall-clock and dollar ceilings, exact
  estimator, resampling unit, seed, interval method, power/minimum-effect
  target and backend-version recording. Until those exist, make Tier 2
  on-demand research rather than release acceptance.

### 11. The formal manifest cannot encode its own required rows

- **Package/file:** `formal-model-suite/specs/formal-models/spec.md:44-49,
  90-107`; `tasks.md:8-10,31-48`.
- **What is wrong:** The manifest outcome vocabulary is only
  `VIOLATED | HOLDS`; the classifier adds `ERROR`; the required M1 witness rows
  and tasks require `REACHABLE | NOT REACHABLE`. No mapping or row-kind
  discriminator is defined.
- **Why it matters:** The required manifest and runner cannot be implemented
  consistently without inventing semantics.
- **Concrete fix:** Define one typed vocabulary, for example
  `{property: invariant|witness, expected:
  violated|holds|reachable|not_reachable}`, plus `ERROR` as an execution state
  that can never satisfy an expectation. Add a fixture for every value.

### 12. The checker-soundness mechanism does not mechanically cover its claim

- **Package/file:** `test-infrastructure-hardening/specs/test-harness/spec.md:
  155-190,238-280`; `tasks.md:84-100,142-147`; `proposal.md:109-129`.
- **What is wrong:** The scope says every new gate, probe or assertion ships a
  positive control, but the task audits only four named checks and creates a
  registry/helper that callers can populate themselves. There is no inventory
  that binds every decision predicate to an independently executed failing
  control. “Every assertion” is also recursive and impractically broad.
  The corroboration rule says “different predicate, mechanism or actor,” while
  its scenario requires a different predicate.
- **Why it matters:** A checker can self-declare a positive control and pass the
  checker-soundness gate without ever demonstrating that its real predicate
  rejects a planted defect. This is self-refuting under the workstream's own
  standard.
- **Concrete fix:** Narrow scope to release-affecting decision predicates.
  Generate a mechanical inventory from gate definitions, require an independent
  fixture and observed failing exit for every entry, fail on missing/stale
  entries, and make “different predicate” mandatory where corroboration is
  offered.

### 13. Reconciliation-mandated removals and evidence corrections were not applied

- **Package/file:** `test-infrastructure-hardening/proposal.md:17-20,136-138`;
  `tasks.md:75-80`; `RECONCILE.md:312-319,342-356`.
- **What is wrong:** R10 assigns the single final CI workflow to
  `wsl-ci-parity` and requires this package to remove its duplicate
  `.github/workflows/tests.yml`; the proposal and T7 still create it. R13
  requires the failure record to say two known product failures, five known
  non-product failures and two untriaged failures; the table has two
  “unknown” entries, but the narrative still says “Only two of nine were
  product defects. The other seven were environment...”.
- **Why it matters:** One task duplicates ownership of the final workflow, and
  the package overstates the field evidence it uses to justify its design.
- **Concrete fix:** Remove T7 and the workflow from this package. Correct the
  narrative and every derivative claim to the 2/5/2 classification.

### 14. R14 and R15 remain open

- **Package/file:** all eight `specs/*/spec.md`;
  `three-outcome-verdicts/specs/audit-verdict/spec.md:149-178`;
  `RECONCILE.md:358-369`.
- **What is wrong:** Every spec labels itself “EARS-phrased,” but clauses still
  reverse or combine the required order. Examples include
  `formal-models/spec.md:17-20` (`WHEN ... SHALL ... and SHALL ... IF`) and
  `round-ownership/spec.md:102-103` (`SHALL ... only WHEN`). Numerous
  requirements contain multiple independent SHALL obligations whose scenarios
  exercise only a subset. No EARS lint/normalization task was added despite
  R14. R15 specifically requires an `IF ... THEN` branch for inability to
  compute a checks/docs/audit hash; the package still only says recompute and
  compare.
- **Why it matters:** Claimed EARS conformance is false, and a hash-command
  failure can be interpreted as empty input, mismatch, or pass.
- **Concrete fix:** Normalize each normative sentence to
  `WHILE/WHEN/WHERE/IF ... THEN ... SHALL`, split independent obligations into
  separately testable requirements, ensure each scenario covers its complete
  requirement, add an EARS lint task, and add explicit fail-closed branches for
  every evidence-hash computation error.

## Non-blocking findings

1. **Formal controlled-comparison claim is stronger than the model.**
   `round-ownership-default/design.md:193-197` and
   `formal/reports/VERIFY-quint-architect.md` say the shipped and fixed resume
   configurations differ by exactly one action. In
   `formal/specs/lane_lifecycle.qnt:729-732,809-816`,
   `step_postfix` extends a larger base step while
   `step_shipped_resume_bug` is a separate action set that also includes
   `agentBackgroundsAndStops`. The reachability results reproduce, but causal
   attribution to one changed action does not. Create paired configurations
   whose action sets are identical except for core/plain resume and rerun.

2. **Round event payload does not reconstruct an invocation.**
   `round-ownership-default/specs/round-ownership/spec.md:158-186` says the event
   log alone reconstructs `--round GATE_CMD REPORT_PATH`. The shipped prompt
   event stores the command as shell-joined words, and the source header says
   original argv is not recoverable. Adding two strings does not repair that.
   Record structured argv, or narrow the claim to recovery of ownership mode
   and those two fields. Define canonicalization for `REPORT_PATH` and avoid
   persisting secret-bearing command strings verbatim.

3. **Round package impact/dependency text is stale.**
   `round-ownership-default/proposal.md:121-123` says it does not touch
   `lane-supervise.sh`, while T8 (`tasks.md:120-142`) requires substantial
   supervisor changes. The affected-file list should include it. The package
   also “consumes” a round-mode-share metric
   (`proposal.md:117-119`) that no requirement/task in
   `decision-lineage-and-telemetry` produces.

4. **WARNING resolution has no data model.**
   `three-outcome-verdicts/specs/audit-verdict/spec.md:270-293` asks the gate to
   distinguish resolved-low from unresolved-medium findings, but the verdict
   finding schema has no resolution field or referenced resolution artifact.
   Define the resolution record, actor, timestamp, finding ID join and
   invalidation rules.

5. **The read-only audit tamper check is status-only.**
   `three-outcome-verdicts/specs/audit-verdict/spec.md:43-48` and
   `cross-vendor-audit-routing/specs/audit-routing/spec.md:177-184` compare
   `git status --porcelain` before and after. Editing an already-modified file
   leaves the same output. Reuse the content snapshot fixed under Finding 2.

6. **The audit-attempt limit offers two non-equivalent contracts.**
   `three-outcome-verdicts/specs/audit-verdict/spec.md:195-205` and
   `tasks.md:154-163` permit either total audit attempts or consecutive
   UNVERIFIED attempts. These differ after a recovered audit and no reset
   semantics are specified. Pick one key and define increment/reset behavior.

7. **Baseline and skip counts permit substitution.**
   `test-infrastructure-hardening/specs/test-harness/spec.md:49-84` locks only
   per-file counts. One expected test can start failing while a new test starts
   passing, leaving the same count; an expected skip can similarly be replaced.
   Store per-test identity and expected status, using counts only as summaries.

8. **The lock “static proof” is not a proof.**
   The proposed grep for a timeout branch that continues a critical section
   has no syntax or semantic definition and can pass after trivial
   reformatting. Replace it with behavioural fixtures around the shared helper.
   Also clarify that compaction already holds `.seq.lock` over its whole
   read/write cycle; primitive migration fixes its current race, so the later
   task should not imply a second independent compaction lock defect.

9. **Formal report scanning is underspecified.**
   `formal-model-suite` asks a scanner to determine whether arbitrary reports
   cite the right predicate for a property. That cannot be made reliable over
   prose. Use structured result references (`model`, `module`, `entrypoint`,
   `predicate`, bounds, checker version, outcome) and render prose from them.
   Pin the Quint package/version in a portable toolchain; do not make a
   reference-box absolute `fnm` path the portable contract.

10. **Regression inventory count is stale.**
    `regression-harness-tiers/design.md:11` says 383 Bats tests. The shipped
    suite is 33 files and `bats --count tests/*.bats` returns 382, matching the
    proposal.

11. **Benchmark cost wording conflates campaigns and runs.**
    `regression-harness-tiers/proposal.md:21-22` says a “full HAL-style run”
    costs about $40,000. The HAL paper reports roughly $40,000 for its entire
    21,730-rollout, nine-benchmark/model campaign, not one comparable
    SWE-bench run. The $259 Verified-Mini example does reproduce. Cite the
    exact benchmark/version and unit. Primary references:
    [HAL paper](https://openreview.net/forum?id=vUa6Z6S0yo) and
    [HAL Verified Mini](https://hal.cs.princeton.edu/swebench_verified_mini).

12. **The external benchmark rationale needs versioned citations.**
    The cited 59.4% flaw rate for 138 SWE-bench Verified tasks reproduces in
    [OpenAI's February 2026 analysis](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/).
    SWE-ABS reports approximately 19.7%, but the accessible paper version says
    19.78% rather than the package's 19.71%; cite the exact version rather than
    treating the last decimal as stable:
    [SWE-ABS paper](https://openreview.net/forum?id=eWzojJ9SGF).

13. **Release-note prose linting does not establish metric truth.**
    `release-metrics/tasks.md:44-72,102-108` scans words such as “improved” and
    an adjacent sigma sentence. Equivalent wording evades it and fabricated
    numbers satisfy it. Emit the prose from typed metric records. Keep gaming
    detection as a review flag unless “corroborating direction” is made an
    exact predicate.

14. **The evidence mutation gate is neither bounded nor falsifiable.**
    `evidence-contracts/tasks.md:9-11` requires per-changed-line mutants but
    does not define operators for deletions, comments, configuration, modes,
    binaries or equivalent mutants; “fail/flag” has two outcomes. Define a
    supported mutation domain and zero-mutant behavior if retained.

## Evidence-fidelity audit

### Formal results sampled

- `quint --version` resolved to **0.32.0**. All three files in
  `formal/specs/*.qnt` typechecked successfully.
- I classified runs only from lines anchored as `^[violation]` or `^[ok]`, not
  from substring matches in traces.
- At the package-stated simulation scales, I reproduced:
  - **M2 / `eventlog_concurrency`:** `toctou` violates
    `mutual_exclusion` and `seq_uniqueness`; `atomic` holds both.
  - **M3 / `audit_gate`:** `pre_fix` violates stale/unaudited merge;
    `post_fix` holds stale approval; `uncapped_errors` violates the
    audit-attempt bound and `capped_errors` holds it; post-fix checks/docs
    binding violates and full checks binding holds.
  - **M1 / `lane_lifecycle`:** both prefix invariants violate;
    `step_postfix_without_resume` holds the fresh-report invariant; the shipped
    resume witness is reachable and the fixed resume witness is not reachable
    within the sampled bound.
- Additional rows sampled at 20,000 samples / 40 steps (or the package's
  stated 10,000 / 40 for M3) reproduced: fail-open index mutex/lost-entry,
  structural-event loss, nested deadlock, NATS owner-token/deadlock/reclamation,
  gate-to-merge TOCTOU, warning authorization, same-family authorization and
  merge-freshness violations.
- These are bounded, sampled results. I found no package statement that turns
  them into an unqualified mathematical proof. The “differ by exactly one
  action” causal claim does not reproduce structurally, as noted above.

### Source and field-record citations sampled

- `skills/foreman/scripts/audit-run.sh:90-108` snapshots status and checks the
  audit result; `skills/foreman/scripts/gate.sh:40,43-52` uses report
  existence/freshness but does not establish the new evidence binding.
- `skills/foreman/scripts/checks-run.sh:41-42` writes SHA/status, while the
  shipped gate does not compare that SHA.
- `skills/foreman/scripts/lane-supervise.sh:79-83,343-345` documents and
  performs plain warning/re-enqueue behaviour; the round package's supervisor
  target is real.
- `skills/foreman/scripts/wt-new.sh:203` contains the claimed index fail-open
  branch. `lib/eventlog.sh:52-57,76,221` contains the initialization and lock
  sites cited by the lock package. Compaction already keeps the sequence lock
  across its read/write section.
- `skills/foreman/scripts/lane-run.sh:1140-1249` contains the claimed round
  path and completion machinery.
- `bugeventlog.md:926-999` supports missing-report and empty/partial-lane
  incidents. Its correction at `:1113-1153` supports at least two distinct
  empty-burst causes—`PermissionCancelled` and research-budget exhaustion—so
  the packages correctly avoid treating every empty burst as one vendor cause.
- The suite inventory is 33 Bats files / 382 tests, not the one stale
  383-test statement.

### Citations that did not reproduce as stated

- The round/model claim that fixed and shipped-resume configurations differ by
  exactly one action.
- The `DURABLE_ENABLED` “exactly two dormant occurrences” premise.
- Test-infrastructure's “other seven” known non-product failures; two are
  explicitly untriaged.
- The 383-test design count.
- The $40,000 description when read as one benchmark run rather than the whole
  published HAL evaluation campaign.

## Self-consistency check

**The workstream does not yet survive its own standard.** Its central thesis is
correct—checker output is evidence only if the predicate discriminates the
claimed property—but four of its proposed controls fail that test:

1. A `git status --porcelain` digest does not discriminate content writes,
   report completion or audit worktree immutability.
2. `diff_sha256` does not discriminate the current audit attempt or the
   evaluated resulting tree.
3. A positive-control registry with no mechanically complete inventory can
   attest to itself while omitting the real gate.
4. A natural-language metric linter discriminates phrases, not formula
   correctness, population validity or causal claims.

The packages do contain useful anti-vacuity ideas: anchored Quint result
classification, deliberate regression injection, skip budgets, explicit
uncomputable metric states, and `UNVERIFIED` as fail-closed uncertainty. Those
ideas become credible only after the acceptance predicates above are replaced
with structured, planted-failure controls. As written, a checker-soundness
release could pass while its own checkers make the same predicate/claim error
the release is intended to prevent.

## Proportionality assessment

I would make the following cuts for v0.2.9:

- **Cut the mandatory formal drift gate from ordinary shell changes.** Keep the
  model-to-source coverage map, pinned formal runner and scheduled/release
  review. A file-level critical-path block with no dependency analysis is too
  coarse, while its one-sentence “unaffected” escape hatch is not a check and
  can always pass. If a per-change gate is retained, require a structured
  reviewer-approved waiver naming the mapped behaviours and changed symbols.
- **Keep regression Tiers 0 and 1 after scoping/fixing them. Move Tier 2 to
  on-demand research and cut Tier 3 from this release.** Three paid runs do not
  support the claimed inference; a 50-task external benchmark adds meaningful
  vendor cost and tests general coding ability more than Foreman's orchestration
  contract.
- **Reduce the release metrics to M2, M3, M4, M7 and M8 for v0.2.9.** Keep M1
  only after authorship instrumentation exists. Remove M5 here because the
  graph-eval package owns it; defer M6 until defect-to-merge linkage exists;
  defer M9–M13 rather than shipping 13 nominal metrics with incomplete
  populations. Cut automated “gaming direction” inference; retain a typed
  companion field and human review.
- **Cut the per-diff mutation gate from `evidence-contracts`.** It is high-cost
  and undefined across much of this shell/config repository. If later retained,
  start as advisory on a small supported operator set and fixture corpus.

These cuts preserve the release's highest-value spine: deterministic
regressions, explicit three-outcome gates, content-bound evidence, correct
locking, round ownership, and a small set of operational metrics.

## What I checked and found correct

- The required report artifact was created before package or evidence analysis.
- All four expected artefacts exist in each of the eight scoped packages, and
  each normative requirement has at least one `#### Scenario:` structurally.
- All eight packages pass `openspec validate --strict`; I used that only as a
  structure check.
- All three Quint models typecheck with Quint 0.32.0, and the sampled
  violation/hold/reachability directions agree with the architect's corrected
  verification record except for the overstrong controlled-comparison wording.
- The architect record correctly retracts its two earlier conclusions: M1 is
  reachable under its explicit entrypoint, and `round` is a vacuous
  non-termination predicate while `auditAttempts` exposes the uncapped loop.
- The model/module/invariant names sampled from the packages exist in the
  `.qnt` files. The packages generally state depth/sample limits rather than
  calling bounded simulation a proof.
- `three-outcome-verdicts` cleanly distinguishes the persisted four-value
  artifact (`APPROVED`, `WARNING`, `BLOCKED`, `UNVERIFIED`) from the model-facing
  three resolved gate outcomes. Treating `UNVERIFIED` as non-authorizing is
  correct.
- Several sibling deferrals are real: `vendor-adapter-contract` owns vendor argv
  construction; `decision-lineage-and-telemetry` defines first-class
  `finding`, `audit_verdict`, `gate_decision` and usage/timing events;
  `cross-vendor-audit-routing` owns auditor selection; and
  `graph-eval-falsification` owns its evaluation corpus and M5 computation.
  The findings above identify where the scoped packages exceed or assume more
  than those siblings actually provide.
- The lock package's measured-source citations, the shipped fail-open branch,
  NATS/compaction model outcomes and bounded-language caveats reproduced.
- The round package correctly identifies loss of `GATE_CMD`/`REPORT_PATH` on
  supervisor redispatch and correctly requires unknown legacy ownership fields
  not to be inferred as plain.
- I did not invoke Graphify or read/refresh `graphify-out/graph.json`.

## What I could not check, and why

- I did not rerun the reported Apalache state-space searches, exact state/depth
  witnesses, elapsed times or JVM-specific results. The local verification used
  Quint typechecking and bounded randomized runs; Apalache reproduction was not
  necessary to identify the specification defects above.
- I did not reproduce paid live-vendor Tier 2/3 experiments, vendor billing or
  backend pinning. Doing so would spend external funds and the packages do not
  define an executable experiment yet.
- I did not reproduce Windows/MSYS/Ubuntu reference-host concurrency and
  wall-clock measurements. The shipped sources and model claims were
  inspectable, but those host-specific empirical measurements require the named
  environments.
- I did not independently reproduce the empirical dataset experiments behind
  SWE-ABS, HAL or OpenAI's SWE-bench analysis. I checked the package's numeric
  claims against the primary published sources and flagged the unit/version
  mismatches.
- No product implementation exists for these changes, so buildability was
  assessed from whether `tasks.md` and the specs define an implementable,
  testable contract; no post-change product test could be run.
