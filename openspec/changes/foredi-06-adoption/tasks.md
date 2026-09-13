# M6 implementation tasks

All tasks and runtime tests below remain planned.
The catalog provides test IDs, inputs, commands and expected observations.

## 1. F-M6-01 installation and quickstart

- [ ] Inspect the existing installer and runtime archive layout.
- [ ] Implement `packages/orchestration/src/pel-install.ts` with manifest validation and atomic installation.
- [ ] Extend `scripts/build-runtime.ts` to include matching Pel examples and profile evidence.
- [ ] Write `docs/guides/pel/install.md` using the actual supported install command.
- [ ] Write `docs/guides/pel/quickstart.md` with explicit credential and admission prerequisites.
- [ ] Implement `packages/orchestration/src/pel-adoption.ts` for installed feature metadata.
- [ ] Implement T-M6-001 through T-M6-003 in the catalog's TypeScript test files.
- [ ] Assert the clean installation works without checkout files, global TypeScript tools or an external vault.
- [ ] Assert one `foreman run` command starts the admitted standard workflow.

## 2. F-M6-02 usable examples

- [ ] Create the six workflow examples listed in `design.md`.
- [ ] Package M2's valid conditional.pel and repair.pel authoring examples under their canonical names.
- [ ] Create `examples/pel/profiles/<exact-id>.pel` for all six requested profiles.
- [ ] Document each example's required capabilities, output and status commands.
- [ ] Add exact API/native transport configuration instructions without another workflow format.
- [ ] Implement T-M6-004 through T-M6-006 in `pel-examples.test.ts`.
- [ ] Execute every shipped example against explicit test-fixture transports.
- [ ] Assert unavailable profiles retain exact IDs and produce zero execution effects.

## 3. F-M6-03 legacy migration

- [ ] Implement `packages/orchestration/src/pel-migration.ts` and M2's unified CLI migrate command.
- [ ] Add the two exact RoundPlanV1/ExecutionContractV1 corpus pairs listed in design.md.
- [ ] Reject unsupported legacy constructs with exact source diagnostics.
- [ ] Refuse migration of active legacy runs without transferring their leases.
- [ ] Replace one complete caller-to-controller path before expanding the migration cohort.
- [ ] Remove replaced retry, dispatch and command-construction behavior from the named legacy files.
- [ ] Preserve historical record decoders and existing safety services.
- [ ] Delete the twelve named shell cohort files after migrating and testing all callers.
- [ ] Implement T-M6-007 through T-M6-009 in `pel-migration.test.ts`.
- [ ] Search remaining callers with `rg` and execute parity tests before retiring each path.
- [ ] Assert one owner controls each migrated run and deferred Council paths remain unchanged.

## 4. F-M6-04 measured simplification

- [ ] Freeze `docs/release-metrics/foredi-baseline.json` before changing measured behavior.
- [ ] Record baseline hashes, production ranges, instruction corpus and tokenizer identity.
- [ ] Reconcile v0.5, lane-runtime-typescript and workflow-weight-reduction obligations without inventing completion.
- [ ] Implement `packages/orchestration/src/pel-simplification.ts` and its compiled measurement entry point.
- [ ] Count the exact full-file candidate union, including every added or modified production path, and report total growth.
- [ ] Implement T-M6-010 through T-M6-012 in `pel-simplification.test.ts`.
- [ ] Measure at least 40 percent net glue reduction and 50 percent required instruction reduction.
- [ ] Report raw counts, exclusions and failed targets without relabeling them as completed.
- [ ] Assert matching verification bindings reuse one result and changed bindings force verification.

## 5. F-M6-05 research usability

- [ ] Implement `packages/orchestration/src/pel-research-context.ts` over existing bounded context services.
- [ ] Implement `packages/orchestration/src/pel-research-refresh.ts` with atomic derived-snapshot replacement.
- [ ] Add research query, status and captured-bundle refresh commands to the existing CLI.
- [ ] Preserve source locators, hashes, capture dates, claim classes and coverage warnings.
- [ ] Add optional Obsidian links and document the portable bundle's default location.
- [ ] Keep advisory and qualified graph identities separate.
- [ ] Implement T-M6-013 through T-M6-015 in `pel-research-context.test.ts`.
- [ ] Assert changed sources mark dependent context stale and interrupted refresh preserves readable data.
- [ ] Assert removing the external vault leaves the standard workflow usable.

## 6. F-M6-06 package, support and rollback

