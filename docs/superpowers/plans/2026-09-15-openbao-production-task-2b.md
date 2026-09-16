# OpenBao managed store implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a private schema 2 storage adapter with separate metadata observation, exact-version data observation, and CAS writes.

**Architecture:** Reuse the existing HTTP transport through one internal module. Keep schema 1 behavior in the raw adapter. Keep authorization and delivery in a separate manager task.

**Tech Stack:** Node.js 24, strict TypeScript, Effect 3.22.1, existing esbuild, and OpenBao KV v2.

## Status and controlling documents

This document refines Task 2B interfaces before implementation. It does not report implemented behavior or production qualification.
Stage 2B.1 is the executable dispatch brief. Stages 2B.2 and 2B.3 define contracts and review gates for subsequent executable refinements.

The controlling scope is `docs/superpowers/specs/2026-09-15-openbao-production-contracts.md`.
The backlog is `docs/superpowers/plans/2026-09-15-openbao-production-sprint.md`, Task 2.
Task 2A supplies `validateEnvelope`, `planTransition`, and the lifecycle types.

The old `ManagedStorePort.observe` signature loses information that the controlling contract requires.
The old `observeMetadata` signature cannot represent metadata absence.
Use the refined private ports below for this slice.
Do not change the canonical document during implementation.
The architect must incorporate the accepted refinement before manager integration.

## Global constraints

- OpenBao is the sole durable credential and lifecycle authority. WSL and Linux are equal production targets.
- Use Node.js 24, strict TypeScript, and Effect. Keep pure validation free from effects.
- Do not add dependencies, a daemon, a scheduler, a local lifecycle database, or managed fallback.
- Do not perform live operations, installations, host interruptions, commits, index writes, or installed runtime updates during these tasks.
- Preserve native-login source changes and historical evidence. Keep credential values outside PEL, receipts, models, logs, and command arguments.
- Run synthetic servers only on ephemeral loopback ports. Use only `foreman-synthetic-` material values.
- Skip graphify, as required by `AGENT_TRAPS.md`.
- Do not infer authorization from a storage object, configuration digest, successful observation, or pure transition proposal.

## Allowed files and ownership

| Stage | Exact path | Responsibility |
| --- | --- | --- |
| 2B.1 | `packages/providers/src/openbao-http.ts` | New internal transport session and bounded JSON helpers |
| 2B.1 | `packages/providers/src/openbao-http.test.ts` | Direct lazy session and shared deadline tests |
| 2B.1 | `packages/providers/src/openbao-credential-store.ts` | Mechanical extraction of shared transport only |
| 2B.1 | `packages/providers/src/openbao-credential-store.test.ts` | Raw behavior regression controls |
| 2B.1 | `scripts/openbao-pilot/provenance.ts` | Include extracted transport in static source inventory |
| 2B.1 | `scripts/openbao-pilot/source-binding.test.ts` | Bind compiled pilot evidence to extracted source bytes |
| 2B.2 | `packages/providers/src/openbao-managed-store.ts` | Private refined ports and managed observation adapter |
| 2B.2 | `packages/providers/src/openbao-managed-store.test.ts` | Synthetic observation tests |
| 2B.3 | `packages/providers/src/openbao-managed-store.ts` | CAS write implementation |
| 2B.3 | `packages/providers/src/openbao-managed-store.test.ts` | Synthetic CAS and uncertain-response tests |

Do not modify `credential-lifecycle.ts`, `credential-store.ts`, package manifests, lockfiles, public exports, or native-login files.
Do not create `credential-manager.ts` in this slice.
Do not modify tracked runtime bundles.
Keep changes within each stage until its review accepts them.

## Refined typed ports

Put these types in `openbao-managed-store.ts`.
Import lifecycle types from `./credential-lifecycle.js`.
Import `OpenBaoCredentialStoreConfig` from `./credential-store.js`.

