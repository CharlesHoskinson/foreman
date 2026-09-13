# Specify and execute abstract host boundaries: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: Host inputs must stay explicit. A semantic model cannot manufacture external completion or authority.
Architecture: Declarative K rules with strict TypeScript tooling on Node.js 24.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: pel-k-syntax-values.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K05-001: Request and receipt binding

- [ ] Add explicit fixtures for K05-001-P and K05-001-N from the [specification](specs/pel-k-host/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case K05-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K05-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K05-002: Host schema completeness

- [ ] Add explicit fixtures for K05-002-P and K05-002-N from the [specification](specs/pel-k-host/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case K05-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K05-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K05-003: Abstract outputs and predicates

- [ ] Add explicit fixtures for K05-003-P and K05-003-N from the [specification](specs/pel-k-host/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case K05-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K05-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K05-004: Authority separation

- [ ] Add explicit fixtures for K05-004-P and K05-004-N from the [specification](specs/pel-k-host/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case K05-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K05-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-host --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.

## Inherited R-M7-010 acceptance

- [ ] Execute the original T-M7-010 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case R-M7-010 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Inherited R-M7-011 acceptance

- [ ] Execute the original T-M7-011 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case R-M7-011 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## Inherited R-M7-012 acceptance

- [ ] Execute the original T-M7-012 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-host --case R-M7-012 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.
