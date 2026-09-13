# Install, migrate and use Return of the ForeDi

All scenarios are planned tests. This change records no runtime qualification or measured release completion.

## ADDED Requirements

### Requirement: R-M6-001 Clean Node.js installation

When a clean installation completes, the Foreman installer SHALL provide the compiled Node.js 24 CLI and matching Pel examples.

#### Scenario: T-M6-001 Clean Node.js installation

- WHEN the following fixture is prepared: Linux x64 Node24, artifacts/foredi/<buildId>.tar.gz returned by T-M6-016 archive producer, clean /tmp/foredi-unpacked and installation prefix /tmp/foredi-prefix, no checkout/global TS runner/vault.
- AND the test performs: Extract artifacts/foredi/<buildId>.tar.gz to /tmp/foredi-unpacked, run node /tmp/foredi-unpacked/runtime/dist/install.js --prefix /tmp/foredi-prefix, then installed foreman --version --json and foreman check <prefix>/current/examples/pel/implement-verify-review.pel.
- THEN Installed generated Node.js executable works via symlink. Version JSON is {releaseName:"Return of the ForeDi",version:null,buildId:<manifest-build-id>} before version assignment. Snapshot/example hashes match and no provider call occurs. Installation, version display and the successful check each exit 0.

### Requirement: R-M6-002 One-command admitted workflow

When the quickstart starts an admitted workflow, the Foreman CLI SHALL execute the supplied Pel file with one foreman run command.

#### Scenario: T-M6-002 One-command admitted workflow

- WHEN the following fixture is prepared: A verified extracted package supplies the exact snapshot and standard example bytes. A separate temporary asset copy retains its original package manifest and a bounded fixture-assets.json sidecar. Explicit test-fixture authority binds the temporary Git repository and state root.
- AND the test performs: Run project configure with the concrete manifest-bound settings, then run examples/pel/implement-verify-review.pel without binding or context flags and read status. FOREMAN_PEL_ACCEPTANCE_PACKAGE_ROOT selects the extracted release package for final acceptance.
- THEN Configuration is stored at git-common-dir/foreman/project.json and registered in the original projects.json. Missing or invalid settings exit 2 with zero action reservations and no program run. The standard workflow succeeds with exact authority, limits, grants and profiles. Output remains test-fixture; the product CLI rejects fixture manifests and fixture authority. Original package bytes and manifest remain unchanged.

### Requirement: R-M6-003 Installation prerequisite diagnosis

If installation prerequisites are missing, then the Foreman installer SHALL report the missing prerequisite before changing the existing installation.

#### Scenario: T-M6-003 Installation prerequisite diagnosis

- WHEN the following fixture is prepared: Node.js 22 fixture, missing archive file, or invalid archive manifest with an existing working installation.
- AND the test performs: node <archive>/runtime/dist/install.js --prefix /tmp/foredi-existing for Node22, invalid manifest and missing-asset cases.
- THEN InstallPrerequisiteMissing or PackageIntegrityMismatch names the cause. Existing installed bytes and executable entry point remain unchanged. Every Node22, missing-asset and invalid-manifest case exits 2 before changing the installation.

### Requirement: R-M6-004 Useful executable examples

The Foreman example collection SHALL include sequential work, parallel work, bounded rework, review, race cancellation, recovery and research preparation.

#### Scenario: T-M6-004 Useful executable examples

- WHEN the following fixture is prepared: Packaged examples/pel corpus and deterministic fake provider transcripts.
- AND the test performs: Product foreman.js check each example using copied installed assets, then node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> run <assetRoot>/examples/pel/<example>.pel.
- THEN Every file parses and admits under its documented capabilities. Observable outputs demonstrate its named behavior and contain no implicit publication. research-prepare and parallel-read call registered fm/research with read-result preparation and zero provider/action reservations.

### Requirement: R-M6-005 Exact profile examples

When an example selects a model, the Foreman CLI SHALL display the exact profile, transport and readiness evidence before execution.

#### Scenario: T-M6-005 Exact profile examples

- WHEN the following fixture is prepared: Six profile examples selecting grok-4.6, claude-opus-5, claude-fable-5-1, gpt-6-astra, gpt-5.6-sol and gemini-3.8-flash.
- AND the test performs: foreman plan each profile example and foreman providers list --json.
- THEN All six exact IDs and concrete canonical transport IDs remain visible. Product evidence stays unqualified without live observations. Fixture-backed cells are labeled test-fixture, never live-qualified.

### Requirement: R-M6-006 Unavailable provider failure

