# M4 — The Foreman evidence contract

## Outcome

The model reproduces concrete counterexamples for D1, D2, D3, and D5 at the
level that the current specifications actually admit:

- D1: a no-op planning lane inherits an already-valid artifact and succeeds.
- D2: under Foreman's modeled two-root topology, no one root is both the
  external run directory and a Git worktree.
- D3: deletion makes the current byte-and-mode tree record undefined.
- D5: a rewrite of an already-untracked file changes content while porcelain
  stays silent.

I could not reproduce D4 honestly. The current normative specification already
requires the set to be non-empty, derived from the lane type and assignment,
and recorded before dispatch. `pre_fix` therefore refuses a wrong declaration
instead of admitting it. The “already satisfied” form is the D1 freshness
defect, not an independent declaration-order defect.

There is one further qualification: `-uall` fixes the nested-file porcelain
case. The model violates that arm only in `legacy_porcelain`, not in current
`pre_fix`. D5 remains reproducible under current `-uall` for a content edit to
an already-untracked file.

The proposed repairs had no counterexample in 10,000 sampled traces of depth
five, or in 10,000 sampled traces against each isolated defect entrypoint at
the depths in the results table. This is bounded random-simulation evidence,
not a proof of correctness.

## What is modelled

`formal/specs/evidence_contract.qnt` models one lane round and the acceptance
boundary that turns its artifacts into `RoundSuccess` or `RoundFailure`.
The lane can be `Implement`, `Audit`, or `Planning`.

The state records:

- whether the deliverable declaration is non-empty, pre-dispatch, and equal to
  the set derived from the assignment;
- the current attempt and the full
  `{diff, tree, base, head, attempt}` evidence tuple;
- artifact existence, non-emptiness, separate model-output/harness schema
  validity, completeness, pre-round and post-round content identity, and bound
  evidence tuple;
- the reviewed Git root and external report root;
- validator and planted-positive-control outcomes;
- actual work, porcelain change, authoritative content-digest change, and
  whether tree identity is defined;
- the evidence observation and final round result.

The current lane-type predicates are represented directly:

- implement requires a declared content change and zero-exit validator;
- audit requires a schema-valid external artifact and unchanged reviewed tree;
- planning requires a present, non-empty artifact and zero-exit validator.

An unchanged digest is recorded as `EvidenceInconclusive`, not as a terminal
verdict. Every success path is also gated by `positiveControlPassed`.

The file follows the existing `audit_gate.qnt` pattern: one parameterized
module and concrete `pre_fix` / `post_fix` instances. `legacy_porcelain`
exists only to isolate the historical missing-`-uall` blind spot.

## Invariants in plain English

| Quint invariant | Plain-English claim |
|---|---|
| `inv_d1_success_requires_current_artifact` | A successful audit/planning round must end with a complete artifact from the current attempt, bound to the current diff, tree, base, and head. |
| `inv_d2_audit_roots_satisfiable` | Every dispatched audit has a Git-backed reviewed-tree root and a distinct external report location whose evidence can be computed. |
| `inv_d3_deletion_digest_total` | Deleting a declared deliverable yields a defined identity and an observable content change, distinct from doing nothing. |
| `inv_d4_dispatch_declaration_sound` | Every declaration that reaches dispatch is non-empty, was recorded before dispatch, and equals the artifact set derived from the assignment. |
| `inv_d5_porcelain_reports_every_write` | Diagnostic only: every actual write changes the porcelain signal. This is expected to be false in both main configurations. |
| `inv_d5_silent_porcelain_cannot_hide_work` | If actual work leaves porcelain silent, the authoritative content identity still observes it. |
| `inv_success_requires_positive_control` | No round can succeed unless the planted-write controls passed. |
| `inv_unchanged_observation_is_not_terminal_evidence` | An inconclusive evidence observation is not itself a pending terminal decision. |

## Method and tool outcome

I created the `.qnt` module skeleton as the first repository action, before
reading or analysing the source specifications, then filled that artifact in
place. I did not invoke Graphify and did not build or refresh a knowledge
graph.

Quint 0.32.0 typechecked the file with exit 0 and no diagnostics:

