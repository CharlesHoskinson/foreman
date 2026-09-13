# Freeze the Pel K contract and toolchain: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: The existing mapping records intent. Execution needs a complete inventory, reproducible tools, and a shared observation contract.
Architecture: Declarative K rules with strict TypeScript tooling on Node.js 24.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: program adoption.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K01-001: Inventory closure

- [ ] Add explicit fixtures for K01-001-P and K01-001-N from the [specification](specs/pel-k-foundation/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --case K01-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K01-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K01-002: Toolchain admission

- [ ] Add explicit fixtures for K01-002-P and K01-002-N from the [specification](specs/pel-k-foundation/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --case K01-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K01-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K01-003: Closed observation contracts

- [ ] Add explicit fixtures for K01-003-P and K01-003-N from the [specification](specs/pel-k-foundation/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --case K01-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K01-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K01-004: Scoped execution

- [ ] Add explicit fixtures for K01-004-P and K01-004-N from the [specification](specs/pel-k-foundation/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --case K01-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K01-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-foundation --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.

## Inherited R-M7-001 acceptance

- [ ] Execute the original T-M7-001 fixture, action, and expected outcome from this package's specification.
- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --case R-M7-001 --tier release`.
- [ ] Require the original distinguishing scenario to pass before closing this package or the corresponding M7 task.

## K01-005: Formal-artifact admission

- [ ] Add the positive and negative architecture controls from specs/runtime/spec.md.
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-foundation --case K01-005 --tier commit`.
- [ ] Adopt the narrow runtime exception and reconcile AGENTS.md with its controlling requirement before adding .k files.
- [ ] Implement exact-path artifact classification without allowing foreign-language implementation or new product authority.
- [ ] GREEN: Repeat the same check and require both architecture controls to execute.