If an example's required provider is unavailable, then the Foreman CLI SHALL explain the missing capability without starting the workflow.

#### Scenario: T-M6-006 Unavailable provider failure

- WHEN the following fixture is prepared: Product binding with documented-only, fixture-only, expired or absent exact model/native permission evidence.
- AND the test performs: foreman run the example using its documented command.
- THEN Exit 2 reports ModelUnavailable or CapabilityUnverified with configuration details. No provider call, reservation or worktree is created. Product rejects a test-fixture binding.

### Requirement: R-M6-007 Legacy import and parity

When a registered RoundPlanV1 and ExecutionContractV1 pair is imported, the Foreman migration tool SHALL emit Pel source and a parity report.

#### Scenario: T-M6-007 Legacy import and parity

- WHEN the following fixture is prepared: packages/orchestration/src/fixtures/pel-migration/{implement-verify-review,bounded-rework}/ each contains round-v1.json, contract-v1.json, registered-command-bindings.json and expected-trace.json. Inputs use RoundPlanV1 and ExecutionContractV1 schemaVersion1.
- AND the test performs: foreman migrate <case>/round-v1.json --contract <case>/contract-v1.json --out <file.pel>, then node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> run <file.pel>.
- THEN Both known templates preserve required effects, identities, bounds and terminal decisions. Unsupported schema/argv or Council input returns UnsupportedLegacyConstruct. No arbitrary command executes. Supported import exits 0. Unsupported schema/command/template exits 2.

### Requirement: R-M6-008 Active legacy ownership

While a legacy run remains active, the Foreman migration tool SHALL preserve its current execution owner and durable history.

#### Scenario: T-M6-008 Active legacy ownership

- WHEN the following fixture is prepared: An active legacy run with a lease, reservations and completed tool receipts.
- AND the test performs: Attempt migration and resume through the new CLI.
- THEN Migration returns ActiveLegacyRun. The existing owner continues. Journal hashes and budgets remain unchanged. No second controller starts. ActiveLegacyRun exits 3 without transferring ownership.

### Requirement: R-M6-009 Historical decoding and thin adapters

When legacy scripts are retired, the Foreman CLI SHALL preserve historical record decoding after their callers migrate to the unified runtime.

#### Scenario: T-M6-009 Historical decoding and thin adapters

- WHEN the following fixture is prepared: Historical terminal records and the twelve exact legacy shell cohort paths, with caller migration completed.
- AND the test performs: Assert all twelve files are absent; rg full paths and basenames in packages, components/council, skills/foreman, scripts, env and .github; run migrated CLI workflows and retained Council review/preflight fixtures.
- THEN No legacy shell cohort entry or active caller remains. Historical identities still decode. No compatibility argv parser or second scheduler is introduced. Every live caller scope has zero deleted-entry references, including retained Council callers. Historical records remain separate and runtime manifests are regenerated.

### Requirement: R-M6-010 Reproducible baseline comparison

When simplification is measured, the Foreman measurement tool SHALL use the specification-fixed cohort, instruction corpus, tokenizer and counting rules.

#### Scenario: T-M6-010 Reproducible baseline comparison

- WHEN the following fixture is prepared: Spec-fixed 15-file production cohort and five instruction files at baseline 441c3fb9f6acb2656760d03cc79e7c706fb8b7dd, js-tiktoken1.0.21/cl100k_base and candidate revision. Candidate includes a newly added pel-research-host.ts and surviving full baseline instruction files.
- AND the test performs: Collect a candidate-bound standard-start trace, then run node skills/foreman/runtime/dist/pel-simplification.js --baseline <manifest> --candidate <revision> --startup-trace <trace>.
- THEN Report includes old and replacement production lines, generated/test/archive exclusions, command count, instruction tokens, owners and total production growth with file hashes. Changed cohort membership or tokenizer identity fails comparison. Build manifest contains the named metric bundle. Valid passing comparison exits 0. Changed membership/tokenizer exits 2. A valid report with missed acceptance targets exits 1 and remains available. Research/install/metrics source is included under the exact path-and-change union. Residual instruction files count in full, not selected paragraphs.

### Requirement: R-M6-011 Measured net simplification

The Foreman migrated workflow cohort SHALL reduce orchestration glue lines by at least 40 percent and required instruction tokens by at least 50 percent.

#### Scenario: T-M6-011 Measured net simplification

- WHEN the following fixture is prepared: The frozen implementation cohort, all new replacement glue, and the complete mandatory quickstart instruction corpus.
- AND the test performs: Run the simplification measurement against the candidate and compare its acceptance fields.
- THEN Net glue reduction is at least 0.40 and instruction reduction at least 0.50. Moving code or instructions outside old paths does not remove them from counts.

