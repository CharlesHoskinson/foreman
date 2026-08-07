# Council report — property-based testing, fuzzing, and adversarial input

Repo read: WSL `/root/fm-hyg/foreman` (main workspace `packages/{core,event-log,graph-store,policy,orchestration,launcher}`, plus the separate `components/council` project).

Every claim below marked **[verified]** was produced by executing code in this checkout, not by reading it.

---

## 0. Ground truth: how much is fast-check actually used?

Honestly: **almost not at all, and nowhere near the code that needs it.**

| Fact | Value |
|---|---|
| `fast-check` declarations | exactly one — `components/council/package.json:30`, `"fast-check": "4.9.0"` |
| Files importing it | exactly one — `components/council/packages/domain/test/budget.test.ts` |
| `fc.` call sites in the repo | 18, all in that one file |
| Council test files | 45 (so 1/45 use it) |
| Main-workspace test files (`packages/*/src/*.test.ts` + `scripts/`) | 78, of which **0** use it |
| Main workspace devDependencies | `@types/node`, `esbuild`, `tsx`, `typescript` — **fast-check is not a dependency of the workspace that contains every parser** |

So the premise "fast-check 4.9 is a root devDependency" is not quite right: it is a devDependency of a *side project* (`components/council`, which runs on Vitest). The six packages that hold canonical JSON, UTF-8 decoding, bounded reads, NDJSON replay, SemVer, TOML, argv and path authority run on `node:test` + `tsx` and have no access to it.

The one existing usage is good work — `budgetVectorArbitrary`, a `BudgetCommand` sum type, and a "never reserves beyond any hard limit" property. It is a model of what to do. It is also an island.

Two consequences that shape everything below:

1. Adopting property testing in the main workspace is a **new dependency decision**, not a "we already have it" decision. Cost: one devDependency at the root, ~1.5 MB, no runtime impact (esbuild bundles from explicit entry points in `scripts/build-runtime.ts`, so test-only modules are never reachable from a bundle).
2. `fc.assert` throws a plain `Error` on falsification. It is assertion-library agnostic and works unmodified under `node:test`. No harness change is needed. **[verified by inspection of the existing council usage pattern; fast-check has no Vitest coupling]**

**Baseline runtime, for budgeting: `npm test` runs 1334 tests / 242 suites in 12.1 s wall (1m27s user, so it is already parallel across files). [verified]** That is a generous budget. It also means an unbounded property suite could plausibly triple it, which is why §5 is not optional.

---

## 1. Highest-value targets

Ranked. Each states the property in words, the module, and the cost.

### T1. `parseJsonRejectDuplicateKeys` never throws — it returns a value or a `CoreFailure`
`packages/core/src/canonical-json.ts`

> **Property.** For every string `s`, `parseJsonRejectDuplicateKeys(s)` returns normally. It never throws.

This is the single highest-value property in the repo, because **it currently fails.**

**[verified]** `parseJsonRejectDuplicateKeys("[".repeat(50000) + "]".repeat(50000))` throws `RangeError: Maximum call stack size exceeded`. `canonicalize` on an equivalently deep value throws the same. The parser's `parseValue`/`parseObject`/`parseArray` are mutually recursive with no depth counter.

Today this is masked: `packages/event-log` runs a structure preflight (`event_structure_limit`, `MAX_EVENT_NESTING_DEPTH = 64`) and `packages/graph-store` has `MAX_JSON_DEPTH = 64` — both *before* handing bytes to the parser. So the bug is latent, not live. But the core primitive advertises a total `unknown | CoreFailure` return type, and TypeScript will not stop the next caller from trusting it. The failure mode is an uncaught `RangeError` crossing a trust boundary that is designed to fail closed.

The fix is a depth counter inside the parser returning `invalidJson()` (or a new `nestingTooDeep()`) past a bound. The property then holds unconditionally and the preflights become defence in depth rather than the only defence.

A single `fc.string()` property with `fc.stringMatching` for JSON-ish shapes will not find this — you need a generator that produces *deep* structures cheaply. See `nestedJsonText()` in §3.

