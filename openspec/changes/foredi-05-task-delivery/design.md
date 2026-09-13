# M5: Deliver useful work from Pel

## Outcome

An operator runs one Pel program and receives a candidate, host verification, independent review, and actionable findings.
Publication proceeds only when existing host authority explicitly covers the requested candidate and destination.

## Existing integration points

| Existing path | Retained behavior |
| --- | --- |
| `packages/orchestration/src/round-transaction.ts` | Attempt-bound implementation, checkpoint capture, gate execution, and report reading seams. |
| `packages/orchestration/src/round-live-services.ts` | Worktree command execution, checkpoint capture, bounded report reads, and environment handling. |
| `packages/orchestration/src/report-freshness.ts` | Reject stale, missing, and wrong-attempt evidence. |
| `packages/orchestration/src/execution-ledger.ts` | Reserve actions, register authority and outcomes, and preserve attempt limits. |
| `packages/orchestration/src/execution-terminal-policy.ts` | Require declared milestones before terminal success. |
| `packages/policy/src/release-authority.ts` | Decode authority, bind source receipts, and check current candidate evidence. |
| `packages/orchestration/src/release-authority-cli.ts` | Reuse typed authority and outcome registration. Do not shell through its CLI. |
| `packages/orchestration/src/release-policy.ts` | Preserve deterministic policy checks and exact release bindings. |
| `components/council/packages/application/src/prompt-preflight.ts` | Reuse trusted-instruction and untrusted-evidence separation. |
| `components/council/packages/application/src/schema-lowering.ts` | Reuse checked schema lowering where transport qualification permits it. |
| `skills/foreman/scripts/audit-run.sh` | Port current audit invalidation and current-attempt evidence semantics into typed services. |
| `skills/foreman/scripts/merge-gate.sh` | Preserve merge-base, branch, candidate, and release-authority checks during typed publication implementation. |
| `skills/foreman/scripts/wt-merge.sh` | Preserve isolated candidate capture and target conflict checks where integration is requested. |

The baseline does not contain a generic typed publication transaction.
Implement that missing host operation while reusing current authority and invariants. Do not claim that the shell merge gate publishes remotely.
The publication destination is a host-admitted descriptor. Pel never supplies arbitrary shell commands or unrestricted URLs.

## Planned files and interfaces

All new executable code uses strict TypeScript on Node.js 24. Effect owns each host operation's fallible resources within the M4 run scope.

| Planned path | Export |
| --- | --- |
| `packages/orchestration/src/pel-host-contract.ts` | `CandidateRefV1`, `VerificationReceiptV1`, `ReviewReceiptV1`, `PublicationReceiptV1`, and strict decoders. |
| `packages/orchestration/src/pel-host-library.ts` | `makeForemanHostRegistry()` attaches handlers to canonical M2 `pel-host-descriptors.ts` records. |
| `packages/orchestration/src/pel-host-task.ts` | `runTask(args: TaskArgsV1, ctx: HostContextV1): Effect.Effect<PelValue, HostEffectFailure, TaskServices>`. |
| `packages/orchestration/src/pel-host-verify.ts` | `verifyCandidate(args: VerifyArgsV1, ctx): Effect.Effect<PelValue, HostEffectFailure, VerifyServices>`. |
| `packages/orchestration/src/pel-host-review.ts` | `reviewCandidate(args: ReviewArgsV1, ctx): Effect.Effect<PelValue, HostEffectFailure, ReviewServices>`. |
| `packages/orchestration/src/pel-host-publish.ts` | `publishCandidate(args: PublishArgsV1, ctx): Effect.Effect<PelValue, HostEffectFailure, PublishServices>`. |
| `packages/orchestration/src/pel-publication-service.ts` | `PublicationService.prepare`, `commit`, and `observe` adapt existing authority, candidate checks, and destination transport. |
| `packages/orchestration/src/pel-delivery-result.ts` | `projectDeliveryResult(events): DeliveryResultV1` and plain-text rendering. |
| `packages/orchestration/src/pel-delivery.test.ts` | Compiled CLI workflow fixtures and the first vertical slice. |
| `examples/pel/implement-verify-review.pel` | Executable native Pel example for Grok, host verification, and Sol. |
| `examples/pel/repair-and-publish.pel` | Bounded repair and separately authorized publication example. |

