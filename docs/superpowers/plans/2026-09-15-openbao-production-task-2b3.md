# OpenBao managed CAS writes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development after dependency and contract review.

**Goal:** Submit schema 2 CAS proposals and distinguish acknowledged writes, definite refusals, and uncertain completion.

**Architecture:** Extend the private managed observation adapter with one write method. Keep lifecycle authorization and success receipts in the later manager.

**Tech Stack:** Node.js 24, strict TypeScript, Effect, and node:test.

## Global constraints

- OpenBao is the sole durable credential and lifecycle authority. WSL and Linux are equal production targets.
- Do not add dependencies, a daemon, a scheduler, a local lifecycle database, or managed fallback.
- Do not perform live operations, installations, host interruptions, commits, index writes, or installed runtime updates during these tasks.
- Preserve native-login source changes and historical evidence. Keep credential values outside PEL, receipts, models, logs, and command arguments.
- Use synthetic loopback HTTP peers and foreman-synthetic- material in tests.
- Skip graphify, as required by AGENT_TRAPS.md.

## Admission and files

Status: Independent planning review approved. Stage 2B.2 is accepted after corrected real-peer verification and independent task review.
This brief refines the write stage of 2026-09-15-openbao-production-task-2b.md.
Modify only packages/providers/src/openbao-managed-store.ts and openbao-managed-store.test.ts.
The separately named handoff report is also permitted. It is not an additional implementation file.
Preserve all accepted observation behavior and constructor names.
Do not modify the raw store, HTTP API, lifecycle validator, exports, manifests, or native integration.
Do not add manager authorization, refresh, recovery commands, migration, history pruning, or readiness claims.

## Exact interface extension

Import CasWrite from credential-lifecycle.ts.

```typescript
export interface ManagedWritePort {
  readonly write: (key: AccountKey, change: CasWrite, deadline: number) => Effect.Effect<number, ManagedFailure>;
}
export type ManagedStorePort = ManagedObservationPort & ManagedWritePort;
export declare function makeOpenBaoManagedStore(config: OpenBaoCredentialStoreConfig): ManagedStorePort;
export declare function makeSyntheticOpenBaoManagedStore(config: OpenBaoCredentialStoreConfig): ManagedStorePort;
```

These declarations replace observation-only constructor return types. Do not create duplicate constructors.

## Proposal validation and snapshot

Validate at Effect execution before token acquisition, using the accepted host input boundary.
Require an exact ordinary AccountKey and an exact ordinary CasWrite with expectedVersion and envelope.
Require expectedVersion to be a nonnegative safe integer below Number.MAX_SAFE_INTEGER.
Require schema 2 and envelope generation equal to expectedVersion plus one.
Call validateEnvelope against the requested key and proposed generation with all deletion flags false.
Map every invalid supplied envelope, including legacy schemas, to InvalidInput.
Reject CAS 0 tombstones. CAS 0 requires active state and generation 1.
Use the lifecycle validator's frozen material snapshot.
For the synthetic constructor, require every active material value to start with foreman-synthetic-.
Serialize the request before asynchronous token acquisition. Reject serialization failure or size above 64 KiB with InvalidInput.
Do not expose the request buffer to callers or reuse mutable caller records.

Serialize exactly these payload shapes.

```typescript
const activePayload = {
  options: { cas: 0 },
  data: { schemaVersion: 2, provider: 'codex', account: 'synthetic',
    generation: 1, state: 'active', material: { access: 'foreman-synthetic-new' } },
};
const tombstonePayload = {
  options: { cas: 1 },
  data: { schemaVersion: 2, provider: 'codex', account: 'synthetic',
    generation: 2, state: 'tombstoned' },
};
```

Do not serialize Redacted wrappers. Omit tombstone material entirely.
Use encodeOpenBaoJson from the accepted HTTP module.
Reuse the managed adapter's existing validation and failure helpers where their semantics match.

## Request and acknowledgement

Use one HTTP session and one token acquisition.
Send exactly one POST to /v1/{mount}/data/providers/{provider}/{account}.
Do not issue metadata, raw deletion, destroy, undelete, or fallback requests from write.
Do not retry.
This adapter receives an already-selected proposal. It does not establish a valid lifecycle transition or authorization.

Use the existing top-level response allowlist and require data.
Decode acknowledgements through decodeOpenBaoJson. Accept decoder-produced null-prototype wire records through the accepted wire validator.
Allow acknowledgement data fields version, destroyed, deletion_time, created_time, and custom_metadata.
Require version, destroyed, and deletion_time.
Require version equal to the proposed generation, destroyed false, and deletion_time empty.
Return that version only after the acknowledgement validates.
Do not return raw response fields or credential material.
The result means server acknowledgement only. The manager must reobserve state before recording lifecycle success.

## Failure origin and uncertain completion