**Cost:** ~20 lines of test, ~15 lines of parser change. Highest value/cost ratio in the repo.

### T2. `replayNdjson` chunk-boundary invariance over generated logs
`packages/event-log/src/replay.ts`

> **Property.** For every byte sequence `B` and every partition of `B` into chunks `C₁…Cₙ`, `replayNdjson(chunks, opts)` deep-equals `replayNdjsonBytes(B, opts)`.

The module's own docstring makes this claim ("Works for any chunk boundary (mid UTF-8 sequence, CRLF, last byte of line)"). `replay.test.ts` already tests it exhaustively — but only over **three hand-written logs**, at every single-byte split (`replay.test.ts:188, :208, :233`).

Be precise about what is missing. The exhaustive single-byte split is *strictly stronger* than random splitting on those fixed inputs — do not replace it. What is missing is variation in the **log content**: the interaction between arbitrary chunking and CR/LF placement, `sequence_duplicate` / `sequence_not_monotonic` stops, `torn_tail`, and the `MAX_PHYSICAL_LINE_BYTES` cutoff.

The `sawCrPending` state machine is where I would spend the fuzz budget. It has three interacting exits (LF arrives, non-LF arrives, EOF arrives) and each of the three independently rechecks `lineBuf.length >= MAX_PHYSICAL_LINE_BYTES`. A generated log of valid events, interleaved with adversarial `\r` placement (`\r\r\n`, `\r` at EOF, `\r` as the last byte of a chunk), split at arbitrary boundaries, is exactly the shape a human stops enumerating after four cases.

**Cost:** one generator (`ndjsonLog()` + `chunking()`), ~50 lines, ~2 s of budget. Worth it.

### T3. `canonicalize` is idempotent and injective-on-canonical-text
`packages/core/src/canonical-json.ts`, consumed by `executionContractSha256` (`packages/orchestration/src/execution-contract.ts:305`)

> **Property A (idempotence).** For every JSON value `v` reachable from the parser, `canonicalize(parse(canonicalize(v))) === canonicalize(v)`.
> **Property B (order independence).** For every object, `canonicalize` is invariant under key insertion order.
> **Property C (well-formedness).** `canonicalize(v)` is always a well-formed UTF-16 string (`String.prototype.isWellFormed()`).

B and C matter because `executionContractSha256` is `sha256Hex(canonicalize(contract))`, and `sha256Hex(string)` encodes as UTF-8. **[verified] `sha256Hex("\uD800") === sha256Hex("�")` — `sha256Hex` is not injective over JS strings**, because Node's UTF-8 encoder replaces lone surrogates with U+FFFD. `canonicalize` happens to protect you (`JSON.stringify` is well-formed since ES2019, so a lone surrogate becomes the literal ASCII `\ud800` — **[verified]**), but nothing states that invariant or tests it. Property C pins it. Anyone who later "optimises" the string branch away breaks contract-digest integrity silently.

Property B also protects the key ordering. **[verified]** `canonicalize({"\u{1F600}":1,"～":2})` sorts the astral emoji first — correct UTF-16 code-unit order, which is what RFC 8785 mandates. A well-meaning future change to `localeCompare` or code-point ordering would break every stored digest. `Object.keys(obj).sort()` gives the right answer *by accident of JS defaults*; a property test converts that accident into a checked contract.

**Cost:** ~30 lines using `fc.jsonValue()` (built in). Cheap, and it locks a security-relevant invariant.

### T4. `compareSemVer` is a total order consistent with `parseFirstSemVer`
`packages/orchestration/src/vendor-preflight.ts:130`

> **Property.** `compareSemVer` is a total preorder: antisymmetric (`sign(cmp(a,b)) === -sign(cmp(b,a))`), transitive, reflexive-zero. And it agrees with SemVer 2.0 precedence: a release sorts above every prerelease of the same core; numeric prerelease identifiers sort below alphanumeric ones; shorter prerelease prefixes sort below longer.

This is the textbook property-testing win: a comparator with a mixed `number | string` element type, five early returns, and a `Math.max` loop with two index-overrun branches. Transitivity across mixed numeric/alphanumeric prerelease identifiers is exactly what humans get wrong and what shrinking finds in seconds.