```typescript
import type { Effect } from 'effect';
import type {
  AccountKey, CasWrite, CurrentMetadata, Envelope, ManagedFailure,
} from './credential-lifecycle.js';
import type { OpenBaoCredentialStoreConfig } from './credential-store.js';

export type MetadataObservation =
  | { readonly kind: 'metadataAbsent' }
  | { readonly kind: 'metadataPresent'; readonly metadata: CurrentMetadata };

export interface ManagedDataObservation {
  readonly kind: 'managed';
  readonly metadata: CurrentMetadata;
  readonly dataVersion: number;
  readonly envelope: Envelope;
}

export interface LegacyDataObservation {
  readonly kind: 'schema1';
  readonly metadata: CurrentMetadata;
  readonly dataVersion: number;
  readonly schemaVersion: 1;
}

export type DataObservation = ManagedDataObservation | LegacyDataObservation;

export interface ManagedObservationPort {
  readonly observeMetadata: (
    key: AccountKey, deadline: number,
  ) => Effect.Effect<MetadataObservation, ManagedFailure>;
  readonly observeData: (
    key: AccountKey, observed: CurrentMetadata, deadline: number,
  ) => Effect.Effect<DataObservation, ManagedFailure>;
}

export interface ManagedWritePort {
  readonly write: (
    key: AccountKey, change: CasWrite, deadline: number,
  ) => Effect.Effect<number, ManagedFailure>;
}

export type ManagedStorePort = ManagedObservationPort & ManagedWritePort;

export declare function makeOpenBaoManagedStore(
  config: OpenBaoCredentialStoreConfig,
): ManagedStorePort;

export declare function makeSyntheticOpenBaoManagedStore(
  config: OpenBaoCredentialStoreConfig,
): ManagedStorePort;
```

The synthetic constructor is internal to source tests. Do not export it from a production package entry point.
The production constructor requires the existing canonical HTTPS origin policy.
Constructors must not acquire a token or start a request.
Snapshot configuration and operation inputs before asynchronous token acquisition.
Use ordinary own data properties. Refuse accessors, symbols, hostile proxies, and unexpected object prototypes without exposing exceptions.

`LegacyDataObservation` is a migration classification, not a validated managed envelope.
It contains no legacy material or account claims from the legacy payload.
Its identity comes from the requested key and its separately observed KV version.
Normal manager operations must turn this variant into `MigrationRequired`.
Explicit migration remains a separate task with separate authorization and fresh supplied material.

## Authority order for the subsequent manager task

The storage adapter does not implement `AuthorizationPort`.
It must remain private until a manager enforces the following order.

1. Validate and snapshot the reference, operation arguments, and deadline.
2. Authorize `metadata` for the exact backend and account key.
3. Call `observeMetadata` only after that authorization succeeds.
4. Refuse absent authority for a known managed reference with `Quarantined`.
5. Construct the exact binding from backend, requested reference, key, and observed current version.
6. Authorize the requested operation against that binding before calling `observeData`.
7. Validate the returned observation and apply the pure lifecycle transition.
8. Perform CAS, or revalidate current authority immediately before private delivery.

For absent import, authorize `import` with `observedAbsent: true` after metadata absence.
Use CAS 0 only for that create operation.
Do not invent a generation-zero existing binding.
For list, use provider-scoped authorization through a separate future port.

Metadata 404 means only that this metadata request observed absence.
It cannot prove that an account never existed.
Do not add a caller Boolean that attests historical absence.
Known-reference and readiness context must come from the later manager's accepted authority inputs.
Do not build a local durable registry to recover this information.
An erased account without surviving authority evidence cannot be distinguished from a new name by this adapter.
That limitation blocks production admission of the manager until its authority policy resolves the case.

The store cannot retract material that a caller already received.
The later manager must authorize every delivery and revalidate current authority.
Status and readiness receipts never replace delivery authorization.

## Stage 2B.1: Extract the existing transport

**Consumes:** `OpenBaoCredentialStoreConfig`, `CredentialStoreFailure`, and the existing HTTP implementation.
**Produces:** One internal HTTP session factory with this interface.

