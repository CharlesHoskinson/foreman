# Council Preflight Path Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every supported provider one canonical absolute interpretation of relative preflight runtime paths.

**Architecture:** Add one pure normalization function to the Node composition root. Apply it before artifact readers, bundle verification, version probes, or provider dispatch.

**Tech Stack:** Node.js 24, TypeScript 6, Effect 3.22.1, pnpm 11.18.0, and Vitest 4.1.10.

## Global Constraints

- Write executable code in TypeScript.
- Run compiled product code with Node.js 24.
- Do not add a dependency.
- Resolve paths with `node:path.resolve`.
- Resolve each relative runtime path against the CLI invocation directory.
- Normalize `cwd`, `observedBundle.diffPath`, and each `artifactPaths[].path`.
- Keep `provider.executable` unchanged.
- Do not mutate the decoded request.
- Do not add paths to results, tokens, receipts, stdout, or stderr.
- Keep existing typed failures and bounds unchanged.
- Follow red-green-refactor.

---

### Task 1: Normalize preflight runtime paths

**Files:**

- Modify: `components/council/packages/runtime-node/src/preflight-program.ts`
- Modify: `components/council/packages/runtime-node/test/preflight-program.test.ts`
- Modify: `openspec/changes/council-v029-preflight-release/tasks.md`

**Interfaces:**

- Produce: `normalizePreflightRequestPaths(request, invocationDirectory): PreflightCliRequestV1`.
- Consume: `PreflightCliRequestV1` from `@council/schema`.
- Consume: `resolve` from `node:path`.

- [ ] **Step 1: Write the failing normalization test**

Import `resolve` from `node:path`. Import the new function from
`preflight-program.ts`.

Add one test with this behavior:

```typescript
it("normalizes runtime paths against one invocation directory", () => {
  const invocationDirectory = resolve("/tmp", "council-invocation");
  const request = buildValidRequest({
    executable: "grok",
    diffPath: "run/artifacts/diff-patch",
    artifactPathForId: (artifactId) => `run/artifacts/${artifactId}`,
    cwd: "run",
  });
  const original = structuredClone(request);

  const normalized = normalizePreflightRequestPaths(
    request,
    invocationDirectory,
  );

  expect(normalized.cwd).toBe(resolve(invocationDirectory, "run"));
  expect(normalized.observedBundle.diffPath).toBe(
    resolve(invocationDirectory, "run/artifacts/diff-patch"),
  );
  expect(normalized.artifactPaths).toEqual(
    request.artifactPaths.map((item) => ({
      ...item,
      path: resolve(invocationDirectory, item.path),
    })),
  );
  expect(normalized.provider.executable).toBe("grok");
  expect(request).toEqual(original);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
cd components/council
corepack pnpm exec vitest run packages/runtime-node/test/preflight-program.test.ts
```

Expected result: TypeScript reports that
`normalizePreflightRequestPaths` is not exported.

- [ ] **Step 3: Implement the pure normalization function**

Add this import:

```typescript
import { resolve } from "node:path";
```

Add this function before `executePreflightRequest`:

```typescript
export const normalizePreflightRequestPaths = (
  request: PreflightCliRequestV1,
  invocationDirectory: string,
): PreflightCliRequestV1 => ({
  ...request,
  observedBundle: {
    ...request.observedBundle,
    diffPath: resolve(invocationDirectory, request.observedBundle.diffPath),
  },
  artifactPaths: request.artifactPaths.map((item) => ({
    ...item,
    path: resolve(invocationDirectory, item.path),
  })) as PreflightCliRequestV1["artifactPaths"],
  cwd: resolve(invocationDirectory, request.cwd),
});
```

- [ ] **Step 4: Use the normalized request in the composition root**

Add an optional `invocationDirectory` parameter to `executePreflightRequest`.
Default it to `process.cwd()`.

Normalize the request before provider selection. Use the normalized request for
artifact readers, bundle verification, and `runPromptPreflight`.

- [ ] **Step 5: Run focused tests and verify green**

Run:

```bash
cd components/council
corepack pnpm exec vitest run packages/runtime-node/test/preflight-program.test.ts packages/runtime-node/test/preflight-cli.test.ts
```

Expected result: both test files pass with zero failures.

- [ ] **Step 6: Run the complete Council check**

Run:

```bash
cd components/council
corepack pnpm check
```

Expected result: format, lint, type checks, architecture checks, builds, and
tests pass.

- [ ] **Step 7: Update the OpenSpec task**

Mark task `1.7` complete only after Step 6 passes.

- [ ] **Step 8: Write the Foreman report**

Write `FOREMAN_REPORT.md` with the red command, green command, changed files,
and residual risks. Do not include secrets or private paths.
