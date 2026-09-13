# M4: Execute and recover Pel programs

## Outcome

One command executes an admitted Pel program. Operators can inspect results, request cancellation, and resume interrupted work with its original limits.
A durable receipt supplies the same ordinary Pel value after recovery.

## Existing integration points

| Existing path | Use in M4 |
| --- | --- |
| `packages/event-log/src/run-journal.ts` | Reuse `RunJournal.allocate`, `transact`, `append`, and `reserveResumeAttempt`. |
| `packages/event-log/src/stored-event.ts` | Keep the frozen envelope. Put versioned Pel records inside the opaque payload. |
| `packages/orchestration/src/execution-ledger.ts` | Reuse `EndstopLedger.execute`, `executeChild`, authority registration, and durable reservations. |
| `packages/orchestration/src/execution-terminal-policy.ts` | Preserve limit accounting, terminal rejection, and milestone decisions. |
| `packages/orchestration/src/round-transaction.ts` | Reuse attempt, command, checkpoint, and report service seams. Keep historical round behavior. |
| `packages/orchestration/src/resume-decision.ts` | Retain corruption, current-attempt, and ownership checks for legacy histories. |
| `packages/orchestration/src/supervisor.ts` | Keep discovery and exclusive ownership. Route Pel recovery to the new run owner. |
| `packages/orchestration/src/resume-queue-execution.ts` | Delegate admitted Pel continuation to the run owner. Do not add another retry loop. |
| `packages/launcher/src/supervise.ts` | Retain bounded subprocess output, process cleanup, timeout, and cancellation. |

The inspected journal supports generic event types. It has no Pel continuation decoder today.
The graph is navigation evidence. Direct source inspection established these integration points.

## Planned TypeScript interfaces

All paths below are planned unless listed above. Compile strict TypeScript and execute the product with Node.js 24.
Use Effect 3 through the existing workspace dependency for fallible services and scoped resource ownership.

| Path | Export and responsibility |
| --- | --- |
| `packages/orchestration/src/pel-run-contract.ts` | `ExecutionBindingV1`, `RunStatusV1`, `RunResultV1`, `RunFailure`, strict record decoders. |
| `packages/orchestration/src/pel-run-result.ts` | `classifyFinalResultV1(value, resultContract, journalEvidence)` validates final data and chooses the M4 run outcome. |
| `packages/orchestration/src/pel-runner.ts` | `runProgram(checked: CheckedProgramV1, binding: ExecutionBindingV1): Effect.Effect<RunResultV1, RunFailure, RunServices>`. Own the single run scope. |
| `packages/orchestration/src/pel-effects.ts` | `executeHostEffect(request, context): Effect.Effect<HostDispatchOutcomeV1, RunFailure, RunServices>`. Consume M1 requests through M2 descriptors. |
| `packages/orchestration/src/pel-journal.ts` | `recordIntent`, `recordObservation`, `recordResult`, and `replayPelRun`. Adapt existing journal operations. |
| `packages/orchestration/src/pel-resource-scope.ts` | `acquireEffectResources(reads, writes, owner)` and scoped concurrency permits. |
| `packages/orchestration/src/pel-recovery.ts` | `resumeProgram`, `reconcileEffect`, and `validateRevision`. Reuse recorded results. |
| `packages/orchestration/src/pel-control-functions.ts` | Register `fm/race`, `fm/retry`, and `fm/checkpoint` using M1 `ArgSpec` and M2 effect descriptors. |
| `packages/orchestration/src/pel-authoring-cli.ts` | Extend M2 argument parsing and command handlers for lifecycle commands. |
| `packages/orchestration/src/pel-authoring-main.ts` | Extend M2 compiled CLI entry point. |

`RunServices` contains journal, ledger, provider registry, host dispatcher, launcher, resource scope, and clock services.
`ExecutionBindingV1` contains run ID, attempt identity, contract ID and hash, authority hash, checked-program digest, state-root reference, and owner lease reference.
M2 supplies `CheckedProgramV1` and `PlanPreviewV1`. M1 supplies `PelValue`, `PelStep`, and its data-only continuation.
`PelStep` is `done`, `suspend`, or `failed`. The owner records a host result before supplying it to the evaluator.
The `suspend` step contains nonempty `ready: HostRequestV1[]`, a `PelContinuationV1`, and consumed counters.
Ready entries include `alreadyEmitted` and list all unreceipted requests in deterministic invocation order.
Repeated requests have `alreadyEmitted = true`. The owner joins them to existing effects and never dispatches them twice.
The owner validates and schedules that ready batch. It supplies `HostReceiptV1` success values or typed host failures to M1.
`HostDispatchOutcomeV1` is `settled` with a HostReceiptV1, or `waiting` with pending request ID, reason, observation reference, and optional preview data.
Only settled outcomes are sent to M1. Waiting outcomes preserve the request and its continuation for recovery.
Ready requests can wait for resource permits without creating a second scheduling authority.
The M3 `ProviderRequestV1` includes effect identity, exact profile, transport, instructions, artifacts, tool policy, schema, limits, and opaque continuation.
The runtime calls `ProviderTransport.start`, `sendToolResult`, `cancel`, `observe`, and `resume`. Adapters own transport I/O only.

`RunStatusV1.state` is `running | suspended | cancel-requested | cancelled | needs-action | succeeded | failed`.
`RunStatusV1.externalOutcome` is `none | pending | confirmed-complete | confirmed-cancelled | unknown`.
`needs-action` declares `resumeMode: "pending-effect"` or `"final-value"`. Only pending-effect can continue the same evaluator after external resolution.
Terminal statuses remain terminal unless a separate admitted successor run references their history.
`RunResultV1` adds program digest, attempt, final Pel value, artifact references, receipt references, usage bounds, and source-located diagnostics.
`ExecutionBindingV1` also binds `PelRunOptionsV1`, its digest, and the declared `resultContract`.
A diagnostic contains `code`, `sourceSpan`, `effectId`, `retryable`, and `nextAction`. Secret values never enter diagnostics.

