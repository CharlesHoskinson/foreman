# Implement continuation, replay, and child semantics: design

## Context and decisions

Map all current continuation fields and nested operation frames into K cells. Preserve optional failure, replay phase, runnable work, next IDs, completed results, and merged-child markers. Validate graph topology and all source/profile/registry/options bindings before restoration.

Use the existing public encode/decode, replay, revision, start-child, and merge-child interfaces. K configuration encoding is not automatically the production continuation wire format. Require production byte equality only for fields deliberately using its canonical codec. Test graph correspondence independently, including cycles and shared captures.

Replay preserves the completed prefix and original charges. An accepted source revision cannot change an already executed effect argument. Child identity remains one-based. Repeated merges do not recharge counters. M4 durable atomicity and automatic legacy-controller resume remain separate implementation obligations.

## File ownership

- `formal/pel/continuation.k`
- `formal/pel/replay.k`
- `formal/pel/children.k`
- `formal/pel/pel.k`
- `packages/pel/test/k/continuations.test.ts`
- `packages/pel/test/k/fixtures/continuations.json`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-continuations`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.
