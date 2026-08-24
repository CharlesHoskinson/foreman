# v0.4 Digest Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove private-key signing from v0.4 and use canonical evidence digests plus Endstop registration.

**Architecture:** The policy decodes closed canonical JSON and hashes complete file bytes. Endstop registration binds the accepted bundle digest to the root, family, child, action, package, and candidate. Git and historical-file checks remain separate read-only boundaries.

**Tech Stack:** Node.js 24, TypeScript, `@foreman/core`, Effect at I/O boundaries, Node test runner.

## Global Constraints

- Do not read, store, generate, or accept private keys.
- Do not expose signature or signer fields in v0.4 authority types.
- Preserve canonical JSON, one-LF framing, SHA-256 binding, and byte bounds.
- Preserve closed failure results and sanitized CLI output.
- Do not rewrite Git history.

---

### Task 1: Remove the unfinished signing scaffold

**Files:**
- Delete: `packages/policy/src/release-admission.test.ts`
- Create: `packages/policy/src/release-admission.test.ts`

**Interfaces:**
- Consumes: `ReleaseCandidateIdentityV1`, canonical evidence bytes, and registered digest authority.
- Produces: failing tests for `evaluateReleaseEvidenceV1` and `evaluateReleaseAdmissionV1`.

- [ ] **Step 1: Delete the placeholder recipe inventory**

Remove `RECIPE_IDS`, `SIGNATURES`, SPKI values, unsigned fixture graphs, signing recipes, and signing sentinels.

- [ ] **Step 2: Add one digest-only RED test**

```ts
test("admits the exact registered canonical evidence digest", () => {
  const checked = evaluateReleaseAdmissionV1({
    ...validEvidenceInput,
    registered: matchingRegistration,
  });
  assert.deepEqual(checked, { schemaVersion: 1, _tag: "Admitted" });
});
```

- [ ] **Step 3: Run the focused test**

Run: `npm exec -- tsx --test packages/policy/src/release-admission.test.ts`

Expected: fail because the admission exports do not exist.

- [ ] **Step 4: Commit the RED test**

Commit only the replacement test file.

### Task 2: Convert release authority to digest-only evidence

**Files:**
- Modify: `packages/policy/src/release-authority.ts`
- Modify: `packages/policy/src/release-authority.test.ts`
- Modify: `packages/policy/src/index.ts`

**Interfaces:**
- Keeps: `decodeReleaseAuthorityFileV1`, `decodeReleaseProducerSourceFileV1`, manifest APIs, and source binding.
- Removes: `releaseAuthoritySignaturePreimageV1`, signer fingerprints, SPKI constants, signatures, and cryptographic role verification.

- [ ] **Step 1: Replace signed fixtures with canonical digest fixtures**

Each authority fixture omits `issuerKeySha256` and `signature`. Retain every structural, bound, canonical framing, source-binding, and manifest test.

- [ ] **Step 2: Add refusal tests for legacy signing fields**

```ts
test("rejects legacy signature fields", () => {
  const result = parseReleaseAuthorityObjectV1({
    ...validDesignApproval,
    signature: "legacy",
  });
  assert.deepEqual(result, { _tag: "Invalid" });
});
```

- [ ] **Step 3: Run the focused authority test and observe RED**

Run: `npm exec -- tsx --test packages/policy/src/release-authority.test.ts`

Expected: fail because production still requires signature fields.

- [ ] **Step 4: Remove signature production logic**

Remove `node:crypto`, pinned keys, schema roles, base64url signature parsing, signature preimages, issuer parsing, and signature verification. Decode canonical evidence after structural validation and return the complete-file SHA-256.

- [ ] **Step 5: Run the focused authority test**

Expected: all digest-authority tests pass.

- [ ] **Step 6: Commit the digest authority core**

Commit the authority source, authority test, and index export changes.

### Task 3: Implement digest-and-ledger admission

**Files:**
- Create: `packages/policy/src/release-admission.ts`
- Modify: `packages/policy/src/release-admission.test.ts`
- Modify: `packages/policy/src/index.ts`

**Interfaces:**
- Produces: `evaluateReleaseEvidenceV1(input): ReleaseEvidenceCheckResultV1`.
- Produces: `evaluateReleaseAdmissionV1(input): ReleaseAdmissionResultV1`.
- Produces: `RegisteredReleaseAuthorityV1` without signer fields.

- [ ] **Step 1: Complete the admission matrix tests**

Cover malformed evidence, program, package, action, candidate, design base, OpenSpec manifest, task plan, retry provenance, missing registration, and every registered identity mismatch. Do not add signer or signature cases.

- [ ] **Step 2: Run tests and observe RED**

Run: `npm exec -- tsx --test packages/policy/src/release-admission.test.ts`

Expected: fail on missing admission implementation.

- [ ] **Step 3: Implement pure evidence evaluation**

Decode canonical evidence. Validate the caller identity, action-specific receipt grammar, approved OpenSpec manifest bytes, task-plan bytes, and retry provenance.

- [ ] **Step 4: Implement admission registration comparison**

Return `missing_registration` for valid evidence with no registration. Return `registration_mismatch` unless every registered field and ordered receipt digest matches.

- [ ] **Step 5: Run focused policy tests**

Run: `npm exec -- tsx --test packages/policy/src/release-authority.test.ts packages/policy/src/release-admission.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit admission**

Commit the admission source, tests, and index exports.

### Task 4: Remove signing from the v0.4 release contract

**Files:**
- Modify: `openspec/changes/openspec-superpowers-convergence/design.md`
- Modify: `openspec/changes/openspec-superpowers-convergence/tasks.md`

**Interfaces:**
- Replaces signed receipts with canonical digest receipts.
- Removes every private-key CLI argument and signing ceremony.

- [ ] **Step 1: Update the authority design**

Specify canonical evidence, complete-file digests, Endstop registration, and exact identity comparison. Remove Ed25519, SPKI, fingerprints, signing keys, signer roles, and signature failure reasons.

- [ ] **Step 2: Update Tasks 3 through 8**

Remove signing commands and private-key tests. Retain canonical parsing, Git provenance, ledger registration, gate composition, runtime artifacts, and final audit requirements.

- [ ] **Step 3: Run strict OpenSpec validation**

Run: `openspec validate openspec-superpowers-convergence --strict`

Expected: pass.

- [ ] **Step 4: Commit the release-contract correction**

Commit only the two active OpenSpec authority files.

### Task 5: Verify the correction

**Files:**
- No new files.

**Interfaces:**
- Verifies the complete digest-authority correction.

- [ ] **Step 1: Scan for forbidden signing material**

Run: `rg -n 'createPrivateKey|private-key|PKCS8|Ed25519|issuerKeySha256|SIGNATURES|SIGNING_RECIPES' packages/policy/src openspec/changes/openspec-superpowers-convergence`

Expected: no v0.4 signing implementation or requirement matches.

- [ ] **Step 2: Run policy tests**

Run: `npm exec -- tsx --test packages/policy/src/release-authority.test.ts packages/policy/src/release-admission.test.ts packages/policy/src/release-coverage.test.ts`

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 4: Check the diff and worktree**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors and only intentional changes.
