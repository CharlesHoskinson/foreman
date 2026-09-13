# Prove the stronger TypeScript correspondence claim: design

## Context and decisions

This is the separately gated K2 research and certification track. K1 can release without K2, but cannot use K2 claims. No date or proof feasibility is promised.

The first deliverable selects and validates a mechanized representation of the actual TypeScript semantics used by Pel. A hand-transcribed second evaluator is insufficient unless its relation to the source is also checked. Inventory JavaScript number and string behavior, object identity, mutable heap updates, stack behavior, exceptions, iteration order, and library calls. Model Node and cryptographic operations as explicit assumptions or discharge their own obligations.

Require a vertical slice from original UTF-8 input through the actual tokenizer and parser, one arithmetic evaluation, and serialization to the K observation. Admit expansion only after a reviewed end-to-end source binding and replayable proof. If the route is unavailable, record an unavailable feasibility result and keep K2 open. This result does not change K1's name or scope.

The target theorem is two-way observable trace correspondence for admitted source, registry, options, and host schedules under an explicit state relation. Include parser preservation and rejection behavior, evaluator steps with permitted stuttering, and continuation/replay correspondence. Determinism must condition on fixed scheduling choices. Total termination needs a separate well-founded argument for administrative transitions and explicit assumptions on external responses.

## File ownership

- `formal/pel/certification/representation.md`
- `formal/pel/certification/source-manifest.json`
- `formal/pel/certification/claims.json`
- `formal/pel/certification/parser.k`
- `formal/pel/certification/evaluator.k`
- `formal/pel/certification/continuation.k`
- `packages/pel/test/k/certification.test.ts`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-certified-correspondence`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.
