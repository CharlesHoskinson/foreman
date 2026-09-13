# M3 implementation tasks

All implementation and runtime tests below are planned.
The catalog maps each requirement to a concrete test.
Run tests with Node.js 24 and strict TypeScript.

## 1. F-M3-01 exact profiles

- [ ] Extend M2's existing provider package manifests and `src/contract.ts`.
- [ ] Extend M2's existing `src/errors.ts` and create `src/index.ts`.
- [ ] Define ProviderRequestV1, ProviderEventV1 and ProviderTransport against the M1 contract.
- [ ] Create `src/profiles.ts` with six exact IDs and four provider families.
- [ ] Add source hashes, native controls, limits and explicit capability evidence states.
- [ ] Implement `src/registry.ts` without model aliases or silent fallback.
- [ ] Implement T-M3-001 through T-M3-003 in `profiles.test.ts` and `registry.test.ts`.
- [ ] Assert invalid reasoning controls produce zero transport calls.

## 2. F-M3-02 API and native transports

- [ ] Implement the eight explicit transport files listed in `design.md`.
- [ ] Consume injected CredentialPort and reuse `packages/launcher/src/supervise.ts` without importing orchestration.
- [ ] Add typed stdin input to the launcher contract where required.
- [ ] Preserve exact prompt bytes, cwd, environment, exit status and protocol identities.
- [ ] Add explicit permission and prompt-channel capabilities for each installed CLI protocol.
- [ ] Implement T-M3-004 through T-M3-006 with fake endpoints and native protocol peers.
- [ ] Implement the M2 ProviderGenerationPort mapping in `src/generation.ts` and T-M3-019 in `generation.test.ts`.
- [ ] Assert unsupported capabilities fail before spawning or sending a request.

## 3. F-M3-03 semantic results

- [ ] Implement `src/{events,tools,output}.ts`.
- [ ] Preserve tool IDs and provider cursor identities across fragmented streams.
- [ ] Route all tool execution and deduplication through the M4 host journal port.
- [ ] Preserve refusal, malformed output and truncation as distinct outcomes.
- [ ] Validate lowered structured output against the original host schema.
- [ ] Implement T-M3-007 through T-M3-009.
- [ ] Implement T-M3-020 in `usage.test.ts` for dated accounting dimensions, unknown costs and admitted limit exhaustion.
- [ ] Assert a provider completion cannot manufacture host verification evidence.

## 4. F-M3-04 lifecycle

- [ ] Implement `src/continuation.ts` with byte hashes and originating-prefix bindings.
- [ ] Implement scoped cancellation and continuation in each transport.
- [ ] Record local cleanup separately from provider acknowledgement and remote outcome.
- [ ] Return typed unknown or unavailable results for uncertain completion and expired state.
- [ ] Implement T-M3-010 through T-M3-012.
- [ ] Assert changed model, transport or Fable prefix cannot reuse opaque state.
- [ ] Assert uncertain resume performs zero new model dispatches.

## 5. F-M3-05 readiness

- [ ] Implement `src/readiness.ts` using existing vendor-preflight and credential-profile evidence.
- [ ] Keep discovery, authentication, currency, identity and capabilities independent.
- [ ] Add explicit metadata-only and bounded-workload probe modes.
- [ ] Redact secrets and preserve safe remediation details.
- [ ] Implement T-M3-013 through T-M3-015.
- [ ] Assert timeouts report unknown and never instruct login without signed-out evidence.

## 6. F-M3-06 qualification