`RunFailure.code` is one of `binding-mismatch`, `owner-busy`, `journal-corrupt`, `journal-write-failed`, `continuation-incompatible`, `budget-exhausted`, or `terminal-run`.
`HostEffectFailure.code` also includes `capability-denied`, `resource-denied`, `timeout`, `provider-failure`, `provider-refused`, `cancelled`, `unknown-external-outcome`, and `reconciliation-required`.
Preserve the M3 provider failure category and observed cancellation outcome as structured causes.
The bounded ordinary canonical JSON `cause.providerFailure` preserves the exact M3 union. Do not encode provider causes as Pel tagged values.
M1 validates the registered failure envelope. M4 validates each operation-specific cause decoder.

## Project configuration and admission

Add `packages/orchestration/src/pel-project-config.ts` for `ForemanProjectV1` and its strict decoder.
Store it at `<canonical Git common directory>/foreman/project.json`, shared across repository worktrees.
Resolve the repository through `packages/orchestration/src/project-registry.ts`. Reject a config whose project ID or repository identity differs.
The new `foreman project configure --settings FILE` subcommand validates and atomically writes these host settings once.
This operation references existing authority. It does not grant permissions or execute a workflow.
Reconfiguring cannot modify active run bindings. New runs use the new configuration digest.

`ForemanProjectV1` has `schemaVersion: 1` and these fields:

| Field | Exact content |
| --- | --- |
| `projectId`, `repository` | Existing project registry ID, canonical Git common directory, and repository identity digest. |
| `stateRoot` | Absolute existing execution state root, validated against the registry and authority. |
| `authorityRefs` | Content-hashed references to existing registered execution family/child authority and execution contract template. |
| `authoringSnapshot` | Immutable M2 base snapshot artifact reference, complete content digest, and registry/runtime handler version. |
| `limits` | Existing `ExecutionLimitsV1`, M1 `PelLimitsV1`, max concurrent effects, cost reserve, cancellation observation window, and replay fuel bound. |
| `requiredMilestones` | Existing contract milestones, including `checks`, `audit`, `integrated`, and `published` as authorized. |
| `workspaces` | Pool root, admitted immutable base, canonical writable path grants, maximum worktrees, and maximum race contenders. |
| `gates` | Registered gate IDs mapped to exact argv, allowed environment references, environment digest, output bounds, and timeout. |
| `destinations` | IDs mapped to operation kind, repository/remote/ref identities, expected old object ID policy, and authority references. |
| `roleBindings` | Role IDs mapped to exact M3 profile/transport, controls, and credential profile reference. |
| `taskActions` | Registered call-site `:id` values mapped to `implement` or `correct`, within existing authority. |
| `nlConditionProfile` | Exact profile, transport, controls, credential reference, and fixed `outputSchemaId: "schema:pel-boolean-v1"`. |
| `dependencyMode` | `ordered` or `automatic`, passed to M1 through bound `PelRunOptionsV1`. |
| `resultContract` | Immutable registered result schema ID and classification `generic` or `delivery-v1`, within the admitted policy. |

Unknown fields fail. Configured limits and resource grants can narrow existing authority, never expand it.
Gate argv and destination data are host metadata. They contain no new workflow order or arbitrary executable Pel source.
`deriveExecutionBinding(config, checked, validatedAuthority, runIdentity, now)` is a pure function returning binding and `ExecutionContractV1`.
It derives objective/acceptance hashes, allowed paths, limits, deadlines, authority, and required milestones from existing registered records and checked source.
It rejects unresolved authority references, unsupported action mappings, and any expansion of the existing contract.
The resulting binding hashes full snapshot content, role mappings, predicate selection, configuration, source, and existing authority.
M2 owns `buildEffectiveAuthoringSnapshotV1(base, selection)`. M4 uses that same pure function before check and admission.
The project configuration is authoritative for roleBindings, nlConditionProfile, and dependencyMode. Base snapshot selections are defaults only outside configured projects.
The function replaces these selection fields in a derived snapshot, validates them against the base admission envelope, and recomputes all affected digests.
Configured limits are narrowing constraints. Derive effective limits fieldwise within the base bounds and reject attempted expansion.
The same builder receives resultContract and narrowingLimits, so check, preview, and runtime share one effective limit and result policy.
The base artifact stays immutable. Changing configured roles creates a new effective snapshot artifact and digest without changing source bytes.
Configured check, plan, and run all use this effective snapshot. An explicitly supplied checked context must match its digest or fail binding-mismatch, exit `2`.
Admission builds the full pure registry from M2 descriptor/schema records, with a separate map of available executable handlers.
The canonical declarative source is M2's `packages/orchestration/src/pel-host-descriptors.ts`.
Its descriptor/schema/resolver digest must equal the effective snapshot registryDigest before any reservation or dispatch.
Require handlers for every reachable effect and every conservatively possible function in a bounded dynamic region, not every unused descriptor.
An absent reachable handler or changed pure descriptor fails binding-mismatch, exit `2`. Handler attachment cannot alter a descriptor.
Unused M5/M6 descriptors can remain data without handlers, so M4 implementation does not depend on those later runtimes.
M4 race/task-shaped tests inject deterministic handlers against shared descriptors and label them test-fixture, without claiming M5 implementation.
The run journal records the derivation inputs by immutable reference before any host effect.
Missing or invalid project settings, source, snapshot, profile admission, or binding returns exit `2` with zero dispatch.
M6 packages this settings schema and documents the configure command, followed by the standard `foreman run FILE`.
The configure operation registers the canonical state root/repository association through the existing project registry seam.
This M4-owned registration works from a checkout without an installation prefix. Configuration never writes M6 installation files.
M6 later projects registered roots into its installation rollback-discovery inventory. That projection is not execution authority.

