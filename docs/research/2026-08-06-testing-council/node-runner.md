# Council report — the Node built-in test runner and TDD discipline

Lens: `node --test` as the actual instrument. Everything below was measured on the
repo at `/root/fm-hyg/foreman` (WSL, Node v24.18.0), not inferred.

---

## 0. Ground truth I measured before advising

I ran the suite and probed the runner. Six facts, all reproducible:

| # | Measurement | Command |
|---|---|---|
| G1 | **1334 tests / 242 suites / 12.5 s wall**, 1m28s CPU. Fast. Parallelism is real. | `time npm test` |
| G2 | **`main` is not green right now.** `packages/launcher/src/supervise.test.ts` fails: `ERR_MODULE_NOT_FOUND … heartbeat.js`. | `node --import tsx --test packages/launcher/src/supervise.test.ts` |
| G3 | **The failure summary is content-free.** The whole `✖ failing tests:` block reads `test at packages/launcher/src/supervise.test.ts:1:1 / 'test failed'`. The actual `ERR_MODULE_NOT_FOUND` stack landed ~600 lines upstream, interleaved with 241 other concurrently-running suites. | same |
| G4 | **4 of the 5 skips print `# SKIP` with no reason.** Only one prints a reason (`# root bypasses file mode checks`) — the one that used `t.skip("…")` instead of `{ skip: <boolean> }`. | `grep '# SKIP' /tmp/fm-suite.txt` |
| G5 | **`node --test` with a glob that matches zero files exits 0**, printing `tests 0 … pass 0`. A typo'd `--test-name-pattern` also exits 0. | `node --import tsx --test "packages/policy/src/**/*.spec.ts"; echo $?` → `EXIT=0` |
| G6 | **`{ skip: "string" }` is supported and prints the string.** Spec reporter: `﹣ name # host lacks unshare(1)`. TAP: `ok N - name # SKIP host lacks unshare(1)`. | probe file, both reporters |

Two corrections to the brief, both load-bearing:

- **fast-check is not a root devDependency.** `fast-check@4.9.0` is declared only in
  `components/council/package.json` (the vitest workspace). What is installed at
  `node_modules/fast-check` is **3.23.2**, hoisted as a transitive of `effect`
  (`effect` devDepends on `^3.23.1`). A root test doing `import fc from "fast-check"`
  today resolves to an *undeclared, unpinned, major-version-behind* copy that
  disappears the moment Effect drops it. See §5.
- **`packages/*/tsconfig.json` excludes `src/**/*.test.ts` from the build, but
  `tsconfig.all.json` includes `packages/**/*.ts`.** So tests *are* strictly
  typechecked by `npm run typecheck`'s second invocation, and are *not* emitted.
  That is the right split and nothing should change it.

---

## 1. The red-green-refactor loop

### 1.1 The four scopes, exactly

The suite is 12.5 s. That is fast enough that the loop should almost never be
narrower than one file. Optimise for **not having to think about which scope**,
not for shaving 300 ms.

```bash
# one test  (~1.1 s)  — pattern is a JS regex against the full nested test name
node --import tsx --test --test-name-pattern="refuses unreadable regular file" \
  packages/orchestration/src/secret-scan.test.ts

# one file  (~1.2–2.5 s measured across the three heaviest files)
node --import tsx --test packages/orchestration/src/secret-scan.test.ts

# one package (~7.2 s for orchestration, its 807 tests)
node --import tsx --test "packages/orchestration/src/**/*.test.ts"

# everything (12.5 s)
npm test
```

Add these as scripts so nobody retypes `--import tsx`:

```jsonc
"test":        "node --import tsx --test 'packages/*/src/**/*.test.ts' 'scripts/**/*.test.ts'",
"test:pkg":    "node --import tsx --test",            // npm run test:pkg -- 'packages/policy/src/**/*.test.ts'
"test:watch":  "node --import tsx --test --watch",    // npm run test:watch -- packages/core/src/x.test.ts
"test:only":   "node --import tsx --test --test-only",
"test:cover":  "node --import tsx --test --experimental-test-coverage --test-coverage-exclude='**/*.test.ts'"
```

