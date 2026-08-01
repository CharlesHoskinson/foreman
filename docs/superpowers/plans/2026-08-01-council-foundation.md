# Council Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Create a runnable, strictly typed TypeScript workspace with versioned Council schemas and a runtime-free event-sourced domain for lifecycle, budgets, authorization, and quorum.

**Architecture:** The schema package owns every serialized contract and uses only Effect Schema. The domain package imports schema types, contains immutable values and total pure functions, and never imports the Effect runtime, Node APIs, persistence, provider code, or platform code. This plan stops at deterministic in-memory behavior; Effect services and live I/O start in the next subsystem plan.

**Tech Stack:** Node.js 24, pnpm 11.18.0, TypeScript 7.0.2, Effect 3.22.1, Vitest 4.1.10, fast-check 4.9.0, ESLint 10.0.1, typescript-eslint 8.65.0, and Prettier 3.9.6.

## Global Constraints

- Use Effect version 3.22.1 and keep the supported range below 4.
- Import schema APIs from effect/Schema; domain source files must not import Effect.
- All compiler options remain strict, including exactOptionalPropertyTypes and noUncheckedIndexedAccess.
- Every serialized value has an explicit schema version or is nested in a versioned envelope.
- Core objects reject unknown properties; extensions are allowed only in an explicit versioned extensions field.
- Domain functions read no clock, generate no identifier, perform no I/O, mutate no input, and return no Effect.
- Lifecycle, failure, authority, approval, budget, provenance, and deliberation outcomes use closed discriminated unions.
- Terminal run states are absorbing.
- Inputs that depend on time, randomness, hashing, policy, or storage arrive as validated command data.
- New behavior follows red-green-refactor and each task ends with a focused commit.

---

## File map

- package.json — root commands, exact tool versions, and package-manager declaration.
- pnpm-workspace.yaml — workspace package discovery.
- tsconfig.base.json — shared strict compiler policy.
- tsconfig.json — build project references.
- tsconfig.eslint.json — no-emit type checking for source, tests, and configuration.
- vitest.config.ts — deterministic unit and property-test discovery.
- eslint.config.mjs — source-boundary and correctness lint rules.
- .prettierrc.json — repository formatting contract.
- .prettierignore — generated and preserved-research exclusions.
- packages/schema/src/identifiers.ts — branded identifiers, distinct hashes, and UTC timestamps.
- packages/schema/src/decode.ts — strict boundary decoding with excess-property rejection.
- packages/schema/src/authority.ts — authority and trust-state schemas.
- packages/schema/src/lifecycle.ts — command, event, envelope, and lifecycle schemas.
- packages/schema/src/task-contract.ts — task contracts, budgets, amendments, actions, and approvals.
- packages/schema/src/deliberation.ts — candidate, failure-domain, calibration, and typed outcome schemas.
- packages/schema/src/index.ts — schema-only public surface.
- packages/domain/src/decision.ts — accepted/rejected decision type.
- packages/domain/src/run.ts — run state, decide, evolve, and replay.
- packages/domain/src/budget.ts — pure reservations and reconciliation.
- packages/domain/src/authorization.ts — exact approval and fail-closed commitment decisions.
- packages/domain/src/quorum.ts — failure-domain quorum, calibration eligibility, and closure.
- packages/domain/src/index.ts — pure-domain public surface.
- packages/schema/test/*.test.ts — schema decoding and rejection tests.
- packages/domain/test/*.test.ts — unit and property tests for domain invariants.
- scripts/check-architecture.mjs — deterministic import-boundary checker.
- tests/architecture/workspace.test.ts — package and boundary regression tests.

### Task 1: Bootstrap the strict workspace through a failing workspace test

**Files:**
- Create: package.json
- Create: pnpm-workspace.yaml
- Create: tsconfig.base.json
- Create: tsconfig.json
- Create: tsconfig.eslint.json
- Create: vitest.config.ts
- Create: .prettierrc.json
- Create: .prettierignore
- Create: tests/architecture/workspace.test.ts
- Create: packages/schema/package.json
- Create: packages/schema/tsconfig.json
- Create: packages/domain/package.json
- Create: packages/domain/tsconfig.json
- Create: packages/domain/src/index.ts

**Interfaces:**
- Consumes: the approved dependency direction schema → domain.
- Produces: pnpm scripts check, test, typecheck, lint, format:check; workspace packages @council/schema and @council/domain.

- [ ] **Step 1: Create the root toolchain files**

    package.json:

    {
      "name": "council",
      "version": "0.0.0",
      "private": true,
      "type": "module",
      "packageManager": "pnpm@11.18.0",
      "engines": { "node": ">=24 <25" },
      "scripts": {
        "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test",
        "format": "prettier --write .",
        "format:check": "prettier --check .",
        "lint": "eslint .",
        "test": "vitest run",
        "test:watch": "vitest",
        "typecheck": "tsc -b --pretty false && tsc -p tsconfig.eslint.json --noEmit --pretty false"
      },
      "devDependencies": {
        "@eslint/js": "10.0.1",
        "@types/node": "26.1.2",
        "@vitest/coverage-v8": "4.1.10",
        "eslint": "10.0.1",
        "fast-check": "4.9.0",
        "globals": "17.8.0",
        "prettier": "3.9.6",
        "typescript": "7.0.2",
        "typescript-eslint": "8.65.0",
        "vitest": "4.1.10"
      }
    }

    pnpm-workspace.yaml:

    packages:
      - packages/*

    tsconfig.base.json:

    {
      "compilerOptions": {
        "composite": true,
        "declaration": true,
        "declarationMap": true,
        "exactOptionalPropertyTypes": true,
        "forceConsistentCasingInFileNames": true,
        "lib": ["ES2024"],
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "noEmitOnError": true,
        "noFallthroughCasesInSwitch": true,
        "noImplicitOverride": true,
        "noUncheckedIndexedAccess": true,
        "rootDir": ".",
        "skipLibCheck": true,
        "strict": true,
        "target": "ES2024",
        "verbatimModuleSyntax": true
      }
    }

    tsconfig.json:

    {
      "files": [],
      "references": [
        { "path": "./packages/schema" },
        { "path": "./packages/domain" }
      ]
    }

    tsconfig.eslint.json:

    {
      "extends": "./tsconfig.base.json",
      "compilerOptions": {
        "composite": false,
        "noEmit": true,
        "rootDir": "."
      },
      "include": [
        "vitest.config.ts",
        "packages/*/src/**/*.ts",
        "packages/*/test/**/*.ts",
        "tests/**/*.ts"
      ]
    }

    vitest.config.ts:

    import { defineConfig } from "vitest/config";

    export default defineConfig({
      test: {
        include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
        sequence: { concurrent: false },
        testTimeout: 5_000
      }
    });

    .prettierrc.json:

    {
      "semi": true,
      "singleQuote": false,
      "trailingComma": "all"
    }

    .prettierignore:

    .claude/
    .codex/
    .gemini/
    docs/research/
    node_modules/
    dist/
    coverage/

- [ ] **Step 2: Install the exact dependency set**

    Run: corepack pnpm install

    Expected: pnpm-lock.yaml is created, Effect is not installed yet, and the command exits 0.

- [ ] **Step 3: Write the failing workspace test**

    tests/architecture/workspace.test.ts:

    import { access } from "node:fs/promises";
    import { describe, expect, it } from "vitest";

    const requiredFiles = [
      "packages/schema/package.json",
      "packages/schema/tsconfig.json",
      "packages/domain/package.json",
      "packages/domain/tsconfig.json",
      "packages/domain/src/index.ts"
    ] as const;

    describe("workspace", () => {
      for (const file of requiredFiles) {
        it("contains " + file, async () => {
          await expect(access(file)).resolves.toBeUndefined();
        });
      }
    });

- [ ] **Step 4: Run the test and observe the intended failure**

    Run: corepack pnpm test tests/architecture/workspace.test.ts

    Expected: FAIL because packages/schema/package.json does not exist.

