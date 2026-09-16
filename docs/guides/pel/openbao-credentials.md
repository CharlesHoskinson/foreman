# OpenBao credential storage for ForeDi

Status: Release preparation. The implementation and synthetic evidence require review before release admission.

## Scope

The required release design makes OpenBao the sole durable credential authority for managed accounts.
Setup, qualification, and execution must use the same managed account reference.
A missing or denied OpenBao record must not trigger a native-profile or environment fallback.
The current storage implementation does not yet connect all three consumers.
Existing native accounts remain explicitly unmanaged until approved migration and cutover.

The shared credential store supports `agy`, `codex`, `claude`, and `grok`.
AGY identifies Antigravity CLI, not Gemini CLI.

The framework uses `CredentialStorePort` from `@foreman/providers`.
The OpenBao backend implements the same interface used by the synthetic pilot.
Provider-specific native login and refresh remain separate from storage.

The pilot does not register OpenBao references in the default live provider resolver.
Do not treat this guide as evidence that native login migration or provider qualification is complete.
Interim resolver integration must refuse an unrecognized `bao:` reference before any native-profile,
environment, or alternate-account lookup. A proposed integration test supplies that reference while
all fallback sources contain canaries and asserts zero fallback reads and zero worker launches.
That resolver integration and its test remain deferred; the storage pilot does not prove them.

## Interface

### Administrative erasure policy

Managed schema 2 operations use private metadata/data observation and CAS-write ports.
The raw interface below remains the pilot interface. Its soft deletion is not managed lifecycle removal.

The [approved erasure policy](../../superpowers/specs/2026-09-15-openbao-erasure-policy-decision.md) requires protected control evidence inside OpenBao.
Quarantine one account only when that evidence establishes isolated damage and independent sibling authority.
Missing or inconsistent installation/control evidence blocks ordinary backend delivery and mutation.
Unavailable or denied observations block use without asserting confirmed erasure.
Never create an account merely because its credential metadata returns 404.
First import requires explicit provisioning and an exclusive new-identity reservation.
Reconciliation requires separate administrative authority and confirmed repair or retirement.
Neither restart, a caller flag, nor an empty replacement registry clears quarantine.

The [executable PEL policy](../../../examples/pel/openbao-erasure-policy.pel) classifies normalized inputs without host effects.
Its candidate classifications are not readiness or authorization grants.
Run its regression tests from the source checkout:

```text
node --import tsx --test packages/pel/test/openbao-erasure-policy.test.ts
```

The production control store, fencing, reconciliation, and provider integration remain separate release gates.
The policy cannot prove historical erasure if an administrator destroys or forges all evidence in the sole authority.

### Raw pilot operations

| Operation | Input | Result |
| --- | --- | --- |
| `read` | Explicit reference and absolute deadline. | Selected identity, current version, and redacted credential material. |
| `write` | Reference, redacted material, expected version, and deadline. | New KV version after a compare-and-set write. |
| `list` | Explicit provider and deadline. | Validated account names without credential material. |
| `remove` | Reference, selected positive versions, and deadline. | Soft deletion of those versions only. |

References use `bao:<provider>:<account>`.
Account names start with an alphanumeric character and contain at most 64 characters.
Remaining characters can be alphanumeric, period, underscore, or hyphen.

Use expected version zero for a create-only import.
Use the current positive version for a conditional update.
Treat a version conflict as a rejected update, not permission to overwrite another writer.

Removal does not delete metadata, destroy historical versions, or revoke a provider token.
Do not restore an old OAuth refresh token without provider-specific recovery evidence.
After removal of the current version, `read` returns `NotFound`, `list` still includes the account,
and create-only import (`cas: 0`) returns `Conflict` because KV metadata retains its generation.
The real-server P10 experiment verifies those three observations and a conditional write of newly
supplied synthetic material using the recorded generation. Tombstoned account recovery is a distinct
planned maintenance operation requiring explicit authority for the backend, account, and expected generation.
The experiment proves only recorded-generation conditional recovery. An ordinary KV update can also
resurrect the record: KV v2 ACLs cannot distinguish that write from refresh, and soft deletion does not
advance the generation. CAS and a read-before-write check do not enforce maintenance authority.
The manager recovery operation is not implemented. Ordinary import stays create-only; no operation
automatically deletes metadata, undeletes a version, or replays a previous refresh token.

