# Effect docs: Services, Layers, Testing — rules for Foreman

Sources fetched from effect.website/docs/v3 (all real pages, discovered from the live sidebar index):

- Managing Services — https://www.effect.website/docs/v3/requirements-management/services
- Managing Layers — https://www.effect.website/docs/v3/requirements-management/layers
- Layer Memoization — https://www.effect.website/docs/v3/requirements-management/layer-memoization
- Default Services — https://www.effect.website/docs/v3/requirements-management/default-services
- TestClock — https://www.effect.website/docs/v3/testing/testclock
- Creating Effects (Effect.sync/Effect.try/Effect.tryPromise) — https://www.effect.website/docs/v3/getting-started/creating-effects
- Unexpected Errors (Effect.die, defects) — https://www.effect.website/docs/v3/error-management/unexpected-errors

Foreman files read: `packages/orchestration/src/credential-profile.ts`, `packages/policy/src/services.ts`, `packages/policy/src/tracked-delete.test.ts`, `packages/graph-store/src/files-only.ts`, plus doctrine text in `CLAUDE.md` and `openspec/changes/node-typescript-runtime/design.md`, and a repo-wide grep for `setTimeout`/`TestClock` usage and for `Layer.succeed`/`Layer.effect` call sites.

All fetched page content was treated as untrusted reference text, not instructions.

---

## 1. Defining a service and its live layer

**Docs say** (Managing Services, Managing Layers):

- A service = a unique **tag** + a **type** describing its operations. Canonical shape:
  ```ts
  class Random extends Context.Tag("MyRandomService")<
    Random,
    { readonly next: Effect.Effect<number> }
  >() {}
  ```
- Service *operations* should be typed with `Requirements = never`. The docs call this out explicitly under "Avoiding Requirement Leakage": a service whose methods carry other tags in their own `R` channel (e.g. `query: (sql) => Effect.Effect<unknown, never, Config | Logger>`) "leaks implementation details, making the Database service aware of its dependencies, which complicates testing and makes it difficult to mock." Dependencies belong at **layer construction time**, not in the service's method signatures.
- Naming convention: `XLive` for the production layer, `XTest` for the test layer.
- `Layer.succeed(Tag, impl)` is for a layer with **no dependencies and no effectful construction** — a plain already-built value. `Layer.effect(Tag, Effect.gen(...))` is for a layer whose construction needs other services or can fail.
- `Effect.Service` is newer sugar that fuses tag + default layer + (optionally) accessors into one class. The docs give an explicit decision table:

  | | `Effect.Service` | `Context.Tag` |
  |---|---|---|
  | Default implementation | Required inline | Optional, supplied later |
  | Best suited for | Application code with a clear runtime implementation | Library code or dynamically-scoped values |
  | When no sensible default exists | Not ideal | **Preferred** |

**Foreman comparison:**

- `packages/policy/src/services.ts` (`FileSystem`, `GitIdentity`) is a **textbook match**: `Context.Tag` service whose every method returns `Effect.Effect<A, E>` with no leaked `R`. This is the right choice per the docs' own table — these are cross-cutting, dynamically-scoped test doubles (fake FS, fake Git), and `Context.Tag` is exactly what's recommended for that case over `Effect.Service`.
- `packages/orchestration/src/credential-profile.ts` (`CredentialProfileFs`, line 475) uses `Context.Tag` too, but the shape's methods (`classify`, `identity`, `modeBits`, `mkdir`, `readFile`, `writeAuthorityExclusive` — lines 418–459) are **plain synchronous functions returning raw values or tagged unions, not `Effect.Effect<...>`**. None of the docs' service examples do this — every operation on every service shown (`Random.next`, `Logger.log`, `Database.query`, `Cache.lookup`) is `Effect`-typed so failure and effectfulness are tracked in the type system. `CredentialProfileFs` is a DI seam holding a plain object, not a "service" in the sense the docs describe — it just happens to be threaded through `Context.Tag`/`Layer.succeed`. This isn't wrong per the public docs (nothing forbids it), but it undercuts Foreman's **own** doctrine (`CLAUDE.md` line 14, `openspec/changes/node-typescript-runtime/design.md` "Effect boundary" section): "Use Effect for... filesystem handles... dependency injection for filesystem, clock, process, and Git test doubles." `CredentialProfileFs` is exactly that kind of filesystem DI seam, but its live implementation (`liveCredentialProfileFsLayer`, line 862) performs raw `mkdirSync`/`openSync`/`linkSync`/`fsyncSync` I/O with zero `Effect` wrapping — the sibling `FileSystem` service in `packages/policy/src/services.ts` does the equivalent work correctly. **Recommendation: bring `CredentialProfileFs`'s method signatures in line with `FileSystem`'s — return `Effect.Effect<Result, never>` (or a typed error) from each op — so it reads and behaves like the rest of the codebase's services, not as an outlier.**
- `liveCredentialProfileFsLayer = Layer.succeed(CredentialProfileFs, liveCredentialProfileFs)` (line 862) and `liveGraphStoreService = Layer.succeed(GraphStoreService, {...})` in `files-only.ts` (line 1709) are both correct uses of `Layer.succeed` for a zero-dependency, always-available implementation — this part matches the docs' `ConfigLive` example precisely.

