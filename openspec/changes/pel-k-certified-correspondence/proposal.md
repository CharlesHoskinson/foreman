# Change: Prove the stronger TypeScript correspondence claim

Status: **PROPOSED — implementation not started**. Track: K2 certification, separate from K1.

## Why

A source-level correctness claim needs a mechanized connection to the actual TypeScript program, beyond differential tests.

## What Changes

- Source representation admission.
- Parser preservation and rejection.
- Evaluator trace correspondence.
- Recovery and theorem closure.

## Impact

Dependencies: `pel-k-runtime-correspondence`.

The [program](../pel-k-release-program/proposal.md) controls release scope and evidence terminology.
The [design](design.md) defines file ownership and interfaces.
The [requirements](specs/pel-k-certified-correspondence/spec.md) and [tasks](tasks.md) define success and failure checks.
This package adds release obligations beyond M7.

No runtime change, K execution result, proof, or release approval is created by these planning artifacts.
