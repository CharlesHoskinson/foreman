# Foreman v0.2.9 Final Codex Audit

## Decision

**DO NOT DISPATCH S1.**

The lock package is no longer the stop: its trusted-verdict, filesystem-scope,
Git-Bash pinned-mechanism, and six-cause refusal contracts are coherent enough
to implement. The other half of S1 is not. `LANDING-ORDER.md` says to widen
`crlf-extensionless-hardening` to the Foreman executables and
`nats/setup.sh`, but that package's requirement, Task 3, tests, and acceptance
text still change only the three extensionless SDD scripts. The current tree
contains 34 `.sh` files under `skills/foreman/scripts/`; the pending mode diff
changes 33, leaving `skills/foreman/scripts/nats/setup.sh` non-executable, while
the three SDD scripts named by the package also remain `100644` in the index.
Before dispatch, replace the three-file executable requirement and Task 3 with
a mechanical manifest/inventory of every Foreman-owned directly executed
script, explicitly including the three SDD scripts and
`skills/foreman/scripts/nats/setup.sh`, and make the regression test assert that
inventory. Do not hand a worker a landing note that contradicts its normative
task.

Under the stated serial landing order, **no later implementation stage is
dispatchable now**, because S1 has not cleared. The table also gives intrinsic
readiness, so a sequence dependency is not confused with a defect in a later
package.

## Per-stage dispatchability

| Stage | Verdict | Specific blocker or dispatchable subset |
|---|---|---|
| S0 | **Administrative action ready; not an implementation dispatch** | Archive `test-harness-fork-tax` and `el-emit-spawn-reduction`, then make the architect choice in `lock-primitive-hardening` T8: migrate the remaining non-conforming packages or document the variant. The choice is not delegable as an undecided coding task. |
| S1 | **BLOCKED** | Amend `crlf-extensionless-hardening`'s executable requirement, Task 3, and test to implement the widened inventory, including `nats/setup.sh`; reconcile the current partial mode diff. |
| S2 | **BLOCKED** | (1) Remove the CI-workflow requirement and T7's `.github/workflows/tests.yml` from `test-infrastructure-hardening`; `wsl-ci-parity` is the single final workflow owner under RECONCILE R10. (2) Amend `formal-model-suite` from “all three models” to all four: add `evidence_contract.qnt` to typecheck, coverage, expectation-manifest, CI, and gate tasks. |
| S3 | **NOT CERTIFIED — OUT OF SCOPE** | All four packages in this stage are among the ten pre-existing non-validating packages excluded by the audit scope. This is not a newly asserted blocker. |
| S4 | **BLOCKED** | `LANDING-ORDER.md` reverses the declared dependency: it must start `three-outcome-verdicts` → `decision-lineage-and-telemetry`. Change the former's adapter “depends” statement to the reconciled preservation invariant; add the corresponding preservation task to the adapter. Qualify `round-ownership-default`'s unowned-refusal requirement and task with the explicit reason-carrying escape-hatch exception. Add `closes_in` to `doctrine-reality-drift` so knowingly false claims may remain pending per merge but must be zero at the release gate. Place graph-eval T1/T2/T8 instrumentation here as RECONCILE R2 requires. |
| S5 | **BLOCKED** | Rewrite agy credential isolation to the architect-decided shared home at cap 1 with no OAuth seeding; make agy consume the canonical content digest and emit harness-owned `UNVERIFIED` on mutation. Change `vendor-adapter-contract` T3 to replace only argv construction while preserving the S4 timeout/process-group, attempt publication, evidence binding, and verdict wrapper. |
| S6 | **PARTIALLY READY; STAGE BLOCKED** | `evidence-contracts` and `regression-harness-tiers` have no stop-work contract defect in this pass. `release-metrics` T1 is unsatisfiable after S4: it requires the S4 event types and emits to remain absent and commands the worker to stop when they exist. Rewrite T1 as validation of the landed telemetry interface. |
| S7 | **BLOCKED** | `knowledge-plane-refresh` is package-ready. `work-dag-projection` still requires “`--directed` in force,” rejects all model-authored input while projecting recorded model findings/verdicts, and resolves only the first changed hunk; replace those requirements/tasks with endpoint-order plus load-time reconstruction, provenance-preserving recorded claims, and per-hunk resolution. `audit-groundedness-gate` still checks G2 against HEAD rather than `{commit_sha, side, path, line}` and G4 compares vendor strings rather than recorded model family. It also belongs at the end of S5, not behind graph work. |
| S8 | **PACKAGE-READY, SEQUENCE-BLOCKED** | I found no stop-work defect in `graph-context-builder` after its endpoint-order/load-time-direction and K-clamp repairs. It may dispatch only after its corrected prerequisites land. |
| S9 | **BLOCKED** | Respecify `graph-store-port` to the reconciled persistent/cross-run boundary and TerminusDB-default-for-port-consumers decision; name the module, signatures, records, capabilities, and errors. Propagate `terminusdb-operations`' real rebuild set (`events.jsonl`, `graph.json`, `worklog.jsonl`, run JSON) to the port and KC-13. Remove `Mention` reification from port proposal/design/Task 6, and replace stale `--directed` prerequisites with endpoint-order/load-time reconstruction. |
| S10 | **BLOCKED** | In `graph-eval-falsification`, make the proposal and T1 agree with the normative rule that the census governs GP-5 only, replace KC-13's nonexistent `GraphUpdate` input, and either rename KC-7 as syntactic citation compliance or add a discriminator that rejects a valid but semantically unrelated edge ID. `wsl-ci-parity` itself is out of scope and is not certified here. |

