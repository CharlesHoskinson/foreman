# M6 implementation tasks

Checked tasks have source implementation or recorded focused validation.
Final candidate acceptance and unchecked tasks remain open.
The catalog provides test IDs, inputs, commands and expected observations.
See docs/releases/return-of-the-foredi/m6-implementation.md and m6-ears-coverage.md.

## 1. F-M6-01 installation and quickstart

- [x] Inspect the existing installer and runtime archive layout.
- [x] Implement `packages/orchestration/src/pel-install.ts` with manifest validation and atomic installation.
- [x] Extend `scripts/build-runtime.ts` to include matching Pel examples and profile evidence.
- [x] Write `docs/guides/pel/install.md` using the actual supported install command.
- [x] Write `docs/guides/pel/quickstart.md` with explicit credential and admission prerequisites.
- [x] Implement `packages/orchestration/src/pel-adoption.ts` for installed feature metadata.
- [x] Implement T-M6-001 through T-M6-003 in the catalog's TypeScript test files.
- [x] Assert the clean installation works without checkout files, global TypeScript tools or an external vault.
- [x] Assert one `foreman run` command starts the admitted standard workflow.

## 2. F-M6-02 usable examples

- [x] Create the six workflow examples listed in `design.md`.
- [x] Package M2's valid conditional.pel and repair.pel authoring examples under their canonical names.
- [x] Create `examples/pel/profiles/<exact-id>.pel` for all six requested profiles.
- [x] Document each example's required capabilities, output and status commands.
- [x] Add exact API/native transport configuration instructions without another workflow format.
- [x] Implement T-M6-004 through T-M6-006 in the catalog's example and readiness test files.
- [x] Execute every shipped example against explicit test-fixture transports.
- [x] Assert unavailable profiles retain exact IDs and produce zero execution effects.

## 3. F-M6-03 legacy migration

- [x] Implement `packages/orchestration/src/pel-migration.ts` and M2's unified CLI migrate command.
- [x] Add the two exact RoundPlanV1/ExecutionContractV1 corpus pairs listed in design.md.
- [x] Reject unsupported legacy constructs with exact source diagnostics.
- [x] Refuse migration of active legacy runs without transferring their leases.
- [x] Replace one complete caller-to-controller path before expanding the migration cohort.
- [x] Remove replaced retry, dispatch and command-construction behavior from the named legacy files.
- [x] Preserve historical record decoders and existing safety services.
- [x] Delete the twelve named shell cohort files after migrating and testing all callers.
- [x] Implement T-M6-007 through T-M6-009 in `pel-migration.test.ts`.
- [x] Search remaining callers with `rg` and execute parity tests before retiring each path.
- [x] Assert one owner controls each migrated run and deferred Council paths remain unchanged.

## 4. F-M6-04 measured simplification

- [x] Freeze `docs/release-metrics/foredi-baseline.json` before changing measured behavior.
- [x] Record baseline hashes, production ranges, instruction corpus and tokenizer identity.
- [x] Reconcile v0.5, lane-runtime-typescript and workflow-weight-reduction obligations without inventing completion.
- [x] Implement `packages/orchestration/src/pel-simplification.ts` and its compiled measurement entry point.
- [x] Count the exact full-file candidate union, including every added or modified production path, and report total growth.
- [x] Implement T-M6-010 through T-M6-012 in the simplification and host-verification test files.
- [ ] Measure at least 40 percent net glue reduction and 50 percent required instruction reduction.
- [x] Report raw counts, exclusions and failed targets without relabeling them as completed.
- [x] Assert matching verification bindings reuse one result and changed bindings force verification.

## 5. F-M6-05 research usability

- [x] Implement `packages/orchestration/src/pel-research-context.ts` over existing bounded context services.
- [x] Implement `packages/orchestration/src/pel-research-refresh.ts` with atomic derived-snapshot replacement.
- [x] Add research query, status and captured-bundle refresh commands to the existing CLI.
- [x] Preserve source locators, hashes, capture dates, claim classes and coverage warnings.
- [x] Add optional Obsidian links and document the portable bundle's default location.
- [x] Keep advisory and qualified graph identities separate.
- [x] Implement T-M6-013 through T-M6-015 in `pel-research-context.test.ts`.
- [x] Assert changed sources mark dependent context stale and interrupted refresh preserves readable data.
- [x] Assert removing the external vault leaves the standard workflow usable.

## 6. F-M6-06 package, support and rollback

