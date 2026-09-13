# Implement scheduling, limits, and diagnostics: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: Final values alone hide incorrect scheduling, resource charging, and failures.
Architecture: Declarative K rules with strict TypeScript tooling on Node.js 24.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: pel-k-evaluation.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K04-001: Ready-task scheduling

- [ ] Add explicit fixtures for K04-001-P and K04-001-N from the [specification](specs/pel-k-scheduling/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case K04-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K04-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K04-002: Final source selection

- [ ] Add explicit fixtures for K04-002-P and K04-002-N from the [specification](specs/pel-k-scheduling/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case K04-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K04-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K04-003: Exact resource boundaries

- [ ] Add explicit fixtures for K04-003-P and K04-003-N from the [specification](specs/pel-k-scheduling/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case K04-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K04-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K04-004: Located diagnostics

- [ ] Add explicit fixtures for K04-004-P and K04-004-N from the [specification](specs/pel-k-scheduling/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case K04-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K04-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-scheduling --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.

## Inherited R-M7-007 acceptance

- [ ] Execute the original T-M7-007 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case R-M7-007 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Inherited R-M7-008 acceptance

- [ ] Execute the original T-M7-008 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case R-M7-008 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Inherited R-M7-009 acceptance

- [ ] Execute the original T-M7-009 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-scheduling --case R-M7-009 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.