```typescript
import type { Effect } from 'effect';
import type {
  CredentialStoreFailure, OpenBaoCredentialStoreConfig,
} from './credential-store.js';

export interface OpenBaoHttpSession {
  readonly request: (
    method: 'GET' | 'POST', path: string, body?: Buffer,
  ) => Effect.Effect<Buffer, CredentialStoreFailure>;
}

export interface OpenBaoHttpClient {
  readonly run: <A>(
    validate: () => boolean,
    operation: (session: OpenBaoHttpSession) => Effect.Effect<A, CredentialStoreFailure>,
    deadline: number,
  ) => Effect.Effect<A, CredentialStoreFailure>;
}

export declare function makeOpenBaoHttpClient(
  config: OpenBaoCredentialStoreConfig, synthetic: boolean,
): OpenBaoHttpClient;
export declare function encodeOpenBaoJson(value: unknown): Buffer | undefined;
export declare function decodeOpenBaoJson(bytes: Buffer): unknown;
```

Move `originOf`, `validConfig`, `validDeadline`, `statusFailure`, `transport`, and the existing `run` boundary into this module.
Move the 64 KiB JSON encoder and duplicate-key rejecting decoder into this module.
Rename `encode` to `encodeOpenBaoJson` and `decode` to `decodeOpenBaoJson` without changing their implementations.
Move `failureCodes`, `failure`, `sanitizeFailure`, and their `object` predicate dependencies with the transport boundary.
Keep the raw adapter's `object` predicate for raw decoding. This small predicate is not duplicated transport logic.
Keep the token callback, token sanitizer, TLS behavior, cancellation cleanup, and timeout behavior identical.
Keep one token acquisition and one absolute effective deadline per `run` call.
Requests within one session share the same five-second maximum budget.
Do not restart the budget between metadata and data requests.
Do not add retries or redirect handling.
Preserve TLS certificate verification and the existing IPv6 IP SAN check.

Keep raw reference parsing, schema 1 decoding, raw write serialization, list validation, and raw deletion in the raw adapter.
Retain the exact raw request paths, request bodies, failure tags, and constructor exports.
Do not tighten raw schema 1 validation as part of this extraction.
Keep request-body snapshotting in each raw operation before asynchronous token acquisition.
Create `OpenBaoHttpSession` only after the existing token validation succeeds.
Implement its `request` method as a closure over the existing `transport` function and the effective deadline.
Replace each raw `transport(origin, snapshot, token, method, path, body, effective)` call with `session.request(method, path, body)`.
Replace each raw operation callback's three parameters with `session`.
Keep the existing `run(validate, operation, deadline)` call structure through `client.run`.

```typescript
const session: OpenBaoHttpSession = {
  request: (method, path, body) => transport(origin, snapshot, value, method, path, body, effective),
};
return operation(session);
```

The names `origin`, `snapshot`, `value`, and `effective` refer to the existing validated `run` scope.
Do not export the session outside the callback lifetime or add a token cache.

- [ ] Create the direct HTTP session test below before adding the production module.
- [ ] Run that test and record the missing-module failure.
- [ ] Add a raw schema 2 refusal control to the existing raw tests.
- [ ] Assert raw writes still contain `schemaVersion: 1` and the supplied CAS value.
- [ ] Record the focused raw suite result before extraction.
- [ ] Extract the internal HTTP session without changing raw codecs.
- [ ] Add the transport source to the pilot inventory and compiled source-binding assertions below.
- [ ] Run the focused raw suite and strict type checking.
- [ ] Review the diff for duplicated transport logic and changed raw behavior.

Use this assertion in the existing `serve` and `config` harness.

```typescript
test('raw reader does not accept a managed schema 2 envelope', async () => {
  await serve((_request, response) => {
    response.end(JSON.stringify({ data: {
      data: { schemaVersion: 2, provider: 'agy', account: 'main',
        generation: 1, state: 'active', material: { access: 'foreman-synthetic-a' } },
      metadata: { version: 1 },
    } }));
  }, async origin => {
    const store = makeSyntheticOpenBaoCredentialStore(config(origin));
    assert.equal(await failureCode(store.read('bao:agy:main', Date.now() + 1000)),
      'InvalidResponse');
  });
});
```

