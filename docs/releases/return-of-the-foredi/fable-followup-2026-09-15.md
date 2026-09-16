# Fable follow-up correction evidence

Status: Bounded synthetic corrections implemented. Independent Fable review remains pending.
This document does not establish release acceptance, native qualification, or live credential readiness.

## Audit binding

The previous Fable 5.1 receipt returned WARNING for snapshot
`8e0171adfb9aa0b260d253737e609871515130245312bd2770cb5d533ef5a261`.
Its two medium and seven low findings define this follow-up package.
The receipt remains at `/root/research/foreman-fable-corrections-retry-EAqkpk/audit.json`.
Earlier evidence remains historical and unchanged.

## Corrections and limits

| Concern | Result |
| --- | --- |
| Recovery authorization | P10 now reports recorded-generation conditional recovery. Manager metadata observation and durable OpenBao lifecycle authority remain explicit design gates. CM08 adds denied-observation, stale-recovery, and refresh-versus-deletion scenarios. |
| Synthetic entry reachability | Fresh provider and orchestration entry builds exclude synthetic factory and broker exports. Their source graph and emitted code also exclude those entry points. Relative pilot source imports remain intentional. |
| Binary launch race | The controller launches verified bytes from its owned private snapshot. Replacing the original file cannot change the snapshot. Same-UID/root tampering remains a host trust boundary. |
| Provenance test scope | The renamed test covers unrelated cwd and independent build/runtime identities. The separate stale-source and poisoned-dist controls remain. |
| Administrative proxy | A disposable proxy-enabled Node child exposes a synthetic canary through default fetch. Corrected direct HTTP produces zero proxy requests. Deadlines, response bounds, cancellation and sanitized setup failures pass. |
| Identity/store composition | `makeOpenBaoCredentialBackend` constructs both from one immutable configuration snapshot. Runtime and maintenance instances can use different token callbacks with matching backend identities. Manager policy remains deferred. |
| Evidence completeness | The report scan registers actual deletion-experiment material. `processExit` preserves code, signal, and spawn-failure status. P11 remains incomplete. |
| Readiness | Only HTTP 200 qualifies. Tests exercise transient 501/503 responses and bounded unhealthy timeout. |
| Built-entry freshness | Tests build disposable entries from current source at paths selected by package metadata. Contaminated-entry negative controls fail the export predicate. The stale-dist-only test was removed. |

OpenBao remains the sole durable authority for managed credentials and lifecycle state.
Ordinary KV update authority cannot enforce manager recovery policy.
Soft deletion leaves the KV generation unchanged, so CAS alone cannot prevent resurrection.
Every future managed writer must share atomic or fenced lifecycle serialization across processes.
No manager, native lifecycle, resolver, live migration, or release publication was implemented here.

## Verification

The configured combined command passed 57 tests with zero skips:

```bash
OPENBAO_PILOT_BINARY=/root/research/openbao-pilot-20260915-MYD9Qc/bao OPENBAO_PILOT_SHA256=8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 OPENBAO_PILOT_RECEIPT_SHA256=d01bb15e083d6d24694697e3e9b19792d3e0d47649dbb41af647e3b99df484ef node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/providers/src/credential-backend-identity.test.ts packages/orchestration/src/openbao-pilot.test.ts scripts/openbao-pilot.test.ts scripts/openbao-pilot/*.test.ts
```

`npm run typecheck` passed. All three affected OpenSpec changes passed strict validation.
The default controller command passed 19 tests and explicitly skipped the real-binary case:

```bash
env -u OPENBAO_PILOT_BINARY -u OPENBAO_PILOT_SHA256 -u OPENBAO_PILOT_RECEIPT_SHA256 node --import tsx --test scripts/openbao-pilot.test.ts
```

The TLS negative control intentionally emits Node's insecure-environment warning.
Its assertion confirms that the production request still rejects the self-signed certificate.

The standalone compiled pilot ran from `/tmp` under Node 24.18.0.
P01/P02/P03/P05/P06/P10 passed. P04/P07/P08/P09/P11 remained not-run.
The CLI returned 1 because `pilotComplete` was false.
All cleanup fields were true. The report mode was 0600 and its directory mode was 0700.
`processExit` was `{ "code": 0, "signal": null, "spawnFailed": false }`.
Separate tests verify SIGTERM and launch-failure behavior.

| Artifact | SHA-256 |
| --- | --- |
| Implementer report `/tmp/foreman-fable-followup-UEwKtn/report/openbao-pilot-report.json` | `d83d8acd47f899427dbafdcf7a749e33e4aca62700afe047471f18bbeb8fa682` |
| Implementer compiled controller | `21fad92c9002ad3e0b71bec6311f536fde7935118211dc86ff23614929273b08` |
| Implementer compiled worker | `a8ae1351636752fc0c85c5d2b2df27576ff635dae105fb41206fe474170cbf7f` |
| Parent report `/root/research/openbao-parent-fable-followup-xkBE7e/openbao-pilot-report.json` | `29364571fd42ec2f5b16e93f865528ff24d72ecdb0170017ca51f2b2e7be62c6` |
| Parent compiled controller | `0f77b21026040caadd81174403d9119700a0b380acca6be1d6b664bd217860d8` |

Both checks matched all 12 implementation hashes and 616 bundle-input hashes against actual files.
Dependency and Node executable hashes also matched in the implementer check.
Independent parent verification confirmed the configured suite, typecheck, default skip, private report, and compiled subset.
Build directories differ, so compiled bundle hashes can differ through embedded file paths.

## RED/GREEN observations

The first four focused tests failed before helper implementation.
The proxy failure showed the actual canary reaching the proxy in the corrected-arm assertion.
The readiness, snapshot and leak tests failed because their required helpers were absent.
After implementation, all four passed.

The composition test failed for the absent constructor, then passed after implementation.
Malformed administrative headers produced a raw TypeError in RED, then a closed `InvalidInput` failure in GREEN.
The first combined run passed 55 of 56 tests.
It exposed a wrapped `SpawnFailed` becoming `PilotFailed` at the controller boundary.
The controller now consumes the typed Effect result before propagation.
The final expanded combined suite passed 57 of 57 tests.

The new export guard caught a contaminated disposable default entry.
The existing poisoned-dist and post-build source-mutation controls also passed.
These checks prove bounded fixture properties, not production manager authorization or release completion.