`HostContextV1` contains M4 effect identity, attempt, bound contract, admitted workspace, registry, artifact root, and resource grants.
Host functions do not reserve independent retry loops. M4 dispatch validates grants and reserves through the existing ledger.
Each handler implements M4's read-only `prepareHostEffect` hook, then accepts an already reserved dispatch token.
Verification reuse and missing publication authority return from preparation with zero action reservations.
Authorized external work reserves exactly once in M4. A handler never calls `executeChild` a second time.
Each settled handler result becomes M1 `HostReceiptV1`. Durable successful completion returns an ordinary `PelValue`.
M4 intercepts recoverable unknown outcomes or pending authority before receipt delivery, leaving that request pending.

## Function and value contracts

All four functions are ordinary registered Pel functions with M1 `ArgSpec`, fixed named arguments, output schemas, and M2 effect declarations.
Only admitted full application can dispatch. Partial application stores values. Unselected branches remain inert.

| Function | Named arguments | Exact result schema ID and ordered unique keys |
| --- | --- | --- |
| `fm/task` | `:id`, `:model`, `:input`, `:output`, optional `:transport #nil` | `schema:task-result-v1`: `status`, `candidate`, `artifacts`, `implementation-receipt`, `findings` |
| `fm/verify` | `:id`, `:input`, `:gate` | `schema:verify-result-v1`: `status`, `passed`, `candidate`, `task`, `verification`, `checks`, `findings` |
| `fm/review` | `:id`, `:model`, `:input`, `:policy`, optional `:transport #nil` | `schema:review-result-v1`: `status`, `approved`, `candidate`, `verification`, `review`, `verdict`, `findings` |
| `fm/publish` | `:id`, `:input`, `:destination` | `schema:publish-result-v1`: `status`, `candidate`, `delivery`, `publication`, `next-action`, `findings` |

Values use the M1 association-list representation with keyword keys, such as `[:passed #t :candidate "artifact:c1"]`.
Native lookup uses `(result :at ':passed)`. Values contain immutable artifact and receipt references, not privileged capability objects.
The TypeScript schema field names are strings. Their Pel values are keyword/pair entries in the exact table order.
Schemas use M1 `PelDataSchemaV1` association fields with `additionalKeys: false`. Every listed field is required.
Reject duplicate or additional keys before a result becomes a HostReceiptV1. Do not append inherited keys at the same level.
`status` and `verdict` are bounded enum strings. `passed` and `approved` are Boolean values.
Task status is `candidate-ready` or `no-change`. Verify status is `verified` or `verification-failed`.
Review status is `approved`, `changes-requested`, `unverified`, or `verification-failed`. Publication status is `published` or `needs-action`.
Reference fields use bounded artifact-ID strings, with nil allowed only for explicitly absent candidate or unfinished receipt fields.
`artifacts`, `checks`, and `findings` are bounded lists of their registered data schemas.
`task` nests the previous task result. `verification` in a review nests the exact verify result, including its receipt.
For direct artifact verification input, `task` is nil. Absent unfinished receipt references are nil, never fabricated IDs.
`delivery` in a publish result nests the previous review result. No nested evidence overwrites outer `status` or `findings`.
For a failed check, `(r :at ':status)` equals `"verification-failed"` and `(r :at ':passed)` equals `#f`.
Returned reference strings cannot authorize operations. The host resolves them against the current run and checks their digests and authority.
`TaskArgsV1.input` accepts a bounded artifact reference or an ordinary Pel value containing admitted artifact references.
`output` selects a registered schema. Unknown schemas and oversized or malformed provider results yield typed errors.
`schema:candidate-v1` is M2's bounded provider-report association: summary, claimedPaths, and findings.
These are untrusted reported data. M5 computes the authoritative candidate manifest from host observations rather than accepting claimed paths as evidence.
`gate` selects a host-owned argv vector and environment binding. It cannot contain a command string supplied by a model.
`policy` selects registered independent-review policy. The host checks actual provider identity before recording an authorizing review.
`destination` resolves a host-owned target descriptor, including repository, remote, ref, operation, and expected destination identity.
There is no `approved` Boolean argument and no model-generated authority receipt.