Gate it further with a **sortedness metamorphic property**: generate an array of `SemVer`, sort with `compareSemVer`, and assert the result is non-decreasing under the comparator. That catches non-transitivity without you having to write the triple loop.

**Cost:** ~25 lines. Do this one.

### T5. `parseArgs` / `argvWithoutDetach` re-exec fidelity
`packages/launcher/src/cli.ts:73, :183`

> **Property.** For every argv `a` where `parseArgs(a)` is `Ok`, `parseArgs(argvWithoutDetach(a))` is also `Ok` and equals `parseArgs(a)` in every field except `detach`, which is `false`.

**This property fails today. [verified]**

```
a = ["--heartbeat-file", "--detach", "--", "echo", "hi"]
parseArgs(a)                       → Ok { heartbeatFile: "--detach", detach: false, cmd: ["echo","hi"] }
argvWithoutDetach(a)               → ["--heartbeat-file", "--", "echo", "hi"]
parseArgs(argvWithoutDetach(a))    → UsageError "--heartbeat-file requires a path"
```

`argvWithoutDetach` filters `--detach` out of the flags slice by *value*, with no knowledge of which tokens are flag *arguments*. `parseArgs` happily accepts `--detach` as a heartbeat-file path (the check is only `if (!v)`). The detached self-re-exec in `main.ts:97` therefore builds an argv that cannot parse, and the child dies with a usage error. The blast radius is small (a path named `--detach` is unlikely) but the defect class — two functions that must agree on argv structure, implemented independently — is exactly what a round-trip property is for.

The right fix is structural: `argvWithoutDetach` should be derived from the parsed value, not from string filtering. The property then holds by construction.

**Cost:** ~15 lines of test. The fix is a small refactor. High value because it is a *live* correctness bug in a re-exec path.

### T6. `normalizeAbsolutePath` is idempotent and injective enough for authority comparison
`packages/orchestration/src/credential-profile.ts:155`, duplicated as `normalizeRootInput` in `packages/orchestration/src/secret-scan.ts`

> **Property A.** `normalizeAbsolutePath(normalizeAbsolutePath(p)) === normalizeAbsolutePath(p)`.
> **Property B.** If `normalizeAbsolutePath(p) === normalizeAbsolutePath(q)` then `p` and `q` denote the same filesystem path.

**Both fail on POSIX. [verified]**

```
normalizeAbsolutePath("/tmp/x\\")   → "/tmp/x"      // same as normalizeAbsolutePath("/tmp/x")
normalizeAbsolutePath("/tmp/y\\\\") → "/tmp/y\\"    // not a fixpoint
```

The function strips a trailing `\` unconditionally, on every platform. On Linux `\` is an ordinary filename character, so a directory literally named `x\` normalises to the *different* directory `x`. `credential-profile.ts` uses normalised paths for authority comparison, so this is a path-confusion primitive: two distinct roots compare equal.

The fix is to strip only `path.sep` (and on Windows, both). This is the cross-platform-fixture defect class from this week, generalised: **a path routine that hard-codes both separators is wrong on exactly one of the two platforms.** A generator that emits `\` and `/` inside path *components* finds it immediately; a human writing fixtures never types `x\` as a directory name.

**Cost:** ~15 lines of test, 3 lines of fix, applied twice. Do it.

### T7. `parseManifestTools` fails closed on every mutation of the real manifest
`packages/orchestration/src/dependency-drift.ts:179`

> **Property.** For every single-line deletion, duplication, or whitespace perturbation of `env/reference-manifest.toml`, `parseManifestTools` returns either the identical record set or an `Error` — never a *different, smaller, silently-accepted* record set.

The risk here is not a crash, it is **silent under-detection**: this parser feeds the dependency-drift gate, and a record that quietly loses its `required = true` weakens a gate without failing anything. The parser ignores every line it does not recognise, so `id = 'x'` (valid TOML single-quoted string), `id = "x"  # note`, and `id = "a\"b"` are all silently dropped. All three currently produce `"missing id in [[tools]] record"` — fail-closed, which is correct — but that is not asserted anywhere.

