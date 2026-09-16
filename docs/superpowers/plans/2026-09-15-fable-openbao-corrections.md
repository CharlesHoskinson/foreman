# Fable OpenBao audit correction plan

> Use superpowers:subagent-driven-development with test-driven implementation and independent review.

## Goal

Resolve all ten findings in fable-audit-2026-09-15.md against one testable candidate.
The user authorized this correction agenda with “Fix everything”.
The previous audit remains historical evidence, not approval of the corrected candidate.

## Architecture and constraints

OpenBao remains the sole durable credential authority for managed accounts.
Keep closed failures, verified HTTPS, bounded Effect lifetimes, CAS writes, and explicit references.
Separate synthetic entry points from the default production package entry.
Build pilot code from current TypeScript sources instead of admitting an arbitrary providers dist.
Record actual build inputs separately from runtime identity and external binary integrity evidence.
Specify safe deletion recovery without automatic metadata destruction or refresh-token replay.

Use Node.js 24, strict TypeScript, Effect, and apply_patch. Do not add dependencies.
Use the existing linked worktree. Preserve concurrent native-login files and generated product runtime changes.
Do not commit, install, migrate live accounts, change vendor credentials, publish, or replace execution authority.
Use only disposable synthetic OpenBao fixtures for mutations and recovery experiments.
Do not claim deferred manager, native adapter, CLI, or full P01–P11 implementation through documentation changes.

## Ownership

One correction implementer owns the complete executable correction, not one implementer per finding.

Allowed existing files:

- packages/providers/src/credential-store.ts and openbao-credential-store.ts with its test.
- packages/providers/src/index.ts and packages/providers/package.json, only scoped exports/build changes.
- packages/orchestration/src/openbao-pilot.ts and its test.
- scripts/openbao-pilot.ts, its test, worker, build script, and scripts/openbao-pilot/ helpers.
- docs/guides/pel/openbao-credentials.md and the OpenBao sections of README.md and ForeDi release notes.
- docs/releases/return-of-the-foredi/footgun-review-2026-09-15.md.
- Existing OpenBao pilot and foredi-08/09 OpenSpecs and OpenBao authority plan.

Allowed new files:

- Focused TypeScript helpers/tests under scripts/openbao-pilot/.
- packages/providers/src/credential-backend-identity.ts and its test.
- packages/providers/src/testing.ts for the explicit synthetic entry.
- A correction evidence record under docs/releases/return-of-the-foredi/.

No edits to native transports, native qualification, permissions, or their tests.
No edits to the original Fable audit receipt or report. Preserve dissent and history.

## Task 1: Complete correction package

### Error contract and mutation controls: findings 1 and 8

- [ ] Reproduce the existing failing broker test against a fresh build before changing behavior.
- [ ] Define malformed printable-header string input as InvalidInput, before any network request.
- [ ] Preserve Unavailable for unknown callback failures, defects, and non-Redacted or non-string callback results.
- [ ] Keep declared typed failure codes and caller interruption unchanged.
- [ ] Rename the misleading synchronous-HTTP test to its actual token-validation behavior.
- [ ] Add synchronized tests that pause bootstrap token acquisition, mutate write material and version arrays, then inspect actual HTTP bytes.
- [ ] Require the authorized snapshot, not the later mutation, to reach the server.

### Source binding and synthetic entry: findings 2 and 10

- [ ] Remove the synthetic factory from the default providers index export.
- [ ] Expose it through an explicit testing entry, with package/build metadata if needed.
- [ ] Update the pilot's runtime imports to current source or an enforced fresh build path.
- [ ] Build compiled pilot workspace dependencies from resolved source inputs, not stale workspace dist artifacts.
- [ ] Add a disposable stale-dist negative control that fails if audited source and executed store behavior diverge.
- [ ] Check the default built package has no synthetic factory export and the testing entry does.
- [ ] Keep production HTTP rejection tests and synthetic loopback/material restrictions.

### Provenance: findings 3 and 4

