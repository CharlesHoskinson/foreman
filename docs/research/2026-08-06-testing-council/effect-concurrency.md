# Effect Concurrency Best Practices → Rules for Foreman

Sources: effect.website/docs/v3 (fetched 2026-08-06). All Foreman evidence read from WSL
`/root/fm-hyg/foreman` at HEAD on 2026-08-06. `effect` is pinned to **3.22.1** in
`packages/launcher/package.json`, `packages/orchestration/package.json`, and
`packages/graph-store/package.json`.

---

## 1. Structured concurrency: what must be forked in a scope, and what leaks

**Doc source:** `/docs/v3/concurrency/fibers` ("Lifetime of Child Fibers"), `/docs/v3/resource-management/scope`.

Effect's docs state four fiber lifetime strategies, and are explicit about the leak risk of each:

- **`Effect.fork`** (default) — child fiber is *automatically supervised*: its lifetime is tied to
  the parent. It is interrupted when the parent completes or is interrupted. This is structured
  concurrency's default and should be the default choice.
- **`Effect.forkScoped`** — child fiber's lifetime is tied to an enclosing `Scope`, not the parent
  fiber. It can outlive the parent, but is guaranteed to be interrupted when that `Scope` closes.
  Correct choice for "background work that must outlive this specific operation but must still die
  with the surrounding resource lifetime."
- **`Effect.forkIn(scope)`** — same as `forkScoped` but targets an explicitly captured scope rather
  than the ambient one, for fine-grained cross-scope lifetime control.
- **`Effect.forkDaemon`** — child fiber is *unsupervised*, tied only to the **global** scope. It
  survives parent interruption and only stops when it finishes naturally or the process's global
  scope closes. The docs' own daemon example shows the daemon fiber logging indefinitely after the
  parent is interrupted — this is presented as intended behavior, not a leak, but it is the one
  fork variant that will not be cleaned up by any local scope. Using `forkDaemon` where `fork` or
  `forkScoped` was intended is exactly how you leak a fiber: nothing will ever interrupt it except
  process exit.
