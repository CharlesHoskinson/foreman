# Council report — testing Effect-TS code in Foreman

Lens: Effect-TS. Grounded in `/root/fm-hyg/foreman` @ `6bfb59b`.
Runner is `node --import tsx --test` (no vitest, no jest). Effect 3.22.1.
TypeScript is already `strict` + `exactOptionalPropertyTypes` +
`noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch`.

Everything below is written so a reviewer can check it with `tsc`, `grep`, or a
~40-line script. Where a rule costs something, the cost is stated.

---

## 0. What Foreman actually does today

Three distinct Effect styles coexist, and they are not equally good.

**(a) Effect-as-DI-only, pure core underneath.** `packages/orchestration/src/credential-profile.ts:1644`:

```ts
export function initProfile(
  input: CredentialProfileInput,
): Effect.Effect<CredentialProfileResult, never, CredentialProfileFs> {
  return Effect.gen(function* () {
    const fs = yield* CredentialProfileFs;
    return initProfileSync(input, fs);
  });
}
```

The service shape `CredentialProfileFsShape` returns **plain tagged unions, not
Effects** (`readFile` returns `{_tag:"Ok"|"Absent"|"Oversized"|"Linked"|"NotFile"|"Unreadable"}`).
The error channel is `never`. Effect is doing nothing here except delivering a
record. This is the best code in the repo for testing purposes and nobody has
named it as the house style.

**(b) Effect-as-error-channel.** `packages/policy/src/services.ts` — `FileSystem`,
`GitIdentity`, `Clock`, `MutationProbe`; every method returns
`Effect.Effect<A, PolicyFsError>`. Tests provide `Layer.succeed(FileSystem, {...})`
and run with `Effect.runSync`.

**(c) Effect-as-runtime.** `packages/launcher/src/supervise.ts` — `Effect.scoped`,
`Effect.fork` ×4, `Effect.addFinalizer`, `Fiber.interrupt`, real child processes.
This is the only place that genuinely needs the whole machine.

And one deliberate boundary: `withEffectLockSync`
(`packages/graph-store/src/files-only.ts:1298`) runs `Effect.runSync(Effect.either(...))`
and rethrows typed failures **outside** Effect so callers never see `FiberFailure`.

---

## 1. Pure core / effectful shell — how far, and the rule

### The rule

> **If you can write the function's signature without `Effect`, `Scope`, or a
> service tag, you must. If you cannot, the Effect version must be a ≤10-line
> adapter that yields services and immediately calls a pure function. Every
> decision lives in the pure function.**

That is `initProfile` verbatim. Make it doctrine and the judgement calls
disappear, because the test becomes mechanical: *does the `Effect.gen` body
branch on a domain value?* If yes, the branch is in the wrong place.

### The closed list of things that justify a layer

A `Context.Tag` is justified by exactly one of five properties, and nothing else:

1. **Ambient nondeterminism** — clock, randomness, env, pid, platform.
   (`Clock`, `LauncherClock`, `EnvVars`, `Sleeper`.)
2. **OS contact** — fs, spawn, exec, network.
   (`FileSystem`, `CredentialProfileFs`, `ChildSpawner`, `ExecveService`.)
3. **A resource with a release** — needs `Scope`.
   (`withLockedRootEffect`, `supervise`.)
4. **Interruptibility or timing** — needs a fiber.
   (`supervise`, `architecture-git`.)
5. **An audit surface tests must count** — the one genuinely non-obvious
   category. `MutationProbe` / `makeMemoryMutationProbe`
   (`packages/policy/src/services.ts:158`) exists so a test can assert *zero
   mutations happened*. That is a legitimate reason to inject, and it should be
   named as a category so people stop apologising for it.

Everything else is pure: path math, canonicalization, decode, argv parse,
render, identity comparison, and — importantly — **refusal classification**.
Foreman already gets this right in `normalizeAbsolutePath`,
`decodeCredentialProfileRecordV1`, `parseCredentialProfileArgv`, and above all
`isIgnorableParentDirSyncError(code, platform)`, which turns a platform
difference into a **pure function of two arguments**. That last one is the
template for §2.4.