## Journal and recovery protocol

Use `pel.run.v1`, `pel.suspension.v1`, `pel.effect.intent.v1`, `pel.effect.observed.v1`, `pel.effect.result.v1`, `pel.checkpoint.v1`, and `pel.cancel.v1` payload types.
Tool and stream durability also use `pel.tool.intent.v1`, `pel.tool.result.v1`, and `pel.provider.cursor.v1`.
The remaining Pel record types are `pel.child-suspension.v1`, `pel.revision.v1`, `pel.revision-mapping.v1`, `pel.recovery-decision.v1`, and `pel.output.v1`.
`pel.effect.intent.v1` contains preparation digest and ledger reservation reference together. There are no separate Pel preparation or reservation-reference records.
The external-effect sequence is suspension, existing-ledger reservation, combined Pel intent, observation, and result.
Read-only reuse has suspension then result without an external intent or action reservation.
Recoverable needs-action has suspension then observation, leaving its evaluator request pending without a terminal result.
Also register `pel.failed-step.v1`, `pel.race.decision.v1`, and `pel.authority-observed.v1` payloads under the frozen event envelope.
Each payload includes schema version, checked digest, runtime version, language profile, attempt identity, and relevant authority binding.
`pel.run.v1` references immutable artifacts containing exact source bytes, complete `AuthoringSnapshotV1`, registry content, and project configuration.
Each reference contains artifact ID, byte length, and SHA-256. Use the existing artifact state root, not another database.
Persist and verify these artifacts before run admission completes. The journal remains authoritative for their identity.
Resume reads these bytes and re-checks their hashes. It never rereads the operator's current source file or installed default snapshot.
A missing or mismatched artifact yields `binding-mismatch`, with no dispatch.

Persist `pel.suspension.v1` before dispatching every newly ready batch and after each resumed evaluator reaches its next boundary.
The payload stores a hash-bound continuation artifact reference, pending request mapping, and exact committed reduction/iteration counters.
It includes the bound run options and optionsDigest. Normal recovery uses `resumePel(program, registry, continuation, receipts, options)`.
Apply any later recorded results to that suspension. Do not rerun completed pure prefixes or charge their counters again.
If no suspension exists, evaluate the immutable source from its initial zero-counter state. No external effect could have dispatched yet.
Explicit checkpoints name these same durable evaluator boundaries. They are not a prerequisite for ordinary recovery.
Pure work after the last durable boundary may repeat within the same saved allowance, without incrementing committed counters twice.

`pel.child-suspension.v1` records each child by `(parentRequestId, childInvocationId)` before any nested dispatch.
Its payload contains parent effect ID, closureArgumentDigest, continuationRef, optionsDigest, allocated limits, consumed counters, pending effect mappings, and phase.
It also contains the one-based attempt/contender index, allocated workspace grant reference, immutable base identity, and latest winner-decision reference.
Phase is `active`, `done`, or `abandoned`. The payload also records a monotonic tranche ordinal and last counter-charge sequence.
Persist child state at allocation, each suspension, and terminal/abandoned transition. Parent suspension references the latest child record sequence.
Recovery restores the complete parent/child tree before issuing nested requests, including all outstanding receipts and remaining allocations.
Charge only each child's newly consumed counter delta at a new tranche ordinal. Replaying the same child record cannot charge it twice.
Retry resumes its recorded current attempt. Race restores both contenders and any already committed winner before considering new work.
`pel.race.decision.v1` binds the parent request, eligible contender result receipts, selected source index, grant references, and decision sequence.
Commit the decision before exposing the winner value. Recovery without a decision selects from existing durable eligible results and appends one decision.
Recovery reuses allocated worktree grants and never allocates replacement grants for already recorded contenders.

Use M1 `encodeHostArgumentsV1(boundArgs, environmentTable)` for all control-wrapper argument hashes and journal encodings.
Data values use the canonical Pel tags. Internal closures use a closure-ref record with sourceDigest, nodeId, environmentId, environmentDigest, argSpecDigest, and bound arguments.
M1 canonically numbers reachable environments by deterministic traversal and hashes the canonical graph, including parent links and captured bindings.
Assign environment IDs on first visit before following edges, with lexical keys sorted. Hash the complete digest-free node/reference table to handle cycles.
Decode validates all references and digests before continuation. Identical closure captures produce identical hashes after encode/decode.
This internal encoding never becomes a provider result or ordinary PelDataValue. Syntax-valued arguments remain forbidden.
M1 `requestId` hashes source and registry digests, AST node identity, and the full logical invocation path.
M4 `effectId` hashes run ID, admitted revision digest, attempt identity, request ID, and retry ordinal.
Persist that deterministic mapping in each intent and receipt. Ordinal zero identifies the initial attempt.
Retries increment the ordinal and link the prior effect ID. A prior receipt never completes a new retry ordinal.
Replay can reuse a receipt only when the complete mapping matches. Repeated loop visits have distinct M1 invocation paths.
Checkpoint values contain AST positions, lexical values, pure closure code references, captured values, and pending effect identities.
Store data-only bounded records. Do not serialize JavaScript closures, capabilities, process handles, or secret material.
Opaque provider continuation belongs to its original profile and transport. Journal entries reference its protected artifact by hash.

For each host request:

