# Pel authoring design

## Product behavior

`foreman check workflow.pel` reports language and environment errors.
`foreman plan workflow.pel` displays the checked effects and remaining uncertainty.
Both commands accept `--json`.
Neither command executes the source program's host effects.

`foreman plan --prompt "Implement the approved change and request review" --model gpt-6-astra --transport openai-responses` explicitly requests generation.
Generation returns Pel source and its locally checked preview.
It does not start tasks, reserve execution resources, or publish changes.

The canonical artifact remains Pel source.
A preview is derived data bound to that source.
Operators cannot edit a preview into a new executable workflow.

This change depends on M1.
The provider port permits fixture-based implementation before M3 transports exist.
Live generation requires a qualified M3 model and transport.
M4 owns execution admission, effect conflicts, journal records, and durable revisions.

Requirements use [EARS](https://alistairmavin.com/ears/).

## Exact files

| Target | Responsibility |
| --- | --- |
| `packages/pel/src/checker.ts` | Scope, arity, literal types, profile validation |
| `packages/pel/src/analysis.ts` | Abstract values, reachable effects, dynamic regions |
| `packages/pel/src/preview.ts` | CheckedProgramV1 and PlanPreviewV1 derivation |
| `packages/pel/src/binding.ts` | Canonical hashes and binding validation |
| `packages/orchestration/src/pel-authoring-contract.ts` | CLI service ports and error unions |
| `packages/orchestration/src/pel-authoring-cli.ts` | check and plan argument handling |
| `packages/orchestration/src/pel-authoring-main.ts` | Node.js 24 entry and Effect resource scope |
| `packages/orchestration/src/pel-generation.ts` | Provider generation and capped local repair |
| `packages/orchestration/src/pel-draft-session.ts` | In-memory history, completion, and revision commands |
| `packages/providers/package.json`, `tsconfig.json`, `src/contract.ts` | Minimal generation-port package bootstrap, extended by M3 |
| `scripts/build-runtime.ts` | Bundle authoring entry as `dist/foreman.js` |
| Root `package.json` | Include explicit Pel test globs |
| `docs/reference/pel/authoring.md` | Command help and diagnostic examples |
| `examples/pel/implement-verify-review.pel`, `conditional.pel`, `parallel-read.pel`, `repair.pel` | Useful native Pel programs |

M2 builds the Node.js 24 `dist/foreman.js` entry with a generated executable header.
M6 later installs the public `foreman` symlink to that entry. M2 adds no launcher adapter.
The same bundle later accepts the M4 run, status, resume, and cancel subcommands.
Do not add another command parser for those operations.

## Service boundaries

Export `checkPel(input: CheckInputV1): CheckResultV1`.
Export `planPel(checked: CheckedProgramV1): PlanPreviewV1`.
These are ordinary deterministic TypeScript functions.
Their inputs include source bytes, M1 profile, immutable registry snapshot, provider profile snapshot, policy envelope, and artifact digests.
They import no filesystem, subprocess, network, credential, or live-provider service.

`CheckResultV1` is `ok` with checked program and warnings, or `invalid` with diagnostics.
The CLI adapter reads only explicitly selected source and snapshot files.
Read each file through a bounded Effect scope.
The CLI writes only stdout and stderr.
No default cache, history file, journal, lock, worktree, or reservation is created.
Network-free check and file-based plan do not perform auth probes or fetch missing artifacts.

`AuthoringSnapshotV1` contains full validated language profile, registry, schema, provider profile, policy, resource resolver, role binding, and artifact content descriptors.
It also carries their computed digests, source-independent finite limits, default credential references, and `nlConditionProfile`.
Artifact digests use normalized artifact IDs and SHA-256.
The CLI accepts `--context path.json` for this existing host-data snapshot.
Without that flag, use the installed immutable default authoring snapshot.
This JSON carries host metadata, not control flow or a second task language.

Check source arguments before opening files.
Use the shared exit codes: 0 success, 1 failed, 2 invalid, 3 needs-action, 4 cancelled, and 5 pending.
Check or preview input, syntax, schema, capability, and environment errors return 2.
Generation exhaustion or fatal provider failure returns 1. Explicit cancellation returns 4.
Authoring commands do not use 3 or 5.
For `--json`, write one versioned JSON object on stdout.
Human diagnostics go to stderr only when JSON mode is absent.
Argument misuse returns exit 2 with `PEL_CLI_USAGE`.

## Checking and pure interpretation

Validate identifiers in every executable syntax region.
Quoted syntax is data and does not require symbol resolution.
Resolve lexical scopes, fixed ArgSpec, default arguments, partial closures, and immutable definitions.
Check all statically known types before evaluation.
A dead branch can still contain a syntax, unknown-symbol, or argument-shape error.
Capabilities in a provably unselected valid branch do not count as reachable effects.

Abstract evaluation preserves the M1 native semantics.
Pure calls evaluate under the same fuel and value limits.
A host call yields an abstract result derived from its output schema.
That abstract value flows through native list lookup, pipes, closures, conditions, and loops.
Do not run the host function to improve a preview.

The abstract domain contains known data, schema-constrained unknown data, finite closure sets, and unknown values with origin spans.
Merge branch summaries conservatively.
A pure recursive computation stops at the shared fuel bound.
An unknown-length loop becomes a dynamic region with the admitted iteration bound.
Known oversized loops fail before any host descriptor is emitted.

## PlanPreviewV1

Fields are `schemaVersion: 1`, binding, finalValueSummary, effects, dependencies, dynamicRegions, diagnostics, and limits.
Effects contain nodeId, invocationPath or bounded region ID, registryId, argument summaries, exact model profile, transport, capability requirements, resource reads/writes, and applicable host gates.
An unknown field is tagged `unresolved` with a reason and source span.
`finalValueSummary` uses `{kind:"known",value:PelDataValue}` for known data.
Unknown values use kind unresolved with schema ID, reason, and origin spans.
Known closures use kind callable with code reference and remaining argument names.
Do not render unresolved fields as empty values or successful verification.

Dependency edges distinguish value dependencies from resource conflicts.
Display independent writes to the same worktree as a serialization constraint.
Unknown resources conflict with all writes in their permitted resource scope.
The preview describes constraints.
The M4 execution scope owns actual scheduling.

For `if` with an unknown condition, preserve both possible effect branches.
For `case`, show ordered candidate branches and predicate effects.
For `for`, retain iteration order and an aggregate upper bound.
For `do/async`, show dependency-ready work and resource serialization.
Do not claim a complete static graph for programs with provider-dependent control flow.

## Capabilities and bounded dynamic regions

Each registered descriptor declares required capability names and its output schema.
The installed snapshot supplies allowed capability IDs, exact model/transport pairs, resource scope, schema IDs, and finite effect/cost/time bounds.
The source cannot grant capabilities through keyword pairs or model-generated text.

A dynamic region contains:
- Stable region ID and source spans.
- Reason: unknown condition, unknown collection, unknown callable, or unknown argument.
- Possible registered function IDs and exact allowed model/transport pairs.
- Capability set and normalized read/write resource envelope.
- Maximum iterations, calls, output bytes, cost units, and elapsed milliseconds.
- Result schema and the host requirements that remain deferred.

A known host function with an unresolved argument can pass only when its envelope is finite and the argument is schema-constrained.
An unresolved callable must have a finite registered function set or finite known Pel closure set.
Reject arbitrary unknown callable values.
Unknown paths require a declared finite resource scope and host validation before dispatch.
A wildcard naming all registry functions is not a finite authoring declaration.
The checker rejects unsupported effect kinds, unknown registry IDs, forbidden capabilities, unsupported model/transport pairs, and absent bounds.

Use `PEL_CAPABILITY_DENIED`, `PEL_UNSUPPORTED_EFFECT`, `PEL_PROFILE_UNSUPPORTED`, `PEL_SCHEMA`, and `PEL_DYNAMIC_EFFECT_UNBOUNDED`.
Report the call span, requested value, and allowed alternatives from the snapshot.
Do not suggest a silently substituted model.
If every reachable effect fits its envelope, mark the preview `bounded-dynamic`.
This status permits a later admission check. It is not an authority grant.
M4 revalidates each actual resolved effect before reservation and dispatch.

## Source and environment binding

`CheckedProgramV1` contains original source bytes, sourceDigest, normalized AST, language profile, validated snapshot, bindingDigest, and analysis.
It is a process-local checked value, not an alternate authoring format.
`PlanBindingV1` contains sourceDigest, snapshotDigest, languageProfileDigest, registryDigest, providerProfilesDigest, policyDigest, and sorted artifactDigests.
Canonical JSON uses sorted object keys, preserves array order, rejects duplicate keys, and forbids undefined values.
Hash canonical UTF-8 bytes with SHA-256.
Changing any binding component requires a new preview.
Whitespace changes sourceDigest even if the normalized AST remains equivalent.
Provider-dependent branches do not remove the binding requirement.

An exported preview cannot provide trusted checked state.
M4 reads canonical Pel source and validates binding against its own current authority and environment.
A forged preview with edited capabilities fails binding validation.

## Generation and repair

M2 imports the M3 boundary `ProviderGenerationPort.generate(GenerationRequest): Effect<GenerationResponse, ProviderFailure>`.
M2 creates the minimal strict TypeScript providers package and generation-only contract exports.
Add its project reference and Effect dependency using the existing workspace conventions.
M3 extends these exports with adapter contracts and transport implementations.
Until M3 exists, contract tests use a local typed fixture port.
The interface remains the same.

`GenerationRequest` contains generationId, modelProfileId, transportId, controls, credentialProfileRef, prompt, trustedTemplateId, registry catalog, artifacts, output schema, grammar mode, finite limits, generationBudgetReservationRef, and attempt.
It also contains `capabilitySnapshot:AuthoringPolicyV1`, the immutable policy facts from the validated effective snapshot.
Each attempt preserves this exact content, including allowed capabilities, model/transport pairs, resource envelopes, schema and account references, and finite budgets.
The generation service rejects policy content that differs from the checked snapshot before reservation or dispatch.
Provider lowering puts these admitted policy facts in the pinned template's policy field, separate from untrusted catalog and artifact text.
M3 maps modelProfileId to `ProviderRequestV1.profileId` without changing identity.
`GenerationResponse` contains pelSource, exact observed profile and transport identities, provider request ID, and usage.
`ProviderFailure` exports ModelUnavailable, ModelMismatch, UnsupportedCapability, CapabilityUnverified, PromptChannelUnsupported, AuthenticationRequired, ProbeUnknown, OutputInvalid, OutputIncomplete, MalformedEvent, ContinuationMismatch, ResumeUnavailable, OutcomeUnknown, RateLimited, and TransportDisconnected.
Every ProviderFailure has `_tag`, `message:string`, and `retryClass:"never"|"transient"`.
Optional fields are `requestId:string`, `usage:ProviderUsageV1`, `fieldPath:string`, `providerIdentity:ProviderIdentityV1`, and `retryAfterMs:number`.
RetryAfterMs is nonnegative and legal only for a transient failure.
M2 owns this complete contract-only union in `packages/providers/src/errors.ts`. M3 extends package exports and implements adapters.
M2 represents local deadlines, cancellation, and refusal observations as typed `PelGenerationFailure` causes.
Export `generatePelPlan(request: GenerationRequest, snapshot: AuthoringSnapshotV1): Effect<GeneratedPlanV1, PelGenerationFailure, ProviderGenerationPort>`.
`GeneratedPlanV1` contains pelSource, preview, attempt count, provider identities, and cumulative usage.
`PelGenerationFailure` contains a stable code, bounded per-attempt diagnostics, cumulative usage, and an optional typed provider cause.
The output envelope is exactly `{pelSource: string}`.
GenerationRequest.outputSchema is `{id:"schema:pel-source-v1",content:PelDataSchemaV1}`.
Its content is an association with one required pelSource string bounded to 1 MiB and no additional keys.
Provider lowering receives both the schema ID and content without importing the orchestration declaration module.
Reject extra fields, missing source, non-string source, and more than 1 MiB of source.
Catalog descriptions and artifact text are untrusted prompt data.
The trusted request selects capabilities and limits separately.

Use provider grammar constraints only if the chosen profile explicitly supports that endpoint's mechanism.
Otherwise request the structured source envelope and perform local parsing.
A JSON string does not constrain the grammar inside it.
Unknown constraint support uses envelope mode.
A requested mandatory grammar mode on an unsupported profile fails with `PEL_PROFILE_UNSUPPORTED`.

The loop performs attempt 0 plus repair attempts 1 and 2.
Each call has a 60-second timeout.
The whole operation has a 180-second deadline and the host-supplied finite token and cost budget.
A call cannot begin if its reservation exceeds the remaining generation budget.
Timeout, cancellation, auth failure, identity mismatch, refusal, or unavailable model stops the loop without a syntax repair.
Local lexical, parse, schema, capability, or boundedness failures can request a repair.

Each repair receives the previous source, local diagnostic codes and spans, applicable signatures, and the same immutable capability snapshot.
It cannot expand capabilities, change the exact model, or reset limits.
Accept the first source that passes local check and preview.
After three locally invalid responses, return `PEL_GENERATION_EXHAUSTED` with all three diagnostic sets and bounded source samples.
Return exit 1.
Do not return an accepted plan or dispatch any generated operation.
Usage for all attempts remains visible.

The prompt operation owns one Effect scope for cancellation, provider resources, timeouts, and counters.
File-based check and plan never invoke this port.
Default generation output writes only exact Pel source to stdout.
The preview and human diagnostics go to stderr.
The operator can redirect stdout directly to a Pel file.
With `--json`, stdout instead contains one `GeneratedPlanV1` object and stderr contains no preview text.

## Interactive draft correction

`foreman plan workflow.pel --interactive` opens an in-memory draft session.
It provides source-span highlighting, immutable-registry symbol completion, and command history.
The terminal interface owns its readline resources through Effect.
No history or source file is written automatically.

Commands are `show`, `check`, `preview`, `history`, `undo`, `replace-expression <node-id>`, `replace-suffix <node-id>`, `replace-program`, `repair`, `export`, and `abort`.
Replacement commands read a Pel fragment terminated by a line containing only `.end`.
Reject a fragment above the source limit.
Expression replacement requires exactly one parsed expression.
Suffix replacement starts at a top-level expression.
Every replacement creates a new draft source digest and runs local checking.
Undo restores a prior draft without executing its source.
Export writes exact current source to stdout.

The explicit `repair` command uses the same bounded generation service.
It requires a selected exact model and transport.
The UI displays provider use before starting that requested operation.
Pure commands cannot invoke it implicitly.
The session keeps at most 100 source revisions and at most 16 MiB of revision bytes.
Before exceeding either bound, discard the oldest revision.
Retain the current revision and show the oldest available revision number.

These commands implement the paper's authoring restart choices and editor conveniences.
They affect unexecuted drafts.
M4 owns recovery from a running program, completed receipts, and authorized durable revisions.
The UI returns `PEL_DRAFT_EXECUTED` if passed a run-bound continuation.

## Useful examples

Create four examples with the same registry fixtures used by acceptance tests.
The sequential example uses the release's ordinary host function calls:

```lisp
(fm/task :id "implement" :model "role:implementer"
  :input "artifact:approved-spec" :output "schema:candidate-v1")
|> (fm/verify :id "verify" :input ^ :gate "candidate-full")
|> (fm/review :id "review" :model "role:reviewer"
  :input ^ :policy "independent-review")
```

The conditional example looks up a Boolean host result through a callable list:

```lisp
(def result (fm/verify :id "verify" :input "artifact:c1" :gate "candidate-full"))
(if (result :at ':passed)
  (fm/review :id "review" :model "role:reviewer"
    :input result :policy "independent-review")
  [:status "verification-failed"])
```

The parallel example uses `do/async` with two distinct admitted resource scopes.
The shipped repair.pel contains the corrected named call and a comment showing its previous mixed-argument error.
The intentionally invalid source is `packages/pel/test/fixtures/repair-invalid.pel`, which is not a runnable shipped example.
All shipped examples pass check. The negative fixture returns PEL_ARGUMENT_MODE and exit 2.
Document exact expected human and JSON output for each fixture.
Examples use source, values, and native control flow without a separate task DSL.

## Planned validation

Run `npm run typecheck`.
Use the existing `scripts/run-tests.ts` wrapper with quoted paths.
Set `test:pel-authoring` to `tsx scripts/run-tests.ts "packages/pel/test/analysis.test.ts" "packages/pel/test/preview.test.ts" "packages/pel/test/binding.test.ts" "packages/orchestration/src/pel-authoring-cli.test.ts" "packages/orchestration/src/pel-generation.test.ts" "packages/orchestration/src/pel-draft-session.test.ts" "packages/orchestration/src/pel-cli-fixture.test.ts"`.
Run `sh -c 'npm run test:pel-authoring'`.
Confirm all seven files execute and a deliberately missing quoted path makes the wrapper exit 1.
The root test command retains `"packages/pel/test/**/*.test.ts"` and `"packages/orchestration/src/**/*.test.ts"`.
This uses the repository's existing Node.js test convention without shell brace expansion.
Build the CLI with `npm run build`.
Run `node skills/foreman/runtime/dist/foreman.js plan examples/pel/implement-verify-review.pel --context packages/pel/test/fixtures/authoring-snapshot.json --json`.
Tests deny provider, network, subprocess, write, and reservation services in file-based check and plan.
The catalog defines observable assertions. These commands have not run for implementation in this drafting change.

## Complete snapshot and selection contract

The installed default snapshot is `skills/foreman/runtime/assets/pel/default-authoring-snapshot.json`.
The bundle resolves that path relative to its installation root, never the current working directory.
M2 creates and packages it. M6 records its hash in the installation manifest.
An explicit `--context` replaces this whole authoring snapshot after validation.

`AuthoringSnapshotV1` fields are:
- `schemaVersion:1`, `languageProfile`, `languageProfileDigest`, `registry:HostRegistryV1`, and `registryDigest`.
- `providerProfiles` and `providerProfilesDigest`, including exact transport IDs, supported controls, evidence kind, and explicit application defaults.
- `policy` and `policyDigest`, containing allowed capabilities, model/transport pairs, resource envelopes, finite budgets, and artifact constraints.
- `resourceResolvers` with the registry-bound resolver version and data rules.
- `roleBindings`, mapping role IDs to exact profileId, transportId, controls, and credentialProfileRef.
- `nlConditionProfile`, either null or exact profileId, transportId, controls, credentialProfileRef, and outputSchemaId.
- `artifactDescriptors`, `artifactDigests`, `limits:PelLimitsV1`, and `generationLimits`.
- `defaultCredentialProfileRef` and `snapshotDigest`.

All maps and arrays contain actual immutable content, not only hashes.
Compute each component digest from its canonical content.
Compute snapshotDigest from the full canonical snapshot excluding snapshotDigest.
Reject missing content, duplicate keys, unknown schema fields, and mismatched digests with exit 2.
Credential references are opaque account-selection IDs. Snapshots contain no secret bytes.

M1's `PelDataSchemaV1` supplies result, artifact, and dynamic-value schemas.
A future collection with list schema `maxItems:4` has at most four iterations.
Combine that bound with maxIterations and the policy's aggregate effect budget.
Unknown collections without finite schema or policy bounds fail PEL_DYNAMIC_EFFECT_UNBOUNDED.
Association schemas include required Boolean `:passed` and unique ordered keys for M5 verification results.
A preview reads this schema and does not fabricate a verification result.

A model literal resolves to an exact profile.
A `role:...` string resolves through roleBindings.
This is host argument interpretation, not a new language production.
A supplied `:transport` must select an admitted pair and agree with a selected role binding.
Without an explicit selector, an exact profile must have one admitted transport.
Two possible transports return PEL_PROFILE_UNSUPPORTED with both alternatives listed.
Default role bindings select Grok 4.6 for implementation and Sol for review.
The snapshot fixes their exact transports and controls.
Changing a role binding changes snapshotDigest and requires a fresh preview.

A reachable literal case string requires nonnull nlConditionProfile.
Its outputSchemaId must equal `schema:pel-boolean-v1`.
Its profile, transport, controls, and credential reference must satisfy the same policy checks.
The preview's `pel/nl-condition` effect shows those exact fields.
An absent or unsupported selection fails PEL_PROFILE_UNSUPPORTED before execution.
M4 registers the predicate handler and validates its Boolean result.
M4 also registers print and preserves a single JSON object on stdout by journaling program output and routing human text to stderr.

## Controls and generation request lowering

`ProviderControlsV1` is:
`{effort:"none"|"low"|"medium"|"high"|"xhigh"|"max", thinking:{mode:"provider-default"|"adaptive"|"enabled"|"disabled",budgetTokens?:number}, sampling:{temperature?:number,topP?:number,topK?:number}, toolChoice:"auto"|"none"|"required"|{name:string}, execution:{mode:"foreground"|"background",store:"provider-default"|boolean}}`.

Reject unknown keys.
M3 validates every supplied field against the exact profile and transport.
M2 resolves the object from admitted application defaults, with an explicit `--controls path.json` override validated by the same schema.
Defaults are high effort except Sol medium, Anthropic adaptive thinking, other profiles provider-default thinking, empty sampling, foreground execution, and provider-default store.
These are explicit Foreman choices included in providerProfilesDigest.
Normal task tool choice defaults to auto.
Generation always uses toolChoice none because generation has no execution tools.
An incompatible requested tool choice is rejected instead of silently changed.
The preview shows the complete resolved controls and its source, default or explicit.
No unsupported effort or model substitution is permitted.

`GenerationGrammarMode` is `"auto" | "grammar-required" | "envelope"`.
The resolved provider request mode is `"grammar" | "envelope"`.
Auto selects grammar only for a documented and qualified capability of the exact endpoint.
Otherwise it selects envelope.
Grammar-required rejects missing qualification with PEL_PROFILE_UNSUPPORTED.
Envelope always requests the closed source envelope followed by local parsing.

The CLI accepts `--credential-profile <reference>`.
Without that flag, use the exact admitted default reference for the selected profile.
An absent or incompatible account reference returns exit 2 before a provider call.
M3 resolves credentials from its scoped account service. Secret bytes never enter Pel or the snapshot.

Export `GenerationBudgetPort` with `reserve(input): Effect<GenerationBudgetReservationV1,GenerationBudgetFailure>` and `settle(reservation,usage): Effect<void,GenerationBudgetFailure>`.
This port owns only the bounded authoring operation's generation allowance.
It is separate from the execution EndstopLedger and cannot reserve a task, verification, integration, or publication action.
Its input contains operation ID, attempt, maximum input/output tokens, conservative spend units, and deadline.
Every attempt must reserve before its provider call.
Unknown usage retains the conservative amount until the operation ends.
No retry or repair resets the operation allowance.

Compute generationId as SHA-256 of canonical promptDigest, snapshotDigest, exact profile/transport, and a fresh session nonce.
Generation request effectId is `generationId + "/attempt/" + attempt`, where attempt is 0, 1, or 2.
M3 lowers trustedTemplateId to a pinned generation template with template hash.
It places prompt, registry catalog, and supplied artifact text in delimited untrusted input fields.
M3 lowers artifacts to bounded immutable references with source digests.
It sets toolPolicy to the closed no-tools policy.
It maps generationBudgetReservationRef to the provider request's spend reservation reference.
It preserves controls, credentialProfileRef, exact profile, transport, limits, and attempt identity.
A complete generation request therefore needs no execution ledger or missing inferred account.

The full ProviderFailure union is declared once in `packages/providers/src/errors.ts`.
M2's exhaustive switch treats every transport-emitted failure as fatal for that generation operation.
Only locally obtained candidate validation failures enter the syntax repair loop.
A malformed provider envelope can be converted to local OutputInvalid only when a bounded complete response was received.
Refusal, incomplete response, unknown outcome, timeout, and cancellation never become syntax-repair candidates.
M3's only transient categories are RateLimited and TransportDisconnected.
M2 still stops on these categories because its generation API does not add a transport retry owner.
M4 can apply its separately admitted retry policy using `:rate-limited` and `:transport-disconnected`.
A compile-time never branch enforces exhaustiveness in M2.

## Compiled acceptance fixtures

M2 unit and integration tests inject ProviderGenerationPort and filesystem ports directly.
M2 owns `makeForemanCli(services)` and the minimal authoring fixture entry.
Compiled CLI acceptance runs `node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest FILE plan ...`.
The M2 test-only entry reads the bounded manifest and removes that option before calling `makeForemanCli(services)`.
The production entry rejects `--fixture-manifest` with exit 2.
No product option or environment switch can select the fixture transport.
M4 extends the same entry with lifecycle services. The fixture build cannot produce live-qualified evidence.
The production bundle rejects fixture transport selection.
M2's file-based check/plan tests require no provider injection at all.
The installed example snapshot is static authoring data and does not claim live provider qualification.

M2 owns creation of the minimal providers package metadata, contract, errors, and TypeScript configuration.
M3 depends on M1 and M2 and extends these files.
The feature catalogs use milestone IDs in depends_on, never change-directory names.

## M2-owned authoring interfaces and declarations

M2 creates `makeForemanCli(services): ForemanCli` in `pel-authoring-cli.ts`.
ForemanCli exposes `run(argv): Effect<CliResult,AuthoringFailure>`.
Services contain bounded input/output, AuthoringContextPort, ProviderGenerationPort, GenerationBudgetPort, and injected clock ports.
M2 registers check and plan. Later milestones extend its command table and service implementations.
No M2 test imports M4, M5, or M6 implementation modules.

M2 creates `packages/orchestration/src/pel-host-descriptors.ts`.
It exports `foremanDescriptorSpecsV1`, `foremanDataSchemasV1`, `foremanFailureSchemasV1`, and `foremanResolverCatalogV1`.
These are pure declarative data.
The module is the sole source for default snapshot registry content.
M4, M5, and M6 extend these records when adding their operations and import them when binding executable handlers.
They do not create private copies with different ArgSpec or schema fields.

The initial authoring declarations include:
- fm/task with required id, model, input, output, and transport default nil. Result schema:task-result-v1.
- fm/verify with required id, input, gate. Result schema:verify-result-v1.
- fm/review with required id, model, input, policy, and transport default nil. Result schema:review-result-v1.
- fm/publish with required id, input, destination. Result schema:publish-result-v1.
- fm/race with required tasks and winner. Result schema:pel-data-v1.
- fm/retry with required attempts, on, body. Result schema:pel-data-v1.
- fm/checkpoint with required name. Result association keys name:string and sequence:nonnegative integer.
- fm/research with required id, query, bundle, and limit default 5, restricted to 1 through 20.

Task and review model fields accept exact profile IDs or admitted role strings.
Their resource selectors use admitted workspace or immutable artifact references.
Task requires the admitted task action capability and writable workspace envelope.
Verify requires verification capability and a registered gate.
Review requires review capability and read-only artifact access.
Publish requires publication capability and an admitted destination.
Race and retry delegate resource requirements to their finite child closure envelopes.
Checkpoint uses journal capability with no external action reservation.
Research requires research.read, optionally vault.read, and a read-only admitted source bundle.
M2 declarations grant none of these capabilities.

The provider-output schema: candidate-v1 has exact ordered keys:
summary is a string of at most 8192 UTF-8 bytes,
claimedPaths is at most 1000 strings of at most 4096 bytes,
findings is at most 100 strings of at most 4096 bytes.
Its registry ID is `schema:candidate-v1`.
These fields are untrusted reports. M5 computes authoritative candidate identity from the worktree.

The result association key orders are:
task: status, candidate, artifacts, implementation-receipt, findings.
verify: status, passed, candidate, task, verification, checks, findings.
review: status, approved, candidate, verification, review, verdict, findings.
publish: status, candidate, delivery, publication, next-action, findings.
Research uses status and results.
Every listed key is required and additional or duplicate keys are rejected.
Status and verdict use the operation's closed enum. Passed and approved are booleans.
Task status is candidate-ready or no-change. Verify status is verified or verification-failed.
Review status is approved, changes-requested, unverified, or verification-failed. Publish status is published or needs-action.
Review verdict is approved, changes-requested, or unverified.
References are bounded artifact strings, nullable only for absent candidate or unfinished receipts.
List fields have at most 1000 bounded data elements.
Nested task, verification, and delivery values reference the respective schema.
Research result rows have ordered sourceLocator, hash, capturedAt, claimClass, freshness, excerpt, and coverage fields.
Locator/hash/time fields are bounded strings, excerpt is at most 16384 bytes, and the others are bounded typed source classifications.
Research returns at most the requested limit.
M5 and M6 can tighten these records only by updating this module and regenerating the bound snapshot.

The same module registers schema:delivery-needs-action-v1 and schema:delivery-final-v1 for M4 terminal classification.
The needs-action schema has exact ordered status, candidate, delivery, reason, round-count, and findings fields.
Status is the literal needs-action. Candidate is nullable artifact data. Delivery is the nested current delivery result.
Reason is a bounded string, round-count is a nonnegative bounded integer, and findings is a bounded list.
The final schema is the union of that association and the ordinary registered delivery-result associations.
M4 validates final values against the admitted resultContract before applying milestone policy.

scripts/build-runtime.ts calls `createHostRegistry` on this module and deterministically generates default-authoring-snapshot.json.
A build test regenerates the bytes and compares the packaged asset.
Run admission requires the handler-backed registryDigest to equal the effective snapshot registryDigest.
A changed descriptor yields binding-mismatch and exit 2 before dispatch.
Every reachable or dynamically possible host function requires a handler. Unused future declarations do not require one.
M2 check/plan needs declarations only and executes no handler.

## Definite bindings through branches

The checker tracks an immutable abstract environment per feasible branch.
A known condition keeps only the selected branch's post-environment for subsequent symbol uses.
For an unknown condition, a name is definitely bound afterward only if every feasible branch binds it.
Merge its abstract values and preserve both effect alternatives.
A case without a guaranteed matching branch includes its implicit nil/no-definition branch.

For `(if c (def x 1) (def x 2)) x` with unknown Boolean c, check exits 0 and x is a schema-known number.
For `(if c (def x 1) 7) x`, check exits 2 with PEL_CONDITIONAL_BINDING at the final x and related branch spans.
For `(if #t (def x 1) 7) x`, check exits 0 and the final value summary is known 1.
This is a deterministic authoring restriction, not a change to M1 runtime scope.
Definitions not used after a conditional do not trigger PEL_CONDITIONAL_BINDING.
Ordinary syntax and argument checks still apply to every executable branch.

## Effective snapshot derivation and run options

Export `buildEffectiveAuthoringSnapshotV1(base,selection): Result<AuthoringSnapshotV1,AuthoringDiagnostic[]>` from `packages/pel/src/preview.ts`.
Selection contains roleBindings, nlConditionProfile, dependencyMode, resultContract, and optional narrowingLimits and narrowingBudgets.
NarrowingLimits uses PelLimitsV1. NarrowingBudgets contains finite maxEffects, maxCostUnits, and maxElapsedMs.
Effective bounds take the fieldwise minimum of base and configured bounds. An attempted widening returns an invalid-selection diagnostic and exit 2.
An omitted selection uses the base snapshot defaults.
Overrides must remain within the base policy's admitted profile, transport, resource, schema, and limit envelope.
The function validates full effective content and recomputes snapshotDigest.
No independent role or predicate lookup occurs after this derivation.

M2's AuthoringContextPort returns a base snapshot and optional selection.
Standalone authoring reads --context and optional --selection input, or uses packaged defaults.
M4 later supplies its project configuration through this same port and function.
Configured check, plan, and run therefore use identical effective snapshots.
An explicit effective --context that disagrees with configured derivation fails with exit 2.
Project changes update the effective snapshot digest while leaving the immutable base artifact untouched.

The snapshot carries dependencyMode and the selected predicate content and digest.
M2 constructs PelRunOptionsV1 with replay none for initial checking.
Its digest participates in CheckedProgramV1 and PlanBindingV1 as optionsDigest.
M4 constructs revision replay options from its durable boundary and failed-step records.
No provider package is imported by the Pel checker.
Orchestration maps provider profiles and controls to structural immutable Pel facts.
The package dependency order is core, then pel, then providers, then orchestration.

## M2 fixture bootstrap and checkout validation

M2 creates `packages/orchestration/src/pel-cli-fixture-main.ts` with a side-effect-free exported fixture main.
The invocation entry is `packages/orchestration/test/pel-cli-fixture-entry.ts`.
Actual tests are in `packages/orchestration/src/pel-cli-fixture.test.ts`.
Only the invocation entry executes main at module load.
Test globs never select that invocation entry.

M2 creates `scripts/build-pel-test-fixture.ts` using esbuild with platform node, format esm, and target node24.
It builds the invocation entry to `packages/orchestration/dist-test/pel-cli-fixture.js`.
The npm script test:pel-fixture-build runs that TypeScript builder.
Its exact command is `tsx scripts/build-pel-test-fixture.ts`.
Root pretest invokes test:pel-fixture-build before selecting tests.
Focused authoring tests also invoke the builder before compiled CLI assertions.

Every compiled fixture command requires --fixture-manifest FILE.
The bounded manifest contains fixtures, assetRoot, and assetManifestSha256.
Resolve the snapshot and example assets beneath assetRoot and verify the manifest hashes.
M2 fixtures use the built checkout's runtime and example assets.
M6 later repeats those tests against copied installed assets.
M2 T-M2-013 makes no claim about installation.
M4 extends the existing fixture services for lifecycle commands.

The public M2 built command is `node skills/foreman/runtime/dist/foreman.js`.
The M6 installation symlink is outside M2 completion requirements.

## Shared provider failure bootstrap shape

M2 alone creates errors.ts, the minimal ProviderUsageV1, and ProviderIdentityV1.
M3 extends package exports and implements behavior without redefining these records.
ProviderUsageV1 has optional inputTokens, outputTokens, cachedReadTokens, cacheWriteTokens, costUsd, priceScheduleRef, and required providerCounters.
Token counts are nonnegative safe integers. CostUsd is a decimal string. Absent accounting fields mean unknown.
ProviderCounters is a readonly map of strings to finite numbers or bounded strings.

ProviderIdentityV1 has kind api or native, plus provider, profileId, transportId, and credentialProfileRef.
API identities add endpointRevision and responseId.
Native identities add protocolVersion, sessionId, and optional turnId.
It contains no credentials or opaque secret values.

Every failure uses the same previously declared common record and _tag discriminator.
Only RateLimited and TransportDisconnected have retryClass transient.
Every other tag has retryClass never.
Providers obtain credential material from an injected CredentialPort defined in providers.
Orchestration supplies the implementation. Providers never import orchestration modules.

## Implemented authoring policy details

`AuthoringPolicyV1.allowedReviewPolicies` contains the admitted `fm/review :policy` identifiers.
The default includes `independent-review`, `policy:independent-review`, and `policy:default`.
The checker rejects other review policies before preview acceptance.
Resource scopes use normalized host identifiers without wildcards, traversal, encoded separators, or absolute paths.
Pinned profile ceilings reject impossible model/transport and control metadata, even when a snapshot has recomputed digests.
These ceilings provide authoring constraints. M3 still owns live qualification evidence.

`CheckedProgramV1.analysis` and its nested preview records are immutable.
`normalizedAst` excludes byte spans and node identifiers. Exact source bytes remain part of every checked binding.
The abstract interpreter includes child closures from `fm/retry` and `fm/race` in capability checks and aggregate effect bounds.
Its dynamic envelopes conservatively include all feasible alternatives. Host dispatch remains absent from M2.