## Host configuration

### Response compatibility

The current store uses strict response field allowlists and credential `schemaVersion: 1`.
Read metadata and write results permit `created_time`, `custom_metadata`, `deletion_time`, `destroyed`, and `version`. Version is required.
List data permits `keys` and `key_info`. Keys are required.
Read envelopes require the selected provider, account, and validated material. Unknown schema fields return `InvalidResponse`.
Future OpenBao fields or schema versions require explicit compatibility review and fixtures before admission.
The synthetic evidence uses OpenBao v2.6.2. It does not establish compatibility with every server version.

The store maps unsuccessful HTTP responses to a closed error vocabulary:

| HTTP response | Store code |
| --- | --- |
| 403 | `Denied` |
| 404 | `NotFound` |
| 409, or 400 containing the recognized check-and-set mismatch text | `Conflict` |
| 502, 503, 504 | `Unavailable` |
| Other unsuccessful statuses, including 429 and 500 | `InvalidResponse` |

Transport failures also return `Unavailable`. Operation deadlines return `Timeout`.
These mappings are the current store contract, not a classification of every OpenBao deployment state.
No status change or automatic retry policy is implied.

### Configuration inputs

`makeOpenBaoCredentialStore` accepts an explicit configuration object.
The production endpoint must be a canonical HTTPS origin with certificate verification enabled.
HTTPS IPv6 literals use exact certificate IP SAN matching and retain certificate-chain verification.
DNS names and IPv4 endpoints retain Node's default hostname verification.
The configuration includes a validated KV mount, optional namespace, optional CA certificate, and host token callback.

The callback acquires a redacted OpenBao token for each operation.
The callback has no receiver contract. Pass `token: () => service.acquire()` or an explicitly bound method.
An unbound method that requires `this` can fail with sanitized `Unavailable`.
The callback and HTTP request share the operation deadline, capped at five seconds.
The backend does not retain a bootstrap token between operations.
It does not acquire credentials from a provider profile or alternate environment variable.
Malformed string token values return `InvalidInput` before transport. Unknown callback failures,
defects, and non-Redacted or non-string callback results return `Unavailable`; declared failure codes
and caller interruption retain their meaning.

`makeCredentialBackendIdentity` returns an Effect containing a frozen `CredentialBackendIdentity`
for the canonical HTTPS endpoint, mount, namespace, and trust configuration digest.
Supply either `caPem` or an explicit `systemTrustIdentity` naming the host trust policy.
Returned metadata contains neither raw CA PEM nor bootstrap tokens.
This identifies configuration, not a running deployment or equivalent OS trust stores across hosts.
`systemTrustIdentity` is a caller-declared policy label. It does not measure anchors or grant readiness.
Changing the label can conservatively invalidate identity. Relabeling cannot replace backend qualification.
Production readiness must bind observed effective trust or an explicit CA bundle, plus authenticated backend identity.
An anchor change under an unchanged label must invalidate readiness. Missing trust evidence must refuse qualification.
These readiness checks remain a production gate, not an implemented platform trust manager.
`makeOpenBaoCredentialBackend` snapshots and validates one configuration, then returns the identity
and production store together. Construct separate least-privilege runtime and maintenance instances
with the same backend configuration and different token callbacks; their backend identities match.
The planned manager must enforce operation authority across those instances. Setup, readiness,
authorization, and delivery must bind the identity `id` to provider, account,
reference, and current KV version; execution must revalidate those bindings before delivery.

Before recovery or refresh ships, add an authorized metadata observation capability for the exact
backend/provider/account. It must return current KV generation, selected version deletion status,
destruction status, and durable lifecycle generation without credential material. Grant only the
required metadata read path; list permission alone is insufficient. The present store has no such
operation, and `NotFound` does not expose a generation.

