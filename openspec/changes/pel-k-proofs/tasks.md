# Discharge scoped semantic proof obligations: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: Full language execution needs checked safety claims with precise domains, reachable premises, and visible trusted assumptions.
Architecture: Declarative K rules with strict TypeScript tooling on Node.js 24.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: pel-k-continuations.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K08-001: Required claim register

- [ ] Add explicit fixtures for K08-001-P and K08-001-N from the [specification](specs/pel-k-proofs/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-proofs --case K08-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K08-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K08-002: Nonvacuity and false controls

- [ ] Add explicit fixtures for K08-002-P and K08-002-N from the [specification](specs/pel-k-proofs/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-proofs --case K08-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K08-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K08-003: Proof trust and replay

- [ ] Add explicit fixtures for K08-003-P and K08-003-N from the [specification](specs/pel-k-proofs/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-proofs --case K08-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K08-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K08-004: Honest incomplete outcomes

- [ ] Add explicit fixtures for K08-004-P and K08-004-N from the [specification](specs/pel-k-proofs/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-proofs --case K08-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K08-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-proofs --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-proofs --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.

## Inherited R-M7-019 acceptance

- [ ] Execute the original T-M7-019 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-proofs --case R-M7-019 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Mandatory proof execution before K08 closure

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js prove --all-required`.
- [ ] Require K-P01 through K-P10 to discharge with witnesses, controls, helper closure, and candidate-bound reports.
- [ ] Refuse K08 closure for unknown, unavailable, interrupted, refuted, or stale proof results.
- [ ] Replay these same claims during K10 candidate admission. K10 is not their first execution owner.