### Mechanical checks

- **C1.1** — an exported signature `Effect.Effect<A, E, never>` (R = `never`) is
  a smell: it needs no service, so it is a pure function wearing a costume.
  Flag it unless the identifier is a service *method* type or is a `Scope`d
  effect. Pure grep on `.d.ts` output.
- **C1.2** — cap `Effect.gen(function* () {` bodies at 40 lines. Anything longer
  is doing domain work in the shell. Exceptions annotated with
  `// shell-exempt: <reason>`. Grep + line count.
- **C1.3** — a shell function must have a `*Sync` (or otherwise pure) sibling
  exported from the same module. Grep for `Effect.Effect<` returns without a
  sibling.

### TDD ordering that falls out of this

> **The red test for new behavior is always a call to the pure function.**
> After the pure reason-table is green, write **exactly one** test proving the
> Effect wrapper threads the service through.

So a feature with 11 refusal reasons gets 11 pure tests and 1 wiring test — not
11 `Effect.runSync(... Effect.provide ...)` tests. Today `credential-profile.test.ts`
goes through `runInit`/`runResolve` helpers that do
`Effect.runSync(initProfile(input).pipe(Effect.provide(Layer.succeed(...))))`
for every case. That is 6 lines of Effect ceremony per assertion buying nothing;
those cases should call `initProfileSync(input, fs)` directly.

### Cost

Two names per behavior (`initProfile` / `initProfileSync`) and one extra hop
when reading. Passing the service record as a plain argument also means the pure
core cannot use Effect's short-circuiting, so it returns tagged unions and gets
more verbose. Foreman already pays this and it is the right trade — the tagged
unions are what make §4 possible.

---

## 2. Test layers that stay honest

### Diagnosis of this week's Windows failures — they were two different bugs

**(a) The fake was a different filesystem than the live one.** Commits `67a5a3b`
and `39c555e`. `tracked-delete.test.ts` and `cli.test.ts` drove a fully
in-memory FS keyed by POSIX string literals (`store.set("/repo/" + t.path, …)`,
`repoRoot: "/repo"`), while production built keys with `path.join(repoRoot, rel)`.
On Windows that is `\repo\pkg\a.txt`; every lookup missed, every target read as
`target_missing`, every deletion was denied, and **the assertions pointed at the
deletion guard, which was correct on the inputs it was handed**. Ten tests, one
fixture defect. Nothing about Effect caused this: the fake was written from the
author's mental model instead of from an executable contract.

**(b) The live layer contradicted every test.** Commit `12391ac`.
`WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES` excluded `EPERM` — and `EPERM` is
the code Windows actually produces, because `FlushFileBuffers` on a directory
handle returns `ERROR_ACCESS_DENIED`. The Windows branch was unreachable; every
credential-profile publish refused with `write_failed`; ~32 of 49 gate failures.
**No fake can ever catch this.** Only running the live implementation on the
platform catches it. Worse, two tests *asserted the wrong rule*, so the green
suite was actively certifying a product that could not run.

**(c) And a vacuous assertion.** `assert.ok(!JSON.stringify(result).includes("/repo"))`
passes on Windows for the wrong reason — `JSON.stringify` escapes backslashes,
so a Windows root can never appear literally. Green, testing nothing.

Three failure modes, three different remedies. Here they are.

### R2.1 — The one invariant that governs every fake

> **A fake may refuse what live accepts. A fake must never accept what live
> refuses.**

Permissive fakes produce false green (production breaks). Strict fakes produce
false red (annoying, visible, self-correcting). This is why the "everything
fails" layer at `tracked-delete.test.ts:1001` is legitimate and valuable while
the memory FS was dangerous — and it gives you a principled carve-out for the
lint rule in R2.3.

### R2.2 — Annotate every fake with the tag's service type (do this first)