### Requirement: R-M6-012 Verification receipt reuse

When an unchanged candidate repeats verification, the Foreman execution owner SHALL reuse the matching host receipt and report one full verification execution.

#### Scenario: T-M6-012 Verification receipt reuse

- WHEN the following fixture is prepared: One admitted Pel owner executes three verification calls against retained candidate artifacts, a real registered Node.js gate, and the existing journal and ledger.
- AND the test performs: Execute two identical calls, then change candidate, gate, environment, policy, or freshness. Recover an interrupted freshness recheck from its durable report.
- THEN Identical calls execute the full gate once and reserve one verify action. Each changed binding executes it again with a distinct reservation. Recovery preserves the refresh reservation and does not execute a third gate. Each run has one event history and at most one active owner.

### Requirement: R-M6-013 Source-linked research query

When a user requests research context, the Foreman research reader SHALL return bounded source-linked results with claim status and freshness.

#### Scenario: T-M6-013 Source-linked research query

- WHEN the following fixture is prepared: Repository research bundle containing paper claims, adopted decisions, hypotheses, coverage warnings and provider source captures.
- AND the test performs: foreman research query "Fable forced tools" --json --limit 5 without a vault path.
- THEN Results include source locator, source hash, capture time, claim class and freshness. Unsupported extraction remains visible. Hidden reasoning and secrets are absent. Successful query, including no-match or stale results, exits 0. Invalid arguments or required schema exit 2.

### Requirement: R-M6-014 Atomic research freshness

When research inputs change, the Foreman research reader SHALL mark derived notes and graphs stale until a matching refresh completes.

#### Scenario: T-M6-014 Atomic research freshness

- WHEN the following fixture is prepared: A copied bundle with one changed source hash, one missing source and interrupted refresh metadata.
- AND the test performs: foreman research status --json, then foreman research refresh --bundle <path> against a complete captured bundle.
- THEN Stale and missing inputs appear explicitly. Refresh atomically publishes matching derived hashes and provenance. Interrupted refresh preserves the previous readable snapshot. Successful status and refresh exit 0. Invalid source provenance exits 2. Explicit interruption exits 4 after preserving the previous snapshot.

### Requirement: R-M6-015 Optional Obsidian context

Where an external Obsidian vault is configured, the Foreman research reader SHALL expose its linked context without granting it execution authority.

#### Scenario: T-M6-015 Optional Obsidian context

- WHEN the following fixture is prepared: Optional temporary Obsidian vault with wikilinks, advisory graph nodes and a note containing an execution instruction.
- AND the test performs: foreman research query with --vault <path>, then remove the vault and run the standard Pel example.
- THEN Query preserves note links and provenance. Note instructions cannot grant capabilities. Core workflow still works without the vault and reports optional context absence.

### Requirement: R-M6-016 Matching release package

When a release package is assembled, the Foreman packaging tool SHALL include matching runtime, examples, profile evidence and migration documentation.

#### Scenario: T-M6-016 Matching release package

- WHEN the following fixture is prepared: Candidate build with generated runtime, source manifest, support matrix and unresolved v0.5 obligation references.
- AND the test performs: npm run build, then npm run package:pel -- --candidate <git-commit> --out artifacts/foredi, inspect emitted archivePath/buildId/archiveSha256 and manifest; run candidate static checks.
- THEN Archive hashes match candidate, metric bundle and assets/pel/default-authoring-snapshot.json. Canonical example paths exist. Support is exact per capability. Unassigned version is null. Unresolved v0.5 obligations retain their original status. ManifestPayloadV1 canonical hash yields buildId without self-reference. Archive path is artifacts/foredi/<buildId>.tar.gz and contains the exact installable layout.

### Requirement: R-M6-017 Compatible runtime rollback

When an installed release rolls back, the Foreman rollback tool SHALL check every registered state root before restoring a compatible runtime without rewriting history.

#### Scenario: T-M6-017 Compatible runtime rollback

- WHEN the following fixture is prepared: prefix/versions/<old-build-id> and current manifests plus the existing foremanHome/projects.json registry with two canonical registered state roots, one compatible and one incompatible or unreadable active checkpoint. Include a root created through registered --state-root override and a separate unregistered override.
- AND the test performs: foreman install rollback --to <old-build-id> for compatible and incompatible registered-state fixtures.
- THEN Compatible rollback atomically switches prefix/current and preserves both histories. Any incompatible or unreadable registered root returns RollbackIncompatible before switch. No second scheduler starts. Compatible rollback exits 0. Incompatible or unreadable registered active state exits 3. Unknown build identity exits 2. Installed run/resume reject the unregistered override with exit 2. Rollback checks the registered override root. Checkout/fixture runs need no installation prefix projection.