1. Validate resolved arguments against M2's checked capability and budget envelope.
2. Resolve actual resources, acquire scoped permits, and revalidate canonical identities.
3. Run bounded read-only preparation to select reuse, read-result, recoverable needs-action, or a dispatch operation.
4. Record completed local results, or persist recoverable observations while leaving their evaluator requests pending.
5. For dispatch, reserve its declared action once through the existing ledger using the stable effect key.
6. Append intent, preparation digest, and reservation reference before external dispatch.
7. Dispatch the prepared operation with that reservation token.
8. Persist provider identities, cursors, and tool observations as they become available.
9. Append the validated canonical result before supplying it to the evaluator.

`prepareHostEffect(request, context)` returns `PreparedHostEffectV1`: `reuse`, `read-result`, `needs-action`, or `dispatch`.
Reuse contains the original receipt and adapted Pel result. Read-result contains fresh validated bounded local data and immutable source references/hashes.
Read-result requires no prior effect receipt and reserves no external action. M6's read-only fm/research uses this preparation kind.
Needs-action contains diagnostic preview data and the unmet host requirement. It is an observation, not a completed HostReceiptV1.
Dispatch contains an operation digest, resolved resources, one ledger action kind, and immutable dispatch inputs.
Preparation permits bounded artifact and authority reads only. It cannot start providers, run gates, mutate worktrees, or publish.
A preparatory refusal or reuse adds zero action reservations. The derived preparation record is not another authored workflow.
Only M4 dispatch reserves actions. Handlers validate the supplied reservation token and never reserve again through `executeChild`.
The token binds effect ID, action, operation digest, candidate, and attempt. Preparation and execution retain the resource lock.
Changed authority or candidate identity invalidates dispatch before an external effect.

| Operation | Reservation policy |
| --- | --- |
| `fm/task` | One `implement` or `correct` action from the admitted call-site action map. |
| `fm/verify` | Reuse matching evidence for zero actions, otherwise one `verify` action. |
| `fm/review` | One `audit` action after evidence and independence preparation. |
| `fm/publish` | Missing grant is needs-action with zero actions, otherwise one admitted `publish` action. |
| `pel/nl-condition` | One `evaluate` action under existing V2 evaluation child authority, with reserved model usage. |
| `print`, `fm/checkpoint` | No external action reservation. Journal and output bounds still apply. |
| `fm/race`, `fm/retry` | The wrapper reserves no task action. Each nested external effect uses M4 reservation. |
| Provider retry | One `provider_retry` action replaces another implementation/correction charge for the same logical operation. |

Ledger reservation and intent append are not assumed to share one atomic transaction.
Recovery joins them by stable effect key. A reservation without intent remains spent until deterministic reconciliation confirms no dispatch.
Reuse the existing V1/V2 `ReserveAction.reservationId`, set to `pel-` followed by SHA-256 of effect ID, action, and preparation digest.
The resulting identifier fits the existing 128-character bound. Reconciliation reuses that exact reservation ID, not a new accounting record.
V1 dispatch uses `EndstopLedger.execute`. V2 child dispatch uses `executeChild` with existing authority, origin reservation, candidate, and task-plan bindings.
`pel/nl-condition` requires an existing admitted V2 evaluation child authority, because V1 ExecutionActionKind has no `evaluate` action.
A V1-only predicate binding fails admission with exit `2` before dispatch. This release does not add an evaluate action to V1.
A crash after intent can leave an unknown outcome even without a provider request ID.
Never infer no dispatch from a missing provider ID. Reconcile through M3 when supported, otherwise require a bound recovery decision.
The supported decision file schema is `PelRecoveryDecisionV1` with run, effect, checked digest, decision, evidence refs, and authority receipt.
Decisions are `accept-result`, `confirm-no-dispatch`, or `abandon`. A decision cannot grant broader capabilities or replenish limits.
Unresolved external cost keeps the original conservative reservation. Recorded receipt replay performs zero provider calls.
Identical duplicate receipts are no-ops. Conflicting receipts fail with `journal-corrupt` and preserve both evidence references.

Unknown external outcomes, reconciliation-required, timeout with an unconfirmed remote outcome, and publication awaiting authority are recoverable observations.
For these outcomes, append `pel.effect.observed.v1`, set run needs-action, and retain the host request in the latest suspension's pending set.
Do not send a failure or success receipt to M1. A valid M1 receipt would consume that request and prevent later recovery.
On resume, re-prepare the same pending request or apply its bound decision. Accept-result supplies one validated success receipt without redispatch.
Confirm-no-dispatch permits the already reserved operation to dispatch once. Abandon supplies terminal `reconciliation-abandoned` failure and preserves unknown usage.
For missing publication authority, re-preparation reads current registered authority for the same candidate/action/destination envelope.
An added matching existing-authority receipt is recorded in `pel.authority-observed.v1` before one publish reservation and dispatch.
It cannot expand admitted paths, actions, budgets, or destination scope. Completed task and verification receipts remain unchanged.
Only final pure delivery-needs-action data or an explicitly completed local operation can be terminal Pel data.
Run status may show preview result data for a pending operation, but labels it uncompleted and never treats it as an effect receipt.

Store deep or large values in existing immutable artifact storage, not inside physical journal lines.
Continuations, child state bodies, canonical arguments/environment tables, host results, tool contents, and output bytes always use hashed artifact references.
Write and flush each blob before appending its journal reference. Metadata records contain only bounded identities, lengths, hashes, and state transitions.
The journal's existing limits remain 1,048,576 bytes per physical line, depth 64, 100000 nodes, and 64 MiB total replay input.
Validate metadata against those limits before append. Do not increase them or add a second store to fit Pel values.
Artifact limits remain the admitted M1/M3 byte/depth limits. A large allowed value can exceed one journal-line bound while its reference remains small.
Resume verifies every referenced blob before interpretation or dispatch. Missing/corrupt artifacts yield binding-mismatch with zero dispatch.
A crash after blob flush but before journal append leaves an unreferenced blob, not a committed result or permission to dispatch.