This regression test already passes before extraction.
It protects preservation and is not evidence that new managed behavior exists.
Existing transport controls must continue to reject wrong TLS trust, redirects, duplicate JSON keys, oversized responses, and token defects.
The parent measured 31 passing lifecycle and raw-store tests before extraction on 2026-09-15.
That baseline is historical context. Rerun the controls against the actual candidate.
The existing TLS negative control can emit a Node TLS warning while its refusal assertion passes.
Do not classify the warning alone as a test failure or suppress the TLS refusal assertion.

Create this direct session test in `openbao-http.test.ts`.

```typescript
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Cause, Effect, Redacted } from 'effect';
import { makeOpenBaoHttpClient } from './openbao-http.js';

test('session is lazy and shares one token across sequential requests', async () => {
  let tokenCalls = 0;
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(request.url ?? '');
    response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const client = makeOpenBaoHttpClient({
      endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials',
      token: () => Effect.sync(() => { tokenCalls += 1; return Redacted.make('synthetic-token'); }),
    }, true);
    const operation = client.run(() => true, session => session.request('GET', '/first').pipe(
      Effect.flatMap(() => session.request('GET', '/second')),
    ), Date.now() + 1000);
    assert.equal(tokenCalls, 0);
    assert.deepEqual(seen, []);
    await Effect.runPromise(operation);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(seen, ['/first', '/second']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('outer session deadline bounds a multi-request operation', async () => {
  let deadline = 0;
  let tokenCalls = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const server = createServer((request, response) => {
    if (request.url === '/first') response.end('{}');
    else timers.push(setTimeout(() => response.end('{}'), Math.max(0, deadline + 100 - Date.now())));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const client = makeOpenBaoHttpClient({
      endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials',
      token: () => Effect.sync(() => { tokenCalls += 1; return Redacted.make('synthetic-token'); }),
    }, true);
    deadline = Date.now() + 200;
    const exit = await Effect.runPromiseExit(client.run(() => true, session => session.request('GET', '/first').pipe(
      Effect.flatMap(() => session.request('GET', '/second')),
    ), deadline));
    assert.equal(exit._tag, 'Failure');
    if (exit._tag === 'Failure') {
      assert.deepEqual(exit.cause, Cause.fail({ _tag: 'CredentialStoreFailure', code: 'Timeout' }));
    }
    assert.equal(tokenCalls, 1);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
```

The deadline test asserts the outer operation's closed timeout result. It does not independently distinguish each request's timer implementation.
Verify by code review that each request closes over the same effective deadline.
Keep the existing interruption control to prove that cancellation closes the active request.

Add `packages/providers/src/openbao-http.ts` immediately after the raw adapter in `sourceFiles` inside `scripts/openbao-pilot/provenance.ts`.
The disposable pilot test copies that inventory before building.
Without the new entry, the extracted import is absent from its fixture.
The existing `captureBuildInputs` automatically captures transitive TypeScript imports. Do not modify `build-inputs.ts`.

Add these assertions after the existing raw store hash assertion in `scripts/openbao-pilot/source-binding.test.ts`.

```typescript
const transportPath = 'packages/providers/src/openbao-http.ts';
const transportHash = hash(await readFile(join(fixture, transportPath)));
assert.equal(evidence.implementationHashes[transportPath], transportHash);
assert.equal(evidence.bundleInputHashes[transportPath], transportHash);
assert.ok(evidence.bundleInputs.includes(transportPath));
```

Extend that test's existing post-build source mutation control to the transport copy.

```typescript
await writeFile(join(fixture, transportPath), '// changed transport after build\n');
const afterTransportChange = await entry.getPilotImplementationEvidence();
assert.equal(afterTransportChange.bundleInputHashes[transportPath], transportHash);
assert.notEqual(afterTransportChange.bundleInputHashes[transportPath],
  hash(await readFile(join(fixture, transportPath))));
```

Use these exact Stage 2B.1 commands.
The first command initially fails because `openbao-http.ts` does not exist.
The completed stage requires all commands to pass.

```text
node --import tsx --test packages/providers/src/openbao-http.test.ts
npm run typecheck
node --import tsx --test packages/providers/src/credential-lifecycle.test.ts packages/providers/src/openbao-http.test.ts packages/providers/src/openbao-credential-store.test.ts scripts/openbao-pilot/source-binding.test.ts scripts/openbao-pilot/build-inputs.test.ts
git diff --check
```