The manager must serialize deletion, recovery and every refresh writer across processes under a
durable lifecycle authority in OpenBao. All managed writers must participate; native writers outside
that protocol block migration. The design must prove atomic or fenced refusal of stale owners and
crash-safe tombstones before accepting it. A local database must not become a second credential or
lifecycle authority. A refresh started before deletion must never resurrect the account after deletion
commits, even when its KV CAS still matches. Recovery must require separate authority and new material;
stale lifecycle or observed metadata generations must refuse. These capabilities remain unimplemented.

The proposed CM08 candidate uses a single-key versioned envelope with active or tombstoned state.
Managed deletion writes a tombstone with CAS, which advances the version and fences stale refresh commits.
Recovery writes fresh active material with CAS against the current tombstone under separate authority.
Strict envelope and metadata checks refuse inconsistent state after restart.
All managed mutations require the manager's restricted write authority.
Raw `remove` remains selected historical-version maintenance after the lifecycle transition.
Observed administrative soft deletion requires quarantine. It never authorizes automatic recreation.
Administrative policy bypass cannot be fenced by a metadata precheck.
This candidate protects durable commits. Provider refresh ownership and ambiguous rotation remain separate unimplemented gates.
See the [CM08 design](../../../openspec/changes/foredi-08-credential-manager/design.md) for race outcomes and admission requirements.

Configure the host's token source separately.
Do not use an OpenBao root token as the framework's runtime token.
Give the runtime policy only the required provider and account paths.
Separate import and maintenance authority from ordinary read authority where practical.

The KV v2 path families are:

- `<mount>/data/providers/<provider>/<account>` for reads and versioned writes.
- `<mount>/metadata/providers/<provider>` for account listing.
- `<mount>/delete/providers/<provider>/<account>` for explicit-version soft deletion.

Review policy grants for each path family.
Consider requiring CAS at the mount or key metadata level to constrain other writers.
Never grant arbitrary administrative paths merely to make runtime requests succeed.

## Programmatic integration

Use the configured store through Effect dependency injection.
The following function receives configuration from a trusted host composition root.

```typescript
import { Effect } from 'effect';
import {
  CredentialStorePort,
  makeOpenBaoCredentialStore,
  type OpenBaoCredentialStoreConfig,
} from '@foreman/providers';

export function readAccount(
  config: OpenBaoCredentialStoreConfig,
  reference: string,
  deadline: number,
) {
  return Effect.gen(function* () {
    const store = yield* CredentialStorePort;
    return yield* store.read(reference, deadline);
  }).pipe(
    Effect.provideService(CredentialStorePort, makeOpenBaoCredentialStore(config)),
  );
}
```

Keep returned secret material inside the trusted host.
Provider adapters validate their credential shape and deliver only permitted access material to workers.
Do not serialize the returned material into Pel journals, prompts, artifacts, or Obsidian.

## Available commands

No `foreman credentials` or `foreman openbao` command is implemented.
The framework integration uses the TypeScript interface above.
The following commands belong to the OpenBao CLI, not the Foreman CLI.

For an existing service, configure its HTTPS address and CA trust before inspection.
Use your approved token helper or authenticated session for operations that require authentication.
Do not put tokens in command arguments or repository files.

```bash
bao version
bao status
```

`bao status` reads the service selected by `BAO_ADDR`.
Exit code 2 means the service is sealed, not ready for credential access.
Configure `BAO_CACERT` when the service uses a private certificate authority.
Do not disable certificate verification.

For the examples below, the existing KV v2 mount is named `foreman`.
These commands list account names without reading credential values.
They require list permission on the corresponding metadata paths.

```bash
bao kv list -mount=foreman providers/agy
bao kv list -mount=foreman providers/codex
bao kv list -mount=foreman providers/claude
bao kv list -mount=foreman providers/grok
```

Account names can also be sensitive. Do not publish their output without review.
Use the framework interface for credential reads and writes with schema validation.
Do not use raw CLI writes as a substitute for the framework record format.

The framework calls are:

