# Change: Implement continuation, replay, and child semantics

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

Recovery must preserve more than the final value. It must preserve identities, lexical state, and already charged work.

## What Changes

- Complete continuation projection.
- Restore validation.
- Completed-prefix replay.
- Child accounting.

## Impact

Dependencies: `pel-k-scheduling`, `pel-k-host`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-continuations/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-013, R-M7-014, R-M7-015.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
