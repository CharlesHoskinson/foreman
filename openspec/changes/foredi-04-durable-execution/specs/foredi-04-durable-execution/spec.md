# Execute and recover Pel programs

Status: proposed requirements. All scenarios are planned tests.

## ADDED Requirements

### Requirement: R-M4-001 Start an admitted run

When an admitted run starts, the Foreman runtime SHALL bind one exclusive Effect owner to its checked program and execution contract.

#### Scenario: T-M4-001 Start an admitted run

- **WHEN** A configured temporary Git repository has Git-common-dir/foreman/project.json with existing fixture authority, exact role pairs, finite limits, and a deterministic host program. The checkout has no installation prefix. Variants change project role/predicate selections, provide a stale checked effective snapshot, alter one executable descriptor, or supply an unregistered --state-root. Invoke node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest fixture-manifest.json run fixture.pel --json without --binding or --state-root. Start a competing owner for its emitted run ID. Repeat with missing and invalid settings.
- **THEN** Derived binding matches project, repository, snapshot, authority, paths, limits, gates, roles, and required milestones. One owner dispatches once. Competing owner and missing/invalid settings exit 2 with zero competing dispatch. The attached run emits run-started on stderr before dispatch and one final result on stdout. Check/plan/run derive one effective snapshot from the same base and project selection. Exact roles, predicate and narrowing limits agree. Stale contexts or descriptor digest mismatches exit 2 before dispatch. Configure requires no M6 prefix. Unregistered run/resume root overrides exit 2.

### Requirement: R-M4-002 Reject a dynamic capability escape

If a resolved host request exceeds its checked envelope, then the Foreman runtime SHALL reject that request before reservation or dispatch.

#### Scenario: T-M4-002 Reject a dynamic capability escape

- **WHEN** A checked conditional supplies a path whose resolveResources output escapes its finite admitted workspace, despite a valid static descriptor. Resume the evaluator and inspect ledger and provider invocation spies.
- **THEN** resource-denied identifies the source span and actual canonical resolver output. No action reservation or provider call occurs. Symlink alias and replaced-parent variants also fail containment.

### Requirement: R-M4-003 Persist and replay a host result

When a host call suspends evaluation, the Foreman runtime SHALL persist its bound intent before dispatch and its validated result before continuation.

#### Scenario: T-M4-003 Persist and replay a host result

- **WHEN** A host result is an association list. Automatic pel.suspension.v1 persisted its continuation and counters before dispatch, without an explicit fm/checkpoint. Stop after result append. Execute, restart from the same journal, and evaluate the next native pipe expression.
- **THEN** Pel records are suspension, combined intent containing preparation digest and existing reservation reference, observation, result. The existing ledger reservation precedes intent but is not a separate Pel record. Read-only reuse has suspension/result. Recoverable needs-action has suspension/observation and remains pending. Decoder enumerates all declared types including output and child records. Recovery returns identical Pel data with one dispatch and unchanged committed counters.

### Requirement: R-M4-004 Cover six interruption boundaries

If execution stops between reservation and result persistence, then the Foreman runtime SHALL recover its existing reservation and classify the external outcome.

#### Scenario: T-M4-004 Cover six interruption boundaries

- **WHEN** Table fixtures stop before reservation, after reservation, after dispatch without provider ID, after external completion, during fake verification, and during cleanup. For each fixture run resumeProgram with observed-complete, confirmed-no-dispatch, or unavailable provider reconciliation.
- **THEN** Budgets never increase. No completed receipt is re-executed. Reservation-without-intent reuses its stable key. Missing external evidence yields needs-action with unknown outcome, even without provider identity. Saved reduction/iteration counters restore exactly at the durable boundary.

### Requirement: R-M4-005 Reject conflicting receipts

If duplicate result receipts conflict, then the Foreman runtime SHALL reject recovery with journal-corrupt and preserve the conflicting evidence.

#### Scenario: T-M4-005 Reject conflicting receipts

