# M1: Pel language implementation

M1 implements the `pel-paper-v2-foreman-1` profile in `@foreman/pel` on branch `plan/dsl-orchestration-release`. The implementation starts from planning commit `272e3be99e7c1a84346be192f0f011bab7683550`.

## Delivered features

| Feature | Implemented behavior |
| --- | --- |
| F-M1-01 | UTF-8 parsing, stable AST identities, byte spans, quote rules, and 112 classified paper fixtures. |
| F-M1-02 | Tagged values, canonical data encoding, finite arithmetic, ordered pairs, and callable lists. |
| F-M1-03 | Immutable lexical bindings, recursive closures, defaults, positional and named arguments, and strict or non-strict partial calls. |
| F-M1-04 | Pipes, resolved case caret ownership, lazy branches, loops, blocks, and dependency-ready asynchronous expressions. |
| F-M1-05 | Source diagnostics with signatures, finite execution bounds, and preserved consumption counters. |
| F-M1-06 | Immutable host registries, schema-checked receipts, suspension, continuation codecs, child closure contexts, and completed-prefix replay. |

The [EARS coverage matrix](m1-ears-coverage.md) maps all 20 requirements and 21 catalog scenarios to concrete assertions. The [compatibility reference](../../reference/pel/compatibility.md) records all 56 paper-profile decisions. The [extension reference](../../reference/pel/extensions.md) describes the host boundary.

The evaluator contains serializable tasks and an explicit ready queue. It performs no provider request, filesystem write, subprocess launch, or timer operation. A fully applied host call returns a request to its execution owner.

## Build and use

Run `npm run build:pel` from the repository root. This produces `packages/pel/dist/pel.js`, a bundled Node 24 module. The package export points to this compiled module. The root runtime build also builds Pel.

The conformance test build uses `npx tsc -p packages/pel/tsconfig.test.json`. Run it with `npx tsx scripts/run-tests.ts "packages/pel/dist-test/test/*.test.js"`, as specified by M1. The test runner resolves the existing workspace source exports. The bundled product runs directly on Node 24 without a TypeScript loader.

A direct Node smoke test parses a Pel program, evaluates a square function, suspends at print, encodes and decodes the continuation, and resumes with the value 81.

## Validation

The [verification record](m1-verification.json) stores command results, output hashes, and the validated source hashes.

- Workspace typecheck passes before and after the compiled test build.
- All 259 Pel tests pass. These include all 112 positive and negative paper fixtures.
- Strict validation of `foredi-01-pel-language` passes.
- The compiled Node bundle passes the closure, suspension, codec, and resume smoke test.
- The full workspace test run retains the same three failures observed before M1 implementation: two live v0.5 release-register checks and the current-worktree secret scan (default traversal bound exceeded). M1 does not claim a clean full workspace suite.

Independent implementation reviews added regressions for computed case calls, partial lambda caret capture, malformed options and continuations, prototype-spelled bindings, retained value bounds, forged child references, abandoned child consumption, and diagnostic signatures. The resulting corrections pass their tests.

## Runtime boundary details

Revision mappings distinguish data arguments from internal closure arguments. Internal arguments require their lexical table and pass the canonical argument encoder and decoder. Their original code references remain attached to the old revision; the node map records the corresponding new references.

A replay request has `replayOnly: true`. The execution owner must satisfy it from an approved mapped receipt. It must not dispatch new external work for that request. At the validated prefix boundary, replay restores the latest committed work totals. The specified 10-reduction prefix, 14-reduction failed step, and 3-reduction revised suffix produce an ordinary total of 17.

`chargeClosureConsumption` records a child invocation once. When its work exceeds the shared limit, its error result includes the charged continuation. `mergeClosureResult` preserves that consumption in the failed parent. The execution owner must retain the charged state, including abandoned and failed child work.

Encoded values retained in evaluation frames consume the value allowance. Continuation and internal argument codecs use a separate 16 MiB envelope bound. Decode checks source, registry, options, AST references, lexical references, and scheduler state before resume.

M2 adds checked plan authoring and inspection. M3 adds provider adapters. M4 adds durable execution, dispatch, reconciliation, and resource ownership. These later runtime features remain unimplemented by M1.