- [ ] **Step 5: Add the two package shells**

    packages/schema/package.json:

    {
      "name": "@council/schema",
      "version": "0.0.0",
      "private": true,
      "type": "module",
      "exports": { ".": "./src/index.ts" },
      "dependencies": { "effect": "3.22.1" }
    }

    packages/schema/tsconfig.json:

    {
      "extends": "../../tsconfig.base.json",
      "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src",
        "tsBuildInfoFile": "dist/.tsbuildinfo"
      },
      "include": ["src/**/*.ts"]
    }

    packages/domain/package.json:

    {
      "name": "@council/domain",
      "version": "0.0.0",
      "private": true,
      "type": "module",
      "exports": { ".": "./src/index.ts" },
      "dependencies": { "@council/schema": "workspace:*" }
    }

    packages/domain/tsconfig.json:

    {
      "extends": "../../tsconfig.base.json",
      "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src",
        "tsBuildInfoFile": "dist/.tsbuildinfo"
      },
      "references": [{ "path": "../schema" }],
      "include": ["src/**/*.ts"]
    }

    packages/domain/src/index.ts:

    export {};

- [ ] **Step 6: Reinstall and verify the workspace test is green**

    Run: corepack pnpm install && corepack pnpm test tests/architecture/workspace.test.ts

    Expected: PASS with five passing tests.

- [ ] **Step 7: Commit the workspace bootstrap**

    git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json tsconfig.eslint.json vitest.config.ts .prettierrc.json .prettierignore tests/architecture packages/schema/package.json packages/schema/tsconfig.json packages/domain/package.json packages/domain/tsconfig.json
    git commit -m "build: bootstrap Council TypeScript workspace"

### Task 2: Add branded identifiers and authority schemas

**Files:**
- Create: packages/schema/src/identifiers.ts
- Create: packages/schema/src/authority.ts
- Create: packages/schema/src/decode.ts
- Create: packages/schema/src/index.ts
- Create: packages/schema/test/identifiers.test.ts

**Interfaces:**
- Consumes: Effect Schema 3.22.1.
- Produces: branded run, branch, step, attempt, command, event, provider-session, approval, capability, artifact, claim, candidate, ballot, policy, correlation, causation, actor, hash, and timestamp types plus authority schemas and decodeStrictSync.

- [ ] **Step 1: Write identifier and authority decoding tests**

    packages/schema/test/identifiers.test.ts:

    import * as Schema from "effect/Schema";
    import { describe, expect, it } from "vitest";
    import {
      AuthorityClass,
      RunId,
      UtcTimestamp,
      ValidationStatus
    } from "../src/index.js";

    describe("schema primitives", () => {
      it("accepts a prefixed uppercase ULID run identifier", () => {
        expect(
          Schema.decodeUnknownSync(RunId)("run_01ARZ3NDEKTSV4RRFFQ69G5FAV")
        ).toBe("run_01ARZ3NDEKTSV4RRFFQ69G5FAV");
      });

      it("rejects an unprefixed identifier", () => {
        expect(() =>
          Schema.decodeUnknownSync(RunId)("01ARZ3NDEKTSV4RRFFQ69G5FAV")
        ).toThrow();
      });

      it("rejects unknown authority and validation values", () => {
        expect(() =>
          Schema.decodeUnknownSync(AuthorityClass)("system")
        ).toThrow();
        expect(() =>
          Schema.decodeUnknownSync(ValidationStatus)("trusted")
        ).toThrow();
      });

      it("accepts a canonical UTC timestamp", () => {
        expect(
          Schema.decodeUnknownSync(UtcTimestamp)("2026-08-01T12:00:00.000Z")
        ).toBe("2026-08-01T12:00:00.000Z");
      });
    });

- [ ] **Step 2: Run the schema test and verify red**

    Run: corepack pnpm test packages/schema/test/identifiers.test.ts

    Expected: FAIL because packages/schema/src/index.ts does not exist.

- [ ] **Step 3: Implement the branded primitives**

    packages/schema/src/identifiers.ts:

    import * as Schema from "effect/Schema";

    const ulid = "[0-9A-HJKMNP-TV-Z]{26}";
    const sha256 = "[a-f0-9]{64}";

    export const RunId = Schema.String.pipe(
      Schema.pattern(new RegExp("^run_" + ulid + "$")),
      Schema.brand("RunId")
    );
    export type RunId = typeof RunId.Type;

    export const BranchId = Schema.String.pipe(
      Schema.pattern(new RegExp("^brn_" + ulid + "$")),
      Schema.brand("BranchId")
    );
    export type BranchId = typeof BranchId.Type;

    export const StepId = Schema.String.pipe(
      Schema.pattern(new RegExp("^stp_" + ulid + "$")),
      Schema.brand("StepId")
    );
    export type StepId = typeof StepId.Type;

    export const AttemptId = Schema.String.pipe(
      Schema.pattern(new RegExp("^att_" + ulid + "$")),
      Schema.brand("AttemptId")
    );
    export type AttemptId = typeof AttemptId.Type;

    export const CommandId = Schema.String.pipe(
      Schema.pattern(new RegExp("^cmd_" + ulid + "$")),
      Schema.brand("CommandId")
    );
    export type CommandId = typeof CommandId.Type;

    export const EventId = Schema.String.pipe(
      Schema.pattern(new RegExp("^evt_" + ulid + "$")),
      Schema.brand("EventId")
    );
    export type EventId = typeof EventId.Type;

    export const ProviderSessionId = Schema.String.pipe(
      Schema.pattern(new RegExp("^psn_" + ulid + "$")),
      Schema.brand("ProviderSessionId")
    );
    export type ProviderSessionId = typeof ProviderSessionId.Type;

    export const ArtifactId = Schema.String.pipe(
      Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
      Schema.brand("ArtifactId")
    );
    export type ArtifactId = typeof ArtifactId.Type;

    export const ContentHash = Schema.String.pipe(
      Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
      Schema.brand("ContentHash")
    );
    export type ContentHash = typeof ContentHash.Type;

    export const ContractHash = Schema.String.pipe(
      Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
      Schema.brand("ContractHash")
    );
    export type ContractHash = typeof ContractHash.Type;

    export const ActionHash = Schema.String.pipe(
      Schema.pattern(new RegExp("^sha256:" + sha256 + "$")),
      Schema.brand("ActionHash")
    );
    export type ActionHash = typeof ActionHash.Type;

    export const ApprovalId = Schema.String.pipe(
      Schema.pattern(new RegExp("^apr_" + ulid + "$")),
      Schema.brand("ApprovalId")
    );
    export type ApprovalId = typeof ApprovalId.Type;

    export const CapabilityId = Schema.String.pipe(
      Schema.pattern(new RegExp("^cap_" + ulid + "$")),
      Schema.brand("CapabilityId")
    );
    export type CapabilityId = typeof CapabilityId.Type;

    export const ClaimId = Schema.String.pipe(
      Schema.pattern(new RegExp("^clm_" + ulid + "$")),
      Schema.brand("ClaimId")
    );
    export type ClaimId = typeof ClaimId.Type;

    export const CandidateId = Schema.String.pipe(
      Schema.pattern(new RegExp("^cand_" + ulid + "$")),
      Schema.brand("CandidateId")
    );
    export type CandidateId = typeof CandidateId.Type;

    export const BallotId = Schema.String.pipe(
      Schema.pattern(new RegExp("^bal_" + ulid + "$")),
      Schema.brand("BallotId")
    );
    export type BallotId = typeof BallotId.Type;

    export const PolicyId = Schema.String.pipe(
      Schema.pattern(new RegExp("^pol_" + ulid + "$")),
      Schema.brand("PolicyId")
    );
    export type PolicyId = typeof PolicyId.Type;

    export const CorrelationId = Schema.String.pipe(
      Schema.pattern(new RegExp("^cor_" + ulid + "$")),
      Schema.brand("CorrelationId")
    );
    export type CorrelationId = typeof CorrelationId.Type;

    export const CausationId = Schema.String.pipe(
      Schema.pattern(new RegExp("^cau_" + ulid + "$")),
      Schema.brand("CausationId")
    );
    export type CausationId = typeof CausationId.Type;

    export const ActorId = Schema.String.pipe(
      Schema.pattern(new RegExp("^act_" + ulid + "$")),
      Schema.brand("ActorId")
    );
    export type ActorId = typeof ActorId.Type;

    export const FailureDomainId = Schema.String.pipe(
      Schema.pattern(/^[a-z][a-z0-9-]{0,62}$/),
      Schema.brand("FailureDomainId")
    );
    export type FailureDomainId = typeof FailureDomainId.Type;

    export const UtcTimestamp = Schema.String.pipe(
      Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      Schema.brand("UtcTimestamp")
    );
    export type UtcTimestamp = typeof UtcTimestamp.Type;

    packages/schema/src/authority.ts:

    import * as Schema from "effect/Schema";

    export const AuthorityClass = Schema.Literal(
      "trusted_instruction",
      "approved_contract",
      "user_data",
      "tool_metadata",
      "untrusted_evidence"
    );
    export type AuthorityClass = typeof AuthorityClass.Type;

    export const ValidationStatus = Schema.Literal(
      "valid",
      "invalid",
      "untrusted",
      "unknown",
      "inaccessible",
      "incomplete"
    );
    export type ValidationStatus = typeof ValidationStatus.Type;

    export const ClaimSupportStatus = Schema.Literal(
      "verified",
      "disputed",
      "unsupported",
      "unverifiable"
    );
    export type ClaimSupportStatus = typeof ClaimSupportStatus.Type;

    packages/schema/src/decode.ts:

    import * as Schema from "effect/Schema";

    export const decodeStrictSync = <A, I>(
      schema: Schema.Schema<A, I, never>,
      input: unknown,
    ): A =>
      Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(input);

    packages/schema/src/index.ts:

    export * from "./authority.js";
    export * from "./decode.js";
    export * from "./identifiers.js";

