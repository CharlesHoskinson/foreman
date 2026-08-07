# Resume Safety Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Effect services that collect fail-safe process and lock observations for R5A.

**Architecture:** Classify injected boundary results with pure functions. Bind those classifiers to Node signal-zero and no-follow path metadata. Compose both services into one observation program.

**Tech Stack:** Node.js 24, strict TypeScript, Effect, and Node test runner.

## Global constraints

- Add no Python, shell, PowerShell, JavaScript, Bun, or Deno code.
- Perform observation only.
- Do not modify a shell adapter.
- Return `unknown` for malformed or unclassified boundary results.
- Use test-driven development.

---

### Task 1: Add pure boundary classifiers

**Files:**

- Create: `packages/orchestration/src/resume-safety-services.ts`
- Create: `packages/orchestration/src/resume-safety-services.test.ts`

**Public shapes:**

```ts
export type ProcessProbeOutcome = "exists" | "missing" | "denied" | "failed";
export type LockPathKind = "missing" | "directory" | "symlink" | "regular" | "other" | "failed";

export function classifyResumeProcess(
  processId: number | null,
  outcome: ProcessProbeOutcome,
): ResumeProcessState;

export function classifyResumeLock(
  lockPath: string,
  kind: LockPathKind,
): ResumeLockState;
```

- [ ] **Step 1: Write RED classifier tests**

Add tables for every closed outcome.
Assert that `denied` is `active`.
Assert that invalid process IDs are `unknown`.
Assert that only a missing current-platform absolute path is `free`.
Assert that only a directory is `held`.

- [ ] **Step 2: Run the RED tests**

Run: `node --import tsx --test packages/orchestration/src/resume-safety-services.test.ts`

Expected: The module does not exist and the test command fails.

- [ ] **Step 3: Implement the pure classifiers**

Bound the lock path at 32,768 UTF-8 bytes.
Use `node:path.isAbsolute` so the path spelling and filesystem boundary use the
same current-platform semantics.
Reject foreign-platform, empty, relative, and NUL-containing paths as
`unknown`.

- [ ] **Step 4: Run the classifier tests**

Run: `node --import tsx --test packages/orchestration/src/resume-safety-services.test.ts`

Expected: All classifier tests pass.

### Task 2: Add Effect services and live layers

**Files:**

- Modify: `packages/orchestration/src/resume-safety-services.ts`
- Modify: `packages/orchestration/src/resume-safety-services.test.ts`
- Modify: `packages/orchestration/src/index.ts`

**Public services:**

```ts
export class ResumeProcessProbe extends Context.Tag("ResumeProcessProbe")<
  ResumeProcessProbe,
  { readonly observe: (processId: number | null) => Effect.Effect<ResumeProcessState> }
>() {}

export class ResumeLockProbe extends Context.Tag("ResumeLockProbe")<
  ResumeLockProbe,
  { readonly observe: (lockPath: string) => Effect.Effect<ResumeLockState> }
>() {}

export type ResumeSafetyObservationV1 = {
  readonly processState: ResumeProcessState;
  readonly lockState: ResumeLockState;
};

export function observeResumeSafety(input: {
  readonly processId: number | null;
  readonly lockPath: string;
}): Effect.Effect<ResumeSafetyObservationV1, never, ResumeProcessProbe | ResumeLockProbe>;

export type ResumeSafetyBoundarySeams = {
  readonly signalZero: (processId: number) => void;
  readonly lstatKind: (
    lockPath: string,
  ) => "directory" | "symlink" | "regular" | "other";
};

export function makeLiveResumeSafetyLayers(
  seams?: Partial<ResumeSafetyBoundarySeams>,
): Layer.Layer<ResumeProcessProbe | ResumeLockProbe>;

export const liveResumeSafetyServices: Layer.Layer<
  ResumeProcessProbe | ResumeLockProbe
>;
```

- [ ] **Step 1: Write RED Effect tests**

Use injected service layers.
Prove both services are called once.
Prove `unknown` is preserved.
Prove a service defect becomes `unknown` at its own live boundary.
Prove a defect from either injected Effect service becomes that service's
`unknown` state.
Prove Fiber interruption is not caught.

- [ ] **Step 2: Implement service composition**

Use `Effect.all` to collect the two independent observations.
Return only `ResumeSafetyObservationV1`.
Use `Effect.catchAllDefect` on each individual probe observation.
Do not use `Effect.catchAllCause`; interruption must remain interruption.

- [ ] **Step 3: Implement live layers**

Use `process.kill(processId, 0)` for process existence.
Map `ESRCH` to `missing` and `EPERM` to `denied`.
Map any other exception to `failed`.

Use `lstatSync` for lock metadata.
Map `ENOENT` to `missing`.
Do not call `statSync` or follow a symbolic link.
Map any other exception to `failed`.

Implement `makeLiveResumeSafetyLayers` with optional low-level seams.
The default `signalZero` seam calls `process.kill(processId, 0)`.
The default `lstatKind` seam calls `lstatSync` and maps its returned metadata to
`directory`, `symlink`, `regular`, or `other`.
Catch and classify thrown errors inside the corresponding live service.
Use the injected seams to prove `ESRCH`, `EPERM`, `ENOENT`, and unknown failures.

- [ ] **Step 4: Export the public API**

Export the classifiers, services, live layers, program, and public types from
`packages/orchestration/src/index.ts`.

- [ ] **Step 5: Run verification**

Run: `node --import tsx --test packages/orchestration/src/resume-safety-services.test.ts`

Expected: All focused tests pass.

Run: `npm run typecheck && npm run build && npm run verify-runtime && npm run verify`

Expected: All commands pass.

Run: `openspec validate resume-safety-services-typescript --strict`

Expected: The change is valid.

Run: `node skills/foreman/runtime/dist/architecture-policy.js check --base 84befb7d24d5ccf00df882459a56176ee6ea93a1`

Expected: The policy returns `Pass` with zero findings after the host commits the worker result.

Run: `git diff --check`

Expected: The command returns exit code 0.
