# Release reconciliation and authorized code-reduction deferral

Record of 2026-09-13. One deferral is authorized here. Every other disposition below remains proposed for review.
No numerical release, publication authority, or criterion change other than the recorded deferral is approved by this artifact.
This record does not reconcile the release program by itself.

## Authorized scope

> On 2026-09-13, the user deferred the 40 percent production-code reduction target to a separate repository-cleanup release.
> The cleanup release has no assigned numerical version.
> The existing release program retains ownership of this deferred obligation until that release receives its own approved scope.
> The 50 percent required-instruction reduction target remains required.
> Frozen measurement inputs and historical failed results remain unchanged.
> This amendment changes only the production-code acceptance threshold's release disposition.
> It does not complete M6 or waive any P1–P15 predicate, host requirement, audit, receipt, or publication requirement.

The full amendment, with its exact requirement mapping, is [scope-amendment-2026-09-13.md](scope-amendment-2026-09-13.md).
The deferred obligation is registered in [`docs/releases/foredi-repository-cleanup/obligation.json`](../foredi-repository-cleanup/obligation.json).

## Current result and decision

C2 source candidate: `bb0c1e9f3868d6bf36a91f78ceec55800192fc5c`.
The [recorded measurement](evidence/m6/instruction-simplification.json) uses the unchanged [baseline](../../release-metrics/foredi-baseline.json), cohort, tokenizer, and thresholds.

| Original M6 criterion | Baseline | C2 | Historical result | Release disposition |
| --- | ---: | ---: | --- | --- |
| At least 40% fewer production nonblank lines | 6,916 | 48,912 | **FAIL**. Maximum permitted count: 4,149. | Deferred from this release to the unnumbered cleanup release. Owner retained: `v050-release-program`. |
| At least 50% fewer required instruction tokens | 16,502 | 8,122 | **PASS**. Reduction: 50.78%. | Retained. Requires fresh final-candidate evidence. |

The historical results are unchanged. “Deferred from this release” is a scope disposition recorded beside the original `FAIL`, not a replacement verdict.
The [C2 acceptance record](m6-instruction-acceptance.json) preserves source, verification, package, and graph identities.
It does not establish completed M6 acceptance or a numerical release.
Instruction improvement is not compensation for the failed production target. The deferral is authorized; the failure is preserved.
Source amendments made after C2 invalidate C2 as the final candidate, so the retained instruction target requires fresh candidate evidence.

## Proposed feature outcomes

Only the production-code deferral recorded above is authorized. Every disposition in the tables below is proposed and is not a replacement mapping in force.
Each original obligation, including the deferred one, remains open until its controlling source and register receive the required reconciliation.
Linked tests identify evidence targets. They do not establish that the original P predicates executed or passed unchanged.

