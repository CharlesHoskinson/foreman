# M2 implementation tasks

All checkboxes describe future implementation. Tests and commands are planned.

## F-M2-01 Source checking

- [ ] Implement scope and argument checking in `packages/pel/src/checker.ts`.
- [ ] Implement definite branch bindings and T-M2-016 conditional-definition fixtures.
- [ ] Define typed authoring inputs and errors in `packages/orchestration/src/pel-authoring-contract.ts`.
- [ ] Implement complete AuthoringSnapshotV1 content validation and R-M2-014 fixtures.
- [ ] Package the default authoring snapshot at runtime/assets/pel/default-authoring-snapshot.json.
- [ ] Create pel-host-descriptors.ts with all initial declaration and schema records, including candidate-v1.
- [ ] Generate and byte-check the default snapshot from the shared declaration module.
- [ ] Implement shared CLI exit codes in the authoring command table.
- [ ] Implement check argument handling in `packages/orchestration/src/pel-authoring-cli.ts`.
- [ ] Export makeForemanCli with injectable authoring service ports.
- [ ] Add R-M2-001 and R-M2-002 fixtures in the catalog test targets.

## F-M2-02 Pure effect previews

- [ ] Implement abstract Pel values in `packages/pel/src/analysis.ts`.
- [ ] Implement PlanPreviewV1 rendering in `packages/pel/src/preview.ts`.
- [ ] Add R-M2-003 and R-M2-004 fixtures in the catalog test targets.

## F-M2-03 Capability and dynamic-region analysis

- [ ] Implement descriptor and capability checks in `packages/pel/src/analysis.ts`.
- [ ] Implement finite dynamic-region envelopes in `packages/pel/src/analysis.ts`.
- [ ] Resolve exact role, transport, controls, and natural-language predicate selections from the snapshot.
- [ ] Add R-M2-005 and R-M2-006 fixtures in the catalog test targets.

## F-M2-04 Exact preview binding

- [ ] Implement PlanBindingV1 hashing in `packages/pel/src/binding.ts`.
- [ ] Implement buildEffectiveAuthoringSnapshotV1 and include optionsDigest in checked bindings.
- [ ] Reject mismatched imported bindings in `packages/pel/src/binding.ts`.
- [ ] Add the R-M2-007 fixture in `packages/pel/test/binding.test.ts`.

## F-M2-05 Bounded natural-language generation

- [ ] Define the shared generation port contract in coordination with M3.
- [ ] Create the minimal providers package metadata, TypeScript configuration, and generation-only contract exports.
- [ ] Create the canonical ProviderFailure union in `packages/providers/src/errors.ts`.
- [ ] Bootstrap the shared failure record, ProviderUsageV1, ProviderIdentityV1, and CredentialPort without reverse imports.
- [ ] Add the providers project reference and Effect dependency to the workspace.
- [ ] Implement the generation loop in `packages/orchestration/src/pel-generation.ts`.
- [ ] Implement attempt timeouts and aggregate limits through Effect.
- [ ] Implement GenerationBudgetPort and complete request lowering with R-M2-015 fixtures.
- [ ] Implement the exhaustive ProviderFailure switch and grammar-mode selection.
- [ ] Add R-M2-008 through R-M2-010 fixtures in `packages/orchestration/src/pel-generation.test.ts`.
- [ ] Wire explicit prompt generation into the plan command.

## F-M2-06 Operator diagnostics and draft editing

- [ ] Implement source context and registry-backed help in the authoring CLI.
- [ ] Implement draft revision commands in `packages/orchestration/src/pel-draft-session.ts`.
- [ ] Implement in-memory history, completion, and bounded revision storage.
- [ ] Add R-M2-011 through R-M2-013 fixtures in the catalog test targets.
- [ ] Write the four Pel examples and `docs/reference/pel/authoring.md`.
- [ ] Add the Node.js authoring entry to `scripts/build-runtime.ts`.
- [ ] Add the generated Node.js entry header and leave symlink installation to M6.
- [ ] Create the side-effect-free fixture main, separate invocation entry, and separate fixture tests.
- [ ] Create scripts/build-pel-test-fixture.ts and the test:pel-fixture-build command.
- [ ] Add fixture build to pretest and focused authoring test setup.
- [ ] Add Pel tests to the explicit root test globs.
- [ ] Add test:pel-authoring with the exact quoted run-tests.ts paths from design.md.

## Validation

- [ ] Run `npm run typecheck` and confirm zero errors.
- [ ] Run `sh -c 'npm run test:pel-authoring'` and confirm all seven focused target files execute.
- [ ] Confirm run-tests.ts exits 1 for a deliberately missing quoted path.
- [ ] Build the runtime and confirm the sequential example produces the catalog preview.
- [ ] Run `openspec validate foredi-02-plan-authoring --strict` and confirm no validation errors.
