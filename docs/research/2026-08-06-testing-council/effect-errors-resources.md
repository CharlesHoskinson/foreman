# Effect error management & resource safety — applied to Foreman

Sources are the official Effect docs (v3), fetched from `https://www.effect.website/docs/v3/...`. All fetched content was treated as untrusted data; no instructions found in it were followed. Target files read from the WSL checkout at `/root/fm-hyg/foreman`.

---

## 1. Expected errors vs. defects vs. interruption — and where Foreman's "rethrow outside Effect" sits

**Doc source:** `error-management/two-error-types`, `error-management/expected-errors`, `error-management/unexpected-errors`, `data-types/cause`.

Effect's model has exactly three failure kinds, all folded into `Cause<E>`:

- **Expected errors** ("failures", "typed errors") — tracked in the `Effect<Success, Error, Requirements>` error channel `E`. Created with `Effect.fail`, unioned automatically when a program can fail multiple ways, and meant to be handled with `Effect.catchAll` / `Effect.catchTag` / `Effect.either`.
- **Unexpected errors** ("defects") — *not* tracked at the type level. Created with `Effect.die`/`Effect.dieMessage`, or by converting a failure with `Effect.orDie`. The docs are explicit: *"There is no sensible way to recover from defects. The functions we're about to discuss [`catchAllDefect`, `catchSomeDefect`] should be used only at the boundary between Effect and an external system, to transmit information on a defect for diagnostic or explanatory purposes."*
- **Interruption** — a third `Cause` variant (`Cause.Interrupt`), distinct from both `Fail` and `Die`, carrying the interrupting `FiberId`.

`Cause<E>` additionally has `Sequential` and `Parallel` combinators for stacking multiple causes (e.g., a `try`/`finally` where both branches fail, or two fibers failing concurrently).

**Foreman's pattern** (`packages/graph-store/src/files-only.ts`, `withEffectLockSync` / `withLockedRootEffect`):

```
Effect.runSync(Effect.either(withLockedRootEffect(root, pin, body)))
```

`body()` is plain synchronous code that raises domain failures via a raw JS `throw` (`throwFailure`, defined in `failures.ts`). `Effect.try` lifts that throw into the `E` channel; `Effect.either` turns the resulting `Effect<A, GraphStoreFailure>` into `Effect<Either<A, GraphStoreFailure>, never>`; `Effect.runSync` on that *never-failing* effect cannot throw a `FiberFailure`; the wrapper then manually re-throws `result.left` as a typed `GraphStoreError` subclass.

**Verdict: idiomatic-with-adaptation, not a workaround.** The `Effect.either` step is exactly the documented idiom for "I don't want this failure propagated as an unhandled fiber failure" (`expected-errors` §"Catching All Errors › either": *"The resulting effect cannot fail because the potential failure is now represented within the Either's Left type"*). Running `Effect.runSync`/`Effect.runPromise` on an effect with an **unhandled** `E` is what produces the `FiberFailure` wrapper Foreman is avoiding — the docs' own answer to that is to neutralize the error channel with `Effect.either`/`Effect.exit` *before* running, which is what this code does. The one real deviation is using a bare `throw` + `Effect.try` as the *primary* way domain code enters the `E` channel, rather than writing that logic as `Effect.gen`+`yield* Effect.fail` throughout. That's defensible here because `body()` (`loadCurrentGeneration`, `publishSnapshot`, etc.) is intentionally plain synchronous code, not an Effect program — `Effect.try` is exactly the documented bridge for lifting "a possibly-throwing synchronous computation" into Effect, so this is consistent rather than contradictory. Recommend only that the comment already present (`"Domain failures are rethrown as typed GraphStoreError subclasses outside Effect so callers never observe FiberFailure wrappers"`) be treated as the canonical justification and copied to `credential-profile.ts`/`tracked-delete.ts` if similar patterns appear there later — those two files instead avoid the problem a different way (see §2), by never letting the `E` channel fail at all.

**Rule for Foreman:** When a package's public surface is a synchronous function or a CLI (not an Effect-returning API), it is fine to run Effect internally and translate at the edge with `Effect.either`/`Effect.exit` + a manual re-throw — but do this at *one* boundary per public entry point, not ad hoc per call site, and keep the "why" comment next to the boundary function (already true in `files-only.ts`).

