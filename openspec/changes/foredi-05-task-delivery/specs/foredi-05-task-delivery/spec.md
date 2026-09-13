# Deliver verified and reviewed candidates from Pel

Status: proposed requirements. All scenarios are planned tests.

## ADDED Requirements

### Requirement: R-M5-001 Capture a real candidate

When an admitted fm/task call completes, the Foreman runtime SHALL return schema-validated Pel data with host-captured candidate and artifact references.

#### Scenario: T-M5-001 Capture a real candidate

- **WHEN** A recorded test-fixture Grok native transport writes one allowed TypeScript file in a distinct admitted worktree and supplies candidate-v1 structured output. Execute fm/task through runProgram and pass its result into a native Pel lookup.
- **THEN** The request resolves grok-4.6 plus grok-acp, exact admitted controls, credential reference, and path/tool policy. The host result has the ordered unique task schema keys and real manifest hashes. Native lookup returns the correct status. An API-only task pair fails admission before file work. The handler registry imports M2 pel-host-descriptors.ts; any altered ArgSpec/schema/resolver digest causes binding-mismatch exit 2. Provider candidate-v1 contains only untrusted summary, claimedPaths and findings; host capture supplies authoritative candidate identity. Reversed provider JSON key order decodes through the M3 schema codec into the same canonical Pel association. Unknown/duplicate fields fail. The exact opaque credentialProfileRef reaches the injected CredentialPort without secret bytes in receipts.

### Requirement: R-M5-002 Reject invalid task output

If task output violates its schema or admitted paths, then the Foreman runtime SHALL reject candidate promotion and retain bounded diagnostic evidence.

#### Scenario: T-M5-002 Reject invalid task output

- **WHEN** Three providers return malformed structured output, claim nonexistent artifacts, or modify a path outside the admitted set. Execute fm/task for each fixture and inspect recorded results and artifact reads.
- **THEN** task-output-invalid, artifact-missing, or candidate-out-of-scope identifies the source call. No verification or release milestone is registered.

### Requirement: R-M5-003 Verify a candidate in the host

When fm/verify receives a candidate, the Foreman runtime SHALL execute the registered host check and bind its receipt to the exact candidate and environment.

#### Scenario: T-M5-003 Verify a candidate in the host

- **WHEN** An immutable candidate C has a registered argv gate and environment digest E. Provider text falsely claims all checks pass. Invoke fm/verify with gate outcomes pass and fail, then decode both receipts.
- **THEN** The host gate determines pass and fail, never provider prose. Each receipt binds exact candidate/environment/gate/attempt/report. Failed result lookup :status is verification-failed and :passed is #f. Passing :passed is #t. The association schema rejects duplicate/additional keys. Nested prior evidence cannot shadow status or findings.

### Requirement: R-M5-004 Reuse exact verification evidence

When matching verification evidence already exists, the Foreman runtime SHALL reuse it only while candidate, gate, environment, policy, and freshness bindings remain unchanged.

#### Scenario: T-M5-004 Reuse exact verification evidence

- **WHEN** Candidate C has one valid verification receipt. Table variants change C, environment, gate, policy, or freshness. Call fm/verify twice unchanged, then call each changed fixture with an admitted verification allowance.
- **THEN** Unchanged call reuses one receipt with one gate execution and zero additional verification reservations. Each changed binding requires one fresh verify reservation and cannot reuse the old pass. Candidate-result receipt replay itself never adds another reservation.

### Requirement: R-M5-005 Detect verification mutation and interruption

If the candidate changes during verification, then the Foreman runtime SHALL invalidate the check result before recording a passing verification receipt.

#### Scenario: T-M5-005 Detect verification mutation and interruption

- **WHEN** A gate mutates a candidate file during its run. A second fixture crashes after check execution but before receipt persistence. Invoke fm/verify, then resume the interrupted run with M4 recovery.
- **THEN** Mutation returns candidate-changed. Interrupted verification yields recovered host evidence or needs-action, never an inferred pass or duplicated completed provider implementation.

### Requirement: R-M5-006 Enforce independent vendor review

When fm/review records an authorizing review, the Foreman runtime SHALL bind the current candidate to an observed reviewer vendor distinct from its implementer.

#### Scenario: T-M5-006 Enforce independent vendor review