**The quotes around the globs are not cosmetic — they are a latent
whole-package-goes-dark bug.** Today `package.json` has them unquoted:

```
node --import tsx --test packages/core/src/**/*.test.ts packages/event-log/src/**/*.test.ts …
```

npm runs scripts through `sh`, which has no `globstar`. `sh` reads `src/**/*.test.ts`
as `src/*/*.test.ts`. I verified there is currently **no** test file in any
`packages/*/src/<subdir>/`, so every pattern matches nothing, `sh` passes the literal
through, and Node's own glob engine (which *does* understand `**`) expands it
correctly. The suite works **by accident**. The first time somebody adds
`packages/orchestration/src/lanes/foo.test.ts`, `sh` will match *that one file* and
silently drop the other 36 test files in orchestration — and per G5, the run stays
green. Quoting the globs hands expansion to Node unconditionally and closes it.

**Cost:** one line. Do this today. It is the highest value-per-character change in
this report.

### 1.2 Watch mode

`--watch` works with `--import tsx` and re-runs on save. It is genuinely good for the
single-file loop and genuinely bad above that: it watches the transitive module graph,
so touching `packages/core/src/index.ts` re-runs everything downstream, and the spec
reporter's output is not cleared by default. Use it **only** pinned to one file:

```bash
node --import tsx --test --watch packages/core/src/thing.test.ts
```

For the package-level loop, prefer re-running the 7-second command manually. That is
not a compromise; a 7-second command you invoke deliberately produces a cleaner mental
model than a background process reprinting 807 results.

**Add `--watch-preserve-output` only if you want scrollback**; the default (clearing)
is correct for RED→GREEN.

### 1.3 The RED phase has a hole you must plug

Per G5, **`node --test` exits 0 when it selects zero tests.** Both failure modes are
live in a TDD loop:

- You write `--test-name-pattern="reufses unreadable…"` → `tests 0`, `EXIT=0`, green.
  You believe you are in GREEN. You have not run anything.
- The glob resolves to nothing (a rename, the `sh` bug above, a bad path) → `tests 0`,
  `EXIT=0`, green.

**Rule R-FLOOR: every invocation asserts a minimum test count.** Cheapest mechanical
form — a ~30-line custom reporter that wraps `spec` and exits non-zero when
`tests === 0`, or when `tests < FOREMAN_TEST_FLOOR` if that env var is set:

```bash
node --import tsx --test --test-reporter=./scripts/test-reporter-floor.ts \
  --test-reporter-destination=stdout "packages/*/src/**/*.test.ts"
```

with `FOREMAN_TEST_FLOOR=1300` committed for the full-suite CI job and unset (defaults
to 1) for the inner loop.

**Cost:** ~40 lines of reporter, plus a number in CI config that must be bumped when
tests are legitimately deleted. That friction is the point: deleting 200 tests should
require a deliberate edit. This is the single mechanism that would make the difference
between "the suite passed" and "the suite ran."

### 1.4 Do not enable `--test-isolation=none`

I measured it on the orchestration package:

| mode | wall | CPU (user) |
|---|---|---|
| default (process per file) | **7.2 s** | 38.3 s |
| `--test-isolation=none` | 8.3 s | 4.1 s |

It is *slower in wall time* here and it is *unsafe* in this codebase. Module-level
mutable state exists and is load-bearing: `anchorSupportCache` in
`credential-profile-preflight.ts:450`, `setSecretScanDirectoryAnchorCapabilityForTests`,
`setProfilePreflightRaceHook`, `setSecretScanRaceHook`. Under `isolation=none` those
caches and hooks are shared across every test file in one process, and a hook one file
forgets to reset becomes a cross-file failure in a file that never mentioned it.