For provider-requested host tools, the deduplication key is `(effectId, complete ProviderIdentityV1, callId)`.
`pel.tool.intent.v1` records this key, tool name, canonical argument hash, capability binding, and tool reservation reference before tool dispatch.
`pel.tool.result.v1` records the same key, canonical content artifact reference, content hash, `isError`, and receipt reference before sending it to the provider.
Identical duplicate calls resend the recorded result without executing the tool. Changed arguments under an existing key yield `journal-corrupt`.
M4 supplies M3 `ToolResultV1` with host-resolved `content`, `contentSha256`, `maxBytes`, authority binding, and receipt reference.
Content is `{kind: "json", value: JsonValue}` or `{kind: "text", text: string}`, bounded by 1 MiB and the smaller admitted limit.
Adapters never read host artifact storage. Host-dispatched tool accounting stays under the parent admitted tool budget and existing ledger owner.
An intent without a result is uncertain, not a reason to repeat a non-idempotent tool. Reconcile or report needs-action.

`pel.provider.cursor.v1` records provider identity, originating effect, opaque cursor, and the preceding durable event sequence/hash.
Persist tool results and checkpoint artifact references before advancing beyond their stream cursor.
On resume, load the last durable cursor, deduplicate replayed events, and resend recorded tool content when the provider repeats its call.
M3 checkpoint events carry bytes and metadata only. M4 validates their hash and writes protected immutable artifacts through existing host storage.
Use format version, prefix hash, retention, and originating model/transport in the artifact binding. Opaque content never crosses profiles.
Native tools wholly executed inside a provider remain external effects subject to that transport's enforceable sandbox and observation limits.
The host does not claim per-tool receipts for native operations that the transport does not expose.

`fm/checkpoint :name` returns `[:name "label" :sequence 12]`, using its actual label and journal sequence.
Resume validates journal ordering, hashes, attempt identity, runtime compatibility, and the owner lease before evaluator activation.
Resume retains the admitted execution attempt identity. `reserveResumeAttempt` increments only its resume counter, not a new execution attempt.
A source edit requires `foreman resume RUN --revision FILE --decision FILE` with a separate `PelRevisionDecisionV1`.
This decision contains parent and revised source digests, completed-prefix digest, authority receipt, and the pending suffix boundary.
`PelRevisionMappingV1` binds the decision, old/new checked digests, completed top-level prefix count, and normalized prefix AST digest.
Each row records old request ID, old effect ID, revised node ID, revised invocation path, new request ID, argument digest, and result receipt.
The completed prefix contains whole top-level forms with identical normalized AST subtrees and invocation paths.
Every mapped call must have identical normalized arguments and result schema. A changed completed call fails `continuation-incompatible` before dispatch.
A partially completed top-level form with completed host effects cannot be revised. Resolve it first or submit a separate admitted run.
A failed top-level suffix with no completed host effect can be replaced, retaining all consumed work counters.
Arbitrary edited expression interiors that require effect remapping remain outside this release's revision support.

Re-check immutable revised source and start a new evaluator from the beginning. Never supply an old continuation to a changed-source evaluator.
When evaluation reaches a mapped request, supply the old result through a HostReceiptV1 addressed to the new request ID.
Append the alias mapping first. Preserve the old effect ID, parent revision digest, attempt, and reservation.
Mapped result reuse performs zero dispatch and zero reservation. New suffix effects use the new revision digest.
Re-evaluation validates prefix reductions and iterations against the recorded boundary, then restores the latest total committed counters before evaluating new code.
Persist `pel.failed-step.v1` with failed continuation, counters, optionsDigest, and diagnostic references before accepting a revision after an observed failure.
This record includes work after the last suspension. Revised execution starts with that debit, not merely the completed-prefix debit.
Source bytes, token count, AST size, and depth/value peaks follow M1's field-specific rules against the new checked source and original limits.
Replay uses a separate bounded replay-fuel allowance. It cannot replenish execution reduction, iteration, cost, or action counters.
Reject prefix trace or counter divergence before dispatch. An incompatible runtime also yields `continuation-incompatible`.
`PelRunOptionsV1` selects dependencyMode and exact nlConditionProfile with its digest.
Its replay field is `{mode: "none"}` or `{mode: "completed-prefix", completedPrefixCount, prefixDigest, recordedCounters, committedCounters, maxReplayReductions}`.
RecordedCounters validates the completed prefix. CommittedCounters carries the old total, including the failed expression.
Replay reductions and iterations use the separate bounded validation allowance. New suffix work adds to committed execution totals.
The optionsDigest hashes all these fields and participates in continuation validation, child contexts, revision records, and checked bindings.
Call `startPel(program, environment, limits, options)` for fresh or revised evaluation. Never emulate replay by resetting ordinary counters externally.

## Native execution and resource ownership

Native `do` preserves source order. Native `do/async` preserves the M1 last-source-expression result contract.
The runtime applies M1 dependency edges and M2 resolved resource declarations before dispatching eligible expressions.
Parallel read/read access is allowed. Write/write and read/write overlap waits for exclusive access.
`resolveResources(descriptor, boundArgs, ctx): Effect.Effect<ResourceSetV1, HostEffectFailure, ResourceIdentityReader>` resolves actual resources before preparation.
M2 uses the descriptor's data-only resource rule and abstract arguments to derive an envelope. M4 resolves actual paths through bounded host reads.
`ResourceSetV1` contains canonical read/write IDs and an optional admitted unknown scope. Resolver output must fit the M2 envelope.
Canonical identity includes repository ID, Git common-directory identity, worktree identity, and realpath after symlink resolution.
Normalize separators and platform case rules. Resolve nonexistent children through their existing real ancestor and validate containment.
Revalidate directory identity after lock acquisition. Symlink aliases and path replacement cannot bypass conflicts.
An unknown resource declaration takes the admitted workspace-wide exclusive lock.
Acquire complete resource sets in canonical order. Release them with the effect scope to avoid deadlock.
Provider concurrency permits and resource permits belong to the same run owner, with no scheduler database.