`packages/launcher/src/services.ts:157` already does it for live impls:

```ts
export const liveClock: Context.Tag.Service<typeof LauncherClock> = { … };
```

Require it on **fakes** too:

```ts
const fake: Context.Tag.Service<typeof FileSystem> = { … };
```

Then adding a method to a tag breaks every fake at `tsc` time, in every package,
instead of at runtime on Windows six months later. **Mechanical check:** no
`Layer.succeed(<Tag>, {` with an inline unannotated object literal.

Cost: near zero. Highest value per hour of anything in this report. Do it today.

### R2.3 — Ban hand-written full fakes; require partial override over live

Foreman already contains both idioms, and it is instructive that the honest one
is in the file that *didn't* break:

```ts
// credential-profile.test.ts:124 — defaults to the LIVE implementation
function runInit(input, fs: CredentialProfileFsShape = liveCredentialProfileFs) { … }
```

The surface a test does not override **cannot drift, because it is production
code**. Contrast the wholly synthetic memory FS in `tracked-delete.test.ts:511`
— that is the one that broke on Windows.

**Rule:** a test constructs a service record only via
`override<Tag>(base, partial)`. `Layer.succeed(Tag, { …full literal… })` is
flagged, with two carve-outs: (i) the conformance suite (R2.4), and (ii)
total-failure layers, which are safe by R2.1.

**Mechanical check:** add a new `PolicyReason` to the existing architecture
checker (`packages/policy/src/architecture-schema.ts` already has a closed
reason union): `handwritten_full_fake`.

Cost: rewriting the tracked-delete and cli memory filesystems as overrides over
a shared memory base. Real work — a day. Note the memory base itself still needs
R2.4 to stay honest, because a memory FS has no live counterpart to inherit.

### R2.4 — Every tag with >1 implementation gets a conformance suite

Foreman has already invented this exactly once and then never reused it:
`packages/graph-store/src/contract-suite.ts` (784 lines) — "backend-agnostic
GraphStore port conformance suite", parameterized by `StoreFactory`, driven from
`contract.test.ts` and `cli.ts`. Generalize it.

For `FileSystem` and `CredentialProfileFs`, write
`fsContractSuite(make: () => Shape, caps: Caps)` asserting the laws both
implementations must satisfy:

- a key written as `join(root, rel)` is readable as `join(root, rel)` on **this**
  host's separator (this single law catches failure (a) on Windows)
- `createFile` twice → second fails
- `lstat` after `unlink` → fails
- `readFile` over `maxBytes` → `Oversized`
- symlink at the final component → `Linked`, never followed

Run it in `live` mode against a temp dir (capability-gated with `{ skip }`) and
in `memory` mode. The memory FS then has an executable contract instead of a
mental model.

Cost: substantial — the graph-store precedent is 784 lines, and **every new
service method must be added to the suite or the suite lies by omission**. That
omission risk is why R2.2 (type-level) comes first: `tsc` catches the shape,
the suite catches the behavior.

### R2.5 — Platform difference is data, not a fork in the fake

Never encode a platform assumption inside a fake or a live impl's control flow.
Extract it as a pure predicate — `isIgnorableParentDirSyncError(code, platform)`
is the exemplar — and test **both platforms' tables on every host**. What then
remains untested on Linux is exactly one question: *which errno does Windows
actually produce?* That is one live-seam test, and it must be visible.

This rule is what would have turned `12391ac` from 32 gate failures into a
one-line table edit.

**Mechanical check:** `process.platform` may not appear in a `packages/*/src/*.ts`
non-test file except as a **default parameter value** of a pure predicate.
Grep-able; there are few enough sites to migrate.

### R2.6 — Silent skips are banned

`if (IS_WIN) return;` inside `it()` reports **pass**. `credential-profile.test.ts`
has ~11 of them (lines 1505, 1579, 1641, 1672, 1715, 1747, 1854, 1885 …) and
`supervise.test.ts:492` has `if (isWin) return;` plus an `Unavailable` early
return commented "Typed skip: do not claim a false zero" — which does exactly
that in the report, because a returning test is a passing test.