The one place `isolation=none` earns its keep is a 2-core CI runner, where the 38 s of
CPU cannot be spent in parallel. Do not take that trade — buy cores instead, or accept
the wall time. **Process isolation is the property that makes a Foreman test failure
attributable to a file.**

---

## 2. Placement and naming

The existing convention is right and needs only to be made mandatory and machine-checked.

**R-PLACE-1 — `<module>.test.ts` sits beside `<module>.ts` in the same `src/`.**
Currently honoured; 78 test files, no `__tests__/`, no `test/` mirror tree. Keep it.
The payoff is that `--watch` on a test file watches its subject, and the glob
`packages/*/src/**/*.test.ts` is the entire selection language you need.

**R-PLACE-2 — the only permitted infixes are `.integration.` and `.typed.`.**
Those are the two that already exist (2 and 1 files respectively). Anything else
(`.spec.ts`, `.e2e.ts`, `.unit.ts`) is rejected. Enforce with one check in
`scripts/`-land: every `*.test.ts` basename must match
`^[a-z0-9-]+(\.integration|\.typed)?\.test\.ts$`, and — this is the part that
matters — **every `*.test.ts` must have a sibling non-test `.ts` whose name it
prefixes**, with a short committed allowlist for the handful of cross-cutting files.

That second half is what catches the orphan: a test file whose subject was renamed or
deleted stops being run against anything and nobody notices, because per G5 an
unmatched test still exits 0.

**R-PLACE-3 — the infix carries a *runtime* meaning, not just a label.**
`.integration.test.ts` means "touches the real filesystem, git, or a spawned process."
That lets you say `--test-skip-pattern` is not needed, because you can select
by *path*:

```bash
# pure/fast tier — everything that is not an integration file
node --import tsx --test "packages/*/src/**/*.test.ts" \
  --test-skip-pattern="…"    # ← do NOT do this
```

`--test-skip-pattern` matches test *names*, not paths, and names drift. Select the
tiers by glob instead:

```bash
npm run test:pkg -- 'packages/*/src/**/!(*.integration).test.ts'   # needs Node's globber, hence quoting
```

**Cost:** the naming lint is ~50 lines and one allowlist file. The
subject-sibling rule will initially flag some legitimate cross-cutting suites
(`tool-check-atomicity.test.ts` spans several modules) — budget an afternoon to
either rename them or allowlist them, and require a one-line justification in the
allowlist row.

---

## 3. Making a suite result interpretable

This is the heart of it. The proposal's framing — "the suite cannot distinguish 'this
environment cannot run this test' from 'the product is broken'" — is correct, and the
Node runner *already gives you the mechanism*; Foreman is simply not using it.

### 3.1 The runner has three buckets. Use all three, and mean them.

The summary line is already a taxonomy:

```
ℹ tests 1334   ℹ pass 1328   ℹ fail 1   ℹ cancelled 0   ℹ skipped 5   ℹ todo 0
```

**R-BUCKET — assign a fixed meaning to each bucket and never blur them:**

| bucket | meaning | how you write it | who is allowed to add one |
|---|---|---|---|
| `pass` | the assertion ran and held on this host | — | — |
| `fail` | **the product is broken.** No other cause. | — | — |
| `skipped` | **this host lacks a capability the test requires.** The product is presumed fine; a different host would run it. | `{ skip: <reason string> \| false }` | only via a registered capability probe (§3.2) |
| `todo` | **a known, tracked product defect or gap.** Not a host problem. | `{ todo: "DST-0060: launcher/dist is never built" }` | only with a tracker/OpenSpec id in the string |
| `cancelled` | timeout / abort — always investigate | — | — |

That single table dissolves most of the proposal's triage table. Re-read the nine
failures with it:

- #54 (non-atomic `mkdir`) → `fail`. Correct as-is.
- #174 (`launcher/dist` never built) → `todo: "v0.2.9 P1 — launcher/dist not built"`.
  It is a known gap, not a host defect and not a surprise.
