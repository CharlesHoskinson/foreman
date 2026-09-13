# M4 implementation tasks

Status: implemented. The verification record is docs/releases/return-of-the-foredi/m4-verification.json.
The full workspace run retains three documented baseline failures for M6 reconciliation; M4 regressions pass.
Use strict TypeScript on Node.js 24. Keep Effect resource and error ownership inside `packages/orchestration`.

## 1. F-M4-01: Start and inspect a durable run

- [x] 1.1 Add `pel-run-contract.ts` with strict execution binding, run status, result, and failure decoders.
- [x] 1.2 Add `pel-runner.ts` using the existing supervisor lease and one Effect scope per admitted run.
- [x] 1.3 Extend M2 `makeForemanCli(services)`, `pel-authoring-cli.ts`, and `pel-authoring-main.ts` with lifecycle arguments and exit codes.
- [x] 1.4 Revalidate each resolved M1 host request against M2 envelopes before reserving it.
- [x] 1.5 Implement T-M4-001 and T-M4-002 in `pel-runner.test.ts` and `pel-effects.test.ts`.
- [x] 1.6 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-runner.test.ts" "packages/orchestration/src/pel-effects.test.ts"`.
- [x] 1.7 Add `pel-project-config.ts` and the strict Git-common-directory `ForemanProjectV1` settings decoder.
- [x] 1.8 Register `foreman project configure --settings FILE` in the shared router and existing project registry seam.
- [x] 1.9 Implement pure configuration-to-binding derivation and bare-run settings discovery without granting new authority.
- [x] 1.10 Add read-only `prepareHostEffect` and reservation-token validation for reuse, needs-action, and exactly one dispatched action.
- [x] 1.11 Implement T-M4-019 ledger spy assertions, including zero reuse/denial charges and one authorized publication charge.
- [x] 1.12 Derive the shared effective snapshot through M2 and reject executable registry digest mismatches before dispatch.
- [x] 1.13 Reuse existing reservationId fields and require existing V2 evaluation child authority for natural-language predicates.
- [x] 1.14 Validate registered state-root overrides for run/resume without depending on an installation prefix.

Assert one owner, one dispatch, exact authority binding, and zero reservation for denied dynamic effects.

## 2. F-M4-02: Resume recorded host results

- [x] 2.1 Add `pel-journal.ts` record decoders inside the existing stored-event payload envelope.
- [x] 2.2 Bind evaluator request IDs to durable effect IDs with attempt and retry ordinals.
- [x] 2.3 Derive stable existing `ReserveAction.reservationId` values from effect, action, and preparation digest.
- [x] 2.4 Record intent before dispatch and validated results before evaluator continuation.
- [x] 2.5 Implement reservation-without-intent recovery and identical receipt deduplication.
- [x] 2.6 Implement T-M4-003 through T-M4-005 with all six interruption fixtures.
- [x] 2.7 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-journal.test.ts" "packages/orchestration/src/pel-recovery.test.ts"`.
- [x] 2.8 Persist immutable source, complete snapshot, registry, and settings artifacts before admission completes.
- [x] 2.9 Persist automatic suspension continuations and committed counters before every newly ready dispatch batch.
- [x] 2.10 Add provider tool intent/result and cursor records with full identity/call-ID deduplication.
- [x] 2.11 Persist opaque checkpoint bytes in protected existing artifact storage before advancing stream cursors.
- [x] 2.12 Implement T-M4-017 and T-M4-018 for altered source files, lost artifacts, repeated tools, and exact counter recovery.
- [x] 2.13 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-provider-tools.test.ts" "packages/orchestration/src/pel-recovery.test.ts"`.
- [x] 2.14 Persist deep continuations, arguments, results, tools, and output as flushed immutable artifact references.
- [x] 2.15 Implement T-M4-022 without changing existing journal line, depth, node, or total replay bounds.
- [x] 2.16 Match T-M4-003 to combined intent metadata and enumerate all declared payload types in decoder tests.

Assert exact Pel value replay, unchanged budgets, unknown outcome classification, and conflicting receipt rejection.

## 3. F-M4-03: Execute bounded native concurrency

- [x] 3.1 Add `pel-resource-scope.ts` with canonical resource sets, deterministic acquisition order, and scoped permits.
- [x] 3.2 Dispatch eligible requests from M1 native `do/async` batches within M2 dependency and resource envelopes.
- [x] 3.3 Add `fm/race` registration and isolated closure execution to `pel-control-functions.ts`.
- [x] 3.4 Persist winner selection before exposing its result and clean up losing scopes.
- [x] 3.5 Implement T-M4-006 through T-M4-008 with resource barriers and observed cancellation fixtures.
- [x] 3.6 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-resource-scope.test.ts" "packages/orchestration/src/pel-control-functions.test.ts"`.
- [x] 3.7 Implement descriptor resource rules and argument-dependent `resolveResources` with canonical path identity checks.
- [x] 3.8 Allocate race contender worktrees from admitted finite closure envelopes before provider dispatch.
- [x] 3.9 Return the exact winner-index/value/losers schema and account for every losing child's counters.
- [x] 3.10 Persist child continuations, grants, tranches, and race decisions before nested dispatch or winner exposure.
- [x] 3.11 Use M1 canonical closure-argument encoding and verify its environment graph digest on recovery.
- [x] 3.12 Release wrapper concurrency permits while child effects execute and test a race at concurrency one.