`model` accepts an exact profile ID or an ordinary host-resolved string `role:implementer` or `role:reviewer`.
M2's full snapshot hashes `roleBindings`, which map each role to exact profile, transport, controls, and credential reference.
The preview and execution binding show the resolved pair. A role name never grants authority or changes source evaluation semantics.
Both use M2 `buildEffectiveAuthoringSnapshotV1(base, projectSelection)`, which applies project selections once and produces the bound effective snapshot.
The base artifact stays unchanged when a project role changes. The derived effective snapshot and binding digests change together.
Handler-backed descriptor/schema/resolver digests must equal that effective snapshot registryDigest, or admission fails exit `2` before dispatch.
An explicit `transport` must match the admitted role pair. For an exact profile literal without transport, require one unique admitted pair.
Ambiguous or unsupported selection returns `PEL_PROFILE_UNSUPPORTED` during checking and invalid-request exit `2` during run admission.
This release requires native coding transports for `fm/task`: `grok-acp`, `claude-code`, `codex-app-server`, or `gemini-cli`.
Their admitted tool policy restricts writable paths, tools, credentials, and process environment using M3's enforceable native capability evidence.
API transports cannot perform `fm/task` file editing in this release. There is no implicit API filesystem tool platform.
`fm/review` accepts an admitted API or native transport only when `toolPolicy` none is enforceable.
The host resolves immutable artifact text before the review request, with no mutation-capable tools.
Use M3 `ProviderControlsV1` from the admitted profile or role defaults. Review fixes `toolChoice` to none.
No unrestricted control object is accepted from Pel. Changed host control defaults change the snapshot and binding digest.
Pass the resolved opaque credentialProfileRef to M3. Its injected CredentialPort resolves the selected profile without embedding secret material in requests or receipts.
M3 outputSchema contains the exact Pel schema ID and content. Its wire codec decodes provider JSON into canonical schema field order before host validation.
Object key order cannot change Pel association semantics. Unknown/duplicate keys and invalid numbers fail before candidate promotion.
Production `admitCell` requires current live-qualified evidence for every requested capability of the exact profile/transport cell.
Recorded tests use M4's injected test-fixture Layer. Such cells remain labeled test-fixture and never become live-qualified.

`CandidateRefV1` contains repository ID, base commit, candidate commit, tree digest, diff digest, allowed-path digest, artifact manifest digest, and producing attempt.
`VerificationReceiptV1` additionally binds gate digest, environment digest, candidate identity, execution attempt, result, and report digest.
`ReviewReceiptV1` binds candidate and verification receipt, observed implementer and reviewer vendors/models/transports, review policy, findings, and report digest.
`PublicationReceiptV1` binds candidate, verification, review, authority receipt, destination, operation identity, and observed external result.
The existing policy receipt schema remains canonical. These host records refer to it and add Pel effect linkage.
Use `canonicalize` and `sha256Hex` from `packages/core`. Do not introduce a second canonicalization scheme.

## Implementation and verification

`fm/task` uses an admitted isolated worktree and the exact M3 provider profile.
Trusted instructions and untrusted task evidence occupy separate fields in `ProviderRequestV1`.
Provider tool requests pass through M4 dispatch policy. They cannot expand writable paths or host authority.
The host captures an immutable candidate manifest after the provider stops. Provider prose cannot certify changed files or completed checks.
For `fm/race`, the M4 child context supplies a distinct admitted worktree grant before task preparation or provider dispatch.
Contender implementation receipts retain provenance without changing the shared ledger candidate.
After the durable winner decision, the host promotes only the selected candidate with its original implementation receipt and reservation.
The host repeats this idempotent promotion check when it restores an existing winner decision.
Nested race decisions defer promotion until the outer selected path is committed. Nested retry records retain their original race ancestry.
Downstream task, verification, review, and publication requests use the candidate's exact admitted workspace grant.
Recovery derives that grant from the same immutable implementation and child records.
Unresolved contenders cannot record checks, audit approval, or publication. Such requests fail before an action reservation.
Task provider allocations divide the original input, output, and cost caps by each enclosing race's durable contender count.
Integer token allocations round down. Cost allocation rounds down to the adjacent representable number after division.
The existing atomic run budget still bounds all reservations and known usage.
For native do/async, inherited workspace conflicts serialize unless the admitted context supplies separate grants.
A no-op implementation has `status = "no-change"` with observed artifacts and no invented completion evidence.
A result outside allowed paths fails with `candidate-out-of-scope`. Preserve the candidate for inspection without promoting it.

`fm/verify` runs the admitted gate in a scope that protects candidate identity.
It returns `:passed #t` only for a matching host pass and `:passed #f` for an observed failed check.
It captures pre-check and post-check tree identities. Any candidate mutation invalidates the receipt.
A check failure returns `status = "verification-failed"` with bounded findings and report references as ordinary Pel data.
Transport, report corruption, and policy failures use typed failures. Do not convert infrastructure failure into a passing check.
Reuse an existing verification receipt only when candidate, gate, environment, policy, and evidence freshness bindings match exactly.
Repeated unchanged verification consumes no new verification action. A changed binding requires a new allowed verification reservation.
Preparation performs that exact-evidence lookup before M4 reserves an action. Reuse records the new request's result referencing the old verification receipt.
This preserves one full verification per unchanged candidate and environment.

## Independent review and bounded repair