Run the direct test as compiled Node.js code with these commands.

```text
task2b_http_output=$(mktemp -d /tmp/foreman-task2b-http.XXXXXX)
./node_modules/.bin/esbuild packages/providers/src/openbao-http.test.ts --bundle --platform=node --format=esm --target=node24 --outfile="$task2b_http_output/openbao-http.test.mjs"
node --test "$task2b_http_output/openbao-http.test.mjs"
```

Do not dispatch Stage 2B.2 until its observation codec refinement is independently accepted.

## Stage 2B.2: Observe metadata and exact-version data

**Consumes:** The accepted HTTP session and unchanged Task 2A validation.
**Produces:** `ManagedObservationPort` and the two observation variants.

### Metadata decoding

Request `GET /v1/{mount}/metadata/providers/{provider}/{account}`.
Only an HTTP 404 on this route becomes `{ kind: 'metadataAbsent' }`.
Require a valid JSON response with `data.current_version` and `data.versions`.
Require a positive safe `current_version` and a corresponding version entry.
Treat `current_version: 0`, an empty versions object, and a missing current entry as `Quarantined`.

Read `destroyed` and `deletion_time` from the current version entry.
Require Boolean `destroyed` and string `deletion_time`.
An empty deletion time means no schedule.
A valid nonempty RFC3339 deletion time at or before observation time means deleted.
A valid future deletion time means deletion scheduled.
Reject malformed timestamps instead of treating them as empty.
Quarantine every destroyed, deleted, or scheduled current version before requesting material.

Metadata can include documented retention, CAS, duration, and custom metadata fields.
Validate required fields without interpreting arbitrary metadata fields as lifecycle authority.
Reject unknown structural fields under the pinned OpenBao API response schema.
Use the existing top-level response allowlist.
Allow metadata `data` fields `cas_required`, `created_time`, `current_version`, `custom_metadata`, `delete_version_after`, `max_versions`, `oldest_version`, `updated_time`, and `versions`.
Allow version entry fields `created_time`, `deletion_time`, and `destroyed`.
Do not require metadata to prove effective mount policy. Task 1 readiness owns that evidence.

### Data decoding and fresh comparison

Reject malformed requested metadata with `InvalidInput` before token acquisition.
Require positive `currentVersion` and exactly three false deletion flags.
Within one session, read current metadata again before the data request.
Quarantine absence, deletion, or a current version different from the supplied observation.
Request `GET /v1/{mount}/data/providers/{provider}/{account}?version={currentVersion}`.
Do not request an unspecified latest version or search historical versions.

Parse `data.metadata.version` independently as `dataVersion`.
Require `dataVersion` to equal the supplied and fresh metadata current versions.
Require data metadata `destroyed: false` and `deletion_time: ''`.
Quarantine missing, malformed, or unsafe data metadata flags. Never default missing flags to false.
Quarantine data HTTP 404, missing data, malformed JSON, and inconsistent versions.
Recognize schema 1 only after metadata and wire version checks succeed.
Return its material-free classification without converting its payload into schema 2.

For schema 2 active state, wrap the parsed material with `Redacted.make` before calling `validateEnvelope`.
Do not wrap tombstones or add a material field to them.
Keep wire material limits at 1–32 entries and total encoded request or response size at 64 KiB.
Snapshot valid material into a frozen object through the Task 2A validator.
Require `envelope.generation === dataVersion === metadata.currentVersion`.

Read metadata once more after decoding data within the same session.
Quarantine absence, changed generation, or deletion on this final observation.
Return the final verified metadata and the independently parsed data version.
This bounds consistency to an observed instant. It does not establish a lock or a delivery grant.

- [ ] Add tests that return metadata 404 and data 404 through different routes.
- [ ] Run them against a deliberately incorrect shared-404 fixture and observe assertion failure.
- [ ] Add legacy, generation mismatch, scheduled deletion, and concurrent metadata-change cases.
- [ ] Implement the exact routes, decoding rules, and observation ordering above.
- [ ] Run the focused managed suite and strict type checking.
- [ ] Review request traces to establish that invalid metadata prevents material access.