- **WHEN** Candidate C records xAI implementation. Sol reports observed OpenAI identity. A counterfixture requests another xAI model for review. Invoke fm/review using independent-review policy for both fixtures.
- **THEN** Sol review binds the exact candidate and verification result to observed OpenAI identity and enforced toolPolicy none. Same-vendor review returns review-not-independent with no audit milestone. Result fields are unique and approved is Boolean. Failed incoming verification returns unverified without reserving an audit.

### Requirement: R-M5-007 Invalidate stale approval

If current review evidence is missing, stale, refused, interrupted, or malformed, then the Foreman runtime SHALL report an unverified review.

#### Scenario: T-M5-007 Invalidate stale approval

- **WHEN** An old approved report exists before a new review attempt. New variants refuse, stop, return malformed output, or reference another candidate. Start fm/review, inspect in-progress state, then complete or interrupt each variant.
- **THEN** The old approval cannot authorize the new attempt. Each variant yields unverified with current attempt evidence and no publication eligibility.

### Requirement: R-M5-008 Run the first vertical slice

When the first delivery program runs, the Foreman runtime SHALL compose Grok implementation, host verification, and Sol review through native Pel values.

#### Scenario: T-M5-008 Run the first vertical slice

- **WHEN** examples/pel/implement-verify-review.pel uses role:implementer and role:reviewer. packages/orchestration/src/fixtures/pel-adoption/project-settings.json configures Grok grok-4.6/grok-acp and Sol gpt-5.6-sol/openai-responses in an injected test-fixture Layer. The packaged examples/pel/project-settings.json remains an operator placeholder template. The fixture manifest explicitly binds its checkout or copied-install asset root. Configure the temporary project once, then run node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest fixture-manifest.json run examples/pel/implement-verify-review.pel --json without binding overrides. Repeat after changing only roleBindings to another admitted independent pair.
- **THEN** Both runs execute identical source/control flow with changed snapshot/binding digest. Each produces a real candidate, one host verification, independent review, and matching receipt chain. Resolved exact transport/control identities appear in preview/results. Evidence stays test-fixture, never live-qualified. Successful delivery exits 0. Project selection is applied once to the immutable base snapshot by buildEffectiveAuthoringSnapshotV1; preview/run role and predicate identities match the newly derived effective snapshot.

### Requirement: R-M5-009 Bound review repair

When review requests a correction, the Foreman runtime SHALL execute native Pel repair within the admitted correction and progress limits.

#### Scenario: T-M5-009 Bound review repair

- **WHEN** The exact recursive examples/pel/repair-and-publish.pel source receives correction limit N, one current result, and an explicit round counter. Variants approve after one correction, exhaust N corrections, or make no product change. Check the exact source with M2. Execute with the fixture CLI and count task, verify, review, publication, and ledger actions.
- **THEN** Approval after one correction executes exactly two tasks and no further correction. Exhaustion executes N+1 tasks including initial implementation. No-change stops immediately after its correction. Both counterfixtures return unique-key delivery-needs-action data and exit 3 before further dispatch. Changed candidates receive fresh evidence. No for loop or private retry loop carries repair state. The binding declares schema:delivery-final-v1. Counterfixtures still exit 3 with no audit/publication milestones. Duplicate/extra-key needs-action lookalikes fail final-result-invalid exit 1 rather than being trusted by string shape.

### Requirement: R-M5-010 Resume the delivery receipt chain

When delivery resumes after interruption, the Foreman runtime SHALL reuse recorded task results and continue from the first unresolved host effect.

#### Scenario: T-M5-010 Resume the delivery receipt chain

- **WHEN** The Grok effect has a durable receipt and the process stops before verification or during review. Run compiled resume RUN against each fixture journal.
- **THEN** Grok dispatch remains one. Completed verification is reused without another reservation. Only unresolved review/effects reconcile or continue. Saved evaluator counters and budgets remain spent. Editing the original source file cannot alter the immutable resumed workflow.

### Requirement: R-M5-011 Prepare unauthorized publication

If publication lacks matching explicit host authority, then the Foreman runtime SHALL return needs-action without changing the publication destination.

#### Scenario: T-M5-011 Prepare unauthorized publication