The repo already knows the right form and uses it elsewhere:
`{ skip: process.platform === "win32" }`,
`{ skip: !profilePreflightDirectoryAnchorSupported() }`,
`{ skip: !canSymlink }`.

**Rule:** every conditional exclusion is `it(name, { skip: <reason> }, fn)`.
**Plus:** commit a per-platform skip-count baseline file and assert against it in
CI. The commit messages for `12391ac`/`39c555e` already record these counts by
hand ("41 tests, 32 pass, 0 fail, 9 skipped") — promote that to a tracked file
so a test that silently stops running is a failure, not a footnote.

Cost: the baseline needs updating whenever tests are added. That is the point.

### R2.7 — Negative assertions need a positive control

`assert.ok(!text.includes("/repo"))` passed vacuously on Windows. Any
"needle must not appear" assertion must be paired with proof the needle *could*
have been found. Route them all through the existing helper
(`assertSecretSafe`, `credential-profile.test.ts:162`) and harden it: assert
each forbidden string is non-empty **and** appears in a deliberately-leaky
control rendering built in the same test.

**Mechanical check:** flag `assert.ok(!` and `assert.equal(x.includes(y), false)`
outside the helper.

---

## 3. Race hooks: `setCredentialProfileRaceHook` et al.

**Verdict: the seam is right, the implementation is a smell.** Keep the
capability. Fix four concrete defects.

### Why the seam is right

`afterSafeModeVerify` fires *between two statements inside one synchronous
critical section* (`credential-profile.ts:1271`). That TOCTOU window exists only
at that instruction boundary; you cannot reach it by swapping a service, because
the service call already returned. `forceParentDirSyncCode` is the only way to
make a syscall that does not fail on demand produce `EIO`. Given that Foreman's
product *is* identity and atomicity guarantees, a way to drive a test through the
exact window is load-bearing, not a convenience.

There are six of these today: `setCredentialProfileRaceHook`,
`setSecretScanRaceHook`, `setProfilePreflightRaceHook`,
`setStateRootCreateRaceHook`, `setDirectoryIdentityRaceHook`, and
`setSecretScanDirectoryAnchorCapabilityForTests` — plus a seventh shape,
`FilesOnlyOptions.inject` (`PublishInjectHooks`, `files-only.ts:1319`), which
does the same job through options.

### The four defects

1. **Module-level mutable global.** `let raceHook` (`credential-profile.ts:559`).
   `afterEach(() => setCredentialProfileRaceHook(undefined))` exists in 5 files
   and is the right cleanup — but it is per-file convention, unenforced, and it
   does not protect against an `async` test yielding while a hook is installed.
2. **Exported from the public surface.** All six setters are re-exported from
   `packages/orchestration/src/index.ts` and appear in `dist/index.d.ts:38,44,45,46`.
   Any consumer of `@foreman/orchestration` can install a race hook. For a
   package whose job is credential authority, that is a privilege-escalation
   seam sitting in the published API.
3. **Nothing proves production never installs one.**
4. **Four different naming shapes** (`setXRaceHook`, `…ForTests`, `opts.inject`,
   `opts.fs?` partial override) for one concept.

### The discipline (all mechanically checkable)

- **Naming.** One convention: `set<Domain>RaceHook` / `type <Domain>RaceHook`.
  Migrate `setSecretScanDirectoryAnchorCapabilityForTests` and fold
  `PublishInjectHooks` into it. Gate: any exported identifier matching
  `RaceHook|Inject|ForTests` must match `^set[A-Za-z]+RaceHook$`.
- **Off the public surface.** Move seams to `packages/*/src/internal/seams.ts`.
  New architecture-policy reason: `test_seam_in_public_api` — no `index.ts` may
  re-export an identifier matching `RaceHook|ForTests`. Tests import the deep
  path, which is fine inside the workspace.
  *Cost:* uglier test imports; `scripts/build-runtime.ts` must keep the module.