`fm/review` gives the reviewer immutable candidate artifacts and host verification evidence.
After reservation-token validation, dispatch records in-progress review state before provider execution.
Preparation cannot invalidate an earlier approval. Recovery retains the original marker sequence.
The prepared review binds its admission time and freshness check.
Completed provider work can finish host receipt registration using that original time after the freshness window expires.
Fresh dispatch and publication still require current evidence. An old completed review cannot grant stale publication authority.
The host cannot reuse an old approved report as the current attempt result.
If incoming verification has `passed = false`, preparation returns an unverified review result with `status = "verification-failed"` and no audit reservation.
Actual observed vendor identity must differ from the implementer's vendor. Changing only model names cannot satisfy independence.
Review verdicts are `approved`, `changes-requested`, or `unverified`. Missing, refused, interrupted, or malformed review is unverified.
The host records reviewer evidence provenance and findings before a review can satisfy a milestone.
A model-generated verification or publication claim remains untrusted review content.

The first example resolves role:implementer to Grok `grok-4.6`, and role:reviewer to Sol `gpt-5.6-sol` through project settings.
It uses host `candidate-full` verification and `independent-review` policy.
Its pipeline is the canonical `fm/task |> fm/verify |> fm/review` program in `examples/pel/implement-verify-review.pel`.
Run it with recorded profiles first. A live run requires the exact model/transport capabilities to be qualified by M3.
A second fixture changes only roleBindings and executes identical source bytes and control flow with a changed snapshot/binding digest.
Missing qualification produces an actionable unsupported-profile result, never a silent fallback.

The repair example uses a self-recursive native lambda with explicit current result, round counter, and finite maximum correction count.
Each invocation passes its corrected result into the next invocation. Approval returns immediately without another task call.
The program's maximum is no greater than the admitted `ExecutionContractV1` correction limit.
`fm/retry` handles eligible transient transport failures only. It does not reinterpret a negative review as a transport failure.
Each changed candidate invalidates its previous verification and review bindings.
A no-op correction preserves findings and terminates with needs-action once the admitted progress rule or correction bound applies.
The explicit counter guard returns ordinary `[:status "needs-action" :candidate ref :delivery current :reason "correction-limit" :round-count n :findings findings]`.
It uses `schema:delivery-needs-action-v1` with unique ordered keys. M4 projects this final value to needs-action exit `3`.
The repair binding selects `resultContract = {schemaId: "schema:delivery-final-v1", classification: "delivery-v1"}` from M2's shared schema records.
M4 validates the done value against that schema. Duplicate/extra-key lookalikes fail `final-result-invalid`, exit `1`.
The correction-limit and no-product-change values still yield exit `3` when audit and publication milestones are absent.
The guard runs before another host effect. It does not rely on converting an unexpected `budget-exhausted` failure into success.
An unexpected host budget failure remains failed exit `1`. A no-change result returns the same shape with reason `no-product-change`.
No task DSL, stage scheduler, or private re-prompt loop is added.

The exact planned standard source is:

```lisp
(fm/task :id "implement" :model "role:implementer"
  :input "artifact:approved-spec" :output "schema:candidate-v1")
|> (fm/verify :id "verify" :input ^ :gate "candidate-full")
|> (fm/review :id "review" :model "role:reviewer"
  :input ^ :policy "independent-review")
```

The exact planned repair source is below. Its fixture config admits one correction and maps call ID `correct` to the existing correction action.
The same recursion accepts any source maximum that the checked policy admits. The sample maximum is one.

```lisp
(def assess (lambda [:candidate]
  (do
    (def checked (fm/verify :id "verify" :input candidate :gate "candidate-full"))
    (if (checked :at ':passed)
      (fm/review :id "review" :model "role:reviewer"
        :input checked :policy "independent-review")
      checked))))
(def repair (lambda [:current :round :maximum]
  (if (eq (current :at ':status) "approved")
    current
    (if (lt round maximum)
      (do
        (def corrected (fm/task :id "correct" :model "role:implementer"
          :input current :output "schema:candidate-v1"))
        (if (eq (corrected :at ':status) "no-change")
          [:status "needs-action" :candidate (current :at ':candidate)
           :delivery current :reason "no-product-change" :round-count (+ round 1)
           :findings (current :at ':findings)]
          (repair (assess corrected) (+ round 1) maximum)))
      [:status "needs-action" :candidate (current :at ':candidate)
       :delivery current :reason "correction-limit" :round-count round
       :findings (current :at ':findings)]))))
(def initial (fm/task :id "implement" :model "role:implementer"
  :input "artifact:approved-spec" :output "schema:candidate-v1"))
(def delivery (repair (assess initial) 0 1))
(if (eq (delivery :at ':status) "approved")
  (fm/publish :id "publish" :input delivery :destination "reviewed-branch")
  delivery)
```