- #50 (`chmod 000` bypassed by root) → `skip: "EUID 0 — root bypasses file mode checks"`.
  A host-capability statement, and the repo *already writes exactly this string* at
  `secret-scan.test.ts:712`.
- #105/#275/#356 (Windows dialect tests on Linux) → `skip: "platform!=win32 — pueue .exe dialect"`.
- #43 (load-sensitive) → neither. That is a `fail` with a bad test; fix it onto the
  injectable clock. Flakiness is never a bucket.

The summary line then *reads as a verdict*: `fail 0, todo 2, skipped 7` means
"product OK; two known gaps; seven capabilities absent on this host." `fail 1` means
stop.

**Node counts `todo` separately and exits 0 for it** (verified: `pass 1, todo 1` from
my probe). That is exactly the semantics you want for a tracked gap: visible in every
run, does not block, cannot be forgotten because it is printed with its ticket id
every single time.

### 3.2 Skips must be legible, and that is a one-line grep to enforce

Per G4/G6: `{ skip: true }` prints a bare `# SKIP`; `{ skip: "reason" }` prints the
reason. Foreman's ~60 skip sites are almost all the boolean form
(`{ skip: !anchorOk }` appears ~40 times in `supervisor-live-services.test.ts` alone),
so almost every skip in the suite is currently anonymous.

**R-SKIP-1 — a boolean-valued `skip:` is banned.** Every skip is
`skip: <cond> ? "<probe-id>: <reason>" : false`.

Mechanically checkable, and the check is a regex over `*.test.ts`:

```
skip:\s*(true|false|!?\w+[\w.()!]*)\s*[,}]     ← reject
skip:\s*\w.*\?\s*"[a-z0-9-]+:\s.*"\s*:\s*false ← accept
```

**R-SKIP-2 — the reason string's prefix is a registered probe id.**
One module, `packages/core/src/test-capability.ts`, exports the probes and their
canonical reason strings:

```ts
export const CAPABILITY = {
  procFdAnchor:   () => profilePreflightDirectoryAnchorSupported(),
  unshare:        () => …,
  nonRoot:        () => process.getuid?.() !== 0,
  platformWin32:  () => process.platform === "win32",
  symlink:        () => …,
} as const;

/** `skip: unless("procFdAnchor")` → `false` on capable hosts, a reason string otherwise. */
export function unless(id: keyof typeof CAPABILITY): false | string { … }
```

Call sites become `it("…", { skip: unless("procFdAnchor") }, …)`. The lint then only
has to check that the argument is a literal key of `CAPABILITY`. A new skip reason
cannot be invented at a call site; adding one is a visible edit to a registry file.

Note a design smell this exposes and that you should fix while you are in here:
`profilePreflightDirectoryAnchorSupported()` is **production code in
`packages/orchestration/src/credential-profile-preflight.ts` being used as a test
predicate**. That means a bug in the probe makes the tests that would catch it skip
themselves. `CAPABILITY.procFdAnchor` should be an *independent* re-implementation in
the test-capability module (open `/proc/self/fd` yourself), and there should be one
test asserting the two agree. Two mechanisms, per the proposal's own cross-checking rule.

### 3.3 Skips are budgeted

Adopt the proposal's `tests/skip-budget.tsv` idea verbatim for the TS suite — do **not**
build a second mechanism. One committed TSV, one row per `(file, platform, capability-id)`,
one integer. A custom reporter (the same one from §1.3) tallies skips per file and per
probe id and fails when the actual exceeds the declared.

This is the honesty counterweight. Without it, R-SKIP-1 makes it *easier* to turn a
red into a legible skip, and coverage erodes politely.

**Cost:** the TSV is ~30 rows today and needs updating whenever a platform-specific
test is added. Real friction, correctly placed.

### 3.4 The failure summary is unusable under concurrency — fix the reporter

