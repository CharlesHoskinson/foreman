# Change: Integrate CI, documentation, and release evidence

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

A usable semantics release requires reproducible artifacts, enforceable gates, and a maintenance contract.

## What Changes

- Enforcing CI.
- Reproducible distribution.
- Release admission and publication.
- Guide and artwork.
- Maintenance and rollback.

## Impact

Dependencies: `pel-k-runtime-correspondence`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-release/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-020.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