- **WHEN** One journal repeats an identical result. Another repeats its effect identity with a different canonical result hash. Call replayPelRun on both journals.
- **THEN** Identical delivery yields one result. Conflicting delivery returns journal-corrupt before continuation or provider dispatch.

### Requirement: R-M4-006 Schedule native expressions

When native do or do/async evaluates host expressions, the Foreman runtime SHALL preserve Pel result semantics within admitted concurrency and resource limits.

#### Scenario: T-M4-006 Schedule native expressions

- **WHEN** Source order contains three do/async expressions with completion barriers in reverse order and a concurrency limit of two. A second program uses do. Evaluate both programs with the instrumented host registry.
- **THEN** do dispatches in source order. do/async never exceeds two active effects and returns the last source expression result. After a partial receipt, alreadyEmitted requests join pending effects without duplicate dispatch. Aggregate counters include all child work.

### Requirement: R-M4-007 Serialize independent symbol writes

While host requests have overlapping write resources, the Foreman runtime SHALL serialize those requests under the same canonical resource identity.

#### Scenario: T-M4-007 Serialize independent symbol writes

- **WHEN** Independent symbols write one worktree through its real path and a symlink alias. Additional requests declare read/read and unknown resources. Evaluate native do/async and record acquisition intervals.
- **THEN** Conflicting writes and unknown workspace effects never overlap. Independent reads can overlap. All permits release after failure.

### Requirement: R-M4-008 Race isolated contenders

When fm/race selects a winner, the Foreman runtime SHALL preserve isolated contender artifacts and record one winner with truthful loser cancellation.

#### Scenario: T-M4-008 Race isolated contenders

- **WHEN** Two fm/task closures have finite M2 effect envelopes and a workspace pool with two grants. They complete on one clock tick. A loser reports unsupported remote cancellation. A negative fixture writes a shared external path. Crash while a contender is suspended, and again after contender one completes but before winner decision. Run another variant with maxConcurrentEffects equal to one. Invoke fm/race with first-valid policy through the fixture host registry. Inspect resolver output, allocation events, result value, child counters, and cancellation after its observation window.
- **THEN** Both canonical worktree IDs are distinct before provider dispatch. Ties select source index one. Result keys are exactly winner-index,value,losers with no duplicates. Each child request includes parent/race/index. Losing counters are charged once. Shared external writes reject before provider calls. Unknown loser outcome remains visible and its artifacts cannot become winner inputs. Child continuation, worktree grant, tranche/debit, canonical closure-argument digest and pending receipt IDs restore exactly. Resume allocates zero replacement worktrees, does not repeat completed effects, and commits one durable race decision. Wrapper holds no concurrency permit while children run, so concurrency one terminates.

### Requirement: R-M4-009 Bound retries across restarts

When fm/retry receives a declared transient failure, the Foreman runtime SHALL reserve each retry within the original action, cost, and deadline limits.

#### Scenario: T-M4-009 Bound retries across restarts

- **WHEN** The canonical ProviderFailure union is table-driven. RateLimited fails first and succeeds next under fm/retry :attempts 2 :on [':rate-limited ':transport-disconnected]. Restart after attempt one. Counterfixtures exhaust the bound, report AuthenticationRequired, or fail with an ordinary Pel diagnostic. Add two nested effects, crash during attempt two suspension, and pass syntax-valued and nil-pair :on lists to the host decoder. Evaluate the retry closure and inspect child request IDs, effect IDs, tagged PEL_HOST_FAILURE causes, reservation action kinds, and cumulative counters. Compile exhaustive union switches.
- **THEN** Only RateLimited and safely reconcilable TransportDisconnected can retry. Child IDs parent/retry/1 and parent/retry/2 and their nested effect IDs differ. Attempt one receipt cannot complete attempt two. Retry charges provider_retry once and does not recharge implement. Authentication and language failures get zero retries. Exhaustion is failed exit 1 with original deadlines/counters preserved. Accepted selectors are evaluated lists of quoted keys. Syntax and nil-pair lists return capability-denied before body execution. RetryContext carries attempt index and a logical key excluding the parent /retry/N segment. Each matching nested key charges provider_retry on attempt two only. Child continuation, pending requests, tranches and stable closure digest recover without duplicate dispatch.