G3 is a genuine defect in the built-in `spec` reporter that no discipline fixes.
With 242 suites across ~20 worker processes, a file-level crash (an unhandled
rejection, a bad import, a spawned child writing to stderr) surfaces as:

```
✖ failing tests:
test at packages/launcher/src/supervise.test.ts:1:1
✖ packages/launcher/src/supervise.test.ts (3103ms)
  'test failed'
```

The cause — a full `ERR_MODULE_NOT_FOUND` stack — is 600 lines up, interleaved.

**R-REPORT — ship one custom reporter and use it everywhere.** It consumes the
`node:test` event stream (`test:fail`, `test:diagnostic`, `test:stdout`, `test:stderr`)
and emits, at the end and grouped **per file**:

1. `fail` list with the full `error.cause` chain and the file's captured stderr;
2. `todo` list with ids;
3. `skipped` grouped by probe id with counts, checked against the budget;
4. the floor check from §1.3;
5. a machine-readable `test-report.json` alongside, for CI artifact upload.

`--test-reporter` accepts a module path and `--test-reporter-destination` splits
streams, so you can run `spec`→stdout and your JSON→file in the same invocation.

**Cost:** ~200 lines and it is now yours to maintain across Node minors — the reporter
event names are stable but `error` shapes have moved between majors. Worth it: this is
the difference between a 20-minute triage and a 20-second one, on every red run for
the life of the project.

### 3.5 The positive control applies to skips too

The proposal's best idea is "a check that has never been observed failing is not
counted as coverage." Apply it to capability probes specifically, because a probe that
returns `false` unconditionally silently deletes coverage while printing a
respectable-looking reason.

`secret-scan.test.ts` already models the answer:
`setSecretScanDirectoryAnchorCapabilityForTests` lets the *unsupported* branch be
proven on a host where the capability is present. **R-PROBE-CONTROL: every registered
capability in `CAPABILITY` has one test that forces the negative branch via injection
and asserts fail-closed behaviour, and that test never skips.** Then `skipped > 0` is
never a coverage hole in the fail-closed path — only in the happy path.

---

## 4. Isolation, temp directories, and the two bugs that got through

### 4.1 What is there now

`mkdtempSync(join(tmpdir(), "prefix-"))` appears across ~15 files with ad-hoc
`try/finally { rmSync(dir, {recursive:true, force:true}) }`. It is mostly correct and
entirely unenforced. Some sites (`tool-check-atomicity.test.ts:740-745`) create temp
dirs with no `finally` at all.

**R-TMP-1 — one helper, and direct `mkdtempSync` in a test file is a lint error.**

```ts
// packages/core/src/test-tmp.ts
export function tempDir(t: TestContext, tag: string): string {
  const dir = mkdtempSync(join(FOREMAN_TEST_TMP_ROOT, `${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}
