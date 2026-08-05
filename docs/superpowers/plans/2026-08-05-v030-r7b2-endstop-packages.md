# R7B2 Endstop Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** Complete profile-bound lane admission without an unbounded review or
correction loop.

**Architecture:** Split R7B2 into four independently accepted packages. Store
one Endstop contract for each package under the external Foreman state root.
Use dependency contracts to block release verification until all product
packages reach `Completed`.

**Tech Stack:** Node.js 24, TypeScript, Effect, Node test runner, Bats, OpenSpec,
and Foreman Endstop.

## Global Constraints

- Write all new product code in TypeScript for Node.js 24.
- Use Effect services for filesystem and process boundaries.
- Do not read vendor credential files.
- Do not authenticate or run a vendor probe.
- Do not add R7C profile-use leasing.
- Do not reuse commit `59ff4b9`.
- Permit one audit, one Council action, and one correction per package.
- Stop a package when Endstop returns a terminal state.

---

### Task 1: R7B2-A admission core

**Files:**

- Create: `packages/orchestration/src/credential-profile-lane.ts`
- Create: `packages/orchestration/src/credential-profile-lane.test.ts`
- Create: `packages/orchestration/src/credential-profile-lane-cli.ts`
- Create: `packages/orchestration/src/credential-profile-lane-cli.test.ts`
- Create: `packages/orchestration/src/credential-profile-lane-main.ts`
- Modify: `packages/orchestration/src/index.ts`
- Modify: `scripts/build-runtime.ts`
- Modify: `scripts/verify-runtime.ts`
- Modify: `scripts/verify-runtime-manifest.test.ts`
- Modify: `packages/policy/src/install-verify-decode.ts`
- Modify: `packages/policy/src/install-verify.test.ts`
- Generate: `skills/foreman/runtime/dist/credential-profile-lane.js`
- Modify: `skills/foreman/runtime/manifest.json`

**Interfaces:**

- Consume `resolveProfile()` from `credential-profile.ts`.
- Consume `CredentialProfilePreflightStore` from
  `credential-profile-preflight.ts`.
- Produce `admitCredentialProfileLane(input)` as an Effect program.
- Produce a closed `CredentialProfileLaneResult` union.
- Produce the `credential-profile-lane admit` CLI.

Use this public contract. Do not add a catch-all string reason.

```ts
export const CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS = [
  "invalid_arguments",
  "authority_missing",
  "authority_invalid",
  "profile_mismatch",
  "preflight_not_ready",
  "linked_path",
  "identity_changed",
  "unreadable",
] as const;

export type CredentialProfileLaneResult =
  | {
      readonly _tag: "Admitted";
      readonly profileId: string;
      readonly vendor: CredentialVendor;
      readonly configRoot: string;
      readonly profileIdentity: string;
    }
  | {
      readonly _tag: "Refused";
      readonly reason: CredentialProfileLaneRefusalReason;
    };

export function admitCredentialProfileLane(
  input: CredentialProfileInput,
): Effect.Effect<
  CredentialProfileLaneResult,
  never,
  CredentialProfileFs | CredentialProfilePreflightStore
>;
```

The implementation sequence is fixed:

```text
resolveProfile(input)
-> require Ready
-> read(profilePreflightRecordPath(...), exact expected binding)
-> require recordIsFullyReady(wrapper.record)
-> resolveProfile(input)
-> require exact equality with the first result
-> Admitted
```

Map `absent` to `authority_missing`; malformed, decoded, and oversized state to
`authority_invalid`; linked state to `linked_path`; changed identity to
`identity_changed`; and other read failures to `unreadable`. Do not return
record text, paths, nested reasons, environment values, or exception text.

- [ ] Write table-driven tests for each refusal reason. Add a two-resolution
      race test and a test that the store read receives the exact expected
      profile binding.
- [ ] Write CLI tests for the one accepted flag order and for missing,
      duplicate, unknown, reordered, relative, NUL, CR, and LF arguments.
- [ ] Run
      `node --import tsx --test packages/orchestration/src/credential-profile-lane.test.ts packages/orchestration/src/credential-profile-lane-cli.test.ts`.
      Require RED because the module does not exist.
