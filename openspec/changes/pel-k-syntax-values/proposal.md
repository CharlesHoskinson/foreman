# Change: Implement independent syntax and exact values

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

K needs its own source parser and value model. A TypeScript AST import cannot establish source-language conformance.

## What Changes

- Independent grammar.
- Numeric fidelity.
- Tagged values and selection.
- Syntax and data separation.

## Impact

Dependencies: `pel-k-foundation`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-syntax-values/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-002, R-M7-003, R-M7-004.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
