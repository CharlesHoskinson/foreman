# M1 implementation tasks

All checkboxes describe future work. Test files and commands are planned.

## F-M1-01 Published grammar and source locations

- [ ] Create the strict TypeScript package configuration and workspace references.
- [ ] Add `packages/pel/test/**/*.test.ts` to the root test command's explicit globs.
- [ ] Implement tokenizer spans and lexical errors in `packages/pel/src/tokenizer.ts`.
- [ ] Implement AST parsing and quote rules in `packages/pel/src/parser.ts`.
- [ ] Preserve ArgSpec value presence and correct tokenizer glyph rules from the PDF.
- [ ] Keep caret scope validation in evaluation and add the T-M1-021 phase fixtures.
- [ ] Correct profile locators and separate pure paper rows from extension restrictions.
- [ ] Implement every classified positive and negative fixture in paper-v2.json.
- [ ] Add R-M1-019 coverage in `packages/pel/test/profile.test.ts`.
- [ ] Add the R-M1-001 and R-M1-002 fixtures in `packages/pel/test/syntax.test.ts`.

## F-M1-02 Values and callable lists

- [ ] Implement value tags and canonical formatting in `packages/pel/src/values.ts`.
- [ ] Implement canonical tagged JSON encoding and R-M1-018 round-trip fixtures.
- [ ] Implement pair formation and callable-list lookup in `packages/pel/src/builtins.ts`.
- [ ] Add the R-M1-003 and R-M1-004 fixtures in `packages/pel/test/values.test.ts`.
- [ ] Write the paper-linked errata table in `docs/reference/pel/compatibility.md`.

## F-M1-03 Closures and argument binding

- [ ] Implement immutable lexical environments and closures in `packages/pel/src/evaluator.ts`.
- [ ] Implement defaults and partial argument binding in `packages/pel/src/arguments.ts`.
- [ ] Implement fixed pure builtin signatures in `packages/pel/src/builtins.ts`.
- [ ] Implement non-strict def/lambda signatures and required-versus-nil-default binding fixtures.
- [ ] Implement branch, iteration, and block scope fixtures.
- [ ] Add the R-M1-005 and R-M1-006 fixtures in `packages/pel/test/closures.test.ts`.

## F-M1-04 Pipes and native control flow

- [ ] Implement recursive pipe insertion in `packages/pel/src/evaluator.ts`.
- [ ] Implement resolved case caret ownership, leading-call chain injection, aliases, and def-pipe fixtures.
- [ ] Implement non-strict if, case, for, do, and do/async in `packages/pel/src/builtins.ts`.
- [ ] Implement dependency analysis in `packages/pel/src/dependencies.ts`.
- [ ] Thread PelRunOptionsV1 and optionsDigest through evaluation and continuation validation.
- [ ] Preserve the last source top-level value in ordered and automatic modes.
- [ ] Add the R-M1-007 through R-M1-009 fixtures in `packages/pel/test/control.test.ts`.

## F-M1-05 Diagnostics and evaluation limits

- [ ] Implement structured source diagnostics in `packages/pel/src/diagnostics.ts`.
- [ ] Implement counters and pre-reduction limit checks in `packages/pel/src/evaluator.ts`.
- [ ] Add the R-M1-010 and R-M1-011 fixtures in `packages/pel/test/limits.test.ts`.

## F-M1-06 Host suspension and recovery data

- [ ] Define host descriptors, requests, and receipts in `packages/pel/src/host-contract.ts`.
- [ ] Implement HostRegistryV1 construction, schemas, and the R-M1-017 decoder fixtures.
- [ ] Include resolverCatalog in registry construction and its canonical digest.
- [ ] Implement suspension and validated resume in `packages/pel/src/evaluator.ts`.
- [ ] Preserve valid host failures as PEL_HOST_FAILURE diagnostics.
- [ ] Implement persistent emission flags for all unreceipted ready requests.
- [ ] Implement child closure evaluation and counter merging in `packages/pel/src/evaluator.ts`.
- [ ] Implement canonical internal argument encoding with cycle-safe environment node tables.
- [ ] Include retry attempt and race contender indices in nested request identities.
- [ ] Validate mapped revision receipts without restoring old continuations under new source digests.
- [ ] Implement validateRevisionPrefix and R-M1-020 completed-prefix replay fixtures.
- [ ] Preserve committed failed-step counters and use separate bounded replay counters.
- [ ] Implement data-only continuation encoding in `packages/pel/src/continuation.ts`.
- [ ] Add the R-M1-012 through R-M1-016 fixtures in `packages/pel/test/host-contract.test.ts`.
- [ ] Document host extension and REPeL ownership in `docs/reference/pel/extensions.md`.

## Validation

- [ ] Run `npm run typecheck` and confirm zero TypeScript errors.
- [ ] Add the Pel project reference to orchestration and exclude dist-test from aggregate TypeScript inputs.
- [ ] Disable declaration output in the test build configuration.
- [ ] Run `npx tsc -p packages/pel/tsconfig.test.json` and confirm compilation succeeds.
- [ ] Run `npm run typecheck` after the test build and confirm zero duplicate declarations.
- [ ] Run `npx tsx scripts/run-tests.ts "packages/pel/dist-test/test/*.test.js"` and confirm every catalog assertion passes.
- [ ] Run `openspec validate foredi-01-pel-language --strict` and confirm no validation errors.