- **Fail closed in production.** Gate **installation**, not invocation:
  `setXRaceHook` throws unless `process.env.FOREMAN_TEST_SEAMS === "1"`, set by
  the `npm test` script. Invocation stays free (`raceHook?.afterWrite?.()` is one
  property read). Add one test per domain asserting the throw.
  *Cost:* running a single test file by hand without the env var throws loudly —
  acceptable and self-explaining.
- **Scoped installation, never bare.** Replace
  `setHook(x) … setHook(undefined)` with
  `withRaceHook(hook, () => body)` that installs, runs, restores in `finally`,
  **and refuses to install if one is already installed** (this is what catches
  async overlap). Gate: `setXRaceHook(` may appear only inside `withRaceHook`
  and in an `afterEach` reset.
  *Cost:* rewriting ~30 call sites across 4 test files.
- **Every hook field must be exercised.** Keep
  `const CREDENTIAL_PROFILE_RACE_HOOK_FIELDS = [...] as const satisfies readonly (keyof CredentialProfileRaceHook)[]`
  next to the type with a `never`-assignment proving coverage, and a test that
  greps the corpus for each field name. **A hook field with no test is dead
  production weight and must be deleted** — right now every invocation site is
  an unconditional branch in a credential-authority hot path.

### What I would *not* do

Do not try to replace race hooks with `TestClock` or fiber-scheduling tricks.
These windows are inside synchronous code; Effect's scheduler cannot reach them,
and pushing the code into Effect purely to make the window schedulable would
make a security-critical path slower and more fragile than a nullable function
pointer.

---

## 4. Typed failure paths: making exhaustiveness mechanical

Today the repo pins the *list*
(`assert.deepEqual(CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS, [...])`,
`credential-profile-lane.test.ts:320`) but nothing proves each reason is
*reachable*. That is the whole gap. Three layers close it.

### Layer 1 — witness registry (the mechanical part, ~40 lines)

Every refusal union already has a runtime `as const` array:
`CREDENTIAL_PROFILE_REFUSAL_REASONS` (11 reasons),
`PROFILE_PREFLIGHT_DECODE_FAILURE_REASONS`,
`PROFILE_PREFLIGHT_STORE_FAILURE_REASONS`,
`CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS`, `INCOMPLETE_REASONS`. The one
exception is `DenialReason` in `packages/policy/src/schema.ts`, which is
type-only — give it an array; that is the only production change required.

Then add to `@foreman/core`:

```ts
// refusal-witness.ts
const seen = new Map<string, Set<string>>();

export function assertRefused<R extends string>(
  domain: string,
  result: { readonly _tag: string; readonly reason?: R },
  expected: R,
): void {
  assert.equal(result._tag, "Refused");           // or "Denied"
  assert.equal(result.reason, expected);
  (seen.get(domain) ?? seen.set(domain, new Set()).get(domain)!).add(expected);
}

export function assertAllReasonsWitnessed(
  domain: string,
  all: readonly string[],
): void {
  const got = seen.get(domain) ?? new Set();
  const missing = all.filter((r) => !got.has(r));
  assert.deepEqual(missing, [], `unwitnessed refusal reasons: ${missing.join(", ")}`);
}
```

Use `assertRefused` **instead of** raw `assert.equal(result.reason, x)`, and add
one final check per file:

```ts
after(() => assertAllReasonsWitnessed("credential_profile", CREDENTIAL_PROFILE_REFUSAL_REASONS));
```

The day someone adds `"quota_exceeded"` to the union without a test producing
it, the build fails.

**Caveat, stated plainly:** `node --test` runs files in separate processes, so
the registry is per-file. That works if every reason in a domain is witnessable
in one test file — which matches Foreman's one-module-one-test-file layout. If a
domain spans files, have each file write
`$FOREMAN_WITNESS_DIR/<domain>.<pid>.json` and add
`scripts/verify-refusal-coverage.ts` to `npm run verify` to union and diff them.
Cost: ~100 lines total and one more verify step.

