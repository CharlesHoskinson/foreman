# M7 implementation tasks

Status: **PLANNED**. Acceptance is not done. All paths below are proposed outputs, not implemented commands. Do not mark a task complete because its design or fixture name exists.

The [mapping audit](../../../docs/guides/pel/k-mapping-audit.md) lists the current syntax and semantic inventory against these requirements.
Before implementation, verify its source hashes and account for every added or changed member.
The inventory audit does not complete any implementation task below.

## F-M7-01 Pinned profile and executable syntax

- [ ] Implement R-M7-001 and its distinguishing T-M7-001 fixture in packages/pel/test/k/toolchain.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-002 and its distinguishing T-M7-002 fixture in packages/pel/test/k/syntax.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-003 and its distinguishing T-M7-003 fixture in packages/pel/test/k/values.test.ts; record a failing test before implementation and the executed result after correction.

## F-M7-02 Values, closures and native control

- [ ] Implement R-M7-004 and its distinguishing T-M7-004 fixture in packages/pel/test/k/values.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-005 and its distinguishing T-M7-005 fixture in packages/pel/test/k/closures.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-006 and its distinguishing T-M7-006 fixture in packages/pel/test/k/control.test.ts; record a failing test before implementation and the executed result after correction.

## F-M7-03 Scheduling, bounds and diagnostics

- [ ] Implement R-M7-007 and its distinguishing T-M7-007 fixture in packages/pel/test/k/scheduling.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-008 and its distinguishing T-M7-008 fixture in packages/pel/test/k/limits.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-009 and its distinguishing T-M7-009 fixture in packages/pel/test/k/diagnostics.test.ts; record a failing test before implementation and the executed result after correction.

## F-M7-04 Abstract host effects

- [ ] Implement R-M7-010 and its distinguishing T-M7-010 fixture in packages/pel/test/k/host.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-011 and its distinguishing T-M7-011 fixture in packages/pel/test/k/host.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-012 and its distinguishing T-M7-012 fixture in packages/pel/test/k/host.test.ts; record a failing test before implementation and the executed result after correction.

## F-M7-05 Continuations and replay

- [ ] Implement R-M7-013 and its distinguishing T-M7-013 fixture in packages/pel/test/k/continuation.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-014 and its distinguishing T-M7-014 fixture in packages/pel/test/k/replay.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-015 and its distinguishing T-M7-015 fixture in packages/pel/test/k/children.test.ts; record a failing test before implementation and the executed result after correction.

## F-M7-06 Differential evidence and proof status

- [ ] Implement R-M7-016 and its distinguishing T-M7-016 fixture in packages/pel/test/k/differential.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-017 and its distinguishing T-M7-017 fixture in packages/pel/test/k/harness.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-018 and its distinguishing T-M7-018 fixture in packages/pel/test/k/mutations.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-019 and its distinguishing T-M7-019 fixture in packages/pel/test/k/claims.test.ts; record a failing test before implementation and the executed result after correction.
- [ ] Implement R-M7-020 and its distinguishing T-M7-020 fixture in packages/pel/test/k/status.test.ts; record a failing test before implementation and the executed result after correction.

## Integration and exit

- [ ] Pin the actual K toolchain and backend before compiling; record unavailable prerequisites without treating skipped tests as passes.
- [ ] Add future K test targets to the existing TypeScript test runner and a compiled Node24 semantics entry; keep `.k` definitions declarative and all executable glue TypeScript.
- [ ] Run the full mapped corpus, fixed-seed cases, mutation controls and required scoped claims on one unchanged definition; retain exact hashes and counts.
- [ ] Review every mismatch against independent profile fixtures; do not change the TypeScript evaluator or K rules merely to copy the other implementation.
- [ ] Publish the scoped conformance and claim-status table. Full parser/elaboration/evaluator equivalence stays open unless a separate checked proof actually discharges it.
- [ ] Preserve M1–M6 behavior, Council, recovery and existing host authority. This sprint supplies no numerical-release approval and does not waive failed simplification targets.
