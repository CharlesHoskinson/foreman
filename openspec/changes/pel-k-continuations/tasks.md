# Implement continuation, replay, and child semantics: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: Recovery must preserve more than the final value. It must preserve identities, lexical state, and already charged work.
Architecture: Declarative K rules with strict TypeScript tooling on Node.js 24.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: pel-k-scheduling, pel-k-host.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K06-001: Complete continuation projection

- [ ] Add explicit fixtures for K06-001-P and K06-001-N from the [specification](specs/pel-k-continuations/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case K06-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K06-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K06-002: Restore validation

- [ ] Add explicit fixtures for K06-002-P and K06-002-N from the [specification](specs/pel-k-continuations/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case K06-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K06-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K06-003: Completed-prefix replay

- [ ] Add explicit fixtures for K06-003-P and K06-003-N from the [specification](specs/pel-k-continuations/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case K06-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K06-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K06-004: Child accounting

- [ ] Add explicit fixtures for K06-004-P and K06-004-N from the [specification](specs/pel-k-continuations/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case K06-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K06-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-continuations --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.

## Inherited R-M7-013 acceptance

- [ ] Execute the original T-M7-013 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case R-M7-013 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Inherited R-M7-014 acceptance

- [ ] Execute the original T-M7-014 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case R-M7-014 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Inherited R-M7-015 acceptance

- [ ] Execute the original T-M7-015 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-continuations --case R-M7-015 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.