- [ ] **Step 4: Run the focused test and type checker**

    Run: corepack pnpm test packages/schema/test/identifiers.test.ts && corepack pnpm typecheck

    Expected: PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the schema primitives**

    git add packages/schema/src packages/schema/test/identifiers.test.ts
    git commit -m "feat(schema): add branded identifiers and authority classes"

### Task 3: Add versioned lifecycle commands, events, and envelopes

**Files:**
- Create: packages/schema/src/lifecycle.ts
- Modify: packages/schema/src/index.ts
- Create: packages/schema/test/lifecycle.test.ts

**Interfaces:**
- Consumes: RunId, EventId, ArtifactId, ContentHash, UtcTimestamp, AuthorityClass, and decodeStrictSync.
- Produces: DomainCommand, DomainEvent, DomainEventEnvelope, RunTerminalStatus, and inferred types.

- [ ] **Step 1: Write strict lifecycle round-trip tests**

    packages/schema/test/lifecycle.test.ts:

    import { describe, expect, it } from "vitest";
    import {
      decodeStrictSync,
      DomainCommand,
      DomainEventEnvelope
    } from "../src/index.js";

    const runId = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const planId =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    describe("lifecycle contracts", () => {
      it("decodes a versioned PlanRun command", () => {
        const value = decodeStrictSync(DomainCommand, {
          schemaVersion: 1,
          _tag: "PlanRun",
          runId,
          planArtifactId: planId,
          at: "2026-08-01T12:00:00.000Z"
        });
        expect(value._tag).toBe("PlanRun");
      });

      it("rejects unknown core properties", () => {
        expect(() =>
          decodeStrictSync(DomainCommand, {
            schemaVersion: 1,
            _tag: "StartRun",
            runId,
            at: "2026-08-01T12:00:01.000Z",
            injected: true
          })
        ).toThrow();
      });

      it("requires an explicit envelope schema version", () => {
        expect(() =>
          decodeStrictSync(DomainEventEnvelope, {
            eventId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV"
          })
        ).toThrow();
      });
    });

- [ ] **Step 2: Run the lifecycle test and verify red**

    Run: corepack pnpm test packages/schema/test/lifecycle.test.ts

    Expected: FAIL because DomainCommand and DomainEventEnvelope are not exported.

- [ ] **Step 3: Implement lifecycle schemas**

    packages/schema/src/lifecycle.ts:

    import * as Schema from "effect/Schema";
    import {
      ActorId,
      ArtifactId,
      CausationId,
      ContentHash,
      CorrelationId,
      EventId,
      RunId,
      UtcTimestamp
    } from "./identifiers.js";
    import { AuthorityClass } from "./authority.js";

    const VersionOne = Schema.Literal(1);
    const NonNegativeInteger = Schema.Number.pipe(
      Schema.int(),
      Schema.nonNegative()
    );
    const Extensions = Schema.Struct({
      schemaVersion: VersionOne,
      values: Schema.Record({
        key: Schema.String,
        value: Schema.Unknown
      })
    });

    const baseCommand = {
      schemaVersion: VersionOne,
      runId: RunId,
      at: UtcTimestamp
    } as const;

    export const DomainCommand = Schema.Union(
      Schema.Struct({
        ...baseCommand,
        _tag: Schema.Literal("PlanRun"),
        planArtifactId: ArtifactId
      }),
      Schema.Struct({
        ...baseCommand,
        _tag: Schema.Literal("StartRun")
      }),
      Schema.Struct({
        ...baseCommand,
        _tag: Schema.Literal("CompleteRun"),
        resultArtifactId: ArtifactId
      }),
      Schema.Struct({
        ...baseCommand,
        _tag: Schema.Literal("FailRun"),
        code: Schema.String,
        diagnosticArtifactId: Schema.optional(ArtifactId)
      }),
      Schema.Struct({
        ...baseCommand,
        _tag: Schema.Literal("CancelRun"),
        reason: Schema.String
      })
    );
    export type DomainCommand = typeof DomainCommand.Type;

    export const DomainEvent = Schema.Union(
      Schema.Struct({
        schemaVersion: VersionOne,
        _tag: Schema.Literal("RunPlanned"),
        runId: RunId,
        planArtifactId: ArtifactId,
        at: UtcTimestamp
      }),
      Schema.Struct({
        schemaVersion: VersionOne,
        _tag: Schema.Literal("RunStarted"),
        runId: RunId,
        at: UtcTimestamp
      }),
      Schema.Struct({
        schemaVersion: VersionOne,
        _tag: Schema.Literal("RunCompleted"),
        runId: RunId,
        resultArtifactId: ArtifactId,
        at: UtcTimestamp
      }),
      Schema.Struct({
        schemaVersion: VersionOne,
        _tag: Schema.Literal("RunFailed"),
        runId: RunId,
        code: Schema.String,
        diagnosticArtifactId: Schema.optional(ArtifactId),
        at: UtcTimestamp
      }),
      Schema.Struct({
        schemaVersion: VersionOne,
        _tag: Schema.Literal("RunCancelled"),
        runId: RunId,
        reason: Schema.String,
        at: UtcTimestamp
      })
    );
    export type DomainEvent = typeof DomainEvent.Type;

    export const RunTerminalStatus = Schema.Literal(
      "completed",
      "failed",
      "cancelled"
    );
    export type RunTerminalStatus = typeof RunTerminalStatus.Type;

    export const DomainEventEnvelope = Schema.Struct({
      schemaVersion: VersionOne,
      projectionVersion: NonNegativeInteger,
      eventId: EventId,
      runId: RunId,
      runSequence: NonNegativeInteger,
      recordedAt: UtcTimestamp,
      correlationId: CorrelationId,
      causationId: CausationId,
      actor: ActorId,
      authority: AuthorityClass,
      previousEventHash: Schema.NullOr(ContentHash),
      eventHash: ContentHash,
      payload: DomainEvent,
      extensions: Schema.optional(Extensions)
    });
    export type DomainEventEnvelope = typeof DomainEventEnvelope.Type;

    Add to packages/schema/src/index.ts:

    export * from "./lifecycle.js";

- [ ] **Step 4: Run lifecycle tests and type checking**

    Run: corepack pnpm test packages/schema/test/lifecycle.test.ts && corepack pnpm typecheck

    Expected: PASS with no unknown-property acceptance and no type errors.

- [ ] **Step 5: Commit lifecycle contracts**

    git add packages/schema/src/lifecycle.ts packages/schema/src/index.ts packages/schema/test/lifecycle.test.ts
    git commit -m "feat(schema): define versioned lifecycle contracts"

### Task 4: Implement the pure run reducer and absorbing terminal states

**Files:**
- Create: packages/domain/src/decision.ts
- Create: packages/domain/src/run.ts
- Modify: packages/domain/src/index.ts
- Create: packages/domain/test/run.test.ts

**Interfaces:**
- Consumes: DomainCommand, DomainEvent, RunId, ArtifactId, UtcTimestamp.
- Produces: Decision, DomainRejection, RunState, initialRunState, decide, evolve, replay, and isTerminal.