### Requirement: R-M4-010 Timeout without inventing remote cancellation

When an effect timeout expires, the Foreman runtime SHALL interrupt local work and record the observed remote cancellation state.

#### Scenario: T-M4-010 Timeout without inventing remote cancellation

- **WHEN** A scoped child process stalls. Its provider accepts cancellation but reports no terminal outcome. Advance the injected clock beyond the admitted timeout and await local cleanup.
- **THEN** After finite observation-window expiry and confirmed local cleanup, state is exactly needs-action, exit 3, with externalOutcome unknown. Unsupported xAI-style cancellation has the same result and cannot remain pending indefinitely. A local-only cancellation confirms cancelled after cleanup.

### Requirement: R-M4-011 Cancel a running provider

When an operator requests cancellation, the Foreman runtime SHALL persist an idempotent request and report cancelled only after required cancellation confirmation.

#### Scenario: T-M4-011 Cancel a running provider

- **WHEN** An attached fixture run emits its run-started stderr event before provider work completes. The provider yields requested, acknowledged, then confirmed-cancelled under barriers. A second provider remains unsupported through the finite observation window. Read runId from the startup event, invoke the compiled fixture cancel command twice and status concurrently, then release confirmation or advance the observation clock.
- **THEN** The attached run remains active until the result. One cancellation intent exists. Pending status/cancel exit 5. Confirmed cleanup/cancellation exits 4. Unsupported outcome after the window exits 3 with unknown outcome. Final stdout is one JSON result containing the same runId.

### Requirement: R-M4-012 Resume a checkpoint with lexical values

When fm/checkpoint completes, the Foreman runtime SHALL record a versioned data-only continuation bound to its program, attempt, and consumed limits.

#### Scenario: T-M4-012 Resume a checkpoint with lexical values

- **WHEN** A closure captures a list, completes one host effect, checkpoints, and stops before the next expression. Decode the stored checkpoint and call resumeProgram using the same runtime and profile.
- **THEN** The list and closure capture survive as AST/environment data. Prior receipts replay without calls. All budget counters match their previous values.

### Requirement: R-M4-013 Reconcile a lost external result

If an external outcome remains unknown, then the Foreman runtime SHALL require bound reconciliation evidence before continuing or repeating that effect.

#### Scenario: T-M4-013 Reconcile a lost external result

- **WHEN** A fake OpenAI background response completes before receipt append. observe returns completed with validated content. A second xAI fixture returns unsupported and a third returns not-found. Resume with ProviderTransport.observe using the existing identity only. For unsupported and not-found cases submit matching and mismatching PelRecoveryDecisionV1 evidence.
- **THEN** Completed observation records one result receipt with zero redispatch. Unsupported and not-found stay needs-action exit 3 without inferring no dispatch. Mismatched evidence fails. Valid bound evidence resolves only its effect and preserves reservations. Unknown outcomes never supply a terminal M1 receipt. The request remains pending. accept-result drives the evaluator to done with zero redispatch; confirm-no-dispatch uses its existing reservation; abandon supplies a terminal reconciliation-abandoned receipt.

### Requirement: R-M4-014 Validate revised source

When an operator submits a source revision, the Foreman runtime SHALL preserve the completed prefix, authority, and consumed limits before resuming.

#### Scenario: T-M4-014 Validate revised source

- **WHEN** Immutable source has one completed whole top-level form and one unexecuted suffix. Revision variants change only the suffix, change completed arguments, or edit inside a partially completed form. A pure failed suffix consumes four reductions after a completed prefix consuming ten, and its failed-step record is durable. Validate PelRevisionDecisionV1 and PelRevisionMappingV1, then re-evaluate revised immutable source from the start and supply mapped old receipts under new request IDs.
- **THEN** Valid suffix revision persists old-to-new request/node aliases while retaining parent effect IDs and reservations. Completed dispatch count stays one and prefix counters match the recorded boundary. New suffix gets new IDs. Changed completed arguments or partial-form edits fail continuation-incompatible, exit 2, before dispatch. PelRunOptions carries prefix recordedCounters and total committedCounters. Replay validates the prefix separately, then starts revised suffix charged fourteen reductions, including the failed work. New suffix work adds to that total under original limits. A failed form without completed external effects can be replaced; a form with completed effects cannot.

