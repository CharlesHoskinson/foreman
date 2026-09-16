# OpenBao managed observations implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development after the dependency review accepts this brief.

**Goal:** Read managed metadata and exact-version data without conflating missing credentials with account absence.

**Architecture:** Use the accepted private HTTP session. Expose only observation methods in this stage. Keep authorization and writes outside this adapter.

**Tech Stack:** Node.js 24, strict TypeScript, Effect, existing duplicate-key JSON parser, and node:test.

## Global constraints

- OpenBao is the sole durable credential and lifecycle authority. WSL and Linux are equal production targets.
- Do not add dependencies, a daemon, a scheduler, a local lifecycle database, or managed fallback.
- Do not perform live operations, installations, host interruptions, commits, index writes, or installed runtime updates during these tasks.
- Preserve native-login source changes and historical evidence. Keep credential values outside PEL, receipts, models, logs, and command arguments.
- Use only synthetic loopback HTTP peers and synthetic material in tests.
- Skip graphify, as required by AGENT_TRAPS.md.
- Do not modify the accepted raw store, HTTP API, lifecycle validator, package exports, or manifests.

## Admission and scope

Status: Candidate for independent review. Do not dispatch before Stage 2B.1 acceptance.
This brief refines Stage 2B.2 of 2026-09-15-openbao-production-task-2b.md.
The canonical production contract remains 2026-09-15-openbao-production-contracts.md.
Only the two files below may change.

- Create `packages/providers/src/openbao-managed-store.ts`.
- Create `packages/providers/src/openbao-managed-store.test.ts`.

Do not implement writes, migration, list, history pruning, manager authorization, readiness, or delivery.
Do not add placeholder methods for those operations.
The constructor names remain stable for later extension. Their return type in this stage contains only observations.

## Exact interfaces

Import AccountKey, CurrentMetadata, Envelope, and ManagedFailure from credential-lifecycle.ts.
Import OpenBaoCredentialStoreConfig from credential-store.ts.
Import makeOpenBaoHttpClient and decodeOpenBaoJson from openbao-http.ts.

```typescript
import type { Effect } from 'effect';
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
  readonly observeMetadata: (key: AccountKey, deadline: number) => Effect.Effect<MetadataObservation, ManagedFailure>;
  readonly observeData: (key: AccountKey, observed: CurrentMetadata, deadline: number) => Effect.Effect<DataObservation, ManagedFailure>;
}
export declare function makeOpenBaoManagedStore(config: OpenBaoCredentialStoreConfig): ManagedObservationPort;
export declare function makeSyntheticOpenBaoManagedStore(config: OpenBaoCredentialStoreConfig): ManagedObservationPort;
```

## Host boundary and errors

Validate configuration with ordinary own data descriptors before constructing the HTTP client.
Require endpoint, mount, and token. Permit only namespace and caPem as optional fields.
Require string endpoint/mount, a function token, and strings for supplied namespace/caPem.
Preserve the HTTP client's canonical endpoint, component, namespace, and transport policy validation.
Refuse unexpected fields, symbols, accessors, and nonplain prototypes.
Catch inspection exceptions without exposing the input or exception.
For invalid configuration, return an observation port whose operations fail with closed InvalidInput.
Constructors must not throw, acquire tokens, or start requests.

At Effect execution, validate and snapshot operation arguments before token acquisition.
Require the exact AccountKey shape and the lifecycle component grammar.
Require observed metadata to have exactly currentVersion and the three false deletion flags.
Require positive safe currentVersion and a finite future deadline.
Malformed caller values and inspection exceptions return InvalidInput with zero token calls.
Keep each complete operation within the HTTP session's five-second cap.
Preserve Effect interruption. Do not retry or substitute another source.