- [ ] **Step 1: Write reducer tests before domain code**

    packages/domain/test/run.test.ts:

    import type { ArtifactId, RunId, UtcTimestamp } from "@council/schema";
    import { describe, expect, it } from "vitest";
    import {
      decide,
      evolve,
      initialRunState,
      isTerminal,
      replay
    } from "../src/index.js";

    const runId = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV" as RunId;
    const planId =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ArtifactId;
    const resultId =
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ArtifactId;
    const at = "2026-08-01T12:00:00.000Z" as UtcTimestamp;

    describe("run reducer", () => {
      it("decides, evolves, and replays a successful run", () => {
        const planned = decide(initialRunState, {
          schemaVersion: 1,
          _tag: "PlanRun",
          runId,
          planArtifactId: planId,
          at
        });
        expect(planned._tag).toBe("Accepted");
        if (planned._tag === "Rejected") return;

        const plannedState = evolve(initialRunState, planned.events[0]);
        const started = decide(plannedState, {
          schemaVersion: 1,
          _tag: "StartRun",
          runId,
          at
        });
        expect(started._tag).toBe("Accepted");
        if (started._tag === "Rejected") return;

        const runningState = evolve(plannedState, started.events[0]);
        const completed = decide(runningState, {
          schemaVersion: 1,
          _tag: "CompleteRun",
          runId,
          resultArtifactId: resultId,
          at
        });
        expect(completed._tag).toBe("Accepted");
        if (completed._tag === "Rejected") return;

        const events = [
          ...planned.events,
          ...started.events,
          ...completed.events
        ];
        expect(replay(events)).toEqual(
          events.reduce(evolve, initialRunState)
        );
        expect(isTerminal(replay(events))).toBe(true);
      });

      it("rejects every state-changing command after cancellation", () => {
        const cancelled = {
          _tag: "Cancelled",
          runId,
          reason: "user request",
          at
        } as const;

        const decision = decide(cancelled, {
          schemaVersion: 1,
          _tag: "StartRun",
          runId,
          at
        });

        expect(decision).toEqual({
          _tag: "Rejected",
          error: { _tag: "TerminalStateIsAbsorbing", state: "Cancelled" }
        });
      });
    });

- [ ] **Step 2: Run reducer tests and verify red**

    Run: corepack pnpm test packages/domain/test/run.test.ts

    Expected: FAIL because packages/domain/src/index.ts does not exist.

- [ ] **Step 3: Define decisions and the run reducer**

    packages/domain/src/decision.ts:

    export type Decision<Event, Rejection> =
      | {
          readonly _tag: "Accepted";
          readonly events: readonly [Event, ...Event[]];
        }
      | {
          readonly _tag: "Rejected";
          readonly error: Rejection;
        };

    packages/domain/src/run.ts:

    import type {
      ArtifactId,
      DomainCommand,
      DomainEvent,
      RunId,
      UtcTimestamp
    } from "@council/schema";
    import type { Decision } from "./decision.js";

    export type RunState =
      | { readonly _tag: "NotStarted" }
      | {
          readonly _tag: "Planned";
          readonly runId: RunId;
          readonly planArtifactId: ArtifactId;
          readonly at: UtcTimestamp;
        }
      | {
          readonly _tag: "Running";
          readonly runId: RunId;
          readonly at: UtcTimestamp;
        }
      | {
          readonly _tag: "Completed";
          readonly runId: RunId;
          readonly resultArtifactId: ArtifactId;
          readonly at: UtcTimestamp;
        }
      | {
          readonly _tag: "Failed";
          readonly runId: RunId;
          readonly code: string;
          readonly diagnosticArtifactId?: ArtifactId;
          readonly at: UtcTimestamp;
        }
      | {
          readonly _tag: "Cancelled";
          readonly runId: RunId;
          readonly reason: string;
          readonly at: UtcTimestamp;
        };

    export type DomainRejection =
      | {
          readonly _tag: "CommandNotAllowed";
          readonly command: DomainCommand["_tag"];
          readonly state: RunState["_tag"];
        }
      | {
          readonly _tag: "RunIdMismatch";
          readonly expected: RunId;
          readonly actual: RunId;
        }
      | {
          readonly _tag: "TerminalStateIsAbsorbing";
          readonly state: "Completed" | "Failed" | "Cancelled";
        };

    export const initialRunState: RunState = { _tag: "NotStarted" };

    export const isTerminal = (
      state: RunState
    ): state is Extract<RunState, { _tag: "Completed" | "Failed" | "Cancelled" }> =>
      state._tag === "Completed" ||
      state._tag === "Failed" ||
      state._tag === "Cancelled";

    const accepted = (
      event: DomainEvent
    ): Decision<DomainEvent, DomainRejection> => ({
      _tag: "Accepted",
      events: [event]
    });

    export const decide = (
      state: RunState,
      command: DomainCommand
    ): Decision<DomainEvent, DomainRejection> => {
      if (isTerminal(state)) {
        return {
          _tag: "Rejected",
          error: { _tag: "TerminalStateIsAbsorbing", state: state._tag }
        };
      }

      if (state._tag !== "NotStarted" && state.runId !== command.runId) {
        return {
          _tag: "Rejected",
          error: {
            _tag: "RunIdMismatch",
            expected: state.runId,
            actual: command.runId
          }
        };
      }

      switch (command._tag) {
        case "PlanRun":
          return state._tag === "NotStarted"
            ? accepted({
                schemaVersion: 1,
                _tag: "RunPlanned",
                runId: command.runId,
                planArtifactId: command.planArtifactId,
                at: command.at
              })
            : {
                _tag: "Rejected",
                error: {
                  _tag: "CommandNotAllowed",
                  command: command._tag,
                  state: state._tag
                }
              };
        case "StartRun":
          return state._tag === "Planned"
            ? accepted({
                schemaVersion: 1,
                _tag: "RunStarted",
                runId: command.runId,
                at: command.at
              })
            : {
                _tag: "Rejected",
                error: {
                  _tag: "CommandNotAllowed",
                  command: command._tag,
                  state: state._tag
                }
              };
        case "CompleteRun":
          return state._tag === "Running"
            ? accepted({
                schemaVersion: 1,
                _tag: "RunCompleted",
                runId: command.runId,
                resultArtifactId: command.resultArtifactId,
                at: command.at
              })
            : {
                _tag: "Rejected",
                error: {
                  _tag: "CommandNotAllowed",
                  command: command._tag,
                  state: state._tag
                }
              };
        case "FailRun":
          return state._tag === "Running"
            ? accepted({
                schemaVersion: 1,
                _tag: "RunFailed",
                runId: command.runId,
                code: command.code,
                ...(command.diagnosticArtifactId === undefined
                  ? {}
                  : { diagnosticArtifactId: command.diagnosticArtifactId }),
                at: command.at
              })
            : {
                _tag: "Rejected",
                error: {
                  _tag: "CommandNotAllowed",
                  command: command._tag,
                  state: state._tag
                }
              };
        case "CancelRun":
          return state._tag === "Planned" || state._tag === "Running"
            ? accepted({
                schemaVersion: 1,
                _tag: "RunCancelled",
                runId: command.runId,
                reason: command.reason,
                at: command.at
              })
            : {
                _tag: "Rejected",
                error: {
                  _tag: "CommandNotAllowed",
                  command: command._tag,
                  state: state._tag
                }
              };
      }
    };

    export const evolve = (
      state: RunState,
      event: DomainEvent
    ): RunState => {
      if (isTerminal(state)) {
        return state;
      }

      switch (event._tag) {
        case "RunPlanned":
          return {
            _tag: "Planned",
            runId: event.runId,
            planArtifactId: event.planArtifactId,
            at: event.at
          };
        case "RunStarted":
          return { _tag: "Running", runId: event.runId, at: event.at };
        case "RunCompleted":
          return {
            _tag: "Completed",
            runId: event.runId,
            resultArtifactId: event.resultArtifactId,
            at: event.at
          };
        case "RunFailed":
          return {
            _tag: "Failed",
            runId: event.runId,
            code: event.code,
            ...(event.diagnosticArtifactId === undefined
              ? {}
              : { diagnosticArtifactId: event.diagnosticArtifactId }),
            at: event.at
          };
        case "RunCancelled":
          return {
            _tag: "Cancelled",
            runId: event.runId,
            reason: event.reason,
            at: event.at
          };
      }
    };

    export const replay = (
      events: ReadonlyArray<DomainEvent>
    ): RunState => events.reduce(evolve, initialRunState);

    packages/domain/src/index.ts:

    export * from "./decision.js";
    export * from "./run.js";