Use this complete scaffold at the start of `openbao-managed-store.test.ts`.

```typescript
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Cause, Effect, Redacted } from 'effect';
import { makeSyntheticOpenBaoManagedStore } from './openbao-managed-store.js';

const key = { provider: 'agy', account: 'main' } as const;
const metadata = { currentVersion: 1, deleted: false,
  destroyed: false, deletionScheduled: false } as const;
const wireMetadata = { data: { current_version: 1, versions: {
  '1': { created_time: '2026-09-15T00:00:00Z', deletion_time: '', destroyed: false },
} } };

async function withServer(
  handler: (url: string) => { status: number; value: unknown },
  run: (store: ReturnType<typeof makeSyntheticOpenBaoManagedStore>, seen: string[]) => Promise<void>,
): Promise<void> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    seen.push(url);
    const result = handler(url);
    response.writeHead(result.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.value));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(makeSyntheticOpenBaoManagedStore({
      endpoint: `http://127.0.0.1:${address.port}`, mount: 'credentials',
      token: () => Effect.succeed(Redacted.make('synthetic-broker-token')),
    }), seen);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('only metadata 404 establishes observed metadata absence', async () => {
  await withServer(() => ({ status: 404, value: { errors: [] } }), async (store, seen) => {
    assert.deepEqual(await Effect.runPromise(store.observeMetadata(key, Date.now() + 1000)),
      { kind: 'metadataAbsent' });
    assert.deepEqual(seen, ['/v1/credentials/metadata/providers/agy/main']);
  });
});

test('data 404 with existing metadata is quarantined', async () => {
  await withServer(url => url.includes('/metadata/')
    ? { status: 200, value: wireMetadata }
    : { status: 404, value: { errors: [] } }, async (store, seen) => {
    const exit = await Effect.runPromiseExit(store.observeData(key, metadata, Date.now() + 1000));
    assert.equal(exit._tag, 'Failure');
    if (exit._tag === 'Failure') {
      assert.deepEqual(exit.cause, Cause.fail({ _tag: 'ManagedFailure', code: 'Quarantined' }));
    }
    assert.deepEqual(seen, ['/v1/credentials/metadata/providers/agy/main',
      '/v1/credentials/data/providers/agy/main?version=1']);
  });
});

