# Fable 5.1 interim OpenBao audit

Verdict: BLOCKED. This is an advisory audit, not Foreman release acceptance.

The user approved a standalone, tool-free audit through the existing Claude login.
The audited snapshot contains 46 selected files and excludes concurrent native-login edits.
No audited file changed during the request. No implementation change was made during this audit.

## Identity and evidence

- Requested, initialized, and responding model: `claude-fable-5-1`.
- Terminal exit: 0. The tool catalog contained no host-action tools.
- Session persistence was disabled. The controller did not retain raw streams or thinking blocks.
- Snapshot: `cd7f6bf272935ea395d6458ebd9c7af4007019a03583b6dfad26770cc2e1c0ec`.
- Prompt: `95017f889a458e1940f043f2ff6cf2e093f7150468e62fc60d3f4eb914d14401`.
- Base HEAD: `c83b118b7a005fe74d53cc3d64c91f333c622095`. The package includes uncommitted files.
- Receipt and complete findings: `/root/research/foreman-fable-audit-Kk4dkN/audit.json`, mode 0600.
- Frozen input and file manifest: `prompt.json` and `snapshot.json` in the same private directory.

The parent checked the receipt schema, snapshot identity, and prompt digest after completion.
The receipt contains ten findings: two high, four medium, and four low.

## Fresh verification

The combined store, broker, and configured pilot run executed 35 tests with zero skips.
It passed 34 tests and failed one test.
The broker test expects `InvalidInput` for a malformed token, but the rebuilt store returns `Unavailable`.
Earlier green counts do not establish correctness of this rebuilt candidate.
Fable received the failing result before review.

Command:

```text
OPENBAO_PILOT_BINARY=/root/research/openbao-pilot-20260915-MYD9Qc/bao OPENBAO_PILOT_SHA256=8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00 node --import tsx --test packages/providers/src/openbao-credential-store.test.ts packages/orchestration/src/openbao-pilot.test.ts scripts/openbao-pilot.test.ts
```

## Findings and parent assessment

| Finding | Severity | Parent assessment and required follow-up |
| --- | --- | --- |
| Malformed-token error contract disagrees across tests | High | Confirmed by the fresh failing test. Resolve the intended contract without weakening sanitization. Rename or replace the misleading HTTP-setup test. |
| Tests can exercise stale provider bundles | High | Confirmed. Add deterministic source-to-bundle verification before test admission. However, the compiled report does record the actual dist hash in `bundleInputHashes`. Fable's assertion that no dist hash exists is incorrect. |
| Signature verification is represented by a caller-supplied Boolean | Medium | Confirmed at the controller boundary. The earlier download did undergo external integrity verification. Bind that receipt and distinguish external verification from controller verification. Do not claim the downloaded binary was never verified. |
| Compiled environment metadata describes build time | Medium | Confirmed. Separate build and execution Node identities. Mark the dirty candidate explicitly while preserving source and bundle hashes. |
| Soft deletion has no specified create-only recovery path | Medium | Retain as a roadmap finding. Verify exact KV v2 deletion and CAS behavior with a synthetic real-server experiment. Do not add destructive metadata deletion automatically. |
| Backend identity is absent from the store interface | Medium | Retain as a composition requirement. Host configuration can bind identity without adding it to every store method. Fable's quoted CM00 sentence is not present verbatim, but NL08 requires shared backend, mount, namespace, and reference. |
| P05 does not exercise a hanging peer | Low | Confirmed limitation. Separate observed fast sealed responses from deadline enforcement. Complete the unavailable-endpoint scenario. |
| Mutation test does not exercise mutation during token acquisition | Low | Confirmed coverage gap. Add a synchronized asynchronous mutation control. Do not confuse pre-execution mutation with in-flight snapshot protection. |
| Footgun report contains a stale passing-count claim | Low | Confirmed. Supersede the claim with candidate-scoped evidence and the current failure. |
| Synthetic HTTP factory is publicly exported | Low | Confirmed exposure, not a demonstrated production bypass. Require an explicit production composition guard or separate test entry. |

The parent preserves Fable's complete findings, including disputed details, in the receipt.
The qualifications above do not change the BLOCKED verdict.

## Next work

1. Resolve the error contract and reproduce the regression against a fresh providers build.
2. Prevent stale bundles from entering tests or pilot evidence.
3. Correct provenance labels and bind external integrity evidence.
4. Add the missing lifecycle and mutation controls.
5. Specify deletion recovery and backend identity at the host composition boundary.
6. Complete deferred manager, native lifecycle, and pilot experiments before release admission.

OpenBao remains the required sole durable credential authority for managed accounts.
No finding authorizes native-profile fallback, live credential migration, publication, or weaker sandbox boundaries.
The required integrated Foreman review route remains separate from this completed interim audit.
