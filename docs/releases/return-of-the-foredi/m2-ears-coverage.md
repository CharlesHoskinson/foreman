# M2 EARS coverage

M2 implements six features, 15 EARS requirements, and 16 catalog scenarios.
The controlling requirements remain in [the OpenSpec catalog](../../../openspec/changes/foredi-02-plan-authoring/catalog.json).
This report maps those requirements to executable tests.
[M2 verification](m2-verification.json) records command results and the measured source hashes.

## Requirement and test mapping

| Requirement / scenario | Implemented behavior                                                                  | Acceptance evidence                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-M2-001 / T-M2-001    | Check source syntax, scope, arguments, and quoted data against the selected snapshot. | `analysis.test.ts` checks arithmetic, invalid syntax, dead executable syntax, closures, defaults, pipes, cases, and registered usage. The CLI JSON matrix checks success and diagnostic exits.                                                   |
| R-M2-001 / T-M2-016    | Preserve only definitions that exist on every feasible branch.                        | `preview.test.ts` checks unknown both-branch and one-branch definitions. `analysis.test.ts` checks the known selected definition.                                                                                                                |
| R-M2-002 / T-M2-002    | Reject invalid input before provider or execution work.                               | The CLI JSON matrix checks missing source, missing snapshot, oversized snapshot, invalid source, and argument misuse. Snapshot tests check tampering and duplicate keys. These services expose no execution port.                                |
| R-M2-003 / T-M2-003    | Show exact effects, controls, capabilities, and gates without host execution.         | The canonical CLI preview asserts task, verification, and review order, exact Grok/Sol transports, effort settings, and the candidate-full gate. Ambiguous transport tests require rejection.                                                    |
| R-M2-004 / T-M2-004    | Preserve unresolved native control flow and effect dependencies.                      | Preview tests cover both branches, four-item loops, list identity and slicing, exact natural-language predicates, merged association fields, producer dependencies, and write serialization.                                                     |
| R-M2-005 / T-M2-005    | Reject effects outside the admitted policy.                                           | Preview tests reject capabilities, unsupported effect kinds, resources, review policies, and invalid identifiers. The CLI matrix rejects unavailable models and output schemas with spans and signatures.                                        |
| R-M2-006 / T-M2-006    | Require finite callable and resource envelopes.                                       | Preview tests cover distinct partial closures, arbitrary unknown callables, nested and aggregate loop budgets, zero-item loops, bounded unknown resources, absent scopes, and denied retry/race child capabilities.                              |
| R-M2-007 / T-M2-007    | Bind exact source and context to immutable checked previews.                          | Binding tests mutate source, artifacts, roles, predicates, controls, policy, options, registry, and language fields. Analysis tests distinguish normalized syntax from exact source. Preview tests reject mutable checked analysis.              |
| R-M2-008 / T-M2-008    | Return only locally checked source from the selected generation profile.              | Generation tests cover the first valid candidate, explicit envelopes, qualified grammar selection, and unsupported controls. Compiled fixture tests cover exact source output and local repair.                                                  |
| R-M2-009 / T-M2-009    | Stop after attempt 0 and at most two local repairs.                                   | Generation tests assert attempt identities, three invalid candidates, cumulative usage, retained diagnostics, and exhaustion. CLI tests assert JSON and human failure output.                                                                    |
| R-M2-010 / T-M2-010    | Stop generation on fatal provider outcomes, cancellation, or exceeded bounds.         | Generation tests cover all 15 failure tags, refusal, identity mismatch, cancellation cleanup, absolute deadlines, slow reservation and settlement, and budget exhaustion. CLI tests assert exits 1, 4, and 2.                                    |
| R-M2-011 / T-M2-011    | Show source ranges, causes, and applicable registered usage.                          | The human/JSON CLI matrix checks mixed arguments, unknown names, unsupported selections, signatures, and caret ranges. Preview tests retain unresolved schemas, reasons, and origins.                                                            |
| R-M2-012 / T-M2-012    | Recheck edits and preserve bounded draft history.                                     | Draft tests cover replacement, undo, completion, 101 revisions, 16 MiB retention, UTF-8 suffix edits, and run-bound rejection. A terminal transcript covers show, check, preview, history, all replacements, explicit repair, export, and abort. |
| R-M2-013 / T-M2-013    | Run the shipped examples from the compiled checkout entry.                            | The CLI example test runs check and plan for all four examples under Node 24. The negative repair example must return PEL_ARGUMENT_MODE and exit 2.                                                                                              |
| R-M2-014 / T-M2-014    | Validate complete snapshot content, exact selections, and effective digests.          | Snapshot tests cover content hashes, profile ceilings, normalized resources, role resolution, predicate settings, and narrowing. The CLI asset test regenerates canonical bytes from the sole declaration module.                                |
| R-M2-015 / T-M2-015    | Supply complete generation context under a separate allowance.                        | Generation tests assert exact controls, account reference, template, artifacts, schema, immutable policy, attempt identity, token limits, deadline, and valid reservation. No execution ledger is imported.                                      |

## Test files

- [Language analysis](../../../packages/pel/test/analysis.test.ts)
- [Effect previews](../../../packages/pel/test/preview.test.ts)
- [Exact bindings](../../../packages/pel/test/binding.test.ts)
- [Snapshot validation](../../../packages/pel/test/snapshot.test.ts)
- [Authoring CLI](../../../packages/orchestration/src/pel-authoring-cli.test.ts)
- [Generation](../../../packages/orchestration/src/pel-generation.test.ts)
- [Draft sessions](../../../packages/orchestration/src/pel-draft-session.test.ts)
- [Compiled fixtures](../../../packages/orchestration/src/pel-cli-fixture.test.ts)
- [Runtime asset verification](../../../packages/policy/src/install-verify-authoring-asset.test.ts)

The focused command selects the seven files required by the design.
Snapshot validation and runtime asset verification also run in the workspace suite.
All Pel test files compile before their Node.js test run.
The test wrapper rejects a missing quoted test path with exit 1.

## Review evidence

Independent analysis review found defects in branch merging, resource checks, loop bounds, and list operations.
Each reported defect has a regression test.
Independent generation review found mutable-request identity bypass, synchronous deadline overrun, invalid reservations, and UTF-8 truncation errors.
Generation tests cover all four corrections and additional accounting and cancellation boundaries.

The fixture manifest now requires an absolute asset root and its manifest digest.
It binds the compiled snapshot and examples through bounded file records.
Fixture tests reject missing fields, modified bytes, traversal, links, and context escapes before provider use.
The production entry rejects the fixture option.

M3 still owns real transport qualification and provider cleanup evidence.
M4 will supply the run side of the shared check/plan/run snapshot correspondence.
M2 introduces the common builder and its narrowing tests; it does not claim execution admission already exists.