### Layer 2 — type-level exhaustiveness at every mapping site

Keep the `const _exhaustive: never = x` idiom (14 sites today:
`credential-profile.ts:1345`, `queue-admission.ts:386`, `queue-cli.ts:225`,
`resume-safety-services.ts:95,124`, `round-contract.ts:677`,
`vendor-preflight.ts:414`, `dependency-drift.ts:419`, `supervisor.ts:531,556`,
`vendor-preflight-store.ts:121`). Require it in **every** switch over a refusal
reason. `noFallthroughCasesInSwitch` is already on; the `never`-assignment is
what catches a *missing* case.

### Layer 3 — the TDD loop this buys you

> Add the reason to the `as const` array **first**.

That one edit turns three things red at once: the `deepEqual` list pin, the
`never`-assignment in every renderer, and the witness assertion — **before any
implementation exists**. Three red lights from one edit, for free, once layers 1
and 2 are in place. That is the loop worth having.

### Layer 4 — refusal is not enough; assert zero mutation

`MutationProbe` / `makeMemoryMutationProbe` exists for exactly this, and
`tracked-delete.test.ts` uses it well
(`assert.equal(probe.counts.get("unlink") ?? 0, 0)`).

**Rule:** every test asserting a refusal must also assert a probe count of zero
for the mutation that refusal exists to prevent. **Mechanical check:** a test
body containing `"Denied"` or `"Refused"` must also contain `probe.counts` or an
explicit `// no-mutation-surface: <reason>` annotation.

---

## 5. Effect-specific traps

### T1 — `runSync` vs `runPromise` vs `runPromiseExit`

`Effect.runSync` appears ~24× in `tracked-delete.test.ts` alone, and in
production at `files-only.ts:1303`. If a fake ever returns
`Effect.promise`/`Effect.async`, `runSync` dies with `AsyncFiberException` —
and because the house convention rethrows domain failures outside Effect, that
death is easy to misread as a domain error.

**Rule:** use `runSync` in a test only where **production** uses `runSync`
(i.e. mirroring `withEffectLockSync` or `initProfileSync`). Everywhere else use
`Effect.runPromiseExit` and assert on the `Exit`. `Effect.either` — correct in
production, because the caller wants the typed failure — collapses Fail / Die /
Interrupt into one thing, and in a test you want them distinguished.

**Mechanical check:** in `*.test.ts`, `Effect.runSync(` allowed only inside a
helper named `run*Sync`, or applied to `Deferred.make`-style constructors.

### T2 — defects are not failures

`tracked-delete.test.ts:561` injects a defect with `Effect.die` deliberately.
A test expecting a **defect** must use `runPromiseExit` + `Exit.isFailure` +
`Cause.isDie`, never `try/catch` on a message — otherwise a typed failure and a
defect are indistinguishable and the test proves nothing about which occurred.

Related and **currently missing**: `withEffectLockSync`'s entire purpose is that
no `FiberFailure` escapes to a caller. I found no test asserting that directly.
Add one per failure kind:
`assert.notEqual(caught?.constructor?.name, "FiberFailure")`.

### T3 — scopes and no-op finalizers

`liveGraphStoreService.open` (`files-only.ts:1711`) is an `Effect.acquireRelease`
whose release is `(_store) => Effect.void`. Honest today (the store holds no OS
handle) — but it means **no test can distinguish "released" from "never
acquired"**, and it will silently stay a no-op the day the store does hold a
handle.

**Rule:** every `acquireRelease` gets three tests — finalizer ran on success,
finalizer ran when the body **failed**, finalizer ran when the body was
**interrupted**. **Mechanical check:** flag `acquireRelease(` whose second
argument is literally `Effect.void` or `() => Effect.void`. Either the resource
needs no scope (use `Effect.try`) or the finalizer is missing.

