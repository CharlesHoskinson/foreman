# OpenBao lifecycle planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after Task 0 acceptance. Follow the current task authority.

**Goal:** Validate schema 2 envelopes and plan deterministic CAS transitions.

**Architecture:** Pure functions return validated envelopes or CAS write plans. They grant no authorization and perform no storage operations.

**Tech Stack:** Node.js 24, strict TypeScript, Effect Redacted, node:test.

## Global Constraints

- WSL and Linux are both production targets.
- OpenBao is the sole durable authority for managed credentials and lifecycle state.
- No managed fallback to native files, environment credentials, cached material, or another account is permitted.
- Keep credential material out of PEL, model prompts, logs, receipts, command arguments, and the Obsidian vault.
- Preserve concurrent native-login changes. Coordinate ownership before editing shared files.
- Do not make commits without separate authorization.
- No network, token acquisition, filesystem operations, provider calls, installs, host interruptions, dependencies, or runtime updates.

## Task 2A: Envelope validation and transition planning

**Files:** Create only `packages/providers/src/credential-lifecycle.ts` and `packages/providers/src/credential-lifecycle.test.ts`.

**Interfaces:** Export all types and both functions from the production contract Shared types section.
`validateEnvelope(input: unknown, key: AccountKey, metadata: CurrentMetadata): Result<Envelope>` validates a decoded host envelope.
`planTransition(key: AccountKey, current: CurrentObservation, transition: Transition): Result<CasWrite>` validates inputs and returns one CAS plan.
The later managed store must decode wire material into Redacted before calling this function.

- [ ] Add this failing test to the named test file.

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { Redacted } from 'effect';
import { planTransition, validateEnvelope } from './credential-lifecycle.js';
const key = { provider: 'codex', account: 'synthetic' } as const;
const metadata = { currentVersion: 7, deleted: false, destroyed: false, deletionScheduled: false };
const active = { ...key, schemaVersion: 2, generation: 7, state: 'active', material: Redacted.make({ access: 'synthetic-only' }) } as const;
test('remove advances version and erases material from next envelope', () => {
  assert.deepEqual(planTransition(key, { kind: 'present', metadata, envelope: active }, { kind: 'remove', expectedGeneration: 7 }), {
    ok: true, value: { expectedVersion: 7, envelope: { ...key, schemaVersion: 2, generation: 8, state: 'tombstoned' } },
  });
});
test('schema 1 needs explicit migration', () => {
  assert.deepEqual(validateEnvelope({ ...active, schemaVersion: 1 }, key, metadata), {
    ok: false, error: { _tag: 'ManagedFailure', code: 'MigrationRequired' },
  });
});
```

- [ ] Run `node --import tsx --test packages/providers/src/credential-lifecycle.test.ts`.
  Require the absent implementation to cause the initial failure.
- [ ] Implement strict field validation and the four transition cases from the production contract.
  Snapshot valid material into a new frozen string record wrapped with Redacted.
  Reject malformed external values before property use. Return closed failures without input or exception data.
  Revalidate present envelopes during transition planning. Never trust a TypeScript annotation as runtime validation.
  Return `Conflict` for existing import or mismatched generation. Return `Quarantined` for wrong state or corrupt current observations.
  Return `InvalidInput` for malformed keys, transition shapes, supplied material, or expected-generation arguments.
- [ ] Add independent assertions for create-only import, removal, recovery, and refresh commit.
  Cover all providers, tombstone material rejection, mismatched identities, empty material, unknown fields, unsafe generations, and overflow.
  Cover 32 accepted material entries, 33 rejected entries, invalid component keys, and the 64-character key boundary.
  Cover stale recovery, refresh after deletion, deletion schedules, destroyed state, and schema 1 refusal.
  Assert that recovery and refresh require different states even with equal generations.
  Apply the production contract's lifecycle failure precedence.
  Test valid-material import against corrupt current state as `Quarantined` and schema 1 state as `MigrationRequired`.
  Test malformed caller arguments against legacy state as `InvalidInput`.
  Test stale expected generation against valid wrong-state envelopes as `Conflict` before wrong-state refusal.
  Assert unchanged input objects and material snapshot isolation.
  Cover throwing accessors, revoked proxies, symbol fields, inherited fields, and failing Redacted extraction.
  Require closed `InvalidInput` for boundary exceptions without a thrown canary or raw cause.
  These tests cover planned writes only. They do not prove real CAS, crash safety, or provider refresh ownership.
- [ ] Run the focused test command and `npm run typecheck`.
- [ ] Run `git diff --check -- packages/providers/src/credential-lifecycle.ts packages/providers/src/credential-lifecycle.test.ts`.
- [ ] Report red/green evidence and limitations in `.superpowers/sdd/production-task-2a-report.md`.

## Acceptance and handoff

Review pure transitions independently before managed-store integration.
Task 2B must implement fresh metadata/data observations, exact authorization, real CAS, migration, and cross-process tests.
Do not export from the package index in this task. Do not rebuild installed runtime output.
