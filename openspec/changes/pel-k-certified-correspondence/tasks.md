# Prove the stronger TypeScript correspondence claim: implementation tasks

Status: **PROPOSED**. All implementation and verification work remains unchecked.

Goal: A source-level correctness claim needs a mechanized connection to the actual TypeScript program, beyond differential tests.
Architecture: Mechanized source correspondence, admitted through a proved vertical slice.
Execution: Use the executing-plans workflow after program adoption.
Allowed paths: [design.md](design.md), plus evidence under `formal/out/pel-k/`.
Dependencies: pel-k-runtime-correspondence.

## Command contract

The commands below are **planned interfaces**, not commands available in the current release.
K01 must wire the compiled entry point through `scripts/build-runtime.ts`.
Run `npm ci` and `npm run build` before the first compiled runner check.
Use `npm run typecheck` for changed TypeScript source.
A required suite must fail before its missing behavior exists.
A passing suite must execute its positive and distinguishing negative cases.
A missing command, missing tool, skipped case, or empty report never counts as GREEN.

## K11-001: Source representation admission

- [ ] Add explicit fixtures for K11-001-P and K11-001-N from the [specification](specs/pel-k-certified-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-certified-correspondence --case K11-001 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K11-001 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K11-002: Parser preservation and rejection

- [ ] Add explicit fixtures for K11-002-P and K11-002-N from the [specification](specs/pel-k-certified-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-certified-correspondence --case K11-002 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K11-002 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K11-003: Evaluator trace correspondence

- [ ] Add explicit fixtures for K11-003-P and K11-003-N from the [specification](specs/pel-k-certified-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-certified-correspondence --case K11-003 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K11-003 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## K11-004: Recovery and theorem closure

- [ ] Add explicit fixtures for K11-004-P and K11-004-N from the [specification](specs/pel-k-certified-correspondence/spec.md).
- [ ] RED: Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-certified-correspondence --case K11-004 --tier commit`.
- [ ] Confirm a behavioral failure for the absent rule or contract. Preserve the failing observation.
- [ ] Implement K11-004 within the declared file scope and shared contracts.
- [ ] GREEN: Repeat the same command. Require both scenarios to execute with their specified outcomes.
- [ ] Review the diff independently. Commit the requirement with its source-bound evidence.

## Package acceptance

- [ ] Run `node skills/foreman/runtime/dist/pel-semantics.js check --suite pel-k-certified-correspondence --tier release`.
- [ ] Require zero missing cases, zero mismatches, and zero incomplete required results.
- [ ] Run `openspec validate pel-k-certified-correspondence --strict --no-interactive`.
- [ ] Run the repository gates selected by the changed production and formal paths.
- [ ] Record actual results and independent review before closing this package.