I would **not** differential-fuzz this against a real TOML library. That means a new production-adjacent dependency for a file that is repo-controlled and 100 lines long. Instead: a *mutation* property over the real manifest, which is mechanical, dependency-free, and directly encodes the threat model.

**Cost:** ~30 lines, no new deps. Medium value.

---

## 2. Round-trips and invariants — which hold, and which only look like they do

This is where I most want to correct an intuition. Several round-trips in this repo look canonical and are not.

### Holds: `SemVer → formatSemVer → parseFirstSemVer` (value side only)
`parseFirstSemVer(formatSemVer(v))` deep-equals `v` for every `v` the parser can produce. Assert this.

### **Does not hold**: `text → parseFirstSemVer → formatSemVer → text`
The `SemVer` type has no `build` field. `parseFirstSemVer("1.2.3+abc")` and `parseFirstSemVer("1.2.3+def")` produce identical values. This is correct per SemVer 2.0 (build metadata is ignored for precedence) but it means the text round-trip is lossy **by design**. Do not write it. If someone does, they will "fix" it by adding a build field and change precedence semantics.

### **Does not hold**: `text → parse → canonicalize → text`
**[verified]** `canonicalize(parse("12345678901234567890"))` is `"12345678901234567000"`. Also `"1.0" → "1"`, `"1e2" → "100"`, `"-0" → "0"`. `isCanonicalJsonText` correctly returns `false` for all of these.

The consequence is sharper than "lossy". Because JSON numbers land on IEEE-754 doubles, **two distinct JSON texts with distinct integer values canonicalize to the same text, and therefore to the same SHA-256.** `12345678901234567890` and `12345678901234567891` are indistinguishable after `canonicalize`. `executionContractSha256` inherits that: if any contract field ever admits a caller-controlled integer above 2⁵³, the digest is not a commitment to the input.

Today `decodeExecutionContractV1` uses `expectString`/`isSha256Hex` for the fields that matter, so this is not exploitable. But `expectNumber` accepts any finite double, and `canonicalize` is a shared primitive. **The property to write is not "round-trip"; it is `isCanonicalJsonText(canonicalize(parse(t)))` — canonicalisation reaches a fixpoint in one step.** That one holds and is worth pinning.

The property *not* to write is `canonicalize(parse(t)) === t`. It is false for a large, boring, well-understood set of inputs, and a test asserting it will be "fixed" by weakening the canonicaliser.

### **Does not hold**: `bytes → decodeUtf8Fatal → text`, when a BOM is present
**[verified]**

```
decodeUtf8Fatal(new Uint8Array([0xEF,0xBB,0xBF,0x7B,0x7D]))  → "{}"   (length 2, BOM silently consumed)
isCanonicalJsonText("{}")                                     → true
sha256Hex(bytes) === sha256Hex(decodedText)                   → false
```

`TextDecoder("utf-8", { fatal: true })` defaults `ignoreBOM: false`, which — confusingly — means *strip the BOM*. So a store file whose bytes are `EF BB BF 7B 7D` decodes to a string that passes the canonical-JSON check, while its byte digest differs from the digest of the canonical bytes.

`files-only-hostile.test.ts` tests invalid UTF-8 in `CURRENT` (bytes `FF FE FD`) but **not a BOM**. That is the gap. Any code path that verifies "these bytes hash to X" and separately verifies "the decoded text is canonical" will accept a file that satisfies both while the two checks disagree about what the file is.

The decision is a design one, not a test one: either set `ignoreBOM: true` (BOM becomes U+FEFF, canonicality check then fails — fails closed) or explicitly reject a leading BOM in `decodeUtf8Fatal`. I would reject it explicitly, with a distinct `CoreFailure`. Then the property `sha256Hex(bytes) === sha256Hex(decodeUtf8Fatal(bytes))` holds for all accepted inputs, and can be asserted.

