# Change: Full Pel K release program

Status: **PROPOSED — implementation not started**.
Baseline: ForeDi release tree, merged as a73562b64c900c6042d592823493f8accce58254 on 2026-09-13.

## Why

Pel expresses agent work as a small language with explicit evaluation and host boundaries.
Foreman already implements its selected profile in TypeScript.
An independently executable K definition can reveal ambiguous rules, implementation disagreements, and invalid recovery assumptions.
The current M7 mapping is complete as a planning inventory. It contains no executable K definition or checked proof.

A full release needs more than a grammar and successful examples.
It needs complete profile coverage, reproducible tools, adversarial conformance checks, scoped proofs, and candidate-bound release evidence.

## What Changes

Create ten required implementation packages and one separate certification package.
The first release claim is **Pel K Executable Profile v1**, called **K1** in this program.
K1 means complete executable coverage of `pel-paper-v2-foreman-1`, tested TypeScript correspondence, and the ten scoped K proofs specified here.
It does not mean a source-level correctness proof for the TypeScript runtime.
The stronger source-level correspondence claim is **K2**, with its own feasibility and certification gates.
K1 and K2 are capability labels, not numerical Foreman versions.

| Package | Deliverable | Dependency |
| --- | --- | --- |
| [pel-k-foundation](../pel-k-foundation/proposal.md) | Freeze the Pel K contract and toolchain | Program adoption |
| [pel-k-syntax-values](../pel-k-syntax-values/proposal.md) | Implement independent syntax and exact values | pel-k-foundation |
| [pel-k-evaluation](../pel-k-evaluation/proposal.md) | Implement closures, arguments, and control | pel-k-syntax-values, pel-k-host |
| [pel-k-scheduling](../pel-k-scheduling/proposal.md) | Implement scheduling, limits, and diagnostics | pel-k-evaluation |
| [pel-k-host](../pel-k-host/proposal.md) | Specify and execute abstract host boundaries | pel-k-syntax-values |
| [pel-k-continuations](../pel-k-continuations/proposal.md) | Implement continuation, replay, and child semantics | pel-k-scheduling, pel-k-host |
| [pel-k-conformance](../pel-k-conformance/proposal.md) | Build independent differential and mutation evidence | pel-k-continuations |
| [pel-k-proofs](../pel-k-proofs/proposal.md) | Discharge scoped semantic proof obligations | pel-k-continuations |
| [pel-k-runtime-correspondence](../pel-k-runtime-correspondence/proposal.md) | Audit runtime correspondence and host boundaries | pel-k-conformance, pel-k-proofs |
| [pel-k-release](../pel-k-release/proposal.md) | Integrate CI, documentation, and release evidence | pel-k-runtime-correspondence |
| [pel-k-certified-correspondence](../pel-k-certified-correspondence/proposal.md) | Prove the stronger TypeScript correspondence claim | pel-k-runtime-correspondence |

## Impact

This change writes plans only. Every implementation task remains unchecked.
The [design](design.md) defines scope, ownership, dependency order, and effort assumptions.
The [requirements](specs/pel-k-release-program/spec.md) define release predicates and negative controls.
The [tasks](tasks.md) provide the implementation sequence.
The [contracts](contracts.md), [coverage](coverage.json), and [proof obligations](proof-obligations.md) provide shared interfaces and acceptance denominators.

M7 remains the controlling twenty-requirement semantic baseline.
This program decomposes its implementation and adds release requirements. It does not mark M7 accepted or replace its historical catalog.
Each inherited M7 requirement has owners in coverage.json and must pass its original distinguishing scenario.

All new executable glue remains strict TypeScript on Node.js 24, with Effect for resource ownership.
K01 proposes an explicit, narrow admission for declarative K artifacts before implementation.
K remains a development and verification dependency. Foreman production execution continues through its existing runtime.

Repository cleanup and production-code reduction stay in the separate release requested by the user.
Existing v0.5 P1-P15 predicates, live-provider qualifications, platform evidence, and legacy-controller obligations retain their authority.
Passing K1 cannot publish a numbered Foreman release while its other required predicates fail.

## Pel execution form

The [Pel workflow collection](../../../examples/pel/k-release/README.md) expresses this agenda using the current runtime.
Its [agenda](../../../examples/pel/k-release/agenda.pel) maps all packages and inherited M7 requirements to numbered workflows.
Each workflow implements a checkpoint, candidate capture, verification, and independent review.
A separate correction program requires an explicitly bound input packet after the beta test exposed missing correction context.
Project and artifact bindings remain unbound. Promotion and release publication remain explicit host-owned boundaries.
These authored programs do not complete any K implementation task.