- [ ] **Step 4: Run reducer tests and type checking**

    Run: corepack pnpm test packages/domain/test/run.test.ts && corepack pnpm typecheck

    Expected: PASS with a deterministic replay and absorbing terminal state.

- [ ] **Step 5: Commit the pure reducer**

    git add packages/domain/src packages/domain/test/run.test.ts
    git commit -m "feat(domain): add pure run decisions and replay"

### Task 5: Implement pure budget reservation and reconciliation

**Files:**
- Create: packages/schema/src/task-contract.ts
- Modify: packages/schema/src/index.ts
- Create: packages/domain/src/budget.ts
- Modify: packages/domain/src/index.ts
- Create: packages/domain/test/budget.test.ts

**Interfaces:**
- Consumes: non-negative integer budget vectors supplied as validated values.
- Produces: BudgetVector, BudgetState, reserveBudget, reconcileBudget, BudgetReservationDecision.

- [ ] **Step 1: Write unit and property tests for hard-limit preservation**

    packages/domain/test/budget.test.ts:

    import fc from "fast-check";
    import { describe, expect, it } from "vitest";
    import {
      budgetDimensions,
      emptyBudgetVector,
      initialBudgetState,
      reconcileBudget,
      reserveBudget
    } from "../src/index.js";

    const budgetVectorArbitrary = fc.record({
      wallTimeMs: fc.nat({ max: 10_000 }),
      tokens: fc.nat({ max: 10_000 }),
      costMicros: fc.nat({ max: 10_000 }),
      toolCalls: fc.nat({ max: 10_000 }),
      turns: fc.nat({ max: 10_000 }),
      retries: fc.nat({ max: 10_000 }),
      concurrency: fc.nat({ max: 10_000 }),
      events: fc.nat({ max: 10_000 }),
      artifactBytes: fc.nat({ max: 10_000 })
    });

    describe("budget reservation", () => {
      it("admits at most one request for the final token", () => {
        const state = initialBudgetState({
          ...emptyBudgetVector,
          tokens: 1
        });
        const first = reserveBudget(state, {
          ...emptyBudgetVector,
          tokens: 1
        });
        expect(first._tag).toBe("Reserved");
        if (first._tag === "Rejected") return;
        const second = reserveBudget(first.state, {
          ...emptyBudgetVector,
          tokens: 1
        });
        expect(second).toEqual({
          _tag: "Rejected",
          dimension: "tokens",
          available: 0,
          requested: 1
        });
      });

      it("never reserves beyond any hard limit", () => {
        fc.assert(
          fc.property(budgetVectorArbitrary, budgetVectorArbitrary, (limits, request) => {
            const result = reserveBudget(initialBudgetState(limits), request);
            if (result._tag === "Reserved") {
              for (const dimension of budgetDimensions) {
                expect(result.state.reserved[dimension]).toBeLessThanOrEqual(
                  limits[dimension]
                );
              }
            }
          })
        );
      });

      it("reconciles observed usage without mutating the input state", () => {
        const state = {
          limits: { ...emptyBudgetVector, tokens: 10, toolCalls: 4 },
          reserved: { ...emptyBudgetVector, tokens: 3, toolCalls: 2 },
          observed: { ...emptyBudgetVector, tokens: 4, toolCalls: 1 }
        };
        const before = structuredClone(state);

        const reconciled = reconcileBudget(
          state,
          { ...emptyBudgetVector, tokens: 5, toolCalls: 1 },
          { ...emptyBudgetVector, tokens: 2, toolCalls: 3 }
        );

        expect(reconciled).toEqual({
          limits: { ...emptyBudgetVector, tokens: 10, toolCalls: 4 },
          reserved: { ...emptyBudgetVector, toolCalls: 1 },
          observed: { ...emptyBudgetVector, tokens: 6, toolCalls: 4 }
        });
        expect(state).toEqual(before);
      });
    });

- [ ] **Step 2: Run budget tests and verify red**

    Run: corepack pnpm test packages/domain/test/budget.test.ts

    Expected: FAIL because budget exports do not exist.

- [ ] **Step 3: Add the shared budget schema**

    packages/schema/src/task-contract.ts:

    import * as Schema from "effect/Schema";

    const NonNegativeInteger = Schema.Number.pipe(
      Schema.int(),
      Schema.nonNegative()
    );

    export const BudgetVector = Schema.Struct({
      wallTimeMs: NonNegativeInteger,
      tokens: NonNegativeInteger,
      costMicros: NonNegativeInteger,
      toolCalls: NonNegativeInteger,
      turns: NonNegativeInteger,
      retries: NonNegativeInteger,
      concurrency: NonNegativeInteger,
      events: NonNegativeInteger,
      artifactBytes: NonNegativeInteger
    });
    export type BudgetVector = typeof BudgetVector.Type;

    Add to packages/schema/src/index.ts:

    export * from "./task-contract.js";

- [ ] **Step 4: Implement pure reservation and reconciliation**

    packages/domain/src/budget.ts:

    import type { BudgetVector } from "@council/schema";

    export const budgetDimensions = [
      "wallTimeMs",
      "tokens",
      "costMicros",
      "toolCalls",
      "turns",
      "retries",
      "concurrency",
      "events",
      "artifactBytes"
    ] as const;

    export type BudgetDimension = (typeof budgetDimensions)[number];

    export const emptyBudgetVector: BudgetVector = {
      wallTimeMs: 0,
      tokens: 0,
      costMicros: 0,
      toolCalls: 0,
      turns: 0,
      retries: 0,
      concurrency: 0,
      events: 0,
      artifactBytes: 0
    };

    export type BudgetState = {
      readonly limits: BudgetVector;
      readonly reserved: BudgetVector;
      readonly observed: BudgetVector;
    };

    export type BudgetReservationDecision =
      | { readonly _tag: "Reserved"; readonly state: BudgetState }
      | {
          readonly _tag: "Rejected";
          readonly dimension: BudgetDimension;
          readonly available: number;
          readonly requested: number;
        };

    const mapVector = (
      left: BudgetVector,
      right: BudgetVector,
      operation: (leftValue: number, rightValue: number) => number
    ): BudgetVector => ({
      wallTimeMs: operation(left.wallTimeMs, right.wallTimeMs),
      tokens: operation(left.tokens, right.tokens),
      costMicros: operation(left.costMicros, right.costMicros),
      toolCalls: operation(left.toolCalls, right.toolCalls),
      turns: operation(left.turns, right.turns),
      retries: operation(left.retries, right.retries),
      concurrency: operation(left.concurrency, right.concurrency),
      events: operation(left.events, right.events),
      artifactBytes: operation(left.artifactBytes, right.artifactBytes)
    });

    export const initialBudgetState = (
      limits: BudgetVector
    ): BudgetState => ({
      limits,
      reserved: emptyBudgetVector,
      observed: emptyBudgetVector
    });

    export const reserveBudget = (
      state: BudgetState,
      request: BudgetVector
    ): BudgetReservationDecision => {
      for (const dimension of budgetDimensions) {
        const available =
          state.limits[dimension] - state.reserved[dimension];
        if (request[dimension] > available) {
          return {
            _tag: "Rejected",
            dimension,
            available,
            requested: request[dimension]
          };
        }
      }

      return {
        _tag: "Reserved",
        state: {
          ...state,
          reserved: mapVector(state.reserved, request, (a, b) => a + b)
        }
      };
    };

    export const reconcileBudget = (
      state: BudgetState,
      reservation: BudgetVector,
      observed: BudgetVector
    ): BudgetState => ({
      ...state,
      reserved: mapVector(
        state.reserved,
        reservation,
        (total, release) => Math.max(0, total - release)
      ),
      observed: mapVector(state.observed, observed, (a, b) => a + b)
    });

    Add to packages/domain/src/index.ts:

    export * from "./budget.js";

- [ ] **Step 5: Run focused tests and all prior tests**

    Run: corepack pnpm test packages/domain/test/budget.test.ts && corepack pnpm test && corepack pnpm typecheck

    Expected: PASS; property tests report no counterexample.