### Requirement: R-M4-015 Render truthful status

When an operator requests run status, the Foreman runtime SHALL derive outcome, evidence, usage bounds, and next action from the existing journal.

#### Scenario: T-M4-015 Render truthful status

- **WHEN** Table journals cover every M4 base and registered M5 failure code, every M3 provider failure tag, all ordinary needs-action results, missing admission inputs, and pending/confirmed cancellation. Delivery result-contract cases include valid correction-limit data without audit/publication milestones, malformed duplicate/extra-key lookalikes, approved data with missing host evidence, and a generic-bound status-like list. Run product-router status text/JSON projections with provider calls forbidden and table-test run/resume admission plus post-admission mapping.
- **THEN** Each state and exact exit matches the normative failure tables: 0 success,1 failed,2 invalid,3 needs-action,4 cancelled,5 pending. Text/JSON agree on source span, evidence, reserved usage, unknown cost, and next action. No provider call or secret disclosure occurs. Valid delivery-needs-action exits 3 even without audit/publication milestones. Malformed bound final values fail final-result-invalid exit 1. Approved data with an unmet host milestone exits 3. Generic-bound data is not classified by a status-like key.

### Requirement: R-M4-016 Refuse invalid recovery

If recovery history is corrupt, incompatible, or owned by another active process, then the Foreman runtime SHALL refuse continuation with an actionable diagnostic.

#### Scenario: T-M4-016 Refuse invalid recovery

- **WHEN** Fixtures contain unordered sequence, wrong attempt, changed runtime profile, incompatible continuation, and live foreign owner lease. Call resumeProgram for each fixture and collect result diagnostics.
- **THEN** Each fails before host dispatch with journal-corrupt, binding-mismatch, continuation-incompatible, or owner-busy and a source or evidence reference.

### Requirement: R-M4-017 Recover exact immutable source

When a run resumes, the Foreman runtime SHALL reconstruct its checked program from immutable source and snapshot artifacts referenced by its journal.

#### Scenario: T-M4-017 Recover exact immutable source

- **WHEN** Start a fixture run, then edit its source file and replace the installed default snapshot. Other variants remove or alter the journal-bound source or registry artifact. Resume without an explicit checkpoint using saved pel.suspension.v1 and later result receipts.
- **THEN** Working-file and default-snapshot edits do not change the resumed program. Missing or mismatched bound artifacts return binding-mismatch exit 2 before dispatch. Saved counters match the durable boundary. Snapshot optionsDigest matches dependency mode, exact predicate selection, effective narrowed limits, and replay options. An executable registry differing from the stored effective snapshot fails binding-mismatch before dispatch.

### Requirement: R-M4-018 Replay provider tools and cursors

When a provider repeats a recorded host-tool request, the Foreman runtime SHALL resend its durable result without repeating the tool effect.

#### Scenario: T-M4-018 Replay provider tools and cursors

- **WHEN** A provider requests one allowed tool. Crash after pel.tool.result.v1 append and before sendToolResult. The stream restarts from the saved cursor and repeats the call ID. A negative variant changes arguments under that key. Resume the provider using pel.provider.cursor.v1, resolve recorded ToolResultV1 content, and feed duplicate tool events.
- **THEN** Tool execution count stays one. Recorded content/hash and authority are resent. Cursor advances only after durable tool/result/checkpoint state. Changed arguments yield journal-corrupt. Checkpoint bytes are persisted by M4, never by the adapter.

### Requirement: R-M4-019 Reserve only prepared external operations

When host preparation selects an external operation, the Foreman runtime SHALL reserve its declared ledger action exactly once before dispatch.

#### Scenario: T-M4-019 Reserve only prepared external operations