test('schema 1 produces an explicit material-free migration classification', async () => {
  await withServer(url => ({ status: 200, value: url.includes('/metadata/') ? wireMetadata : {
    data: { data: { schemaVersion: 1, provider: 'agy', account: 'main',
      material: { access: 'foreman-synthetic-legacy' } },
      metadata: { version: 1, destroyed: false, deletion_time: '' } },
  } }), async store => {
    const result = await Effect.runPromise(store.observeData(key, metadata, Date.now() + 1000));
    assert.deepEqual(result, { kind: 'schema1', schemaVersion: 1, metadata, dataVersion: 1 });
    assert.equal(JSON.stringify(result).includes('foreman-synthetic-legacy'), false);
  });
});
```

Parameterize independent data-version and envelope-generation mismatches with these triples.
Each mismatch must produce `Quarantined`, including schema 1 with a mismatched wire version.

```typescript
const versionCases = [
  { currentVersion: 2, dataVersion: 1, generation: 2 },
  { currentVersion: 2, dataVersion: 2, generation: 1 },
  { currentVersion: 1, dataVersion: 2, generation: 2 },
] as const;
```

## Stage 2B.3: Submit bounded CAS writes

**Consumes:** `CasWrite` proposals and the accepted transport.
**Produces:** `ManagedWritePort` with no raw-delete or implicit migration path.

Validate the caller key and proposal shape before token acquisition.
Require nonnegative safe `expectedVersion` below `Number.MAX_SAFE_INTEGER`.
Require `envelope.generation === expectedVersion + 1` and exact envelope identity.
Use Task 2A `validateEnvelope` against the proposed generation with all deletion flags false.
Map invalid supplied envelopes to `InvalidInput` because they are caller arguments.
Reject CAS 0 tombstones. Accept CAS 0 only with an active generation 1 envelope.
Snapshot supplied redacted material before token acquisition.

Serialize this exact shape for active writes.
Omit `material` entirely for a tombstone.

```typescript
const activeWrite = {
  options: { cas: 1 },
  data: { schemaVersion: 2, provider: 'agy', account: 'main',
    generation: 2, state: 'active', material: { access: 'foreman-synthetic-next' } },
};
const tombstoneWrite = {
  options: { cas: 1 },
  data: { schemaVersion: 2, provider: 'agy', account: 'main',
    generation: 2, state: 'tombstoned' },
};
```

POST only to `/v1/{mount}/data/providers/{provider}/{account}`.
Do not call DELETE, soft delete, destroy, undelete, or metadata deletion endpoints.
Require the returned KV version to equal the proposed generation exactly.
A successful write result reports server acknowledgement only.
The later manager must reobserve metadata and data before recording operation success.

The write port does not establish a valid lifecycle transition or migration authorization.
Only the manager may select a proposal after validating current state and operation authority.
Do not expose the adapter to provider execution or commands in this slice.

- [ ] Extend the synthetic handler to capture method, route, and parsed body.
- [ ] Assert that create sends CAS 0 and tombstone sends the observed positive CAS.
- [ ] Add a fixture with atomic in-memory version comparison and increment.
- [ ] Race two writes with the same expected version through separate store instances.
- [ ] Assert exactly one acknowledged version and one `Conflict`.
- [ ] Add lost-response and incorrect-acknowledgement fixtures.
- [ ] Implement serialization and response-version comparison.
- [ ] Run focused suites and strict type checking.
- [ ] Review the store for retries, fallback reads, and unintended endpoints.

The concurrent fixture must compare and increment in one synchronous handler section.
Do not derive its verdict from request order or a test name.
For a conflict, return HTTP 400 with `check-and-set parameter did not match the current version`.
For a winner, return `{ data: { version: expectedVersion + 1 } }`.
Retain and inspect the accepted envelope to prove that the loser did not overwrite it.

Use these exact outcome assertions after collecting two `Effect.either` results.

```typescript
assert.equal(results.filter(result => result._tag === 'Right').length, 1);
assert.equal(results.filter(result => result._tag === 'Left'
  && result.left.code === 'Conflict').length, 1);