Keep semantic failures inside the callback as values until the HTTP run boundary returns.
For example, an operation returning Effect<A, ManagedFailure> can use Effect.either inside client.run.
Unwrap that Either after mapping outer CredentialStoreFailure values.
Do not widen OpenBaoHttpClient.run or cast ManagedFailure to CredentialStoreFailure.
Map outer InvalidInput, Denied, Unavailable, and Timeout to the same managed code.
Map other outer bootstrap failure codes to Unavailable.
Map unknown callback failures or defects to closed Unavailable.
Return only `{ _tag: 'ManagedFailure', code }` on failure, without cause fields.

## Metadata observation

Request only `GET /v1/{mount}/metadata/providers/{provider}/{account}`.
Convert NotFound to metadataAbsent only within this exact session.request call.
A token callback NotFound must remain Unavailable and must not produce an absence result.
Preserve request Denied, Timeout, and Unavailable as managed failures.
Treat other request or decoding failures as Quarantined.

Decode bounded JSON through decodeOpenBaoJson.
The duplicate-key decoder creates null-prototype records. They are valid wire records, not valid host input records.
At the wire boundary, accept only own-data records whose prototype is null or Object.prototype.
Keep the stricter Object.prototype requirement for caller configuration, account keys, and supplied metadata.
Use the existing raw top-level response allowlist, requiring data.
Allow data fields cas_required, created_time, current_version, custom_metadata, delete_version_after,
max_versions, oldest_version, updated_time, versions, current_metadata_version, and metadata_cas_required. Require current_version and versions.
The user approved the two additional optional fields after a real OpenBao 2.6.2 compatibility failure.
Require a nonnegative safe integer for supplied current_metadata_version and a boolean for supplied metadata_cas_required.
Keep all other unknown-field rejection. Neither field establishes data generation, authorization, or readiness.
Add the complete observed response fixture, malformed-field controls, and an unknown-field control before applying this correction.
Require versions to be a plain record with a current-version entry.
Require positive safe current_version. Version zero, absent entries, and malformed structure return Quarantined.
Allow current-version fields created_time, deletion_time, and destroyed. Require deletion_time and destroyed.
Require destroyed to equal false and deletion_time to equal the empty string.
Every nonempty, malformed, or missing deletion time causes quarantine. No unsafe timestamp needs classification because none can succeed.
Do not interpret optional retention or custom metadata as readiness or lifecycle authority.
Return a frozen metadataPresent result with a copied, frozen CurrentMetadata value.
Metadata 404 establishes only observed absence, never historical absence or authorization to import.

## Exact-version data observation

Use one HTTP session for these three requests, in order.

1. Read metadata again. Require present safe state and the caller's exact currentVersion.
2. Read `GET /v1/{mount}/data/providers/{provider}/{account}?version={currentVersion}`.
3. After valid data decoding, read metadata again. Require the same safe generation.

Any metadata absence or version change returns Quarantined. Do not return material from a failed operation.
Do not issue the data request after unsafe initial metadata.
Data HTTP 404 returns Quarantined, never metadataAbsent.
Require the outer data object to contain exactly data and metadata.
Require data.metadata.version, destroyed, and deletion_time.
Allow created_time and custom_metadata as optional data metadata fields.
Require destroyed false and deletion_time empty. Require version to equal the observed currentVersion.

For schema 2, require a wire record and the exact lifecycle field set.
Validate exact wire fields before conversion. Do not remove unknown fields to make validation pass.
Copy the validated envelope fields into a new ordinary object.
Copy every material entry into a new ordinary object with own data properties before Redacted wrapping.
Use Object.defineProperty or an equivalent safe own-data operation when copying material keys.
Never use a prototype-changing assignment or change the parser's objects in place.
Then call validateEnvelope with the ordinary envelope and wrapped ordinary material.
Do not add material to tombstones. Require envelope generation to equal the independently parsed wire version.
The lifecycle validator must copy and freeze material before it is returned.
The synthetic constructor must additionally reject any active material value without the foreman-synthetic- prefix.
Reject invalid wire shapes, malformed JSON/UTF-8, duplicate keys, and oversized responses with closed Quarantined.