```text
quint typecheck /root/foreman/formal/specs/evidence_contract.qnt
[no output]
```

I attempted the requested Apalache check first:

```text
quint verify formal/specs/evidence_contract.qnt \
  --main=pre_fix \
  --invariant=inv_d1_success_requires_current_artifact \
  --max-steps=3
```

Apalache 0.56.1 was found, but the check never started. Its local gRPC server
failed in this sandbox with:

```text
java.net.SocketException: Operation not permitted (Socket creation failed)
Error while starting Apalache server
```

There was no anchored `[violation]` or `[ok]` line, so this is a tooling
failure, not a model result. I did not classify it by substring.

All results below therefore came from `quint run` using the Rust randomized
simulator. Outcomes were read only from lines anchored as
`^\[violation\]` or `^\[ok\]`. The defect traces use one sample because each
custom `step_dN` has exactly one enabled path at each state; the repaired arms
use 10,000 samples. The custom step names are part of every command and are
called out because they are non-default entrypoints.

| Module / entrypoint | Invariant | Samples × max steps | Anchored outcome |
|---|---|---:|---|
| `pre_fix / step_d1` | D1 | 1 × 3 | `[violation]` |
| `pre_fix / step_d2` | D2 | 1 × 2 | `[violation]` |
| `pre_fix / step_d3` | D3 | 1 × 3 | `[violation]` |
| `pre_fix / step_d4` | D4 sound dispatch | 10,000 × 2 | `[ok]`; refusal witnessed 100% |
| `pre_fix / step_d5` | D5 signal completeness | 1 × 3 | `[violation]` |
| `post_fix / step_d1` | repaired D1 | 10,000 × 3 | `[ok]` |
| `post_fix / step_d2` | repaired D2 | 10,000 × 2 | `[ok]` |
| `post_fix / step_d3` | repaired D3 | 10,000 × 3 | `[ok]` |
| `post_fix / step_d4` | unchanged current D4 guard | 10,000 × 2 | `[ok]`; refusal witnessed 100% |
| `post_fix / step_d5` | D5 authoritative fallback | 10,000 × 3 | `[ok]` |
| `post_fix / step_d5` | D5 porcelain completeness | 1 × 3 | `[violation]` |
| `legacy_porcelain / step_d5_nested` | nested add signal completeness | 1 × 3 | `[violation]` |
| `pre_fix / step_d5_nested` | nested add with `-uall` | 10,000 × 3 | `[ok]` |
| `post_fix / step` | all repaired safety predicates combined | 10,000 × 5 | `[ok]` |

The general five-step runs also checked reachability. Current-artifact success,
stale no-op success, audit-root conflict, undefined deletion, and
silent-porcelain work all had non-zero witness counts in `pre_fix`.
Current-artifact success and silent-porcelain work remained reachable in
`post_fix`. The isolated D4 run reached the explicit `Refused` state in 100% of
10,000 traces. Thus clean repaired checks are not merely consequences of
making ordinary success or silent porcelain unreachable.

An `[ok]` random-simulation result means only that no counterexample appeared
in those sampled traces within that depth. It does not establish correctness.
Even a bounded exhaustive result would establish only absence within its
bound, not unbounded correctness; no bounded exhaustive result was obtained
here.

## D1 — pre-existing artifact credits a no-op lane

### Counterexample

Command (non-default `--step=step_d1`):

```text
quint run formal/specs/evidence_contract.qnt \
  --main=pre_fix --step=step_d1 \
  --invariant=inv_d1_success_requires_current_artifact \
  --max-steps=3 --max-samples=1 --verbosity=3 --mbt
```

Seed: `0x6a662ce668de64f4`.

| State | Action | Current attempt/tuple | Artifact | Work/evidence | Result |
|---:|---|---|---|---|---|
| 0 | `init` | all ids `1` | absent | no work | pending |
| 1 | `dispatchPlanningWithStaleArtifact` | all ids `1` | complete and valid, but attempt/ids `0` | no work; pre-satisfied | pending |
| 2 | `finishRound` | all ids `1` | unchanged attempt-zero artifact | `EvidenceInconclusive` | **success** |

