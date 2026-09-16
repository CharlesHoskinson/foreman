# Fable OpenBao correction evidence

Status: Ten audit follow-ups addressed at the requested correction scope. Independent review and
fresh Fable review remain acceptance gates. This record does not qualify live accounts or complete
the pilot, manager, native adapters, or CLI integration.

The [original audit](fable-audit-2026-09-15.md) and its complete receipt remain unchanged.
Its BLOCKED verdict, findings, and parent qualifications are historical evidence.
Earlier green counts in the footgun report are superseded by this candidate-scoped measurement.

## Candidate and artifacts

Worktree: `/root/foreman-native-login-20260915`.
Base revision: `c83b118b7a005fe74d53cc3d64c91f333c622095`; `sourceDirty: true`.
HEAD alone does not identify this candidate. The report records 12 implementation hashes and
616 actual bundle-input hashes. The implementation report adds hashes for the package entry,
identity contract, tests, and build metadata.

- Report: `/root/research/openbao-corrections-evidence-r3VDBR/report/openbao-pilot-report.json`
  SHA-256 `115fa0007fc625e35469b2d0227b0267df29d2a28a17772401b469f176ab659c`.
- Compiled controller: `/root/research/openbao-corrections-evidence-r3VDBR/build/openbao-pilot.mjs`
  SHA-256 `f62774fd74c9b5033e53f87d34c3e558d58d8501bb3132c0146cca54ddf9dcd4`.
- Compiled fake worker: `/root/research/openbao-corrections-evidence-r3VDBR/build/openbao-pilot-worker.mjs`
  SHA-256 `07880d41a6f10bc5d7928991ace3d16160b272600d54c778f426111f8c926200`.
- Build and execution independently identify Node `v24.18.0`, executable SHA-256
  `41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c`.

The compiled controller ran from `/tmp`. Independent content checks matched its source,
bundle-input, executable, and runtime Node hashes. Report mode is 0600. Child exit, listener closure,
and temporary-directory removal all read true. P01/P02/P03/P05/P06/P10 passed; no outcome failed.
P04/P07/P08/P09/P11 remain not-run, `pilotComplete` is false, and CLI exit 1 correctly preserves that
incomplete state. Cleanup on completion does not imply P09 cancellation admission.

## Finding map

| Audit finding | Correction and evidence |
| --- | --- |
| 1. Token failure contract | Fresh build reproduced `Unavailable` versus expected `InvalidInput`. Malformed bounded-header string inputs now return InvalidInput before transport. Non-Redacted/non-string results and unknown callback failures/defects retain Unavailable; typed failures and interruption remain covered. The broker test now names token validation. |
| 2. Stale provider bundles | Broker/controller import source through the explicit testing source entry. Compiler resolves workspace dependencies to source, rejects workspace dist, and checks loaded source hashes. A disposable poisoned-dist control throws under the historical import, while the compiled pilot loads and records the current store hash. |
| 3. Claimed signature verification | Controller requires independent binary and receipt pins and binds the receipt to binary, release/asset URLs, archive digest, and exact signer identities. Changed receipt/binary bytes, wrong receipt identities, absent receipt, and mismatched binary pin all refuse before launch. Report says externally-verified-receipt-binding and makes no runtime GPG claim. |
| 4. Build/runtime provenance | Separate buildEnvironment and runtimeEnvironment include actual Node versions and hashes; dirty state is explicit. A controlled changed build-Node label leaves the runtime measurement unchanged. Unrelated caller source and later changed fixture source cannot replace embedded input hashes. |
| 5. Deletion recovery | Real-server P10 creates a disposable account, removes its current generation, observes NotFound/read, retained name/list, and Conflict/CAS0, then verifies the next generation from newly supplied synthetic material with recorded-generation CAS. Documentation preserves create-only import and requires distinct authorized maintenance recovery; production recovery remains deferred. |
| 6. Backend identity | Implemented readonly CredentialBackendIdentity and Effect-returning makeCredentialBackendIdentity. Tests bind endpoint/mount/namespace/trust changes and reject malformed or synthetic origins. Metadata excludes raw CA and tokens. Manager/readiness plans require the same immutable configuration and provider/account/reference/version binding, without claiming deployment attestation. Interim resolver integration explicitly requires refusal and a zero-fallback-read test; that integration remains deferred. |
| 7. Outage bounds | P05 separately observes sealed and closed endpoints. Store and broker hanging-peer tests use short deadlines and confirm socket closure; broker also tests the five-second cap. Fast sealed response is no longer labeled deadline proof. |
| 8. Mutation coverage | Synchronized write/remove tests pause bootstrap acquisition, mutate material/version arrays, resume, and inspect actual HTTP bytes. Authorized snapshots reach the peer. Existing snapshot implementation already passed; no redundant behavior change was made. |
| 9. Stale green counts | Footgun review now preserves earlier counts as superseded history and links the failing audit and this candidate's exact commands/hashes. |
| 10. Public synthetic export | Fresh built-entry test first observed the unwanted public export. Default package now exports only production factory; explicit @foreman/providers/testing exposes the synthetic factory. Production HTTPS and synthetic loopback/material restrictions stay covered. |

## Verification commands

Run from the worktree unless stated otherwise. No installation or live credential operation is involved.

```bash
npm run build --workspace @foreman/providers
OPENBAO_PILOT_BINARY=/root/research/openbao-pilot-20260915-MYD9Qc/bao OPENBAO_PILOT_SHA256=8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 OPENBAO_PILOT_RECEIPT_SHA256=d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/providers/src/credential-backend-identity.test.ts packages/orchestration/src/openbao-pilot.test.ts scripts/openbao-pilot.test.ts scripts/openbao-pilot/source-binding.test.ts
node --import tsx --test scripts/openbao-pilot.test.ts
npm run typecheck
openspec validate openbao-credential-pilot --strict
openspec validate foredi-08-credential-manager --strict
openspec validate foredi-09-native-credential-lifecycle --strict
git diff --check
node --import tsx scripts/build-openbao-pilot.ts /root/research/openbao-corrections-evidence-r3VDBR/build
```

Results: configured suite 50/50 passed, zero skips; default controller 19 passed with one explicit
missing-integration-input skip. Whole-tree typecheck passed. All three strict OpenSpec validations
passed. Tracked whitespace and explicit untracked-file whitespace checks passed.
The TLS negative control intentionally emits Node's warning when setting
`NODE_TLS_REJECT_UNAUTHORIZED=0`; the test confirms that the store still rejects an untrusted peer.

From `/tmp`:

```bash
node /root/research/openbao-corrections-evidence-r3VDBR/build/openbao-pilot.mjs /root/research/openbao-pilot-20260915-MYD9Qc/bao 8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef /root/research/openbao-corrections-evidence-r3VDBR/report
```

The receipt pin was supplied by the parent from the existing verified artifact, separately from the
verification under test. The controller never derives its expected pin from the receipt being checked.
This records receipt binding, not new controller signature verification.

## Remaining gates

The correction scope specifies safe recovery and host composition but does not implement the manager,
interim resolver integration, readiness cutover, provider refresh ownership, native adapters, or CLI.
The full P01–P11 pilot and release admission remain incomplete. No native credentials, installation,
runtime authority, or historical audit artifacts were changed by this correction package.
