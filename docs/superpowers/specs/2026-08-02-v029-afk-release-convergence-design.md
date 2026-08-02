# v0.2.9.0 AFK Release Convergence Design

## Decision

Use evidence-first release convergence.

Do not execute the stale checklist as a task list.
Do not treat every unticked OpenSpec task as missing code.
First, compare each task with the code and test that consume its deliverable.

The operator authorized this design for unattended execution on 2026-08-02.
The operator also authorized the architect to select recommendations without approval pauses.

## Goal

Finish the scoped v0.2.9.0 release.

Implement each real in-scope gap.
Record each deferred capability in a new v0.3.x package.
Archive each completed v0.2.9.0 package.
Tag only after all release gates pass.

## Authoritative Inputs

Use the following sources in this order:

1. Use `.foreman/session.db` for decisions, obligations, and measurement freshness.
2. Use Git commits and worktree status for implemented state.
3. Use consuming code and fail-capable tests for capability state.
4. Use OpenSpec packages for the intended contract.
5. Use `checklist.md`, `ROADMAP.md`, and release notes as reading aids.

SessionDB Fact 238 moves these packages to v0.3.0:

- `graph-context-builder`
- `graph-dogfood`
- `graph-eval-falsification`
- `work-dag-projection`

Keep their specifications, kill criteria, and off-switch contract intact.
Do not enable a default graph-context path in v0.2.9.0.

## Alternatives

### Direct checklist sprint

This approach edits each unticked release criterion directly.
It is fast when the checklist is current.
The checklist is not current in this repository.

Reject this approach because it conflicts with SessionDB Fact 238.

### Unticked-task implementation

This approach treats every unticked OpenSpec task as missing implementation.
It appears exhaustive.
Many tasks already name deliverables that exist and pass tests.

Reject this approach because it repeats delivered work.
It also restores the deferred graph plane to the release scope.

### Evidence-first convergence

This approach derives package state from executable evidence.
It separates record debt from implementation debt.
It preserves incomplete work as explicit v0.3.x scope.

Select this approach.

## Release Architecture

Foreman is the execution and release-control plane.
Grok is the implementation lane.
Council is the advisory review plane.
The architect owns specifications, verification, findings, and merge decisions.

Only `gate-eval.sh` and `merge-gate.sh` can authorize merge or release.
Council never writes a gate artifact.

Each work package uses this state sequence:

```text
SPECIFIED -> GROK_IMPLEMENTED -> ARCHITECT_VERIFIED -> COMMITTED
          -> COUNCIL_REVIEWED -> REWORKED_OR_ACCEPTED -> FOREMAN_GATED
          -> MERGED -> RECORDED
```

Any failed verification returns the package to `SPECIFIED`.
Any admissible `changes_requested` verdict returns the package to `SPECIFIED`.
Any stale bundle makes all verdicts for that bundle inadmissible.

## OpenSpec Structure

Create one temporary change package named `v029-release-convergence`.

The package contains the release-only convergence contract.
It does not replace the capability packages that own product behavior.

The package must contain:

- `proposal.md`
- `design.md`
- `tasks.md`
- `specs/release-convergence/spec.md`
- `evidence/package-matrix.tsv`

Each matrix row has these fields:

```text
package<TAB>disposition<TAB>owner_requirement<TAB>consumer<TAB>verification<TAB>result_artifact
```

Use one disposition value:

- `v029-implemented`
- `v029-gap`
- `v030-deferred`
- `parked`
- `withdrawn`
- `split`

Do not mark a row `v029-implemented` without a consumer and verification command.
Do not mark a row `v030-deferred` without a destination package or preservation file.

Archive `v029-release-convergence` before the release tag.

## Work Packages

### Package 0: Review-plane recovery

Complete the `agy` Setup admission needed by the Council Google reviewer.
Use the existing `agy-lane-activation` contract.
Use the shared-home fallback with concurrency one if clean credential seeding is not ready.

Finish the uncommitted Council Task 2 rework in its existing worktree.
Verify the rework again because the restart removed its `/tmp` artifacts.
Commit the verified rework on the Council implementation branch.

Build a new immutable Council bundle.
Require three admissible verdicts from at least two model-family domains.
Use non-author reviewers only.

### Package 1: Scope and package reconciliation

Create the `v029-release-convergence` OpenSpec package.
Build the package matrix from current code, tests, commits, and OpenSpec tasks.