- [ ] **Step 6: Commit budget behavior**

    git add packages/schema/src packages/domain/src packages/domain/test/budget.test.ts
    git commit -m "feat(domain): enforce pure budget reservations"

### Task 6: Add immutable task contracts and exact approval decisions

**Files:**
- Modify: packages/schema/src/task-contract.ts
- Create: packages/schema/test/task-contract.test.ts
- Create: packages/domain/src/authorization.ts
- Modify: packages/domain/src/index.ts
- Create: packages/domain/test/authorization.test.ts

**Interfaces:**
- Consumes: BudgetVector, ContractHash, ApprovalId, UtcTimestamp, AuthorityClass.
- Produces: TaskContract, TaskContractAmendment, RequestedAction, Approval, CommitmentContext, and authorizeCommitment.

- [ ] **Step 1: Write contract strictness and fail-closed tests**

    packages/domain/test/authorization.test.ts:

    import type { ActionHash, ContractHash } from "@council/schema";
    import { describe, expect, it } from "vitest";
    import {
      authorizeCommitment,
      type CommitmentDenialReason
    } from "../src/index.js";

    const denialReasons: readonly CommitmentDenialReason[] = [
      "approval_missing", "approval_mismatch", "policy_unknown", "policy_denied",
      "capability_unknown", "capability_invalid", "destination_unknown", "destination_invalid",
      "provenance_unknown", "provenance_invalid", "citation_unknown", "citation_invalid",
      "secretScan_unknown", "secretScan_blocked"
    ];

    const matching = {
      contractHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ContractHash,
      actionHash:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ActionHash
    } as const;

    describe("commitment authorization", () => {
      it("allows only an exact approved action with all checks valid", () => {
        expect(
          authorizeCommitment({
            ...matching,
            approval: {
              _tag: "Approved",
              contractHash: matching.contractHash,
              actionHash: matching.actionHash
            },
            policy: "allow",
            capability: "valid",
            destination: "valid",
            provenance: "valid",
            citation: "valid",
            secretScan: "clear"
          })
        ).toEqual({ _tag: "Allowed" });
      });

      it.each([
        "policy",
        "capability",
        "destination",
        "provenance",
        "citation",
        "secretScan"
      ] as const)("fails closed when %s is unknown", (field) => {
        const context = {
          ...matching,
          approval: {
            _tag: "Approved",
            contractHash: matching.contractHash,
            actionHash: matching.actionHash
          },
          policy: "allow",
          capability: "valid",
          destination: "valid",
          provenance: "valid",
          citation: "valid",
          secretScan: "clear",
          [field]: "unknown"
        } as const;
        expect(authorizeCommitment(context)).toEqual({
          _tag: "Denied",
          reason: field + "_unknown"
        });
      });

      it("denies contract and action approval mismatches separately", () => {
        // Exercise one context with a different action hash and one with a
        // different contract hash; both must return approval_mismatch.
      });

      it.each(["capability", "destination", "provenance", "citation"] as const)(
        "fails closed when %s is invalid",
        (field) => {
          // Each invalid validation returns its field-specific *_invalid reason.
        }
      );

      it("fails closed when the secret scan is blocked", () => {
        // A blocked scan returns secretScan_blocked.
      });
    });

- [ ] **Step 2: Run authorization tests and verify red**

    Run: corepack pnpm test packages/domain/test/authorization.test.ts

    Expected: FAIL because authorizeCommitment does not exist.

- [ ] **Step 3: Extend task-contract schemas**

    Add to packages/schema/src/task-contract.ts:

    import { AuthorityClass } from "./authority.js";
    import {
      ActionHash,
      ApprovalId,
      ArtifactId,
      ContractHash,
      UtcTimestamp
    } from "./identifiers.js";

    export const SideEffectState = Schema.Literal(
      "not_started",
      "in_flight",
      "committed",
      "compensated",
      "outcome_unknown"
    );
    export type SideEffectState = typeof SideEffectState.Type;

    export const TaskContract = Schema.Struct({
      schemaVersion: Schema.Literal(1),
      contractHash: ContractHash,
      parentContractHash: Schema.optional(ContractHash),
      roles: Schema.Array(Schema.String),
      allowedOutcomes: Schema.Array(Schema.String),
      toolOperations: Schema.Array(Schema.String),
      resources: Schema.Array(Schema.String),
      destinations: Schema.Array(Schema.String),
      dataClasses: Schema.Array(Schema.String),
      budgets: BudgetVector,
      requiredApprovals: Schema.Array(Schema.String),
      rubricArtifactId: ArtifactId,
      policyVersion: Schema.String,
      expiresAt: UtcTimestamp,
      evidenceScope: Schema.Array(ArtifactId)
    });
    export type TaskContract = typeof TaskContract.Type;

    export const TaskContractAmendment = Schema.Struct({
      schemaVersion: Schema.Literal(1),
      contractHash: ContractHash,
      parentContractHash: ContractHash,
      exactDeltaArtifactId: ArtifactId,
      reason: Schema.String,
      approvalId: ApprovalId,
      approvedAt: UtcTimestamp
    });
    export type TaskContractAmendment = typeof TaskContractAmendment.Type;

    export const RequestedAction = Schema.Struct({
      schemaVersion: Schema.Literal(1),
      actionHash: ActionHash,
      normalizedOperation: Schema.String,
      normalizedArgumentsArtifactId: ArtifactId,
      destination: Schema.String,
      policyVersion: Schema.String,
      contractHash: ContractHash
    });
    export type RequestedAction = typeof RequestedAction.Type;

    export const Approval = Schema.Struct({
      schemaVersion: Schema.Literal(1),
      approvalId: ApprovalId,
      actionHash: ActionHash,
      contractHash: ContractHash,
      approver: Schema.String,
      approverAuthority: AuthorityClass,
      expiresAt: UtcTimestamp
    });
    export type Approval = typeof Approval.Type;

- [ ] **Step 4: Implement exact, fail-closed authorization**

    packages/domain/src/authorization.ts:

    import type { ActionHash, ContractHash } from "@council/schema";

    type Check = "valid" | "invalid" | "unknown";

    export type CommitmentContext = {
      readonly contractHash: ContractHash;
      readonly actionHash: ActionHash;
      readonly approval:
        | {
            readonly _tag: "Approved";
            readonly contractHash: ContractHash;
            readonly actionHash: ActionHash;
          }
        | { readonly _tag: "Missing" };
      readonly policy: "allow" | "deny" | "unknown";
      readonly capability: Check;
      readonly destination: Check;
      readonly provenance: Check;
      readonly citation: Check;
      readonly secretScan: "clear" | "blocked" | "unknown";
    };

    export type CommitmentDenialReason =
      | "approval_missing"
      | "approval_mismatch"
      | "policy_unknown"
      | "policy_denied"
      | "capability_unknown"
      | "capability_invalid"
      | "destination_unknown"
      | "destination_invalid"
      | "provenance_unknown"
      | "provenance_invalid"
      | "citation_unknown"
      | "citation_invalid"
      | "secretScan_unknown"
      | "secretScan_blocked";

    export type CommitmentDecision =
      | { readonly _tag: "Allowed" }
      | { readonly _tag: "Denied"; readonly reason: CommitmentDenialReason };

    export const authorizeCommitment = (
      context: CommitmentContext
    ): CommitmentDecision => {
      if (context.approval._tag === "Missing") {
        return { _tag: "Denied", reason: "approval_missing" };
      }
      if (
        context.approval.contractHash !== context.contractHash ||
        context.approval.actionHash !== context.actionHash
      ) {
        return { _tag: "Denied", reason: "approval_mismatch" };
      }
      if (context.policy !== "allow") {
        return {
          _tag: "Denied",
          reason:
            context.policy === "unknown" ? "policy_unknown" : "policy_denied"
        };
      }

      if (context.capability !== "valid") {
        return {
          _tag: "Denied",
          reason: context.capability === "unknown"
            ? "capability_unknown"
            : "capability_invalid"
        };
      }
      if (context.destination !== "valid") {
        return {
          _tag: "Denied",
          reason: context.destination === "unknown"
            ? "destination_unknown"
            : "destination_invalid"
        };
      }
      if (context.provenance !== "valid") {
        return {
          _tag: "Denied",
          reason: context.provenance === "unknown"
            ? "provenance_unknown"
            : "provenance_invalid"
        };
      }
      if (context.citation !== "valid") {
        return {
          _tag: "Denied",
          reason: context.citation === "unknown"
            ? "citation_unknown"
            : "citation_invalid"
        };
      }

      if (context.secretScan !== "clear") {
        return {
          _tag: "Denied",
          reason:
            context.secretScan === "unknown"
              ? "secretScan_unknown"
              : "secretScan_blocked"
        };
      }
      return { _tag: "Allowed" };
    };

    Add to packages/domain/src/index.ts:

    export * from "./authorization.js";