```typescript
store.read('bao:codex:work', deadline);
store.write('bao:codex:work', material, expectedVersion, deadline);
store.list('codex', deadline);
store.remove('bao:codex:work', [version], deadline);
```

Each call returns an Effect. The trusted host runs that Effect.
`material` is a redacted string record, not a plaintext command-line argument.
`deadline` is an absolute Unix timestamp in milliseconds.
The `remove` call soft-deletes only the selected versions and requires separate maintenance authority.

Run these development checks from the repository root:

```bash
npm run build --workspace @foreman/providers
node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/orchestration/src/openbao-pilot.test.ts
npm run typecheck
bash dependencies/check-drift.sh
```

These commands do not import live credentials or install the candidate runtime.
The dependency check can report `bao` as an optional manifest-only entry.
It does not check service health, policies, or native provider readiness.

## Synthetic testing

Package consumers access `makeSyntheticOpenBaoCredentialStore` through the explicit
`@foreman/providers/testing` entry for disposable loopback HTTP fixtures.
The pilot uses relative source imports to bind the compiled fixture to current source.
Package export rules do not prevent arbitrary relative source imports.
Fresh provider and orchestration default-entry builds exclude the synthetic factory and broker.
Regression tests inspect source reachability, emitted code, and exports selected by package metadata.
Disposable contaminated-entry controls prove that the export predicate detects synthetic exposure.
The synthetic factory accepts only synthetic material values with the required marker.
Do not use this factory for persistent services or real account credentials.

The binary and runtime directory belong to the fixture.
The fixture does not replace the installed Foreman runtime or register a service.
Reports must identify their evidence as synthetic and retain the exact implementation and binary hashes.
Pilot tests import the current TypeScript source. The compiler resolves workspace dependencies to
source and rejects workspace `dist` inputs. A disposable poisoned-dist control verifies this boundary.
Reports record the dirty state, source and exact bundle-input hashes, and executable hash.
The build compares the complete esbuild metafile input set with the hash manifest.
Completeness covers loaded modules only. The manifest does not capture every configuration or resolution input.
For example, consulted `tsconfig.json` settings and `package.json` resolution fields can affect output without becoming loaded modules.
The executable digest binds the produced output. These checks do not prove a fully reproducible build.
`bundleInputs` records that sorted input set. Missing or unexpected entries cause build refusal.
Capture supports `.mts` and `.cts` explicitly. Unknown extensions fail closed before loading.
Workspace `dist` refusal is independent of extension.
The prior audit did not demonstrate successful `.node` or `.wasm` bundling outside capture.
Those inputs now receive an explicit unsupported-loader refusal.
`buildEnvironment` identifies the build Node executable. `runtimeEnvironment` measures the executing
Node executable independently. Dependency versions describe build inputs.

The controller binds an externally verified integrity receipt. It does not run GPG verification.
The trusted caller must independently provide both expected SHA-256 values: binary and receipt.
The receipt binds the binary, release and asset URLs, archive digest, and expected signer identities.
Do not calculate the expected pin from the same untrusted receipt inside the verifier.
The controller copies verified bytes to its private runtime and launches that owned executable.
`sourceExecutable` identifies the original receipt path. `executable` identifies the launched snapshot.
`executedImageSha256` records its trusted image digest. Replacing the original path cannot change this image.
Same-UID or root tampering with owned files or runtime memory remains a host trust boundary.
Snapshot filesystem failures return sanitized `SnapshotIOFailed`. Digest mismatches remain `InvalidProvenance`.
Executable mode failures and actual child spawn errors retain `SpawnFailed`.
Controller interruption remains interruption and waits for controller-owned runtime cleanup.
The standalone snapshot helper does not own runtime removal.
Its interruption regression observes filesystem request submission, not interruption during a partial read or write.

`runOpenBaoPilotWithOptions.onPhase` is trusted in-process synthetic test instrumentation.
The acquired hook runs before receipt binding and snapshot verification. The hook receives runtime paths and can execute arbitrary host code.
It is not an untrusted plugin or credential interface. Provenance checks do not authenticate the callback.
The CLI and ordinary `runOpenBaoPilot` entry do not supply this hook.

