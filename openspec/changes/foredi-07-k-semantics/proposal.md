# Change: Executable Pel semantics in K

Status: **PLANNED**. Implementation and acceptance are not done.

## Why

Pel now has a TypeScript evaluator, host suspension and recovery behavior. An executable, separately written semantics can expose ambiguous rules and distinguish language behavior from host assumptions. Passing examples alone do not establish evaluator equivalence.

## What Changes

- Specify a K definition for the selected `pel-paper-v2-foreman-1` language profile.
- Model syntax, values, closures, control, ready batches, limits, errors and continuations.
- Represent external effects as supplied abstract requests and receipts, with no live provider calls.
- Compare K observations, independent profile expectations and the existing TypeScript engine.
- Record bounded claim domains, assumptions and proof status separately from conformance tests.
- Add a user-facing semantics guide and a six-feature, twenty-requirement sprint catalog.

## Impact

This change adds a plan and documentation only. Future `.k` files are declarative semantic definitions. Future executable wrappers and tests must use strict TypeScript on Node.js 24, with Effect for subprocess resources and typed failures. Do not copy Moriarty's Python or MJS wrappers.

The existing evaluator, journal, ledger, native boundaries and publication authority remain authoritative for production execution. K is a development-time semantics tool, not a new orchestrator or a mandatory installed-product dependency. This sprint does not declare M6 accepted, waive its simplification targets, choose a numerical release, or prove full TypeScript/K correspondence.

## Feature scope

| Feature | Result |
| --- | --- |
| F-M7-01 | Pinned profile, toolchain and independent executable syntax |
| F-M7-02 | Values, lexical closures and native control flow |
| F-M7-03 | Ready scheduling, limits and located diagnostics |
| F-M7-04 | Abstract host request/receipt semantics |
| F-M7-05 | Continuation, replay and child accounting semantics |
| F-M7-06 | Differential corpus, mutation controls and honest proof status |

See [design.md](design.md), [tasks.md](tasks.md), and [catalog.json](catalog.json).