---

## 2. Tagged errors: closed failure-reason sets

**Doc source:** `error-management/yieldable-errors`, `error-management/expected-errors` (`catchTag`/`catchTags` sections).

Effect's documented way to model a closed set of failure reasons is **one `Data.TaggedError` class per reason**, each carrying a `_tag` discriminant automatically:

```ts
class HttpError extends Data.TaggedError("HttpError")<{}> {}
class ValidationError extends Data.TaggedError("ValidationError")<{}> {}
// Effect<string, HttpError | ValidationError, never>
```

This lets `Effect.catchTag("HttpError", handler)` / `Effect.catchTags({...})` dispatch on the type-level union with TypeScript narrowing, and lets a program's error type shrink (union member removed) as each tag is handled — visible in the type signature.

**Foreman's pattern is structurally different**: `GraphStoreFailure` (`packages/graph-store/src/failures.ts`) is *one* branded shape with a constant `_tag: "GraphStoreFailure"` and a 28-member string union in a `reason` field. `CredentialProfileRefusalReason` (`credential-profile.ts`, 11 members) and `DenialReason` (`tracked-delete.ts`) are the same shape: a closed string union carried as a field inside a `{_tag: "Refused"|"Denied"|"Failed", reason}` result value, not as distinct Effect tagged-error classes.

**Should these become tagged errors? Mostly no, and here's the reasoning, not just the conclusion:**

- None of these three call sites actually run `.reason` through `Effect.catchTag`. `tracked-delete.ts`'s `deleteTracked` has signature `Effect.Effect<TrackedDeleteResult, never, ...>` — every failure, including internal git/fs errors, is folded into the **success** channel as a `Denied`/`Failed` value before the function returns. That is itself a documented idiom (`Effect.either`'s stated purpose: "encapsulates both potential failure and success" so a program becomes non-failing), just implemented with a hand-rolled ADT instead of `Either`. Since nothing downstream ever needs `catchTag`-style dispatch on these values (they're inspected with an exhaustive `switch`, already using the `const _e: never = x` exhaustiveness idiom in `credential-profile.ts`'s `readAuthority`), the tagged-error machinery would add ceremony without adding capability.
- The reason-union shape is also the **wire contract** — `renderCredentialProfileJson`/`canonicalize` serialize these directly to stdout as canonical JSON. `Data.TaggedError` instances are `Error` subclasses with non-enumerable-by-default internals; canonicalizing them to deterministic JSON is more friction than a plain closed-union object, so the current shape is the right one for that purpose specifically.

**Where it does matter:** inside `files-only.ts`'s Effect-level plumbing (`acquireLockEffect`, `withLockedRootEffect`), the error channel is `GraphStoreFailure` — a plain object, not a `Data.TaggedError`. If any future code wants `Effect.catchTag`/`Effect.catchIf` to short-circuit or retry specific `reason`s at the Effect-combinator level (e.g., retry only on `"store_busy"`, never on `"corrupt_state"`), it currently has to reach through the flattened `Either` by hand — `Data.TaggedError` (or at least giving `GraphStoreFailure` a discriminant on `reason` rather than a constant `_tag`) would make that composable. **Recommendation:** leave the JSON-facing reason-union types as they are; if `graph-store` ever grows Effect-level retry/branching on specific failure reasons, promote `GraphStoreFailure` to a `Data.TaggedError`-per-`reason` (or a `Data.TaggedError` wrapping the existing reason union) at that point, not before.

---

## 3. `Cause`, defects, and the `RangeError` bug

**Doc source:** `data-types/cause`, `error-management/unexpected-errors`, `error-management/sandboxing`.

`Cause<E>` distinguishes `Fail<E>` (expected), `Die` ("a failure resulting from a defect, which is an unexpected or unintended error"), and `Interrupt`. The docs' guidance on `die` vs `fail` is unambiguous: `Effect.fail` is for errors the program's author anticipated and wants tracked/handled as part of the domain; `Effect.die` is for conditions "not... handled as regular errors but instead represent unrecoverable defects" — and `catchAllDefect`/`catchSomeDefect` exist only for logging/diagnostics at a system boundary, never for recovery.