`fm/race :tasks [closures] :winner "first-valid"` requires finite M2 closure effect envelopes before allocation or dispatch.
M4 allocates a separate worktree grant for each one-based contender index from the admitted workspace pool before any task dispatch.
The child `HostContextV1` carries this grant. `fm/task` resolves its workspace from that context, not a new Pel permission.
Allocate from the immutable admitted base and record worktree IDs. Reject absent capacity, shared external writes, or unanalyzable envelopes before provider dispatch.
Native do/async outside race inherits the parent workspace. It serializes conflicting tasks unless admitted context already supplies distinct grants.
Control wrappers hold no child worktree lock while evaluating closures. They reserve pool capacity, then nested effects acquire their own resource sets.
They also hold no external-effect concurrency permit while child effects run. A race with maxConcurrentEffects equal to one can therefore make progress.
This prevents a parent race or retry from deadlocking its children on resources it already owns.
The winner is the first schema-valid, policy-eligible result with a committed journal decision.
Simultaneous eligibility uses source order. The owner cancels losers and waits for local cleanup.
Unknown remote cancellation remains visible and charged. Losing artifacts remain isolated and cannot become publication inputs.
The exact race result is `[:winner-index 1 :value winnerValue :losers loserRows]`, with unique keys.
Each loser row is `[:index 2 :cancellation "unknown" :artifacts ["artifact:loser"]]`, using actual observed values.
Use `(raceResult :at ':value)` to obtain the candidate-bearing value. The wrapper is not itself a candidate value.
`fm/retry :attempts N :on [categories] :body closure` uses the existing action, cost, and deadline budgets.
`attempts` is the total number of body evaluations, including the initial one, and must be a positive admitted integer.
Only M3 `RateLimited` and `TransportDisconnected` can retry, selected by Pel keywords `:rate-limited` and `:transport-disconnected`.
The `:on` value is a list of quoted keys: `[':rate-limited ':transport-disconnected]`.
This evaluates to key values. A quoted whole list yields syntax, while unquoted keys form nil pairs, so both are invalid arguments.
Reject either invalid representation or unknown keys with `capability-denied` before evaluating the body or reserving any action.
All other M3 tags and host policy failures are nonretryable. Preserve the M3 tag as the structured provider-failure cause.
A retry creates a new provider session when required. It never forwards opaque state across models or transports.
Timeouts interrupt local work and request remote cancellation. Neither timeout nor process exit confirms remote cancellation.

Trusted control-function arguments can contain internal `PelClosureValue` data. Ordinary host return values cannot contain closures.
M1 exports `evaluateClosure(closure: PelClosureValue, args: readonly PelValue[], context: ClosureEvaluationContextV1): PelStep`.
The context binds program, profile, registry, parent request, child invocation, lexical environment, and allocated finite remaining limits.
Retry child IDs are `${parentRequestId}/retry/${attemptIndex}`, with one-based attempt indices.
Race child IDs are `${parentRequestId}/race/${contenderIndex}`, with one-based source-order indices.
These IDs enter nested M1 invocation paths. Restart cannot use an earlier child receipt for a later ordinal.
`HostContextV1.retryContext` contains parent retry request ID, one-based attempt index, and logical-operation key for each nested external effect.
The key combines the parent retry request ID with the nested invocation suffix after removing that parent's `/retry/N` segment.
Include nested call-site and loop indices in the suffix. Two nested effects remain distinct keys.
Attempt one reserves the admitted implement/correct/verify action. A later attempt with the same logical key reserves only provider_retry.
An effect first reached on a later attempt has no earlier matching key and uses its normal action reservation.
The durable effect retry ordinal is attemptIndex minus one, and its priorEffectId links the preceding recorded effect for that key.
Persist the logical key, attempt index, and prior link in child state and intent. Recovery cannot infer them from a new provider session.
Call M1 `extractClosureEnvironment(parent, closure)` for the validated lexical table.
M1 exports `mergeClosureResult(parent: PelContinuationV1, invocationId: string, receipt: HostReceiptV1, consumed: PelCounters): PelStep`.
M4 runs child evaluation within the same run scope and dispatches its suspended host batches through the existing dispatcher.
A valid failure receipt yields `PelStep.failed` with `PEL_HOST_FAILURE` and the exact HostEffectFailure.
`fm/retry` classifies that child failure before merging. Ordinary language diagnostics are never provider retries.
An unretryable failure merges once into the parent, stops new dispatch, and cancels pending sibling scopes.
Debit consumed counters for every child, including losers and abandoned attempts, even when its result is not merged.
Deduplicate counter accounting by child invocation ID. M1 merge updates the evaluator view, not a second independent budget charge.
M4 debits child reduction and iteration counters from the shared run envelope before granting another tranche.
Children cannot each inherit the full unused run budget. M1 validates child identity and counter limits when merging the result.
Never pass internal closure values to provider transports or persist them as JavaScript functions.

## Command behavior

