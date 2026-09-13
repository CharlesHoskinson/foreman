# Required K1 proofs and stronger K2 claims

Status: **PLANNED**. No theorem in this document has been discharged.

## Common domain D1

Define D1 as an executable K predicate in formal/pel/proof-domains.json and the corresponding claim modules.
D1 admits only well-formed configurations reachable from the selected profile's entry rules.
D1 bounds source bytes to 4096, syntax depth to 8, active tasks to 8, and child allocations to 4.
D1 bounds environment nodes to 16, value graph nodes to 128, control frames to 32, and semantic reductions to 200.
D1 admits at most 4 host requests and a finite script of typed matching or deliberately rejected receipts.
D1 retains the complete finite binary64 value domain and the selected numeric rejection rules.
Both scheduling modes are covered. Claims that require determinism bind an explicit schedule.
No assumption states the claim's conclusion or assumes the invariant under proof.

These bounds limit theorem scope, not executable profile support.
A proof must include a reachable witness, initialization, and preservation or another complete argument over its stated domain.
When a rule can leave D1, prove the required property for that outgoing transition too.
Do not omit a failing transition merely because its successor exceeds a proof bound.
State entry restrictions and transition-closure obligations explicitly.

Assume pinned tool/backend/solver correctness and correct admitted primitive encodings.
Treat digest collision resistance, external receipt truth, OS isolation, and durable host atomicity as separate assumptions.
Record whether a proof certificate was independently checked. Do not imply certificate checking from kprove success alone.

## Mandatory claim set

| Claim | Statement and precise scope | Required distinguishing control |
| --- | --- | --- |
| K-P01 | In D1, a matching request identity consumes at most one accepted completion receipt across the complete execution and replay trace. | Permit conflicting duplicate receipt consumption and obtain a counterexample. |
| K-P02 | In D1, cumulative reductions, iterations, and charged child totals never decrease across execution, suspension, restoration, or replay. | Reset a consumed counter on restore and refute the invariant. |
| K-P03 | In D1, a successful charged operation never exceeds its applicable configured bound. Limit rejection occurs at the specified debit boundary. | Move one debit after execution and expose the exceeded bound. |
| K-P04 | In D1, an unselected if/case branch emits no request or print event and performs no charged branch operation. | Make both branches strict and expose an unselected effect. |
| K-P05 | In D1, all caret uses in one pipe frame reuse the single left-operand evaluation and its effect identity. | Reevaluate the left operand for a second caret and expose duplicate work. |
| K-P06 | In D1, receipt acceptance cannot complete a request with different invocation, registry, schema, or selection bindings. | Weaken a binding check and expose cross-request completion. |
| K-P07 | Related valid D1 states have identical future observations under the same schedule after encode/decode restoration. | Drop one captured default or sharing edge and expose a resumed divergence. |
| K-P08 | In D1, accepted completed-prefix replay preserves completed effect bindings and never re-emits those effects. | Allow revision of a completed effect argument and expose changed history. |
| K-P09 | In D1, each child identity charges its parent at most once and preserves the selected allocation and remaining-limit rules. | Delete a merge marker and expose a second parent charge. |
| K-P10 | In D1, ordinary Pel data cannot create an authority-bearing host transition absent a valid external boundary input. | Add a rule that treats approval-shaped data as authority and expose the new transition. |

K-P07 is a relation between the declared K state and its admitted continuation projection.
It does not prove the actual TypeScript serializer correct. K09 tests that boundary. K2 owns its source-level proof.
K-P10 is a property of the modeled interface. It does not establish that the operating system enforces that interface.
Proofs of at-most-once consumption do not promise exactly-once external effects or eventual host completion.

A control must produce its expected counterexample. A timeout is not successful falsification.
An impossible-premise control must be rejected by the nonvacuity gate.
All ten claims and their helper dependencies must pass before K1 acceptance.
The M7 minimum of two claims remains inherited. This program deliberately adds eight stronger scoped obligations.

## Stronger claims and disposition

| Claim family | K1 evidence | Additional work |
| --- | --- | --- |
| Full source-parser preservation | Independent source fixtures and bounded generated inputs | K11 proof over the actual tokenizer/parser representation |
| Full evaluator correspondence | Complete member mapping and finite boundary conformance | K11 two-way trace simulation over source semantics |
| Actual TypeScript continuation correctness | Public-API differential restore/replay tests | K11 source-bound serializer and runtime relation proof |
| Determinism | Tests under fixed explicit schedules | A separate theorem for the stated choice policy and numeric primitives |
| Termination | Finite test/proof domains and explicit harness bounds | Well-founded administrative progress and explicit external-response assumptions |
| Host safety and full orchestrator correctness | Existing source-bound host gates and an assumption ledger | Separate proofs for persistence, authority, budgets, containment, and provider contracts |

No stronger theorem is implied by completing K1.
The K11 OpenSpec plans source certification. The external-host theorem family retains its existing program owners and open obligations.

## Rule coverage and finite trace endpoints

Each claim records in-domain, outgoing-boundary, and not-in-domain rule labels.
Not-in-domain requires a checked incompatibility with the claim premises. It is not a proof of that rule.
The trace claims cover admitted finite prefixes and the observations of their first outgoing transition.
They do not assert properties of an unrestricted execution after it leaves D1.
K-P07 compares corresponding finite observations through that endpoint under the same schedule.
Full-profile conformance remains required for behavior outside D1.
Changing these bounds or classifications without justified premise analysis requires a reviewed program amendment.
Release notes must display D1 bounds beside the ten scoped proof claims.