Administrative requests use direct loopback HTTP with `agent: false`, bounded responses, deadlines,
and socket cleanup. They do not follow redirects or inherit environment proxy routing.
A disposable proxy-enabled Node control observes the synthetic root canary with default fetch.
The corrected transport produces zero proxy requests in the same fixture.
Readiness requires HTTP 200. Uninitialized 501 and sealed 503 responses remain unready.
Reports retain child exit code, signal, and spawn-failure status in `processExit`.
The report scan includes deletion-experiment canaries held only in memory.

```bash
OPENBAO_PILOT_BINARY=/path/to/verified/bao OPENBAO_PILOT_SHA256='TRUSTED_BINARY_SHA256' OPENBAO_PILOT_RECEIPT_SHA256='TRUSTED_RECEIPT_SHA256' node --import tsx --test scripts/openbao-pilot.test.ts
node --import tsx scripts/build-openbao-pilot.ts /private/pilot-build
node /private/pilot-build/openbao-pilot.mjs /path/to/verified/bao 'TRUSTED_BINARY_SHA256' 'TRUSTED_RECEIPT_SHA256' /private/pilot-report
```

The compiled command works from an unrelated directory. It exits 1 while `pilotComplete` is false,
even when the implemented subset passes. P04/P07/P08/P09/P11 remain `not-run`.
Controller refusal or failure also returns exit 1. Exit status alone cannot distinguish these outcomes.
Use a fresh output directory for each invocation. Require terminal completion and a validated current report to identify an incomplete completed run.
Failure can leave absent, partial, or non-authoritative output, including a report written before interruption.
File existence alone does not establish completion. An older report in a reused directory is not evidence for the current invocation.
`pilotComplete` requires exactly one passed outcome for every ID from P01 through P11.
Every passed status must also have `passed: true`. Missing, duplicate, unknown, failed, and not-run outcomes fail completion.
This completion predicate does not implement P11's full evidence validator.
P05 records fast sealed and closed-endpoint responses. Separate hanging-peer tests prove deadline
enforcement and socket closure. The sealed response does not prove the deadline.
The [earlier correction evidence](../../releases/return-of-the-foredi/fable-corrections-2026-09-15.md) remains a historical receipt.
The [follow-up evidence](../../releases/return-of-the-foredi/fable-followup-2026-09-15.md) records the later bounded corrections.
The [final-hardening evidence](../../releases/return-of-the-foredi/openbao-final-hardening-2026-09-15.md) records the subsequent nine dispositions.
The [LOW finding evidence](../../releases/return-of-the-foredi/openbao-low-findings-2026-09-15.md) qualifies those claims and records the later test improvements.

## Packaged build boundary

Compiled package exports remain supported. The pilot's source capture does not replace that repository contract.
Root `pretest`, `pretest:providers`, `pretest:pel-authoring`, and `pretest:adoption` already rebuild providers.
Root `build` also rebuilds providers. Direct imports or test invocations can bypass these hooks.
Production admission must verify current-source provenance for every packaged consumer.
A stale artifact must refuse admission even when its package version matches.
This broader release gate remains open. It is not a newly demonstrated store defect.

## Release and migration gates

Before live migration, verify production TLS, bootstrap authentication, unseal ownership, audit configuration, backup recovery, and policy boundaries.
Establish one owner for native refresh across broker processes and ordinary vendor CLI sessions.
Qualify AGY, Codex, Claude, and Grok independently.

Import only explicitly selected accounts after migration approval.
Verify each imported version before cutover.
Retain recovery options without automatically replaying expired or rotated refresh tokens.

The release gate list is [the ForeDi integration record](../../../openspec/changes/openbao-credential-pilot/release-integration.md).

## Sources

- [OpenBao KV v2](https://openbao.org/docs/secrets/kv/kv-v2/)
- [KV v2 API](https://openbao.org/docs/api/secret/kv/kv-v2/)
- [OpenBao audit devices](https://openbao.org/docs/audit/)
- [OpenBao seal concepts](https://openbao.org/docs/concepts/seal/)
