# Exact model profiles and shared provider adapters

All scenarios are planned tests. This change records no runtime qualification or measured release completion.

## ADDED Requirements

### Requirement: R-M3-001 Six exact profile identities

The Foreman provider registry SHALL define the six exact model profiles and four provider families listed in the design.

#### Scenario: T-M3-001 Six exact profile identities

- WHEN the following fixture is prepared: Six-profile registry fixture and an unrecognized model alias.
- AND the test performs: resolveProfile for every declared ID and the alias.
- THEN Exactly six profiles map to xai, anthropic, openai or google. The alias returns ModelUnavailable without dispatch.

### Requirement: R-M3-002 Model-specific reasoning validation

If requested reasoning controls violate a model profile, then the Foreman provider adapter SHALL return UnsupportedCapability before transport dispatch.

#### Scenario: T-M3-002 Model-specific reasoning validation

- WHEN the following fixture is prepared: Each declared effort outside the profile allowed set: Grok none/max, Opus none, Fable none, Astra none, Gemini none/xhigh/max. Sol accepts all declared efforts. Gemini minimal is an invalid enum decode case. Add prior thinking/sampling/tool-choice restrictions and nested unknown keys.
- AND the test performs: validateRequest for each invalid request and valid adjacent controls.
- THEN Each rejected field returns UnsupportedCapability with exact fieldPath and zero dispatch. Minimal/unknown fields report decode stage in the safe message; valid-enum profile rejections report profile-validation. Defaults and explicit valid controls stay unchanged.

### Requirement: R-M3-003 Source-bound capability resolution

When a provider request resolves, the Foreman provider registry SHALL bind its profile hash, transport version, source manifest hash and capability evidence.

#### Scenario: T-M3-003 Source-bound capability resolution

- WHEN the following fixture is prepared: A sourced profile with supported, unsupported, unknown and verified capability fields.
- AND the test performs: resolveRequest for an explicit model and transport.
- THEN Resolved request retains all evidence identities and unknown fields. Unverified required capabilities return CapabilityUnverified.

### Requirement: R-M3-004 Separate API and native identities

The Foreman provider adapter SHALL keep API request identities separate from native coding session identities.

#### Scenario: T-M3-004 Separate API and native identities

- WHEN the following fixture is prepared: All four API and four native transport fixtures, including an equal textual response ID and session ID.
- AND the test performs: encodeRequest and decodeIdentity for each fixture.
- THEN Discriminated identities retain provider, exact model, transport and API revision or CLI version. Equal strings do not compare as equal identities.

### Requirement: R-M3-005 Exact prompt channel bytes

When a native transport receives a prompt, the Foreman provider adapter SHALL deliver its exact bytes through a declared prompt channel.

#### Scenario: T-M3-005 Exact prompt channel bytes

- WHEN the following fixture is prepared: UTF-8 prompt containing newlines, quotes, dollar signs and 128 KiB content. Fixtures declare stdin, file or protocol input.
- AND the test performs: start each native fake process or protocol peer and capture delivered bytes.
- THEN Prompt hashes match for each channel. Stdin bytes reach the launcher. An unsupported channel returns PromptChannelUnsupported before spawn.

### Requirement: R-M3-006 No weaker transport fallback

If a transport lacks a requested capability, then the Foreman provider adapter SHALL reject dispatch without changing model, permissions or output behavior.

#### Scenario: T-M3-006 No weaker transport fallback

- WHEN the following fixture is prepared: Native fixture lacks permission round trips or schema output. API fixture lacks grammar support.
- AND the test performs: start with each required capability and inspect captured process/API calls.
- THEN UnsupportedCapability reports the missing field and zero dispatches. No headless, weaker schema or alternate model fallback occurs.

### Requirement: R-M3-007 Semantic stream events

When a provider event arrives, the Foreman provider adapter SHALL emit a normalized event with its provider identity and original semantic status.

#### Scenario: T-M3-007 Semantic stream events

- WHEN the following fixture is prepared: Per-transport started, text, tool, usage, checkpoint, completion, refusal, truncation, malformed and duplicate event fixtures.
- AND the test performs: decodeEvents with fragmented byte chunks and repeated cursors.
- THEN Events use the shared vocabulary. Refusal remains refused, truncation becomes failed/OutputIncomplete, and duplicates retain deduplication identity without another tool dispatch.

### Requirement: R-M3-008 Authorized tool/result correlation

When a provider requests a tool, the Foreman provider adapter SHALL preserve its call identifier and submit the bounded host-resolved result payload.

#### Scenario: T-M3-008 Authorized tool/result correlation

