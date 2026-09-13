# Discharge scoped semantic proof obligations: design

## Context and decisions

Use the Haskell backend with the pinned solver. Record claims K-P01 through K-P10 from the program proof-obligations.md. All ten are K1 release requirements. Each claim uses the full selected rules reachable in its stated domain. A reduced model needs an explicit relation to those rules.

Prove invariants by initiation and preservation across relevant transitions, or by an explicitly complete finite-state argument. State which proof method was used. A collection of successful example reachability claims cannot establish an invariant for every admitted execution. List helper lemmas and their dependency graph. Reject circular assumptions and unproved lemmas used as axioms.

Provide nonempty witness configurations for each premise. Record false-control counterexamples and deliberately unsatisfiable-premise controls. Bound model tasks, closures, scripts, and numeric domains explicitly where needed. Finite reductions do not establish global termination when administrative rewrites or external waits can continue.

K prover success is trusted-tool evidence, not automatically a separately checked matching-logic certificate. State whether an independent certificate checker exists and was used. Full source-TypeScript correspondence belongs to the separate K2 package.

## File ownership

- `formal/pel/claims.k`
- `formal/pel/claims.json`
- `formal/pel/proof-domains.json`
- `formal/pel/proofs/receipt.k`
- `formal/pel/proofs/counters.k`
- `formal/pel/proofs/recovery.k`
- `formal/pel/proofs/control.k`
- `packages/orchestration/src/pel-semantics-proof.ts`
- `packages/pel/test/k/proofs.test.ts`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-proofs`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.

## Domain disposition

Classify every semantic rule for each claim as in-domain, outgoing-boundary, or not-in-domain.
Record a checked premise-exclusion argument for each not-in-domain rule.
Do not report those exclusions as proved coverage of that rule.
The omitted-transition refusal applies to in-domain and outgoing-boundary rules.
Full-profile execution still covers rules outside D1 through K07.