### **Holds, but only accidentally**: `sha256Hex` over strings
**[verified]** `sha256Hex("\uD800") === sha256Hex("�")`. `sha256Hex` is not injective over JS strings. It is safe in practice only because every call site feeds it `canonicalize` output, which is well-formed. Pin that with property C in T3 rather than trusting it.

### Mode / identity encoding: assert the *ordering*, never the values
`PathIdentity = {dev, ino, kind}` (`credential-profile.ts:632`), `liveModeBits` = `lstat().mode & 0o777`.

There is no round-trip property here worth writing, and this is the direct lesson of this week's inode defect. Concretely:

- `st.ino` is not stable across a delete/recreate on some filesystems and is stable on others. tmpfs recycles aggressively; ext4 does not. That is not a property of the code.
- On Windows, Node synthesises `dev`/`ino`; `identitiesEqual` degenerates toward "everything is equal".
- `mode & 0o777` on Windows yields synthesised `0o666`/`0o444` regardless of the real ACL.

The correct testable statements are **relational, not absolute**:

> `identitiesEqual(a, b)` implies `a.kind === b.kind`.
> `classifyFromStats` is total: every `Stats` maps to exactly one of `symlink | directory | file | other`, and `symlink` wins over `directory` and `file` (the Windows-junction case the code comments on).
> Capturing identity twice on an *unchanged* path yields equal identities.

Do **not** write "a recreated directory has a different inode". That is the defect. It is an assertion about the filesystem, and it belongs — if anywhere — in a guarded integration test that skips unless it has first empirically confirmed the filesystem behaves that way.

---

## 3. A shared generator library for hostile input

### Where it should live

**`packages/testkit/src/index.ts`** — a new private workspace package.

Rationale, and the alternatives I rejected:

- **Not `packages/core/src/testing/`.** Even though `scripts/build-runtime.ts` bundles from 15 explicit entry points and would never reach it, putting arbitraries in a package that ships makes `fast-check` a dependency of `@foreman/core`'s dependency graph on paper. That invites exactly the kind of "why does core depend on a fuzzer" audit finding this project generates weekly.
- **Not `tests/lib/`.** That is bats territory (74 `.bats` files); mixing TypeScript arbitraries in would blur a boundary that is currently clean.
- **`packages/testkit`** is picked up by the root `workspaces: ["packages/*"]` so `npm i` wires it automatically; it is *not* picked up by `npm test`, because the test script globs each package explicitly. It holds `fast-check` as its own devDependency, and each consuming package adds `"@foreman/testkit": "*"` as a devDependency. `tsconfig.all.json` already includes `packages/**/*.ts`, so it typechecks with no config change.

### Contents

Four modules. Deliberately small — a generator library that grows past ~200 lines becomes a thing to maintain rather than a thing to use.

**`paths.ts`** — the highest-value module, because §2 showed two live path bugs.

```
hostilePathComponent()   // one path component
```
Draw from: `"."`, `".."`, `"..."`, `""`, `" "`, `"a "`, `" a"`, `"a."` (Windows-hostile trailing dot), `"a\\b"` (backslash as a POSIX filename char — this is what finds T6), `"a/b"`, `" "`, `"a b"`, `"CON"`, `"NUL"`, `"aux.txt"` (Windows reserved device names), `"a:b"` (ADS separator), a 255-byte component, a 256-byte component (crosses `NAME_MAX`), `"é"` (NFC) vs `"é"` (NFD — the macOS/HFS normalisation trap), `"﻿"`, `"‮"` (RTL override), a lone-surrogate component, and a plain `fc.string()` fallback so shrinking has somewhere to go.

```
hostilePath({ absolute, depth })   // joins components with a chosen separator
```
Critically: the separator is itself generated (`"/"`, `"\\"`, and mixed). Fixtures that hard-code POSIX separators are this week's defect; a generator that only emits `/` reproduces it.