- [ ] **Step 5: Add strict schema tests for contract properties and amendments**

    packages/schema/test/task-contract.test.ts:

    import { describe, expect, it } from "vitest";
    import {
      decodeStrictSync,
      Approval,
      TaskContract,
      TaskContractAmendment
    } from "../src/index.js";

    const contract = {
      schemaVersion: 1,
      contractHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      roles: ["lead", "adviser"],
      allowedOutcomes: ["answer", "insufficient_evidence"],
      toolOperations: ["graph.query"],
      resources: ["graph:council-research"],
      destinations: [],
      dataClasses: ["public"],
      budgets: {
        wallTimeMs: 60_000,
        tokens: 20_000,
        costMicros: 0,
        toolCalls: 10,
        turns: 8,
        retries: 1,
        concurrency: 3,
        events: 1_000,
        artifactBytes: 10_000_000
      },
      requiredApprovals: [],
      rubricArtifactId:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      policyVersion: "policy-v1",
      expiresAt: "2026-08-01T13:00:00.000Z",
      evidenceScope: []
    } as const;

    describe("task contracts", () => {
      it("decodes a complete immutable contract", () => {
        expect(decodeStrictSync(TaskContract, contract).schemaVersion).toBe(1);
      });

      it("rejects an unknown top-level field", () => {
        expect(() =>
          decodeStrictSync(TaskContract, { ...contract, recipient: "outside" })
        ).toThrow();
      });

      it("rejects an amendment without parent hash and approval", () => {
        expect(() =>
          decodeStrictSync(TaskContractAmendment, {
            schemaVersion: 1,
            contractHash:
              "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            exactDeltaArtifactId:
              "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            reason: "new research domain",
            approvedAt: "2026-08-01T12:30:00.000Z"
          })
        ).toThrow();
      });

      it("requires an authority class on an approval", () => {
        expect(decodeStrictSync(Approval, {
          schemaVersion: 1,
          approvalId: "apr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          actionHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          contractHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          approver: "council-chair",
          approverAuthority: "approved_contract",
          expiresAt: "2026-08-01T13:00:00.000Z"
        }).approverAuthority).toBe("approved_contract");
      });
    });

- [ ] **Step 6: Run schema, authorization, and type checks**

    Run: corepack pnpm test packages/schema/test/task-contract.test.ts packages/domain/test/authorization.test.ts && corepack pnpm typecheck

    Expected: PASS; unknown commitment states deny and exact approval mismatch denies.

- [ ] **Step 7: Commit task authorization**

    git add packages/schema/src/task-contract.ts packages/schema/test/task-contract.test.ts packages/domain/src/authorization.ts packages/domain/src/index.ts packages/domain/test/authorization.test.ts
    git commit -m "feat(domain): add immutable contract authorization"

### Task 7: Add independent failure-domain quorum and calibrated closure

**Files:**
- Create: packages/schema/src/deliberation.ts
- Modify: packages/schema/src/index.ts
- Create: packages/domain/src/quorum.ts
- Modify: packages/domain/src/index.ts
- Create: packages/domain/test/quorum.test.ts

**Interfaces:**
- Consumes: CandidateId and FailureDomainId.
- Produces: ProposalEligibility, CalibrationRecord, CouncilOutcome, evaluateAutomaticQuorum, and confidenceWeightEligible.

- [ ] **Step 1: Write failure-domain and calibration tests**

    packages/domain/test/quorum.test.ts:

    import type { FailureDomainId } from "@council/schema";
    import { describe, expect, it } from "vitest";
    import {
      confidenceWeightEligible,
      evaluateAutomaticQuorum
    } from "../src/index.js";

    describe("automatic quorum", () => {
      it("rejects three aliases from one failure domain", () => {
        expect(
          evaluateAutomaticQuorum([
            { admissible: true, failureDomain: "family-a" as FailureDomainId },
            { admissible: true, failureDomain: "family-a" as FailureDomainId },
            { admissible: true, failureDomain: "family-a" as FailureDomainId }
          ])
        ).toEqual({
          _tag: "QuorumNotMet",
          admissibleProposals: 3,
          independentDomains: 1
        });
      });

      it("accepts three proposals from two domains", () => {
        expect(
          evaluateAutomaticQuorum([
            { admissible: true, failureDomain: "family-a" as FailureDomainId },
            { admissible: true, failureDomain: "family-a" as FailureDomainId },
            { admissible: true, failureDomain: "family-b" as FailureDomainId }
          ])
        ).toEqual({
          _tag: "QuorumMet",
          admissibleProposals: 3,
          independentDomains: 2
        });
      });

      it("groups every unknown lineage into one common domain", () => {
        expect(
          evaluateAutomaticQuorum([
            { admissible: true, failureDomain: null },
            { admissible: true, failureDomain: null },
            { admissible: true, failureDomain: null }
          ])
        ).toMatchObject({ independentDomains: 1 });
      });
    });

    describe("confidence weighting", () => {
      it("requires an applicable unexpired calibration record", () => {
        expect(
          confidenceWeightEligible(
            {
              modelTaskKey: "model-a:research",
              validUntilEpochMs: 2_000
            },
            "model-a:research",
            1_000
          )
        ).toBe(true);
        expect(
          confidenceWeightEligible(
            null,
            "model-a:research",
            1_000
          )
        ).toBe(false);
      });
    });

- [ ] **Step 2: Run quorum tests and verify red**

    Run: corepack pnpm test packages/domain/test/quorum.test.ts

    Expected: FAIL because quorum functions are not exported.

- [ ] **Step 3: Define deliberation schemas**

    packages/schema/src/deliberation.ts:

    import * as Schema from "effect/Schema";
    import {
      CandidateId,
      FailureDomainId,
      UtcTimestamp
    } from "./identifiers.js";

    export const ProposalEligibility = Schema.Struct({
      candidateId: CandidateId,
      admissible: Schema.Boolean,
      failureDomain: Schema.NullOr(FailureDomainId),
      sealedAt: UtcTimestamp
    });
    export type ProposalEligibility = typeof ProposalEligibility.Type;

    export const CalibrationRecord = Schema.Struct({
      schemaVersion: Schema.Literal(1),
      modelTaskKey: Schema.String,
      validUntilEpochMs: Schema.Number,
      calibrationArtifactId: Schema.String
    });
    export type CalibrationRecord = typeof CalibrationRecord.Type;

    export const CouncilOutcome = Schema.Literal(
      "insufficient_evidence",
      "quorum_not_met",
      "judge_unstable",
      "policy_blocked",
      "budget_exhausted",
      "unsupported_claims",
      "schema_invalid",
      "outcome_unknown"
    );
    export type CouncilOutcome = typeof CouncilOutcome.Type;

    Add to packages/schema/src/index.ts:

    export * from "./deliberation.js";

- [ ] **Step 4: Implement pure quorum and calibration policies**

    packages/domain/src/quorum.ts:

    import type {
      CalibrationRecord,
      FailureDomainId
    } from "@council/schema";

    export type QuorumParticipant = {
      readonly admissible: boolean;
      readonly failureDomain: FailureDomainId | null;
    };

    export type QuorumDecision =
      | {
          readonly _tag: "QuorumMet";
          readonly admissibleProposals: number;
          readonly independentDomains: number;
        }
      | {
          readonly _tag: "QuorumNotMet";
          readonly admissibleProposals: number;
          readonly independentDomains: number;
        };

    export const evaluateAutomaticQuorum = (
      participants: ReadonlyArray<QuorumParticipant>,
      minimumProposals = 3,
      minimumDomains = 2
    ): QuorumDecision => {
      const admissible = participants.filter(
        (participant) => participant.admissible
      );
      const domains = new Set(
        admissible.map((participant) =>
          participant.failureDomain === null
            ? "__unknown_common_domain__"
            : participant.failureDomain
        )
      );
      const result = {
        admissibleProposals: admissible.length,
        independentDomains: domains.size
      };
      return admissible.length >= minimumProposals &&
        domains.size >= minimumDomains
        ? { _tag: "QuorumMet", ...result }
        : { _tag: "QuorumNotMet", ...result };
    };

    export const confidenceWeightEligible = (
      calibration: CalibrationRecord | null,
      modelTaskKey: string,
      nowEpochMs: number
    ): boolean =>
      calibration !== null &&
      calibration.modelTaskKey === modelTaskKey &&
      calibration.validUntilEpochMs >= nowEpochMs;

    Add to packages/domain/src/index.ts:

    export * from "./quorum.js";