- [x] Implement `packages/orchestration/src/{pel-package,pel-support}.ts`.
- [x] Add safe support export and schema-compatible install rollback to the existing CLI.
- [x] Include matching runtime, examples, source manifests, support evidence and migration instructions in the archive.
- [ ] Preserve unresolved v0.5 records in release notes and reconcile the numerical version through the existing release program.
- [x] Implement T-M6-016 through T-M6-018 in the package, adoption, and support test files.
- [x] Add the planned `test:adoption` script using exact catalog test targets.
- [x] Run `npm run typecheck`, `npm run test:adoption` and `npm run build`.
- [x] Run `npm run verify-runtime`, `npm run verify` and applicable architecture/install checks.
- [x] Assert copied installation artifacts match the unchanged candidate.
- [x] Assert rollback preserves history and rejects incompatible active checkpoints.
- [x] Assert support export contains reproducible safe context without credentials or hidden reasoning.


## 7. Concrete installation and migration contracts

- [x] Add pel-install-main.ts and pel-simplification-main.ts to the build-runtime entries.
- [x] Emit runtime/dist/install.js and runtime/dist/pel-simplification.js from those TypeScript sources.
- [x] Package assets/pel/default-authoring-snapshot.json and its referenced registry/profile/schema digests.
- [x] Implement the Linux x64 Node.js 24 bootstrap command and retained-version layout from design.md.
- [x] Create executable symlinks to generated Node.js output without adding shell implementation source.
- [x] Implement --version JSON with releaseName, nullable version and buildId.
- [x] Check every registered state root before changing the current-version symlink during rollback.
- [x] Add the project-settings.json fixture and one-time project configure quickstart command.
- [x] Use M2's non-test fixture entry with mandatory --fixture-manifest and manifest-bound copied assetRoot.
- [x] Reject fixture bindings in the product and assert exit 2 for missing project configuration or provider evidence.
- [x] Restrict import to the two exact RoundPlanV1/ExecutionContractV1 fixture directories.
- [x] Keep Council-specific workflows outside this import and deletion cohort.
- [x] Freeze hashes for the fifteen production files and five instruction files already fixed in this specification.
- [x] Pin js-tiktoken 1.0.21 and cl100k_base with the specified integrity and counting rules.
- [x] Fail measurement if the cohort or tokenizer differs from the specification.
- [x] Check canonical example filenames against the package manifest and every catalog reference.
- [x] Implement T-M6-019 for configured bare run and exact exit 2 on missing or invalid configuration.
- [x] Implement T-M6-020 for nullable version output and installed manifest identity.

## 8. Command outcome codes

- [x] Extend the shared M2 router commandExitCode mapping with the adoption rows in design.md.
- [x] Implement T-M6-021 in packages/orchestration/src/pel-adoption-cli.test.ts.
- [x] Strengthen the existing catalog assertions for exact success, failure, invalid, needs-action and cancellation codes.
- [x] Add the exact command test target to test:adoption and retain root test discovery.
- [x] Assert bounded attached commands never use final exit 5 to conceal an unresolved outcome.

## 9. Final executable adoption contracts

- [x] Consume the M2-owned non-test fixture main/entry and separate fixture test module.
- [x] Add mandatory --fixture-manifest to every runtime acceptance invocation.
- [x] Validate copied assetRoot, assetManifestSha256 and stateRoot before fixture dispatch.
- [x] Use ForemanProjectV1 consistently and test registered versus unregistered state-root overrides.
- [x] Implement pel-research-host.ts against M2's frozen fm/research descriptor and schema.
- [x] Return M4 read-result preparation with empty write sets and zero external reservations.
- [x] Implement T-M6-022 with research-prepare and parallel-read through the fixture launcher.
- [x] Delete all twelve legacy shell cohort files after caller migration and extend T-M6-009 absence/caller checks.
- [x] Add pel-package-main.ts, its runtime bundle entry and package:pel npm script.
- [x] Pin tar 7.5.22 for deterministic TypeScript archive production.
- [x] Implement ManifestPayloadV1 canonical hashing and artifacts/foredi/<buildId>.tar.gz output.
- [x] Implement T-M6-023 and make T-M6-001 install the archive produced by T-M6-016.
- [x] Extend T-M6-010 to count a new research file and full residual instruction files under the exact membership rule.
- [x] Search packages, components/council, skills/foreman, scripts, env and .github for all deleted paths and basenames.
- [x] Migrate retained Council shared-entry callers to existing compiled interfaces before deleting their dependencies.
- [x] Run retained Council review/preflight fixtures and regenerate runtime manifests after shared caller changes.
- [x] Add pretest:adoption invoking M2's test:pel-fixture-build before copied-asset runtime acceptance.