**`bytes.ts`**
```
invalidUtf8()      // truncated 2/3/4-byte sequences, continuation without lead,
                   // overlong C0 80, surrogate encodings ED A0 80, 5-byte F8,
                   // and F4 90 80 80 (above U+10FFFF)
bomPrefixed(inner) // EF BB BF ++ inner            ← would have caught the BOM gap
utf16Bom()         // FF FE / FE FF misread as UTF-8
lineEndings()      // "\n" | "\r\n" | "\r" | "\r\r\n" | "\n\r"
ndjsonLog(events)  // valid events joined with generated line endings, optional
                   // trailing newline, optional torn tail
chunking(bytes)    // arbitrary partition of a byte array — pairs with ndjsonLog for T2
```

**`json.ts`**
```
canonicalJsonValue()  // fc.jsonValue() minus the number cases that lose precision,
                      // so number normalisation does not swamp every other failure
nestedJsonText(d)     // "[".repeat(d) + "]".repeat(d) and object equivalents,
                      // with d drawn up to well past MAX_JSON_DEPTH  ← finds T1
duplicateKeyText()    // structurally valid JSON with a repeated key at a chosen depth
```
The first one matters more than it looks. If you hand `fc.jsonValue()` straight to a canonicalisation property, roughly every counterexample will be a float-formatting difference, and the interesting structural failures never surface. Constrain the generator; state the number behaviour as its own separate, explicitly-lossy test.

**`fsshapes.ts`** — a *description* type, not an effect:
```
type FsShape = { kind: "file" | "dir" | "symlink" | "dangling-symlink"
                       | "hardlink" | "missing" | "fifo";
                 target?: string; mode?: number }
fsShape(): Arbitrary<FsShape>
materialize(root, shape): void   // creates it under a temp root; skips fifo/symlink
                                 // where unsupported and reports the skip
```
This is what generalises `files-only-hostile.test.ts`. That suite is genuinely good — it covers duplicate JSON keys, invalid UTF-8, symlinked root, symlinked `CURRENT`, hard-linked `CURRENT`, and traversal via `CURRENT` — but each case is bespoke: mkdtemp, construct, `assert.throws`, `rmSync` in a `finally`. Six cases, six near-identical bodies. The generator turns "which hostile shape, at which position in the store" into two dimensions you can sweep, and the sweep is where you discover the combination nobody wrote (a symlinked *generation directory*; a hard-linked `generation.json`; a `CURRENT` that is a FIFO).

**Explicit non-goal:** `materialize` must never generate a symlink whose target escapes the temp root by an unbounded `..` chain, and it must never generate outside `mkdtemp`. A generator that can write anywhere is a footgun that will eventually run in CI as root.

**Cost of the whole library:** ~250 lines plus one workspace package. It pays for itself the first time `files-only-hostile.test.ts` gains a case for free.

---

## 4. Where property testing is the WRONG tool

I want to be blunt: **the overwhelming majority of these 1334 tests should stay example-based, and the property-test footprint I am recommending is about 8 files.** Property testing is a specialised instrument, and this repo has a specific reason to be careful with it — it is testing *refusals*, and a refusal test's value comes from naming exactly which refusal fires.

### 4.1 Anything whose assertion is a specific failure tag

`replay.test.ts` asserts `torn_tail`, `sequence_duplicate`, `cursor_beyond_eof`, `line_too_large`, `input_too_large`, `event_structure_limit`. A property can say "some stop occurred". Only an example can say "*this* stop occurred, at *this* line". The taxonomy is the contract. Keep every one of these as an example.

### 4.2 Exact-boundary acceptance

`replay.test.ts:246-353` — "accepts a line of exactly `MAX_PHYSICAL_LINE_BYTES`", "rejects one byte over", "accepts total input exactly at `MAX_REPLAY_INPUT_BYTES`", "accepts exactly `MAX_PHYSICAL_LINES` and rejects plus one". These are perfect as written. A random generator hits an exact boundary with probability ~0. `fc.constantFrom(MAX-1, MAX, MAX+1)` is not a property test, it is a table-driven example test with extra machinery. Do not convert these.

### 4.3 Exhaustive enumeration where the space is small

`replay.test.ts:188` splits a fixed log at **every** byte boundary. That is stronger than any number of random draws and it is already written. The rule: **if the input space is enumerable in under a second, enumerate it — do not sample it.** Same applies to `it.each(budgetDimensions)` in the council budget test: nine dimensions, enumerate them.