- [ ] Implement the pure admission decision and Effect service.
- [ ] Implement the CLI and Node main without `process.exit()` in domain code.
- [ ] Run the same focused test command. Require zero failures.
- [ ] Add the runtime artifact and installed-runtime verification.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`, save the manifest hash, run `npm run build` again,
      and require the same manifest hash.
- [ ] Run `npm run verify-runtime` and
      `node --import tsx --test scripts/verify-runtime-manifest.test.ts packages/policy/src/install-verify.test.ts`.
- [ ] Run `openspec validate profile-bound-lane-admission --strict`.
- [ ] Commit the exact candidate.
- [ ] Consume one Endstop audit action and record the result.
- [ ] Use the correction allowance only for an actionable audit finding.
- [ ] Record `Completed` only after exact-candidate checks pass.

### Task 2: R7B2-C obsolete homes

**Files:**

- Modify: `skills/foreman/scripts/wt-new.sh`
- Modify: `tests/worktree.bats`
- Modify: `tests/grok-lane.bats`
- Modify: `tests/vendor-isolation.bats`
- Modify: `tests/docs-check.bats`
- Modify: `docs/releases/v0.3.0-destruction-log.md`

**Interfaces:**

- Consume the accepted R7B1 credential-profile authority.
- Produce worktrees that contain no credential authority.

- [ ] Write a Bats test that rejects both obsolete vendor-home directories.
- [ ] Run
      `bats tests/worktree.bats tests/grok-lane.bats tests/vendor-isolation.bats tests/docs-check.bats`.
      Require at least one failure from the new expectation.
- [ ] Remove only worktree vendor-home provisioning and output.
- [ ] Update the destruction record with the exact removed paths.
- [ ] Run the same focused Bats command and `npm run verify-register-doc`.
      Require zero failures.
- [ ] Commit the exact candidate.
- [ ] Consume one Endstop audit action and record the result.
- [ ] Use the correction allowance only for an actionable audit finding.
- [ ] Record `Completed` only after exact-candidate checks pass.

### Task 3: R7B2-B lane adapter

**Files:**

- Modify: `skills/foreman/scripts/lane-run.sh`
- Modify: `tests/grok-lane.bats`
- Modify: `tests/adapters.bats`
- Modify: `tests/lane-run.bats`
- Modify: `tests/lifecycle-gate.bats`
- Modify: `tests/vendor-isolation.bats`
- Modify: `packages/policy/src/architecture-adapter.ts`
- Modify: `packages/policy/src/architecture-adapter.test.ts`

**Interfaces:**

- Consume the accepted `credential-profile-lane` runtime from Task 1.
- Produce a lane environment with exactly one verified vendor-home variable.

- [ ] Write Bats tests for default profile selection and refusal ordering.
- [ ] Write Bats tests for exact environment isolation and override mismatch.
- [ ] Run
      `bats tests/grok-lane.bats tests/adapters.bats tests/lane-run.bats tests/lifecycle-gate.bats tests/vendor-isolation.bats`.
      Require at least one failure from the new expectation.
- [ ] Call the runtime before all durable lane side effects.
- [ ] Set only the verified vendor-home variable.
- [ ] Update the exact adapter grammar.
- [ ] Run the same focused Bats command, `npm run policy:check`,
      `shellcheck skills/foreman/scripts/lane-run.sh`, and
      `skills/foreman/scripts/docs-check.sh`. Require zero failures.
- [ ] Commit the exact candidate.
- [ ] Consume one Endstop audit action and record the result.
- [ ] Use the correction allowance only for an actionable audit finding.
- [ ] Record `Completed` only after exact-candidate checks pass.

### Task 4: R7B2-D release verification

**Files:**

- Modify: `openspec/changes/profile-bound-lane-admission/tasks.md`
- Modify: `openspec/changes/v030-release-program/tasks.md`

**Interfaces:**

- Consume `Completed` Endstop states from Tasks 1, 2, and 3.
- Produce the accepted R7B2 release commit and Sprint 3 ledger update.

- [ ] Refuse execution unless all three dependency contracts are `Completed`.
- [ ] Run `npm test` once on the exact candidate.
- [ ] Run `npm run typecheck`, `npm run verify-runtime`,
      `npm run policy:check`, `npm run verify-register-doc`, and
      `skills/foreman/scripts/docs-check.sh` once on the exact candidate.
- [ ] Run `openspec validate profile-bound-lane-admission --strict` and
      `openspec validate v030-release-program --strict` once.
- [ ] Update task records with exact commit and command evidence.
- [ ] Commit and push the exact release candidate.
- [ ] Record the `published` milestone and `Completed` state.
- [ ] Start R7C only with a new Endstop contract.
