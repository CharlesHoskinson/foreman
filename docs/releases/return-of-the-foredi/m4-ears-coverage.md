# M4 EARS implementation and test map

The controlling [catalog](../../../openspec/changes/foredi-04-durable-execution/catalog.json) retains the EARS requirements, fixtures, actions, and expected observations. This map identifies the executable implementation and regression targets. The final verification record supplies measured results; a row in this map is not a live-model qualification.

Paths below are under `packages/orchestration/src` unless another package is named.

| Requirement and test | Feature evidence and regression targets |
| --- | --- |
| R-M4-001 / T-M4-001 | `pel-project-config`, `pel-project-live`, `pel-lifecycle-services`, `pel-lifecycle-live`, `pel-registered-root`, and `pel-runner` tests cover registered Git configuration, immutable admission, one owner, early refusal, and the actual compiled product CLI. |
| R-M4-002 / T-M4-002 | `pel-effects` and `pel-resource-scope` tests cover resolved source/argument/resource identity, symlink containment, replaced parents, and durable resource-denied receipts before external dispatch. |
| R-M4-003 / T-M4-003 | `pel-journal`, `pel-recovery`, and `pel-recovery-crash` tests cover automatic suspension, receipt persistence, native association-list/pipe continuation, and stable reservation reuse. |
| R-M4-004 / T-M4-004 | `pel-recovery-crash` kills owning processes at the six declared boundaries. Event-log `journal-kernel-lock.test.ts` also kills owners inside journal and ledger transactions. |
| R-M4-005 / T-M4-005 | `pel-journal` tests accept identical duplicate receipts and reject conflicting hashes, order, and effect identity. |
| R-M4-006 / T-M4-006 | `pel-runner` tests execute actual M1 ordered and asynchronous batches, partial receipts, source-result order, and the admitted concurrency limit. |
| R-M4-007 / T-M4-007 | `pel-resource-scope` tests cover canonical aliases, overlapping reads and writes, deterministic acquisition, interruption, and workspace identity revalidation. |
| R-M4-008 / T-M4-008 | `pel-runner` and compiled `pel-cli-fixture` tests cover isolated race children, committed winner recovery, loser cancellation, child counters, and concurrency one. |
| R-M4-009 / T-M4-009 | `pel-control-functions`, `pel-runner`, `pel-provider-tools`, `pel-journal`, and compiled fixtures cover transient selectors, retry identity, original action debit, cumulative token/USD reservation, unknown usage, and retained preparation after a reservation-before-intent crash. |
| R-M4-010 / T-M4-010 | Provider-tool and compiled cancellation fixtures distinguish local cleanup, remote confirmed cancellation, unsupported cancellation, and bounded observation. |
| R-M4-011 / T-M4-011 | `pel-run-status` and compiled separate-process fixtures cover duplicate cancellation, terminal races, pending observations, and status without provider dispatch. |
| R-M4-012 / T-M4-012 | `pel-recovery`, M1 closure/continuation tests, and compiled checkpoint fixtures preserve captured values and the original checkpoint sequence after interruption. |
| R-M4-013 / T-M4-013 | `pel-recovery` and `pel-decision-authority` tests cover observed completion, accepted results, no-dispatch evidence, abandonment, exact signed decision content, and consumed-decision rejection. |
| R-M4-014 / T-M4-014 | `pel-recovery` and actual product lifecycle tests cover shared revision preparation, whole-form prefix validation, captured arguments, repeated revisions, original parent authority, and retained failed-work counters. |
| R-M4-015 / T-M4-015 | `pel-run-result`, `pel-run-status`, `pel-lifecycle-cli`, and runner tests cover the strict result decoder, source/effect diagnostics, usage and artifact projection, all lifecycle exit classes, and unknown external outcomes. |
| R-M4-016 / T-M4-016 | Run-contract, journal, recovery, kernel-lock, and supervisor routing tests reject incompatible identities and corruption, preserve owner exclusion, and use the existing supervisor recovery route. |
| R-M4-017 / T-M4-017 | `pel-runtime-inputs` is exercised through lifecycle service and product tests. Changed current files are ignored; missing retained bytes and changed limits, schema, milestones, options, language, or authority are rejected. |
| R-M4-018 / T-M4-018 | `pel-provider-tools` and actual `resumeProgram` tests persist tool receipts and opaque checkpoints, deduplicate repeated calls, reject changed arguments, and resume the original saved cursor without a new start. |
| R-M4-019 / T-M4-019 | `pel-effects`, execution-ledger, and compiled predicate tests cover zero-reservation preparation, one dispatch token, one authorized publication reservation, original retry debit, exact V2 evaluate authority, and reservation idempotence. |
| R-M4-020 / T-M4-020 | Native-host, product lifecycle, and compiled predicate tests cover Boolean conditions, read-only provider policy, print persistence, one JSON result, and exact predicate receipt replay. |
| R-M4-021 / T-M4-021 | The existing fixture manifest/build tests validate copied asset hashes and state roots. Product CLI tests reject fixture-only flags and admission data. The fixture entry remains unshipped. |
| R-M4-022 / T-M4-022 | Journal and artifact tests keep deep values outside bounded event payloads and verify hashes, protected opaque files, missing artifacts, and child references during recovery. |
| R-M4-023 / T-M4-023 | `pel-run-result` tests validate the original schema before classification, reject malformed delivery lookalikes and swapped candidate receipts, and keep generic status-like data ordinary. |

Local provider fixtures use recorded transports and explicit `test-fixture` authority. M4 API admission still requires current exact-cell evidence in product mode. M5 adds actual task, verification, review, and publication handlers; this map does not claim those later features are complete.