`foreman run FILE` resolves the configured project state root and existing execution authority, then checks and admits the program.
This is the standard operator entry point. It requires no separately authored JSON task plan or repeated manual admission ceremony.
`--binding FILE` and `--state-root DIR` provide explicit integration and fixture overrides. They cannot expand existing authority.
`--json` selects machine-readable output for any lifecycle command.
`foreman status RUN --state-root DIR --json` derives status from the journal and performs no provider call.
`foreman cancel RUN --state-root DIR --json` appends an idempotent cancellation request and signals the current owner.
`foreman resume RUN --state-root DIR --json` recovers only after ownership, history, authority, and budget checks.
`--decision FILE` supplies an explicit recovery record. `--revision FILE` additionally supplies changed Pel source.
State-root arguments on status, cancel, and resume are optional overrides. Normal commands resolve the same configured project root.
Run/resume overrides must match a canonical state root and repository association already registered through the M4 project registry.
An unregistered override fails exit `2` before dispatch. It cannot implicitly register itself or inherit another root's authority.
Checkout runs require no installation prefix. Fixture overrides must additionally match the fixture manifest root.
Installed M6 commands project registered roots into rollback inventory before execution. The project registry remains the source of root associations.
The compiled product entry point is `node skills/foreman/runtime/dist/foreman.js` with the same arguments.
The public `foreman` entry point forwards to that bundle through the M2 command wiring.

`run` and `resume` stay attached and own their Effect scope until success, failure, cancellation, or needs-action.
There is no implicit daemon or detach mode. Exit `5` belongs to status/cancel observations, not a normally completed attached run command.
After durable admission, emit the run ID immediately on stderr before any provider dispatch.
Text mode emits `run-id: RUN`. JSON mode emits one stderr event `{"type":"run-started","runId":"RUN","state":"running"}`.
The final stdout value in JSON mode is exactly one `RunResultV1`, also containing `runId`.
Before run allocation, invalid requests instead return `CliFailureV1` with schemaVersion, outcome `invalid`, code, and diagnostics, without an invented run ID.
Status and cancel can use the initial ID while the attached command is running.
An abruptly killed owner leaves a recoverable suspended run after existing lease reconciliation, never a fabricated terminal result.

Lifecycle exit codes are `0` succeeded, `1` failed, `2` invalid request, `3` needs-action, `4` cancelled, and `5` pending.
`status` returns that state code. `cancel` returns `5` while confirmation is pending, then `4` only for confirmed cancellation.
A successful read of a failed run does not emit an execution-success code.
Local ownership recovery uses existing supervisor lease evidence. A stale process identifier alone cannot authorize takeover.

## Failure and cancellation outcomes

The shared CLI classes are `0` success, `1` failed, `2` invalid input/admission, `3` needs-action, `4` cancelled, and `5` pending.
M2 and later CLI subcommands use these same outcome classes. Generation exhaustion is failed `1`, not cancelled `4`.
Run/resume reject missing source or settings, malformed source, unavailable profile admission, and invalid binding with `2`, before dispatch.
Once admitted, recorded host failures use this exhaustive mapping. Registry failure schemas permit only the listed domain codes.

| Failure code or condition | Run state | Exit |
| --- | --- | --- |
| `binding-mismatch`, `owner-busy`, `continuation-incompatible`, `terminal-run` during admission/recovery validation | invalid request, no continuation | 2 |
| `journal-corrupt`, `journal-write-failed` | failed, preserving any unknown external outcome | 1 |
| `budget-exhausted`, ordinary M1 diagnostics, `PEL_HOST_RESULT` | failed | 1 |
| `capability-denied`, `resource-denied` after admission | failed | 1 |
| `unknown-external-outcome`, `reconciliation-required` | needs-action | 3 |
| `task-output-invalid`, `artifact-missing`, `candidate-out-of-scope`, `candidate-changed` | failed | 1 |
| `verification-unavailable`, `review-not-independent`, `review-invalid` | failed | 1 |
| `publication-authority-invalid`, `publication-destination-unsupported` | failed | 1 |
| `final-result-invalid`, `reconciliation-abandoned` | failed | 1 |
| `provider-refused` with its preserved refusal observation | failed, no retry | 1 |
| `timeout` with confirmed local/remote cleanup and known outcome | failed | 1 |
| `timeout` with unconfirmed remote outcome after observation window | needs-action with unknown external outcome | 3 |
| `cancelled` with confirmed required cleanup and cancellation | cancelled | 4 |
| Ordinary needs-action result or unmet required review/publication milestone | needs-action | 3 |
| Pending provider or cancellation observation within its finite window | running or cancel-requested | 5 for status/cancel |

`provider-failure` retains the canonical M3 union from `packages/providers/src/errors.ts`:

| M3 tag | Retry selection | Final state after optional retry |
| --- | --- | --- |
| `RateLimited` | `:rate-limited` | failed `1` when the bound is exhausted |
| `TransportDisconnected` | `:transport-disconnected`, only with safe continuation or confirmed no-dispatch | failed `1`, or needs-action `3` if outcome is uncertain |
| `OutcomeUnknown`, `ResumeUnavailable` | Never | needs-action `3` |
| `ModelUnavailable`, `ModelMismatch`, `UnsupportedCapability`, `CapabilityUnverified`, `PromptChannelUnsupported` | Never | failed `1` after admission, invalid `2` during admission |
| `AuthenticationRequired`, `ProbeUnknown` | Never | needs-action `3` after admission, invalid `2` during admission |
| `OutputInvalid`, `OutputIncomplete`, `MalformedEvent`, `ContinuationMismatch` | Never | failed `1` |

Exhaustive TypeScript switches cover this union in the M2 generation loop and M4 retry classifier.
Cancellation and refusal are normalized observations, not invented M3 failure tags. M4 maps them to `cancelled` and `provider-refused`.

The admitted `cancellationObservationMs` is finite, positive, and no greater than the remaining run deadline.
Begin this window when the first cancellation request is durable. Repeated cancel requests do not reset it.
M3 remote `pending` maps to M4 `pending`. Remote `completed` maps to `confirmed-complete`.
Remote `cancelled` maps to `confirmed-cancelled`. Remote `unknown` or `unsupported` maps to `unknown`.
After local cleanup and window expiry, unknown or unsupported remote outcome becomes needs-action `3`, never indefinite pending `5`.
An effect without a remote component needs confirmed local cleanup only. It can become cancelled `4` immediately after cleanup.
If remote work completed before cancellation, preserve confirmed-complete. The cancellation request cannot rewrite completion as cancellation.
Observe later remote state through M3 `observe` or terminal stream events. `not-found` alone does not prove no dispatch or no charge.