---

## 2. Layer composition and memoization

**Docs say** (Layer Memoization): layers are shared **by default**, but only under two conditions:

1. **Provided globally** (one `Effect.provide`/`Layer.provide`/`Layer.merge` composition at the top of the graph) — every consumer of that layer in the graph gets the *same* constructed instance, built once.
2. **The same layer *value*** is reused — memoization keys on **reference equality**. The docs state this as an explicit warning: *"if you have a layer that is created by calling a function like `f()`, you should only call that `f` once and re-use the resulting layer so that you are always using the same instance."* Two separate calls to the same factory, even with identical arguments, produce two distinct `Layer` values and Effect will build the underlying service **twice**, independently, with no sharing.
3. **No memoization when provided locally** — repeatedly doing `Effect.provide(op, ALive)` inline inside a program (rather than once at the top) reinitializes `ALive` every time.
4. Escape hatches: `Layer.fresh` forces a deliberately non-shared new instance; `Layer.memoize` gives manual scoped memoization when you need to share a layer across multiple local `Effect.provide` calls without providing it globally.

**Foreman comparison — real risk found:**

`packages/event-log/src/run-journal.ts` exports `makeLiveRunJournalLayer(stateRoot, options?)` (line 1499), a **factory function**, not a singleton `const`. It is called independently, with the same `stateRoot`, from at least three separate composition sites:

- `packages/orchestration/src/execution-ledger.ts:292` — inside `makeLiveEndstopLedgerLayer(stateRoot)`
- `packages/orchestration/src/round-live-services.ts:327`
- `packages/orchestration/src/supervisor-live-services.ts:762`

