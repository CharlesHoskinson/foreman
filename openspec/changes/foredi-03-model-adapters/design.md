# Model adapter design

## Context and evidence

Read [adapter evidence](../../../docs/research/pel-release/ADAPTER-EVIDENCE.md) and its [capture manifest](../../../docs/research/pel-release/sources/models/manifest.json).
Those captures document advertised behavior as of 2026-09-12.
They do not establish account access, installed CLI routing or completed Foreman tests.
Use the manifest's exact source hashes in profile evidence.

Requirements use the [official EARS patterns](https://alistairmavin.com/ears/).
All commands and test files below are planned implementation targets.

## Package and ownership

Extend M2's provider package bootstrap: `package.json`, `tsconfig.json` and `src/contract.ts`.
M2 creates these files once. M3 depends on M1 and M2.
Use the workspace's strict TypeScript and Effect conventions.
Export the public contract through `packages/providers/src/index.ts`.
Extend `tsconfig.json`, `tsconfig.all.json`, `package.json` and `scripts/build-runtime.ts` for package compilation and test discovery.
Use Node.js 24 for compiled product execution.

| Planned file | Contract or responsibility |
| --- | --- |
| `packages/providers/src/contract.ts` | ProviderRequestV1, ProviderEventV1, ProviderIdentityV1, ProviderTransport |
| `packages/providers/src/errors.ts` | Extend the canonical failure record created by M2 |
| `packages/providers/src/profiles.ts` | Six immutable profile definitions and pure control validation |
| `packages/providers/src/registry.ts` | Resolve explicit profile and transport with source-bound evidence |
| `packages/providers/src/events.ts` | Pure incremental event normalization and cursor handling |
| `packages/providers/src/tools.ts` | Tool-call/result encoding with host-supplied authorization and receipts |
| `packages/providers/src/output.ts` | Original host-schema validation after provider schema lowering |
| `packages/providers/src/continuation.ts` | Versioned opaque state envelope and prefix binding |
| `packages/providers/src/readiness.ts` | Separate discovery, auth, currency, identity and capability facts |
| `packages/providers/src/qualification.ts` | Evidence matching and bounded qualification reports |
| `packages/providers/src/transports/{xai-responses,anthropic-messages,openai-responses,google-interactions}.ts` | Four direct API protocols |
| `packages/providers/src/transports/{grok-acp,claude-code,codex-app-server,gemini-cli}.ts` | Four native coding protocols |

Providers consumes its own injected CredentialPort. Orchestration supplies the implementation using existing credential-profile services.
No production or test source in packages/providers imports packages/orchestration.
Reuse `packages/launcher/src/supervise.ts` for scoped subprocess ownership.
Reuse Council schema lowering only through explicit provider capabilities and host validation.
M4 owns retries, deadlines, reservations, worktree authority, tool execution and durable event persistence.
Transports never run a second workflow loop.
Transport reconnection can continue an existing request within its limits. It cannot create a replacement request automatically.

## Shared service contract

`ProviderRequestV1` contains `schemaVersion: 1`, `effectId`, `profileId`, `transportId`, `trustedInstructions`,
`artifacts`, `toolPolicy`, `outputSchema`, `controls`, `limits`, opaque `credentialProfileRef` and optional `continuation`.
Artifacts contain immutable content references and hashes. Requests contain opaque credential references and never secret bytes.
Limits contain deadline, maximum input/output tokens, maximum tool calls and spend reservation reference.
Profile resolution adds profile hash, source-manifest hash and transport version.
No adapter accepts a generated instruction as authority.

`ProviderIdentityV1` discriminates `api` and `native`.
API identity includes provider, exact model, endpoint revision and response/interaction ID.
Native identity includes provider, exact model, protocol version and session/thread/turn IDs.
A response ID cannot act as a native session ID.

`ProviderEventV1` contains `effectId`, provider identity, source event ID or cursor and a discriminated payload.
The vocabulary is `started`, `text`, `tool-request`, `usage`, `checkpoint`, `completed`, `refused`, `failed`, `cancelled`.
Checkpoint events emit bounded opaque bytes, formatVersion, sha256, prefixHash, retention metadata and optional cursor.
M4 persists these bytes through protected existing artifacts and appends checkpoint and cursor references.
Adapters do not read or write the session store or journal.
Expose `ProviderGenerationPort.generate(GenerationRequest): Effect<GenerationResponse, ProviderFailure>` for M2.
Map its exact `modelProfileId` explicitly to `ProviderRequestV1.profileId`.
Preserve transportId, grammar mode, prompt, catalog, attempt index and the `{pelSource:string}` output envelope.
M2 owns the initial attempt plus two repairs, 60-second attempt bounds, 180-second total bound and 1 MiB source limit.
M3 makes one generation request per call and never parses authority from, repairs or executes the generated Pel.
Implement this mapping in `packages/providers/src/generation.ts`.
Usage retains observed token, cache and price-schedule dimensions. Unknown costs stay unknown.
The host applies conservative reservations when provider accounting is incomplete.
Completed means a schema-valid provider result. It never means host verification passed.

`ProviderTransport` exposes these Effect operations:

- `probe(input): Effect<ReadinessV1, ProbeFailure>`
- `start(request): Effect<Stream<ProviderEventV1, ProviderFailure>, ProviderFailure, Scope>`
- `sendToolResult(identity, result): Effect<void, ProviderFailure>`
- `cancel(identity): Effect<CancellationObservationV1, ProviderFailure>`
- `observe(identity): Effect<RemoteObservationV1, ProviderFailure>`
- `resume(request, identity, cursor): Effect<Stream<ProviderEventV1, ProviderFailure>, ProviderFailure, Scope>`

`ToolResultV1` carries effectId, full provider identity, callId, authorizationBinding, receiptRef, content, isError, contentSha256 and maxBytes.
Content is `{kind:"text",text:string}` or `{kind:"json",value:JsonValue}`.
The host resolves receipt content before sendToolResult and enforces 1 MiB or the smaller admitted bound.
The transport submits a result only through the admitted host tool port.
Native permission exchanges use the same port. A CLI with no adequate permission boundary cannot advertise unrestricted coding support.
Duplicate events preserve their source identity. M4's journal decides whether a committed tool effect has a reusable result.

Failures include `ModelUnavailable`, `ModelMismatch`, `UnsupportedCapability`, `CapabilityUnverified`,
`PromptChannelUnsupported`, `AuthenticationRequired`, `ProbeUnknown`, `OutputInvalid`, `OutputIncomplete`,
`MalformedEvent`, `ContinuationMismatch`, `ResumeUnavailable`, `OutcomeUnknown`, `RateLimited` and `TransportDisconnected`.
Each error carries safe context and a retry classification. The host decides whether a retry is allowed.
Never embed credentials, raw hidden reasoning or full sensitive provider payloads in public diagnostics.

## Exact profiles

| Profile | API and native targets | Required controls and negative fixtures |
| --- | --- | --- |
| `grok-4.6` | xAI Responses, Grok Build ACP | low/medium/high/xhigh. Reject max. Remote cancellation and cursor replay remain unknown pending endpoint evidence. |
| `claude-opus-5` | Messages, Claude Code stream-json | low/medium/high/xhigh/max. Reject disabled thinking at xhigh/max. |
| `claude-fable-5-1` | Messages, Claude Code stream-json | Adaptive thinking stays enabled. Reject manual budget, non-default sampling and forced any/named tool choice. |
| `gpt-6-astra` | Responses, Codex app server | low/medium/high/xhigh/max. Reject none. Preserve response reasoning items. |
| `gpt-5.6-sol` | Responses, Codex app server | none/low/medium/high/xhigh/max. Preserve Sol defaults and dated pricing independently. |
| `gemini-3.8-flash` | Interactions, Gemini CLI | low/medium/high. Reject minimal. Keep thought steps distinct from generateContent signatures. |

Exact model controls come from [Grok](https://docs.x.ai/developers/grok-4-6),
[Opus](https://platform.claude.com/docs/en/models/opus-5/overview),
[Fable changes](https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1),
[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra),
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and
[Gemini](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).
Use captured limits without replacing an undocumented output limit with infinity.
Pricing records include effective date, tier, cache reads/writes and long-context thresholds.
Do not copy numeric prices into permanent execution defaults.

Initial coverage targets all six profiles on each family's direct API and native coding protocol.
Support remains unavailable until a cell has its required evidence.
An unsupported native capability stays visible and cannot silently switch to an API session.
Headless Codex, Grok fallback and Agent SDK modes require separate explicit transport records if added.
Do not add those modes merely to increase the support matrix.

## Semantic transport rules

For xAI, encode its own Responses semantics and encrypted thinking.
Its documentation does not establish OpenAI-compatible remote cancellation or cursor replay.
For OpenAI, preserve response items and use documented response-ID/cursor reconnection.
For Anthropic, preserve thinking blocks byte-for-byte and bind Fable's append-only prefix.
For Google, preserve Interactions thought steps and observe terminal state before chaining.
These distinctions follow the transport sources linked in the [adapter evidence](../../../docs/research/pel-release/ADAPTER-EVIDENCE.md).

Prompt channels are `protocol`, `stdin`, `file` or explicitly bounded `argv`.
Do not interpolate prompts into a shell command.
Extend the typed launcher input contract if stdin is required.
The current worker path cannot carry stdin while the Council Codex canary uses it.
Test both callers against the same byte-preservation fixtures.

Lower a response schema only within the selected provider's documented subset.
Validate the final result against the original host schema.
Treat refusal and truncation as terminal provider outcomes even if their envelopes are valid JSON.
Use a structured envelope containing Pel source when grammar constraints are unavailable.
A JSON string containing Pel does not establish Pel grammar validity.

## Cancellation, continuation and recovery

`CancellationObservationV1` has independent requested, acknowledged, localCleanup and remoteOutcome fields.
Remote outcome is `pending`, `cancelled`, `completed`, `unknown` or `unsupported`.
A closed socket or killed child does not establish remote cancellation.
Claude SIGTERM and interrupt fixtures preserve their different resume behavior.
OpenAI and Gemini poll or reconnect only as documented.
xAI remote cancellation remains unknown until separately qualified.

Opaque continuation envelopes include provider/model/transport identity, schema version, prefix hash, retention metadata and exact payload hash.
Emit payloads to M4 for persistence through protected existing artifacts.
Export concise conclusions through research interfaces, never hidden reasoning.
A changed model starts a new provider session with explicit artifact context.
Retention expiry returns `ResumeUnavailable`. Uncertain completion returns `OutcomeUnknown`.
Neither failure authorizes redispatch.

## Qualification and validation

Add `packages/providers/src/**/*.test.ts` to root `npm test`.
Add `test:providers` invoking the existing TypeScript test runner with that glob.
Implement T-M3-019 in `generation.test.ts` and T-M3-020 in `usage.test.ts`.
Run `npm run typecheck`, `npm run test:providers`, `npm run build` and `npm run verify-runtime`.
Expected result: compiled Node.js 24 product, complete fixture coverage and no hidden transport fallback.

Extend M2's `pel-authoring-cli.ts` and `pel-authoring-main.ts` with providers subcommands.
Their only product router is `skills/foreman/runtime/dist/foreman.js`.
The default list is read-only and does not launch a workload.
Qualification requires an explicit account reference, exact profile, transport and limits file.
Default hard maxima per cell are 180 seconds, 30,000 tokens, two tool calls and USD 5.
A smaller host limit always wins. Unknown cost consumes the conservative reservation.
Use disposable workspaces and harmless tool fixtures.

A report records requested/observed identities, installed version, API revision, source/profile hashes, timestamps, bounds and each observed capability.
Include model-not-found, denial, refusal, truncation, stream loss, tool replay, expiry and cancellation outcomes.
Some failures need fault-injected contract tests rather than live reproduction.
Label those evidence types separately.
Run no live calls as part of ordinary deterministic tests.
No live test is recorded as passed in this change.

## Closed controls and transport selection

ProviderControlsV1 contains exactly these fields:

- effort: none, low, medium, high, xhigh or max.
- thinking: mode provider-default, adaptive, enabled or disabled, with optional positive integer budgetTokens.
- sampling: optional finite temperature, topP and topK fields.
- toolChoice: auto, none, required or an object containing exactly name.
- execution: mode foreground or background, plus store as provider-default or a boolean.

Reject unknown keys at every depth and invalid per-profile ranges or combinations.
Report UnsupportedCapability with the exact field path before transport dispatch.
Explicit Foreman defaults use high effort except Sol medium.
Anthropic uses adaptive thinking. Other profiles use provider-default thinking.
Defaults use empty sampling, auto tools, foreground execution and provider-default storage.
These are hashed application defaults, not undocumented claims about vendor defaults.
Generation and read-only review resolve toolChoice to none.
Background mode and explicit store booleans require matching transport evidence.
Messages cannot inherit Responses background or storage parameters.
M2 previews and M5 request bindings retain the resolved controls unchanged.

TransportId is exactly xai-responses, anthropic-messages, openai-responses, google-interactions,
grok-acp, claude-code, codex-app-server or gemini-cli.
An explicit :transport selects one admitted pair.
Without a selector, the admitted profile mapping must resolve exactly one transport.
Zero or multiple candidates return ModelUnavailable or UnsupportedCapability before admission.
Never choose a transport from PATH order or provider availability.

Initial fm/task coding requires a native transport with enforceable workspace and permission boundaries.
The four API transports advertise codingTask as unsupported.
API review and generation retain their own supported capabilities.
Native review requires enforceable toolPolicy none.
ToolPolicyV1 is `{mode:"none"}` or `{mode:"native-coding",workspaceGrantId,permissionGrantIds,hostPermissionPortRef}`.
The native host permission port validates each requested grant.
This release adds no API file-tool catalog.

## Durable observation contract

M4 persists pel.tool.intent.v1, pel.tool.result.v1 and pel.provider.cursor.v1.
Tool deduplication uses effectId, full provider identity and callId.
After a crash, M4 supplies the recorded bounded payload and cursor.
The adapter resends the payload without executing the tool or resolving storage references.

RemoteObservationV1 is pending, completed, cancelled, not-found or unsupported.
Completed carries the exact identity, terminal cursor and bounded host-schema-validated result payload.
Not-found includes safe evidence and cannot establish that dispatch never occurred.
The reconcile capability has documented, fixture-tested and live-qualified evidence states.
observe reads only the existing provider identity and never replaces a request.
Later cancellation confirmation reaches M4 through a cancelled event or observe.
Unknown or unsupported observations remain unknown after M4's admitted observation window.

## Shared error and generation contract

ProviderFailure has exactly these tags:
ModelUnavailable, ModelMismatch, UnsupportedCapability, CapabilityUnverified, PromptChannelUnsupported,
AuthenticationRequired, ProbeUnknown, OutputInvalid, OutputIncomplete, MalformedEvent, ContinuationMismatch,
ResumeUnavailable, OutcomeUnknown, RateLimited and TransportDisconnected.
Only RateLimited and TransportDisconnected have retryClass transient.
Pass retry selectors as data keys: `[':rate-limited ':transport-disconnected]`.
A quote around the whole list is syntax, and an unquoted keyword list forms nil pairs. Both forms fail before the retry body.
All other tags have retryClass never and cannot appear in an allowed retry selector list.
Every ProviderFailure has required _tag, message and retryClass.
Optional fields are requestId, usage:ProviderUsageV1, fieldPath, providerIdentity:ProviderIdentityV1 and retryAfterMs.
M2 creates errors.ts and the minimum usage/identity types. M3 extends the same record without another declaration.
Refusal is a refused event. Deadline and local cancellation remain host outcomes.
M2 and M4 compile exhaustive switches over this same union.

GenerationRequest maps generationId and attempt to effectId `${generationId}/attempt/${attempt}`.
Resolve credentialProfileRef through the existing credential service and retain generationBudgetReservationRef.
Use the pinned trusted template, bounded artifacts, toolPolicy none and toolChoice none.
Grammar selection is auto, grammar-required or envelope.
Auto resolves once to qualified grammar or a structured envelope.
A required unavailable grammar returns UnsupportedCapability.
One generation port call creates at most one provider request.

## Evidence admission and test binding

Implement admitCell(profileId, transportId, requiredCapabilities, evidence, binding).
Product bindings require live-qualified evidence for each required execution capability and exact identity.
Native coding also requires live-qualified permission and workspace boundary evidence.
Evidence must match source/profile hashes, transport version, controls mode and freshness deadline.
Documented-only, fixture-only, expired and mismatched evidence return CapabilityUnverified.
Unused optional capabilities can remain unknown without blocking an otherwise admitted request.
Qualification uses a separate bounded qualification binding to gather observations.
It never labels a capability qualified before its observations exist.

Deterministic tests inject TestFixtureProviderLayer through M2's test-only launcher.
The binding kind is test-fixture and includes manifest hash and fake endpoint identities.
This layer admits only matching fixture evidence for required capabilities.
It cannot mint live-qualified evidence, publication authority or a product binding.
The product foreman.js bundle contains no fixture selector and rejects test-fixture bindings.
providers list labels fixture-backed cells test-fixture and never live-qualified.

## Command outcomes

Use the shared CLI classes: 0 success, 1 failed, 2 invalid input/admission, 3 needs-action, 4 cancelled and 5 pending.
The table maps typed outcomes at the single M2 router boundary. Transports do not select process exit codes.
These commands remain bounded and attached. None returns final exit 5 for an unresolved outcome.
M4 status/cancel observations retain their existing pending code.

| Command | 0 success | 1 failed | 2 invalid input/admission | 3 needs-action | 4 cancelled |
| --- | --- | --- | --- | --- | --- |
| `foreman providers list --json` | Valid registry view emitted, including unknown, unavailable and test-fixture rows | Registry read or output I/O fails | Invalid arguments or registry schema | Not used | Not used |
| `foreman providers qualify ...` | Every selected required capability has matching bounded observations | Completed qualification has a failed assertion, model refusal or invalid output | Invalid profile/transport/controls/limits, missing credential reference or qualification binding | Admitted work loses authentication, or its remote outcome remains unknown after the observation bound | Cancellation and required cleanup/remote outcome are confirmed |

Implement the provider rows in the shared router's pure commandExitCode(command, outcome) mapping.
A successful providers list exits 0 even when rows are unavailable or stale.
That result proves the view succeeded, not that execution admission passed.
Qualification uses the pre-admission versus admitted-work distinction from M4.
Unsupported or unknown remote cancellation after the observation window exits 3.
Confirmed cancellation requires the declared cleanup and remote observations before exit 4.
T-M3-026 covers every reachable provider table cell in packages/orchestration/src/pel-provider-cli.test.ts.
Add that exact target to test:providers alongside the provider package glob.

## Credential injection and deterministic qualification

Define CredentialPort in packages/providers/src/contract.ts.
Its resolve(credentialProfileRef) returns Effect<CredentialMaterialV1, ProviderFailure, Scope>.
Material contains Redacted header/environment values or an admitted native profile directory.
The scope releases credential leases after transport cleanup.
Only orchestration constructs the live port from its credential-profile services.
Provider package imports remain directed toward core, pure schema contracts, launcher and Effect.
Neither production source nor provider-package tests import orchestration.
CLI integration tests therefore live under packages/orchestration/src.

ProviderRequestV1 includes credentialProfileRef as an opaque reference.
ProviderIdentityV1 also retains that reference so observe and cancel resolve the same account.
start, resume and generation lowering preserve it. No reference implies permission to choose another account.
Request serialization, logs and fixtures contain no secret bytes.

T-M3-017 and T-M3-018 use the M2-owned fixture entry with a mandatory manifest.
They use packages/providers/src/fixtures/qualification/fixture-manifest.json as a template copied to a temporary directory.
The test fills its assetRoot and assetManifestSha256 for copied installed assets.
The command is `node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers <subcommand>`.
Fake credentials and protocol peers are injected. Every unexpected network or live credential access fails the test.
The production bundle is tested only for argument handling and fixture-binding rejection in ordinary tests.
Move these CLI tests to pel-provider-qualification.test.ts and pel-provider-list.test.ts in orchestration/src.
Add their exact paths to test:providers alongside pel-provider-cli.test.ts and the provider source test glob.
Real qualification remains a separately invoked product command outside npm test.

ProviderControlsV1 decoding distinguishes invalid syntax from unsupported valid enum values.
The undeclared effort minimal and unknown keys return UnsupportedCapability with stage decode and their exact fieldPath.
Valid enum values rejected by a profile return UnsupportedCapability with stage profile-validation.
Encode this stage in the safe diagnostic message, without adding a second failure record shape.
Test every effort outside each profile's allowed set: Grok none/max, Opus none, Fable none, Astra none, Gemini none/xhigh/max.
Sol accepts every declared effort. Gemini minimal is a separate decode rejection.

## Provider output schema and canonical decoding

ProviderRequestV1.outputSchema is `{id:string,content:PelDataSchemaV1}`.
Its content must hash to the immutable schema registry entry selected by id.
Providers imports the pure schema type and validator from @foreman/pel.
The dependency is one-way: Pel never imports providers or orchestration.
M2 checker inputs carry structural immutable profile facts. Orchestration performs provider-specific lowering.

Implement lowerProviderSchema in packages/providers/src/output.ts.
It returns the provider JSON Schema, original Pel schema digest and a wire codec identifier.
Association fields lower to JSON object properties and required keys, with additionalProperties false.
Pairs lower to a single-property object. Lists lower to bounded JSON arrays.
Strings and keys lower to bounded strings with unchanged enum values. Booleans and nil lower to boolean and null.
Numbers lower to integer or number with the original finite bounds.
Union alternatives retain declared order and use only the selected endpoint's documented schema mechanisms.
A top-level non-object schema uses an exact one-field `{value:...}` wire envelope.
Generation uses the association schema `{pelSource:string}` with the M2 byte bound.
The Boolean predicate uses schema:pel-boolean-v1 and the wire envelope `{value:boolean}`.
Initial provider output does not accept the arbitrary data schema. Return UnsupportedCapability before dispatch for that schema.

Validate the lowering against the exact profile/endpoint subset.
Reject unsupported required structure with UnsupportedCapability rather than silently deleting required fields or changing enums.
Provider-native limits may omit an unsupported non-structural restriction only when the capability profile explicitly records that weakening.
The original host validator still enforces every such restriction after decoding.
For example, a provider's character limit cannot substitute for the host's UTF-8 maxBytes bound.

Parse raw final JSON with duplicate-key detection before constructing ordinary JavaScript objects.
Reject duplicate, missing required and unknown fields with OutputInvalid and their fieldPath.
Decode an object to a Pel association in schema.fields order, independent of JSON property order.
Use exact schema key names as Pel keywords without case conversion.
Decode pair objects using their one declared key, arrays as ordered Pel lists and null as nil.
Decode key-schema strings as Pel key values. Ordinary string-schema values remain strings.
For integer schemas require Number.isSafeInteger plus the declared bounds.
Other numbers must be finite and within their declared bounds. Numeric strings never become numbers.
Apply union variants in declared order and accept the first fully valid decoded value.
Unwrap the exact value envelope before validating a non-object root.
Run the original PelDataSchemaV1 validator after this deterministic conversion and before returning a completed result.
Reversed JSON property order therefore produces identical canonical Pel bytes.

T-M3-009 covers reversed properties, duplicate/unknown keys, null, numeric bounds, union order and provider-subset rejection.
It also round-trips the generation pelSource association and Boolean value envelope.
A malformed envelope never reaches Pel execution or changes a host result schema.

M2 owns scripts/build-pel-test-fixture.ts and the test:pel-fixture-build npm script.
pretest:providers invokes that script before provider CLI tests, including on a clean checkout.
The build uses the non-test invocation entry and prepares manifest-bound assets without enabling live credentials.
