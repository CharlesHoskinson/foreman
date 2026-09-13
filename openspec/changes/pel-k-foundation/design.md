# Freeze the Pel K contract and toolchain: design

## Context and decisions

Retain the M7 starting version, K v7.1.337 at 4a46d1231473b599c699160132fd6e76a5c46406. Freeze LLVM and Haskell backend identities separately. Include the SMT solver, JDK, native libraries, OS image, architecture, artifact URLs, licenses, and SHA-256 digests. Never resolve a moving latest tag during a gate.

Use Linux x86_64 as the required K execution and proof host. Require a second clean Linux environment for release reproduction. Windows and macOS product tests must establish that the installed Foreman product works without K. They do not certify native K support.

Propose a narrow architecture admission for declarative formal/pel/**/*.k definitions and claims. External pinned K tools are development dependencies. All new repository runner, comparator, generator, and test logic stays strict TypeScript on Node.js 24. Update the controlling runtime requirement and AGENTS.md in the implementation change before admitting .k files. This planning package does not enact that admission.

Define the contracts in the program's contracts.md. Reuse scoped subprocess services through Effect. Keep explicit argv, a minimal environment, bounded streams, and isolated temporary builds. Deny definition imports outside the frozen closure. The harness does not install tools, execute source-selected commands, or contact providers. Cache keys include every transitive definition and tool input. Missing, mismatched, interrupted, timed-out, and stuck results are distinct.

## File ownership

- `formal/pel/toolchain.lock.json`
- `formal/pel/profile-inventory.json`
- `formal/pel/observation.schema.json`
- `formal/pel/coverage.json`
- `formal/pel/host-script.schema.json`
- `formal/pel/report.schema.json`
- `formal/pel/pel.k`
- `packages/orchestration/src/pel-semantics-contract.ts`
- `packages/orchestration/src/pel-semantics-runner.ts`
- `packages/orchestration/src/pel-semantics-main.ts`
- `packages/pel/test/k/foundation.test.ts`
- `scripts/build-runtime.ts`
- `packages/policy/src/architecture-executable.ts`
- `packages/policy/src/architecture-executable.test.ts`
- `AGENTS.md`
- `openspec/changes/node-typescript-runtime/specs/runtime/spec.md`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-foundation`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.

## Runtime delta adoption

The normative proposed exception is specs/runtime/spec.md, requirement K01-005.
This repository currently has no canonical openspec/specs/runtime/spec.md to modify.
Use an ADDED exception with an explicit controlling-contract reconciliation task, rather than an unresolvable MODIFIED delta.
Adoption must preserve the existing default runtime requirement and enact only the specified formal-artifact exception.
