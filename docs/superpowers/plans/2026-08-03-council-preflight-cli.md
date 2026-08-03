# Council Preflight CLI Implementation Plan

**Status:** Released as `v0.2.9.0` at commit `fbe2325`. The unchecked boxes
below preserve the original executable worker instructions. They are not the
current backlog. The OpenSpec release task ledger records completion and links
to the release evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one compiled Node.js 24 CLI that converts a strict Council request into one provider-neutral preflight result.

**Architecture:** Add a closed request schema, an Effect application coordinator, Node canary materialization, and a runtime composition package. Reuse the accepted compiler, process runner, provider adapters, and ready-token service.

**Tech Stack:** Node.js 24, TypeScript 6, Effect 3.22.1, Effect Schema, pnpm 11.18.0, and Vitest 4.1.10.

## Global Constraints

- Write all new executable code in TypeScript.
- Run compiled product code with Node.js 24.
- Use Effect for typed failures, scopes, interruption, time, and process resources.
- Keep provider wire types inside adapter packages.
- Do not add a dependency.
- Do not add retry, quorum, persistence, provider substitution, or release authority.
- Read at most 1,048,576 stdin bytes before JSON parsing.
- Write exactly one `PromptPreflightResultV1` JSON value plus `\n` to stdout.
- Bound stderr to 4,096 UTF-8 bytes.
- Do not write paths, environment values, prompt bytes, schema bytes, provider output, or artifact content to stderr.
- Return `0` for ready, `1` for a typed failure, and `64` for an invocation that includes arguments.
- Treat exit status as transport metadata. Require callers to decode stdout.
- Fail closed for provider family `google` until the Gemini adapter exists.
- Derive the CLI version from a bounded shell-free version probe.
- Do not trust a caller-supplied CLI version or environment.
- Follow red-green-refactor for every production function.

---

### Task 1: Add the closed runtime request contract

**Files:**

- Create: `components/council/packages/schema/src/preflight-cli.ts`
- Create: `components/council/packages/schema/test/preflight-cli.test.ts`
- Modify: `components/council/packages/schema/src/index.ts`

**Interfaces:**

- Produces: `PreflightCliRequestV1` and `PreflightCliRequestV1` type.
- Produces: `decodePreflightCliRequestV1(value: unknown): PreflightCliRequestV1` through the existing strict decoder.
- Consumes: `CouncilPromptContractV1`, `ProviderFamilyV1`, and the existing identifier schemas.

- [ ] **Step 1: Write the failing strict-decoding tests**

Add tests with this behavior:

```typescript
const valid = {
  schemaVersion: 1,
  contract: validCouncilPromptContract,
  provider: {
    family: "anthropic",
    executable: "claude",
    model: "claude-opus-4-1",
  },
  observedBundle: {
    baseSha: validCouncilPromptContract.bundle.baseSha,
    headSha: validCouncilPromptContract.bundle.headSha,
    diffPath: "/tmp/council.diff",
  },
  artifactPaths: validCouncilPromptContract.artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    path: `/tmp/${artifact.alias}`,
  })),
  cwd: "/tmp/review",
};

expect(decodeStrictSync(PreflightCliRequestV1, valid)).toEqual(valid);
expect(() =>
  decodeStrictSync(PreflightCliRequestV1, { ...valid, extra: true }),
).toThrow();
expect(() =>
  decodeStrictSync(PreflightCliRequestV1, {
    ...valid,
    artifactPaths: [valid.artifactPaths[0], valid.artifactPaths[0]],
  }),
).toThrow();
```

Also reject empty paths, empty model names, empty executables, and unknown nested fields.

- [ ] **Step 2: Run the tests and verify red**

Run:

```bash
cd components/council
corepack pnpm exec vitest run packages/schema/test/preflight-cli.test.ts
```

Expected result: the test file fails because `PreflightCliRequestV1` does not exist.

