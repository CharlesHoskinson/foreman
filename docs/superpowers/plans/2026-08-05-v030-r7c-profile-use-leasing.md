# R7C Profile-Use Leasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent two live lanes from using one credential profile at the same time.

**Architecture:** A Node.js holder composes R7B2 admission with a scoped Effect lease and waits for stdin EOF. The existing shell becomes a thin lifecycle adapter that keeps one anonymous pipe open through all lane work.

**Tech Stack:** Node.js 24, TypeScript, Effect, Node test runner, Bats, esbuild.

## Global Constraints

- All new production code runs on Node.js 24 and is TypeScript.
- Use `Effect.acquireRelease` for lease scope.
- Do not add Python or new shell-owned locking logic.
- Do not read or copy vendor credential files.
- Keep `credential-profile-lane admit` backward compatible.
- Run RED tests before production edits.
- Use one persistent Endstop contract for the implementation package.

---

### Task 1: Scoped profile-use lease

**Files:**
- Create: `packages/orchestration/src/credential-profile-use-lease.test.ts`
- Create: `packages/orchestration/src/credential-profile-use-lease.ts`
- Modify: `packages/orchestration/src/index.ts`

**Interfaces:**
- Consumes: `CredentialProfileInput`, `CredentialProfileFs`, and `resolveProfile`.
- Produces: `CredentialProfileUseLease`, `CredentialProfileUseLeaseFailure`, and `makeLiveCredentialProfileUseLeaseLayer`.

- [ ] **Step 1: Write the first RED acquisition test**

```ts
it("serializes one profile and releases through Scope", async () => {
  const first = Effect.scoped(acquire(request));
  const second = acquire(request).pipe(
    Effect.flip,
    Effect.map((failure) => failure.reason),
  );
  assert.equal(await Effect.runPromise(second), "busy");
  await Effect.runPromise(first);
  assert.equal((await Effect.runPromise(Effect.scoped(acquire(request)))).profileId, "grok-default");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test packages/orchestration/src/credential-profile-use-lease.test.ts`

Expected: FAIL because `credential-profile-use-lease.ts` does not exist.

- [ ] **Step 3: Implement the scoped interface and exclusive lease**

```ts
export class CredentialProfileUseLease extends Context.Tag(
  "CredentialProfileUseLease",
)<CredentialProfileUseLease, {
  readonly acquire: (
    request: CredentialProfileUseLeaseRequestV1,
  ) => Effect.Effect<CredentialProfileUseLeaseV1, CredentialProfileUseLeaseFailure, Scope.Scope>;
}>() {}

const acquire = (request: CredentialProfileUseLeaseRequestV1) =>
  Effect.acquireRelease(acquireDirectory(request), releaseDirectory);
```

Require exact re-resolved identity and config root before `mkdir`. Capture the
lease-root and lease identities. Release only when both identities still match.

- [ ] **Step 4: Add and pass safety tests**

Add one test for each closed reason, same-profile contention, different-profile
concurrency, release idempotence, identity swaps, unsafe modes, and links.

Run: `node --import tsx --test packages/orchestration/src/credential-profile-use-lease.test.ts`

Expected: PASS, 0 failed.

- [ ] **Step 5: Commit the core**

```bash
git add packages/orchestration/src/credential-profile-use-lease.ts packages/orchestration/src/credential-profile-use-lease.test.ts packages/orchestration/src/index.ts
git commit -m "feat: add scoped credential profile lease"
```

### Task 2: Long-lived Node holder

**Files:**
- Create: `packages/orchestration/src/credential-profile-use-lease-cli.test.ts`
- Create: `packages/orchestration/src/credential-profile-use-lease-cli.ts`
- Create: `packages/orchestration/src/credential-profile-use-lease-main.ts`
- Modify: `package.json`
- Modify: `skills/foreman/runtime/manifest.json`
- Generate: `skills/foreman/runtime/dist/credential-profile-use-lease.js`

**Interfaces:**
- Consumes: `admitCredentialProfileLane` and `CredentialProfileUseLease.acquire`.
- Produces: `hold --state-root ABS --worktree ABS --profile ID --vendor grok|codex`.

- [ ] **Step 1: Write RED CLI tests**

```ts
it("prints one config-root line and holds until EOF", async () => {
  const io = makeControlledIo();
  const running = runCredentialProfileUseLeaseCli(validArgv, io);
  await io.waitForStdout("/state/credential-profiles/grok-default/homes/grok\n");
  assert.equal(io.completed, false);
  io.endStdin();
  assert.equal(await running, 0);
});
```

