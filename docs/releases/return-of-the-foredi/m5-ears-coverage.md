# M5 EARS acceptance evidence

Status: The M5 implementation and acceptance tests pass. This table maps each catalog scenario to executed evidence. Requirements and expected observations remain in `openspec/changes/foredi-05-task-delivery/catalog.json`.

| Test | Feature behavior | Evidence target | Current limit |
| --- | --- | --- | --- |
| T-M5-001 | Native task produces host-observed immutable candidate | `pel-host-task.test.ts`, `pel-candidate-capture.test.ts`, `pel-host-library.test.ts` | Finite recorded providers |
| T-M5-002 | Invalid output, missing artifact, and scope escape fail | `pel-host-task.test.ts`, `pel-candidate-capture.test.ts`, `pel-host-contract.test.ts` | No live model claim |
| T-M5-003 | Host gate determines Boolean pass or fail | `pel-host-verify.test.ts`, `pel-gate-execution.test.ts`, `pel-host-library.test.ts` | Real gate and store integration |
| T-M5-004 | Exact verification reuse precedes reservation | `pel-host-verify.test.ts` | Changed bindings require dispatch preparation |
| T-M5-005 | Mutation invalidates checks; recovery retains completed work | `pel-gate-execution.test.ts`, `pel-host-verify.test.ts` | Real mutation and injected interruption |
| T-M5-006 | Review binds independent observed vendor | `pel-host-review.test.ts`, `pel-host-library.test.ts` | Recorded xAI and OpenAI identities |
| T-M5-007 | Current attempt invalidates older approval | `pel-host-review.test.ts`, `pel-host-library.test.ts` | Includes fabricated and cross-run receipt rejection |
| T-M5-008 | Standard Pel pipeline delivers a candidate | `pel-delivery.test.ts`, `pel-host-library.test.ts` | Compiled fixture scenarios and final workspace suite pass |
| T-M5-009 | Native recursive repair stops at approval or its bound | `pel-delivery.test.ts` | Exact source, bounded repair, and owner crash scenarios pass |
| T-M5-010 | Resume reuses completed implementation | `pel-delivery.test.ts`, `pel-recovery.test.ts`, `pel-host-task.test.ts` | Compiled fixture scenarios and final workspace suite pass |
| T-M5-011 | Missing publication authority causes no mutation or charge | `pel-host-publish.test.ts`, `pel-publication-integration.test.ts` | Actual V2 ledger and local bare remote |
| T-M5-012 | Exact authority permits one revalidated publication | `pel-publication-service.test.ts`, `pel-publication-integration.test.ts` | Actual candidate and destination mutation variants |
| T-M5-013 | Lost acknowledgement reconciles without another push | `pel-host-publish.test.ts`, `pel-publication-integration.test.ts` | Unavailable observation remains pending |
| T-M5-014 | Text and JSON expose current delivery evidence | `pel-delivery-result.test.ts`, `pel-delivery.test.ts` | Compiled fixture scenarios and final workspace suite pass |
| T-M5-015 | Unqualified exact profiles fail without substitution | `pel-host-preflight.test.ts`, provider admission tests | Product exits 2 before allocation and dispatch |
| T-M5-016 | Roles resolve exact profile, transport, controls, and grant | `pel-host-task.test.ts`, `pel-delivery.test.ts` | Identical source with changed role bindings passes |

The [final verification record](m5-verification.json) binds test output to source hashes. M3 model qualification records remain separate from recorded-provider tests.