**Applying this to the `RangeError` defect.** I read the actual implementations (`packages/core/src/canonical-json.ts`):

- `parseJsonRejectDuplicateKeys` is a hand-written recursive-descent parser (`parseValue` → `parseObject`/`parseArray` → `parseValue` ...) with **no recursion-depth guard**.
- `canonicalize` is likewise unbounded recursion over the value tree.
- `packages/graph-store/src/bounds.ts` defines `MAX_JSON_DEPTH = 64`, but that bound is enforced by `countJsonNodes` in `files-only.ts`, which runs **after** `parseJsonRejectDuplicateKeys` has already fully parsed the text (`parseCanonicalJsonBytes`: parse → depth/node-count check). A sufficiently deeply nested payload (e.g., thousands of nested arrays) overflows the JS call stack inside the parser itself, before `MAX_JSON_DEPTH` is ever consulted — confirming the review's finding exactly.

By Effect's own vocabulary, an unguarded stack overflow is a textbook **defect**: unanticipated by the function, not part of its documented contract, "unrecoverable." But that classification is the wrong one for *this* codebase's own stated design: `MAX_JSON_DEPTH`, `MAX_JSON_NODES`, `MAX_TRAVERSAL_STEPS`, `MAX_ROOT_FILES`, `MAX_FILE_BYTES` — the entire neighborhood of `graph-store` and `core` — exists specifically to convert every input-shaped resource exhaustion into a **typed, expected `CoreFailure`/`GraphStoreFailure`**, on the premise that untrusted input size is always anticipated, never a "surprise." Given that design intent, deep nesting is not a defect by Foreman's own standard — it's exactly the kind of thing `Effect.fail`-equivalent (a returned `CoreFailure`) exists for, and the current behavior is a genuine bug relative to the codebase's own architecture, not merely a style gap versus Effect's docs.

It is also **worse** than an ordinary Effect defect would be: these are plain synchronous functions, not Effects. A `RangeError` here isn't wrapped in a `Cause` with `Cause.isDie`/`catchAllDefect` recoverability at a controlled boundary — it's a raw uncaught JS exception. Depending on the call site (some are inside `Effect.try`, e.g. `parseCredentialProfileRecordBytes`'s caller path in `credential-profile.ts`'s `parseCredentialProfileRecordBytes` is plain `try/catch`, not Effect at all — verify per call site), it may not be caught by anything and can crash the process rather than surfacing as a `GraphStoreFailure`/`CoreFailure`.

**Rule for Foreman:** Add an explicit depth counter threaded through `parseValue`/`parseObject`/`parseArray` in `parseJsonRejectDuplicateKeys`, and through `canonicalize`, that fails closed (return an existing or new `CoreFailure` variant, e.g. extend `invalidJson()` or add `maxDepthExceeded()`) the instant depth exceeds a bound — mirroring the bound already declared in `bounds.ts` (`MAX_JSON_DEPTH`) rather than relying on a downstream node-count pass that runs too late to help. This turns a process-crashing defect into the same `Either`-shaped expected failure every neighboring function already produces, consistent with Foreman's existing fail-closed posture.

