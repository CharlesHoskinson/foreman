# Change: Build independent differential and mutation evidence

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

Agreement on handpicked examples can miss shared mistakes and unexecuted coverage rows.

## What Changes

- Complete executable coverage.
- Independent expectations.
- Bounded generation and shrinking.
- Mutation effectiveness.

## Impact

Dependencies: `pel-k-continuations`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-conformance/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-016, R-M7-017, R-M7-018.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
