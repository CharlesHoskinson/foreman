# OpenBao Credential Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Execute P01 through P11 against disposable synthetic credentials without changing live provider behavior.

**Architecture:** An experimental host broker reads strictly selected KV v2 records. A scoped controller owns the local server and restricted tokens. A fake worker verifies the private credential channel.

**Tech Stack:** Node.js 24, TypeScript, Effect, node:test, OpenBao KV v2, and the existing duplicate-key JSON decoder.

## Global Constraints

- All new executable repository code uses Node.js 24, TypeScript, and Effect for owned asynchronous resources.
- The synthetic fixture mount is `foreman-pilot`. The framework backend requires an explicit validated mount.
- The provider is exactly one of `codex`, `grok`, `claude`, or `agy`.
- The account matches `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.
- Use explicit five-second HTTP deadlines and a 120-second fixture deadline.
- Limit an HTTP response to 64 KiB.
- The pilot does not import, refresh, revoke, or delete live provider credentials.
- Do not commit, publish, install a Foreman candidate, or change live credentials under this pilot approval.
- No new Pel grammar is necessary for this pilot.
- Preserve the existing Codex native-login implementation and default CredentialPort resolver.

## Baseline and execution

Run in `/root/foreman-native-login-20260915`, an existing linked worktree.
Keep dependencies and untracked approved design documents intact.
Run `node --import tsx --test packages/orchestration/src/pel-codex-auth.test.ts` before implementation.
Run `npm run typecheck` after integration.
Run pilot tests with `OPENBAO_PILOT_BINARY`, `OPENBAO_PILOT_SHA256`, and `OPENBAO_PILOT_RECEIPT_SHA256`.
Supply independently trusted binary and receipt digests. The compiled CLI accepts those values as positional arguments.
Store its public provenance outside the repository and include the digest in sanitized evidence.

### Task 1: Strict synthetic host broker

**Files:**

- Create `packages/orchestration/src/openbao-pilot.ts`.
- Create `packages/orchestration/src/openbao-pilot.test.ts`.
- Reuse `packages/core/src/canonical-json.ts` without changing its behavior.

**Interfaces:**

```typescript
import type { Effect, Redacted } from 'effect';
export type PilotProvider = 'codex' | 'grok' | 'claude' | 'agy';
export interface PilotReference { readonly provider: PilotProvider; readonly account: string }
export interface PilotFailure { readonly _tag: 'PilotFailure'; readonly code: 'InvalidInput' | 'Denied' | 'Unavailable' | 'InvalidResponse' | 'Conflict' | 'Timeout' }
export interface PilotCredential extends PilotReference { readonly accessToken: Redacted.Redacted<string>; readonly refreshToken: Redacted.Redacted<string>; readonly version: number }
export interface PilotClient {
  readonly read: (reference: string, deadline: number) => Effect.Effect<PilotCredential, PilotFailure>;
}
export declare function parsePilotReference(reference: string): PilotReference | undefined;
export declare function makePilotClient(input: { readonly origin: string; readonly token: Redacted.Redacted<string> }): PilotClient;
```

The origin must be an explicit `http://127.0.0.1:<port>` origin without credentials, path, query, or fragment.
The client rejects malformed configuration before network access.
Use Node HTTP directly to avoid inherited proxy behavior.
The HTTP implementation must abort and destroy requests on deadline, interruption, response overflow, and redirect.
Collect response bytes only to the declared bound. Decode fatal UTF-8 and duplicate-key-safe JSON.
Read the KV v2 envelope's `data.data` and `data.metadata.version` fields.
Require `schemaVersion: 1`, exact selected identity, and distinct synthetic access and refresh prefixes.
Return only stable error codes without underlying request errors or response bodies.
Do not export this experimental client through the product resolver.