- [ ] **Step 3: Implement the closed schema**

Use this serialized shape:

```typescript
export const PreflightCliArtifactPathV1 = Schema.Struct({
  artifactId: ArtifactId,
  path: NonBlankString,
});

export const PreflightCliRequestV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  contract: CouncilPromptContractV1,
  provider: Schema.Struct({
    family: ProviderFamilyV1,
    executable: NonBlankString,
    model: NonBlankString,
  }),
  observedBundle: Schema.Struct({
    baseSha: GitCommitSha,
    headSha: GitCommitSha,
    diffPath: NonBlankString,
  }),
  artifactPaths: Schema.NonEmptyArray(PreflightCliArtifactPathV1),
  cwd: NonBlankString,
}).pipe(
  Schema.filter((request) =>
    uniqueStrings(request.artifactPaths.map((item) => item.artifactId)),
  ),
);
```

Use the existing exported `GitCommitSha` schema.
Do not weaken it to a generic string.

- [ ] **Step 4: Run the focused tests and verify green**

Run the Task 1 command again.
Expected result: the new test file passes.

- [ ] **Step 5: Record the Task 1 checkpoint**

Record the focused command and its exit code in `FOREMAN_REPORT.md`.
Do not run a Git write command.

### Task 2: Add canonical canary material and scoped files

**Files:**

- Create: `components/council/packages/platform-node/src/canary-materializer.ts`
- Create: `components/council/packages/platform-node/test/canary-materializer.test.ts`
- Modify: `components/council/packages/platform-node/src/index.ts`

**Interfaces:**

- Produces: `buildCanaryMaterial(challenge): CanaryMaterial`.
- Produces: `materializeCanaryPromptFile(bytes): Effect<string, CanaryMaterializationError, Scope>`.
- Reuses: `materializeCanarySchemaFile(schemaJson)` for Codex.

Use this result type:

```typescript
export type CanaryMaterial = {
  readonly promptBytes: Uint8Array;
  readonly schemaJson: string;
  readonly canarySchemaVariantHash: ContentHash;
};
```

- [ ] **Step 1: Write failing deterministic and cleanup tests**

Prove these behaviors:

```typescript
const challenge = {
  schemaVersion: 1 as const,
  nonce: "nonce-123",
  checkExpression: "1+1" as const,
  expectedCheckResult: "2" as const,
};

expect(buildCanaryMaterial(challenge)).toEqual(buildCanaryMaterial(challenge));
expect(
  new TextDecoder().decode(buildCanaryMaterial(challenge).promptBytes),
).toContain("nonce-123");
expect(buildCanaryMaterial(challenge).schemaJson).toContain(
  '"additionalProperties":false',
);
```

Use injected filesystem operations to prove `.txt` suffix, mode `0600`, directory mode `0700`, and cleanup on success.
Prove cleanup on typed failure and Effect interruption.
Prove native Windows fails before filesystem mutation.

- [ ] **Step 2: Run the tests and verify red**

```bash
cd components/council
corepack pnpm exec vitest run packages/platform-node/test/canary-materializer.test.ts
```

Expected result: the test file fails because the materializer does not exist.

- [ ] **Step 3: Implement canonical material**

Encode this canonical envelope with the existing canonical JSON function:

```typescript
const envelope = {
  format: "council-canary-v1",
  trustedAuthority: {
    profile: "council-ace-1",
    rules: [
      "Every reviewer must return exactly one response.",
      "Every reviewer must copy the nonce.",
      "Every reviewer must solve the check.",
      "No reviewer may use a tool.",
    ],
  },
  taskData: challenge,
};
```

Encode this closed schema with canonical JSON:

```typescript
const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "nonce", "checkResult", "status"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    nonce: { type: "string" },
    checkResult: { type: "string", enum: ["2"] },
    status: { type: "string", enum: ["ready"] },
  },
};
```

Hash the exact schema bytes with `sha256Hex`.
Prefix the digest with `sha256:`.