(The BOM-stripping issue in `decodeUtf8Fatal`, `packages/core/src/utf8.ts` — `new TextDecoder("utf-8", { fatal: true })` defaults to `ignoreBOM: false`, i.e. it *silently drops* a leading U+FEFF — is not a `Cause`/defect question at all; it's a correctness bug: `fatal: true` only rejects malformed byte sequences, it says nothing about BOM handling, so a digest computed over raw bytes and a digest computed over `decodeUtf8Fatal(bytes)`-then-re-encoded text disagree whenever the input has a BOM. Fix is orthogonal to error management: pass `{ fatal: true, ignoreBOM: true }`, or explicitly strip/preserve the BOM as a conscious decision.)

---

## 4. Resource safety: `acquireRelease`, `Scope`, finalizer ordering, interruption

**Doc source:** `resource-management/introduction`, `resource-management/scope`.

Documented guarantees:
- `Effect.acquireRelease(acquire, release)` — acquisition is **uninterruptible** ("to ensure that partial resource acquisition doesn't leave your system in an inconsistent state"), and release is guaranteed to run "when the `Scope` is closed," for every `Exit` outcome — success, failure, *or interruption* (the docs show all three explicitly, including an "Adding a Finalizer on Interruption" example).
- Finalizers run in **reverse order of registration** — explicit stack-unwind guarantee, illustrated with "acquire a network connection, then a remote file — the file must close before the connection."
- `Effect.scoped` creates a `Scope`, runs the effect, and closes the `Scope` (running finalizers) when the effect finishes.
- `Effect.onExit` cleanup is itself uninterruptible.
- The docs' own worked example — "Example Pattern: Sequencing Operations" (S3 bucket → ElasticSearch index → Database entry; roll back ElasticSearch then S3 if the Database step fails) — is *structurally identical* to what `tracked-delete.ts` hand-builds for file quarantine.

**`files-only.ts`** uses `Effect.acquireRelease` + `Effect.scoped` exactly as documented (`acquireLockEffect`: acquire = `acquireLockSync` wrapped in `Effect.try`, release = `releaseLockSync` wrapped in `Effect.sync`; `withLockedRootEffect` wraps the critical section in `Effect.scoped`). This is textbook-idiomatic and needs no changes.

**`tracked-delete.ts`'s mutation phase** (`runMutationUninterruptible`) does *not* use `Scope`/`acquireRelease` at all. It hand-rolls the same guarantee with `Effect.uninterruptible(...)`, a mutable `state.quarantined` array, `Effect.onExit` (restore quarantines when `exit._tag === "Failure"` and not yet completed), and `Effect.catchAllDefect` (belt-and-suspenders re-restore, with a `state.quarantined = []` guard against double-restoring). Functionally this reconstructs, by hand, exactly the guarantee `Scope`'s finalizer machinery already provides for free: LIFO cleanup, guaranteed under any `Exit` including interruption. Given the file's own comment — *"Uninterruptible acquisition/finalization: after first quarantine, every exit path... uses onExit"* — the authors clearly know the Effect idiom they're approximating.

This is not wrong (the code has clearly been reviewed hard for edge cases — concurrent-replacement detection during restore, double-restore avoidance), but it is a place worth naming explicitly: **each quarantined file is itself a resource with a natural acquire (rename original → quarantine path) / release (rename back unless the whole batch commits)**. Structuring it as one `Effect.acquireRelease` per target — each release conditioned on the final `Exit` via `Effect.addFinalizer`'s documented `Exit`-aware behavior — composed under a single `Effect.scoped`, would let Scope's tested LIFO/interruption-safe finalizer ordering do the heavy lifting that `state.quarantined`/`onExit`/`catchAllDefect` currently do by hand. Given the operation is an irreversible batch file-delete (the highest-stakes code in this review), reducing the amount of hand-written state-machine logic in favor of a documented, tested primitive is worth doing, or at minimum worth a comment cross-referencing why the manual approach was chosen over `Scope` (e.g., if per-target `acquireRelease` composition couldn't express the "recheck path chain / recheck identity immediately before *each* rename" ordering that's interleaved with the acquire step here — plausible, since Effect's acquire step for `acquireRelease` doesn't have a hook for "recheck, then acquire the *next* one only if this one's recheck passed inside the same uninterruptible region" as naturally as a manual loop does).

The Windows directory-fsync gap (`isUnsupportedDirectoryFsync` in `files-only.ts`, `WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES` in `credential-profile.ts`) is outside Effect's contract entirely — Scope guarantees a finalizer *runs*, not that an OS-level durability barrier inside it succeeds — so there's no conflict there; Foreman's narrow, documented platform exception is the correct layer to handle it at.

---

## 5. Retry and timeout composition, and the documented traps

**Doc source:** `error-management/retrying`, `error-management/timing-out`.

- `Effect.retry(effect, schedule)` / `Effect.retryOrElse` retry per a `Schedule` policy; the docs frame retrying as being for **transient** failures ("network issues, resource unavailability, or external dependencies").
- `Effect.timeout(effect, duration)` — the key documented trap: behavior differs by whether the wrapped effect is interruptible. **Interruptible**: cut short immediately at the deadline, `TimeoutException` raised right away. **Uninterruptible**: *the timeout does not stop the effect* — it keeps running to completion, and the `TimeoutException` is only reported after that completion. The docs state this outcome plainly with a side-by-side example (2s sleep, 1s timeout: interruptible case reports failure at ~1s; uninterruptible case logs "Processing complete." at 2s, *then* reports the timeout).
- `Effect.disconnect` is offered specifically to let an uninterruptible effect keep running **in the background** past a timeout, so the caller's control flow isn't blocked — at the cost of no longer waiting for (or observing) that effect's own outcome.

**Applying this to Foreman:** `tracked-delete.ts` deliberately wraps its irreversible rename/unlink phase in `Effect.uninterruptible`. Per the docs' trap above, if any caller ever wraps `deleteTracked` (or `runMutationUninterruptible`) in `Effect.timeout`, the timeout will **not** cut the mutation short — it will simply be reported late, after the uninterruptible phase finishes on its own. For this specific operation that is the *correct* and presumably intended behavior (you never want a partial file-quarantine abandoned mid-flight because a timeout fired), but right now it's an emergent property of composing two primitives rather than a stated invariant. **Recommendation:** add a one-line comment at the `Effect.uninterruptible(...)` call site in `tracked-delete.ts` noting that any future `Effect.timeout` around this call will report late by design, per Effect's documented interruptible/uninterruptible timeout semantics — so nobody "fixes" a slow-timeout complaint by making the mutation phase interruptible, which would reintroduce the exact partial-mutation risk the uninterruptible wrapper exists to prevent.

**A concrete missed opportunity:** none of the three files use `Effect.retry`/`Schedule` at all. The one place Foreman *does* retry — `acquireLockSync` in `files-only.ts` — implements it as a hand-written busy-wait: `while (Date.now() < end) { /* spin */ }` inside a `for` loop bounded by `MAX_LOCK_RETRIES = 2_000` and `STORE_LOCK_BOUND_MS = 10_000` (`packages/graph-store/src/bounds.ts`). This is a synchronous CPU-burning spin (not a cooperative sleep) precisely because the surrounding code is plain sync, not Effect — but it's exactly the shape `Effect.retry(acquire, Schedule.spaced(...).pipe(Schedule.upTo(...)))` exists to express declaratively, without busy-waiting, and testably via Effect's `TestClock`. If lock acquisition is ever moved (or wrapped) to run as an Effect rather than sync-with-a-hot-loop, replacing the spin with `Schedule` composition would remove real CPU cost under lock contention and make the retry policy's bound and spacing independently testable — worth flagging as a concrete, scoped improvement rather than a rewrite.

---

## Summary of conflicts found (file : issue : doc basis)

| File | Issue | Doc basis |
|---|---|---|
| `packages/core/src/canonical-json.ts` (`parseJsonRejectDuplicateKeys`, `canonicalize`) | Unbounded recursion → raw `RangeError`, not a typed `CoreFailure`; worse, often not even wrapped in Effect so it isn't even a proper `Cause`-carrying defect | `data-types/cause`, `error-management/unexpected-errors` — untrusted input should stay in the expected-error (`fail`) channel, not fall through to an unmanaged native exception |
| `packages/core/src/utf8.ts` (`decodeUtf8Fatal`) | `TextDecoder("utf-8", {fatal:true})` silently drops a leading BOM (`ignoreBOM` defaults false) — byte-digest vs text-digest disagreement | Not an Effect error-management issue per se; flagged because it was in scope — fix by setting `ignoreBOM: true` explicitly |
| `packages/policy/src/tracked-delete.ts` (`runMutationUninterruptible`) | Hand-rolled LIFO quarantine/restore state machine duplicates the guarantee `Scope` + `Effect.acquireRelease` already provide (reverse-order finalizers, guaranteed under any `Exit` including interruption) | `resource-management/scope` — "Example Pattern: Sequencing Operations" is the documented version of this exact rollback shape |
| `packages/graph-store/src/files-only.ts` (`acquireLockSync`) | Busy-wait retry loop instead of `Effect.retry` + `Schedule` | `error-management/retrying` |

No blocking conflict was found in `files-only.ts`'s `Effect.acquireRelease`/`Effect.scoped` usage or in the "rethrow typed failures outside Effect" boundary pattern — both are defensible, doc-consistent adaptations for a codebase whose public surface is synchronous/CLI rather than Effect-native throughout.
