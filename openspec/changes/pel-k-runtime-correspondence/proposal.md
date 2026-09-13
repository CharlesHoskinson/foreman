# Change: Audit runtime correspondence and host boundaries

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

A correct K model can still describe the wrong implementation. The release needs an explicit relation and an honest evidence boundary.

## What Changes

- Complete boundary relation.
- Host correspondence ledger.
- Mismatch resolution.
- Claim boundary labels.

## Impact

Dependencies: `pel-k-conformance`, `pel-k-proofs`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-runtime-correspondence/spec.md) and [tasks](tasks.md) define success and failure checks.
This package adds release obligations beyond M7.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