Also: a single helper
`runScoped(effect, layer) = Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))))`.
TypeScript already prevents running an unscoped `Scope`-requiring effect (R is
not `never`), so this one is free — just never paper over it with `as any`.

### T4 — fibers outliving tests

`Effect.runFork` appears in `supervise.test.ts`, `queue-admission.test.ts`,
`round-cli.test.ts`, `architecture-git.typed.test.ts`, `run-journal.test.ts`.
`run-journal.test.ts:215` joins (good). `supervise.test.ts:479` interrupts
(good) but **not inside a `finally`** — if the assertion before it throws, the
fiber leaks into the next test, and in `supervise`'s case a real child process
survives.

**Rule:** every `runFork` in a test is matched, in the same test, by
`Fiber.interrupt` or `Fiber.join` inside `try/finally`. Provide
`withForked(effect, fn)` that forks, runs `fn(fiber)`, and interrupts in
`finally`; then grep-ban bare `Effect.runFork` in tests.

Second-order and specific to this repo: `node --test` will not fail a suite for a
leaked fiber — it will hang, or pass while a detached child process lingers, in a
package whose entire job is process-tree termination. `supervise.test.ts` already
has `observeZombieDirectChildren(pid)`; promote it to a shared helper and call it
from `after()` in every file that forks.

Cost: one helper plus ~10 rewrites.

### T5 — `setTimeout` as synchronization

`supervise.test.ts:477` does `await new Promise(r => setTimeout(r, 30))` to
"allow spawn + fiber setup" and then asserts an exact kill count. That is a race
and it will flake on a loaded Windows runner — the repo has already paid for
this once (`03050e3` "stabilize Windows timeout"). Replace with a `Deferred` the
fake `ChildSpawner` completes when it observes the spawn; `Deferred` is already
imported in that file.

The acceptable form of waiting is the deadline-polling loop already used in the
churn test (`while (!existsSync(go) && Date.now() < deadline)`).

**Mechanical check:** ban bare `setTimeout` in test bodies outside a documented
`waitUntil(pred, deadlineMs)` helper.

### T6 — virtual time for anything time-shaped

`Clock`, `LauncherClock`, and `Sleeper` are injectable — good. But `supervise`
tests pass real `timeoutSecs: 30` and heartbeat intervals.

**Rule:** any test asserting timeout / retry / heartbeat behavior uses
`TestClock` (`Effect.provide(TestContext.TestContext)` + `TestClock.adjust`) or
an injected clock — never wall-clock. **Cheap interim rule while `supervise` is
converted:** no test may consume more than 1s of wall time; anything longer must
be virtual. Grep for four-digit `setTimeout` arguments and second-valued
durations in test files.

Cost: fully converting `supervise` is real work because it interleaves
`Effect.sleep` with host process realities. The 1s cap is enforceable today.

### T7 — interruption tests are easy to forget, not easy to write

Effect makes interruption cheap to implement and easy to leave untested.
Foreman does well here in one place —
`architecture-git.typed.test.ts:260` carries an explicit "RED witness for missing
cancel finalizer". Make it a rule, not an instance:

> **Every exported Effect that spawns a process, holds a lock, or opens a scope
> has an interruption test asserting the *observable* cleanup** — child dead,
> lock file gone, temp file gone. Not "the fiber ended".

**Mechanical check:** the set of such exports is exactly those whose type
mentions `Scope` or that require `ChildSpawner`/`ProcessExec`; require a
matching test name containing `interrupt`.

### T8 — the one convenience worth building

Do **not** adopt `@effect/vitest`; it would mean switching runners. Its value is
`it.effect` (auto `TestContext`, auto scope, `Exit`-based assertions), and you
can have that in ~30 lines against `node:test`:

```ts
export function itEffect<E, A>(
  name: string,
  opts: { skip?: boolean | string },
  body: () => Effect.Effect<A, E, Scope.Scope | TestServices>,
): void {
  it(name, opts, async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(body()).pipe(Effect.provide(TestContext.TestContext)),
    );
    if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  });
}
```

