# Audit runtime correspondence and host boundaries: design

## Context and decisions

Define a relation R between a TypeScript continuation and a K configuration at observable semantic boundaries. Map every evaluation operation, graph node, request identity, counter, option, and failure field. Permit explicitly identified administrative stuttering only. Record concrete counterexamples to R and to its projection.

K1 requires source-bound boundary conformance and a reviewed relation over the complete profile. It does not claim a mechanized theorem over the TypeScript source. Label that result tested correspondence. K2 specifies the additional source-level proof work.

Classify host contracts individually: M1 language interface, M4 journal and budget behavior, operating-system containment, provider completion, and publication authority. Keep existing host gates mandatory for claims that include them. The restored M6 legacy-controller refusal must be represented accurately in the correspondence register. The historical Quint successful-resume path does not prove current positive resume. Record the debt under lane-runtime-typescript without redesigning legacy controllers.

Resolve semantic disagreements through a reviewed profile decision or an implementation correction with regression evidence. Never make K match an accidental runtime bug by default. Preserve original counterexamples and invalidate affected proof and conformance bindings after corrections.

## File ownership

- `formal/pel/correspondence.json`
- `formal/pel/correspondence.md`
- `formal/pel/host-boundaries.json`
- `packages/orchestration/src/pel-semantics-correspondence.ts`
- `packages/pel/test/k/correspondence.test.ts`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-runtime-correspondence`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.

## Read-only external evidence

Treat formal/coverage.tsv and formal/reports/foredi-controller-restoration-drift.md as read-only source inputs.
K09 may write only its declared Pel-local correspondence files and tests.
Record proposed global-ledger corrections with their existing owner. Apply them only through a separately scoped reviewed change.
Do not edit historical controller-restoration evidence or change another release program through this package.