```

Three properties the ad-hoc form does not have:

- `t.after` runs even when the test throws *and* when it times out; `finally` around an
  `await` in an async test does not reliably run on timeout.
- `maxRetries: 3` — mandatory on Windows, where an open handle makes `rmSync` throw
  `EBUSY` transiently. Several current sites will flake on `windows-latest` for this
  reason alone.
- All temp state lands under one `FOREMAN_TEST_TMP_ROOT` (default `tmpdir()`), so §4.2
  becomes a single env var.

**R-TMP-2 — a leak check.** The reporter (§3.4) records the entry count of
`FOREMAN_TEST_TMP_ROOT` before and after the run and fails on a non-empty delta. Cheap,
mechanical, catches every missing cleanup on the first run rather than on the CI box
that runs out of inodes three months later.

### 4.2 The ext4/tmpfs inode-reuse bug

The repo has already written the correct post-mortem, at
`packages/orchestration/src/credential-profile.test.ts:82-98`:

> Removing `dir` first and recreating it is NOT portable. ext4 reuses the just-freed
> inode … tmpfs allocates inode numbers from a monotonic counter and never reuses them,
> which is why the delete-then-recreate shape passes on a tmpfs `/tmp` and fails on a
> hosted Linux runner, whose `/tmp` is ext4. Burning one throwaway directory does not
> help: the freed inode stays in the pool.

That knowledge is a comment in one file. Inode identity is load-bearing in **five
modules** — `event-log/run-journal.ts`, `graph-store/files-only.ts`,
`orchestration/secret-scan.ts`, `orchestration/credential-profile.ts`,
`orchestration/credential-profile-preflight.ts` — and there is at least one remaining
raw assertion at `credential-profile.test.ts:1708`:

```ts
assert.notEqual(lstatSync(jsonPath).ino, beforeIno);
```

**Two rules, both mechanical:**

**R-INODE-1 — a test may not construct an identity change by unlink-then-recreate.**
Provide `replaceViaRename(path)` / `replaceDirViaRename(dir, children)` in
`test-tmp.ts` (the technique is already implemented in
`credential-profile.test.ts` — promote it, do not re-derive it). Lint: any
`*.test.ts` that mentions `.ino` must import from `test-tmp.js`; any test file
containing `rmSync(` or `unlinkSync(` on a path within N lines of a subsequent
`mkdirSync(`/`writeFileSync(` of the *same* variable is flagged. The second half is a
heuristic and will have false positives — allowlist them with a reason. The
false-positive cost is far below the cost of the bug.

**R-INODE-2 — the filesystem is a declared axis, and CI runs both values.** This is
the rule that *actually* catches it before CI, because it makes the ext4 path runnable
on a developer's laptop in one command:

```bash
FOREMAN_TEST_TMP_ROOT=$(mktemp -d /var/tmp/fm-XXXX)  npm test    # ext4  (inode reuse)
FOREMAN_TEST_TMP_ROOT=$(mktemp -d /dev/shm/fm-XXXX)  npm test    # tmpfs (monotonic ino)
```

`/dev/shm` is tmpfs and `/var/tmp` is ext4 on the reference WSL box and on
`ubuntu-latest`. Both are already there; no container, no mount, no privileges. Add a
CI matrix leg for each. Since R-TMP-1 routes *every* temp dir through
`FOREMAN_TEST_TMP_ROOT`, this is a two-line matrix and zero test changes.

**Cost:** doubles the Linux CI test minutes (12.5 s → 25 s; irrelevant). The real cost
is R-TMP-1 being adopted first — the env var does nothing until every `mkdtempSync`
goes through the helper.

### 4.3 The Windows path-separator bug

I count 289 test lines containing a hardcoded `"a/b/c"`-shaped string literal in a
positional or key position. Some are correct (they are POSIX-only fixtures for
POSIX-only code); most are latent.

**R-PATH-1 — a path-shaped string literal may not be used as a map key, a `Set`
member, or an equality operand.** Fixtures build paths through `join()`/`resolve()`
from a temp root, and compare with a normaliser. Lint: flag `"..." + "/" + ...`,
`` `${x}/${y}` `` in a `new Map([...])` / object-literal key / `assert.equal` position.
Noisy at first; the allowlist is the documentation of which fixtures are deliberately
POSIX-dialect.

**R-PATH-2 — dialect is a declared axis too.** For tests that assert on rendered path
strings, do not assert equality against a literal; assert against
`normalise(actual) === normalise(join(root, "a", "b"))` where `normalise` collapses
separators. This makes the assertion true on both platforms without a `win32` skip,
which is strictly better than skipping — a skipped Windows test is not coverage.

**R-PATH-3 — the *only* thing that reliably catches this before CI is running on
Windows.** There is no substitute and I will not pretend otherwise. `gates-windows.yml`
exists and currently runs `FOREMAN_CI_BATS: "0"`. The **TypeScript** suite is 12.5 s
and has no bats dependency — **run `npm test` on `windows-latest` as a gate, today.**
It is a separate decision from the bats-on-Windows question the proposal is wrestling
with, it is far cheaper, and per §3 the win32 skips will be legible when it goes red.

Expect the first Windows run to be ugly: the `EBUSY`/`rmSync` issue (§4.1), the
separator fixtures, and every `{ skip: process.platform === "win32" }` inverting into
newly-executing code. Budget two days. That two days is the price of the rule, and it
is a one-time price.

### 4.4 Subprocess isolation — the bug that is failing right now

G2's `supervise.test.ts` failure is a third portability class the brief did not
mention, and it is live on `main`. Cause: `liveDetachSpawner.spawnDetachedSelf`
(`packages/launcher/src/services.ts:448`) spawns `process.execPath` with
`selfScriptArgvPrefix()` = `[process.argv[1]]`. Under
`node --import tsx --test <file>`, `argv[1]` is the **test file**, and the child gets
**no `--import tsx`** and inherits no loader. So it re-executes
`supervise.test.ts` as plain JS, hits its `import … from "./heartbeat.js"` (line 24),
and dies with `ERR_MODULE_NOT_FOUND`. The stray `foreman-launch: capability=posix_pidns_strong
unshare=/usr/bin/unshare host_pid=…` line in the output is that child.

This failure is **host-dependent** — it needs `unshare` present — which is exactly the
"is the product broken or is this my box?" ambiguity the proposal is about, and it is
currently indistinguishable from a real defect.

**R-SPAWN — a test that spawns `process.execPath` must either (a) pass
`execArgv: ["--import", "tsx"]` / prepend those args explicitly, or (b) target a
*built* artifact under `dist/`, never a `.ts` source path.** Greppable: every
`spawn|spawnSync|fork(process.execPath` occurrence in a `*.test.ts` must be within N
lines of `--import` or of a `dist/` path literal. `supervise.test.ts:608` already does
(b) correctly for the bundle case — the detached-self path just never got the same
treatment.

---

## 5. Where the runner is bad, and where another tool is warranted

I am arguing *for* `node --test` here, so the honest list matters.

**Genuinely bad, live-fire enough to hurt:**

1. **The failing-tests summary under concurrency (G3).** Discussed in §3.4. The single
   worst property of the runner as shipped. Fixable only with a custom reporter.
2. **Exit 0 on an empty selection (G5).** A correctness bug in how the runner is used
   as a gate. Fixable only by wrapping.
3. **No mocking of ESM module graphs.** `mock.module()` is still experimental in Node 24
   and emits a warning. Foreman has largely *designed around* this — Effect layers and
   the injectable `…FsShape` / `set…ForTests` seams are dependency injection instead of
   module mocking, and it is the better architecture. **Keep doing that; do not adopt a
   runner to get module mocking.** If you find yourself wanting `vi.mock`, the module
   under test needs a seam.
4. **`assert.deepStrictEqual` diffs are poor** for the large frozen structures Foreman
   compares (schema records, manifests). Several tests already work around it by passing
   `JSON.stringify(r)` as the assertion message — that is the workaround, and it is fine.
5. **No built-in snapshot/inline-snapshot** worth using (`t.assert.snapshot` is
   experimental and file-based). Foreman's frozen-artifact style (sha256 in
   `manifest.json`) is a better fit anyway.
6. **Coverage is V8-based and reports on the *transpiled* output**, so `tsx`-loaded
   TypeScript coverage line numbers are approximate. `--experimental-test-coverage`
   with `--test-coverage-exclude='**/*.test.ts'` is good enough for "is this file
   tested at all," not for a percentage gate. **Do not gate on a coverage number.**

**Where a different tool is genuinely warranted — three places, and only three:**

- **`components/council` keeping vitest.** It already does, it is a separate pnpm
  workspace, and forcing it onto `node --test` buys nothing. Leave it. But
  **enforce the boundary mechanically**: a check that no file under `packages/` or
  `scripts/` imports `vitest`, and no file under `components/council/` is matched by
  the root test glob. Two greps. The cost of *not* having them is a vitest-only API
  leaking into a `node --test` file and failing in a confusing way.

- **fast-check, for the codec/parser/normaliser layer — but declare it first.**
  Property-based testing is a real gap here. The path-separator bug and the inode bug
  are both *exactly* the shape fast-check finds: a normaliser that holds for the inputs
  someone thought of. `renderCredentialProfilePreflight`/`parse…Bytes`,
  `parseSecretScanArgv`, and the path normaliser from R-PATH-2 each want a round-trip
  property. fast-check integrates with `node --test` fine — it is a plain assertion
  library, no runner integration needed.
  **Blocker to fix first:** `fast-check` is *not* a root devDependency. The 3.23.2 at
  `node_modules/fast-check` is a transitive of `effect`. Add
  `"fast-check": "4.9.0"` to the root `devDependencies` (matching council's pin) before
  writing a single property, or you are testing against a phantom.
  **Cost:** properties are slower and non-deterministic in *which* case they run;
  always pass an explicit `seed` and commit it, or a CI flake becomes unreproducible.

- **bats for the shell/CLI surface.** The 635 bats tests exist and the
  `test-infrastructure-hardening` package owns them. Do not port them to
  `node --test`. Do **share the vocabulary**: `tests/skip-budget.tsv` and
  `tests/baseline.tsv` should have TS-suite counterparts in the *same format*, and the
  probe ids in `CAPABILITY` (§3.2) should be the same strings as
  `preconditions.bash`'s `require_platform` / `require_tool` / `require_non_root`
  arguments. One taxonomy, two runners. Two taxonomies is how you end up unable to say
  what "the suite" means.

**Not warranted:** jest (ESM + Effect is a fight you do not need), swapping to vitest
at root (you would gain module mocking you have designed away, and lose the zero-dep
property that makes `npm test` work on a fresh clone), any assertion library
(`node:assert/strict` is used consistently and is fine).

---

## 6. Order of operations

Ranked by (value ÷ cost), highest first. The first four are hours, not days.

| # | Change | Cost | Catches |
|---|---|---|---|
| 1 | **Quote the globs in `"test"`** | 1 line | A whole package silently going dark |
| 2 | **Fix `supervise.test.ts` (R-SPAWN)** | ~1 hour | `main` is red right now |
| 3 | **Custom reporter: floor check + per-file failure detail + skip tally** | ~1 day | G3 + G5; makes every subsequent run readable |
| 4 | **`CAPABILITY` registry + R-SKIP-1 lint** (`skip:` must be a reason string) | ~1 day + mechanical edit of ~60 sites | "environment or defect?" — the stated problem |
| 5 | **`tempDir(t, tag)` helper + ban raw `mkdtempSync` + leak check** | ~1 day | Leaks, Windows `EBUSY`, and unlocks #6 |
| 6 | **`FOREMAN_TEST_TMP_ROOT` matrix: `/var/tmp` (ext4) + `/dev/shm` (tmpfs)** | 2 CI lines | The inode-reuse bug, before CI |
| 7 | **`npm test` on `windows-latest` as a gate** | ~2 days of first-run cleanup | The separator bug, and every other win32 assumption |
| 8 | **Skip budget TSV, shared format with the bats package** | ~30 rows + maintenance | Coverage erosion via polite skipping |
| 9 | **`todo:` with tracker ids for known gaps** (start with `launcher/dist`) | per-gap | Known gaps stop looking like failures |
| 10 | **Declare `fast-check@4.9.0` at root; properties for codecs and the path normaliser** | ~2 days | The *next* bug of this shape |

The through-line: **five of these ten are mechanical checks that make a class of bug
impossible to merge, and only one (#7) depends on anyone remembering anything.** That
ratio is the recommendation.