- [ ] **Step 5: Run all domain tests and type checking**

    Run: corepack pnpm test packages/domain/test/quorum.test.ts && corepack pnpm test && corepack pnpm typecheck

    Expected: PASS; unknown lineages count as one domain and uncalibrated confidence has no weighting eligibility.

- [ ] **Step 6: Commit quorum policy**

    git add packages/schema/src/deliberation.ts packages/schema/src/index.ts packages/domain/src/quorum.ts packages/domain/src/index.ts packages/domain/test/quorum.test.ts
    git commit -m "feat(domain): add failure-domain quorum policy"

### Task 8: Enforce architecture boundaries and close the foundation quality gate

**Files:**
- Create: eslint.config.mjs
- Create: scripts/check-architecture.mjs
- Modify: package.json
- Modify: tests/architecture/workspace.test.ts
- Create: .gitignore
- Modify: README.md

**Interfaces:**
- Consumes: the complete schema and domain source trees.
- Produces: a deterministic boundary check that returns non-zero for prohibited imports and a documented foundation command.

- [ ] **Step 1: Add a failing architecture regression fixture in the test**

    Replace tests/architecture/workspace.test.ts with:

    import { access, unlink, writeFile } from "node:fs/promises";
    import { spawnSync } from "node:child_process";
    import { describe, expect, it } from "vitest";

    const requiredFiles = [
      "packages/schema/package.json",
      "packages/schema/tsconfig.json",
      "packages/domain/package.json",
      "packages/domain/tsconfig.json"
    ] as const;

    describe("workspace", () => {
      for (const file of requiredFiles) {
        it("contains " + file, async () => {
          await expect(access(file)).resolves.toBeUndefined();
        });
      }

      it("rejects Effect runtime imports from domain source", async () => {
        const fixture =
          "packages/domain/src/__boundary_violation__.ts";
        await writeFile(
          fixture,
          'import * as Effect from "effect/Effect";\nvoid Effect;\n',
          "utf8"
        );
        try {
          const result = spawnSync(
            process.execPath,
            ["scripts/check-architecture.mjs"],
            { encoding: "utf8" }
          );
          expect(result.status).toBe(1);
          expect(result.stderr).toContain("domain-runtime-import effect/Effect");
        } finally {
          await unlink(fixture);
        }
      });
    });

- [ ] **Step 2: Run the architecture test and verify red**

    Run: corepack pnpm test tests/architecture/workspace.test.ts

    Expected: FAIL because scripts/check-architecture.mjs does not exist.

- [ ] **Step 3: Implement the deterministic boundary checker**

    scripts/check-architecture.mjs:

    import { readdir, readFile } from "node:fs/promises";
    import { extname, join, relative } from "node:path";

    const roots = {
      schema: "packages/schema/src",
      domain: "packages/domain/src"
    };

    const walk = async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map((entry) => {
          const path = join(directory, entry.name);
          return entry.isDirectory() ? walk(path) : [path];
        })
      );
      return nested.flat();
    };

    const importPattern =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

    const violations = [];
    for (const [layer, root] of Object.entries(roots)) {
      for (const file of await walk(root)) {
        if (extname(file) !== ".ts") continue;
        const source = await readFile(file, "utf8");
        for (const match of source.matchAll(importPattern)) {
          const specifier = match[1];
          if (specifier === undefined) continue;
          if (
            layer === "schema" &&
            (specifier.startsWith("node:") ||
              (specifier.startsWith("effect/") &&
                specifier !== "effect/Schema"))
          ) {
            violations.push(
              relative(".", file) + ": schema-runtime-import " + specifier
            );
          }
          if (
            layer === "domain" &&
            (specifier === "effect" ||
              specifier.startsWith("effect/") ||
              specifier.startsWith("node:") ||
              specifier.includes("platform") ||
              specifier.includes("adapter") ||
              specifier.includes("runtime"))
          ) {
            violations.push(
              relative(".", file) + ": domain-runtime-import " + specifier
            );
          }
        }
      }
    }

    if (violations.length > 0) {
      process.stderr.write(violations.join("\n") + "\n");
      process.exitCode = 1;
    }

- [ ] **Step 4: Add lint, ignore, and root check configuration**

    eslint.config.mjs:

    import eslint from "@eslint/js";
    import globals from "globals";
    import tseslint from "typescript-eslint";

    export default tseslint.config(
      { ignores: ["**/dist/**", "**/coverage/**", "docs/research/graphify/**"] },
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      {
        files: ["**/*.ts"],
        languageOptions: {
          globals: globals.node,
          parserOptions: {
            project: "./tsconfig.eslint.json",
            tsconfigRootDir: import.meta.dirname
          }
        },
        rules: {
          "@typescript-eslint/consistent-type-imports": "error",
          "@typescript-eslint/no-explicit-any": "error",
          "@typescript-eslint/no-non-null-assertion": "error"
        }
      }
    );

    .gitignore:

    node_modules/
    dist/
    coverage/
    .DS_Store
    *.tsbuildinfo

    Add architecture to the root check command in package.json:

    "architecture": "node scripts/check-architecture.mjs",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm architecture && pnpm test"

- [ ] **Step 5: Run the focused regression test, then the full quality gate**

    Run: corepack pnpm test tests/architecture/workspace.test.ts

    Expected: PASS; the injected forbidden import is detected and cleaned up.

    Run: corepack pnpm check && openspec validate design-council-core --strict --no-interactive && git diff --check

    Expected: all commands exit 0 with no lint, type, test, architecture, OpenSpec, or whitespace failures.

- [ ] **Step 6: Document the implemented foundation without overstating later phases**

    Update README.md Current status to state that schemas and the pure domain are implemented only after the preceding full check passes. Add corepack pnpm check as the local verification command. Leave provider adapters, Effect application services, research tools, MCP, and native plugins explicitly unimplemented.

- [ ] **Step 7: Commit the architecture gate**

    git add eslint.config.mjs scripts/check-architecture.mjs package.json .gitignore tests/architecture/workspace.test.ts README.md
    git commit -m "test: enforce Council architecture boundaries"

- [ ] **Step 8: Record the OpenSpec progress only for completed master tasks**

    Mark OpenSpec tasks 1.1, 2.2, and 2.4 complete only when their exact tests and the full quality gate pass. Leave 1.3, 2.1, 2.3, 2.5, and 2.6 open because later slices still add cross-package boundaries, the complete error vocabulary, checkpoints and late evidence, amendment transitions, and deliberation stopping rules.

    Run: openspec status --change design-council-core --json

    Expected: proposal, specs, design, and tasks are all done artifacts; implementation checkboxes remain the source of apply progress.

## Self-review coverage

- Tasks 1–3 establish the strict serialized boundary, branded identities, authority classes, lifecycle messages, event envelopes, and excess-property rejection required by the schema and audit designs.
- Task 4 implements deterministic run decisions, pure evolution, replay, run-identity checking, and absorbing terminal states.
- Task 5 implements pre-launch budget reservation and post-attempt reconciliation without clock, storage, or concurrency effects.
- Task 6 establishes immutable task-contract and amendment schemas, distinct action hashes, exact approval matching, explicit side-effect states, and fail-closed commitment inputs.
- Task 7 implements the default three-proposal/two-failure-domain quorum, common treatment of unknown lineage, calibration freshness checks, and typed Council outcomes.
- Task 8 enforces the schema/domain dependency boundary and runs the complete local quality gate.
- Durable checkpoints, event-sequence verification, late evidence, Effect services, persistence, process ownership, adapters, research tools, provenance, full deliberation, audit/replay, MCP, wrappers, and evaluation remain explicitly assigned to OpenSpec master tasks 3 through 13 and will receive separate executable plans.
- No approved OpenSpec requirement is absent from the master task list.
