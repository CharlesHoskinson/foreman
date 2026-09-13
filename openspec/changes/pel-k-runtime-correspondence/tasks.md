# Audit runtime correspondence and host boundaries: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: A correct K model can still describe the wrong implementation. The release needs an explicit relation and an honest evidence boundary.
Architecture: Declarative K rules with strict TypeScript tooling on Node.js 24.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: pel-k-conformance, pel-k-proofs.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K09-001: Complete boundary relation

- [ ] Add explicit fixtures for K09-001-P and K09-001-N from the [specification](specs/pel-k-runtime-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-runtime-correspondence --case K09-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K09-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K09-002: Host correspondence ledger

- [ ] Add explicit fixtures for K09-002-P and K09-002-N from the [specification](specs/pel-k-runtime-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-runtime-correspondence --case K09-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K09-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K09-003: Mismatch resolution

- [ ] Add explicit fixtures for K09-003-P and K09-003-N from the [specification](specs/pel-k-runtime-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-runtime-correspondence --case K09-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K09-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K09-004: Claim boundary labels

- [ ] Add explicit fixtures for K09-004-P and K09-004-N from the [specification](specs/pel-k-runtime-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-runtime-correspondence --case K09-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K09-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-runtime-correspondence --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-runtime-correspondence --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.
