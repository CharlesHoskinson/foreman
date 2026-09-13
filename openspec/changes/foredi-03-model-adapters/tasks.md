# M3 implementation tasks

M3 implementation and deterministic acceptance tests are complete.
The catalog maps each requirement to an executable test.
Live capability evidence is limited to the exact successful cells in docs/releases/return-of-the-foredi/m3-live-qualification.md. M4 owns the durable host implementation behind the M3 tool ports; final release qualification remains open.
Run tests with Node.js 24 and strict TypeScript.

## 1. F-M3-01 exact profiles

- [x] Extend M2's existing provider package manifests and `src/contract.ts`.
- [x] Extend M2's existing `src/errors.ts` and create `src/index.ts`.
- [x] Define ProviderRequestV1, ProviderEventV1 and ProviderTransport against the M1 contract.
- [x] Create `src/profiles.ts` with six exact IDs and four provider families.
- [x] Add source hashes, native controls, limits and explicit capability evidence states.
- [x] Implement `src/registry.ts` without model aliases or silent fallback.
- [x] Implement T-M3-001 through T-M3-003 in `profiles.test.ts` and `registry.test.ts`.
- [x] Assert invalid reasoning controls produce zero transport calls.

## 2. F-M3-02 API and native transports

- [x] Implement the eight explicit transport files listed in `design.md`.
- [x] Consume injected CredentialPort and reuse `packages/launcher/src/supervise.ts` without importing orchestration.
- [x] Add typed stdin input to the launcher contract where required.
- [x] Preserve exact prompt bytes, cwd, environment, exit status and protocol identities.
- [x] Add explicit permission and prompt-channel capabilities for each installed CLI protocol.
- [x] Implement T-M3-004 through T-M3-006 with fake endpoints and native protocol peers.
- [x] Implement the M2 ProviderGenerationPort mapping in `src/generation.ts` and T-M3-019 in `generation.test.ts`.
- [x] Assert unsupported capabilities fail before spawning or sending a request.

## 3. F-M3-03 semantic results

- [x] Implement `src/{events,tools,output}.ts`.
- [x] Preserve tool IDs and provider cursor identities across fragmented streams.
- [x] Route all tool execution and deduplication through the M4 host journal port.
- [x] Preserve refusal, malformed output and truncation as distinct outcomes.
- [x] Validate lowered structured output against the original host schema.
- [x] Implement T-M3-007 through T-M3-009.
- [x] Implement T-M3-020 in `usage.test.ts` for dated accounting dimensions, unknown costs and admitted limit exhaustion.
- [x] Assert a provider completion cannot manufacture host verification evidence.

## 4. F-M3-04 lifecycle

- [x] Implement `src/continuation.ts` with byte hashes and originating-prefix bindings.
- [x] Implement scoped cancellation and continuation in each transport.
- [x] Record local cleanup separately from provider acknowledgement and remote outcome.
- [x] Return typed unknown or unavailable results for uncertain completion and expired state.
- [x] Implement T-M3-010 through T-M3-012.
- [x] Assert changed model, transport or Fable prefix cannot reuse opaque state.
- [x] Assert uncertain resume performs zero new model dispatches.

## 5. F-M3-05 readiness

- [x] Implement `src/readiness.ts` using existing vendor-preflight and credential-profile evidence.
- [x] Keep discovery, authentication, currency, identity and capabilities independent.
- [x] Add explicit metadata-only and bounded-workload probe modes.
- [x] Redact secrets and preserve safe remediation details.
- [x] Implement T-M3-013 through T-M3-015.
- [x] Assert timeouts report unknown and never instruct login without signed-out evidence.

## 6. F-M3-06 qualification

- [x] Implement `src/qualification.ts` with version-bound evidence and explicit expiry.
- [x] Add `foreman providers list --json` and `foreman providers qualify` to the existing CLI.
- [x] Add deterministic contract fixtures for every declared profile/transport cell.
- [x] Implement T-M3-016 through T-M3-018, including the fake live-qualification harness.
- [x] Add provider test globs to root `npm test` and the planned `test:providers` script.
- [x] Extend workspace typechecking and `scripts/build-runtime.ts` for provider exports.
- [x] Run `npm run typecheck` and `npm run test:providers`.
- [x] Assert every declared cell has positive fixtures or an explicit unsupported result.
- [x] Run `npm run build` and `npm run verify-runtime`.
- [x] Run bounded live qualification for each claimed cell after selecting its authorized account and exact transport.
- [x] Record unqualified or inaccessible cells explicitly without substituting another model.
- [x] Assert support output distinguishes documented, fixture-tested and live-qualified evidence.