## Final value classification

M1 returns the last source top-level value for a nonempty program, after all required asynchronous work settles.
M4 `ExecutionBindingV1.resultContract` contains an immutable schema ID and `generic` or `delivery-v1` classification, hashed into the checked binding.
M2's shared descriptor module registers `schema:delivery-final-v1` and the exact `schema:delivery-needs-action-v1` association schema.
The delivery-final union contains the supported task, verify, review, publish, and delivery-needs-action result schemas.
After `PelStep.done`, validate the final value against the bound schema before interpreting any status-like field.
Malformed, duplicate-key, extra-key, or unknown-status lookalikes yield `final-result-invalid`, failed exit `1`, with a source diagnostic.
Under delivery-v1, a validated delivery-needs-action value yields needs-action exit `3`, even when no audit/publication milestone is required.
Validated negative verification, review, or pending publication results also yield needs-action. They cannot satisfy host milestones.
An approved or published-looking value requires current host journal evidence for every declared milestone and referenced receipt.
Missing required evidence yields needs-action exit `3`, regardless of model or program claims.
Under generic classification, a list containing a status-like key remains ordinary data. Only host milestone and pending-effect state determine run outcome.
A valid generic done value with satisfied required milestones succeeds, even if user data contains the string needs-action.
Terminal final needs-action data has no pending host request to re-prepare. Resume reports that state without redispatch or resetting limits.
Recoverable waiting effects use the separate pending-observation protocol, not final-value classification.

## Remaining native host functions and test injection

Add `packages/orchestration/src/pel-native-host.ts` for executable `print` and `pel/nl-condition` handlers.
`print` follows M1's exact ArgSpec and returns its input `vals` unchanged after durable host output.
Persist formatted output as a bounded `pel.output.v1` event before acknowledging print completion.
Human mode renders it on stderr. JSON mode retains it in the journal and result output references without adding stdout text.
Repeated recovery of a completed print event does not re-emit it as a new output event.
`pel/nl-condition` follows M1's scrutinee/condition arguments and returns a Boolean under its registered Boolean schema.
Its descriptor uses `outputSchemaId = "schema:pel-boolean-v1"`. Print uses `schema:pel-data-v1` with admitted depth and byte bounds.
Resolve its exact model, transport, controls, and credentials from the bound `nlConditionProfile`.
Send immutable scrutinee and condition data with `toolPolicy` none. A non-Boolean provider result fails schema validation.
Journal and replay its result like any other provider effect. It never supplies authority or verification evidence.

M2 owns `makeForemanCli(services)`, the minimal fixture bootstrap, and `scripts/build-pel-test-fixture.ts`.
M4 extends that shared router and bootstrap with lifecycle services and tests.
Production `pel-authoring-main.ts` installs live services only.
`packages/orchestration/src/pel-cli-fixture-main.ts` exports a side-effect-free fixture main that M4 extends with recorded run services.
`packages/orchestration/test/pel-cli-fixture-entry.ts` alone invokes main and is the test-only esbuild entry.
`packages/orchestration/src/pel-cli-fixture.test.ts` contains T-M4-021 assertions. Test discovery never imports an executable main as a test file.
Build the entry with `npx esbuild packages/orchestration/test/pel-cli-fixture-entry.ts --bundle --platform=node --format=esm --target=node24 --outfile=packages/orchestration/dist-test/pel-cli-fixture.js`.
M2's `test:pel-fixture-build` script performs that build and prepares hashed checkout assets.
The root `pretest` hook runs `npm run test:pel-fixture-build`, so clean `npm test` and `npm run verify` build fixtures before dependent tests.
Focused fixture-dependent test commands also run that script first. Tests never assume a previously built bundle.
Its test-entry-only `--fixture-manifest FILE` argument selects a bounded fixture manifest and is removed before calling the shared product router.
The exact invocation is `node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest FILE run PROGRAM --json`.
The manifest contains schemaVersion, fixture ID, temporary root, recorded provider event files with hashes, clock schedule, and test-fixture binding reference.
It also requires `assetRoot` and `assetManifestSha256`. The root contains `runtime/assets/pel` and `examples`, including copied installed assets.
Resolve fixture assets only below that canonical root and validate their manifest hashes before reading snapshots or examples.
The checkout-built fixture bundle never infers an installation root from its own file path.
Production rejects `--fixture-manifest` with exit `2`. No product environment switch or provider fixture loader exists.
Exclude that entry, fixture manifests, and recorded-provider Layer from production `dist/foreman.js` and the installation manifest.
Fixture bindings permit only temporary local resources. They always report `evidenceKind = "test-fixture"`, never live-qualified.
Production rejects test-fixture binding data with exit `2`, including attempts through explicit `--binding` overrides.
Tests that require recorded providers use the compiled fixture entry. Production-bundle tests cover parsing, denial, help, and live-service selection without dispatch.

## Planned validation

Use deterministic provider fixtures, injected clocks, resource barriers, journal fault seams, and isolated temporary repositories.
Cover six crash boundaries: before reservation, after reservation, after dispatch, after external completion, during verification, and during cleanup.
M5 supplies the verification-specific fault fixture. M4 tests the same host-service boundary using a deterministic verifier.
Each catalog test names an exact TypeScript target. None of these runtime tests has been executed in this planning change.
Run focused tests through `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-*.test.ts"`.
Run `npm run typecheck`, `npm run build`, and the compiled Node.js CLI acceptance fixtures.
Run `npm run verify` after implementation. Retain journal, execution ledger, terminal policy, and legacy resume regression coverage.
