# Implement scheduling, limits, and diagnostics: design

## Context and decisions

Define ordered and automatic modes separately. Derive dependency edges, ready sets, already-emitted batches, and the final source expression's result. Preserve conflicting binding behavior and dependency-cycle rejection.

Freeze a charge table for each semantic operation and each of the eight limits. Administrative heating, cooling, serialization, and observation projection must not accidentally charge Pel reductions. Preserve the current pre-operation rejection boundary, including limits set to zero and N-1, N, N+1 cases.

The diagnostic observation includes code, span, related spans, expected forms, signature, bound, consumed count, and structured host failure where present. Compare message text only where the public contract requires it. A missing semantic rule is stuck execution, never a new Pel error.

## File ownership

- `formal/pel/scheduling.k`
- `formal/pel/limits.k`
- `formal/pel/diagnostics.k`
- `formal/pel/pel.k`
- `packages/pel/test/k/scheduling.test.ts`
- `packages/pel/test/k/fixtures/scheduling.json`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-scheduling`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.

## Charge-table closure

Create formal/pel/charges.json with each semantic rule label, operation, debit fields, debit timing, and rejection boundary.
Label administrative rules explicitly with zero debit.
Check the table against the compiled definition rule inventory and the TypeScript operation mapping.
Reject missing labels, duplicate ownership, and unlabeled charging rules.
