# Council ACE Prompt Preflight Implementation Plan

> **For agentic workers:** Use test-driven development. Make each behavior fail
> before implementation. Do not run a live provider until all fake-provider and
> fixture tests pass.

**Goal:** Add a Node.js TypeScript preprocessing and model-readiness boundary
that prevents invalid Council prompts and incomplete provider attempts from
becoming advice.

**Architecture:** Effect Schema decodes serialized contracts. Pure domain code
parses and canonicalizes Council ACE Profile 1 and classifies terminal review
attempts. The Effect application shell verifies evidence, compiles prompts, and
runs provider health checks through ports. Node platform code owns hashing,
files, deadlines, and child processes. Provider adapters only translate
arguments, schema dialects, and terminal observations.

**Tech stack:** Node.js 24, TypeScript 7.0.2, Effect 3.22.1, pnpm 11.18.0,
Vitest 4.1.10, and OpenSpec 1.7.0.

## Work package 1: Serialized contracts

**Files:**

- Modify: `packages/schema/src/index.ts`
- Create: `packages/schema/src/prompt-preflight.ts`
- Create: `packages/schema/test/prompt-preflight.test.ts`

1. Add RED tests for strict versioned contract, lexicon, bundle, artifact,
   canary, ready token, terminal observation, response, and result schemas.
2. Implement only the schema needed to pass the tests.
3. Verify strict unknown-field and malformed-identity rejection.

## Work package 2: ACE parser and compiler

**Files:**

- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/ace.ts`
- Create: `packages/domain/test/ace.test.ts`
- Create: `docs/COUNCIL-ACE-PROFILE.md`

1. Add RED table tests for every allowed clause class.
2. Add RED negative tests for fragments, pronouns, anaphora, unknown words,
   missing determiners, wrong tense, coordination, punctuation, and suffixes.
3. Implement a tokenizer and recursive-descent parser with source locations.
4. Implement canonical output and required-rule semantic lint.
5. Document the exact grammar and state that it is a strict ACE subset.

## Work package 3: Terminal-first response admission

**Files:**

- Modify: `packages/domain/src/quorum.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/review-admission.ts`
- Modify: `packages/domain/test/quorum.test.ts`
- Create: `packages/domain/test/review-admission.test.ts`
- Create: `packages/domain/test/fixtures/anthropic-schema-rejected.json`
- Create: `packages/domain/test/fixtures/xai-interim-then-cancelled.json`

1. Reproduce both 2026-08-02 failures as RED fixtures.
2. Prove that terminal cancellation overrides a valid-looking body.
3. Prove that pre-execution schema rejection creates no deliberation outcome.
4. Implement the four-result classifier.
5. Change quorum to accept completed substantive verdict participants only.

## Work package 4: Effect preprocessing service

**Files:**

- Create: `packages/application/package.json`
- Create: `packages/application/tsconfig.json`
- Create: `packages/application/src/ports.ts`
- Create: `packages/application/src/prompt-preflight.ts`
- Create: `packages/application/src/index.ts`
- Create: `packages/application/test/prompt-preflight.test.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.eslint.json`
- Modify: `tests/architecture/workspace.test.ts`

1. Add deterministic fake Layers for artifact reads, hashing, clock, nonce,
   provider health, and token identity.
2. Write RED tests for every preprocessing stop.
3. Implement the Effect pipeline in the documented order.
4. Prove that no provider call occurs after an earlier failure.

## Work package 5: Provider schema and canary adapters

**Files:**

- Create focused `platform-node`, `adapter-claude`, `adapter-gemini`,
  `adapter-grok`, and `runtime-node` package shells.
- Add one `preflight.ts` module and focused tests in each package.

1. Capture local CLI help and sanitized terminal fixtures before coding.
2. Write RED tests for exact executable and argument arrays.
3. Implement provider schema lowering. Claude may remove `$schema`; no adapter
   may weaken required semantic constraints.
4. Implement shell-free, bounded canary execution with stdout and stderr caps.
5. Implement the provider-neutral preflight CLI.

## Work package 6: Operator contract and dogfood

**Files:**

- Modify: `skills/council/SKILL.md`
- Modify: `skills/council/references/protocol.md`
- Modify: `skills/council/references/ownership.md`
- Modify: `components/council/openspec/changes/design-council-core/tasks.md`
- Modify: `components/council/openspec/changes/design-council-core/specs/provider-participation/spec.md`
- Modify: `components/council/openspec/changes/design-council-core/specs/council-deliberation/spec.md`

1. Add the preflight and terminal-first rules to the operator contract.
2. Run the complete local verification gate.
3. Run bounded live canaries for Anthropic, xAI, and Google.
4. Compile the v0.2.9 TypeScript migration-plan prompt through ACE preflight.
5. Run a fresh blinded Council round. Discard every pre-review failure and
   preserve every completed dissent.

## Verification

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm architecture
corepack pnpm test
corepack pnpm exec openspec validate ace-prompt-preflight --strict --no-interactive
corepack pnpm exec openspec validate design-council-core --strict --no-interactive
git diff --check
```

The live canary command must run only after these commands pass. Live output
must be provider-neutral and must not contain credentials or raw home paths.
