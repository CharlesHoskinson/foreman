# M6 implementation audit

Status: confirmed defects have corrections and focused regression evidence.
Final compiled validation remains pending. The independent follow-up review is complete.

## Independent Opus review

The reviewer used the exact `claude-opus-5` model through Claude Code.
Its tools were restricted to repository reads and searches.
The [sanitized result](evidence/m6/opus-adoption-review.json) retains findings and model usage.
It excludes hidden reasoning and raw session events.
The reported review cost was USD 2.25216, including separately identified auxiliary usage.

| Finding | Correction | Evidence boundary |
| --- | --- | --- |
| A restrictive umask changed staged modes and caused valid installation failure. | Apply each manifest mode through the open file descriptor. | Regression reproduces failure under umask 027, then verifies declared modes. |
| Ignored generated research assets could differ from tracked candidate sources. | Package tracked original research and migration sources directly. | Tampered generated caches cannot change the package identity. Untracked source data is refused. |
| A symlink prefix ancestor returned the wrong failure category. | Classify unsafe prefix validation as invalid input. | Exact invalid-input outcome preserves prior installation state. |
| Optional live vault notes looked like fresh captured evidence. | Use a null capture timestamp, explicit observation timestamp, and uncaptured freshness. | Context remains partial. Immutable host research refuses those rows. |

The focused installer, package, support, and adoption run passed 23 tests after correction.
The focused research context and host run passed 20 tests after correction.
These dated source-test results do not replace the pending final bundle validation.

## Follow-up questions and concrete defects

The rollback concurrency question reproduced through actual lifecycle admission.
Rollback selected an incompatible retained build after scanning an initially empty registered root.
A second check of that same root correctly rejected the target.
Durable suspended and cancel-requested results also bypassed active-state compatibility checks.
Correction uses the existing kernel lock primitive to coordinate the original registry across prefixes and checkout writers.
Lock order is registry first, then installation prefix.
Execution starts after both transaction locks are released.
The shared regression suite passed 66 tests.
Final compiled integration remains pending.

Invalid research replacement previously marked a valid snapshot incomplete before input validation.
Validation now precedes publication metadata changes.
Interrupted publication still retains its incomplete marker.

Support export now includes `product`, `test-fixture`, or `unknown` evidence kind.
Only a validated immutable execution binding supplies that value.

The stronger verification-reuse test found uncharged repeated work after evidence expiration.
The gate executed again, but its ledger identity still matched the prior verification.
Correction binds the refresh to the original evidence reference.
The verification, gate, and library suite passed 23 tests.
Crash recovery preserves the original reservation and observation timestamp.

## Real adapter startup

The actual standard-task serializer rejected the canonical candidate schema before launching Grok.
It treated xAI's guaranteed array-bound threshold as an absolute schema limit.
The [official documentation](https://docs.x.ai/developers/model-capabilities/text/structured-outputs#constraint-limits) permits larger bounds but requires caller validation.
The correction retains wire bounds and explicitly enforces the original schema in the host decoder.
Provider output and Grok transport tests passed 22 cases.
The startup trace must still demonstrate actual transmission through the corrected serializer.

## Native qualification review

A separate implementation reviewer inspected the disposable coding qualification boundary.
Two confirmed defects received regression tests and corrections.
Ignored untracked files are now included in the final workspace assessment.
Final assessment now occurs after transport cleanup.
Late cleanup writes cannot retain coding or boundary qualification evidence.

Provider qualification also rejects tool requests received after a terminal event.
The durable host accepts each bounded permission result before acknowledging it.
These fixtures establish implementation behavior, not live account readiness.

## Second Opus review

The [follow-up review](evidence/m6/opus-followup-review.json) used the exact `claude-opus-5` model with read-only tools.
Its reported total cost was USD 3.8738145, including USD 0.00177 of separately identified auxiliary usage.
The reviewer did not execute tests.
It confirmed the earlier corrections and identified four further findings.

| Finding | Resolution |
| --- | --- |
| Failed terminal runs could not be revised after rollback. | The claimed permanent loss did not reproduce. A retained original build can be selected again before revision. |
| Project registration selected its identity before acquiring the registry transaction. | Lookup, identity selection, store binding, and registration now share that transaction. Typed refusals remain intact. |
| Busy registry acquisition during rollback returned compatibility outcome 3. | Acquisition failures now return I/O outcome 1. Actual compatibility failures retain outcome 3. |
| A regular-file installation ancestor returned I/O outcome 1. | Invalid prefix ancestors now return invalid-input outcome 2, including `ENOTDIR`. |

The terminal-run regression switches between incompatible retained builds without changing history.
It then restores admission through the original build.
A separate recovery regression reselects the original build and completes a real failed-run revision.
The revision returns value 9 and state `succeeded`.
Failed results followed by revisions remain active and still block incompatible rollback.
Requiring every historical failed run to remain compatible would exceed the active-state requirement in R-M6-017.

The registration race reproduced a successful response with conflicting registry and SQLite project identities.
Five focused regressions pass after correction, including a real cross-process busy transaction.
Busy admission produces one bounded refusal and no project binding or publication.
The combined installer, rollback, admission, and recovery regression passes 42 tests.

The review also questioned a fixture-authority refusal that asserted only exit 2.
The corrected fixture now supplies canonical contract and authority bytes.
The test reaches and asserts the exact product refusal for unsupported typed project authority.
It also verifies zero effects and preserves the immutable package manifest.

Plain resume and cancel preserve the admitted binding and can use a compatible retained runtime.
New runs and source revisions require the selected runtime during their short admission transaction.
This behavior preserves recovery access without allocating a second execution identity.