- [ ] Write failing tests for the public contract.

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePilotReference } from './openbao-pilot.js';
test('explicit accounts only', () => {
  assert.deepEqual(parsePilotReference('bao:agy:account-a'), { provider: 'agy', account: 'account-a' });
  for (const ref of ['bao:gemini:a', 'bao:grok:../a', 'bao:claude:a%2fb', 'bao:codex:a\n']) {
    assert.equal(parsePilotReference(ref), undefined);
  }
});
```

- [ ] Run `node --import tsx --test packages/orchestration/src/openbao-pilot.test.ts` and retain the expected missing-feature failure.
- [ ] Implement the interface above using the existing Effect and core decoding conventions.
- [ ] Add local HTTP tests for eight valid provider/account pairs and eight identity-mismatch pairs.
- [ ] Add denial, missing, sealed, malformed JSON, duplicate keys, oversized body, invalid UTF-8, redirect, timeout, and interruption tests.
- [ ] Verify redirect targets receive no request. Verify timeout and interruption close the active socket.
- [ ] Scan serialized results and errors for access, refresh, and broker canaries.
- [ ] Run the focused test command and obtain independent task review.

### Task 2: Framework credential store and reusable OpenBao backend

The user added this release requirement during execution: manage credentials for AGY, Codex, Claude, and Grok through a proper framework interface.
This task adds that shared storage boundary before the real-server harness.
It does not implement or claim provider OAuth refresh or live account qualification.

**Files:**

- Create `packages/providers/src/credential-store.ts` for the public Effect service contract.
- Create `packages/providers/src/openbao-credential-store.ts` for the bounded KV v2 implementation.
- Create `packages/providers/src/openbao-credential-store.test.ts` for storage and transport tests.
- Modify `packages/providers/src/index.ts` to export the contract and factories.
- Modify `packages/orchestration/src/openbao-pilot.ts` into a synthetic adapter over the shared backend.
- Modify `packages/orchestration/src/openbao-pilot.test.ts` to use the shared record envelope and retain its regression coverage.

**Interfaces:**

```typescript
import { Context } from 'effect';
import type { Effect, Redacted } from 'effect';
export type CredentialProvider = 'agy' | 'codex' | 'claude' | 'grok';
export interface CredentialStoreFailure {
  readonly _tag: 'CredentialStoreFailure';
  readonly code: 'InvalidInput' | 'InvalidResponse' | 'Denied' | 'NotFound' | 'Conflict' | 'Unavailable' | 'Timeout';
}
export interface StoredProviderCredential {
  readonly provider: CredentialProvider;
  readonly account: string;
  readonly version: number;
  readonly material: Redacted.Redacted<Readonly<Record<string, string>>>;
}
export interface CredentialStoreService {
  readonly read: (reference: string, deadline: number) => Effect.Effect<StoredProviderCredential, CredentialStoreFailure>;
  readonly write: (reference: string, material: Redacted.Redacted<Readonly<Record<string, string>>>, expectedVersion: number, deadline: number) => Effect.Effect<number, CredentialStoreFailure>;
  readonly list: (provider: CredentialProvider, deadline: number) => Effect.Effect<readonly string[], CredentialStoreFailure>;
  readonly remove: (reference: string, versions: readonly number[], deadline: number) => Effect.Effect<void, CredentialStoreFailure>;
}
export class CredentialStorePort extends Context.Tag('@foreman/providers/CredentialStorePort')<CredentialStorePort, CredentialStoreService>() {}
export interface OpenBaoCredentialStoreConfig {
  readonly endpoint: string;
  readonly mount: string;
  readonly namespace?: string;
  readonly caPem?: string;
  readonly token: () => Effect.Effect<Redacted.Redacted<string>, CredentialStoreFailure>;
}
export declare function makeOpenBaoCredentialStore(config: OpenBaoCredentialStoreConfig): CredentialStoreService;
export declare function makeSyntheticOpenBaoCredentialStore(config: OpenBaoCredentialStoreConfig): CredentialStoreService;
```

The production factory accepts canonical HTTPS origins only and never disables certificate verification.
The synthetic factory accepts only canonical `http://127.0.0.1:<port>` origins.
Synthetic material values must start with `foreman-synthetic-`. Both reads and writes enforce this restriction.
Mount names use the same component grammar as account names. Namespace components use that grammar separated by single slashes.
Reject invalid configuration, references, versions, deadlines, and material before requesting a bootstrap token.
Resolve the bootstrap token lazily for each operation within the same five-second effective deadline.
Do not cache the token or expose it through the service interface.

Store `{schemaVersion: 1, provider, account, material}` in KV v2.
Require one to 32 material fields, safe non-empty field names, string values, and a maximum 64 KiB encoded request and response.
Use the real KV v2 `data/`, `metadata/`, and `delete/` routes.
Writes always supply `options.cas`. Zero means create-only, positive integers select an existing version.
Map a known OpenBao check-and-set mismatch response to `Conflict` without exposing its raw error body.
Removal soft-deletes only the explicitly supplied positive version numbers. It does not destroy metadata or revoke a provider token.
List returns sorted validated account names, not secret material. Reject nested paths and malformed keys.
Preserve strict decoding, redirect refusal, short deadlines, cancellation cleanup, and stable sanitized errors from Task 1.

