# Full Pel K release: execution agenda

Status: **PROPOSED**. This document plans implementation. It does not record completed implementation work.
Use the executing-plans workflow after program adoption.
Every child contains file ownership, requirement scenarios, RED/GREEN checks, and package acceptance commands.
All pel-semantics.js commands below are planned interfaces defined in [contracts.md](contracts.md).

## 1. Adopt and freeze

- [ ] Adopt K1/K2 naming, KG01-KG12, proof domains, and the separate cleanup scope.
- [ ] Register the program and child owners through the existing release coverage validator.
- [ ] Reconcile the M7 relationship and applicable numerical-release obligations without weakening their gates.
- [ ] Implement [K01 foundation](../pel-k-foundation/tasks.md), including formal-artifact admission and the observation contract.
- [ ] Run the first complete compile/run and proof-control smoke checks on both pinned backends.

## 2. Resolve the high-risk semantics

- [ ] Implement [K02 syntax and values](../pel-k-syntax-values/tasks.md).
- [ ] Resolve independent source spans, binary64 encoding, pow/sqrt, and backend disagreement before expanding evaluation.
- [ ] Re-estimate the schedule from actual K02 evidence. Preserve the full-profile denominator.
- [ ] Implement [K05 abstract host](../pel-k-host/tasks.md) at configuration boundaries before control-flow integration.
- [ ] Implement [K03 evaluation](../pel-k-evaluation/tasks.md).
- [ ] Implement [K04 scheduling](../pel-k-scheduling/tasks.md), including a checked operation-to-counter charge table.

## 3. Complete host and recovery semantics

- [ ] Integrate the accepted K05 host module with control and scheduling.
- [ ] Implement [K06 continuations](../pel-k-continuations/tasks.md).
- [ ] Verify every continuation field and nested frame against the current public M1 interfaces.
- [ ] Keep legacy positive-resume and durable host-policy claims under their existing owners.

## 4. Establish conformance and scoped proofs

- [ ] Implement [K07 conformance](../pel-k-conformance/tasks.md), including all original M7 distinguishing cases.
- [ ] Implement [K08 proofs](../pel-k-proofs/tasks.md) and discharge K-P01 through K-P10.
- [ ] Run the release corpus and all semantic/comparator mutation controls on one frozen definition.
- [ ] Re-estimate proof work after the first complete invariant and nonvacuity control.
- [ ] Implement [K09 correspondence audit](../pel-k-runtime-correspondence/tasks.md).

## 5. Admit and publish K1

- [ ] Implement [K10 release](../pel-k-release/tasks.md), including enforcing CI and isolated reproduction.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js inventory --check`.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js conformance --tier release`.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js mutations --tier release`.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js prove --all-required`.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js correspondence --check`.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js release --check --manifest formal/out/pel-k/release-manifest.json`.
- [ ] Require complete passing reports and all applicable existing release-program gates on unchanged candidate bytes.
- [ ] Obtain an independent cold audit of the candidate and evidence manifest.
- [ ] Publish through the existing authorized journal and verify all remote asset hashes and the embedded image.
- [ ] Close M7 and K1 implementation tasks only after their own executed acceptance evidence exists.

## 6. Separate K2 certification

- [ ] Execute the bounded feasibility slice in [K11 certification](../pel-k-certified-correspondence/tasks.md).
- [ ] Record an admitted mechanized source representation or an explicit unavailable result.
- [ ] If admitted, complete parser, evaluator, continuation, and theorem-dependency proofs before making the K2 claim.
- [ ] Keep K2 results and publication claims separate from K1 acceptance.

## Planning validation

Run `openspec validate --all --strict --no-interactive` after any spec change.
Validate the coverage.json package graph, requirement IDs, scenario links, M7 closure, and inventory baseline hashes.
Planning validation does not execute the proposed semantics commands or complete any task above.
