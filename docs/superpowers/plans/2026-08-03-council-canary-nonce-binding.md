# Council Canary Nonce Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain every provider canary response to the exact challenge nonce before host validation.

**Architecture:** Add the challenge nonce to the closed response-schema builder. Keep the existing host decoder and nonce equality check unchanged.

**Tech Stack:** Node.js 24, TypeScript 6, Effect 3.22.1, pnpm 11.18.0, and Vitest 4.1.10.

## Global Constraints

- Write executable code in TypeScript.
- Do not add a dependency.
- Keep the canary prompt bytes unchanged.
- Keep the host nonce equality check unchanged.
- Bind the exact nonce with a one-value string enum.
- Hash the exact generated schema bytes with the existing digest function.
- Keep review-response schema identity independent.
- Follow red-green-refactor.

---

### Task 1: Bind the canary response nonce

**Files:**

- Modify: `components/council/packages/platform-node/src/canary-materializer.ts`
- Modify: `components/council/packages/platform-node/test/canary-materializer.test.ts`
- Modify: `openspec/changes/council-v029-preflight-release/tasks.md`

**Interfaces:**

- Keep: `buildCanaryMaterial(challenge: CanaryChallengeV1): CanaryMaterial`.
- Change the private schema builder to consume `expectedCheckResult` and `nonce`.
- Produce: `properties.nonce = { type: "string", enum: [challenge.nonce] }`.

- [ ] **Step 1: Write failing schema-binding tests**

Change the expected schema nonce property to this value:

```typescript
nonce: { type: "string", enum: ["nonce-canary-test-001"] },
```

Add this test:

```typescript
it("changes schema bytes and hash when the challenge nonce changes", () => {
  const first = buildCanaryMaterial(challenge());
  const second = buildCanaryMaterial({
    ...challenge(),
    nonce: "nonce-canary-test-002",
  });

  expect(first.schemaJson).not.toBe(second.schemaJson);
  expect(first.canarySchemaVariantHash).not.toBe(
    second.canarySchemaVariantHash,
  );
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
corepack pnpm --dir components/council exec vitest run packages/platform-node/test/canary-materializer.test.ts
```

Expected result: the schema-binding assertions fail because the current nonce
schema accepts any string.

- [ ] **Step 3: Implement exact nonce binding**

Change the private builder to this shape:

```typescript
const closedCanaryResponseSchema = (
  expectedCheckResult: string,
  nonce: string,
) => ({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "nonce", "checkResult", "status"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    nonce: { type: "string", enum: [nonce] },
    checkResult: { type: "string", enum: [expectedCheckResult] },
    status: { type: "string", enum: ["ready"] },
  },
});
```

Pass `challenge.nonce` from `buildCanaryMaterial`.

- [ ] **Step 4: Run focused tests and verify green**

Run the Step 2 command again.

Expected result: the focused file passes with zero failures.

- [ ] **Step 5: Run the complete Council check**

Run:

```bash
corepack pnpm --dir components/council check
```

Expected result: all format, lint, type, architecture, build, and test stages
pass.

- [ ] **Step 6: Complete OpenSpec task 1.8**

Mark task `1.8` complete only after Step 5 passes.

- [ ] **Step 7: Write the Foreman report**

Write `.foreman/runs/v029-canary-nonce-grok/FOREMAN_REPORT.md`. Include the red
result, green results, changed files, and residual risks. Do not include secrets
or private absolute paths.