- The docs also note fiber start timing is non-deterministic ("Do not rely on the idea that a
  single yield always ensures your fiber begins at a particular time") — a correctness trap for
  code that forks and immediately assumes the child has started.

**Rule for Foreman:** any `Effect.fork` inside code that also does `Effect.addFinalizer` must be
matched with an explicit `Fiber.interrupt` in that finalizer (or use `forkScoped`, which does this
automatically) — otherwise the fiber leaks past the scope that looks like it owns it.

**Foreman evidence — matches the doc guidance well:**
`packages/launcher/src/supervise.ts:98` wraps the entire child-process supervision effect in
`Effect.scoped(...)`. Inside, `Effect.fork` is used four times (stdout pump, stderr pump, heartbeat
loop, timeout loop — `supervise.ts:245-246,258,264`), and a single `Effect.addFinalizer`
(`supervise.ts:~270`) explicitly calls `Fiber.interrupt` on every one of those fibers before the
scope closes. This is a textbook application of the "Fork with Automatic Supervision" +
finalizer-based cleanup pattern the docs describe — no `forkDaemon` is used anywhere in
`packages/launcher/src`, so there is no daemon-fiber leak risk in that package.

`packages/graph-store/src/files-only.ts:1246-1259` (`acquireLockEffect`) forks nothing but uses
`Effect.acquireRelease` inside `Effect.scoped` (`withLockedRootEffect`, `files-only.ts:1264-1291`)
— correct use of scope-bound resource acquisition, matching `/docs/v3/resource-management/scope`.

No use of `Effect.forkDaemon` was found anywhere in `packages/launcher/src`,
`packages/orchestration/src`, or `packages/graph-store/src` — so there is currently no daemon-fiber
leak surface in these three packages.

**How concentrated this actually is, confirmed by a full grep sweep of all three package `src`
dirs:** `Effect.fork` appears only at `supervise.ts:245-246,258,264` (four call sites, one file).
`Effect.scoped`/`Scope` appears at `supervise.ts:98` and `files-only.ts:1248,1266,1722` — nowhere
else. `Ref` (Effect's mutable-state primitive, the natural companion to fork-based supervision) is
used only inside `supervise.ts` (`stdoutBytesRef`, `exitedRef`, `timedOutRef`,
`terminationCountRef`, `completedRef`, `timersClearedRef`) — `packages/orchestration/src` has *no*
`Ref` usage anywhere, meaning the queue-admission/round-runtime/resume/credential-profile code has
no Effect-native shared-mutable-state primitive at all. `Effect.all` appears exactly **once** in
the entire three-package surface — `packages/orchestration/src/resume-safety-services.ts:172-179`
— and it is called with a plain two-element array and no `{ concurrency }` option, so it runs
sequentially:
```ts
const [processState, lockState] = yield* Effect.all([
  processProbe.observe(input.processId).pipe(Effect.catchAllDefect(() => Effect.succeed("unknown" as const))),
  lockProbe.observe(input.lockPath).pipe(Effect.catchAllDefect(() => Effect.succeed("unknown" as const))),
]);
```
`Deferred`/`Latch` appear only in **test** files (`packages/launcher/src/supervise.test.ts`), never
in production source. `packages/orchestration/src/round-live-services.ts` and `round-cli.ts` — the
"round runtime" files named explicitly in the task brief — contain no `Effect.fork`, `Effect.all`,
`Fiber`, or `Ref` at all: round execution there is purely sequential `Effect.gen`. Even at the
supervisor layer, `packages/orchestration/src/supervisor.ts:483-490` sweeps every discovered run
**strictly sequentially** in a plain `for` loop inside `Effect.gen`
(`for (const runId of runs) { results.push(yield* sweepOneRun(runId, input.config)); }`) — there is
no fan-out/concurrency at all at that layer either; whatever parallelism exists happens only
downstream, inside the external `pueue` daemon (§3).

---

## 2. Interruption semantics, `uninterruptible`, and finalizers

**Doc source:** `/docs/v3/concurrency/fibers` ("Interruption Model" / "Polling vs. Asynchronous
Interruption"), `/docs/v3/resource-management/scope`, `/docs/v3/error-management/timing-out`,
`/docs/v3/error-management/parallel-and-sequential-errors`.

Key documented rules:

- Effect deliberately rejects *polling*-based interruption (where a fiber checks a flag
  periodically) in favor of **asynchronous interruption**: any fiber can be interrupted at any
  point *except* inside explicitly marked uninterruptible regions. The docs call this "a fully
  asynchronous signaling mechanism" and note polling is "not aligned with the functional paradigm
  followed by Effect."
- **`Effect.acquireRelease`'s acquisition step is uninterruptible by construction** — the docs say
  this explicitly: "The acquisition process is uninterruptible to ensure that partial resource
  acquisition doesn't leave your system in an inconsistent state" (`/docs/v3/resource-management/scope`).
  You do not need to wrap `acquireRelease`'s `acquire` in `Effect.uninterruptible` yourself; it is
  already uninterruptible.
- **Finalizers always run**, regardless of whether the scope closed via success, failure, or
  interruption — including when a finalizer sits inside `Effect.ensuring`. The docs show this
  producing a `Sequential` cause combining the original failure and any finalizer failure/defect
  (`/docs/v3/error-management/parallel-and-sequential-errors`, "Sequential Errors": "the finalizer is
  uninterruptible and will always run").
- **`Effect.timeout` respects uninterruptibility**: if the timed effect is uninterruptible, the
  timeout is only *assessed* after the effect finishes — it does not forcibly cut it off
  (`/docs/v3/error-management/timing-out`, "Handling Timeouts"). To get a timeout that returns
  immediately while an uninterruptible task keeps running in the background, the docs prescribe
  composing `Effect.uninterruptible → Effect.disconnect → Effect.timeout`.

**Judging Foreman's uninterruptible mutation section against this:**

`packages/graph-store/src/files-only.ts` implements cross-process mutual exclusion for
open/publish via a real OS file lock (`acquireLockSync`, `files-only.ts:756-833`, using
`O_CREAT|O_EXCL` plus descriptor/identity validation), wrapped as:

```
files-only.ts:1246
function acquireLockEffect(lockFilePath: string): Effect.Effect<HeldLock, GraphStoreFailure, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({ try: () => acquireLockSync(lockFilePath), ... }),
    (lock) => Effect.sync(() => { releaseLockSync(lock); }),
  );
}
```

and the "critical section" itself (`withLockedRootEffect`, `files-only.ts:1264-1291`) runs the
caller's synchronous `body()` via `Effect.try` inside `Effect.scoped(Effect.gen(...))`, after the
lock is acquired.

This **does** match the docs' guidance in the sense that matters most: acquisition happens through
`Effect.acquireRelease`, which is uninterruptible by the framework's own construction — Foreman did
not need to (and does not) hand-roll `Effect.uninterruptible` around it, and the release finalizer
is guaranteed by the scope.

**Where it deviates from the documented idiom:** `acquireLockSync` itself is a *synchronous
busy-wait retry loop* — `while (Date.now() < deadline && attempts < MAX_LOCK_RETRIES) { ... }`
(`files-only.ts:757-833`), spinning with `STORE_LOCK_SPIN_MS` between `EEXIST` retries. Because
this is plain synchronous JavaScript wrapped in a single `Effect.try`, it blocks the JS event loop
for the entire retry window — Effect's fiber scheduler cannot interleave any other fiber during
that time, and the operation is *not* observable as a sequence of intervals the way
`Effect.retry`/`Schedule` would be. The docs' own retry vocabulary (`/docs/v3/scheduling/introduction`:
"Schedules are defined as a collection of intervals spread out over time") assumes retries are
expressed as effectful, interruption-aware steps — Foreman's lock-acquisition retry is not. This
is a real conflict worth flagging: it is the one uninterruptible-adjacent code path in the audited
packages that is uninterruptible *by accident of blocking synchronous JS* rather than by explicit,
inspectable Effect semantics. Confirmed via `grep -rn 'Effect.retry\|Schedule\.' packages/launcher/src
packages/orchestration/src packages/graph-store/src` (excluding tests) — **zero matches** across all
three packages. No retry logic anywhere in the audited surface goes through `Effect.retry` or
`Schedule`; every retry (the lock spin-loop above, `queue-admission.ts`'s "one classified pre-accept
retry" on add, `cmdEnsure`'s 5-probe pueue-reachability loop) is a hand-written `for`/`while` loop
around `Sleeper.sleep`/`clock.sleep` instead.

**A second, independent uninterruptible-mutation mechanism exists that the original brief didn't
name:** `packages/orchestration/src/credential-profile.ts:459-464` documents an "atomic exclusive
publish" for authority bytes — temp write + `fsyncSync` + **exclusive hard-link publish**
(`linkSync(tmpPath, finalPath)`, never `renameSync` over an existing destination — `EEXIST` from the
link call is the race signal) — implemented at `credential-profile.ts:741-830`
(`liveWriteAuthorityExclusive`). Same pattern as graph-store: OS-level atomicity (`O_EXCL`
temp-file create + atomic hard link) does the actual mutual-exclusion work; Effect is not asked to
mark this region `Effect.uninterruptible` at all — a repo-wide grep for the literal strings
`"uninterruptible"` and `"Effect.uninterruptible"` across all three packages returns **zero hits**.
Foreman's two "critical section" implementations (graph-store's lock file, credential-profile's
hard-link publish) both get their atomicity from POSIX filesystem semantics, not from Effect's
interruption model — which is defensible (the property they need — "no other process/handle can
observe a half-written state" — is exactly what `O_EXCL`/`rename(2)`/hard-links guarantee across
process boundaries, something `Effect.uninterruptible` cannot do since it only governs Effect's own
fiber scheduler within one process), but it does mean the phrase "uninterruptible mutation section"
in Foreman describes an OS-atomicity pattern, not an invocation of Effect's own uninterruptible
region API.

---

## 3. Bounded concurrency: documented mechanism vs. Foreman's vendor caps

**Doc source:** `/docs/v3/concurrency/basic-concurrency` ("Concurrency Options"),
`/docs/v3/concurrency/semaphore`, `/docs/v3/concurrency/latch`.

Effect documents two orthogonal, composable mechanisms:

1. **The `concurrency` option**, accepted by `Effect.all`, `Effect.forEach`, and "many other Effect
   APIs" (the docs' own words): `number | "unbounded" | "inherit"`. `"inherit"` reads from ambient
   context set via `Effect.withConcurrency(n)`, defaulting to `"unbounded"` if never set. This is
   the documented way to cap parallelism for a *batch of effects launched together*.
2. **`Effect.makeSemaphore(n)` + `withPermits(k)`**, for capping parallelism across effects that
   are *not* necessarily launched from the same call site (e.g., a shared resource accessed from
   many independent workflows). The docs are explicit that permits are released "even if the task
   fails or is interrupted," and that a 1-permit semaphore is the idiomatic mutex
   (`/docs/v3/concurrency/latch`: "a semaphore (with one lock) ... is usually for mutual exclusion").

**Foreman's `grok=3, codex=2` caps — is there an Effect-native way to express this? Yes, but Foreman
does not use it.**

```
packages/orchestration/src/queue-admission.ts:32-38
export const FIXED_GROUPS: readonly { name: string; parallel: number }[] = [
  { name: "grok", parallel: 3 },
  { name: "codex", parallel: 2 },
  { name: "misc", parallel: 2 },
  { name: "gate", parallel: 1 },
  { name: "agy", parallel: 1 },
] as const;
```

These numbers are not consumed by any Effect concurrency primitive — they are pushed through as
group definitions to an **external process**, the `pueue` CLI/daemon (v4.0.4, per the file's own
header comment), which enforces the actual parallel-execution cap at the OS-process level.
Confirmed by grep: `Effect.all`, `Effect.fork`, `Semaphore`, `Effect.race`, `Effect.timeout`,
`Effect.retry`, and `Schedule.` all return **zero matches** in
`packages/orchestration/src/queue-admission.ts` and `packages/orchestration/src/queue-services.ts`.
Callers (`packages/orchestration/src/resume-queue-execution.ts`, `round-cli.ts`) submit lane tasks
to `queue-admission` one at a time and do not use `Effect.all`/`concurrency` or `Semaphore` to fan
them out either — actual concurrent execution of grok/codex workers happens entirely inside pueue,
outside the Effect runtime.

This is not necessarily wrong: pueue's workers are independent OS subprocesses, not Effect fibers,
so an out-of-process scheduler is a legitimate place to enforce that particular cap, and Effect has
no jurisdiction over concurrency in a process it doesn't own. But it does mean the `concurrency`
option and `Effect.makeSemaphore` — the two mechanisms Effect's own docs prescribe for "the
documented way to cap parallelism" — are entirely unused in the package the user says now runs
under "Effect as the standing rule for ALL concurrency." If Foreman ever needs to cap
*in-process* concurrency (e.g., concurrent `pueue status` probes, concurrent admission calls, or a
future in-process worker pool), `Effect.makeSemaphore(3)` for grok / `Effect.makeSemaphore(2)` for
codex is the direct, idiomatic equivalent of today's `pueue` group `parallel` values — and unlike
the current hand-rolled cap, semaphore permits are automatically released on failure/interruption
per the docs, which the current pueue-CLI-based admission path has to reimplement manually (see
timeout handling below).

**A more serious finding than "wrong mechanism": the cap silently disappears in the fallback
path.** `cmdAdd` (`queue-admission.ts:624-756`) submits work via
`pueue add --group <group> --print-task-id -- <cmd...>` (`queue-admission.ts:693-696`), so the
`--group` binding is what connects a task to whichever `pueue group parallel N` cap applies.
But when the `pueue` client binary can't be resolved, `cmdAdd` falls back to direct spawn
(`queue-admission.ts:643-653`):
```ts
io.writeStderr("lane-queue: degraded direct-spawn (pueue absent)\n");
const proc = yield* ProcessExec;
const code = yield* proc.runForeground({ command: cmd[0]!, args: cmd.slice(1) })...
```
This path has **zero concurrency limiting of any kind** — Effect-native or otherwise. Every
caller-issued command runs immediately and unconditionally. The `grok=3`/`codex=2` caps that the
task brief describes as "pinned" only hold when the external `pueue` daemon is present and
reachable; if it isn't, Foreman degrades to unbounded concurrency with no warning beyond a stderr
line, and no Effect-level semaphore is there to catch the gap. This is the strongest argument in
this report for adopting `Effect.makeSemaphore` in-process: an Effect semaphore per vendor would
keep the cap enforced (in-process, at least) *even when pueue is unavailable*, instead of the cap
depending entirely on an external daemon's presence.

---

## 4. Racing, timeouts, and retries: documented composition and traps

**Doc source:** `/docs/v3/concurrency/basic-concurrency` ("Racing"), `/docs/v3/error-management/timing-out`,
`/docs/v3/error-management/retrying`, `/docs/v3/scheduling/introduction`.

- **`Effect.race(a, b)`**: first success wins; the loser is interrupted. If both fail, the failure
  is a `Parallel` cause containing both errors, not just the first. Trap: by default `race` waits
  for the loser's interruption to fully complete before returning (documented as safe-but-slower).
  For a faster return when the loser doesn't need to block completion, the docs prescribe
  `Effect.raceFirst(Effect.disconnect(a), Effect.disconnect(b))` — disconnecting lets the loser
  finish its own interruption/cleanup in the background instead of blocking the winner's return.
- **`Effect.raceAll` / `raceFirst` / `raceWith`**: `raceAll` = first *success* wins (fails only if
  all fail, with the *last* error, not all errors — asymmetric with `race`'s dual-failure `Parallel`
  cause, a documented trap if you're pattern-matching on cause shape). `raceFirst` = first
  *completion* wins regardless of success/failure. `raceWith` gives you both `Exit`s via callbacks
  for custom reconciliation logic.
- **`Effect.timeout`**: composes as a pipe stage (`effect.pipe(Effect.timeout(duration))`) and fails
  with `TimeoutException`. Its interaction with interruptibility is the documented trap: on an
  *interruptible* effect it cuts off immediately; on an *uninterruptible* effect it waits for
  natural completion before even reporting the timeout (see §2). `Effect.timeoutOption` avoids
  raising an error, wrapping the outcome in `Option` instead — useful when a timeout is an expected
  outcome rather than an error condition. `timeoutFail` / `timeoutFailCause` / `timeoutTo` let you
  customize the resulting error/defect/value instead of the generic `TimeoutException`.
- **`Effect.retry(effect, schedule | { times, until, while })`**: retries are driven by a
  `Schedule`, which is composable (`Schedule.union`, `Schedule.intersect`, `Schedule.addDelay`,
  etc. — `/docs/v3/scheduling/introduction`). `Effect.retryOrElse` adds a fallback effect once the
  schedule is exhausted, rather than propagating the final failure. Documented trap: `until`/`while`
  operate on the **error channel** for `retry` — if your stop condition is about the *success*
  value, the docs point you at `Effect.repeat` instead (`/docs/scheduling/repetition/`), a common
  confusion source.
- **Parallel error accumulation**: running things concurrently (`concurrency: "unbounded"` etc.)
  changes cause shape from a single `Fail` to a `Parallel` cause with both branches
  (`/docs/v3/error-management/parallel-and-sequential-errors`). `Effect.parallelErrors` flattens
  concurrent failures into a single error array, but the docs note it only captures *failures*, not
  defects or interruptions — a trap if you rely on it to fully sandbox a concurrent batch.

**Foreman evidence:**

`packages/orchestration/src/queue-services.ts` hand-rolls timeout logic with raw `setTimeout` in
three places (`liveSleeper` at line 164; `runCapturedOwned` at lines 449-467; a third owned-process
runner around line 583-597) rather than composing `Effect.timeout`/`Effect.timeoutFail` over the
underlying effect. To Effect's credit, these are all done *correctly* as FFI boundaries — each is
inside `Effect.async`, each returns a cancellation `Effect` (`Effect.suspend(() => { clearTimeout(timer); return cancelOwnedFinalizer(owned) })`, e.g. `queue-services.ts:479-484`) that fires on fiber
interruption, so interrupting the surrounding fiber does correctly clear the timer and terminate the
owned child process. This is not a correctness bug, but it is a missed opportunity to use the
documented composition — expressing this as `spawnEffect.pipe(Effect.timeout(opts.timeoutMs))` (or
`Effect.timeoutFail` for a typed `ProcessFailure("timeout")`) would let Effect's own machinery do
what is currently three independent hand-written timer/settle/cancel implementations, and would
make the timeout behavior consistent with the interruptible/uninterruptible distinction documented
in `/docs/v3/error-management/timing-out` instead of being reimplemented ad hoc each time.

No use of `Effect.race`, `raceAll`, `raceFirst`, or `raceWith` was found anywhere in the three
audited packages — there is no racing-composition code to evaluate against the `disconnect` trap
above; it simply isn't exercised yet.

**`Effect.timeout` has zero hits repo-wide**, not just in the three named packages — confirmed with
a broader `packages/*/src` sweep. Every timeout in the codebase is hand-built, either as raw
`setTimeout` inside `Effect.async` FFI bridges (§ above) or as manual polling loops
(`supervise.ts:264-273`'s grace-period fiber; `main.ts:107-124`). Two more concrete examples beyond
`queue-services.ts` worth citing:

- `packages/launcher/src/services.ts:128-134,156-166` defines a bespoke `LauncherClock` service and
  implements its `sleep` the same way as `queue-services.ts`'s `liveSleeper` — `Effect.async` +
  raw `setTimeout`/`clearTimeout` — rather than using Effect's own built-in `Clock`/`TestClock`.
  This is the one abstraction point in the audited code that could have used native Effect
  scheduling machinery (and gotten `TestClock`-based deterministic testing for free) but instead
  reimplements a minimal version of it.
- `packages/orchestration/src/tool-check-atomicity.ts:532-608` (`probeMkdirContentionOnce`) is a
  plain `async function`, entirely outside Effect, that `spawn()`s 8 racer child processes directly
  and coordinates them with raw `Promise.all`:
  ```ts
  await Promise.all(children.map(async (c) => {
    const remaining = Math.max(0, overallMs - (Date.now() - started));
    await waitForChildExit(c, remaining);
    if (c.exitCode === null && c.signalCode === null) await reapChild(c, 1_000);
  }));
  ...
  await Promise.all(children.map((c) => reapChild(c, 500)));
  ```
  plus `Atomics.wait(...)` busy-sleeps inside the spawned racer scripts themselves
  (`tool-check-atomicity.ts:568,922`) and a raw `setTimeout`-based timeout helper
  (`tool-check-atomicity.ts:457,485`). This is the closest thing in the codebase to the "race N
  effects, take what completes" shape the docs cover with `Effect.raceAll`/`raceFirst`, and it is
  implemented with zero Effect involvement — no interruption semantics, no structured cleanup
  beyond manually calling `reapChild` twice.
- `packages/launcher/src/main.ts:40-61` (`exitWhenStreamsFlushed`) recursively drains
  `process.stdout`/`process.stderr` via `stream.once("drain", tryExit)` + `setImmediate(tryExit)` —
  raw Node `EventEmitter` stream backpressure handling, outside Effect, at the launcher's actual
  process-exit boundary.

---

## 5. Anti-patterns the docs warn about, and the Effect-native replacement

| Anti-pattern (per docs) | Why it's flagged | Effect-native replacement | Doc source |
|---|---|---|---|
| Polling a flag to detect "should I stop" | Docs call this out directly as the discarded alternative design — "if the programmer forgets to poll regularly, the target fiber can become unresponsive, leading to deadlocks" | Asynchronous interruption via `Fiber.interrupt` / `Effect.interrupt`; mark true critical sections `Effect.uninterruptible` instead of polling inside them | `/docs/v3/concurrency/fibers` |
| Forking with `forkDaemon` when you meant `fork`/`forkScoped` | Daemon fibers are explicitly *unsupervised* and outlive both parent interruption and enclosing scopes — the one variant nothing local will clean up | Use `Effect.fork` (parent-supervised) or `Effect.forkScoped` (scope-supervised); reserve `forkDaemon` for genuinely process-lifetime background work | `/docs/v3/concurrency/fibers` |
| Hand-rolled retry loops (`while` + `Date.now()` deadline) instead of `Schedule` | Not interruptible between attempts, not composable, not observable the way a `Schedule`'s intervals are | `Effect.retry(effect, Schedule.fixed(...) \| { times, until, while })`, composed via `Schedule.union`/`intersect`/`addDelay` | `/docs/v3/error-management/retrying`, `/docs/v3/scheduling/introduction` |
| Racing without `Effect.disconnect` when the loser doesn't need to block | `raceFirst`/`race` by default wait for the loser's interruption to fully complete before returning, adding latency | `Effect.raceFirst(Effect.disconnect(a), Effect.disconnect(b))` lets the loser finish cleanup in the background | `/docs/v3/concurrency/basic-concurrency` ("Disconnecting Effects") |
| Assuming `Effect.timeout` cuts off an uninterruptible effect immediately | Docs show it waits for natural completion first, then reports the timeout — surprising if you expect prompt cancellation | `effect.pipe(Effect.uninterruptible, Effect.disconnect, Effect.timeout(d))` for prompt return with background completion | `/docs/v3/error-management/timing-out` |
| Using `until`/`while` in `Effect.retry` to gate on a *success* value | `retry`'s predicates run over the error channel; using them for success-based stopping is a documented point of confusion | `Effect.repeat` for success-driven repetition | `/docs/v3/error-management/retrying` |
| Hand-rolled mutex/queue objects for shared-resource access | Reimplements what `Effect.makeSemaphore`/`Queue` already guarantee (permit release on failure/interruption, back-pressure) | `Effect.makeSemaphore(n).withPermits(k)` for mutual exclusion/capped access; `Queue.bounded`/`dropping`/`sliding` for producer/consumer coordination | `/docs/v3/concurrency/semaphore`, `/docs/v3/concurrency/queue` |
| Relying on "I just forked it, it must have started" timing assumptions | Docs explicitly warn forked-fiber start timing is non-deterministic; a single yield does not guarantee the child fiber has run | Use `Effect.sleep`/`Effect.yieldNow` only as a *best-effort* nudge, or synchronize explicitly via `Deferred`/`Latch`/`Fiber.await` rather than assuming ordering | `/docs/v3/concurrency/fibers` ("When do Fibers run?") |

---

## Summary of conflicts found (file:line)

1. **`packages/graph-store/src/files-only.ts:756-838` (`acquireLockSync`)** — lock-acquisition
   retry is a synchronous `Date.now()` busy-wait loop (`MAX_LOCK_RETRIES` = 2000,
   `STORE_LOCK_SPIN_MS` = 5ms, `STORE_LOCK_BOUND_MS` = 10s, per `bounds.ts:25-31`), not
   `Effect.retry`/`Schedule`. Blocks the event loop and is not interruptible mid-retry, unlike the
   documented retry idiom.
2. **No `Effect.retry`/`Schedule` usage anywhere, repo-wide** in `packages/launcher/src`,
   `packages/orchestration/src`, or `packages/graph-store/src` (verified by grep, tests excluded) —
   every retry-shaped piece of logic in the audited surface (lock spin-loop, pueue-add's one
   classified retry, `cmdEnsure`'s 5-probe readiness loop) is a hand-written `for`/`while` loop
   around `sleep`.
3. **`packages/orchestration/src/queue-admission.ts:32-38,643-653`** — vendor concurrency caps
   (`grok: 3`, `codex: 2`, ...) are enforced entirely by the external `pueue` daemon via
   `pueue parallel N --group <vendor>`, not by `Effect.makeSemaphore` or the `concurrency` option.
   Worse: when the `pueue` binary is unavailable, `cmdAdd` falls back to direct unthrottled spawn
   (`queue-admission.ts:643-653`) with **zero concurrency limiting**, Effect-native or otherwise —
   the cap is not just "delegated," it is *absent* outside the happy path.
4. **`Effect.timeout` has zero hits anywhere in the repo** (not just the three named packages).
   Timeout handling is reimplemented independently at `queue-services.ts:164,449-467,583-597`
   (raw `setTimeout` inside `Effect.async`, done correctly re: interruption/cancellation),
   `services.ts:128-166` (a bespoke `LauncherClock` reimplementing what Effect's built-in
   `Clock`/`TestClock` already provide), and outside Effect entirely in
   `tool-check-atomicity.ts:457,485,532-608` (raw `Promise.all` + `Atomics.wait` busy-sleeps racing
   8 child processes with no Effect involvement or interruption semantics) and
   `main.ts:40-61` (`EventEmitter`-based stream-drain recursion at the process-exit boundary).
5. **No `Effect.uninterruptible`/`Effect.uninterruptibleMask` usage anywhere in the repo** (zero
   grep hits). Foreman's two genuine mutual-exclusion mechanisms — the graph-store lock file
   (`files-only.ts:86-107,756-838,1246-1291`) and credential-profile's exclusive hard-link publish
   (`credential-profile.ts:459-464,741-830`) — both derive atomicity from POSIX filesystem
   semantics (`O_EXCL`, atomic hard-link, `rename(2)`) rather than from Effect's own interruption
   model. Defensible for cross-process guarantees Effect can't provide on its own, but it means
   "uninterruptible mutation section" in Foreman today is an OS-atomicity idiom, not an Effect API
   invocation.

## What Foreman already does right (worth preserving as the house style)

- `packages/launcher/src/supervise.ts` is a strong match for the documented structured-concurrency
  pattern: `Effect.scoped` + `Effect.fork` for every child fiber (stdout pump, stderr pump,
  heartbeat loop, timeout/grace loop) + one `Effect.addFinalizer` that explicitly `Fiber.interrupt`s
  all of them, plus `Ref`-based shared state scoped to that one supervision effect. No stray
  `forkDaemon` usage anywhere in the audited packages. This is effectively the *only* place in the
  three packages that exercises Effect's fiber/scope/finalizer machinery as documented — worth using
  as the template when other concurrency (e.g. `orchestration`'s vendor admission) is eventually
  brought under Effect.
- `packages/graph-store/src/files-only.ts:1246-1291` correctly uses `Effect.acquireRelease` inside
  `Effect.scoped` for the cross-process file lock, matching the docs' "acquisition is uninterruptible
  by construction, release is guaranteed by the scope" guidance without needing to hand-roll
  `Effect.uninterruptible`.
- The hand-rolled `setTimeout`/`ChildProcess`-event FFI bridges in `queue-services.ts` are, within
  their scope, implemented correctly: every `Effect.async` call returns a proper cancellation
  effect that clears the timer and terminates the owned child process on fiber interruption
  (e.g. `queue-services.ts:479-484`). The gap is that Effect's own `Effect.timeout`/`Schedule`
  composition is never used *on top of* these bridges — not that the bridges themselves violate
  interruption semantics.