- [ ] Stop presenting a Boolean read from provenance.json as verification performed by the controller.
- [ ] Bind the externally verified integrity receipt by digest to the exact binary, release URL, asset URL, archive digest, and signer identities.
- [ ] Require an explicit expected receipt digest as trusted pilot input, alongside the expected binary digest.
- [ ] Fail closed before launch when either expected digest or required receipt identity disagrees.
- [ ] Label the scope as externally verified receipt binding. Do not claim runtime GPG verification unless actually performed.
- [ ] Preserve the existing verified binary receipt unchanged. Use full otherwise-valid synthetic receipts in negative tests.
- [ ] Record build-time Node version/hash separately from execution-time Node version/hash.
- [ ] Record dirty state and exact source/bundle hashes instead of presenting HEAD alone as the candidate identity.
- [ ] Add negative controls for changed receipt bytes, changed binary bytes, and stale or unrelated caller source.

The verified binary is /root/research/openbao-pilot-20260915-MYD9Qc/bao.
Its expected SHA-256 is 8d18052337908a74f0d7dfacc8da7a1bff5f8a4ab6a2ad136fbf5ffeae243b00.
Its adjacent provenance.json records prior official digest and GPG verification.
Compute and explicitly supply that receipt's digest. Never derive both expected and actual trust values inside the verification being tested.

### Real-server semantics and bounds: findings 5 and 7

- [ ] Add a disposable real-server deletion experiment: create, remove current version, read NotFound, list retained name, and CAS0 re-import Conflict.
- [ ] Verify a new authorized CAS update using the recorded generation can recover with newly supplied synthetic material, without replaying old material.
- [ ] Keep create-only import unchanged. Document tombstoned account recovery as a distinct, explicitly authorized maintenance operation.
- [ ] Do not add automatic metadata deletion, undelete, or production recovery implementation.
- [ ] Extend P05 with an actually unavailable endpoint observation.
- [ ] Add a hanging-peer test with a short explicit deadline and confirmed socket closure.
- [ ] Separate fast sealed-response evidence from deadline enforcement. Remove misleading labels.
- [ ] Keep deferred P04/P07/P08/P09/P11 explicitly not-run and pilotComplete false.

### Host identity and documentation: findings 6 and 9

- [ ] Add a pure validated production backend identity constructor over canonical HTTPS endpoint, mount, namespace, and trust configuration identity.
- [ ] Exclude credential tokens and raw CA PEM from returned metadata. Represent trust configuration with a digest.
- [ ] Test endpoint/mount/namespace/trust changes produce different identities and reject malformed or synthetic origins.
- [ ] Specify manager and readiness composition that binds this identity to provider/account/version before delivery.
- [ ] Add an explicit fail-closed requirement and proposed test for an unrecognized bao reference during interim resolver integration.
- [ ] Update the manager plan to consume the identity contract without claiming the manager is implemented.
- [ ] Supersede stale green-count claims. Link current measurements to source/bundle hashes and exact commands.
- [ ] Document the testing-only entry and the stronger provenance inputs.
- [ ] Map every audit finding to its correction, test, or verified semantics record.

## Task 2: Verification and review

- [ ] Run focused RED/GREEN cycles before and after each behavior correction.
- [ ] Run the default controller suite with an explicit capability skip only for absent integration inputs.
- [ ] Run configured real-server tests with zero skips.
- [ ] Build providers before any built-entry assertions.
- [ ] Run the combined store, broker, and controller suites from a fresh build.
- [ ] Run npm run typecheck. If concurrent files fail, retain the exact failure and verify owned files separately without editing the other session's work.
- [ ] Run strict OpenSpec validation for changed packages and whitespace checks including untracked files.
- [ ] Build and execute the compiled pilot from an unrelated cwd. Validate actual bundle/runtime hashes, private report mode, cleanup, and explicit incomplete state.
- [ ] Parent independently reruns verification and examines the actual changes.
- [ ] Review the entire corrected package against all ten findings. Resolve substantive findings without discarding dissent.

Report to .superpowers/sdd/fable-corrections-report.md with exact commands, RED/GREEN evidence, artifact paths, hashes, and unresolved observations.
Do not mark all findings resolved until every row has checked evidence.