- **WHEN** Candidate C has passing checks and independent review. Binding lacks publish permission. A malicious result contains an approved flag and fabricated receipt. Invoke fm/publish against a temporary bare remote and inspect its refs. Then register matching existing publication authority for the same admitted envelope and resume the pending request.
- **THEN** Status is needs-action, exit 3, with prepared exact evidence and required authority reference. Remote refs and integration state remain unchanged. Ledger spies show zero publish/integrate reservations. Fabricated approval/receipt data cannot grant authority. Initial needs-action is a pending observation, not an M1 result receipt. After matching authority appears, re-preparation adds exactly one publish reservation and publication call, with zero task, verification or review redispatch.

### Requirement: R-M5-012 Publish an explicitly authorized fixture

When publication has matching authority and evidence, the Foreman runtime SHALL revalidate the exact candidate and destination before executing the admitted publication action.

#### Scenario: T-M5-012 Publish an explicitly authorized fixture

- **WHEN** A fixture grant authorizes candidate C to update one bare-remote ref from expected OID B. Variants mutate C, target ref, or evidence before commit. Invoke fm/publish with the prepared binding under the destination resource lock.
- **THEN** Valid publication adds exactly one publish reservation, updates only the admitted ref, and records the observed receipt. Changed candidate, target, or evidence fails before mutation. Handlers do not reserve a second action or implicitly integrate. Unsupported destination returns its typed failure.

### Requirement: R-M5-013 Recover lost publication acknowledgement

If publication acknowledgement is lost, then the Foreman runtime SHALL record an unknown external outcome and reconcile before any repeat publication.

#### Scenario: T-M5-013 Recover lost publication acknowledgement

- **WHEN** A local bare remote accepts C, then the provider boundary loses acknowledgement before the durable receipt. Observation is available or unavailable by fixture. Resume the run with PublicationService.observe and inspect publication command counts.
- **THEN** Available observation records confirmed C without republishing. Unavailable observation remains needs-action and unknown. Both execute the publication command once. Unknown publication keeps its evaluator request pending. Completed observation supplies one success receipt and continues to the published final value; it does not attempt to resume an already failed or consumed request.

### Requirement: R-M5-014 Render delivery outcomes

When delivery ends, the Foreman runtime SHALL expose candidate artifacts, check results, review findings, publication state, and a concrete next action.

#### Scenario: T-M5-014 Render delivery outcomes

- **WHEN** Fixture journals contain delivered candidate, verification failure, changes-requested review, unauthorized publication, and unknown publication. Render compiled status in text and JSON and resolve emitted artifact references.
- **THEN** Both views agree on exact identities and lifecycle code. Artifact links resolve, nested evidence preserves unique result fields, and findings/next-action refer to the current stage. Pending required review/publication prevents success. Unknown external outcome stays unknown and secrets never appear.

### Requirement: R-M5-015 Explain an unavailable vertical slice

If a requested provider profile is unqualified, then the Foreman runtime SHALL report its unavailable capability without substituting another model.

#### Scenario: T-M5-015 Explain an unavailable vertical slice

- **WHEN** Production admission sees documented-only and fixture-only evidence for required grok-4.6/grok-acp capabilities. Another fixture allows two transports without a selector. The explicit test Layer supplies fixture evidence separately. Run the compiled production command with each invalid admission fixture, and the fixture CLI with its explicitly injected binding.
- **THEN** Production exits exactly 2 and names the missing live capability evidence or ambiguous transport, with zero fallback or dispatch. Test injection succeeds only in the test CLI and remains labeled test-fixture. Changed source role mappings resolve exact profiles rather than substituting literal model IDs.

### Requirement: R-M5-016 Resolve admitted role and resource bindings

When a task or review uses a role selector, the Foreman runtime SHALL resolve one exact admitted profile and transport from its bound snapshot.

#### Scenario: T-M5-016 Resolve admitted role and resource bindings

- **WHEN** One source program uses role:implementer and role:reviewer. Two snapshots provide different exact role pairs. An ambiguous exact-profile fixture supplies no transport selector. Check both role-bound programs and inspect prepared ProviderRequestV1 plus resolveResources output.
- **THEN** Role changes preserve source bytes but change binding digests and exact preview pairs. Task native transports receive their child-context worktree grants. Ambiguous literal selection fails exit 2 before dispatch. Review uses toolPolicy none and its admitted controls. Both checker and runtime use the same effective snapshot, including predicate selection and narrowed limits. A supplied stale context or handler registry mismatch exits 2 before dispatch.
