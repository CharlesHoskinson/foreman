# Change: Implement scheduling, limits, and diagnostics

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

Final values alone hide incorrect scheduling, resource charging, and failures.

## What Changes

- Ready-task scheduling.
- Final source selection.
- Exact resource boundaries.
- Located diagnostics.

## Impact

Dependencies: `pel-k-evaluation`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-scheduling/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-007, R-M7-008, R-M7-009.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