Both files use the M1 normalized ASCII pipe `|>`. M2 checks these exact bytes and schemas before M5 execution tests.
For approval after one correction, task dispatch count is two. For exhaustion with maximum N, it is N+1 including initial implementation.
The exhausted and no-change variants return exit `3`, with no later task, verification, review, or publication effect.
M6 packages these canonical filenames. `sequential.pel`, `implement-review.pel`, and `bounded-rework.pel` are not duplicate delivery examples.

## Authorized publication

`PublicationService.prepare` checks the exact candidate, all required receipts, current authority, destination identity, and resource ownership.
A missing publication grant yields a recoverable needs-action observation and an authorization request referencing exact prepared evidence.
It performs zero integration, push, release mutation, or action reservation. M4 does not complete the pending evaluator request with that preview.
After a matching existing-authority receipt is available, resume re-prepares the same pending publish effect and dispatches it once.
Completed task, verification, and review receipts replay without new calls or reservations. Successful publication then supplies the ordinary Pel result.
A malformed, wrong-candidate, or forged authority receipt yields `publication-authority-invalid`.

`commit` repeats authority and candidate checks under the destination resource lock.
M4 reserves the existing `publish` action once through `EndstopLedger.executeChild` after successful preparation and before its effect.
The publication service validates that reservation token and never reserves again.
Local integration and external publication are separate operations with separate receipts and permissions.
`fm/publish` performs only the selected external publication operation. This initial library does not expose a separate integration host function.
Contracts requiring integration must supply an existing registered integration receipt before publication. Do not silently merge as part of fm/publish.
Implement the first destination as an admitted Git ref update with an expected old object ID and an immutable candidate commit.
Use exact argv through the existing launcher. Do not use a shell command string or force publication onto an unexpected ref.
Preserve target index and merge-base protections for any host-admitted integration operation.
Unimplemented destination kinds return `publication-destination-unsupported` before external mutation.

`observe` checks the exact admitted remote ref or destination operation identity after interruption.
Confirmed publication produces a durable receipt. A lost acknowledgement yields `unknown-external-outcome` and M4 reconciliation.
The runtime does not repeat an uncertain publication automatically. Local process exit alone cannot establish publication success.
An unknown acknowledgement remains a pending host request. A confirmed observation supplies its result and continues evaluation without republishing.
Publish authorization cannot originate in Pel text, natural-language predicates, provider tool output, or an audit verdict alone.
This planning change does not register publication authority or publish anything.

## Operator results and errors

`DeliveryResultV1` extends M4 `RunResultV1` with candidate, checks, review, publication, findings, and `nextAction` fields.
The text view links artifact paths and names the source-located failing host call.
The standard command is `foreman run FILE`. It resolves existing project configuration and authority without mandatory manual JSON preparation.
The JSON view preserves typed error codes and exact identities. Both views derive from the same journal projection.
Use M4 lifecycle exit codes, including `3` for needs-action and `5` for pending work.
A completed implementation with required review missing is not run success.
A delivered candidate may be successful when the admitted contract requires no publication milestone.

Specific host error codes are `task-output-invalid`, `artifact-missing`, `candidate-out-of-scope`, `candidate-changed`, `verification-unavailable`, `review-not-independent`, `review-invalid`, `publication-authority-invalid`, and `publication-destination-unsupported`.
`HostEffectFailure` carries these registered operation-specific codes plus the M4 common codes.
Do not retry authentication, identity, evidence, or authorization failures automatically.
Show the safe next operation and the required artifact reference. Do not expose credential values or opaque provider state.

## Planned validation

Use deterministic recorded Grok and Sol events, temporary Git repositories, fake gate commands, and a local bare remote.
Test the compiled product through `node skills/foreman/runtime/dist/foreman.js` after `npm run build`.
Recorded runtime acceptance uses M4's compiled `packages/orchestration/dist-test/pel-cli-fixture.js`, sharing the product router and copied assets.
Production bundle tests reject fixture bindings with exit `2`. Recorded evidence remains test-fixture in provider listing and delivery results.
A temporary fixture authority permits publication only to that fixture remote.
Test publication denial, candidate mutation, stale review, forged receipts, same-vendor review, no-op repair, and lost acknowledgement.
Test process crashes during host verification and after each effect receipt. Assert completed provider work is not dispatched again.
Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-host-*.test.ts" "packages/orchestration/src/pel-delivery*.test.ts"`.
Run `npm run typecheck` and `npm run verify` after implementation. Runtime tests described here have not been executed during planning.
