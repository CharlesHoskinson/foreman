# Build independent differential and mutation evidence: design

## Context and decisions

Use three independently identified observations: normative fixture expectation, K execution, and the TypeScript engine. Derive fixture expectations from the pinned profile decisions, not the engine result. For generated programs, label oracle coverage separately. Two-engine agreement alone is differential evidence.

Start with all 112 paper fixtures and every scenario in the 22 inventoried regression files. Classify authoring analysis, preview, snapshot, and binding cases explicitly. Language behavior must execute in K. Product-only behavior must retain its TypeScript gate and a concrete boundary rationale. An exclusion cannot remove a language rule.

The commit tier uses fixed seeds 101, 211, and 307 with 100 programs each. The release tier uses seeds 1 through 100 with 100 programs each. Generate source size at most 4096 bytes, AST depth at most 8, at most 4 host requests, and at most 200 semantic reductions. Enumerate all receipt permutations for up to 4 independent requests. Record every actual count and seed. These bounds are proposed gate budgets, not observed performance.

Only normalize alpha-renamed internal graph IDs through a checked bijection. Canonicalize ready sets only where the profile defines them as sets. Never sort dependent effects, drop request arguments, erase counters, or ignore diagnostics. Shrinking preserves the disagreement and retains the original failing case.

## File ownership

- `formal/pel/coverage.json`
- `formal/pel/corpus-manifest.json`
- `formal/pel/mutations.json`
- `packages/orchestration/src/pel-semantics-comparator.ts`
- `packages/orchestration/src/pel-semantics-generator.ts`
- `packages/orchestration/src/pel-semantics-shrinker.ts`
- `packages/pel/test/k/conformance.test.ts`
- `packages/pel/test/k/fixtures/generated-regressions.json`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-conformance`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.

## Projection mutation controls

Add a comparator mutant that sorts dependent effects and another that erases alreadyEmitted flags.
Use unchanged cases whose final values match but whose required trace ordering or replay identity differs.
Both mutants must fail through behavioral observation comparison. Hash changes alone do not pass this control.

## Exact generated-case denominator

A logical case is one program, one options/dependency mode, one complete admissible receipt schedule, and one oracle identity.
Generate 10,000 program identities for the release tier, then enumerate both dependency modes for each program.
Enumerate every admissible receipt order for that program, subject to dependency edges. Four independent requests yield 24 orders.
A program with no host requests has one empty schedule.
Freeze the resulting logical-case manifest before executing either engine. Do not select schedules after observing success.
The release logical-case count is the sum of these mode-specific schedule counts, with an upper bound of 480,000.
Run each logical case on TypeScript and the LLVM K backend, yielding at most 960,000 engine executions.
Report program, logical-case, and engine-execution counts separately.
Haskell numeric/backend cross-checks and proof runs have separate manifests and denominators.
K07 acceptance requires all manifest cases, not merely 10,000 successful engine invocations.
