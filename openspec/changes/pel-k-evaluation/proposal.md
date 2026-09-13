# Change: Implement closures, arguments, and control

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

The most consequential Pel semantics concern lexical capture, deferred syntax arguments, and selected execution.

## What Changes

- Lexical closures.
- Argument binding.
- Native control.
- Single evaluation pipes.

## Impact

Dependencies: `pel-k-syntax-values`, `pel-k-host`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-evaluation/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-005, R-M7-006.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