### 4.4 Filesystem and platform semantics

The inode defect from this week is the case study. `st.ino` behaviour after delete/recreate is a property of tmpfs versus ext4, not of the code. Generating a thousand delete/recreate cycles gives a thousand results that agree with each other and disagree with the other filesystem. Property testing gives false confidence here at real runtime cost.

The correct instrument is a **capability probe**: at suite start, empirically determine whether this filesystem recycles inodes / supports symlinks / supports hard links / reports meaningful mode bits, and skip-with-a-reason otherwise. The repo already has the pattern — `setSecretScanDirectoryAnchorCapabilityForTests` and `secretScanDirectoryAnchorSupported()` (`secret-scan.ts:263, :275`) are exactly this. Extend it; don't fuzz it.

### 4.5 Anything whose oracle is "the same code, restated"

`canonicalize` is 30 lines. A property test whose oracle re-implements sorted-key serialisation tests that you can write the same bug twice. Prefer idempotence, order-independence, and fixpoint properties (§2) — metamorphic relations that do not need an independent implementation.

### 4.6 Environment-sensitive resource bounds

The bounded-scan test that broke when a sibling package's `node_modules` pushed the tree past 256 MB is not a property-testing target. It is a test whose *fixture* was the ambient filesystem. The fix is fixture isolation — scan a `mkdtemp` root you constructed — not more input variation. Adding property testing to a test with an uncontrolled fixture multiplies the flakiness.

### 4.7 CLI wiring, process spawning, git interaction

