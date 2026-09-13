# M4 implementation review

The implementation received independent feature review and a separate read-only Claude Opus 5 code audit. The Opus audit examined lifecycle assembly, retained inputs, project authority, operator decisions, and final-result classification. Its [record](evidence/m4/opus-lifecycle-review.json) identifies the requested and observed primary model. Auxiliary CLI accounting is retained separately. The review did not run live provider qualification.

## Feature review

| Finding | Correction |
| --- | --- |
| Post-admission resource failures became invalid admission errors. | Store a resource-denied host receipt and a final run result with source and effect diagnostics. |
| Provider limits applied independently to each effect. | Reserve token and USD bounds atomically in the existing journal, retain unknown usage, and derive subsequent requests from the remaining original allowance. |
| Confirmed provider cancellation became failed exit 1. | Project cancelled exit 4 when external work is settled; retain needs-action when other external outcomes are unknown. |
| JSON print emitted program text on stderr. | Select output mode per invocation and retain JSON-mode program output only in artifacts and result references. |
| Unknown-outcome recovery dropped usage and evidence. | Project previous observations, output, artifacts, source spans, and conservative usage into the recovery result. |
| Saved provider cursors were unreachable through ordinary owner recovery. | Resume the original request and cursor under the same owner and reservation, without preparing or starting a new request. |
| Fresh V2 actions used the wrong origin reservation identity. | Use the stable fresh reservation as its own origin; preserve the original identity for meta actions. |
| Predicate composition lacked compiled coverage. | Execute a string condition through the actual predicate handler, a registered V2 evaluation family, a recorded M3 transport, print, checkpoint failure, and receipt recovery. |
| Process death inside a journal transaction could retain a lockfile forever. | Use the shared anchored kernel lock for existing journal transactions and ledger operations; test SIGKILL while the transaction lock is held. |

## Opus lifecycle review

The audit identified two operator-decision defects. A consumed confirm-no-dispatch registration could prevent a later recovery decision for the same effect. Revision registration also used different prefix and counter checks from revision application. Exact decision-consumption checks and shared revision preparation now resolve these findings. Regressions reject old consumed receipts, admit newly evidenced decisions, validate pending suffixes before writes, and restart signed revisions against their original parent authority.

The audit also identified an admission ordering defect. Stored input validation now precedes `pel.run.v1` and the startup event. A regression injects failed retained-authority validation and checks that neither record is emitted.

The final composed race test exposed a parent/child suspension mapping defect. Parent continuations now retain only their own request mappings. Recovery validates child mappings separately and observes an abandoned or committed losing provider without resuming it. Both the normal and post-winner-crash variants retain two provider starts, two implementation debits, one winner, and zero provider resumes. An already expired owner also returns a durable budget result without evaluating or dispatching work.

Three questions were checked separately:

- `EndstopLedger.familyStatus` reads registered historical state. It does not require the family to remain Running. Original-input validation checks identity and authority provenance; action reservation applies current execution policy.
- Generic final results use existing current-candidate milestones from the selected contract or child. This is deliberate evidence reuse. Delivery classification also requires exact candidate-bound receipt membership.
- The dispatcher writes an unknown-outcome observation before an authorized redispatch. That observation consumes the prior no-dispatch basis before external work. Explicit reuse of the old operator receipt is covered by the decision-consumption correction.

Tests use actual local stores and deterministic provider ports unless the evidence explicitly says otherwise. The compiled fixture cannot admit a product model cell or authorize publication. M5 task, verification, review, and publication behavior remains a separate milestone.
