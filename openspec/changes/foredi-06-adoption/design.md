# Adoption design

## Scope and source baseline

This milestone delivers working user features for **Return of the ForeDi**.
A numerical version requires reconciliation with the active release program.
Do not interpret the v0.5 bootstrap merge as completion of v0.5.

Use these planning sources:

- [Release design](../../../docs/releases/return-of-the-foredi/research-design.md)
- [Release plan](../../../docs/releases/return-of-the-foredi/research-plan.md)
- [Architecture and deletion map](../../../docs/research/pel-release/ARCHITECTURE-AND-DELETION-MAP.md)
- [Graph coverage](../../../docs/research/pel-release/GRAPH-COVERAGE.md)
- [Provider evidence](../../../docs/research/pel-release/ADAPTER-EVIDENCE.md)

Use the [official EARS patterns](https://alistairmavin.com/ears/) for the linked requirements.
All target paths, commands and assertions below are planned work.
No command result or reduction percentage is reported as measured.

## Implementation boundaries

All new executable source and tests use strict TypeScript.
Run compiled product entry points on Node.js 24.
Use Effect for filesystem transactions, process resources, timeouts and concurrent work.
Keep counting, decoding and report projection as pure TypeScript functions.

| Planned path | Responsibility |
| --- | --- |
| `packages/orchestration/src/pel-adoption.ts` | Installed workflow checks and public example metadata |
| `packages/orchestration/src/pel-install.ts` | Install prerequisites, archive validation and compatible rollback |
| `packages/orchestration/src/pel-migration.ts` | Pure legacy decoding and Pel emission, with parity report construction |
| `packages/orchestration/src/pel-simplification.ts` | Deterministic cohort, line and instruction measurements |
| `packages/orchestration/src/pel-research-context.ts` | Bounded reads, provenance checks and optional vault links |
| `packages/orchestration/src/pel-research-refresh.ts` | Atomic publication of derived research projections |
| `packages/orchestration/src/pel-package.ts` | Runtime/example/profile manifest verification |
| `packages/orchestration/src/pel-support.ts` | Safe diagnostic bundle projection from existing records |
| `scripts/build-runtime.ts` | Compile and package the same runtime entry points |
| `examples/pel/` | Shipped Pel workflows and model-specific variants |
| `docs/guides/pel/{install,quickstart,examples,migration,research,support}.md` | User instructions verified against installed product |

Extend M2's pel-authoring-cli.ts and pel-authoring-main.ts, bundled once as runtime/dist/foreman.js.
Reuse the M4 execution owner for all examples and imported workflows.
Use existing graph-context, session-store and graph-store services for bounded context.
Do not introduce a new authoritative graph or execution database.

## Installation and first successful task

The archive contains compiled runtime, command launcher, manifests, profile evidence, examples and matching documentation.
The launcher only locates Node.js and forwards exact arguments and byte streams.
It owns no business rules or durable state.
A clean-install test starts outside the checkout with no global tsx, Bun, Deno or Python dependency.

Implement `InstallManifestV1` with candidate hash, archive file hashes, required Node range, runtime schema range and example paths.
`installPackage(input)` returns `Effect<InstalledPackageV1, InstallFailure>`.
Resolve and validate the complete manifest before replacing an existing installation.
Use temporary staging and an atomic installed-version switch.
Tagged failures include `InstallPrerequisiteMissing`, `PackageIntegrityMismatch` and `InstallIoFailure`.

Install with `node <archive>/runtime/dist/install.js --prefix <prefix>` on Linux x64 with Node.js 24.
Acceptance tests invoke that same documented command rather than an internal-only setup path.
The product must work from copied installation files.

The quickstart covers these concrete steps:

1. Install the archive on Node.js 24.
2. Configure explicit credential references for the selected provider transports.
3. Run `foreman providers list --json` and inspect readiness.
4. Check and preview `examples/pel/implement-verify-review.pel`.
5. Run `foreman project configure --settings examples/pel/project-settings.json` once for the existing authority and bounded workspace.
6. Start the workflow with one `foreman run <file>` command.
7. Inspect `foreman status <run-id>`, then demonstrate cancel or resume.

“One command” measures starting a standard workflow after installation, credentials and admission exist.
The run command resolves configured project state and authority through the existing host.
Explicit `--binding` and `--state-root` overrides remain available when needed.
The standard workflow does not require manually assembling a new JSON authority file for each task.
It does not conceal these prerequisites or count their prior completion as free installation.
The standard example performs implementation, host verification and independent review.
It uses Grok implementation and Sol review when those exact cells are qualified.
The same control flow has a second provider assignment fixture.
Do not force account access or fabricate qualification to make the quickstart look successful.

## Examples and profile selection

Ship these files under `examples/pel/`:

- `implement-verify-review.pel` for sequential implementation, verification and independent review.
- `parallel-read.pel` for independent bounded read tasks.
- `repair-and-publish.pel` for typed failures and a fixed retry bound.
- `race-cancel.pel` for isolated candidates, a host-valid winner and loser cleanup.
- `resume-checkpoint.pel` for interrupted work and recorded-effect reuse.
- `research-prepare.pel` for source-linked advisory context.
- `conditional.pel` and `repair.pel` for M2-owned checked authoring examples.
- `profiles/<exact-id>.pel` for each of the six requested model identities.

Each example carries purpose, expected artifacts, capability envelope and observed status instructions.
Use ordinary Pel and the frozen Foreman library.
Profile examples make separate API/native transport choices explicit through the supported admission configuration.
Do not create a second editable workflow JSON format.
Generated previews and provider registry records remain derived outputs.

Readiness is an account-and-transport fact from M3.
Show unavailable, unsupported and unknown cases with safe remedies.
A model-profile example is not evidence that the model has run.
The core examples must execute through deterministic fake transports in normal tests.
Live example runs require matching qualification evidence and explicit limits.

## Legacy migration without dual ownership

`importLegacyWorkflow(input): Either<MigrationDiagnostic, MigratedPelV1>` is a pure decoder and emitter.
`MigratedPelV1` contains Pel text, source hash, originating format/version and a derived parity report.
It does not contain another editable workflow representation.
`foreman migrate <round-plan-v1.json> --contract <execution-contract-v1.json> --out <file.pel>` reads the closed import corpus below.
Unknown fields and unsupported semantics produce `UnsupportedLegacyConstruct` with a source locator.
The importer never guesses a weaker interpretation.

The import parity corpus contains the two exact RoundPlanV1 templates defined below.
Parallel work, race and recovery remain authored examples tested through M4, not undocumented import formats.
Council-specific blinding and quorum migration is deferred. Preserve its existing policy and execution path.
Trace comparison ignores documented transport timing and compares required host effects, identities, limits and terminal outcomes.
Use historical fixtures for existing formats and fake providers for candidate execution.
Reuse original event records rather than rewriting history into a new schema.

An active legacy run keeps its current controller. The new supervisor does not restart RoundPlanV1 work: it returns ActiveLegacyRun before reservation, worktree restoration, or queue submission. It retains historical status and the Pel held-owner recovery branch. Existing legacy ownership records contain no verified original controller executable or build, so the diagnostic reports that controller location as unavailable rather than supplying a new-runtime restart command. Automatic legacy restart parity is not claimed. Earlier v0.5.0 historical decoding, owner exclusion, checkpoint identity, and budget-history obligations remain; unsupported legacy workflow recovery stays open.
Migration returns `ActiveLegacyRun` with the current owner and a supported completion or recovery route.
The migration tool cannot transfer an active lease to the Pel runtime.
Historical status remains readable after old execution code is removed.

Implement replacement in complete caller-to-controller slices:

| Legacy path | Candidate disposition |
| --- | --- |
| `skills/foreman/scripts/vendor-multiround.sh` | Move bounded attempts into Pel and delete the old loop |
| `skills/foreman/scripts/lib/worker-cmd.sh` | Move exact command construction into M3 transports |
| `skills/foreman/scripts/adapters/{grok,codex,claude,agy}.sh` | Delete after callers use M3 through the unified CLI |
| `skills/foreman/scripts/{lane-run,worker-run,audit-run,resume,watch,lane-supervise}.sh` | Migrate callers to the compiled CLI and delete dispatch/recovery behavior |
| `packages/orchestration/src/{round-reducer,resume-queue-execution,supervisor}.ts` | Consolidate workflow branches under M4 while retaining required discovery and leases |
| `components/council/packages/adapter-{grok,claude,codex}/src/preflight.ts` | Retain unchanged outside this migration cohort |
| `packages/orchestration/src/round-contract.ts` | Retain historical decoder after authored round plans retire |

Retain execution ledger, terminal policy, credentials, launcher containment, publication transactions and historical decoders.
Do not delete a safety property to reduce a line count.
The twelve shell cohort files retire after all active callers migrate. No legacy argv compatibility subcommands are added.
Prove each complete replacement with caller searches and execution tests.
Advisory graph traversal cannot establish the absence of callers by itself.

## Measurement contract

Freeze `docs/release-metrics/foredi-baseline.json` before implementation changes enter the cohort.
This is a measurement input, not a workflow plan.
Pin baseline `441c3fb9f6acb2656760d03cc79e7c706fb8b7dd`, source hashes, selected paths, behavior classifications and counting-tool version.
Classify active v0.5, lane-runtime-typescript and workflow-weight-reduction obligations by retained, replaced or deferred status.
Preserve the original authority and evidence references.
No classification silently marks an obligation complete.

`SimplificationBaselineV1` records old glue files/ranges and required instruction sources.
`SimplificationResultV1` records candidate files/ranges, replacement mapping, exclusions, raw counts and ratios.
Count nonblank production source lines with one pinned deterministic rule.
Apply the exact inclusive path-and-change candidate membership rule in Fixed measurement membership.
Count each fixed cohort file in full. No implementation-time range exclusions are allowed.
Report full package and repository production growth alongside the scoped cohort count.

Compute:

- `glueReduction = 1 - candidateReplacementGlueLines / baselineGlueLines`
- `instructionReduction = 1 - candidateRequiredTokens / baselineRequiredTokens`

Acceptance requires at least 0.40 glue reduction and 0.50 instruction reduction.
Keep generated files, tests and immutable archives outside production counts, with separate totals.
Count all new or modified production paths under the fixed candidate rule.
Do not omit mandatory instruction text because it moved into help, profiles or generated prompts.
Use js-tiktoken 1.0.21 with cl100k_base encoding and no special-token injection.
Count the complete required cold-start orchestration instructions through first standard-workflow start.
Keep optional tutorials separate and report their counts.

Also report commands after prerequisites, workflow loops, entry points, provider conditionals and durable state owners.
Assert one active control-flow owner per run and one authoritative event history.
Assert exactly one reusable full verification for unchanged candidate/base/check/tool/dependency/environment bindings.
A changed binding must invalidate reuse.
Measure deterministic fixtures and actual candidate data separately.
No baseline or candidate number is invented by this specification.

## Research and optional Obsidian context

The runtime uses a portable repository research bundle by default.
The local authoring vault `/home/charl/vaults/Foreman` is optional and never hardcoded as an installation dependency.
No Obsidian plugin controls Foreman's execution authority.
The captured plugin does not establish Grok support or control of all six models.

Implement these CLI views:

- `foreman research query <text> --json --limit <n>`
- `foreman research status --json`
- `foreman research refresh --bundle <captured-bundle>`
- Optional `--vault <path>` for linked external context.

`ResearchContextV1` contains bounded excerpts, source locators, raw/clean hashes, capturedAt, claim class, freshness and extraction coverage.
Claim classes distinguish hypothesis, adopted decision, verified observation and open question.
Return explicit missing or stale markers.
A missing optional vault does not block check, plan, run, status or resume.
Research text remains untrusted evidence and cannot change capabilities or host results.

Refresh reads an explicitly selected captured source bundle.
It validates manifests and atomically publishes derived notes/index/graph references.
It does not silently fetch new websites or rewrite immutable raw captures.
Changed source hashes invalidate dependent claims and graph freshness.
An interrupted refresh preserves the old readable snapshot with stale status.

Provide linked Markdown instructions that open notes and source locators in Obsidian.
Expose provenance and graph coverage warnings in CLI output and exported research views.
Keep the advisory Graphify 0.9.61 graph separate from the existing 0.9.48-qualified graph.
This release does not upgrade that qualification by renaming an artifact.
Unknown syntax, dangling edges and unsupported extraction remain visible.
Store no hidden reasoning in the research bundle or vault export.

## Packaging, support and rollback

`PackageSupportV1` records the selected release name/version, candidate, runtime schemas and exact model/transport evidence.
Do not claim a transport works because its fixture suite passes.
Include documentation, examples and support matrix from the same candidate.
Read research and migration bytes from tracked candidate sources, not ignored generated caches.
Bind their original source identity in the archive manifest.
Retain unresolved v0.5 obligations and their source references in release notes.
Assign the numerical version only after the existing release program reconciles it.

`foreman support export --run <id> --out <bundle>` produces reproducible, redacted context.
Include installed version, platform, exact provider identities, safe error codes and relevant event IDs.
Include evidenceKind from the validated immutable execution binding: product or test-fixture.
Use unknown when that binding is unavailable or belongs to a legacy run.
Package identity must not change the evidence kind.
Exclude credentials, bearer tokens, environment secret values, hidden reasoning and sensitive prompt payloads.
Use existing redaction policy and test malicious field names and nested provider errors.

`foreman install rollback --to <buildId>` checks journal and checkpoint schema compatibility before switching packages.
Restore a known compatible package atomically.
Leave execution history and profile evidence intact.
An incompatible active checkpoint returns `RollbackIncompatible`.
Offer the compatible current runtime's resume/export route rather than rewriting history.
Rollback must not resurrect a retired second scheduler.

## Planned validation

Use `npm run typecheck`, `npm run test`, `npm run build`, `npm run verify-runtime` and `npm run verify`.
Run the existing architecture policy and install checks where applicable.
The catalog's TypeScript tests are the targeted adoption suite.
Add `test:adoption` to invoke `scripts/run-tests.ts` with the exact `pel-*.test.ts` adoption targets.
Run clean-install tests against copied candidate archives and compiled Node.js product code.
They cannot depend on checkout-only modules or the external vault.

Assert all shipped examples execute through explicit test-fixture profiles.
Assert unsupported examples fail before effects.
Assert one migration removes a complete legacy control path and all corpus outcomes remain equivalent.
Run measurement against the frozen baseline and report both raw counts and ratios.
Verify support export redaction and compatible/incompatible rollback.
Publication remains the existing separately authorized transaction after the working candidate satisfies its current release policy.

## Concrete install, state and package layout

Initial installation support is Linux x64 with Node.js >=24 <25.
Unsupported platforms return InstallPrerequisiteMissing without changing an existing installation.
The archive contains runtime/dist/install.js, runtime/dist/foreman.js, runtime/dist/pel-simplification.js,
runtime/assets/pel/default-authoring-snapshot.json, examples/pel and the content manifest.
The install entry comes from packages/orchestration/src/pel-install-main.ts.
The metric entry comes from packages/orchestration/src/pel-simplification-main.ts.
Add both entries to scripts/build-runtime.ts alongside M2's single foreman entry.
Build output contains generated JavaScript only. All executable source stays TypeScript.

The bootstrap command is `node <archive>/runtime/dist/install.js --prefix <prefix>`.
Default prefix is `$HOME/.local/share/foreman`.
Retain each installation under `<prefix>/versions/<buildId>/` with runtime, examples and manifest.
`<prefix>/current` points to the selected retained version.
`<prefix>/bin/foreman` is a symlink to current/runtime/dist/foreman.js.
The TypeScript main declares a Node shebang preserved in generated output.
Set executable mode in the TypeScript installer.
The user adds `<prefix>/bin` to PATH through their existing shell configuration.
The installer neither edits shell startup files nor creates a shell implementation.
Clean-install tests set PATH in the test process environment explicitly.

BuildId is the full candidate SHA-256 manifest identity.
M6 implements `foreman --version --json` returning exactly releaseName, version and buildId.
Before version assignment, releaseName is Return of the ForeDi and version is null.
After assignment, version is the selected release SemVer.
Human `--version` prints `Return of the ForeDi (unversioned, build <buildId>)` before assignment.
The package manifest includes the same fields, default authoring snapshot path/hash and metric entry hash.

M4's one-time configuration command stores ForemanProjectV1 under `<git-common-dir>/foreman/project.json`.
`foreman project configure --settings examples/pel/project-settings.json` references existing authority without granting new authority.
The packaged settings example uses explicit project-local paths and credential references that the user fills during setup.
The deterministic acceptance fixture is packages/orchestration/src/fixtures/pel-adoption/project-settings.json.
Its repository binding, state root, authority reference, limits, concurrency, correction/progress bounds,
required milestones, gate argv registry, destination descriptors, workspace grants and profile mappings match M4's schema.
Bare `foreman run` uses M4's pure configuration-plus-CheckedProgramV1 derivation.
Missing or invalid configuration exits 2 before reservation or dispatch.

Use the existing `<foremanHome>/projects.json` registry and its canonical project/store associations.
Project configure uses the existing registration service. Installation adds no second state-root registry.
Rollback checks every registered state root and refuses unreadable or incompatible active state.
`foreman install rollback --to <buildId>` validates hashes and schema ranges before changing current.
A compatible switch preserves journals, checkpoints and source artifacts byte-for-byte.
An unregistered explicit state-root override must be registered before a run starts through that installation.
This avoids rollback checking only the caller's current repository.

## Fixed migration corpus

Only RoundPlanV1 schemaVersion 1 paired with ExecutionContractV1 schemaVersion 1 is imported.
Decode both through existing strict decoders.
ExecutionContractV2, queue layouts, arbitrary shell commands and Council workflows return UnsupportedLegacyConstruct.
The corpus lives in packages/orchestration/src/fixtures/pel-migration/:

| Case | Exact inputs | Target |
| --- | --- | --- |
| implement-verify-review | implement-verify-review/round-v1.json and implement-verify-review/contract-v1.json | implement-verify-review.pel |
| bounded-rework | bounded-rework/round-v1.json and bounded-rework/contract-v1.json | repair-and-publish.pel with publication disabled by its existing authority |

Each directory also contains expected-trace.json, registered-command-bindings.json and source-manifest.json.
Recognize commandArgv only through exact registered argv templates with typed placeholders.
Bind gateCommand to an existing registered argv digest. Never evaluate or infer shell syntax.
Require fixture-bound profile, transport, workspace and gate identities for every imported field.
An unknown command, schema version or unmapped field fails with a source locator before output publication.
Both targets use M1-M5 registered descriptors only.
Historical status retains existing RoundPlanV1 and event decoders independently of import support.
No Council loop or policy is deleted by this milestone.

## Fixed measurement membership

Freeze hashes for this exact baseline production cohort at commit 441c3fb9f6acb2656760d03cc79e7c706fb8b7dd:

- skills/foreman/scripts/vendor-multiround.sh: delete its workflow loop.
- skills/foreman/scripts/lib/worker-cmd.sh: delete its command-construction implementation.
- skills/foreman/scripts/adapters/grok.sh: delete after caller migration.
- skills/foreman/scripts/adapters/codex.sh: delete after caller migration.
- skills/foreman/scripts/adapters/claude.sh: delete after caller migration.
- skills/foreman/scripts/adapters/agy.sh: delete after caller migration.
- skills/foreman/scripts/lane-run.sh: delete after caller migration.
- skills/foreman/scripts/worker-run.sh: delete after caller migration.
- skills/foreman/scripts/audit-run.sh: delete after caller migration.
- skills/foreman/scripts/resume.sh: delete after caller migration.
- skills/foreman/scripts/watch.sh: delete after caller migration.
- skills/foreman/scripts/lane-supervise.sh: delete after caller migration.
- packages/orchestration/src/round-reducer.ts: consolidate workflow logic and retain historical decoding.
- packages/orchestration/src/resume-queue-execution.ts: route recovery to M4 and retain historical diagnostics.
- packages/orchestration/src/supervisor.ts: retain discovery/leases and remove duplicate workflow branches.

Count full nonblank production files, including comments. No mixed-module range exclusion is allowed.
Candidate totals count every residual cohort file in full, all production source in packages/pel and packages/providers,
and every new packages/orchestration/src/pel-*.ts production file, including research, install and metrics.
Also count every added or modified production source file outside those sets in full, once.
This is a path-and-change rule, not a judgment about whether a file implements replacement behavior.
Tests, generated bundles and immutable archives have separate totals.
The baseline membership cannot change when candidate measurements miss the thresholds.

The mandatory baseline instruction corpus contains these complete files, concatenated in this order with LF separators:
skills/foreman/SKILL.md, skills/foreman/references/roles.md, skills/foreman/references/durable-lanes.md,
skills/foreman/references/lanes.md and skills/foreman/references/parallel-worktrees.md.
Candidate instructions count each surviving baseline file in full, docs/guides/pel/quickstart.md,
and all mandatory help/profile/generated-prompt instructions reached through the first standard run.
Use js-tiktoken 1.0.21, cl100k_base, no special-token injection and UTF-8 inputs without newline normalization.
Pin its npm integrity in the baseline and lockfile.
The selected package version is published in the [npm registry metadata](https://registry.npmjs.org/js-tiktoken/1.0.21).
Its integrity is sha512-biOj/6M5qdgx5TKjDnFT1ymSpM5tbd3ylwDtrQvFQSu0Z7bBYko2dF+W/aUkXUPuk6IVpRxk/3Q2sHOzGlS36g==.
T-M6-010 rejects changed membership, counting rules or tokenizer identity.

Collect the complete standard-start instruction trace from the clean release checkout:

```text
node --import tsx scripts/collect-pel-startup-trace.ts --candidate FULL_COMMIT --repo REPOSITORY --out NEW_TRACE
node skills/foreman/runtime/dist/pel-simplification.js --baseline docs/release-metrics/foredi-baseline.json --candidate FULL_COMMIT --repo REPOSITORY --startup-trace NEW_TRACE
```

The collector uses the actual adapter serializer with a finite process fixture through the first standard-task prompt.
The trace records its fixture identity and binds every source input.
It does not establish live-account qualification.
Without that trace, required instruction totals remain unknown and acceptance fails.
The release-checkout collector does not add a TypeScript dependency to the installed product.
These choices fix the measurement method. They do not report measured reductions.

## Fixture launcher and canonical package examples

Product foreman.js rejects test-fixture bindings and has no fake-provider flag or environment selector.
M2's separate test launcher, extended by M4, injects TestFixtureProviderLayer with fixture manifest hashes bound to the temporary state root.
It imports the same CLI router and production services, replacing transport and external-effect ports only.
Tests label outputs test-fixture and cannot produce live-qualified evidence or real publication authority.
Copied-install tests use product foreman.js for install/check/plan/version.
Runtime example acceptance uses the separately built test launcher against copied installed assets.
No test launcher or fixture manifest is shipped in the product archive.

Canonical packaged workflow files are implement-verify-review.pel, parallel-read.pel, repair-and-publish.pel,
race-cancel.pel, resume-checkpoint.pel, research-prepare.pel, conditional.pel and repair.pel.
The shipped repair.pel is corrected source. Its invalid counterpart remains an unshipped test fixture.
The repair example follows M5's bounded recursion and publication needs-action behavior.
Ship six profiles/<exact-id>.pel files, plus project-settings.json.
Reject package manifests with missing or differently named required examples.
All task coding examples select admitted native transports. API profile examples demonstrate bounded review or generation.

M2 owns the pure exported main in packages/orchestration/src/pel-cli-fixture-main.ts.
The sole invocation entry is packages/orchestration/test/pel-cli-fixture-entry.ts.
Actual tests live in packages/orchestration/src/pel-cli-fixture.test.ts and cannot invoke a CLI on import.
Build it with `npx esbuild packages/orchestration/test/pel-cli-fixture-entry.ts --bundle --platform=node --format=esm --target=node24 --outfile=packages/orchestration/dist-test/pel-cli-fixture.js`.
Run typechecking before this build.
The entry calls the shared makeForemanCli(services) router with recorded test services.
Production calls that router with live services only.
Runtime fixture commands invoke `node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> <subcommand>`.
The manifest requires assetRoot and assetManifestSha256, bound to the copied installation prefix/current.
Resolve snapshots from assetRoot/runtime/assets/pel and examples from assetRoot/examples/pel.
Reject missing manifest, mismatched asset hashes or an absent copied asset root with exit 2.
The existing project registry supplies rollback's complete registered-state inventory. An unreadable association is a needs-action result, not an empty inventory.

## Command outcomes

Use the shared CLI classes: 0 success, 1 failed, 2 invalid input/admission, 3 needs-action, 4 cancelled and 5 pending.
The table maps typed outcomes at the single M2 router boundary. Transports do not select process exit codes.
These commands remain bounded and attached. None returns final exit 5 for an unresolved outcome.
M4 status/cancel observations retain their existing pending code.

| Command | 0 success | 1 failed | 2 invalid input/admission | 3 needs-action | 4 cancelled |
| --- | --- | --- | --- | --- | --- |
| `foreman migrate ROUND --contract CONTRACT --out FILE` | Supported pair emitted and parity report written | Read/write I/O fails after valid input selection | Invalid schema, unsupported template, unknown fields or unsafe output selection | Active legacy run requires completion or an existing recovery route | Explicit interruption finishes local cleanup before publication |
| `foreman research query TEXT ...` | Bounded results or no-match response emitted, including explicit stale/optional-vault-absent markers | Required bundle read/output I/O fails | Invalid arguments or required bundle schema | Not used | Not used |
| `foreman research status --json` | Freshness/coverage report emitted, including stale/missing optional inputs | Required bundle read/output I/O fails | Invalid arguments or malformed required manifest | Not used | Not used |
| `foreman research refresh --bundle PATH` | Valid derived snapshot atomically published | Build or write I/O fails after valid bundle selection | Missing required source, manifest/hash mismatch or invalid captured bundle | Not used | Explicit interruption preserves previous snapshot and completes local cleanup |
| `node ARCHIVE/runtime/dist/install.js --prefix PREFIX` | Verified archive installed and current pointer selected | Staging or switch I/O fails with prior installation preserved | Unsupported platform/Node, missing archive asset, manifest/hash mismatch or invalid prefix | Not used | Explicit interruption completes local staging cleanup and preserves prior installation |
| `foreman install rollback --to BUILD_ID` | Compatible retained build selected without rewriting histories | Package restore or pointer-switch I/O fails | Unknown build ID, invalid arguments or package integrity mismatch | Any registered state root has unreadable or incompatible active state requiring reconciliation | Explicit interruption completes local cleanup without changing current |
| `foreman support export --run ID --out PATH` | Redacted diagnostic bundle written | Journal read or bundle write I/O fails | Unknown run ID, invalid arguments or malformed request | Not used | Explicit interruption completes staging cleanup before export publication |
| `foreman --version [--json]` | Installed release/build identity emitted, nullable version preserved | Manifest/output I/O fails | Invalid arguments or malformed identity manifest | Not used | Not used |
| `node runtime/dist/pel-simplification.js --baseline FILE --candidate REV` | Valid comparison emitted and all specified acceptance targets met | Valid comparison emits a missed acceptance target, or execution I/O fails | Cohort/tokenizer mismatch, invalid revision or malformed baseline | Not used | Not used |

Extend the same commandExitCode(command, outcome) router mapping used by M3.
RollbackIncompatible has a reason for unreadable or incompatible registered active state and exits 3.
A successful research view exits 0 when it reports stale context, optional absence or no matches.
A valid metric report that misses its acceptance target exits 1 and retains the comparison report.
A changed cohort or tokenizer is invalid input and exits 2.
T-M6-021 covers every reachable adoption table cell in packages/orchestration/src/pel-adoption-cli.test.ts.
Include that exact target in test:adoption and the existing root orchestration test glob.

## Executable research examples

M2 owns the declaration and schema in packages/orchestration/src/pel-host-descriptors.ts.
M6 adds the handler in packages/orchestration/src/pel-research-host.ts.
The inspected M2 research declaration used different fields and enums from this controlling contract.
M6 corrects that one canonical declaration and regenerates its snapshot before admission.
The corrected digest is then frozen. Runtime code does not define a second result schema.
Register ordinary host function fm/research with named arguments id, query, bundle and limit.
The first three are required bounded strings. Limit defaults to 5 and must be an integer from 1 through 20.
Bundle is an admitted immutable research-bundle reference, not a filesystem path supplied by a note.
Its capability is research.read. A bundle that includes an external vault additionally requires vault.read.
The resolver returns canonical read resources for the bundle index and its admitted source roots, with writes empty.
M4 preparation returns read-result containing the validated Pel value, immutable source references/hashes and preparation digest.
This requires no previous receipt, provider request, external-action reservation or filesystem mutation.

The optional project.researchBundles map binds each exact bundle identifier to one immutable index artifact.
The index owns source paths, raw and clean hashes, capture dates, claim classes, and coverage metadata.
Project configuration does not duplicate source metadata or grant a filesystem root.
Admission retains the index and each bound source through the existing project and run artifact ports.
Runtime resolves the bundle to exact canonical artifact read identities through the existing resource lock service.
The original project configuration and run-owned artifact copies remain the inputs on resume.
An index with external-vault-derived content requires vault.read even after immutable capture.
This refines source-root reads into immutable artifact reads and adds no external runtime filesystem authority.
The existing effect observation records the read preparation digest, source references, and result hash before its receipt.
A replay with a different digest or source set fails without an external reservation.
CLI refresh handles source changes separately and never changes an admitted execution snapshot.

The default portable bundle is runtime/assets/pel/research relative to the installed package.
CLI refresh stores one derived snapshot at foremanHome/research/snapshot.json.
That snapshot retains the explicitly selected canonical sourceRoot and its bounded index.
No separate selection store is required. An interrupted refresh keeps the previous snapshot readable and stale.
Research claim excerpts can select a bounded UTF-8 byte range while retaining the full clean-source hash.

The result schema is schema:research-result-v1, an ordered association with status then results.
Status is the enum string complete or stale.
Results is a bounded list of associations in this order: sourceLocator, sourceHash, capturedAt, claimClass, freshness, excerpt, coverage.
Use max 20 results, 4 KiB sourceLocator, 64-byte hexadecimal sourceHash, 64-byte capturedAt and 8 KiB excerpt.
ClaimClass is hypothesis, adopted-decision, verified-observation or open-question.
Freshness is fresh, stale or missing. Coverage is a bounded list of up to 20 warning strings, each at most 1 KiB.
Missing optional context remains an explicit result or empty result list. It does not grant execution authority.

research-prepare.pel calls `(fm/research :id "research" :query "provider constraints" :bundle "bundle:release-sources" :limit 5)`.
parallel-read.pel uses native do/async over two fm/research calls bound to bundle:pel-paper and bundle:model-evidence.
Each call declares its own canonical read scope. Both use the same registered descriptor and output schema.
M2 checks these examples before M6 implements the handler. M6 executes them through the explicit fixture manifest.

## Archive production

Create packages/orchestration/src/pel-package-main.ts and add its bundle entry runtime/dist/pel-package.js.
The root package:pel script is `node skills/foreman/runtime/dist/pel-package.js`.
The producer sequence is `npm run build`, then `npm run package:pel -- --candidate <git-commit> --out artifacts/foredi`.
Use tar 7.5.22 from TypeScript for sorted, portable tar creation and gzip output.
The [published package metadata](https://registry.npmjs.org/tar/7.5.22) pins the chosen archive library version.
Run filesystem and archive resources inside Effect scopes.

The archive contains runtime/dist, runtime/assets/pel, examples/pel, docs/guides/pel and manifest.json at its root.
Include the installer, product CLI, metrics bundle and immutable default authoring snapshot.
Exclude fixtures, test launchers, credentials, workspaces and mutable execution state.
Reject symlinks, absolute archive paths and traversal segments in payload entries.
Sort paths by UTF-8 byte order. Set archive timestamps and owner/group IDs to zero.
Preserve declared executable versus non-executable file modes.

Construct ManifestPayloadV1 from schemaVersion, releaseName, nullable version, candidateCommit, runtime schema ranges and sorted file records.
Each record contains relative path, byte length, SHA-256 and mode.
The records exclude manifest.json to prevent a self-reference.
Compute buildId as SHA-256 of canonical ManifestPayloadV1 bytes using the existing core canonicalizer.
Write manifest.json as the payload plus buildId, then produce artifacts/foredi/<buildId>.tar.gz.
Emit JSON containing buildId, archivePath and archiveSha256 only after the archive closes successfully.
The installer reconstructs the payload digest and validates every listed file before switching the installation.

T-M6-016 invokes the exact producer sequence and checks the returned archive path and hashes.
T-M6-001 extracts that returned archive to /tmp/foredi-unpacked before invoking its runtime/dist/install.js.
The same archive format supplies retained builds for rollback.
Package production exits 0 after a verified archive, 2 for invalid candidate/options, 1 for build/archive I/O failure and 4 for cleaned-up interruption.

## Final migration and measurement rules

All twelve shell files listed in Fixed measurement membership are deleted after their callers migrate.
Do not retain forwarding wrappers or introduce compatibility subcommands for their old argv.
T-M6-009 checks each path is absent, scans production callers with rg and executes migrated workflow entry points.
Historical record decoders remain available through the unified CLI independently of old script filenames.

Candidate production membership uses these suffixes: .ts, .tsx, .pel, .sh, .py and .ps1.
Exclude *.test.ts and files under test, tests, fixtures, generated dist directories or immutable source archives.
Count each included file once in full, including comments and nonblank lines.
The fixed residual cohort, complete Pel/providers packages, all new orchestration pel-*.ts files,
and every other added or modified production file form one union.
A new pel-research-host.ts is included even though it is not legacy dispatch replacement.
Candidate instructions count all surviving baseline instruction files in full, not selected paragraphs.
The measurement fixture proves both rules and rejects a changed baseline member list or tokenizer.

Installed run/resume overrides must already match a canonical project-registry stateRoot/repository association and authority.
An unregistered override exits 2 before dispatch and directs the user to one-time project configure.
The explicit flag never registers an arbitrary root implicitly.
Installed execution and rollback read the same existing project registry. Do not create a second installation projection.
Resolve package identity from the installed manifest. Checkout execution has no installation prefix requirement.
Fixture execution additionally matches its manifest stateRoot.
Rollback still validates every registered root for an installed release, including roots selected through explicit overrides.

The research descriptor bounds id and bundle to 256 UTF-8 bytes each and query to 4096 UTF-8 bytes.
Additional fields in arguments and result associations are rejected.

Before each shell deletion, search caller scopes packages, components/council, skills/foreman, scripts, env and .github.
Search all twelve full paths and their basenames. Regenerate runtime manifests after callers migrate.
The known caller inventory includes supervisor-live-services.ts, resume-queue-execution.ts, architecture-adapter.ts,
env/reference-manifest.toml, cleanup/worktree scripts, merge-gate.sh and shared launch/eventlog helpers.
Classify historical fixtures and archived prose separately. Production references cannot be waived as historical.
Retained Council plan imports and policy remain supported through their existing compiled paths.
Migrate any Council use of a deleted shared entry point to the existing compiled transport/host interface before deletion.
Run Council's retained review and preflight fixtures after those caller changes.
This changes shared transport invocation only. It does not import Council plans into Pel or add another scheduler.
T-M6-009 requires zero live references in every named scope and passing retained Council invocation fixtures.

pretest:adoption invokes M2's test:pel-fixture-build before runtime acceptance.
The shared root pretest invokes the same builder before npm test and therefore before verify's test stage.
No manual esbuild command or test-module CLI side effect is required on a clean checkout.

### Installed runtime compatibility

The install payload includes `runtimeCompatibility` with exact `runtimeVersion` and `runtimeHandlerVersion` strings. Its default authoring snapshot also binds the registry digest and language profile digest. Rollback compares these identities with each active run's immutable execution binding, in addition to journal, checkpoint, and continuation schema ranges. Equal numeric schema versions do not establish registry compatibility. A mismatch returns needs-action before the current symlink changes. The original retained package remains available for its controller and history.
