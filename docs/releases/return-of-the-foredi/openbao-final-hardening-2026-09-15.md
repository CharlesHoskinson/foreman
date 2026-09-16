# OpenBao final hardening evidence

Status: Bounded corrections implemented and tested. Release acceptance remains open.
This record supplements earlier audit and correction receipts. It does not replace them.
The preceding verified Fable 5.1 audit returned WARNING on snapshot `5fb80f832e7e741bdb1f6f0808a8fde350eca36ef8a1fb1cea66f06f062948c9`.
That audit supported the preceding 19 corrections and identified nine further concerns.
Its receipt is `/root/research/foreman-fable-followup-audit-yY0UIh/audit.json`.

## Nine dispositions

| Concern | Disposition and evidence |
| --- | --- |
| CM08 implementability | Proposed single-key active/tombstoned envelope, CAS-advancing deletion, authorized recovery, strict metadata observation, and restricted writers specified. Implementation and race proof remain open. |
| Complete bundle provenance | Actual esbuild metafile inputs must equal captured hash keys. Missing, unexpected, invalid-hash, dist-extension, and unsupported-loader controls refuse. `.mts` and `.cts` capture succeeds. |
| Constant completion | Completion derives from exactly P01–P11, unique IDs, passed status, and Boolean true flags. All-eleven success passes. Empty, missing, duplicate, unknown, failed, not-run, and inconsistent flags refuse. |
| Actual spawn failure | Missing executable yields `{code:null, signal:null, spawnFailed:true}`. Missing interpreter reaches controller launch, returns SpawnFailed, removes owned runtime, and publishes no report. |
| Snapshot I/O attribution | EEXIST returns SnapshotIOFailed and preserves existing bytes. Controller cleanup passes. Digest mismatch retains InvalidProvenance. Caller interruption remains interruption. |
| IPv6 literals | Verified HTTPS `::1` succeeds. Untrusted CA and wrong IP SAN refuse before HTTP delivery. Malformed URL refuses before token acquisition. |
| Stale task tracking | Tasks 8/9 and scoped 10a/12a are complete. Worker admission and full experiments remain unchecked. Test environment names match implementation. |
| Trust label advisory | `systemTrustIdentity` remains a declarative label. Future readiness requires observed effective trust or explicit CA configuration plus authenticated backend identity. Relabeling cannot qualify. |
| Packaged build advisory | Existing compiled exports and npm rebuild hooks remain. Future admission must refuse stale packaged consumers. Direct invocation can bypass supported hooks. |

The CM08 candidate fences durable commits, not provider-side refresh effects.
A losing refresh cannot persist or deliver returned material. Native ownership, ambiguous rotation, reconciliation, and revocation remain separate gates.
Observed administrative deletion requires quarantine. Concurrent administrative policy bypass cannot be fenced by a metadata precheck.
Raw `remove` remains selected-version maintenance. It does not implement normal managed deletion.

The prior audit's `.node`/`.wasm` bypass claim lacked a successful bundled-input example.
This package explicitly refuses those unsupported loaders. It does not claim that the earlier build successfully bundled them.

## RED and GREEN

The TDD controls ran before executable changes.
The initial final-hardening/controller run produced three expected failures: missing completion function and two InvalidProvenance-versus-SnapshotIOFailed mismatches.
The initial IPv6 trusted-certificate test returned Unavailable.
The initial build-input tests failed their explicit missing-validation assertions.
Actual missing-executable and missing-interpreter tests passed existing process code. No process-control rewrite was necessary.

Bracket removal exposed another installed Node behavior.
Node v24.18.0 returns an empty string from `domainToASCII('::1')` inside its default TLS identity checker.
A standalone HTTPS request then rejected a trusted certificate containing SAN `::1`.
The correction uses `X509Certificate.checkIP` only for validated IPv6 literals and captures the expected address.
Certificate-chain verification remains enabled. DNS and IPv4 use the default checker.
Malformed certificate input returns a closed error from the callback.