- WHEN the following fixture is prepared: Host journal fixtures pel.tool.intent.v1/result.v1 and provider.cursor.v1 keyed by effectId, full identity and callId; two calls, denied/invalid calls and crash after result append.
- AND the test performs: Decode tool requests, persist bounded result payload, crash, load recorded cursor and resend ToolResultV1 content through sendToolResult.
- THEN One committed tool effect occurs. The recorded payload is resent with its exact callId/content hash. Invalid and denied calls perform zero effects. Adapter storage I/O count is zero.

### Requirement: R-M3-009 Original host output schema

If final output violates the host schema, then the Foreman provider adapter SHALL return OutputInvalid without producing a completed result.

#### Scenario: T-M3-009 Original host output schema

- WHEN the following fixture is prepared: OutputSchemaV1 with immutable id and PelDataSchemaV1 content, reversed JSON field order, duplicate/unknown keys, missing required fields, null, numeric bounds and union variants. Include pelSource association and Boolean value envelope.
- AND the test performs: lowerProviderSchema for each profile subset, parse duplicate-aware raw JSON, decode in schema field order and validate against original Pel schema.
- THEN Reversed JSON keys yield identical canonical association order and pass. Duplicate/unknown keys and invalid numbers fail OutputInvalid with fieldPath. Null becomes nil. Generation and Boolean envelopes round-trip. Unsupported required schema structure fails before dispatch.

### Requirement: R-M3-010 Opaque continuation binding

When a continuation is emitted or resumed, the Foreman provider adapter SHALL preserve opaque reasoning bytes and their originating model, transport and prefix binding.

#### Scenario: T-M3-010 Opaque continuation binding

- WHEN the following fixture is prepared: OpenAI reasoning items, xAI encrypted thinking, Fable thinking blocks and Gemini Interactions thought steps with exact byte hashes.
- AND the test performs: encodeContinuation then resume with matching and changed model, transport and prefix.
- THEN Matching round trips preserve hashes and tool IDs. Changed bindings return ContinuationMismatch. No opaque reasoning appears in text events or research exports. Opaque checkpoints emit bounded bytes/cursor to M4 and perform zero direct storage I/O.

### Requirement: R-M3-011 Observed cancellation outcomes

When cancellation is requested, the Foreman provider adapter SHALL report request, acknowledgement, local cleanup and observed remote outcome separately.

#### Scenario: T-M3-011 Observed cancellation outcomes

- WHEN the following fixture is prepared: OpenAI and Gemini asynchronous cancellation, xAI unverified remote cancellation, Claude SIGTERM versus interrupt, and a native process tree.
- AND the test performs: cancel under Effect scope with a fake clock, then observe terminal events.
- THEN Local children exit within the configured cleanup bound. Remote outcome remains pending, unknown or unsupported until observed. No local signal fabricates remote cancelled.

### Requirement: R-M3-012 Unavailable and uncertain resume

If continuation retention expired or remote outcome is unknown, then the Foreman provider adapter SHALL return ResumeUnavailable or OutcomeUnknown without automatic redispatch.

#### Scenario: T-M3-012 Unavailable and uncertain resume

- WHEN the following fixture is prepared: Expired API ID, interrupted stream before receipt, Gemini in_progress interaction, and missing native session.
- AND the test performs: Observe existing identities, then resume only supported pending streams with their journal cursors.
- THEN Expired state returns ResumeUnavailable. Completed observation carries validated result and terminal cursor. Not-found and unsupported remain OutcomeUnknown to the host. In-progress Google work is observed before chaining. New dispatch count is zero.

### Requirement: R-M3-013 Independent readiness facts

When readiness is inspected, the Foreman provider adapter SHALL report discovery, authentication, currency, model identity and capabilities as separate evidence-bearing facts.

#### Scenario: T-M3-013 Independent readiness facts

- WHEN the following fixture is prepared: Installed old CLI, authenticated account, unavailable exact model and unknown permission capability.
- AND the test performs: probe using read-only fake commands and metadata endpoints.
- THEN Each fact has independent value, evidence kind, observation time and safe diagnostic. No update, login or model workload runs in a metadata-only probe.

### Requirement: R-M3-014 Unknown authentication diagnosis

If an authentication probe times out or cannot parse its response, then the Foreman provider adapter SHALL report unknown without a login instruction.

#### Scenario: T-M3-014 Unknown authentication diagnosis

- WHEN the following fixture is prepared: Timeout, network failure, changed banner, explicit signed-out response and explicit signed-in response.
- AND the test performs: probe and render diagnostic for each fixture.
- THEN Uncertain responses report unknown. Only explicit signed-out evidence reports not-authenticated and login remediation. Secrets are absent from diagnostics.

### Requirement: R-M3-015 Observed exact model identity

When observed model identity differs from the requested profile, the Foreman provider adapter SHALL return ModelMismatch and retain both identities.

#### Scenario: T-M3-015 Observed exact model identity

