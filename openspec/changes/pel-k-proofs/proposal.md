# Change: Discharge scoped semantic proof obligations

Status: **PROPOSED — implementation not started**. Track: K1 full-profile semantics release.

## Why

Full language execution needs checked safety claims with precise domains, reachable premises, and visible trusted assumptions.

## What Changes

- Required claim register.
- Nonvacuity and false controls.
- Proof trust and replay.
- Honest incomplete outcomes.

## Impact

Dependencies: `pel-k-continuations`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-proofs/spec.md) and [tasks](tasks.md) define success and failure checks.
This package supplies M7 requirements R-M7-019.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
