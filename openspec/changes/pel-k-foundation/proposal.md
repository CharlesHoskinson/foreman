# Change: Freeze the Pel K contract and toolchain

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

The existing mapping records intent. Execution needs a complete inventory, reproducible tools, and a shared observation contract.

## What Changes

- Inventory closure.
- Toolchain admission.
- Closed observation contracts.
- Scoped execution.
- Narrow formal-artifact admission under K01-005.

## Impact

Dependencies: program scope adoption.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-foundation/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-001, R-M7-017.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