- WHEN the following fixture is prepared: A native CLI routes gpt-6-astra to another model, or provides no trustworthy identity metadata.
- AND the test performs: qualifyIdentity using protocol metadata rather than generated answer text.
- THEN Mismatch returns ModelMismatch. Missing metadata remains unknown and unusable for exact-model qualification. No self-reported answer establishes identity.

### Requirement: R-M3-016 Complete contract fixture matrix

The Foreman provider contract suite SHALL exercise each advertised model and transport combination with provider-specific positive and negative fixtures.

#### Scenario: T-M3-016 Complete contract fixture matrix

- WHEN the following fixture is prepared: Six profiles on each family API/native protocol, with codingTask unsupported on APIs and explicit negative fixtures for unsupported cells.
- AND the test performs: npm run test:providers after wiring the planned script to scripts/run-tests.ts.
- THEN Fixture report covers every declared cell, chunk boundaries, limits, tools, refusal, malformed output, continuity and cancellation. Unsupported cells have negative tests. Typechecking and dependency lint assert no providers-to-orchestration or Pel-to-providers import. CLI tests reside in orchestration.

### Requirement: R-M3-017 Bounded live qualification

When an authorized live qualification runs, the Foreman provider adapter SHALL enforce its explicit account, model, transport, time and spend bounds.

#### Scenario: T-M3-017 Bounded live qualification

- WHEN the following fixture is prepared: M2 fixture manifest template packages/providers/src/fixtures/qualification/fixture-manifest.json copied to temporary storage with assetRoot/assetManifestSha256, fake credential port, protocol peers and qualification bounds. No live account is selected.
- AND the test performs: node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers qualify --profile <exact-id> --transport <id> --limits qualification.json
- THEN Report records observed identity, versions, source/profile hashes, requested and observed lifecycle outcomes, usage and failures. Cap exhaustion stops the cell without widening limits. Successful qualification exits 0. Invalid selected account/profile/controls/limits exits 2. A completed failed capability check exits 1. Admitted remote uncertainty exits 3. Confirmed cancellation exits 4. Every credential access uses the injected fake port. Any network or live-account access fails the deterministic test. Real qualification is outside npm test.

### Requirement: R-M3-018 Truthful support evidence

When provider support is displayed, the Foreman provider registry SHALL distinguish documented capabilities from fixture-tested and live-qualified capabilities.

#### Scenario: T-M3-018 Truthful support evidence

- WHEN the following fixture is prepared: Documented-only, fixture-only, current live-qualified, expired and changed-version evidence records.
- AND the test performs: node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers list --json, then admitCell through injected services
- THEN Only exact current live evidence labels a product capability live-qualified. Documented-only, fixture-only, expired and mismatched evidence fail product admission. Test-layer cells display test-fixture, never live-qualified. Successful listing exits 0 even when it displays unavailable or stale cells. Invalid registry schema exits 2 and registry read/output failure exits 1.

### Requirement: R-M3-019 Bounded Pel generation port

When Pel generation is requested, the Foreman provider adapter SHALL perform one exact-profile generation attempt using the selected grammar capability or structured envelope.

#### Scenario: T-M3-019 Bounded Pel generation port

- WHEN the following fixture is prepared: M2 GenerationRequest with generationId, attempt, credentialProfileRef, generationBudgetReservationRef, exact modelProfileId/transportId/controls, grammar selection, pinned prompt template, catalog and bounded artifacts.
- AND the test performs: ProviderGenerationPort.generate with supported grammar, envelope-only, invalid envelope and 1 MiB overflow fixtures.
- THEN One request per call uses effectId generationId/attempt/attempt-index, original reservation, toolPolicy/toolChoice none and validated envelope. No adapter repair/execution occurs. Unsupported grammar fails explicitly. ProviderRequestV1 includes opaque credentialProfileRef and outputSchema {id,content}; no secret bytes or execution-ledger call occurs.

### Requirement: R-M3-020 Usage accounting and admitted limits

When usage or a request limit is observed, the Foreman provider adapter SHALL preserve accounting dimensions and enforce the stricter admitted limit.

#### Scenario: T-M3-020 Usage accounting and admitted limits

- WHEN the following fixture is prepared: Each profile has cache-read/write counters, dated pricing metadata, long-context thresholds and missing cost fields. Requests exhaust tokens, time and tool bounds.
- AND the test performs: Normalize usage and run each bounded stream under a fake clock and recording host reservation port.
- THEN Observed counters and price identity survive normalization. Unknown cost remains unknown with conservative reservation. Limits stop the stream without widening budget or silently retrying.

### Requirement: R-M3-021 controls contract

When provider controls resolve, the Foreman provider adapter SHALL validate closed typed controls and preserve the exact admitted defaults or explicit values.

#### Scenario: T-M3-021 controls contract

