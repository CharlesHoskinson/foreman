# M6 EARS implementation coverage

This matrix links all 23 M6 requirements to executable tests.
The [catalog](../../../openspec/changes/foredi-06-adoption/catalog.json) retains the normative fixtures, actions, and expected observations.
The table records implementation coverage, not final release acceptance.
Final rebuilt-candidate checks and actual package evidence remain pending.

All test paths below are under `packages/orchestration/src/`.
Run `npm run test:adoption` for the collected adoption suite.
Run `npm run verify` for shared runtime and provider regressions.

| EARS requirement / test | Primary test file | Additional observation or remaining work |
| --- | --- | --- |
| R/T-M6-001 | `pel-install-cli.test.ts` | Compiled install, symlink invocation, version, and source check outside checkout. Actual release archive acceptance remains pending. |
| R/T-M6-002 | `pel-adoption-project-cli.test.ts` | Actual configuration services store Git common-directory settings and original registry entries before a bare standard run. |
| R/T-M6-003 | `pel-install.test.ts` | Prerequisite, integrity, umask, symlink, and interruption cases preserve the selected installation. |
| R/T-M6-004 | `pel-adoption-examples.test.ts` | Control, model, research, and delivery CLI fixtures execute the fourteen exact shipped programs. |
| R/T-M6-005 | `pel-model-examples-cli.test.ts` | Six exact profile fixtures retain their native identities and explicit fixture labels. |
| R/T-M6-006 | `pel-provider-readiness-live.test.ts` | Missing, stale, fixture-only, or mismatched evidence fails product admission before effects. |
| R/T-M6-007 | `pel-migration-live.test.ts` | Both compiled import-and-run cases retain original effects, limits, and terminal outcomes. |
| R/T-M6-008 | `pel-legacy-status.test.ts` | Held legacy ownership and original journal bytes survive status, resume, cancel, and migration refusal. |
| R/T-M6-009 | `pel-migration.test.ts` | Twelve deleted paths and all live caller scopes are checked. Retained Council fixtures provide separate parity evidence. |
| R/T-M6-010 | `pel-simplification.test.ts` | Fixed manifest, full-file membership, tokenizer, exclusions, and growth arithmetic. Actual committed-candidate report and operational trace remain pending. |
| R/T-M6-011 | `pel-simplification.test.ts` | Target arithmetic is tested. Actual 40 percent glue and 50 percent instruction reduction are not accepted. |
| R/T-M6-012 | `pel-host-verify.test.ts` | Matching reuse, real verification after changed bindings, and correct reservation reuse after an interrupted refresh. |
| R/T-M6-013 | `pel-research-context.test.ts` | Bounded portable results retain locators, hashes, dates, classes, and explicit unknown coverage. |
| R/T-M6-014 | `pel-research-context.test.ts` | Invalid replacement, changed sources, interruption, and atomic replacement preserve readable state. |
| R/T-M6-015 | `pel-research-context.test.ts` | Optional vault notes remain uncaptured and cannot enter immutable host execution. |
| R/T-M6-016 | `pel-package.test.ts` | Exact clean candidate capture, deterministic archive, closed manifest, and source-bound assets. Actual release production remains pending. |
| R/T-M6-017 | `pel-adoption.test.ts` | Original registry, exact runtime compatibility, active revisions, and unchanged history. Admission tests cover shared-registry concurrency across prefixes and checkout. |
| R/T-M6-018 | `pel-support.test.ts` | Closed diagnostic fields, hostile payload exclusion, and binding-derived evidence kind. Adoption tests cover actual registry export. |
| R/T-M6-019 | `pel-adoption-project-cli.test.ts` | Bare run uses actual configuration. Missing or invalid settings cause no execution reservation or run history. |
| R/T-M6-020 | `pel-package.test.ts` | Nullable version and manifest identity. Compiled install tests check human and JSON output. |
| R/T-M6-021 | `pel-adoption-cli.test.ts` | Shared command outcome mapping with migration, research, installer, support, and metric cases. |
| R/T-M6-022 | `pel-research-host.test.ts` | Immutable read-result preparation, declared ordering, empty writes, and zero action reservations. Compiled examples exercise both research programs. |
| R/T-M6-023 | `pel-package.test.ts` | Canonical payload identity, deterministic archive bytes, and unsafe-path refusal. Actual candidate archive remains pending. |

Supplemental execution tests include `pel-control-examples-cli.test.ts`, `pel-model-examples-cli.test.ts`, and `pel-delivery.test.ts`.
Native qualification fixtures use actual containment and durable permission receipts.
They do not establish live provider capability.
The [live qualification record](m6-live-qualification.md) preserves that separate evidence boundary.