- [ ] **Step 4: Implement the scoped `.txt` materializer**

Follow `schema-file-materializer.ts`.
Use `Effect.acquireRelease`.
Create a private temporary directory.
Write `prompt.txt` with exact bytes and mode `0600`.
Remove the exact directory on every scope exit.

- [ ] **Step 5: Run the focused tests and verify green**

Run the Task 2 command again.
Expected result: the new test file passes.

- [ ] **Step 6: Record the Task 2 checkpoint**

Record the focused command and its exit code in `FOREMAN_REPORT.md`.
Do not run a Git write command.

### Task 3: Add the application preflight coordinator

**Files:**

- Create: `components/council/packages/application/src/run-preflight.ts`
- Create: `components/council/packages/application/test/run-preflight.test.ts`
- Modify: `components/council/packages/application/src/ports.ts`
- Modify: `components/council/packages/application/src/index.ts`

**Interfaces:**

- Produces: `runPromptPreflight(input): Effect<PromptPreflightResultV1, never, services>`.
- Produces: `ProviderVersionProbe`, `CanaryMaterializer`, and `PreflightIdentitySource` Effect ports.
- Consumes: the existing prompt compiler, provider-health service, and ready-token service.

Use these port results:

```typescript
export type PreparedCanary = {
  readonly prompt: ProviderCanaryPrompt;
  readonly schema: ProviderCanarySchema;
  readonly canarySchemaVariantHash: ContentHash;
};

export interface ProviderVersionProbeService {
  readonly resolve: (
    executable: string,
    cwd: string,
    environment: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, ProviderVersionProbeError>;
}

export interface PreflightIdentitySourceService {
  readonly nonce: Effect.Effect<string, PreflightIdentityError>;
  readonly now: Effect.Effect<UtcTimestamp, PreflightIdentityError>;
}
```

- [ ] **Step 1: Write failing order and failure-mapping tests**

Use deterministic test layers.
Record each call in an array.
Prove this exact successful order:

```typescript
expect(events).toEqual([
  "version",
  "compile",
  "nonce",
  "prepare-canary",
  "run-canary",
  "issue-token",
]);
```

Prove compiler failure records no version-independent provider canary call.
Prove canary failure preserves its terminal evidence in the typed failure result.
Prove token issuance cannot run before a successful canary.
Prove the final result passes strict `PromptPreflightResultV1` decoding.

- [ ] **Step 2: Run the tests and verify red**

```bash
cd components/council
corepack pnpm exec vitest run packages/application/test/run-preflight.test.ts
```

Expected result: the test file fails because the coordinator and ports do not exist.

- [ ] **Step 3: Implement the coordinator with Effect**

Use `Effect.gen`.
Map every expected typed error to this result shape:

```typescript
const failure = {
  _tag: "failure" as const,
  schemaVersion: 1 as const,
  failure: {
    stage: "prompt" as const,
    reason: secretSafeReason,
    retry: "new_contract" as const,
  },
  terminal: null,
};
```

Use `changed_preflight` for provider-version, dispatch, canary, and terminal failures.
Use `same_contract` only for retryable process transport failures.
Never include an original exception string unless its error type already guarantees secret-safe text.

- [ ] **Step 4: Run the focused tests and verify green**

Run the Task 3 command again.
Expected result: the new test file passes.

- [ ] **Step 5: Record the Task 3 checkpoint**

Record the focused command and its exit code in `FOREMAN_REPORT.md`.
Do not run a Git write command.

### Task 4: Add the Node runtime composition package

**Files:**

