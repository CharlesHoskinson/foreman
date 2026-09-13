# M2 implementation tasks

Implementation is complete. See docs/releases/return-of-the-foredi/m2-implementation.md and m2-verification.json for evidence.

## F-M2-01 Source checking

- [x] Implement scope and argument checking in `packages/pel/src/checker.ts`.
- [x] Implement definite branch bindings and T-M2-016 conditional-definition fixtures.
- [x] Define typed authoring inputs and errors in `packages/orchestration/src/pel-authoring-contract.ts`.
- [x] Implement complete AuthoringSnapshotV1 content validation and R-M2-014 fixtures.
- [x] Package the default authoring snapshot at runtime/assets/pel/default-authoring-snapshot.json.
- [x] Create pel-host-descriptors.ts with all initial declaration and schema records, including candidate-v1.
- [x] Generate and byte-check the default snapshot from the shared declaration module.
- [x] Implement shared CLI exit codes in the authoring command table.
- [x] Implement check argument handling in `packages/orchestration/src/pel-authoring-cli.ts`.
- [x] Export makeForemanCli with injectable authoring service ports.
- [x] Add R-M2-001 and R-M2-002 fixtures in the catalog test targets.

## F-M2-02 Pure effect previews

- [x] Implement abstract Pel values in `packages/pel/src/analysis.ts`.
- [x] Implement PlanPreviewV1 rendering in `packages/pel/src/preview.ts`.
- [x] Add R-M2-003 and R-M2-004 fixtures in the catalog test targets.

## F-M2-03 Capability and dynamic-region analysis

- [x] Implement descriptor and capability checks in `packages/pel/src/analysis.ts`.
- [x] Implement finite dynamic-region envelopes in `packages/pel/src/analysis.ts`.
- [x] Resolve exact role, transport, controls, and natural-language predicate selections from the snapshot.
- [x] Add R-M2-005 and R-M2-006 fixtures in the catalog test targets.

## F-M2-04 Exact preview binding

- [x] Implement PlanBindingV1 hashing in `packages/pel/src/binding.ts`.
- [x] Implement buildEffectiveAuthoringSnapshotV1 and include optionsDigest in checked bindings.
- [x] Reject mismatched imported bindings in `packages/pel/src/binding.ts`.
- [x] Add the R-M2-007 fixture in `packages/pel/test/binding.test.ts`.

## F-M2-05 Bounded natural-language generation

- [x] Define the shared generation port contract in coordination with M3.
- [x] Create the minimal providers package metadata, TypeScript configuration, and generation-only contract exports.
- [x] Create the canonical ProviderFailure union in `packages/providers/src/errors.ts`.
- [x] Bootstrap the shared failure record, ProviderUsageV1, ProviderIdentityV1, and CredentialPort without reverse imports.
- [x] Add the providers project reference and Effect dependency to the workspace.
- [x] Implement the generation loop in `packages/orchestration/src/pel-generation.ts`.
- [x] Implement attempt timeouts and aggregate limits through Effect.
- [x] Implement GenerationBudgetPort and complete request lowering with R-M2-015 fixtures.
- [x] Implement the exhaustive ProviderFailure switch and grammar-mode selection.
- [x] Add R-M2-008 through R-M2-010 fixtures in `packages/orchestration/src/pel-generation.test.ts`.
- [x] Wire explicit prompt generation into the plan command.

## F-M2-06 Operator diagnostics and draft editing

- [x] Implement source context and registry-backed help in the authoring CLI.
- [x] Implement draft revision commands in `packages/orchestration/src/pel-draft-session.ts`.
- [x] Implement in-memory history, completion, and bounded revision storage.
- [x] Add R-M2-011 through R-M2-013 fixtures in the catalog test targets.
- [x] Write the four Pel examples and `docs/reference/pel/authoring.md`.
- [x] Add the Node.js authoring entry to `scripts/build-runtime.ts`.
- [x] Add the generated Node.js entry header and leave symlink installation to M6.
- [x] Create the side-effect-free fixture main, separate invocation entry, and separate fixture tests.
- [x] Create scripts/build-pel-test-fixture.ts and the test:pel-fixture-build command.
- [x] Add fixture build to pretest and focused authoring test setup.
- [x] Add Pel tests to the explicit root test globs.
- [x] Add test:pel-authoring with the exact quoted run-tests.ts paths from design.md.

## Validation

- [x] Run `npm run typecheck` and confirm zero errors.
- [x] Run `sh -c 'npm run test:pel-authoring'` and confirm all seven focused target files execute.
- [x] Confirm run-tests.ts exits 1 for a deliberately missing quoted path.
- [x] Build the runtime and confirm the sequential example produces the catalog preview.
- [x] Run `openspec validate foredi-02-plan-authoring --strict` and confirm no validation errors.