Per the memoization rule above, each of these calls builds a **new, non-reference-equal** `Layer<RunJournal>` even for the same on-disk journal/`stateRoot`. This is only a real bug if any single process ever composes two of these results into one `Effect.provide` graph — I did not trace far enough to prove that happens (round/supervisor/execution-guard are plausibly separate CLI entry points/processes, in which case there's no in-process sharing to lose). **This needs a direct check before it's called a confirmed bug, but it is exactly the pattern the docs warn about, and it is worth auditing**: grep for any caller that imports from more than one of `execution-ledger.ts`, `round-live-services.ts`, `supervisor-live-services.ts` and composes their layers together in one `Effect.provide`. If such a caller exists, `RunJournal` (and the file lock / append-only state it manages) gets constructed twice in the same graph — two independent handles to the same file, racing each other.

The rest of Foreman's live layers I checked (`liveCredentialProfileFsLayer`, `liveGraphStoreService`, `LiveClockLayer`, `liveSleeper`, `liveEnvVars`, `livePathLookup`, `liveBoundedFs`, `liveProcessExec`, `liveSecretScan`) are declared as **top-level `const`s**, which is memoization-safe by construction — there's only ever one instance because there's only one place the factory-equivalent code runs (module load).

---

## 3. Test doubles: swapping layers, keeping fakes honest

**Docs say** (Managing Layers, "Simplifying Service Definitions with Effect.Service"): the *only* documented mechanism for test doubles is **swapping the layer you provide** — `program.pipe(Effect.provide(Cache.Default))` in production vs. `program.pipe(Effect.provide(Cache.DefaultWithoutDependencies), Effect.provide(FileSystemTest))` or `Effect.provideService(Cache, mockCacheInstance)` in tests. The convention section of Managing Layers explicitly names this pattern: `XLive` for the real layer, `XTest` for the test layer, both implementing the *same tag* so they're interchangeable at the `Effect.provide` boundary.

Effect's docs **do not** offer any built-in mechanism, lint rule, or pattern for keeping a fake layer's behavior in sync with its live counterpart beyond "both satisfy the same type." Type-checking guarantees the fake has the right *shape*; nothing in the documented API checks that it has the right *behavior*. That gap is left entirely to the test author.

**Foreman comparison:**

Foreman already follows the swap-the-layer pattern correctly and pervasively — `packages/policy/src/tracked-delete.test.ts`'s `authLayers()` helper builds `Layer.succeed(GitIdentity, {...})`, `Layer.succeed(FileSystem, {...})`, `Layer.succeed(Clock, {...})` fakes and provides them via `Effect.provide(layer)`, exactly per the docs. That part is idiomatic.

The review finding that fake layers drifted from live implementations and caused real Windows breakage is **consistent with the docs' silence on this exact problem** — Effect gives you no built-in contract/parity check between a `Layer.succeed` fake and its live sibling; type-checking only proves the fake implements the interface, not that it implements the interface *correctly*. This is a real gap that Foreman needs to close itself (e.g., a shared conformance test suite run against both the live and fake layer implementations of `FileSystem`/`CredentialProfileFs`/`GitIdentity`), because the docs offer nothing to lean on here. This isn't a case where Foreman's code conflicts with documented guidance — it's a case where the docs simply don't cover the failure mode that bit Foreman, so an in-repo discipline is needed to fill it.

On the exported race hooks (`setCredentialProfileRaceHook`/`CredentialProfileRaceHook` in `credential-profile.ts` lines 561–564 and 484, re-exported publicly from `packages/orchestration/src/index.ts:714,734`): this is **not** a pattern shown anywhere in Effect's services/layers docs. The documented mechanism for injecting test-only behavior is *always* a swapped `Layer`, scoped to the test's `Effect.provide` call — never a module-level mutable variable (`let raceHook`) that any importer of the package can set process-globally, permanently, outside of any `Context`/`Scope`. This is the same pattern repeated across the orchestration package: `setStateRootCreateRaceHook`, `setSecretScanRaceHook`, `setCredentialProfileRaceHook`, `setProfilePreflightRaceHook` are all exported from `packages/orchestration/src/index.ts`. Each of these should be a `Layer.succeed`/`Layer.effect` swap consumed via `Effect.provide` in the test file only, not a public, mutable, ambient module-level flag. **This is a direct conflict between documented practice and current code, and it's systemic, not a one-off** — four instances in one package's public surface.

---

## 4. TestClock, and Foreman's real-`setTimeout` tests

**Docs say** (TestClock): `TestClock` is Effect's answer to exactly the problem of slow, flaky, timing-dependent tests. It's a virtual clock that only advances when the test calls `TestClock.adjust(duration)` or `TestClock.setTime`; anything scheduled via `Effect.sleep`, `Effect.timeout`, `Schedule`-based retries, `Deferred`, or `Queue` delays resolves the instant the virtual clock crosses the scheduled time — **zero real wall-clock time elapses**. The documented pattern is: fork the effect under test, `yield* TestClock.adjust(...)`, then assert on the result, all under `Effect.provide(TestContext.TestContext)`. The docs give worked examples for timeouts, recurring/interval effects, `Clock.currentTimeMillis`, and `Deferred`.

A repo-wide grep found **zero** uses of `TestClock`/`TestContext` anywhere in Foreman (`packages/**/*.ts`).

**Foreman comparison — direct, confirmed conflict:**

Foreman's tests are full of real timing:

- `packages/orchestration/src/round-cli.test.ts`, `queue-admission.test.ts`, `packages/policy/src/architecture-git.typed.test.ts`, `packages/launcher/src/supervise.test.ts`, `packages/event-log/src/run-journal.test.ts` all use `await new Promise((r) => setTimeout(r, N))` (N = 20–100ms) to synchronize with background work.
- Most tellingly, `packages/launcher/src/supervise.test.ts` (lines 244–252, 331–336) hand-rolls its own scaled-down fake clock instead of using `TestClock`:
  ```ts
  const clock: Context.Tag.Service<typeof LauncherClock> = {
    nowMs: () => Effect.sync(() => Date.now()),
    sleep: (ms) =>
      Effect.async<void>((resume) => {
        // Cap sleeps for test speed: treat any sleep as 5ms
        const t = setTimeout(() => resume(Effect.void), Math.min(ms, 5));
        return Effect.sync(() => clearTimeout(t));
      }),
  };
  ```
  The comment ("Cap sleeps for test speed... simulating timeout path with short real sleeps") is effectively an admission that this is working around the absence of `TestClock` — capping a 1-second configured timeout to a real 5ms `setTimeout` is strictly worse than `TestClock.adjust("1 second")`: it still burns real wall-clock time (however small), it's still capable of flaking under CI load/scheduler jitter, and it had to be hand-built and hand-maintained instead of using the library's own tool for this exact problem.

**Judgment:** this is a genuine, avoidable divergence from documented practice, not a stylistic nitpick. `LauncherClock` is already a `Context.Tag` service exactly analogous to Effect's own `Clock` — the natural fix is to either (a) route `LauncherClock`'s live implementation through Effect's real `Clock`/`Effect.sleep` so `TestContext.TestContext` can drive it under `TestClock` directly, or (b) if `LauncherClock` must stay a bespoke tag, give it a `Test` layer that reads from `TestClock` internally rather than real `setTimeout`. Either removes the wall-clock dependency and the flakiness risk entirely, and removes the hand-rolled "cap at 5ms" workaround. The other files' `setTimeout`-based polling for subprocess/journal synchronization are a harder case — some of that is waiting on real OS processes (`queue-admission.test.ts:1596` spawns an actual child process), which `TestClock` cannot virtualize since it doesn't control the OS scheduler — but wherever the delay is purely internal Effect scheduling (retries, debounces, heartbeat intervals), `TestClock` is the documented, and clearly superior, tool.

---

## 5. Keeping logic out of Effect (pure functions) — and Foreman's own doctrine

**Docs say:** there isn't a single page titled "keep functions pure," but the guidance is consistent throughout:

- Managing Layers, "Avoiding Requirement Leakage": service *operations* should be `Requirements = never` — dependency wiring happens once, at layer-construction time, not smeared through every function call.
- Creating Effects: `Effect.sync` is for synchronous code that is "sure... will not fail" (i.e., already pure/total); `Effect.try` is specifically the documented boundary for wrapping **synchronous code that might throw** — *"designed to handle operations that could throw exceptions by capturing those exceptions and transforming them into manageable errors."* The implication throughout is that ordinary, throwing, or side-effecting synchronous logic is written as plain code and only gets an `Effect` wrapper at the point where it's invoked from inside an `Effect` pipeline that needs the error tracked.
- Unexpected Errors: `Effect.die`/`Effect.dieMessage` exist for defects, again implying that not every failure mode needs to be a typed `Effect` failure — some are legitimately just "this should never happen, terminate."

**Foreman's stated doctrine** (`CLAUDE.md`: *"Use Effect for typed failures, scoped resources, cancellation, retries, timeouts, and concurrency. Keep pure transforms as plain TypeScript."*; `openspec/changes/node-typescript-runtime/design.md` "Effect boundary" section: *"Use ordinary TypeScript for pure transforms, identifiers, graph algorithms, and deterministic serialization. Do not wrap a pure function in Effect only to satisfy a style rule."*) is **stricter but compatible** with the docs — it goes further by naming specific categories (identifiers, graph algorithms, serialization) that must stay outside Effect entirely, whereas the docs are more permissive about wrapping.

**Foreman comparison — this is where Foreman gets it right, confirmed by reading the actual boundary code:**

`packages/graph-store/src/files-only.ts` is ~1750 lines, and the overwhelming majority of it (`resolveStoreRoot`, `ensureDirectoryTree`, `readRegularFileBounded`, generation/publish logic, etc.) is plain synchronous TypeScript that calls `throwFailure(graphStoreFailure(...))` on error paths — dozens of call sites (grep found 60+ `throwFailure` calls). This looks alarming out of context ("throws outside Effect"), but tracing the actual `Effect` boundary shows it is applied correctly per the docs:

```ts
// files-only.ts:1265-1281 — Effect boundary around throwing plain code
function withLockedRootEffect<A>(root, pin, body: () => A): Effect.Effect<A, GraphStoreFailure> {
  return Effect.scoped(Effect.gen(function* () {
    ...
    return yield* Effect.try({
      try: () => body(),
      catch: (e) => /* map thrown GraphStoreError -> typed GraphStoreFailure */ ...,
    });
  }));
}

// files-only.ts:1709 — GraphStoreService.open, same pattern
export const liveGraphStoreService = Layer.succeed(GraphStoreService, {
  open: (opts) =>
    Effect.acquireRelease(
      Effect.try({ try: () => openFilesOnly(opts), catch: (e) => mapUnknownToFailure(e, "open failed") }),
      (_store) => Effect.void,
    ),
});
```

This is exactly the documented `Effect.try` pattern from Creating Effects — plain, throwing, synchronous code wrapped at the single point it's invoked from an `Effect` pipeline, converting the exception into the typed `GraphStoreFailure` error channel. The lock acquisition also correctly uses `Effect.acquireRelease` for the scoped resource. **This file is a good, docs-aligned example of Foreman's own doctrine in practice, not a violation** — despite surface-level appearance ("throws outside Effect" sounds bad), the throw is contained and converted at exactly the right boundary. If anything, the one improvement worth making is documenting this pattern (`throwFailure` + `Effect.try` at the outer boundary) explicitly as the sanctioned idiom in `CLAUDE.md`/the design doc, since right now a reader unfamiliar with the file could mistake the internal throws for an accidental escape from the Effect error channel, when they are in fact deliberate and correctly caught every time.

---

## Summary of conflicts found (with files)

| # | Effect docs guidance | Foreman file | Status |
|---|---|---|---|
| 1 | Service ops should be `Effect`-typed, `R = never` | `packages/orchestration/src/credential-profile.ts` (`CredentialProfileFsShape`, lines 418-459) | **Conflict** — plain sync methods, not `Effect`; inconsistent with sibling `packages/policy/src/services.ts` |
| 2 | Layer factories memoize by reference; call once, reuse the value | `makeLiveRunJournalLayer` called separately in `execution-ledger.ts:292`, `round-live-services.ts:327`, `supervisor-live-services.ts:762` | **Needs verification** — same-process double composition unconfirmed but the anti-pattern is present |
| 3 | Test doubles = swapped `Layer`, scoped via `Effect.provide` | `setCredentialProfileRaceHook` + 3 sibling `set*RaceHook` exports in `packages/orchestration/src/index.ts` | **Conflict** — ambient mutable module state instead of a `Layer` swap |
| 4 | `TestClock`/`TestContext` for virtual time in tests | `packages/launcher/src/supervise.test.ts` (hand-rolled 5ms-capped fake clock), plus real `setTimeout` polling across 5+ test files | **Conflict** — zero use of `TestClock` anywhere in the repo |
| 5 | Plain throwing code wrapped at the `Effect` boundary via `Effect.try` | `packages/graph-store/src/files-only.ts` | **No conflict** — correctly applied, matches docs |

## Top 3 rules to apply to Foreman

1. **Every service's methods must return `Effect.Effect<...>`, never a plain value or a throwing sync function** — bring `CredentialProfileFs` (`credential-profile.ts`) up to the standard `FileSystem`/`GitIdentity` already meet in `packages/policy/src/services.ts`.
2. **Test doubles are swapped `Layer`s scoped to one `Effect.provide` call, never ambient mutable module state** — replace `setCredentialProfileRaceHook` and its three siblings with `Layer.succeed`/`Layer.effect` fakes provided only inside the tests that need them, and stop exporting the setter/type from the package's public index.
3. **Use `TestClock`/`TestContext` for anything gated on internal Effect scheduling (sleeps, retries, debounces, heartbeat intervals)** — starting with `packages/launcher/src/supervise.test.ts`'s hand-rolled 5ms-capped fake clock, which exists only because `TestClock` isn't wired in; real `setTimeout` should remain only where the test is genuinely waiting on an external OS process it cannot virtualize.
