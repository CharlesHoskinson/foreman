# Change: Specify and execute abstract host boundaries

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

Host inputs must stay explicit. A semantic model cannot manufacture external completion or authority.

## What Changes

- Request and receipt binding.
- Host schema completeness.
- Abstract outputs and predicates.
- Authority separation.

## Impact

Dependencies: `pel-k-syntax-values`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-host/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-010, R-M7-011, R-M7-012.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