| Original feature and owner | Proposed ForeDi replacement | Retained obligation or unresolved difference |
| --- | --- | --- |
| Lane execution, ownership, watchdog, and adapters. `lane-runtime-typescript` tasks 1–6. | M1 continuations and M4 durable execution replace active lane choreography. M6 migration preserves historical state. Targets: [runner](../../../packages/orchestration/src/pel-runner.test.ts), [crash recovery](../../../packages/orchestration/src/pel-recovery-crash.test.ts), [migration](../../../packages/orchestration/src/pel-migration-cli.test.ts). | Retain single ownership, cancellation, recovery, and truthful unknown outcomes. Explicitly map retired commands and callers. Do not claim exact heartbeat keys, `round_done`, old Bats cases, or `watch.sh` forwarding parity. Active legacy runs retain their original controller. Unavailable controller provenance remains an explicit refusal. |
| Containment, credential profiles, probes, launcher resolution, and cleanup. Lane tasks 0, 4, and 7. | M3 transport boundaries and M4 resource ownership implement the new route. Target: [native qualification](../../../packages/orchestration/src/pel-native-qualification.test.ts). | Retain containment, cleanup, credentials, alerts, and designated-host evidence. Unsupported exact native cells are refused. Fixture execution does not establish live qualification or Windows parity. |
| Candidate verification and receipt reuse. `workflow-weight-reduction` task 2. | M5 bound host receipts and M6 exact reuse replace the old receipt grammar. Target: [verification](../../../packages/orchestration/src/pel-host-verify.test.ts). | Retain candidate, gate, environment, policy, freshness, and provenance checks. Prevent repeated verification and reservation for reusable evidence. Map additional original key components individually. |
| Bound task requests, one wait, audit, and correction. Workflow tasks 3 and 6. | M2 checked source, M4 admission, and M5 explicit task/verify/review programs replace hidden round scheduling. Target: [host delivery](../../../packages/orchestration/src/pel-host-library.test.ts). | Retain admitted models, exact controls, limits, prerequisites, and independent review. Existing tests do not establish the old wait-exit or audit-launch latency promises. |
| Landing freeze and publication. Workflow task 7. | Immutable M5 candidate capture and the existing publication transaction supply the delivery path. Targets: [candidate capture](../../../packages/orchestration/src/pel-candidate-capture.test.ts), [publication](../../../packages/orchestration/src/pel-publication-integration.test.ts). | Retain exact checks, independent review, stale-approval refusal, target recheck, and publication authority. Explicitly map synthetic candidate capture against the old worktree-commit requirement. Archive/delete behavior needs separate evidence. |
| Tier planning, small-change heuristics, queue optimization, test sharding, and doctrine compression. Workflow tasks 4, 5, and 8–12. | No complete ForeDi equivalent. Proposed scope separation avoids reconstructing retired orchestration solely for its command names. | No deferral is approved. These obligations remain with their original owner until source, register, and ROADMAP dispositions change. Existing security and verification requirements remain binding. |
| Instrumentation and numerical optimization. Workflow tasks 0, 1, and 13, plus P12–P15. | M6 fixed-cohort simplification is a ForeDi-specific measurement. It does not replace P12–P15, and no such replacement is authorized here. | The original M6 production reduction fails and is deferred to the cleanup release. Its measurements do not prove idle share, gate duration, landing time, manual-step limits, or the old doctrine read-floor predicate. P12–P15 remain required with their original assertions and evidence. |

M1/M2 language and authoring evidence cannot supply host authority, review receipts, or publication approval.
M3–M6 successor requirements retain those separate responsibilities.
The [M6 specification](../../../openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md) requires executable adoption and unresolved-obligation preservation.
An unversioned package with `version: null` is permitted. It does not authorize a `v0.5.0` tag.

## Original release predicates