## 7. Complete shared interfaces and revised fixtures

- [x] Implement closed ProviderControlsV1 decoding and exact defaults in controls.ts.
- [x] Implement T-M3-021 with nested unknown-key and unsupported execution-mode fixtures.
- [x] Add bounded host-resolved content to ToolResultV1 and extend T-M3-008 crash replay assertions.
- [x] Emit opaque checkpoints and cursors to M4 without adapter storage I/O.
- [x] Add observe and RemoteObservationV1 with capability-bound reconciliation in every transport.
- [x] Implement T-M3-022 and extend T-M3-012 for completed, not-found and unsupported observations.
- [x] Implement admitCell in registry.ts and T-M3-023 for per-capability product evidence admission.
- [x] Add TestFixtureProviderLayer through M2's test launcher without product fixture selectors.
- [x] Assert fixture evidence is never labeled live-qualified in T-M3-018 and T-M3-023.
- [x] Enumerate the eight TransportId literals and native-only coding capability.
- [x] Implement T-M3-024 for ambiguity, explicit selection and ToolPolicyV1 enforcement.
- [x] Share the complete ProviderFailure union with M2/M4 and implement T-M3-025 exhaustive checks.
- [x] Add providers subcommands only through M2's pel-authoring-cli.ts and pel-authoring-main.ts.
- [x] Assert one foreman.js router entry and invoke that product bundle in T-M3-018.

## 8. Command outcome codes

- [x] Implement the shared M2 router commandExitCode mapping with the provider rows in design.md.
- [x] Implement T-M3-026 in packages/orchestration/src/pel-provider-cli.test.ts.
- [x] Strengthen the existing catalog assertions for exact success, failure, invalid, needs-action and cancellation codes.
- [x] Add the exact command test target to test:providers and retain root test discovery.
- [x] Assert bounded attached commands never use final exit 5 to conceal an unresolved outcome.

## 9. Final shared boundaries

- [x] Extend M2's errors.ts with the agreed _tag/message/retryClass and optional requestId/usage/fieldPath/providerIdentity/retryAfterMs fields.
- [x] Add CredentialPort and opaque credentialProfileRef to request and identity contracts.
- [x] Implement T-M3-027 for scoped credential injection and acyclic package imports.
- [x] Keep provider-to-Pel schema imports one-way and reject provider-to-orchestration imports in dependency lint.
- [x] Move qualification/list CLI tests into the named orchestration test files.
- [x] Use M2's fixture launcher with mandatory manifest for deterministic provider tests.
- [x] Make unexpected network or live credential access fail test:providers.
- [x] Keep real qualification outside npm test as an explicitly invoked product command.
- [x] Extend T-M3-025 for quoted retry data keys and rejection of syntax/nil-pair lists.
- [x] Extend T-M3-002 for all disallowed in-enum efforts and separate minimal decode rejection.
- [x] Implement OutputSchemaV1 lowering, duplicate-aware JSON parsing and canonical Pel decoding in output.ts.
- [x] Implement T-M3-028 and extend T-M3-009 for schema order, envelopes, bounds and unsupported subsets.
- [x] Add pretest:providers invoking M2's test:pel-fixture-build before the provider CLI acceptance tests.

## 10. API no-tool request evidence

- [x] Report `observedToolPolicy: none` on API `started` only after a validated empty or omitted serialized tool surface and an exact established response identity.
- [x] Reject function, tool and server-tool activity and fail closed on unrecognized action-bearing output in both the streaming and complete-response decoders.
- [x] Distinguish the API request-enforcement assertion reason from the native empty-catalog observation without weakening either.
- [x] Implement T-M3-029 in packages/providers/src/transports/api-transports.test.ts and the qualification assessment cases in packages/orchestration/src/pel-provider-live.test.ts.
- [x] Keep no-tool evidence out of reach for a request flag alone, cursor replay, refusal, incomplete output, identity mismatch, unknown outcome and tool activity.