### Requirement: R-M6-018 Safe support diagnostics

When support diagnostics are exported, the Foreman CLI SHALL report reproducible feature context with secret and reasoning redaction.

#### Scenario: T-M6-018 Safe support diagnostics

- WHEN the following fixture is prepared: Failed packaged quickstart with a model mismatch, run IDs, provider evidence, source version, secret fixture and opaque reasoning blob.
- AND the test performs: foreman support export --run <id> --out <bundle>.
- THEN Bundle includes version, platform, exact profile/transport, safe failure, relevant event IDs and reproduction command. Secrets, tokens and hidden reasoning are absent. Successful export exits 0. Unknown run exits 2 and write failure exits 1.

### Requirement: R-M6-019 pel-adoption contract

When a configured project starts a Pel workflow, the Foreman CLI SHALL derive its execution binding from the checked program and stored project configuration.

#### Scenario: T-M6-019 pel-adoption contract

- WHEN the following fixture is prepared: Real canonical Git project settings and the original project registry are created by makeLivePelProjectServices under the explicit bounded fixture authority. Missing and malformed stored settings are tested before dispatch.
- AND the test performs: Invoke the compiled fixture project configure command, then a bare standard run without --binding, --context, or --state-root. Repeat admission with missing and malformed settings.
- THEN A valid configured project binds the exact authority, state root, original limits, role mappings and workspace grants. Missing or invalid configuration exits 2 with zero reservations and no provider dispatch. The installed product rejects the fixture authority.

### Requirement: R-M6-020 pel-package contract

When version information is requested, the Foreman CLI SHALL report the release name, build identity and nullable numerical version from its installed manifest.

#### Scenario: T-M6-020 pel-package contract

- WHEN the following fixture is prepared: Installed manifest with releaseName Return of the ForeDi, version null and known buildId, followed by an explicitly assigned SemVer variant.
- AND the test performs: foreman --version --json and foreman --version.
- THEN JSON has exactly releaseName, version and buildId matching the manifest. Human output says unversioned before assignment and never invents a numerical release. Valid nullable version output exits 0.

### Requirement: R-M6-021 Exact subcommand exit codes

When a adoption subcommand terminates, the Foreman CLI SHALL return the exit code assigned to its command outcome in the shared command table.

#### Scenario: T-M6-021 Exact subcommand exit codes

- WHEN the following fixture is prepared: Table-driven installed-asset/filesystem cases for migrate, research query/status/refresh, install, rollback, support, version and metric commands from design.md Command outcomes.
- AND the test performs: Invoke product install/version/metric entries or node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> <adoption-subcommand> for injected filesystem cases, inspecting exact exits and mutations.
- THEN All command outcomes match the table: success 0, failure 1, invalid input 2, active-legacy/incompatible-state needs-action 3 and confirmed local cancellation 4. Prior data remains intact on failed or interrupted mutations. No final pending 5 appears.

### Requirement: R-M6-022 pel-research-host contract

When a Pel research effect executes, the Foreman host SHALL return bounded source-linked context through the registered read-only research descriptor.

#### Scenario: T-M6-022 pel-research-host contract

- WHEN the following fixture is prepared: M2 fm/research descriptor with id/query/bundle/limit, admitted bundle:release-sources and two distinct parallel read bundles.
- AND the test performs: Check research-prepare.pel and parallel-read.pel, then node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> run <assetRoot>/examples/pel/<example>.pel.
- THEN M6 handler returns schema:research-result-v1 in declared order. Read resources match admitted bundles, writes are empty and fresh read-result preparation needs no prior receipt or external reservation.

### Requirement: R-M6-023 pel-package contract

When an archive build is requested, the Foreman packaging tool SHALL emit the manifest-bound installable archive at its declared build-identity path.

#### Scenario: T-M6-023 pel-package contract

- WHEN the following fixture is prepared: Compiled Node24 producer, exact candidate revision and runtime/assets/examples/docs payload with invalid-path counterfixtures.
- AND the test performs: npm run package:pel -- --candidate <git-commit> --out artifacts/foredi.
- THEN Successful build emits artifacts/foredi/<buildId>.tar.gz and matching archive hash with exit 0. Invalid paths/options exit 2 and archive I/O fails with exit 1. Payload digest excludes manifest self-reference.