Node documents exact iPAddress SAN matching for [X509Certificate.checkIP](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html#x509checkipip).
The [TLS documentation](https://github.com/nodejs/node/blob/main/doc/api/tls.md) states that identity checking follows certificate trust checks.
The regression uses a static synthetic certificate. OpenSSL generated it once outside the test.
The test has an explicit IPv6-loopback capability guard. No capability skip occurred on this host.

## Commands and measured results

Worktree: `/root/foreman-native-login-20260915`.
Base revision: `c83b118b7a005fe74d53cc3d64c91f333c622095`. The worktree contains uncommitted changes.

```text
npm run build --workspace @foreman/providers
Result: exit 0.

env OPENBAO_PILOT_BINARY=/root/research/openbao-pilot-20260915-MYD9Qc/bao OPENBAO_PILOT_SHA256=8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 OPENBAO_PILOT_RECEIPT_SHA256=d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/providers/src/credential-backend-identity.test.ts packages/orchestration/src/openbao-pilot.test.ts scripts/openbao-pilot.test.ts scripts/openbao-pilot/*.test.ts
Result: 66 passed, 0 failed, 0 skipped.

node --import tsx --test scripts/openbao-pilot.test.ts
Result: 21 passed, 0 failed, 1 explicit real-binary capability skip.

npm run typecheck
Result: exit 0, both project builds and whole-tree check.

openspec validate foredi-08-credential-manager --strict
openspec validate foredi-09-native-credential-lifecycle --strict
openspec validate openbao-credential-pilot --strict
Result: all three valid.

git diff --check
Result: exit 0.

git diff --no-index --check -- /dev/null PATH
Result: 62 untracked files checked, no whitespace diagnostics.
```

The untracked-file checker treats exit 1 with empty diagnostics as an ordinary new-file difference.
A disposable trailing-whitespace fixture produced diagnostics and was rejected before the repository result was accepted.

The existing TLS-disable negative control emits Node's expected environment warning.
That control proves the store still refuses an untrusted certificate. It does not disable the store's verification.

## Compiled execution from /tmp

```text
node --import tsx scripts/build-openbao-pilot.ts /tmp/foreman-openbao-final-hardening-VYc4wJ/build
Result: exit 0.

cwd=/tmp
node /tmp/foreman-openbao-final-hardening-VYc4wJ/build/openbao-pilot.mjs /root/research/openbao-pilot-20260915-MYD9Qc/bao 8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef /tmp/foreman-openbao-final-hardening-VYc4wJ/report
```

The controller returned exit 1 because derived `pilotComplete` was false.
P01/P02/P03/P05/P06/P10 passed. P04/P07/P08/P09/P11 remained not-run. No outcome failed.
Child exit was code 0, signal null, spawnFailed false.
All three cleanup flags were true. The private runtime no longer existed.
The report mode was 0600. The snapshot test independently confirmed executable mode 0500 and digest preservation.

An independent readback compared the actual input set with all hash keys and rehashed all input files.
All 616 bundle inputs and 13 implementation files matched.
Runtime Node identity and executable digest matched the actual running files.

| Artifact | SHA-256 |
| --- | --- |
| Implementer report | `a07ac4c1fa2a9ffa398ac6d81b26ed91f36e197afcd107e07ba7941bb88082c2` |
| Implementer compiled controller | `87b22a611188c2a20a74815e928a400aa84823618bf62a0f2510e3448b6ee6c9` |
| Node v24.18.0 | `41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c` |
| Parent independent report | `d3aa9205828e24183ec02c2bb1e6de631ccaf6b5307a40c5fe13d903472d38c4` |
| Parent independent controller | `3f5d4d3d7301d56c3feafa7f0050334a40a97c48051fae51a96ed86fd36afa70` |

The parent independently repeated builds, tests, typecheck, compiled execution, hashes, modes, and cleanup after executable freeze.
Its durable report is `/root/research/openbao-parent-final-hardening-cxxOcn/openbao-pilot-report.json`.
Each report binds its own independently produced controller digest.

## Remaining gates

P04/P07/P08/P09/P11, full P11 validation, and fake-worker admission remain incomplete.
The credential manager, single-key lifecycle implementation, CLI, and default resolver integration remain incomplete.
Production trust qualification and packaged-consumer provenance admission remain incomplete.
Provider-side ownership, native delivery, migration, qualification, and release acceptance remain incomplete.
OpenBao remains the sole planned durable authority. No live credential, installed runtime, or native transport changed in this package.
