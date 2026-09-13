# M5 implementation tasks

Status: planned. No implementation checkbox or runtime test is complete.
Use strict TypeScript on Node.js 24. Execute host functions inside the M4 Effect scope.

## 1. F-M5-01: Implement bounded candidate work

- [ ] 1.1 Add `pel-host-contract.ts` candidate, artifact, receipt, and argument decoders.
- [ ] 1.2 Add handler attachments in `pel-host-library.ts` using canonical M2 `pel-host-descriptors.ts` records.
- [ ] 1.3 Implement `pel-host-task.ts` using exact M3 profiles and admitted workspace resources.
- [ ] 1.4 Capture immutable candidate manifests from observed files with existing canonical hash functions.
- [ ] 1.5 Return ordinary Pel association-list values with immutable artifact references.
- [ ] 1.6 Implement T-M5-001 and T-M5-002 in `pel-host-task.test.ts`.
- [ ] 1.7 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-host-task.test.ts"`.
- [ ] 1.8 Register exact ordered unique-key result schemas with nested prior evidence and reject duplicate keys.
- [ ] 1.9 Resolve role selectors and optional transport arguments to one exact admitted M3 pair with bound controls.
- [ ] 1.10 Require native coding transports and admitted child-context worktree grants for task implementation.
- [ ] 1.11 Implement T-M5-016 for changed role bindings, exact request controls, and ambiguity rejection.

Assert real candidate output, exact observed hashes, schema rejection, missing artifacts, and allowed-path enforcement.

## 2. F-M5-02: Verify an exact candidate

- [ ] 2.1 Implement `pel-host-verify.ts` against registered host argv gates and scoped environment bindings.
- [ ] 2.2 Capture pre-check and post-check candidate identities and reject mutation.
- [ ] 2.3 Reuse report freshness checks and register existing checks evidence through the execution ledger.
- [ ] 2.4 Reuse verification only for identical candidate, gate, environment, policy, and freshness bindings.
- [ ] 2.5 Implement T-M5-003 through T-M5-005 in `pel-host-verify.test.ts`.
- [ ] 2.6 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-host-verify.test.ts" "packages/orchestration/src/report-freshness.test.ts"`.
- [ ] 2.7 Perform exact evidence reuse during M4 preparation, before any verification reservation.
- [ ] 2.8 Assert Boolean `passed`, current `status`, and nested evidence through native keyword lookup.

Assert host-controlled pass and fail, one unchanged verification, changed-binding reruns, candidate mutation rejection, and honest crash recovery.

## 3. F-M5-03: Obtain independent vendor review

- [ ] 3.1 Implement `pel-host-review.ts` using immutable artifacts and observed M3 identity.
- [ ] 3.2 Port current-attempt audit invalidation from `audit-run.sh` into the typed host operation.
- [ ] 3.3 Reuse review trust separation and existing release evidence validation.
- [ ] 3.4 Reject same-vendor review and noncurrent candidate or verification bindings.
- [ ] 3.5 Implement T-M5-006 and T-M5-007 in `pel-host-review.test.ts`.
- [ ] 3.6 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-host-review.test.ts" "packages/policy/src/release-authority.test.ts"`.

Assert independent observed identity, current-attempt evidence, stale approval invalidation, and unverified interruption or malformed results.

## 4. F-M5-04: Deliver and repair a native Pel workflow

- [ ] 4.1 Add `examples/pel/implement-verify-review.pel` using Grok, host verification, and Sol.
- [ ] 4.2 Add the design's exact `examples/pel/repair-and-publish.pel` self-recursion with current result and explicit correction counter.
- [ ] 4.3 Bind correction actions to existing implementation, correction, progress, and verification limits.
- [ ] 4.4 Add recorded provider and gate fixtures with one corrected candidate and one no-op repair.
- [ ] 4.5 Implement T-M5-008 through T-M5-010 in `pel-delivery.test.ts`.
- [ ] 4.6 Run `npm run build` and execute both examples through the compiled CLI fixture harness.
- [ ] 4.7 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-delivery.test.ts"`.
- [ ] 4.8 Use role selectors and ASCII `|>` in the canonical standard example shared with M2 and M6.
- [ ] 4.9 Check both exact example sources with M2 schemas before executing them through M4's fixture CLI.
- [ ] 4.10 Assert N+1 task calls at exhaustion, immediate approval stop, and ordinary needs-action exit `3` for correction/no-change bounds.
- [ ] 4.11 Bind schema:delivery-final-v1 and reject malformed final-result lookalikes before state classification.
- [ ] 4.12 Use concrete `packages/orchestration/src/fixtures/pel-adoption/project-settings.json` in recorded runs, not the packaged placeholder template.