All fifteen predicates remain required under the unchanged [v050 design](../../../openspec/changes/v050-release-program/design.md#exit-predicates).
Neither `FAILED` nor `UNCOMPUTABLE` permits publication.
The [release specification](../../../openspec/changes/v050-release-program/specs/release-program/spec.md) also retains exact-candidate audit and publication requirements.

| Predicates | Proposed treatment for later review | Evidence boundary |
| --- | --- | --- |
| P1–P3: architecture, launcher retirement, lane and host cases | Map retirement and active-route behavior to ForeDi tests. Preserve designated-host containment assertions. | [Adapter tests](../../../packages/policy/src/architecture-adapter.test.ts) cannot prove absent Windows or original host rounds. Preserve the original baseline identity. |
| P4–P6: verdicts, grounded review, fresh deliverables | Retain these safety outcomes with explicit codec, provenance, and host-evidence mappings. | Model approval and process exit 0 are insufficient. Different result names do not establish original-case parity. |
| P7: spec triage and discovery | Propose checked Pel source admission for executable programs. Identify a separate owner for natural-language discovery if excluded. | M2 does not prove that arbitrary prose is adequately specified. No exclusion is approved. |
| P8–P10: session bootstrap, runtime integrity, secrets and host preflight | Retain requirements for surviving dependencies and supported hosts. | [Session bootstrap](../../../packages/orchestration/src/session-sqlite-bootstrap.test.ts), actual build integrity, and required live traversal need their exact executed-case evidence. |
| P11: doctrine claims and mutation controls | Preserve truthful shipped claims. Map retired claims explicitly. | Deleting obsolete prose does not prove the fourteen original mutation controls passed. |
| P12–P15: idle share, gate timing, landing benchmark, doctrine read floor | Consider separate ForeDi functional and measurement criteria through an explicit amendment. | No twenty-round sample, timing result, four-workload landing result, or old-tokenizer pass is inferred from M6 fixtures or its 50% result. |

Any changed predicate must retain its former assertion and identify its successor, evidence target, owner, and scope disposition.
Reusing a P identifier must not hide a changed assertion.
Council carryover and other entries already assigned to `v060` do not expand ForeDi scope.
Lane runtime and workflow reduction remain v050 obligations until their controlling records change.

## What an approved reconciliation would require

The current [program tasks](../../../openspec/changes/v050-release-program/tasks.md) require source reconciliation, not a register-only status change.
The [adoption obligations](adoption-obligations.json) retain their three original open entries and source hashes, plus the new deferred production-code entry.
The 2026-09-13 amendment adds that entry and updates the register `reason`. It does not complete the remaining source reconciliation, and it does not modify the program tasks.

1. Carry the deferred production criterion into the separately scoped cleanup release without rewriting its failed measurement.
2. Review an explicit assertion mapping for affected specs, tasks, register entries, and ROADMAP rows.
3. Preserve historical source identities and record new identities for any authorized amendments.
4. Use the existing register checks to validate complete active-change coverage and retained ownership.
5. Evaluate the declared predicates on one unchanged candidate with output digests and executed-case counts.
6. Retain the existing cold audit, version assignment, and authorized publication transaction.

No new orchestration, state owner, scheduler, gate system, or authority is proposed.
The existing root/family/child requirements remain binding. Six Pel milestones do not establish the program’s twelve-child/tranche requirements.
Numerical assignment and publication remain separate authorized actions.

## Source identities for review

These SHA-256 values identify the historical file bytes read from the checkout at C2 HEAD on 2026-09-13, before the scope amendment.
They are review inputs, not replacement obligation identities or completion receipts.
The adoption record’s three task hashes match the task files below as read at that point.
The amended identities are recorded separately after this table. Both sets are retained.

| Source path, relative to repository root | SHA-256 |
| --- | --- |
| `openspec/changes/v050-release-program/specs/release-program/spec.md` | `c38648eb8e894c7d4fc9b847bb1ea849e804ddf7f69293137d02182742697c58` |
| `openspec/changes/v050-release-program/design.md` | `539a2ff8881aca311077b8b8fe25b45870ea33e326ea031fd489995fb28456fe` |
| `openspec/changes/v050-release-program/tasks.md` | `37d340ba58626c3763a9f827db9b740ba5469b16312d7eb162015919a2afb362` |
| `openspec/changes/v050-release-program/coverage.toml` | `a2ef0b0d51647efed5c6f20cd00dfc99443af4eea158a0fabd2b31ab9ab8e902` |
| `openspec/changes/lane-runtime-typescript/specs/lane-runtime/spec.md` | `ea8c5c46e5defd2e27df97a2dec5bc76e1f301b4407197a307293ccaf6a8d800` |
| `openspec/changes/lane-runtime-typescript/tasks.md` | `853e6926bc6792d352dfc0e8243e65353f100ea7b61d18f42500c3d157568729` |
| `openspec/changes/workflow-weight-reduction/specs/workflow-weight/spec.md` | `922403aa148b831073170cbfd26e217ab7e501b6788ac00a5f8a40f95f6d8e06` |
| `openspec/changes/workflow-weight-reduction/design.md` | `154eb48dcdc967e4381c905f481f85e5f79df05a669e338199aebc8fa03409d7` |
| `openspec/changes/workflow-weight-reduction/tasks.md` | `a6118d25bbefbe6db73886d8c935dc77c2125ef22dc0851ed8637d55fb94df6a` |
| `openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md` | `ae55f64fcd88091437b260b8154da97ebc4ef7bc0cfdaae49578c70d994c3198` |
| `openspec/changes/foredi-06-adoption/design.md` | `39af2dc403ae0a2c27fbb5e6e7f590bd620ce5c950661d50ae9ba9c85e1cc814` |
| `openspec/changes/foredi-06-adoption/tasks.md` | `e397e820244fde9974e09b4ad233217711224142de810680763eb05377882405` |
| `ROADMAP.md` | `56707b7fb5594cf662d187e159b12b6279fbc8b13ce89b45af8ac1b394d25350` |
| `docs/releases/return-of-the-foredi/adoption-obligations.json` | `b9d453f9ec245f860127d36e74d203af1cb7d97568221cca016222d4482f1706` |
| `docs/release-metrics/foredi-baseline.json` | `3e6ec17a8d55a510a13889440ded8e3de3c84a7ce60ac26c409dfbae3c22e4c0` |

`docs/release-metrics/foredi-baseline.json` is unchanged by the amendment. Its identity above remains current.

### Amended source identities, 2026-09-13

| Source path, relative to repository root | Amended SHA-256 |
| --- | --- |
| `openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md` | `d57a13918fac6d06ee8c3c65620d88b76dfc2a0e074a8249342076083654b2a4` |
| `openspec/changes/foredi-06-adoption/catalog.json` | `1801edd923899001727ee4e058cc70e2c1df437f92c29a38db887e1a63e4179f` |
| `openspec/changes/foredi-06-adoption/design.md` | `d14cc81f038c7eeb0a97f3b1afcfa5b04aaf837dd1c7239464a2bf05afef48a8` |
| `openspec/changes/foredi-06-adoption/tasks.md` | `3c9a725dc9c57d20b4c2e03b693889d7aabd7e09189294a631fef02decf2d7ff` |
| `openspec/changes/v050-release-program/coverage.toml` | `80eca739c01d9c7c61f01271decf848e4409dfe660b070a19f47be8ffd5e245c` |
| `docs/releases/return-of-the-foredi/adoption-obligations.json` | `fd8804d4645f043586c845c956edb907911999f86b32e8d2b659e89380787e77` |
| `ROADMAP.md` | `5187a6b3ea945de7205d6c5e0fdea6872a924f2d080f7bc4cd46f45661d52530` |

The `coverage.toml` identity in the historical table above (`a2ef0b0d…`) predates both this amendment and the register state recorded in the adoption obligations. Treat the amended value as current.

### R-M6-011 former-to-current mapping

| Position | Text |
| --- | --- |
| Former requirement | The Foreman migrated workflow cohort SHALL reduce orchestration glue lines by at least 40 percent and required instruction tokens by at least 50 percent. |
| Current requirement | The Foreman migrated workflow cohort SHALL reduce required instruction tokens by at least 50 percent and report production-code counts under the unchanged frozen measurement contract. |
| Former `T-M6-011` result | Net glue reduction is at least 0.40 and instruction reduction at least 0.50. Moving code or instructions outside old paths does not remove them from counts. |
| Current `T-M6-011` result | Instruction reduction is at least 0.50. The report retains raw production counts and the original production-target result. Moving code or instructions outside old paths does not remove them from counts. |
| Deferred slice | The 40 percent orchestration glue reduction. Owner retained: `v050-release-program`. Target release: unnumbered repository cleanup. Status: open. |

The identifier `R-M6-011` is not reused to hide a changed assertion. The former assertion is retained verbatim above, in the scope amendment, and in the cleanup obligation record.

Preparation checked local links and source hashes only. It ran no builds, broad tests, original predicates, or publication operations.