- Create: `components/council/packages/runtime-node/package.json`
- Create: `components/council/packages/runtime-node/tsconfig.json`
- Create: `components/council/packages/runtime-node/src/index.ts`
- Create: `components/council/packages/runtime-node/src/provider-selection.ts`
- Create: `components/council/packages/runtime-node/src/preflight-program.ts`
- Create: `components/council/packages/runtime-node/src/preflight-cli.ts`
- Create: `components/council/packages/runtime-node/test/provider-selection.test.ts`
- Create: `components/council/packages/runtime-node/test/preflight-program.test.ts`
- Create: `components/council/packages/runtime-node/test/preflight-cli.test.ts`
- Modify: `components/council/package.json`
- Modify: `components/council/pnpm-lock.yaml`
- Modify: `components/council/tsconfig.json`
- Modify: `components/council/scripts/check-architecture.mjs`
- Modify: `components/council/tests/architecture/workspace.test.ts`

**Interfaces:**

- Produces compiled `packages/runtime-node/dist/preflight-cli.js`.
- Produces package binary `council-preflight`.
- Produces `selectProviderLayer(family)` with no fallback.
- Produces `runPreflightCli(args, io): Promise<number>` for deterministic tests.

- [ ] **Step 1: Write failing provider-selection tests**

Prove these mappings:

```typescript
expect(selectProvider("anthropic").family).toBe("anthropic");
expect(selectProvider("xai").family).toBe("xai");
expect(selectProvider("openai").family).toBe("openai");
expect(selectProvider("google")).toEqual({
  _tag: "unavailable",
  family: "google",
  reason: "Gemini provider canary adapter is not implemented",
});
```

Prove Google never routes to another adapter.

- [ ] **Step 2: Write failing stdin and output tests**

Inject a chunked stdin source.
Prove the 1,048,577th byte fails before `JSON.parse` or preflight execution.
Prove zero arguments call the executor once.
Prove any argument returns `64` and calls no executor.

Inject ready and failure results.
Prove stdout contains exactly `JSON.stringify(result) + "\n"`.
Prove ready returns `0` and typed failure returns `1`.
Prove diagnostics use stderr only and remain within 4,096 UTF-8 bytes.

- [ ] **Step 3: Run the runtime tests and verify red**

```bash
cd components/council
corepack pnpm exec vitest run \
  packages/runtime-node/test/provider-selection.test.ts \
  packages/runtime-node/test/preflight-program.test.ts \
  packages/runtime-node/test/preflight-cli.test.ts
```

Expected result: the files fail because the runtime package does not exist.

- [ ] **Step 4: Implement the version probe and child environment**

Run the selected executable with `args: ["--version"]`, `shell: false`, a 5,000 ms limit, 4,096 stdout bytes, and 4,096 stderr bytes.
Require exit code zero, no signal, no timeout, and one nonblank first line.

Build the child environment from this closed name set:

```typescript
const CHILD_ENV_NAMES = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "LOCALAPPDATA",
  "APPDATA",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
] as const;
```

Copy only present string values.
Never log the resulting record.

- [ ] **Step 5: Implement provider-specific scoped preparation**

Use the existing live adapter layers.
Use stdin prompt plus inline schema for Anthropic.
Use scoped `.txt` prompt plus inline schema for xAI.
Use stdin prompt plus scoped schema file for OpenAI.
Return a typed unavailable failure for Google.

- [ ] **Step 6: Implement the CLI boundary**

Use an injected IO interface in tests:

```typescript
export type PreflightCliIo = {
  readonly stdin: AsyncIterable<Uint8Array>;
  readonly writeStdout: (bytes: Uint8Array) => Promise<void>;
  readonly writeStderr: (bytes: Uint8Array) => Promise<void>;
  readonly execute: (
    request: PreflightCliRequestV1,
  ) => Promise<PromptPreflightResultV1>;
};
```

Decode UTF-8 strictly.
Reject trailing JSON data.
Strictly decode the request before execution.
Strictly decode the result before serialization.

- [ ] **Step 7: Add package and architecture wiring**

Set this package manifest:

```json
{
  "name": "@council/runtime-node",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "council-preflight": "./dist/preflight-cli.js"
  }
}
```