Preserve configuration, argument, and pre-POST bootstrap failure semantics from the observation stage.
A token callback Conflict is not a server CAS rejection. It remains an outer bootstrap failure mapped to Unavailable.
Only request-local recognized CAS rejection becomes Conflict.
Only request-local HTTP 403 becomes the definite Denied refusal.

After the POST transport is invoked, classify other transport failures and invalid acknowledgements as ReconciliationRequired.
This includes Timeout, Unavailable, NotFound, InvalidResponse, malformed JSON/UTF-8, missing acknowledgement flags, and wrong version.
Do not infer that a failed connection or invalid response proves no commit.
Track POST invocation inside each Effect execution, never in shared client state.
Map the outer session deadline to ReconciliationRequired if that execution already invoked POST.
Preserve the original pre-POST Timeout when token acquisition never reached the request.
Preserve caller interruption as interruption. Its lack of acknowledgement does not prove no commit.
Unknown post-POST defects also require reconciliation without exposing causes.

Use semantic results as values through the unchanged HTTP run boundary, as in the observation stage.
Do not widen the accepted HTTP callback signature or disguise managed failures as raw failures.

## Tests

- [ ] Add a test that calls write on the accepted observation-only constructor and observe the missing-method RED.
- [ ] Add exact active and tombstone request-body assertions before implementation.
- [ ] Implement proposal validation, frozen serialization, one POST, and acknowledgement validation.
- [ ] Add the failure-origin and race controls below before completing those branches.
- [ ] Run focused tests to GREEN. Inspect accepted envelopes and request counts, not only result codes.

| Control | Exact assertion |
| --- | --- |
| Create proposal | One POST, options.cas 0, generation 1, unwrapped material |
| Tombstone proposal | One POST, positive expectedVersion, next generation, no material field |
| CAS 0 tombstone, malformed expectedVersion, overflow, mismatched generation/identity, schema 1, extra fields | InvalidInput, zero token and HTTP calls |
| Plaintext or wiped Redacted material, accessors, revoked proxies | Closed InvalidInput without exception fields |
| Body above 64 KiB | InvalidInput before token acquisition |
| Caller mutation during token wait | Exact pre-token body bytes remain unchanged |
| Bootstrap Conflict or NotFound | Unavailable, zero POST requests |
| Hanging bootstrap | Timeout, zero POST requests |
| Server CAS rejection | Conflict, exactly one POST |
| Server HTTP 403 | Denied, exactly one POST |
| Server commits then closes socket | ReconciliationRequired, committed state retained, no retry |
| Wrong version or missing/nonempty acknowledgement deletion fields | ReconciliationRequired, one POST |
| Invalid UTF-8, duplicate JSON keys, oversized acknowledgement, destroyed true, or unknown acknowledgement fields | ReconciliationRequired, one POST, no response-body leakage |
| Hanging POST | ReconciliationRequired, socket closed |
| Caller interruption during POST | Interrupted Effect, socket closed, no retry |
| Two writes through separate adapter instances with CAS 1 | One version 2 acknowledgement and one Conflict, final stored tombstone at generation 2 |
| Repeated execution of the same Effect after different bootstrap outcomes | No stale per-execution POST flag |

Implement the fake CAS server's compare and increment in one synchronous handler section.
Use two identical tombstone proposals so the final state is deterministic.
Return HTTP 400 with the established CAS mismatch message for a losing request.
Return complete acknowledgement metadata for the winning request.

```typescript
assert.equal(results.filter(x => x._tag === 'Right' && x.right === 2).length, 1);
assert.equal(results.filter(x => x._tag === 'Left' && x.left.code === 'Conflict').length, 1);
assert.equal(serverVersion, 2);
assert.equal(acceptedEnvelope.generation, 2);
assert.equal(acceptedEnvelope.state, 'tombstoned');
assert.equal(Object.hasOwn(acceptedEnvelope, 'material'), false);
```

These assertions establish adapter behavior against a fake HTTP peer, not actual OpenBao atomicity or cross-process ownership.
Disposable real OpenBao tests require the subsequent verified-binary qualification task.
Check request-timeout mapping and outer-session-timeout mapping separately.
The two timers share a deadline, so one hanging-peer result does not identify which timer fired.
Use deterministic controls where available. Otherwise report the runtime result separately from source-level verification of the other timeout branch.
Do not claim independent runtime coverage of both branches from one race.

## Verification and handoff

```text
node --import tsx --test packages/providers/src/openbao-managed-store.test.ts
npm run typecheck
node --import tsx --test packages/providers/src/credential-lifecycle.test.ts packages/providers/src/openbao-http.test.ts packages/providers/src/openbao-credential-store.test.ts packages/providers/src/openbao-managed-store.test.ts
git diff --check
```

Compile the managed test into a fresh private mktemp directory with esbuild. Run it with Node.js from /tmp.
Do not run the root runtime build or modify installed runtime bundles.
Report RED/GREEN, failure-origin checks, source freeze, and limits in .superpowers/sdd/production-task-2b3-report.md.
Require parent verification and independent specification/quality review before real-server qualification or manager integration.
