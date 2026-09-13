# M3: Exact provider adapters

M3 extends the M2 provider package with six exact model profiles and eight transports. The product uses one `foreman.js` router. M4 owns execution, durable tool receipts, scheduling, and workspace authority.

## Delivered features

| Feature | Result |
| --- | --- |
| F-M3-01 | Exact model IDs, source hashes, immutable controls, and per-capability evidence admission. No model or transport fallback. |
| F-M3-02 | Four direct API transports and four native transports. Native processes use the existing scoped launcher with byte-preserving stdin, explicit cwd, and an explicit environment. |
| F-M3-03 | Shared events, host-bound tool results, original-schema validation, and bounded accounting. Hidden provider state stays opaque. |
| F-M3-04 | Separate local cleanup, cancellation acknowledgement, and remote outcome. Supported API observation uses existing IDs. Uncertain native recovery cannot start a replacement turn. |
| F-M3-05 | Separate discovery, authentication, source currency, observed identity, and capability facts. Metadata probes do not launch a model workload. |
| F-M3-06 | Read-only provider listing, bounded qualification, compiled fixtures for all twelve profile/transport cells, and live-evidence admission for M2 generation. |

The [EARS coverage matrix](m3-ears-coverage.md) maps all 28 requirements to executable acceptance tests. Additional protocol sources are stored in the [M3 capture manifest](../../research/pel-release/sources/m3/manifest.json). The [Codex protocol manifest](../../research/pel-release/sources/m3/codex-protocol-manifest.json) binds the installed CLI's generated TypeScript definitions and their portable archive. The original profile-source manifest remains immutable.

The real authoring command used qualified Opus evidence to generate `42` in one attempt. The host check and preview reported the expected value, no effects, and no diagnostics. See the [live records](m3-live-qualification.md) and [independent implementation review](m3-audit.md).

## Product commands

```text
foreman providers list --json
foreman providers qualify --profile EXACT_ID --transport TRANSPORT_ID --credential-profile ACCOUNT_REF --limits limits.json --binding binding.json --controls controls.json --json
foreman plan --prompt TEXT --model EXACT_ID --transport TRANSPORT_ID --credential-profile ACCOUNT_REF --context snapshot.json --json
```

Qualification requires an explicit current binding with `kind: qualification`, `evidenceRef`, `expiresAt`, and `requiredCapabilities`. Limits contain an absolute millisecond deadline, input/output token bounds, a tool-call bound, an output-byte bound, a USD ceiling, and `spendReservationRef`. The hard maximum is 180 seconds, 30,000 combined tokens, two host tool calls, and USD 5. Smaller selected limits win. Unknown cost remains unknown and retains its conservative reservation.

The live command supplies a harmless generation/schema fixture. It qualifies `toolPolicyNone` only when the protocol reports an empty or reply-formatter-only tool catalog and then completes without a host tool request. Capabilities that need workspace effects, review ground truth, or a separate lifecycle assertion require the corresponding host qualification fixture. A valid JSON response alone does not establish coding, review, cancellation, or host verification.

API account references are `env:XAI_API_KEY`, `env:ANTHROPIC_API_KEY`, `env:OPENAI_API_KEY`, and `env:GEMINI_API_KEY`. Native default references are `native:grok:default`, `native:claude:default`, `native:codex:default`, and `native:gemini:default`. Existing isolated Grok and Codex accounts use `profile:VENDOR:PROFILE_ID`. Only the selected account can provide credential material. Provider packages cannot import the orchestration credential service.

Readiness reuses the existing preflight readers. Stored facts must match the current executable, version, probe command, and version floor within a fifteen-minute window. Authentication also requires the existing credential-profile identity wrapper. Legacy records without account identity cannot establish authentication. These observations do not establish model identity, provider-source identity, or a live capability. Workload qualification remains an explicit bounded operation.

`FOREMAN_PROVIDER_EVIDENCE` selects an absolute, bounded JSON evidence file. The default is `~/.foreman/providers/evidence.json`. Its closed shape is `{schemaVersion:1,evidence:[...]}`. The list command succeeds with documented cells when the default file is absent. Native records remain stale in this read-only view until current native metadata is supplied; the view does not launch a CLI. API rows use the current default no-tool controls and exact API revision.

Generation requires matching live evidence for every required capability. Source/profile hashes, account, controls, transport implementation version, endpoint or protocol revision, and expiry must match. Fixture evidence cannot admit product work. `FOREMAN_PROVIDER_MAX_COST_USD` sets an operation ceiling between zero and USD 5, exclusive of zero. The service divides that allowance across M2's existing maximum attempts. It does not convert abstract cost units to USD or create another repair loop.

## Protocol boundaries

- xAI Responses preserves its encrypted state. Unverified remote cancellation and cursor replay stay unavailable.
- Anthropic Messages preserves opaque thinking blocks and the originating prefix. Claude Code's exact `StructuredOutput` formatter carries the reply; it does not authorize a host tool. Primary assistant identity remains exact. Auxiliary CLI accounting is included in totals without treating an internal accounting entry as primary-model rerouting.
- OpenAI Responses reconnects through the original response ID and supported cursor. Codex app-server checks its thread/model handshake before one turn starts. Model rerouting fails. Native tool usage counts include operations that do not request an approval.
- Google Interactions observes existing interaction state. Gemini CLI uses an explicit deny-all policy and immutable configuration. A local process exit does not prove remote cancellation.

Native coding requires actual host-enforced workspace and permission grants. A permission flag or a generated instruction is not a grant. The default standalone generation host does not admit Codex or Grok as no-tool transports. In the live Grok check, ACP did not enforce the global CLI no-tool flags. Subsequent standalone no-tool requests are rejected before dispatch. M4 must supply an enforceable host boundary for native coding.

## Validation and remaining release work

The full workspace run passed 2,812 tests and skipped seven. Three pre-existing failures remain: two v0.5 release-inventory checks and the default-bound secret scan. M6 owns their release migration. Focused provider verification and final artifact hashes are recorded separately in `m3-verification.json`.

The [live qualification matrix](m3-live-qualification.md) records every declared cell. Opus 5 passed native generation, structured output, and observed no-tools qualification at the recorded low-effort controls. Its reported total was USD 0.013402, including auxiliary CLI accounting. This evidence does not qualify native coding or other controls.

Live qualification records distinguish exact observed identity from usable capability evidence. Missing credentials, quota errors, unsupported native boundaries, and uncertain outcomes do not become successful qualifications. M4–M6 and final release qualification remain open.