- WHEN the following fixture is prepared: Every profile with omitted controls and explicit overrides, invalid nested keys, and unsupported background/store settings.
- AND the test performs: resolveControls then encodeRequest and inspect preview/request bindings.
- THEN Resolved controls contain all five closed fields. Defaults match design.md. Invalid combinations fail before dispatch and controls cannot silently change.

### Requirement: R-M3-022 observation contract

When remote work is observed, the Foreman provider adapter SHALL return a typed observation for the existing identity without redispatch.

#### Scenario: T-M3-022 observation contract

- WHEN the following fixture is prepared: OpenAI background completion, pending Google interaction, cancelled native turn, missing identity and unsupported xAI reconcile fixtures.
- AND the test performs: observe(identity), then deliver resulting events to a recording host.
- THEN Results are pending, completed with validated payload, cancelled, not-found or unsupported. Late cancellation can be observed. No start call occurs.

### Requirement: R-M3-023 admission contract

When a product request is admitted, the Foreman provider registry SHALL require current live evidence for every required capability.

#### Scenario: T-M3-023 admission contract

- WHEN the following fixture is prepared: Required identity/tool/schema/cancellation capability set with documented-only, fixture-only, matching live, expired live and test-fixture evidence.
- AND the test performs: admitCell under product and TestFixtureProviderLayer bindings.
- THEN Product admission accepts only matching current live evidence. Explicit test bindings may accept matching fixtures but never emit live-qualified evidence or product authority.

### Requirement: R-M3-024 transport-selection contract

When a task transport resolves, the Foreman provider registry SHALL select one admitted transport and require native coding capability for file-writing tasks.

#### Scenario: T-M3-024 transport-selection contract

- WHEN the following fixture is prepared: Eight canonical transport IDs, one profile with two allowed mappings, an explicit selector, API coding request and native review lacking tool denial.
- AND the test performs: resolveTransport and validate ToolPolicyV1 before task/review dispatch.
- THEN Unselected ambiguous mapping fails. Explicit mapping stays exact. API coding and unenforceable native review fail without fallback. Native coding carries workspace and permission grants.

### Requirement: R-M3-025 errors contract

The Foreman provider contract SHALL expose one exhaustive failure union with a fixed retry classification for every tag.

#### Scenario: T-M3-025 errors contract

- WHEN the following fixture is prepared: M2 generation and provider retry consumers compile against one ProviderFailure record: required _tag/message/retryClass and optional requestId/usage/fieldPath/providerIdentity/retryAfterMs. Retry arguments include quoted data keys, quoted whole-list syntax and unquoted nil-pair lists.
- AND the test performs: Compile shared error-record fixtures, exhaustively classify tags and decode :on [':rate-limited ':transport-disconnected].
- THEN Only RateLimited and TransportDisconnected are transient. Quoted key values decode correctly; whole-list syntax and nil-pair lists fail before retry-body evaluation. M2 alone creates errors.ts, all consumers use the same optional fields.

### Requirement: R-M3-026 Exact subcommand exit codes

When a provider subcommand terminates, the Foreman CLI SHALL return the exit code assigned to its command outcome in the shared command table.

#### Scenario: T-M3-026 Exact subcommand exit codes

- WHEN the following fixture is prepared: Table-driven provider list and qualification cases from design.md Command outcomes, with recorded services, invalid inputs, failed assertions, remote uncertainty and confirmed cancellation.
- AND the test performs: node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers <list-or-qualify> with injected recorded services for every outcome
- THEN List with unavailable rows exits 0. Invalid input exits 2, failed qualification 1, uncertain admitted remote work 3 and confirmed cancellation 4. No final pending 5 or fabricated live evidence appears.

### Requirement: R-M3-027 credentials contract

The Foreman provider package SHALL resolve opaque credential references through an injected port without importing orchestration.

#### Scenario: T-M3-027 credentials contract

- WHEN the following fixture is prepared: Fake CredentialPort with scoped redacted material and exact credentialProfileRef on start/resume/observe identities.
- AND the test performs: Run credential-port fixtures, source dependency lint and npm run typecheck.
- THEN All requests use the selected reference without secret serialization. Credential scopes release leases. Providers never imports orchestration and Pel never imports providers.

### Requirement: R-M3-028 output-codec contract

When provider JSON is decoded, the Foreman provider adapter SHALL construct schema-ordered Pel values before validating the original output schema.

#### Scenario: T-M3-028 output-codec contract

- WHEN the following fixture is prepared: Immutable schema ID/content pairs, provider subset fixtures and reordered/duplicate/malformed output envelopes.
- AND the test performs: lowerProviderSchema then decodeProviderOutput and validateFinal.
- THEN Canonical schema order is stable across JSON key order. Invalid keys/types/bounds fail with field paths. Unsupported required schema structure performs zero dispatch.