## Remaining findings: blocked vs fixable in flight

The distinction below is operational: **BLOCKED** means the contract or task
must change before a worker starts that affected package. **FIXABLE IN FLIGHT**
means the worker can safely start from the current contract and close the gap as
an explicit implementation/evidence task.

### BLOCKED — change before dispatch

1. **S1 executable scope:** replace the three-SDD-only executable
   requirement/Task 3/test with the complete directly-executed inventory. The
   landing row's “34 scripts + `nats/setup.sh`” is itself ambiguous: there are
   34 `.sh` files under the directory **including** `nats/setup.sh`; use a
   manifest, not that number.
2. **S2 workflow ownership:** remove the duplicate workflow ownership from
   `test-infrastructure-hardening` before its worker starts.
3. **S2 fourth-model orphan:** `formal-model-suite` must include
   `evidence_contract.qnt` and M4 in every “all models” obligation before a
   worker implements a three-model gate.
4. **Landing-order propagation:** apply RECONCILE R2 to the actual stage table:
   correct S4 order, early graph-eval instrumentation, groundedness at the end
   of S5, and the corrected graph tranches. The current claim that every stage
   is independently taggable is false under its own package dependencies.
5. **Round escape hatch:** qualify the unowned refusal and its test with the
   named escape-hatch exception; the same enabled/unowned state cannot both
   refuse and run.
6. **Doctrine deadlock:** add the `closes_in` field and its two gate semantics.
   Current doctrine says a knowingly false claim fails the per-merge docs gate
   while also instructing sibling packages to close it later.
7. **S4/S5 audit-call seam:** make adapter T3 preserve, rather than replace,
   the timeout/process-group and verdict/evidence wrapper.
8. **Agy security and evidence:** remove credential seeding; adopt shared-home
   cap 1; replace porcelain comparison with the evidence contract; mutation
   must produce `UNVERIFIED`, not no verdict.
9. **Release metrics:** rewrite T1's absence premises before S6. Literal
   execution after S4 always reaches its “stop” branch.
10. **Work DAG:** remove the impossible `--directed` prerequisite, admit
    recorded model-authored claims with provenance, and resolve/deduplicate
    every changed hunk rather than the first.