That single helper enforces T1, T3, T5 and T6 by construction for every test
written through it. Highest leverage 30 lines in this report.

---

## 6. The TDD loop, end to end

For a new refusal reason:

1. Add the reason to the `as const` array. Run tests → **3 reds** (list pin,
   `never`-assignment in the renderer, witness assertion).
2. Write the failing test against the **pure** function:
   `initProfileSync(input, overrideFs(live, { readFile: () => ({ _tag: "Linked" }) }))`.
3. Implement in the pure core. Reds → greens.
4. **Only if** the reason needs a mid-operation window: add a race-hook field,
   drive it via `withRaceHook`, and add the field to the hook-coverage list.
5. Add the `MutationProbe` zero-count assertion.
6. If the behavior is platform-shaped: express it as a pure `(code, platform)`
   predicate, test both tables on both hosts, and add exactly one
   `{ skip }`-guarded live-seam test.

Note how little of that touches Effect at all. That is the intended outcome.

---

## 7. Gate summary — one script, ordered by value/cost

Add `scripts/verify-test-hygiene.ts` to `npm run verify` (or fold into the
existing architecture-policy checker, which already has the closed-reason
machinery).

| # | Check | Catches | Cost |
|---|---|---|---|
| 1 | `Layer.succeed(Tag, {…})` literals must be `Context.Tag.Service<typeof Tag>`-annotated | fake/live shape drift | hours |
| 2 | no bare `if (COND) return;` in a test body — use `{ skip }` | invisible skips (~15 today) | hours |
| 3 | no `RaceHook`/`ForTests` identifier re-exported from any `index.ts` | test seams in the published API | hours |
| 4 | `Effect.runFork` matched by interrupt/join in the same test | leaked fibers, surviving children | hours |
| 5 | `acquireRelease` release may not be `Effect.void` | unfalsifiable finalizers | hours |
| 6 | no `setTimeout` >1000ms in tests; no bare `setTimeout` as sync | Windows flake | hours |
| 7 | every refusal-reason union has `assertAllReasonsWitnessed` | aspirational refusal coverage | ~1 day |
| 8 | `setXRaceHook(` only inside `withRaceHook`/`afterEach`; `FOREMAN_TEST_SEAMS` gate | cross-test hook bleed; prod installation | ~1 day |
| 9 | negative-containment assertions go through a controlled helper | vacuous assertions | ~1 day |
| 10 | committed per-platform skip-count baseline | tests that quietly stop running | ~1 day + upkeep |
| 11 | no hand-written full fakes outside conformance suites | this week's Windows failure (a) | days |
| 12 | conformance suite per multi-impl tag, live + memory | fake/live behavior drift generally | days |

Do 1–6 first: they are pure `tsc`/`grep`, they are all cheap, and 1, 2 and 4
each independently address a failure Foreman has already paid for.

---

## 8. Three things this report says that are uncomfortable

1. **Most of the Effect in the test suite is ceremony.** `credential-profile.ts`
   already proves the policy is a pure function of `(input, fsRecord)`. Hundreds
   of `Effect.runSync(x.pipe(Effect.provide(Layer.succeed(...))))` lines in tests
   buy nothing over calling `initProfileSync` directly, and they make failures
   harder to read. Deleting Effect from those tests is a net safety gain.

2. **The race hooks are a security finding, not just a style question.** Six
   setters that let a caller inject behaviour into a credential-authority write
   path are exported from a package's public `.d.ts`. Whatever is decided about
   the pattern, that specific fact should be fixed this week.

3. **No fake would have caught the EPERM bug, and no amount of test discipline
   substitutes for running the live layer on the target platform.** The tests
   were not merely absent — they *asserted the wrong rule* and certified a
   product that could not run on Windows at all. The structural fix is R2.5:
   make platform behavior a pure table testable everywhere, so that the
   irreducibly platform-specific surface shrinks to one visible, skip-annotated
   live-seam test per fact.