Test every missing, duplicate, reordered, relative, and unknown argument. Test
that diagnostics contain only the closed reason.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test packages/orchestration/src/credential-profile-use-lease-cli.test.ts`

Expected: FAIL because the holder CLI does not exist.

- [ ] **Step 3: Implement admit, acquire, print, and EOF wait**

```ts
return Effect.scoped(
  Effect.gen(function* () {
    const admitted = yield* admitCredentialProfileLane(input);
    if (admitted._tag === "Refused") return yield* Effect.fail(mapAdmission(admitted.reason));
    yield* lease.acquire({
      input,
      expectedProfileIdentity: admitted.profileIdentity,
      expectedConfigRoot: admitted.configRoot,
    });
    io.writeStdout(`${admitted.configRoot}\n`);
    yield* io.awaitStdinEof;
    return 0;
  }),
);
```

- [ ] **Step 4: Pass CLI and build checks**

Run: `node --import tsx --test packages/orchestration/src/credential-profile-use-lease-cli.test.ts`

Run: `npm run typecheck && npm run build && npm run verify-runtime`

Expected: all commands exit 0 and two builds produce identical runtime bytes.

- [ ] **Step 5: Commit the holder**

```bash
git add packages/orchestration/src/credential-profile-use-lease-cli.ts packages/orchestration/src/credential-profile-use-lease-cli.test.ts packages/orchestration/src/credential-profile-use-lease-main.ts package.json skills/foreman/runtime/manifest.json skills/foreman/runtime/dist/credential-profile-use-lease.js
git commit -m "feat: add credential profile lease holder"
```

### Task 3: Live lane lifecycle

**Files:**
- Modify: `skills/foreman/scripts/lane-run.sh`
- Modify: `tests/lane-run.bats`
- Create: `tests/profile-use-lease.bats`
- Modify: `packages/policy/src/architecture-adapter.test.ts`
- Generate: `skills/foreman/runtime/dist/architecture-policy.js`
- Modify: `skills/foreman/runtime/manifest.json`

**Interfaces:**
- Consumes: the holder stdout line, coprocess input descriptor, and holder PID.
- Produces: one lease that spans every existing lane exit path.

- [ ] **Step 1: Write RED Bats lifecycle tests**

Add tests that hold the first lane, refuse the second same-profile worktree,
allow a different profile, and reacquire after success, INT, TERM, timeout 124,
launcher failure 125, and parent death. Each refusal test asserts that the
worktree lock, event, scan marker, and vendor marker are absent.

Run: `bats tests/profile-use-lease.bats tests/lane-run.bats`

Expected: new lease tests FAIL because live lane still uses short admission.

- [ ] **Step 2: Add the thin coprocess adapter**

```bash
coproc LANE_PROFILE_HOLDER {
  "$lane_gate_node" "$lane_lease_runtime" hold \
    --state-root "$FOREMAN_HOME" --worktree "$WT" \
    --profile "$LANE_CREDENTIAL_PROFILE" --vendor "$LANE_VENDOR"
}
lane_profile_lease_pid="$LANE_PROFILE_HOLDER_PID"
lane_profile_lease_fd="${LANE_PROFILE_HOLDER[1]}"
IFS= read -r -t 30 lane_verified_config_root <&"${LANE_PROFILE_HOLDER[0]}"
```

Install temporary traps before `coproc`. Move the descriptor close and bounded
holder reap into the existing idempotent cleanup. Keep the descriptor open
through all command, gate, and checkpoint phases.

- [ ] **Step 3: Verify GREEN and adapter policy**

Run: `bats tests/profile-use-lease.bats tests/lane-run.bats`

Run: `node --import tsx --test packages/policy/src/architecture-adapter.test.ts`

Run: `shellcheck skills/foreman/scripts/lane-run.sh`

Expected: all commands exit 0.

- [ ] **Step 4: Commit the live adapter**

```bash
git add skills/foreman/scripts/lane-run.sh tests/profile-use-lease.bats tests/lane-run.bats packages/policy/src/architecture-adapter.test.ts skills/foreman/runtime/dist/architecture-policy.js skills/foreman/runtime/manifest.json
git commit -m "feat: hold credential profile lease through lane lifecycle"
```

### Task 4: Exact-candidate acceptance

**Files:**
- Modify: `openspec/changes/profile-use-leasing/tasks.md`
- Modify: `openspec/changes/v030-release-program/sprints.md`
- Modify: `openspec/changes/v030-release-program/tasks.md`

**Interfaces:**
- Consumes: the exact implementation candidate and Endstop ledger.
- Produces: published R7C completion evidence.

- [ ] **Step 1: Run the one candidate gate**

Run focused tests, full `npm test`, `npm run typecheck`, two deterministic
builds, `npm run verify-runtime`, architecture policy, shellcheck, docs-check,
repository hygiene, and strict validation for both OpenSpec changes.

- [ ] **Step 2: Run one cold audit**

Use one non-implementing Codex session with the exact base, head, diff hash,
spec, and test evidence. Correct one actionable finding at most.

- [ ] **Step 3: Integrate and publish**

Fast-forward the accepted candidate, push the branch, record `integrated` and
`published`, then mark the R7C task boxes complete with exact commit hashes.