assert.equal(serverVersion, 2);
assert.equal(acceptedEnvelope.generation, 2);
assert.equal(acceptedEnvelope.state, 'tombstoned');
assert.equal(Object.hasOwn(acceptedEnvelope, 'material'), false);
```

Use two tombstone proposals for this fixture so the final-state assertion is deterministic.
Separate remove-versus-refresh and recovery lifecycle races belong to manager qualification.

## Failure precedence and deadlines

1. Reject malformed caller arguments or boundary inspection exceptions with `InvalidInput` before token or network access.
2. Preserve token `Denied`, `Unavailable`, and `Timeout` failures through the managed failure tag.
3. Map unknown callback errors and defects to closed `Unavailable` without payloads or causes.
4. Preserve HTTP 403 as `Denied` and recognized CAS rejection as `Conflict`.
5. Treat only metadata GET 404 as an absence observation.
6. Treat missing data, malformed responses, deletion flags, and version inconsistency as `Quarantined` during reads.
7. Classify schema 1 after consistent metadata and wire version checks, before schema 2 validation.
8. Require manager transition precedence from Task 2A after observation validates.

Reject already-expired or nonfinite deadlines with `InvalidInput` at execution.
Use the caller deadline capped at five seconds across the complete storage operation.
Preserve Effect interruption and destroy active requests on cancellation.
Do not convert interruption into success or retry it.

After invoking the POST transport, treat unavailable transport, timeout, malformed acknowledgement, or wrong version as `ReconciliationRequired`.
This classification is conservative because the adapter cannot prove whether OpenBao committed the write.
Token acquisition failures before invoking POST retain their original closed failure codes.
Definite HTTP 403 and CAS rejection remain `Denied` and `Conflict`.
Do not retry uncertain writes or claim that cancellation proves no commit.
Reconciliation uses a new authorized manager operation. It is outside this slice.

## Required controls beyond the snippets

| Control | Required assertion |
| --- | --- |
| Metadata present at version zero | Quarantine and zero data requests |
| Deleted, destroyed, or scheduled current version | Quarantine and zero data requests |
| Wrong key or material shape | InvalidInput and zero token requests |
| Metadata changes before or after data read | Quarantine and no returned material |
| Tombstone | Valid material-free envelope, never active delivery |
| Legacy record with material canary | Explicit schema1 classification without material |
| Duplicate keys, malformed UTF-8, oversized response | Closed quarantine without canary leakage |
| Token throw, rejected Effect, or defect | Closed failure without exception details |
| HTTP 403 on metadata | Denied, no data request, no absence result |
| Synthetic constructor with ordinary secret value | InvalidInput on write, quarantine on read |
| Production constructor with loopback HTTP | InvalidInput and zero token requests |
| Mutable arguments during token wait | Request uses the initial validated snapshot |
| Timer expiration or interruption | Active request closes, no retry or success |
| CAS acknowledgement with wrong version | ReconciliationRequired and exactly one POST |

## Verification commands

Run commands from `/root/foreman-native-login-20260915` with Node.js 24.
Use existing dependencies. Do not run `npm install` or the runtime build script.

```text
node --version
npm run typecheck
node --import tsx --test packages/providers/src/credential-lifecycle.test.ts packages/providers/src/openbao-credential-store.test.ts packages/providers/src/openbao-managed-store.test.ts
git diff --check
```

For Stage 2B.1, omit the managed test path until that file exists.
Require Node major version 24, exit zero from TypeScript, and passing assertions from each focused test file.
Record failures against deliberately incorrect synthetic responses before relying on the corresponding controls.
Do not edit production source to demonstrate a failing control.

Compile the managed test into candidate-owned temporary output and run it with Node.js.
This command uses a fresh temporary directory and does not write a tracked bundle.

```text
task2b_output=$(mktemp -d /tmp/foreman-task2b.XXXXXX)
./node_modules/.bin/esbuild packages/providers/src/openbao-managed-store.test.ts --bundle --platform=node --format=esm --target=node24 --outfile="$task2b_output/managed-store.test.mjs"
node --test "$task2b_output/managed-store.test.mjs"
```

Generated JavaScript is build output, not implementation source.
Leave source changes and verification reports uncommitted.

## Deferred work and admission boundaries

The next manager brief must define authorization, known-reference absence policy, readiness binding, and immediate delivery revalidation.
It must add status, import, resolve, remove, and recovery without granting authority through these storage ports.
Schema migration needs distinct authorization and a successful exact-version readback.
List, history pruning, refresh ownership, provider revocation, and command integration remain separate reviewed work.

Real OpenBao CAS qualification remains an explicit acceptance dependency.
Synthetic handler concurrency is not real-server CAS evidence.
The authorized scope permits disposable real OpenBao tests with a verified binary and synthetic material only.
These tests do not require production deployment or service changes.
Their executable refinement must specify the binary receipt, isolated storage, private token channel, and exact process cleanup.
It must race two compiled Node.js processes at the same generation and verify one durable winner after reconnect.
It must verify metadata version, wire data version, and envelope generation after each accepted write.
Do not install, restart, or contact a live service to complete this slice.

The KV reference is [OpenBao KV v2 API](https://openbao.org/docs/api/secret/kv/kv-v2/).
The parent architecture review checked the current 2.6 API on 2026-09-15.
CAS 0 requires absence. Soft deletion retains version history and does not permit CAS 0 recreation.
Metadata creation without a data version and administrative metadata erasure require the distinct handling specified above.

## Completion predicate

- [ ] Stage 2B.1 preserves raw schema 1 behavior and has independent review acceptance.
- [ ] Stage 2B.2 exposes explicit absence, dataVersion, and material-free legacy classification.
- [ ] Stage 2B.3 sends real CAS fields and refuses uncertain writes without retry.
- [ ] Focused source tests, strict type checking, and compiled Node.js tests pass on the reviewed files.
- [ ] No manager authorization, live CAS qualification, or production readiness is claimed.
- [ ] The architect accepts the refined ports before any dependent manager implementation begins.