- [ ] Write failing contract tests before implementation.
- [ ] Run `node --import tsx --test packages/providers/src/openbao-credential-store.test.ts` and record the red result.
- [ ] Implement the public service and backend factories without changing the default live resolver.
- [ ] Test read, write CAS, listing, explicit-version removal, namespace headers, and bootstrap-token renewal per call.
- [ ] Test invalid TLS certificates, refused plaintext production endpoints, redirects, malformed data, oversized bodies, and cancellation.
- [ ] Test a hanging and failing token callback under the original operation deadline.
- [ ] Refactor the pilot adapter to consume the shared synthetic factory and preserve all existing pilot tests.
- [ ] Add the Task 1 review's success-path broker-canary scan and redirect-socket closure assertion.
- [ ] Run focused tests, strict type checks, and independent review.

### Task 3: Real OpenBao fixture and P01–P11 evidence

**Files:**

- Create `scripts/openbao-pilot.ts` for the scoped controller and report contract.
- Create `scripts/openbao-pilot.test.ts` for controller and evidence tests.
- Create `scripts/openbao-pilot-worker.ts` for the compiled fake worker.
- Create `scripts/build-openbao-pilot.ts` for compiled Node entrypoints.

**Interfaces:**

Consume `makePilotClient`, `PilotCredential`, and `PilotFailure` from Task 1 and the shared credential store from Task 2.
Produce `runOpenBaoPilot(input)` as an Effect with `binary`, `binarySha256`, `receiptSha256`, and `outputDirectory` inputs.
The result has `schemaVersion: 1`, `provenance: 'synthetic'`, `liveAccountsQualified: false`, and a list of P01–P11 outcomes.
Each outcome contains its identifier, Boolean pass state, duration, and sanitized assertion labels.
The report contains source revision, implementation hashes, dependency versions, binary provenance, and process exit status.
Bind the receipt to caller-supplied binary and receipt digests.
Launch an owned private snapshot of verified bytes. Preserve the original path and launched-image identity in evidence.
Record child code, signal, and spawn-failure status. Scan all canaries, including deletion-experiment material.
Use direct loopback administrative transport with explicit agent policy and bounded cancellation.
Treat only healthy HTTP 200 as readiness. P10 conditional recovery proves KV behavior, not manager authorization.

- [ ] Write a failing test that refuses absent or mismatched binary provenance before process launch.
- [ ] Run `node --import tsx --test scripts/openbao-pilot.test.ts` and retain the expected missing-feature failure.
- [ ] Implement a scoped fixture using a fresh private directory and a random loopback port.
- [ ] Generate administrative and provider canaries in memory. Pass no token in process arguments.
- [ ] Start only the explicitly selected, digest-verified executable with a minimal environment.
- [ ] Enable KV v2 at `foreman-pilot`, create two synthetic accounts per provider, and create a restricted read policy.
- [ ] Execute real-server P01, P02, P03, P05, P06, and P10 with assertions on actual HTTP outcomes.
- [ ] Use Task 1 HTTP fixtures for P04 and P08. Record their specific evidence without claiming real-server behavior.
- [ ] Implement P07 using a compiled fake worker, an anonymous private pipe, and allowlisted environment.
- [ ] Inspect worker arguments, environment, created files, and captured output without persisting raw canaries.
- [ ] Exercise P07 after success, denial, malformed response, timeout, and interruption.
- [ ] Implement P09 with explicit child exit and listener-closure checks after both completion and cancellation.
- [ ] Implement P11 by validating the complete report and scanning it for prohibited canaries.
- [ ] Write reports with private permissions. Do not include raw responses or environment dumps.
- [ ] Bundle TypeScript entrypoints with the existing esbuild dependency and run them with Node.js 24.
- [ ] Execute the compiled harness with the verified official binary. All P01–P11 results must pass.
- [ ] Run both focused test files, the Codex regression file, and `npm run typecheck`.
- [ ] Obtain independent task review and whole-change review. Resolve findings before claiming completion.

## Self-review

P01–P11 map to the approved design. Production bootstrap, native refresh, live migration, and provider qualification remain excluded.
Task 3 consumes the shared store and pilot interfaces. There is no new provider transport or implicit model substitution.
No task changes the installed runtime or existing credential files.

## Progress

- Written specification approved by the user: 2026-09-15, “looks good”.
- At plan creation, implementation had not started. The original step checkboxes above retain that planning baseline.
- Current execution status is tracked in `openspec/changes/openbao-credential-pilot/tasks.md`.
- Strict records, the bounded store and broker, the disposable controller, and the fake-worker entry point now exist.
- The compiled worker's P07 admission tests remain deferred.
- P01/P02/P03/P05/P06/P10 pass the real-server subset. P04/P07/P08/P09/P11 remain not-run.
- The final-hardening evidence records the latest scoped checks. Historical pass counts are not current release evidence.