- [ ] Implement `src/qualification.ts` with version-bound evidence and explicit expiry.
- [ ] Add `foreman providers list --json` and `foreman providers qualify` to the existing CLI.
- [ ] Add deterministic contract fixtures for every declared profile/transport cell.
- [ ] Implement T-M3-016 through T-M3-018, including the fake live-qualification harness.
- [ ] Add provider test globs to root `npm test` and the planned `test:providers` script.
- [ ] Extend workspace typechecking and `scripts/build-runtime.ts` for provider exports.
- [ ] Run `npm run typecheck` and `npm run test:providers`.
- [ ] Assert every declared cell has positive fixtures or an explicit unsupported result.
- [ ] Run `npm run build` and `npm run verify-runtime`.
- [ ] Run bounded live qualification for each claimed cell after selecting its authorized account and exact transport.
- [ ] Record unqualified or inaccessible cells explicitly without substituting another model.
- [ ] Assert support output distinguishes documented, fixture-tested and live-qualified evidence.

## 7. Complete shared interfaces and revised fixtures

- [ ] Implement closed ProviderControlsV1 decoding and exact defaults in controls.ts.
- [ ] Implement T-M3-021 with nested unknown-key and unsupported execution-mode fixtures.
- [ ] Add bounded host-resolved content to ToolResultV1 and extend T-M3-008 crash replay assertions.
- [ ] Emit opaque checkpoints and cursors to M4 without adapter storage I/O.
- [ ] Add observe and RemoteObservationV1 with capability-bound reconciliation in every transport.
- [ ] Implement T-M3-022 and extend T-M3-012 for completed, not-found and unsupported observations.
- [ ] Implement admitCell in registry.ts and T-M3-023 for per-capability product evidence admission.
- [ ] Add TestFixtureProviderLayer through M2's test launcher without product fixture selectors.
- [ ] Assert fixture evidence is never labeled live-qualified in T-M3-018 and T-M3-023.
- [ ] Enumerate the eight TransportId literals and native-only coding capability.
- [ ] Implement T-M3-024 for ambiguity, explicit selection and ToolPolicyV1 enforcement.
- [ ] Share the complete ProviderFailure union with M2/M4 and implement T-M3-025 exhaustive checks.
- [ ] Add providers subcommands only through M2's pel-authoring-cli.ts and pel-authoring-main.ts.
- [ ] Assert one foreman.js router entry and invoke that product bundle in T-M3-018.

## 8. Command outcome codes

- [ ] Implement the shared M2 router commandExitCode mapping with the provider rows in design.md.
- [ ] Implement T-M3-026 in packages/orchestration/src/pel-provider-cli.test.ts.
- [ ] Strengthen the existing catalog assertions for exact success, failure, invalid, needs-action and cancellation codes.
- [ ] Add the exact command test target to test:providers and retain root test discovery.
- [ ] Assert bounded attached commands never use final exit 5 to conceal an unresolved outcome.

## 9. Final shared boundaries

- [ ] Extend M2's errors.ts with the agreed _tag/message/retryClass and optional requestId/usage/fieldPath/providerIdentity/retryAfterMs fields.
- [ ] Add CredentialPort and opaque credentialProfileRef to request and identity contracts.
- [ ] Implement T-M3-027 for scoped credential injection and acyclic package imports.
- [ ] Keep provider-to-Pel schema imports one-way and reject provider-to-orchestration imports in dependency lint.
- [ ] Move qualification/list CLI tests into the named orchestration test files.
- [ ] Use M2's fixture launcher with mandatory manifest for deterministic provider tests.
- [ ] Make unexpected network or live credential access fail test:providers.
- [ ] Keep real qualification outside npm test as an explicitly invoked product command.
- [ ] Extend T-M3-025 for quoted retry data keys and rejection of syntax/nil-pair lists.
- [ ] Extend T-M3-002 for all disallowed in-enum efforts and separate minimal decode rejection.
- [ ] Implement OutputSchemaV1 lowering, duplicate-aware JSON parsing and canonical Pel decoding in output.ts.
- [ ] Implement T-M3-028 and extend T-M3-009 for schema order, envelopes, bounds and unsupported subsets.
- [ ] Add pretest:providers invoking M2's test:pel-fixture-build before the provider CLI acceptance tests.