11. **Groundedness G2/G4:** implement RECONCILE R5's blob-side citation tuple
    and model-family ownership before any blocking mode is built. The current
    G2 has the already-accepted deleted/old-side false positive.
12. **GraphStore contract:** narrow the port boundary, apply the decided
    default, define its API, remove the orphan `GraphUpdate` input, resolve the
    `Mention` contradiction, and remove the stale directed prerequisite before
    S9 begins.
13. **Graph falsification:** align GP-5/GP-6 governance, rebuild inputs, and
    KC-7's predicate before S10 begins. A syntactically valid unrelated edge ID
    still scores as a correct citation, so the predicate cannot discriminate
    the property its 72% basis names.

### FIXABLE IN FLIGHT — do not hold unrelated implementation

1. **Lock evidence production:** the MSYS2/Git-Bash trace, pinned digest,
   filesystem coverage, and live fallback result do not exist yet, but T5,
   T7, and T14 explicitly require them before the lock package can finish.
   That is implementation evidence, not a reason to rewrite the lock contract.
2. **Agy empirical readiness:** after the credential/evidence contract is
   corrected, T1's live probes for trust, headless write behaviour, effort
   precedence, schema enforcement, and quota remain legitimate in-flight
   research. Until recorded, the lane must remain not-ready.
3. **Regression-harness budgets:** T5.1 intentionally has the worker measure
   and lock numeric runtime/cost budgets. Tier 2's N=3 bootstrap is weak
   evidence, but the package now makes it on-demand, non-gating research and
   forces small differences to `inconclusive`; it does not stop Tier 0/1 work.
4. **Incidental evidence drift:** update `lock-primitive-hardening` T8's
   “sixteen/nine” OpenSpec counts and TerminusDB's 12.5-month wording to the
   reconciled count/basis while touching those documents. These claims do not
   select an unsafe mechanism.

## Finding-rate judgement

**The finding rate is not genuinely falling; defects are relocating across
fresh seams.** This pass found the structural class still populated:

- a widened S1 landing requirement orphaned from the package that implements it;
- a producer rewritten away from `--directed` while two consumers still require
  it;
- `GraphUpdate` deleted as ownerless in `terminusdb-operations` while
  `graph-store-port` and KC-13 still require it;
- a normative `MENTIONS` exclusion contradicted by the same package's proposal,
  design, and task;
- new S4 telemetry that guarantees S6's premise check stops;
- a canonical content-digest repair bypassed by agy's old porcelain predicate;
- a harness-owned `UNVERIFIED` repair contradicted by agy's “no verdict” task;
- a fourth Quint model created without entering the formal suite that promises
  to check “all models”;
- two previously accepted groundedness repairs, G2 and G4, still absent from
  the owning package; and
- KC-7 still unable to distinguish a supporting citation from an unrelated
  valid ID.

Those are architecture, joint unsatisfiability, orphaned ownership, and
non-discriminating predicates. The incidental residue is small, but release
convergence is governed by the structural class, and that class is not empty.
The lower count of old defects therefore does not establish convergence.

## Cross-fix contradictions

Ranked by the work they stop:

1. **RECONCILE versus `LANDING-ORDER.md`:** the final table retains the reversed
   S4 order, omits early graph-eval instrumentation, and leaves the groundedness
   gate coupled to S7 graph work.
2. **Executable widening versus implementation package:** the landing row and
   current mode edits widened; `crlf-extensionless-hardening` did not.
3. **Telemetry producer versus metrics consumer:** S4 creates exactly the
   fields and emits S6 T1 requires to be absent.
4. **Evidence/verdict owners versus agy:** agy retains the two predicates the
   evidence and verdict packages replaced.
5. **Directed producer versus consumers:** knowledge refresh correctly
   publishes `directed:false`; work-DAG and GraphStore still require
   `--directed`.
6. **Rebuild-source siblings:** operations removes the undefined journals;
   port and evaluation still consume them.
7. **MENTIONS inside one package:** normative spec says derived-only and no
   `Mention` document; proposal, design, and Task 6 say reify it now.