For a schema 1 wire record, return only its material-free schema1 classification after all version and metadata checks.
This classification detects a legacy schema. It does not validate legacy identity or material for migration.
The later migration contract must supply a separate validated legacy observation before it can permit a migration write.
Do not return unknown fields, raw data, or legacy material through classification.
Freeze successful observation wrappers. This is consistency at the last observation, not a lock or a delivery grant.

## Test cycle

- [ ] Add the observation test scaffold from Stage 2B.2 in the Task 2B plan.
- [ ] Require deletion_time and destroyed in every successful data metadata fixture.
- [ ] Run the test before the new implementation exists. Record the missing-module RED.
- [ ] Implement only metadata observation. Run the metadata cases to GREEN.
- [ ] Add the table-driven controls below before completing data observation.
- [ ] Implement the exact three-request observation sequence. Run all focused cases to GREEN.
- [ ] Inspect request traces and closed failures independently.

Use these concrete fixture values for successful observations.

```typescript
const key = { provider: 'codex', account: 'synthetic' } as const;
const metadata = { currentVersion: 7, deleted: false, destroyed: false, deletionScheduled: false };
const wireMetadata = { data: { current_version: 7, versions: {
  '7': { destroyed: false, deletion_time: '' },
} } };
const wireData = { data: {
  data: { ...key, schemaVersion: 2, generation: 7, state: 'active',
    material: { access: 'foreman-synthetic-observation' } },
  metadata: { version: 7, destroyed: false, deletion_time: '' },
} };
```

| Control | Exact assertion |
| --- | --- |
| Metadata 404 | metadataAbsent and one metadata request |
| Bootstrap NotFound | Unavailable, zero HTTP requests |
| Metadata 403 | Denied, no absence result |
| Data 404 after safe metadata | Quarantined and no returned material |
| current_version 0, missing current entry, destroyed true, nonempty or missing deletion_time | Quarantined, zero data requests |
| Data version 6 or envelope generation 6 with metadata version 7 | Quarantined |
| Initial or final metadata changes to version 8 | Quarantined |
| Safe active records for all four providers | Exact identity, dataVersion 7, frozen copied Redacted material |
| Actual HTTP-decoded null-prototype active and tombstone records | Successful conversion without weakening host-input checks |
| Unknown envelope fields and prototype-related material keys | Unknown envelope fields rejected, valid keys copied as own data, no prototype mutation |
| Tombstone | Material-free schema 2 result |
| Schema 1 containing a canary | Exact material-free classification, no canary in JSON output |
| Missing data flags | Quarantined |
| Duplicate JSON keys, invalid UTF-8, oversized response | Quarantined without body leakage |
| Malformed config, key, or supplied metadata, hostile proxies/accessors | InvalidInput and zero token/network calls |
| Constructor and unexecuted Effect | Zero token/network calls |
| Mutated arguments while token waits | Requests and checks use the validated snapshot |
| Synthetic active material without required prefix | Quarantined |
| Production constructor with HTTP endpoint | InvalidInput, zero token calls |
| Token throw, defect, unknown typed failure | Closed Unavailable |
| Hanging token/peer | Closed Timeout |
| Interruption during request | Interrupted Effect, socket closed, no retries |
| Successful observeData | Exactly metadata, versioned data, metadata requests and one token acquisition |

## Verification and handoff

Run from /root/foreman-native-login-20260915.

```text
node --import tsx --test packages/providers/src/openbao-managed-store.test.ts
npm run typecheck
node --import tsx --test packages/providers/src/credential-lifecycle.test.ts packages/providers/src/openbao-http.test.ts packages/providers/src/openbao-credential-store.test.ts packages/providers/src/openbao-managed-store.test.ts
git diff --check
```

Compile the managed test with esbuild into a fresh mktemp directory. Run it with Node.js from /tmp.
Do not run the root runtime build. Do not update installed runtime bundles.
Report RED/GREEN commands, assertions, source freeze, and limitations in .superpowers/sdd/production-task-2b2-report.md.
Require parent verification and independent specification/quality review before Stage 2B.3.
This task does not qualify real OpenBao CAS, persistence, manager authorization, migration, or either production platform.