Assert source-result semantics, maximum concurrency, alias conflict serialization, isolated race artifacts, and truthful loser outcomes.

## 4. F-M4-04: Control retries and timeouts

- [x] 4.1 Implement `fm/retry` with typed transient categories and existing persistent action limits.
- [x] 4.2 Link each retry ordinal to its parent effect and its original cost and deadline budget.
- [x] 4.3 Apply scoped timeouts through the existing launcher and M3 cancellation observations.
- [x] 4.4 Make duplicate operator cancellation requests idempotent in `pel-journal.ts`.
- [x] 4.5 Implement T-M4-009 through T-M4-011 with clocks, provider observations, and restart fixtures.
- [x] 4.6 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-control-functions.test.ts" "packages/orchestration/src/pel-runner.test.ts" "packages/orchestration/src/pel-authoring-cli.test.ts"`.
- [x] 4.7 Classify exact M3 tags from `PEL_HOST_FAILURE` and reject unknown `:on` keyword values.
- [x] 4.8 Bind one-based retry and race child IDs into every nested invocation path and durable effect mapping.
- [x] 4.9 End unsupported cancellation observation at the admitted deadline with needs-action exit `3`.
- [x] 4.10 Accept evaluated lists of quoted retry keys and reject syntax or nil-pair lists before body evaluation.
- [x] 4.11 Carry retryContext logical-operation keys and charge matching later attempts only as provider_retry.

Assert spent retry preservation, nonretryable authentication failure, local cleanup, pending exit 5, and confirmed-cancelled exit 4.

## 5. F-M4-05: Recover unknown outcomes and revisions

- [x] 5.1 Implement `fm/checkpoint` with M1 data-only continuation and protected provider artifact references.
- [x] 5.2 Add `pel-recovery.ts` compatibility, current-attempt, lease, and completed-prefix validation.
- [x] 5.3 Decode `PelRecoveryDecisionV1` and bind each explicit decision to its effect and authority evidence.
- [x] 5.4 Implement observation-based reconciliation through M3 existing provider identities without redispatch.
- [x] 5.5 Implement source revision records that retain original authority, counters, and completed effects.
- [x] 5.6 Route Pel supervisor and resume-queue paths into `resumeProgram`, preserving legacy decoders.
- [x] 5.7 Implement T-M4-012 through T-M4-014 and T-M4-016 in `pel-recovery.test.ts`.
- [x] 5.8 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-recovery.test.ts" "packages/orchestration/src/resume-decision.test.ts" "packages/orchestration/src/resume-queue-execution.test.ts"`.
- [x] 5.9 Decode separate `PelRevisionDecisionV1` and `PelRevisionMappingV1` records with M1 prefix validation.
- [x] 5.10 Re-evaluate revised immutable source and adapt mapped old receipts to new request IDs without another reservation.
- [x] 5.11 Reject partial-form edits and completed-argument changes before dispatch, preserving prefix work counters.
- [x] 5.12 Preserve recoverable host requests as pending observations without sending terminal M1 receipts.
- [x] 5.13 Resume pending authority or external-outcome decisions without repeating completed task effects.
- [x] 5.14 Persist failed-step total counters and pass M1 replay recordedCounters plus committedCounters to revisions.

Assert closure capture recovery, no duplicate completed effect, refusal of altered prefixes, and unchanged terminal budgets.

## 6. F-M4-06: Explain run outcomes

- [x] 6.1 Project status and results from the journal with source spans, evidence references, and conservative usage bounds.
- [x] 6.2 Render text and JSON through the same result decoder in `pel-authoring-cli.ts`.
- [x] 6.3 Implement T-M4-015 with provider calls forbidden during status reads.
- [x] 6.4 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-authoring-cli.test.ts"`.
- [x] 6.5 Run `npm run typecheck` and `npm run build`.
- [x] 6.6 Run production argument and admission-denial tests through `node skills/foreman/runtime/dist/foreman.js`.
- [x] 6.7 Run `npm run verify` and inspect existing journal, ledger, terminal policy, launcher, and resume results.
- [x] 6.8 Implement the exhaustive failure/exit table and attached run-started stderr event before dispatch.
- [x] 6.9 Add `pel-native-host.ts` print and Boolean predicate handlers with registered result schemas.
- [x] 6.10 Implement T-M4-020 for predicate receipt replay and exactly one JSON stdout result after print.
- [x] 6.11 Extend M2's shared router and side-effect-free fixture main with lifecycle services.
- [x] 6.12 Implement T-M4-021 and reject fixture binding data or the fixture-manifest flag in production.
- [x] 6.13 Extend M2 `scripts/build-pel-test-fixture.ts` for lifecycle fixtures and run `npm run test:pel-fixture-build` before dependent tests.
- [x] 6.14 Run recorded lifecycle tests with `node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest fixture-manifest.json run fixture.pel --json`.
- [x] 6.15 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-native-host.test.ts" "packages/orchestration/src/pel-cli-fixture.test.ts"`.
- [x] 6.16 Validate fixture manifest assetRoot/hashes and assert root pretest builds the non-test invocation entry.
- [x] 6.17 Implement T-M4-023 declared final-result schema classification and malformed-lookalike rejection.
- [x] 6.18 Add `pel-run-result.ts` and run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-run-result.test.ts"`.

Assert status and result agreement, readable next actions, correct lifecycle exit codes, and zero secret disclosure.
Record actual commands and results during implementation. Do not mark planned catalog tests as historical evidence.