Correct `checklist.md` to match SessionDB Fact 238.
Narrow criterion 7 to deferral and disabled-path proof.
Do not report deferred graph work as implemented.

For each partially delivered package, split the unimplemented contract into a v0.3.x package.
Archive the completed v0.2.9.0 portion with its evidence.

### Package 2: Safety and negative controls

Implement criterion 4 at the `kind: gate` and `check_id` unit.
Use a fail-capable control for each registry row.
Prove registry completeness against the gate inventory.

Fix the Tier 2 trigger-scan scope gap.
Add an honest `unavailable` path for Tier 2 cost.
Do not run paid Tier 2 comparisons.

Correct the six stale claims in `test-infrastructure-hardening`.
Close only tasks whose consuming code and tests prove delivery.

### Package 3: Audit and telemetry honesty

Define one per-package audit artifact.
Bind it to the package, source commit, tree hash, diff hash, worker family, and auditor family.
Build an index that refuses missing or stale artifacts.

Publish Foreman's measurement sigma before release comparisons.
Render an unavailable sigma as `not_evaluated`.
Do not call an unmeasured delta an improvement.

Close criteria 5 and 8 only from these artifacts.

### Package 4: Documentation, plugin, and freshness tooling

Correct stale checklist annotations.
Remove live TerminusDB doctrine outside dated history.
Prove plugin drift detection with known-bad fixtures.

Implement a freshness sweep that reports every stale measurement.
Do not execute an arbitrary stored command without the explicit apply mode.
Run the apply mode only at the final candidate commit.

### Package 5: Release finalization

Archive each shipped OpenSpec package.
Validate every active and archived change under strict mode.
Refresh the repository graph after the final source commit.

Run the full local release gate.
Resolve every new failure through the same Grok and Council loop.

Refresh all release measurements at the final candidate commit.
Complete the devlog correction block.
Update `ROADMAP.md`, `checklist.md`, and release notes.

Create tag `v0.2.9` with message `Total GeorgeCall` only after all gates pass.

## Grok Implementation Contract

Give Grok one five-part specification per task.
Pass each prompt through a file.
Use one isolated worktree per implementation round.

Require Grok to:

- write the failing test first
- run the focused test and record the failure
- implement the minimum change
- run focused verification
- write `FOREMAN_REPORT.md` and `FOREMAN_REPORT.json`
- avoid Git write commands inside a restricted sandbox

The architect commits verified changes.

## Council Review Contract

Build a bundle only from committed commits.
Require different base and head commits.
Record the diff content hash.

Blind worker and provider identity before review.
Keep the identity map outside reviewer input.

Use three admissible verdicts from at least two failure domains.
One admissible `changes_requested` verdict blocks progress.
Missing or malformed output is not approval.

## Verification Contract

Re-derive claims from consuming code.
Do not verify a specification by repeating only its supplied command.

Use these release-wide checks:

```bash
openspec validate --all --strict
FOREMAN_CI_BATS=1 bash tools/ci-local.sh
bash skills/foreman/scripts/docs-check.sh
bats tests/line-endings.bats
git diff --check
```

Run Bats through the Foreman gate queue during concurrent work.
Run the full suite once per merge candidate.

## Failure Handling

Preserve every dirty worktree after a failed round.
Do not reset or clean crash-preserved edits.

If Grok is unavailable, stop that implementation round.
Do not silently substitute a same-family worker.

If Council lacks quorum, record `quorum_not_met`.
Run a new round after the missing review lane becomes ready.

If a stored measurement command is unsafe or obsolete, retire the measurement with a reason.
Do not run it to satisfy a count.

## AFK Checkpoints

Write a SessionDB checkpoint at least once per hour.
Record commit identities and state hashes.
Do not record process liveness as a fact.

Write an additional checkpoint before each long provider dispatch.
Write an additional checkpoint after each accepted package.

## Completion Conditions

The AFK goal is complete only when all conditions are true:

- Every v0.2.9.0 package has executable implementation evidence.
- Every deferred item has a v0.3.x destination and preserved contract.
- No release-blocking obligation remains open.
- Every quoted release measurement is fresh at the final candidate commit.
- Council has no unresolved admissible `changes_requested` finding for the final bundle.
- Foreman release gates pass.
- The release record and tag exist.

Do not tag a partial release.