- **WHEN** Preparation variants select verification reuse, missing publication grant, task dispatch, authorized publication, and transient retry. Each operation exposes ledger and handler spies. Add a fresh bounded research-style read-result without a prior receipt and V1/V2 natural-language predicate authority fixtures. Call prepareHostEffect then the M4 dispatcher for all variants.
- **THEN** Reuse and missing grants add zero reservations. Task and authorized publication add exactly one matching action. Retry adds one provider_retry without a second implement charge. Handlers cannot reserve again or dispatch with a mismatched token. Fresh read-result validates and journals data with zero reservation and no required prior receipt. Stable IDs use existing ReserveAction.reservationId, not a new ledger key. A V2 evaluation child reserves evaluate; a V1-only predicate binding exits 2 before dispatch.

### Requirement: R-M4-020 Execute native output and predicates

When a registered print or natural-language predicate executes, the Foreman runtime SHALL persist its bounded output or Boolean result through the host journal.

#### Scenario: T-M4-020 Execute native output and predicates

- **WHEN** A native case uses a string condition under the bound nlConditionProfile, then print emits its selected result. Stop after receipt append and run with --json. Execute and resume through the compiled fixture CLI with the exact registered bounded-data/Boolean schemas.
- **THEN** The selected predicate profile/transport appears in the request. One predicate result and one output event persist. Replay makes zero repeated provider calls or print events. Stdout contains one final JSON object. Predicate output cannot authorize publication. Print with vals [1 2] returns [1 2], and recovery returns the identical value without another output event.

### Requirement: R-M4-021 Keep fixture evidence out of production

If a production invocation supplies fixture-backed binding data, then the Foreman runtime SHALL reject admission without creating live-qualified evidence.

#### Scenario: T-M4-021 Keep fixture evidence out of production

- **WHEN** The M2-owned fixture main is side-effect-free in pel-cli-fixture-main.ts, invoked only by test/pel-cli-fixture-entry.ts. Real assertions live in pel-cli-fixture.test.ts. A manifest binds copied assetRoot and assetManifestSha256. From a clean checkout run npm run verify, whose pretest builds the fixture bundle. Run the fixture CLI with mandatory --fixture-manifest, then product foreman.js with the same flag and fixture binding. Run a copied-asset variant.
- **THEN** Test globs select the real test, never a CLI entry. Fixture build completes before dependent tests. Copied assets resolve below manifest assetRoot with matching hashes. Missing manifest or wrong asset hash exits 2. Production rejects fixture flag/binding with zero dispatch. No fixture entry or recorded Layer appears in installation assets or live-qualified evidence.

### Requirement: R-M4-022 Reference durable payload artifacts within journal bounds

When durable Pel payloads exceed journal metadata bounds, the Foreman runtime SHALL persist hash-bound immutable artifacts before appending their journal references.

#### Scenario: T-M4-022 Reference durable payload artifacts within journal bounds

- **WHEN** A valid nested Pel result has depth 65 and a valid continuation exceeds one physical journal line. Tool content reaches its admitted limit. Faults stop after blob flush, corrupt a referenced blob, or remove a child continuation blob. Persist through existing artifact storage and unchanged RunJournal bounds, then resume from each fault boundary.
- **THEN** All journal records remain within 1048576 bytes, depth 64, 100000 nodes, and the 64 MiB replay budget. Deep values use references. Unreferenced blobs do not commit results. Missing/corrupt referenced blobs yield binding-mismatch and zero dispatch.

### Requirement: R-M4-023 Classify only validated final results

When evaluation returns a final value, the Foreman runtime SHALL validate its bound result contract and host milestones before choosing the run outcome.

#### Scenario: T-M4-023 Classify only validated final results

- **WHEN** A delivery-final schema binding receives valid needs-action, approved, duplicate-key, extra-key, and unknown-status results. A generic binding receives a status-like list. Call the final-result projector against each result and matching or missing milestone receipts.
- **THEN** Valid delivery-needs-action is exit 3 independently of milestone selection. Malformed typed results fail final-result-invalid exit 1. Unmet host milestones prevent success. Generic data is not interpreted as a delivery discriminator.