Assert one authored Pel workflow, two provider assignments, complete evidence chains, bounded correction, and no repeated completed implementation after restart.

## 5. F-M5-05: Publish with existing explicit authority

- [ ] 5.1 Implement `pel-publication-service.ts` prepare, commit, and observe operations for an admitted Git ref destination.
- [ ] 5.2 Reuse existing release authority decoders, receipt binding, and execution action reservation.
- [ ] 5.3 Port required candidate, merge-base, and target conflict checks from current merge scripts into typed service functions.
- [ ] 5.4 Require any existing integration receipt separately and keep fm/publish limited to its selected external operation.
- [ ] 5.5 Implement `pel-host-publish.ts` with needs-action output for absent explicit authority.
- [ ] 5.6 Revalidate candidate and destination under the resource lock immediately before publication.
- [ ] 5.7 Reconcile lost acknowledgements through exact destination observations without automatic republishing.
- [ ] 5.8 Implement T-M5-011 through T-M5-013 using temporary local repositories and a bare remote.
- [ ] 5.9 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-host-publish.test.ts" "packages/orchestration/src/release-authority-cli.test.ts" "packages/policy/src/release-authority.test.ts"`.
- [ ] 5.10 Return missing publication authority during preparation with zero integrate/publish reservations.
- [ ] 5.11 Accept M4's single publication reservation token without reserving again inside the service.
- [ ] 5.12 Leave missing grants and unknown acknowledgements as pending observations until resume supplies a settled result.
- [ ] 5.13 Test a later matching authority grant with one publication and zero prior task, verification, or review redispatch.

Assert denied publication makes no mutation, authorized publication changes only the admitted ref, stale evidence fails, and lost acknowledgement stays truthful.
These tests use fixture authority only. They do not authorize publication to a real repository or release destination.

## 6. F-M5-06: Return actionable delivery results

- [ ] 6.1 Add `pel-delivery-result.ts` journal projection and text rendering for artifacts, checks, findings, and next action.
- [ ] 6.2 Extend M4 result rendering while retaining its lifecycle exit codes and unknown outcome fields.
- [ ] 6.3 Implement T-M5-014 and T-M5-015 in `pel-delivery-result.test.ts` and `pel-delivery.test.ts`.
- [ ] 6.4 Run `npx tsx scripts/run-tests.ts "packages/orchestration/src/pel-delivery-result.test.ts" "packages/orchestration/src/pel-delivery.test.ts"`.
- [ ] 6.5 Run `npm run typecheck`, `npm run build`, and compiled Node.js 24 CLI acceptance fixtures.
- [ ] 6.6 Run `npm run verify` with existing authority, ledger, freshness, and terminal policy tests.
- [ ] 6.7 Run recorded workflows through `node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest fixture-manifest.json run examples/pel/implement-verify-review.pel --json`.
- [ ] 6.8 Verify documented-only and fixture-only product admission fail with exact exit `2` and no model fallback.
- [ ] 6.9 Keep fixture evidence labeled test-fixture and assert fixture entry points are absent from production installation assets.
- [ ] 6.10 Run `npm run test:pel-fixture-build` before focused delivery acceptance tests and rely on pretest for clean npm verification.

Assert artifact references resolve, views agree, unavailable profiles do not fall back, and pending required milestones cannot produce success.
Record actual verification evidence during implementation. M6 owns legacy caller migration and deletion after these replacement fixtures pass.