The planted-write control passes and the validator exits zero, but neither fact
connects the artifact to this lane attempt. The current predicate sees a
present, non-empty package and accepts it.

### Repair

`artifactBoundToCurrentRound` requires `complete`, a content identity different
from the pre-round artifact, and equality on
`{diff, tree, base, head, attempt}`. `post_fix` conjoins that predicate for
audit and planning success. The isolated post-fix arm found no counterexample
in 10,000 traces of depth three.

This repair permits an artifact to exist before dispatch, but it cannot earn
success unless this attempt replaces it with a current, complete artifact.

## D2 — one audit evidence root cannot meet both roles

### Counterexample

Command (non-default `--step=step_d2`):

```text
quint run formal/specs/evidence_contract.qnt \
  --main=pre_fix --step=step_d2 \
  --invariant=inv_d2_audit_roots_satisfiable \
  --max-steps=2 --max-samples=1 --verbosity=3 --mbt
```

Seed: `0x67143e3ad714aeb`.

| State | Action | Reviewed root | Report/evidence root | Requirement result |
|---:|---|---|---|---|
| 0 | `init` | `ReviewedWorktree` (Git) | `ExternalRunDirectory` (not Git) | not dispatched |
| 1 | `dispatchAuditToExternalRunDirectory` | Git-backed | outside reviewed tree, not Git-backed | **unsatisfiable** |

The counterexample assumes the topology described by the package: the reviewed
worktree and the stable external run directory are the two available roots.
Under that topology, choosing the reviewed root violates “outside”; choosing
the run directory violates the generic “evidence root is a Git worktree” rule.

This is conditional, not a theorem that no filesystem location could ever
satisfy the prose. An operator could create a third external Git worktree.
The current package does not require or provision one, and the normal run
directory is not one.

### Repair

`post_fix` gives the contract two named roots:

1. `reviewedRoot`, which must be Git-backed and supplies the reviewed-tree
   identity and tamper check;
2. `reportRoot`, which must be outside the reviewed tree and whose named
   artifact is hashed directly without a Git-root precondition.

The repaired root invariant had no counterexample in 10,000 traces of depth
two.

## D3 — deletion has no total tree identity

### Counterexample

Command (non-default `--step=step_d3`):

```text
quint run formal/specs/evidence_contract.qnt \
  --main=pre_fix --step=step_d3 \
  --invariant=inv_d3_deletion_digest_total \
  --max-steps=3 --max-samples=1 --verbosity=3 --mbt
```

Seed: `0x5b7c1033e76b66ec`.

| State | Action | Deliverable | Digest defined | Content change observed | Evidence |
|---:|---|---|---:|---:|---|
| 0 | `init` | absent baseline | yes | no | not run |
| 1 | `dispatchImplementDeletion` | exists and is declared | yes | no | not run |
| 2 | `deleteAssignedDeliverable` | correctly absent | **no** | **no** | inconclusive |

Porcelain reports the deleted path, but the specified record demands its
working-tree mode and SHA-256 of bytes. Neither exists after deletion. The
current identity is therefore partial, and deletion collapses into “not
observed” rather than differing from no work.

### Repair

The model uses `ENCODE_DELETION_ABSENCE` to represent a total identity. The
implementation should use a tagged canonical record, conceptually:

```text
Present(path, mode, sha256(bytes))
Absent(path)
```

It should not invent empty-string or zero sentinels that can collide with a
real field. With the absence variant enabled, deletion has a defined
post-state identity and the pre/post records differ. The repaired invariant had
no counterexample in 10,000 traces of depth three.

## D4 — not reproduced: current prose already closes the declaration arms

I could not reproduce D4 as an independent defect without contradicting the
authoritative current requirement. It already says:

1. the set is explicit and non-empty;
2. it is resolved from the lane type and assignment;
3. it is recorded before vendor invocation; and
4. a round with no resolvable non-empty set is not dispatched.

The model therefore represents an attempted wrong declaration as
`refusePlanningWithWrongSet`, which reaches `Phase = Refused` and
`RoundFailure`. It does not permit a bad declaration to reach `Dispatched`.