8. **Audit wrapper ownership:** three-outcome owns the wrapper; adapter T3 says
   replace the same inline block without a preservation requirement.
9. **Formal asset versus formal gate:** M4 and its fourth model exist and
   typecheck, while the suite's proposal, requirement, CI task, and final gate
   all say three.

## Verified correct

- **Strict OpenSpec structure:** a fresh
  `openspec validate --changes --strict --json --no-interactive` classified 23
  live packages passing and the ten declared pre-existing packages failing.
  Structural validation does not detect the semantic contradictions above.
- **Directed claim, without running Graphify:** installed `cli.py`'s `update`
  parser accepts only `--force` and `--no-cluster` and exits 2 on another
  option; `watch.py` calls `build_from_json(result)` with no directed keyword,
  and the extract cadence calls `build(...)` with no such keyword. Thus
  `graphify update --directed` is rejected by the inspected source and neither
  publishing cadence constructs a directed graph. I did not invoke Graphify.
- **Endpoint-order evidence:** `jq` over the committed
  `graphify-out/graph.json` returned `directed:false`,
  `multigraph:false`, 3,668 links, 1,465 descending, 2,202 ascending, and one
  self-edge. The replacement zero-descending gate is therefore non-vacuous on
  this corpus. It establishes endpoint-order survival, not parallel-edge
  survival.
- **Kill-criterion repair:** the current register gives explicit uncomputable
  branches to the four sampled live-pass cases KC-4, KC-5, KC-7, and KC-12.
  KC-13 records the old 900-second threshold, the measured 5.1 seconds
  (`900 / 5.1 = 176.47`), and the new 60-second bound.
- **Positive-control registry:** `test-infrastructure-hardening` now defines
  `tests/positive-control-registry.tsv`, its identity key and schema, and a
  scanner over the whole repository tree at the commit under test rather than
  the diff, including empty/stale inventory failures.
- **Evidence roots:** `evidence-contracts` now requires a Git work root and a
  separately digestible artifact root that need not be Git-backed; audit roots
  differ, and the tasks and scenarios exercise both legal and refusal arms.
- **Other evidence repairs sampled:** canonical absence/deletion/symlink/type
  encoding, attempt-fresh artifacts, Tier 1 fail-then-pass demonstrations, and
  the cut/non-gating treatment of the expensive regression tiers are aligned
  across requirement and task.
- **Quint:** all four `.qnt` files typechecked under the available Quint 0.32.0.
  Bounded random runs reproduced the expected violating/holding pair for lane
  lifecycle, event-log locking, audit-gate freshness, and evidence freshness
  (1,000 samples for each general pair; 2,000 for the lane post-fix arm). These
  are sampled checks, not proofs.
- **TerminusDB schema evidence:** the committed live-verification report contains
  the corrected second run: five passes, zero failures after adding
  `GraphNode.graphify_version`. The report is now present and no longer says the
  opposite of the current claim.

## Could not check

- I did not run, update, refresh, or build Graphify, as required. Graphify
  conclusions above come from source inspection and the committed JSON only.
- I did not read or coordinate with the parallel Opus final lane.
- I did not modify any package, formal model, landing-order file, or prior
  report; only this report was written.
- I did not live-run MSYS2/Git-Bash lock tracing, the Windows fallback, agy
  authentication/quota/schema behaviour, vendor concurrency, or final WSL CI.
- I did not restart TerminusDB or independently replay the committed 5/5
  transcript. Its stated exclusions remain: exactly-one target, optional
  cardinality, subdocument provenance, CAS, branch-prefixed diff behaviour, and
  all 24 competency queries.
- I did not run `quint verify`; the model evidence in this pass is typechecking
  plus bounded randomized `quint run`.
- The ten pre-existing non-validating packages were outside scope. I inspected
  `crlf-extensionless-hardening` only as narrowly necessary to answer the
  explicit S1 dispatch question; S3 and `wsl-ci-parity` are not certified.