`supervise.test.ts`, `architecture-git.typed.test.ts`, the `*-cli.test.ts` family, and all 74 `.bats` suites. These are integration surfaces where each scenario has a specific narrative. Property testing them produces slow, flaky, uninformative tests. (Note in passing: `packages/launcher/src/supervise.test.ts` is currently **failing** on this checkout — 1328 pass / 1 fail. Worth someone's attention independent of this report.)

### The mechanical rule I would adopt

> A test may use `fc.assert` only if its assertion is one of: a **total-function** claim (never throws / always returns one of these tags), an **algebraic law** (idempotence, involution, transitivity, order-independence, fixpoint), or a **metamorphic relation** (two computation paths agree). Any test whose assertion names a specific input or a specific output value stays example-based.

That is checkable in review by reading the assertion, and it would keep the property-test footprint at roughly 8 files out of 78.

---

## 5. Determinism and CI

Non-negotiable, because the failure mode of careless property testing is a test suite nobody trusts.

### 5.1 Global configuration, set once

In a shared setup module inside `packages/testkit`:

```ts
fc.configureGlobal({
  numRuns: process.env.FC_DEEP ? 1000 : 100,
  seed: Number(process.env.FC_SEED ?? 0x5EED),   // fixed by default
  endOnFailure: false,                            // shrink; see 5.3
  interruptAfterTimeLimit: 4000,
  markInterruptAsFailure: false,
  verbose: 1,                                     // counterexample + path in output
});
```

**Fixed seed by default is the right call for this project.** The argument for random seeds — "you explore more over time" — is real, but it trades a deterministic suite for a suite that fails on someone else's PR for reasons unrelated to their change. Given this repo's culture of evidence-first verification and merge gates, a property test that fails non-reproducibly will be quarantined within a week. Take the exploration in a scheduled job instead (§5.5).

### 5.2 Runtime budget, enforced

Current baseline: **12.1 s wall for 1334 tests [verified]**. My budget: **property tests add no more than 5 s wall.** With ~8 property files that is ~600 ms each, which `numRuns: 100` plus `interruptAfterTimeLimit: 4000` comfortably respects for pure functions.

The mechanically checkable rule: **`npm test` wall time must stay under 20 s.** Put it in CI as a hard check. It is crude and it works — a slow property test is almost always a generator producing pathologically large values, and the timeout surfaces that on the PR that introduced it rather than three months later.

Corollary: **no property test may touch the filesystem more than once per run.** Materialise a temp root once per `fc.property` body, not per shrink step, and clean it in a `finally`. Filesystem property tests are where the budget dies.

### 5.3 Shrinking

Leave it on (`endOnFailure: false`). Shrinking is most of the value: an unshrunk counterexample from `hostilePath()` is a 200-character unicode string and tells you nothing; the shrunk one is `"a\\"` and tells you everything (that is literally how T6 reads).

Two disciplines that make shrinking work:

- **Prefer `.map` over `.filter`.** `fc.string().filter(s => isValid(s))` shrinks badly and can exhaust its pre-condition budget. Construct valid values directly.
- **Bound every generator explicitly.** `fc.nat({max: N})`, `fc.string({maxLength: N})`, `fc.array({maxLength: N})`. Unbounded generators produce counterexamples that shrink slowly and reproduce slowly. Note the existing council test already does this correctly (`fc.nat({ max: 10_000 })`) — follow it.

### 5.4 Reproducing a CI failure

fast-check prints `seed` and `path` on failure. The reproduction protocol must be one line, documented in `AGENTS.md`:

```
FC_SEED=<seed> FC_PATH=<path> npm test -- packages/core/src/canonical-json.test.ts
```

with the property reading `{ seed: Number(process.env.FC_SEED), path: process.env.FC_PATH }` from the global config. Without this, a CI-only property failure costs an hour instead of a minute, and the second time it happens someone deletes the test.

**And the rule that actually matters: when a property test finds a bug, the fix commit must add a hand-written example test for the shrunk counterexample.** The property test is a *bug-finding* instrument; the example test is the *regression* instrument. They are not substitutes. Every one of the six defects verified in this report should land as a named example test — `"rejects a trailing backslash component on POSIX"`, `"never throws on deeply nested arrays"` — regardless of whether the property that found it is kept.

### 5.5 A deep lane, off the critical path

One scheduled job (nightly or weekly, not per-PR): `FC_SEED=$RANDOM FC_DEEP=1 npm test`, `numRuns: 1000`, random seed, ~2 minutes. Failures open an issue rather than blocking a merge. This recovers the exploration that §5.1 gives up, at zero cost to PR latency and zero risk of an unreproducible red gate.

### 5.6 Do not add a coverage-guided fuzzer

No `jsfuzz`, no `libfuzzer` bindings, no long-running corpus. The parsers here are small, bounded, and already preflighted. The marginal find rate over a well-designed generator does not justify a corpus to store, refresh, and explain to an auditor. If the JSON parser ever becomes the boundary for untrusted network input rather than local files, revisit — not before.

---

## Summary table

| # | Target | Property | Status | Cost |
|---|---|---|---|---|
| T1 | `parseJsonRejectDuplicateKeys` | never throws | **FAILS** — `RangeError` on deep nesting [verified] | ~35 lines |
| T2 | `replayNdjson` | chunk-boundary invariance over generated logs | holds on 3 fixed logs; content unvaried | ~50 lines |
| T3 | `canonicalize` | idempotent, order-independent, well-formed output | holds; unasserted | ~30 lines |
| T4 | `compareSemVer` | total order, SemVer-2.0 consistent | unknown; untested | ~25 lines |
| T5 | `argvWithoutDetach` | preserves `parseArgs` result modulo `detach` | **FAILS** [verified] | ~15 lines + refactor |
| T6 | `normalizeAbsolutePath` | idempotent, injective | **FAILS on POSIX** [verified] | ~15 lines + 3-line fix |
| T7 | `parseManifestTools` | fails closed under manifest mutation | holds; unasserted | ~30 lines |
| — | BOM handling in `decodeUtf8Fatal` | byte digest agrees with text digest | **FAILS** [verified] | design decision first |
| — | `sha256Hex(string)` | injective | **FAILS** [verified]; safe only via `canonicalize` | pin with T3.C |

Total new test code: ~200 lines, plus a ~250-line `packages/testkit`, plus one root devDependency. Against a 12-second suite, the runtime cost is under 5 seconds. Four live defects fall out of it, three of them already confirmed by execution before a single property test has been written.