Command (non-default `--step=step_d4`):

```text
quint run formal/specs/evidence_contract.qnt \
  --main=pre_fix --step=step_d4 \
  --invariant=inv_d4_dispatch_declaration_sound \
  --witnesses witness_wrong_declaration_refused \
  --max-steps=2 --max-samples=10000 --verbosity=1
```

Anchored outcome: `[ok] No violation found`. The refusal witness was reached in
10,000 of 10,000 traces. This is sampled confirmation of the modeled guard,
not an exhaustive proof.

The “can a lane declare a set it has already satisfied?” question is real, but
its unsafe consequence is D1: current planning success does not require the
artifact to change during this attempt. Existing artifacts cannot simply be
forbidden because modification lanes legitimately start with existing files.
The discriminating repair is the D1 pre/post content-identity and attempt
binding, not a blanket “must be absent before dispatch” declaration rule.

No additional post-fix D4 predicate is proposed. An implementation should
still record assignment-set and declaration-set identities so it can
demonstrate conformance, but the normative behavior is already specified.

## D5 — porcelain is silent while work occurs

### Current `-uall` counterexample

Command (non-default `--step=step_d5`):

```text
quint run formal/specs/evidence_contract.qnt \
  --main=pre_fix --step=step_d5 \
  --invariant=inv_d5_porcelain_reports_every_write \
  --max-steps=3 --max-samples=1 --verbosity=3 --mbt
```

Seed: `0xc0900b146809b949`.

| State | Action | Actual work | Porcelain changed | Content digest changed |
|---:|---|---|---:|---:|
| 0 | `init` | none | no | no |
| 1 | `dispatchPlanningWithCorrectSet` | none | no | no |
| 2 | `rewriteAlreadyUntrackedDeliverable` | byte rewrite | **no** | **yes** |

This reproduces the acknowledged residual blind spot with `-uall`: the status
line remains `?? path`, so a byte edit does not change the path-level signal.
The same shape covers a second edit of an already-modified tracked file.

### Nested-file qualification

The historical `legacy_porcelain` configuration omits `-uall`. Adding a file
below a directory already collapsed to `?? dir/` violates signal completeness
in one sample of depth three.

The current `pre_fix` configuration sets `PORCELAIN_UALL = true`; the same
nested-add invariant had no counterexample in 10,000 traces of depth three.
That agrees with `evidence-contracts/design.md`: `-uall` lists each untracked
file and fixes this particular blind spot. I therefore did not claim that the
current specified `-uall` signal misses the nested add.

### Repair

There is no honest predicate that makes porcelain content-complete. It remains
blind in `post_fix`, and `inv_d5_porcelain_reports_every_write` still violates.
The repaired safety predicate is instead
`inv_d5_silent_porcelain_cannot_hide_work`: authoritative content identity must
observe the work whenever porcelain is silent. That invariant had no
counterexample in 10,000 traces of depth three and in the combined depth-five
run.

Thus D5 is a reproduced signal defect, not a newly discovered failure of the
current prose's final verdict rule; the current prose already demotes
porcelain to corroboration.

## New cross-spec defect exposed

The model exposes a schema ownership mismatch, not another successful no-op
trace.

`evidence-contracts` requires the external audit verdict to validate under
`adapters/verdict.schema.json`. `three-outcome-verdicts` deliberately keeps
that model-facing schema to `APPROVED | WARNING | BLOCKED`, while requiring
the harness-written `audit-verdict.json` to carry `UNVERIFIED`, `state`, and
the five-field evidence reference.

The model therefore records two distinct facts:

- `modelSchemaValid = false` for the mandatory
  `UNVERIFIED/in_progress` prepublication;
- `harnessSchemaValid = true` for the same complete harness document.

Command (non-default `--step=step_prepublish`):

```text
quint run formal/specs/evidence_contract.qnt \
  --main=pre_fix --step=step_prepublish \
  --invariant=inv_d1_success_requires_current_artifact \
  --witnesses witness_prepublish_schema_split \
  --max-steps=3 --max-samples=10000 --verbosity=1
```

