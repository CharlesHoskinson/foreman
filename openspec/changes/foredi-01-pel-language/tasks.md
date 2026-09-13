# M1 implementation tasks

M1 is implemented. The linked release implementation report records validation and the existing workspace test failures.

## F-M1-01 Published grammar and source locations

- [x] Create the strict TypeScript package configuration and workspace references.
- [x] Add `packages/pel/test/**/*.test.ts` to the root test command's explicit globs.
- [x] Implement tokenizer spans and lexical errors in `packages/pel/src/tokenizer.ts`.
- [x] Implement AST parsing and quote rules in `packages/pel/src/parser.ts`.
- [x] Preserve ArgSpec value presence and correct tokenizer glyph rules from the PDF.
- [x] Keep caret scope validation in evaluation and add the T-M1-021 phase fixtures.
- [x] Correct profile locators and separate pure paper rows from extension restrictions.
- [x] Implement every classified positive and negative fixture in paper-v2.json.
- [x] Add R-M1-019 coverage in `packages/pel/test/profile.test.ts`.
- [x] Add the R-M1-001 and R-M1-002 fixtures in `packages/pel/test/syntax.test.ts`.

## F-M1-02 Values and callable lists

- [x] Implement value tags and canonical formatting in `packages/pel/src/values.ts`.
- [x] Implement canonical tagged JSON encoding and R-M1-018 round-trip fixtures.
- [x] Implement pair formation and callable-list lookup in `packages/pel/src/builtins.ts`.
- [x] Add the R-M1-003 and R-M1-004 fixtures in `packages/pel/test/values.test.ts`.
- [x] Write the paper-linked errata table in `docs/reference/pel/compatibility.md`.

## F-M1-03 Closures and argument binding

- [x] Implement immutable lexical environments and closures in `packages/pel/src/evaluator.ts`.
- [x] Implement defaults and partial argument binding in `packages/pel/src/arguments.ts`.
- [x] Implement fixed pure builtin signatures in `packages/pel/src/builtins.ts`.
- [x] Implement non-strict def/lambda signatures and required-versus-nil-default binding fixtures.
- [x] Implement branch, iteration, and block scope fixtures.
- [x] Add the R-M1-005 and R-M1-006 fixtures in `packages/pel/test/closures.test.ts`.

## F-M1-04 Pipes and native control flow

- [x] Implement recursive pipe insertion in `packages/pel/src/evaluator.ts`.
- [x] Implement resolved case caret ownership, leading-call chain injection, aliases, and def-pipe fixtures.
- [x] Implement non-strict if, case, for, do, and do/async in `packages/pel/src/builtins.ts`.
- [x] Implement dependency analysis in `packages/pel/src/dependencies.ts`.
- [x] Thread PelRunOptionsV1 and optionsDigest through evaluation and continuation validation.
- [x] Preserve the last source top-level value in ordered and automatic modes.
- [x] Add the R-M1-007 through R-M1-009 fixtures in `packages/pel/test/control.test.ts`.

## F-M1-05 Diagnostics and evaluation limits

- [x] Implement structured source diagnostics in `packages/pel/src/diagnostics.ts`.
- [x] Implement counters and pre-reduction limit checks in `packages/pel/src/evaluator.ts`.
- [x] Add the R-M1-010 and R-M1-011 fixtures in `packages/pel/test/limits.test.ts`.

## F-M1-06 Host suspension and recovery data

- [x] Define host descriptors, requests, and receipts in `packages/pel/src/host-contract.ts`.
- [x] Implement HostRegistryV1 construction, schemas, and the R-M1-017 decoder fixtures.
- [x] Include resolverCatalog in registry construction and its canonical digest.
- [x] Implement suspension and validated resume in `packages/pel/src/evaluator.ts`.
- [x] Preserve valid host failures as PEL_HOST_FAILURE diagnostics.
- [x] Implement persistent emission flags for all unreceipted ready requests.
- [x] Implement child closure evaluation and counter merging in `packages/pel/src/evaluator.ts`.
- [x] Implement canonical internal argument encoding with cycle-safe environment node tables.
- [x] Include retry attempt and race contender indices in nested request identities.
- [x] Validate mapped revision receipts without restoring old continuations under new source digests.
- [x] Implement validateRevisionPrefix and R-M1-020 completed-prefix replay fixtures.
- [x] Preserve committed failed-step counters and use separate bounded replay counters.
- [x] Implement data-only continuation encoding in `packages/pel/src/continuation.ts`.
- [x] Add the R-M1-012 through R-M1-016 fixtures in `packages/pel/test/host-contract.test.ts`.
- [x] Document host extension and REPeL ownership in `docs/reference/pel/extensions.md`.

## Validation

- [x] Run `npm run typecheck` and confirm zero TypeScript errors.
- [x] Add the Pel project reference to orchestration and exclude dist-test from aggregate TypeScript inputs.
- [x] Disable declaration output in the test build configuration.
- [x] Run `npx tsc -p packages/pel/tsconfig.test.json` and confirm compilation succeeds.
- [x] Run `npm run typecheck` after the test build and confirm zero duplicate declarations.
- [x] Run `npx tsx scripts/run-tests.ts "packages/pel/dist-test/test/*.test.js"` and confirm every catalog assertion passes.
- [x] Run `openspec validate foredi-01-pel-language --strict` and confirm no validation errors.