- [ ] Implement `packages/orchestration/src/{pel-package,pel-support}.ts`.
- [ ] Add safe support export and schema-compatible install rollback to the existing CLI.
- [ ] Include matching runtime, examples, source manifests, support evidence and migration instructions in the archive.
- [ ] Preserve unresolved v0.5 records in release notes and reconcile the numerical version through the existing release program.
- [ ] Implement T-M6-016 through T-M6-018 in `pel-package.test.ts` and `pel-support.test.ts`.
- [ ] Add the planned `test:adoption` script using exact catalog test targets.
- [ ] Run `npm run typecheck`, `npm run test:adoption` and `npm run build`.
- [ ] Run `npm run verify-runtime`, `npm run verify` and applicable architecture/install checks.
- [ ] Assert copied installation artifacts match the unchanged candidate.
- [ ] Assert rollback preserves history and rejects incompatible active checkpoints.
- [ ] Assert support export contains reproducible safe context without credentials or hidden reasoning.


## 7. Concrete installation and migration contracts

- [ ] Add pel-install-main.ts and pel-simplification-main.ts to the build-runtime entries.
- [ ] Emit runtime/dist/install.js and runtime/dist/pel-simplification.js from those TypeScript sources.
- [ ] Package assets/pel/default-authoring-snapshot.json and its referenced registry/profile/schema digests.
- [ ] Implement the Linux x64 Node.js 24 bootstrap command and retained-version layout from design.md.
- [ ] Create executable symlinks to generated Node.js output without adding shell implementation source.
- [ ] Implement --version JSON with releaseName, nullable version and buildId.
- [ ] Check every registered state root before changing the current-version symlink during rollback.
- [ ] Add the project-settings.json fixture and one-time project configure quickstart command.
- [ ] Use M2's non-test fixture entry with mandatory --fixture-manifest and manifest-bound copied assetRoot.
- [ ] Reject fixture bindings in the product and assert exit 2 for missing project configuration or provider evidence.
- [ ] Restrict import to the two exact RoundPlanV1/ExecutionContractV1 fixture directories.
- [ ] Keep Council-specific workflows outside this import and deletion cohort.
- [ ] Freeze hashes for the fifteen production files and five instruction files already fixed in this specification.
- [ ] Pin js-tiktoken 1.0.21 and cl100k_base with the specified integrity and counting rules.
- [ ] Fail measurement if the cohort or tokenizer differs from the specification.
- [ ] Check canonical example filenames against the package manifest and every catalog reference.
- [ ] Implement T-M6-019 for configured bare run and exact exit 2 on missing or invalid configuration.
- [ ] Implement T-M6-020 for nullable version output and installed manifest identity.

## 8. Command outcome codes

- [ ] Extend the shared M2 router commandExitCode mapping with the adoption rows in design.md.
- [ ] Implement T-M6-021 in packages/orchestration/src/pel-adoption-cli.test.ts.
- [ ] Strengthen the existing catalog assertions for exact success, failure, invalid, needs-action and cancellation codes.
- [ ] Add the exact command test target to test:adoption and retain root test discovery.
- [ ] Assert bounded attached commands never use final exit 5 to conceal an unresolved outcome.

## 9. Final executable adoption contracts

- [ ] Consume the M2-owned non-test fixture main/entry and separate fixture test module.
- [ ] Add mandatory --fixture-manifest to every runtime acceptance invocation.
- [ ] Validate copied assetRoot, assetManifestSha256 and stateRoot before fixture dispatch.
- [ ] Use ForemanProjectV1 consistently and test registered versus unregistered state-root overrides.
- [ ] Implement pel-research-host.ts against M2's frozen fm/research descriptor and schema.
- [ ] Return M4 read-result preparation with empty write sets and zero external reservations.
- [ ] Implement T-M6-022 with research-prepare and parallel-read through the fixture launcher.
- [ ] Delete all twelve legacy shell cohort files after caller migration and extend T-M6-009 absence/caller checks.
- [ ] Add pel-package-main.ts, its runtime bundle entry and package:pel npm script.
- [ ] Pin tar 7.5.22 for deterministic TypeScript archive production.
- [ ] Implement ManifestPayloadV1 canonical hashing and artifacts/foredi/<buildId>.tar.gz output.
- [ ] Implement T-M6-023 and make T-M6-001 install the archive produced by T-M6-016.
- [ ] Extend T-M6-010 to count a new research file and full residual instruction files under the exact membership rule.
- [ ] Search packages, components/council, skills/foreman, scripts, env and .github for all deleted paths and basenames.
- [ ] Migrate retained Council shared-entry callers to existing compiled interfaces before deleting their dependencies.
- [ ] Run retained Council review/preflight fixtures and regenerate runtime manifests after shared caller changes.
- [ ] Add pretest:adoption invoking M2's test:pel-fixture-build before copied-asset runtime acceptance.