The D1 invariant had anchored outcome `[ok]`; the current literal
model-facing-schema check rejects the in-progress artifact, so it does not
produce success. The schema-split witness was reached in 10,000 of 10,000
traces.

The new defect is contractual ambiguity about which schema validates the
harness artifact consumed by the evidence contract. If the literal
model-facing schema is used, the mandatory `UNVERIFIED/in_progress` artifact
cannot satisfy it. If a harness schema is intended, the evidence contract must
name that schema and must separately require `state == complete` before audit
success. The repair is explicit schema ownership plus
`attempt/current evidence tuple/state == complete`, not
freshness-by-file-write.

## What was abstracted away

### Opaque ids instead of bytes and Git strings

SHA-256 values, Git object ids, paths, and attempts are small integer ids.
The properties use only equality, mismatch, and presence, so concrete strings
or cryptographic computation would add state without changing a guard.
Collision resistance is assumed; cryptographic collisions are out of scope.

### One representative deliverable

The artifact set is represented by one witness artifact plus declaration
metadata. This is safe for the counterexamples: a single stale, deleted, or
wrongly declared member is enough to refute the corresponding universal
claim. The model does not measure package cardinality or enumerate four
OpenSpec files.

### Two-root Foreman topology

The root domain contains the reviewed Git worktree and the non-Git external
run directory. This matches the deployment described by the findings but is
not universal filesystem reasoning. D2 is therefore conditional on that
topology; adding and provisioning an external Git worktree would create a
satisfying current-style location at operational cost.

### Atomic filesystem and validator observations

Shell commands, rename mechanics, file races, permissions, symlinks, and
validator internals are abstract booleans or atomic transitions. The five
modeled target properties do not depend on interleaving inside a hash or
validator call. A
production canonical deletion identity must still specify symlink,
type-change, rename, mode, unreadable-path, and race behavior.

### Positive controls

`positiveControlPassed` is modeled as already true so the target states
demonstrate that a healthy mechanism control does not provide attempt
freshness, root satisfiability, declaration correctness, or a total deletion
grammar. The separate invariant ensures success cannot bypass the control.
Control execution/reversion is not modeled.

### No retry or liveness model

The bounded evidence loop, budgets, termination reasons, and merge gate are
outside this model. This artifact asks whether one completed round's evidence
predicate discriminates work from no work; the other Foreman models cover
round ownership and audit-gate progression.

## Reproduction commands

All custom runs below use the non-default `step_dN` entrypoints:

```bash
SPEC=/root/foreman/formal/specs/evidence_contract.qnt

quint typecheck "$SPEC"

quint run "$SPEC" --main=pre_fix --step=step_d1 \
  --invariant=inv_d1_success_requires_current_artifact \
  --max-steps=3 --max-samples=1 --verbosity=3 --mbt
quint run "$SPEC" --main=pre_fix --step=step_d2 \
  --invariant=inv_d2_audit_roots_satisfiable \
  --max-steps=2 --max-samples=1 --verbosity=3 --mbt
quint run "$SPEC" --main=pre_fix --step=step_d3 \
  --invariant=inv_d3_deletion_digest_total \
  --max-steps=3 --max-samples=1 --verbosity=3 --mbt
quint run "$SPEC" --main=pre_fix --step=step_d4 \
  --invariant=inv_d4_dispatch_declaration_sound \
  --witnesses witness_wrong_declaration_refused \
  --max-steps=2 --max-samples=10000 --verbosity=1
quint run "$SPEC" --main=pre_fix --step=step_d5 \
  --invariant=inv_d5_porcelain_reports_every_write \
  --max-steps=3 --max-samples=1 --verbosity=3 --mbt

quint run "$SPEC" --main=post_fix \
  --invariants \
    inv_d1_success_requires_current_artifact \
    inv_d2_audit_roots_satisfiable \
    inv_d3_deletion_digest_total \
    inv_d4_dispatch_declaration_sound \
    inv_d5_silent_porcelain_cannot_hide_work \
    inv_success_requires_positive_control \
    inv_unchanged_observation_is_not_terminal_evidence \
  --max-steps=5 --max-samples=10000 --verbosity=1
```