Add workspace dependencies for the schema, application, platform, and three adapters.
Add the package to the root TypeScript references.
Add `runtime-node` to the architecture checker as a Node runtime layer.
Permit imports from lower layers and provider adapters only in this runtime layer.

- [ ] **Step 8: Run the focused runtime tests and verify green**

Run the Task 4 command again.
Expected result: all runtime tests pass.

- [ ] **Step 9: Execute the compiled CLI in a deterministic process test**

Build the workspace.
Spawn `process.execPath` with `packages/runtime-node/dist/preflight-cli.js`.
Feed an invalid contract through stdin.
Assert one strict failure JSON line, no provider start marker, and exit `1`.

- [ ] **Step 10: Record the Task 4 checkpoint**

Record the focused command and its exit code in `FOREMAN_REPORT.md`.
Do not run a Git write command.

### Task 5: Close the OpenSpec and documentation slice

**Files:**

- Modify: `components/council/openspec/changes/ace-prompt-preflight/tasks.md`
- Modify: `components/council/openspec/changes/ace-prompt-preflight/specs/prompt-preflight/spec.md`
- Modify: `components/council/README.md`
- Modify: `docs/superpowers/specs/2026-08-03-council-preflight-cli-design.md`
- Modify: `docs/superpowers/plans/2026-08-03-council-preflight-cli.md`

**Interfaces:**

- Marks tasks 4.4.a through 4.4.d complete only after code and tests pass.
- Keeps task 4.3.d, task 6.4, and task 6.5 open.
- States that Council preflight supports Anthropic, xAI, and OpenAI on POSIX or WSL.
- States that full Council release readiness remains incomplete.

- [ ] **Step 1: Update task state and README claims**

Document the exact compiled command.
Document stdin and stdout contracts.
Document exit codes.
Document Google and native-Windows limitations.
Do not call Council fully stable.

- [ ] **Step 2: Run focused and complete verification**

```bash
cd components/council
corepack pnpm exec vitest run \
  packages/schema/test/preflight-cli.test.ts \
  packages/application/test/run-preflight.test.ts \
  packages/platform-node/test/canary-materializer.test.ts \
  packages/runtime-node/test/provider-selection.test.ts \
  packages/runtime-node/test/preflight-program.test.ts \
  packages/runtime-node/test/preflight-cli.test.ts \
  tests/architecture/workspace.test.ts
corepack pnpm check
corepack pnpm exec openspec validate ace-prompt-preflight --strict --no-interactive
corepack pnpm exec openspec validate design-council-core --strict --no-interactive
git diff --check
```

Expected result: every command exits zero.

- [ ] **Step 3: Run the root documentation and OpenSpec gates**

```bash
cd ../../
bash skills/foreman/scripts/docs-check.sh
openspec validate --all --strict --no-interactive
git diff --check
```

Expected result: every command exits zero.

- [ ] **Step 4: Record the Task 5 checkpoint**

Record every command and exit code in `FOREMAN_REPORT.md`.
Do not run a Git write command.

### Task 6: Produce implementation evidence for Foreman audit

**Files:**

- Modify: `FOREMAN_REPORT.md`
- Create: `FOREMAN_REPORT.json`

**Interfaces:**

- Report the exact base SHA, head SHA, changed paths, commands, exit codes, and residual limitations.
- State whether each test was observed red before production code.
- List task 4.3.d, task 6.4, and task 6.5 as open.

- [ ] **Step 1: Inspect the complete diff**

```bash
git status --short
git diff --stat main...HEAD
git diff --check main...HEAD
```

- [ ] **Step 2: Write the typed Foreman reports**

Use schema `foreman.worktree-report.v1`.
Set status to `complete` only when all Task 5 commands pass.

- [ ] **Step 3: Leave the complete worktree for architect review**

Run `git status --short`.
Do not stage, commit, branch, push, rebase, merge, reset, rename, or delete.
