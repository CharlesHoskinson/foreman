# SessionDB Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@foreman/session-store` becomes the only SessionDB — `fm-session-main.ts` runs entirely on the port, with no `node:sqlite` import and no `// @ts-nocheck`.

**Architecture:** The port already implements the correct behaviour and Task 6a already moved bootstrap, sidecar ownership and id minting onto it. What remains is the command bodies. One new port method (`retireMeasurement`) closes the last capability gap, then each command moves behind an `FM_SESSION_BACKEND` seam with a frozen golden oracle diffing every step, and the legacy path is deleted.

**Tech Stack:** Node.js 24, TypeScript (`@typescript/typescript6` 6.0.2), `node:sqlite`, `node:test`, `tsx`, Bats.

## Global Constraints

Copied from `docs/superpowers/plans/2026-08-11-sessiondb-port-unification.md`
§ Global Constraints and this plan's governing spec. Every task's requirements
implicitly include this section.

- Node.js 24, TypeScript only. No new Python, Bash, PowerShell, CMD, JavaScript, MJS, or CJS implementation files.
- `@foreman/session-store` must not import from `@foreman/orchestration`. Dependency runs one way.
- The system of record must never import `MemoryIndex`. The import-boundary test in `packages/session-store/src/contract.test.ts` enforces this; keep it passing.
- `NullMemoryIndex` stays the default. No task may make Foreman require network access or credentials.
- Every file you create must be mode `100644`. Files copied from `/mnt/c` land `755`. Check with `git ls-files -s <paths> | grep -v '^100644'` before every commit and clear with `git update-index --chmod=-x`.
- Never add `Co-Authored-By` or any AI attribution to a commit.
- Consult `AGENT_TRAPS.md` § 1 before dispatching any vendor lane.
- Work in the worktree `/home/charl/fm-wt/sdb-task6` on branch `design/sessiondb-port-unification`. Never `git add -A` in the base checkout at `/home/charl/foreman` — a live session can append to SessionDB while you work.
- **`dbPath()` resolves through `--git-common-dir`, which from a worktree is the base checkout.** Every manual `fm-session` run pins `FOREMAN_SESSION_DB` to a scratch path. Nothing rehearses against `/home/charl/foreman/.foreman/session.db` — with one deliberate exception: Task 10 Step 2 records three obligations in it, as the single intentional write to the live record.
- **`npm test` currently fails one case for a local reason.** `secret-scan.test.ts` refuses the worktree with `bound_exceeded` when any file exceeds 16 MB; `launcher/dist/foreman-launch` is a gitignored 94 MB artifact. Move it aside for a full-suite run. Never report that failure as a branch defect.

### Rebuild the runtime bundle, on every task that changes orchestration source

`tests/session.bats` runs the **compiled** bundle at
`skills/foreman/runtime/dist/fm-session.js`, not the TypeScript. A task that
changes `packages/orchestration/src` without rebuilding leaves that suite
testing the previous code, and its green result is hollow.

This was not theoretical. Tasks 5 and 6 both shipped without a rebuild, so the
committed bundle carried **zero** occurrences of `buildRecoveryFromStore`,
`refuseFromPort`, `openStore`, `currentSessionId` or `FM_SESSION_BACKEND` while
source carried 3/3/9/5/1. Every `bats` 29/29 they reported exercised the old
bundle, and `npm run verify-runtime` was failing with `fm-session drift` for two
commits before anyone measured it.

So, on every task that touches `packages/orchestration/src`:

```bash
npm run build
npm run verify-runtime     # must print "verify-runtime: ok"
bats tests/session.bats    # now against the rebuilt bundle
```

and stage `skills/foreman/runtime/dist/` and `skills/foreman/runtime/manifest.json`
with the source change. `npm run verify` chains `verify-runtime`, so a stale
bundle means the branch cannot pass its own aggregate gate.

### The QA plugin is binding, on every task

`plugins/foreman-qa/` is the definition of "done". Its preflight runs on **every**
task:

1. Confirm every command you relied on actually executed. An exit code belongs to the wrapper, not the work. Bind each claim to a non-empty, on-topic artifact you have read.
2. Read the working diff with `git diff` and `git diff --stat`. Review what changed, not what you intended.
3. Run `git ls-files -s` for files in scope and check the modes.
4. **Before committing**, run `bash skills/foreman/scripts/docs-check.sh`. Read and report its output; do not rely on the exit code. It currently reports `markdownlint=pass codespell=pass lychee=pass agent-invocations=pass comments=pass` — keep it there.
5. **After committing**, run `git status --porcelain` and confirm it is empty.
6. State explicitly which checks you did not run and why.

After any late edit — including one prompted by lint — run `git add` again on
every changed file. A commit captures the index, not the working tree.

**Every check must be demonstrated to FAIL against a known-bad input before it
is trusted.** Four defects on this branch were fake verification: a check that
answered a known-bad and a known-good identically.

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/session-store/src/port.ts` | **Modify.** Add `retireMeasurement` to the `SessionStore` interface. |
| `packages/session-store/src/sqlite-store.ts` | **Modify.** Implement `retireMeasurement`. |
| `packages/session-store/src/contract-suite.ts` | **Modify.** Add retire cases to `CASES`. Predicate 3: do not weaken the suite to accommodate the CLI cutover. |
| `packages/orchestration/src/fm-session-main.ts` | **Modify, then shrink.** Commands move onto the port; legacy path deleted in Task 9. |
| `packages/orchestration/src/fm-session-golden.test.ts` | **Modify.** Add the six new golden cases. |
| `packages/orchestration/src/__golden__/` | **Modify.** Six fixtures added; three re-recorded deliberately. |
| `packages/orchestration/src/fm-session-main.test.ts` | **Modify.** Two-step cases the single-invocation golden harness cannot reach. |
| `AGENT_TRAPS.md` | **Modify.** Three traps, symptom first. |

## Seed facts every task depends on

Measured from `packages/orchestration/src/__golden__/seed.ndjson`:

| Kind | Count | Notes |
| --- | --- | --- |
| sessions | 2 | |
| facts | 32 | **16 → 32 and 30 → 34 are superseded.** Ids 31 and 33 are absent. |
| measurements | 5 | ids `3,4,5,6,7`. **None is superseded.** |
| obligations | 34 | id 1 is `open`; ids 7,8,9,10,16,18,21,22,25,27 are `done`. |

Two consequences:

- A refusal that needs an already-superseded **measurement** is not reachable in one CLI invocation, so it belongs in the conformance suite and `fm-session-main.test.ts`, not a golden.
- A refusal that needs an already-superseded **fact** (id 16) or a non-open **obligation** (id 7) *is* reachable in one invocation and gets a golden.

## Three deliberate behaviour changes

Everything else must be byte-identical. These three change because the port's
semantics are correct and the legacy ones are defects:

1. **`supersede` a missing fact** — legacy inserts an orphan, prints success, exits 0. Port refuses. (Already frozen as `supersede-missing`.)
2. **`supersede` an already-superseded fact** — legacy overwrites the supersession pointer. Port refuses: set-once.
3. **`close` a non-open obligation** — legacy accepts any `--status` and wipes `blocker`. Port refuses and never writes `blocker`.

A fourth, in the same class but not golden-reachable: **`retire` an
already-retired measurement** — legacy silently overwrites the pointer, the port
refuses. Covered in Task 2 and Task 7 by unit and conformance cases.

---

### Task 1: Re-review Task 6a

`913a9d0` is committed but unreviewed — its review died on an internal error
before returning. It changed bootstrap, sidecar ownership, id minting and
`integrity.ts`. Every golden recorded after it is anchored to that baseline, so
a defect found later would be buried under eight more steps of work.

The eight Minor findings PR #45 attributes to "the plan's ledger" exist nowhere:
not in the plan, not in the PR body, and PR #45 carries zero reviews and zero
review comments. **Treat them as lost and re-derive from the diff. Do not spend
time hunting for them.**

**Files:**

- Modify: none. This task reviews only.

**Interfaces:**

- Consumes: nothing.
- Produces: a verdict. Tasks 2 onward are blocked until Major findings are resolved.

- [ ] **Step 1: Gather the review context**

```bash
cd /home/charl/fm-wt/sdb-task6
git show 913a9d0 > /tmp/6a-review/diff.txt
git show --stat 913a9d0 > /tmp/6a-review/stat.txt
git ls-files -s packages/session-store/src packages/orchestration/src | grep -v '^100644' || echo "modes ok"
bash skills/foreman/scripts/docs-check.sh 2>&1 | tee /tmp/6a-review/docs-check.txt
```

Create `/tmp/6a-review` first. Expected: `modes ok`, and docs-check reporting
`markdownlint=pass codespell=pass lychee=pass agent-invocations=pass comments=pass`.

- [ ] **Step 2: Dispatch the reviewer**

Follow `plugins/foreman-qa/commands/foreman-qa-review.md`. Use the Task tool to
invoke the `foreman-qa-reviewer` subagent, per
`plugins/foreman-qa/agents/foreman-qa-reviewer.md`. Hand it the complete diff,
the mode listing, and the **exact** `docs-check.sh` output. State explicitly
that the diff under review is commit `913a9d0`, already committed, and that its
prior review did not complete.

Relay the subagent's output **verbatim**. Do not edit, summarize, soften, or
omit any finding or verdict.

- [ ] **Step 3: Record the verdict**

Write the verbatim findings to
`docs/reviews/2026-08-12-task-6a-review.md`. If the reviewer raises Major or
Critical findings, stop and resolve them in their own commits before Task 2.
Minor findings are carried to Task 10.

- [ ] **Step 4: Commit the review record**

```bash
cd /home/charl/fm-wt/sdb-task6
chmod 644 docs/reviews/2026-08-12-task-6a-review.md
bash skills/foreman/scripts/docs-check.sh
git add docs/reviews/2026-08-12-task-6a-review.md
git ls-files -s docs/reviews | grep -v '^100644' || echo "modes ok"
git commit -m "docs(session-store): record the Task 6a review that did not complete"
git status --porcelain
```

---

### Task 1b: Repair the Task 6a baseline

Inserted after the Task 1 review returned BLOCKED. The full review is
`docs/reviews/2026-08-12-task-6a-review.md`; read findings 1-4 there for the
reproduction of each defect. Two of them sit inside `bootstrapStore`, which
Task 5 wraps in `openStore()` and calls from every command, so leaving them
would propagate the defects through the rest of the cutover rather than
inherit them once.

Fix the two blocking and two major findings **only**. The eight minor findings
are recorded in the SDD ledger and triaged at the final whole-branch review;
do not fix them here.

**Files:**

- Modify: `packages/session-store/src/sidecar.ts`
- Modify: `packages/orchestration/src/fm-session-main.ts`
- Test: `packages/session-store/src/sidecar-v1.test.ts` or a new `sidecar-encode.test.ts`
- Test: `packages/orchestration/src/fm-session-main.test.ts`

**Interfaces:**

- Consumes: `assertIntegrity` and `findViolations` from `./integrity.js`; `SessionSnapshot` from `./entities.js`.
- Produces: `classifyStore` gains a fourth return value, `"corrupt"`. `encodeSnapshot` becomes throwing. Tasks 4-9 depend on both.

- [ ] **Step 1: Write the failing test for the unvalidated write path**

The reader asserts integrity and the writer does not, so the CLI can write a
tracked record its own reader refuses and report success. Add to
`packages/session-store/src/sidecar-v1.test.ts`:

```ts
test("encodeSnapshot refuses a snapshot the reader would reject", () => {
  // A row id at or above its watermark is the exact violation the live
  // corruption produced: fact 36 present, next_ids.fact still 1.
  const snap: SessionSnapshot = {
    ...emptySnapshot(),
    sessions: [],
    facts: [
      {
        id: 36,
        statement: "live fact",
        evidence: null,
        established_ts: "2026-08-08T10:00:00Z",
        session_id: null,
        superseded_by: null,
        superseded_at: null,
        supersede_reason: null,
      },
    ] as never,
  };
  assert.ok(
    findViolations(snap).some((v) => v.detail.includes("at or above nextIds.fact")),
    "fixture does not reproduce the violation under test",
  );
  assert.throws(() => encodeSnapshot(snap), /at or above nextIds\.fact/);
});
```

Import `emptySnapshot`, `findViolations`, `encodeSnapshot` and the
`SessionSnapshot` type if the file does not already have them.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/session-store/src/sidecar-v1.test.ts 2>&1 | tail -15
```

Expected: FAIL — `encodeSnapshot` returns a string instead of throwing. The
first assertion must PASS; if it does not, the fixture is wrong and the test
would be vacuous.

- [ ] **Step 3: Make the writer validate what it emits**

In `packages/session-store/src/sidecar.ts`, call `assertIntegrity(snapshot)` at
the top of `encodeSnapshot`, before any serialization.

```ts
export function encodeSnapshot(snapshot: SessionSnapshot): string {
  // Symmetric with decodeSnapshot, which ends in assertIntegrity. Without this
  // the writer emits records the reader refuses and the caller reports success:
  // the tracked record becomes unreadable at the moment it is written, and
  // rehydrate downgrades the failure to a warning, so a cold clone comes up
  // silently empty rather than loudly broken.
  assertIntegrity(snapshot);
  // ... existing body unchanged
}
```

- [ ] **Step 4: Stop rehydrate from downgrading an unreadable record**

In `packages/orchestration/src/fm-session-main.ts`, `rehydrateFromSidecarIfEmpty`
currently swallows a decode failure into a `WARNING` and continues. An
unreadable tracked record is not a warning — it is the record of truth being
gone. Make it refuse:

```ts
  try {
    const res = rebuildFromSidecar({ sidecarPath: sidecar, dbPath: p, force: true });
    process.stderr.write(`rehydrated ${res.rowsWritten} row(s) from ${sidecar} (the .db is a derived cache; the sidecar is what git tracks)\n`);
  } catch (e: any) {
    // The sidecar is the tracked record of truth. If it cannot be read, coming
    // up empty is worse than failing: the next write would produce a "correct"
    // store with none of the history in it.
    process.stderr.write(`refusing: the session store is empty and the tracked sidecar at ${sidecar} could not be read: ${e.message}\n`);
    throw e;
  }
```

- [ ] **Step 5: Run the full session-store and orchestration suites**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/session-store/src/*.test.ts 2>&1 | tail -15
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -10
```

Expected: the new test PASSES. **Any conformance or golden case that now fails
is a real finding, not a nuisance** — it means that case was encoding a snapshot
the reader would refuse. Report each one; do not weaken the assertion to make
them pass.

- [ ] **Step 6: Write the failing test for the corrupt-shape classifier**

`classifyStore` returns `"port"` on sight of `store_meta`, but the corruption it
exists to prevent *creates* `store_meta` while leaving `schema_meta` in place and
every watermark at 1. Add to `packages/orchestration/src/fm-session-main.test.ts`:

```ts
test("classifyStore rejects a legacy+port hybrid instead of calling it port-shaped", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-hybrid-"));
  try {
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      // The shape the pre-fix code produced: legacy schema still present, the
      // port's tables created beside it, watermarks at 1 against live ids.
      db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO schema_meta VALUES('version','3')");
      db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
      db.exec("INSERT INTO facts VALUES(36,'live fact')");
      db.exec("CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO store_meta VALUES('next_id.fact','1')");
    } finally {
      db.close();
    }
    assert.equal(classifyStore(p), "corrupt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("classifyStore rejects a port file whose watermark sits behind its rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-behind-"));
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    store.addFact({
      statement: "one", evidence: null,
      established_ts: "2026-08-08T10:00:00Z", session_id: null,
    });
    store.close();
    const db = new DatabaseSync(p);
    try {
      // Drive the watermark back behind the row it already minted.
      db.exec("UPDATE store_meta SET value='1' WHERE key='next_id.fact'");
    } finally {
      db.close();
    }
    assert.equal(classifyStore(p), "corrupt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

`classifyStore` must be exported for these to run. Add `export` to it.

- [ ] **Step 7: Run them to confirm they fail**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/orchestration/src/fm-session-main.test.ts 2>&1 | tail -20
```

Expected: both FAIL, reporting `"port"` where `"corrupt"` is required.

- [ ] **Step 8: Make the classifier reject rather than assume**

```ts
/**
 * How the file at `p` is shaped, decided STRUCTURALLY.
 *
 * Four shapes, not three. "corrupt" is the one this classifier previously
 * could not say: the port opened straight onto a legacy file CREATES
 * store_meta while leaving schema_meta in place and every watermark at 1, so
 * "has store_meta" classified that exact wreckage as healthy and the next
 * write minted id 1 beside live id 36. The presence of store_meta is
 * untrustworthy in the same way a version number is.
 */
export function classifyStore(p: string): "absent" | "legacy" | "port" | "corrupt" {
  if (!existsSync(p)) return "absent";
  const db = new DatabaseSync(p);
  try {
    const names = new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as any[]).map(r => r.name));
    const hasPort = names.has("store_meta");
    const hasLegacy = names.has("schema_meta");
    if (hasPort && hasLegacy) return "corrupt";
    if (hasPort) {
      // A watermark at or below its table's max(id) means the next mint
      // collides. Cross-check before declaring the file healthy.
      for (const [kind, table] of [["fact", "facts"], ["measurement", "measurements"], ["obligation", "obligations"]] as const) {
        if (!names.has(table)) continue;
        const row = db.prepare(`SELECT MAX(id) AS m FROM ${quoteIdentifier(table)}`).get() as any;
        const max = row && row.m !== null ? Number(row.m) : 0;
        const wm = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(`next_id.${kind}`) as any;
        const next = wm ? Number(wm.value) : 0;
        if (next <= max) return "corrupt";
      }
      return "port";
    }
    if (hasLegacy) return "legacy";
    return "absent";
  } finally {
    db.close();
  }
}
```

- [ ] **Step 9: Refuse a corrupt store in `bootstrapStore`**

A corrupt file must be named and refused, never silently repaired — the rebuild
path takes its content from the file itself, and this file's content is exactly
what cannot be trusted.

```ts
  } else if (shape === "corrupt") {
    process.stderr.write(
      `refusing: the session store at ${p} carries both the legacy and port schemas, or identity counters behind its own rows. ` +
      `It is the half-migrated state a pre-fix open produced. Move it aside and let the tracked sidecar rebuild it: ` +
      `mv ${p} ${p}.corrupt && fm-session recover\n`,
    );
    process.exit(2);
  }
```

- [ ] **Step 10: Run the classifier tests and the goldens**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/orchestration/src/fm-session-main.test.ts 2>&1 | tail -10
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -10
git diff --stat packages/orchestration/src/__golden__
```

Expected: classifier tests PASS, goldens PASS, and **no golden fixture changed**.
The golden workspace starts with no `.db` at all, so it takes the `"absent"`
path and is unaffected.

- [ ] **Step 11: Hold the write lock across mint and insert**

`mintId` is a `SELECT` in one autocommit transaction, an `INSERT OR REPLACE` in
a second, and the caller's row `INSERT` in a third. Two processes that read the
watermark before either bumps it mint the same id; `busy_timeout` cannot help
because neither is ever blocked. The port's own `importSnapshot` uses
`BEGIN IMMEDIATE` for this reason.

Add a helper and route every `mintId` caller through it, so the mint and the row
insert commit as one unit:

```ts
/**
 * Run `body` with the write lock held from the first read to the last write.
 *
 * mintId reads a watermark and the caller then inserts a row against it. Split
 * across autocommit transactions those are two independent reads of the same
 * counter, and busy_timeout never fires because neither writer is ever blocked.
 * BEGIN IMMEDIATE takes the write lock up front, which is what makes the
 * read-modify-write atomic.
 */
function inWriteTx<T>(conn: DatabaseSync, body: () => T): T {
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = body();
    conn.exec("COMMIT");
    return out;
  } catch (e) {
    try { conn.exec("ROLLBACK"); } catch (_) {}
    throw e;
  }
}
```

Wrap each of the four `mintId` call sites — `fact`, `measure`, `obligation` and
`supersede` — so the mint and the insert(s) are inside one `inWriteTx`. For
`supersede`, both the new row's insert and the `UPDATE` of the superseded row go
inside the same transaction.

- [ ] **Step 12: Prove the mint is atomic**

The failure is a race, so a passing single-threaded test proves nothing. Prove
the lock is actually held:

```ts
test("mintId and the row insert commit as one transaction", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-mint-"));
  try {
    const p = join(dir, "session.db");
    const store = SqliteSessionStore.open(p);
    store.close();
    const a = new DatabaseSync(p);
    const b = new DatabaseSync(p);
    try {
      a.exec("PRAGMA busy_timeout=0");
      b.exec("PRAGMA busy_timeout=0");
      a.exec("BEGIN IMMEDIATE");
      // With the write lock held by A, B must not be able to take it. Before
      // the fix both minters proceeded and took the same id.
      assert.throws(() => b.exec("BEGIN IMMEDIATE"), /database is locked|SQLITE_BUSY/i);
      a.exec("COMMIT");
    } finally {
      a.close();
      b.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Then confirm the CLI still mints correctly under real concurrency:

```bash
cd /home/charl/fm-wt/sdb-task6
npm run build
rm -rf /tmp/mintrace && mkdir -p /tmp/mintrace/.foreman && cd /tmp/mintrace && git init -q .
export FOREMAN_SESSION_DB=/tmp/mintrace/.foreman/session.db
for i in 1 2 3 4 5 6 7 8; do
  node /home/charl/fm-wt/sdb-task6/skills/foreman/runtime/dist/fm-session.js fact "concurrent $i" &
done
wait
sqlite3 "$FOREMAN_SESSION_DB" "select group_concat(id) from facts; select value from store_meta where key='next_id.fact';"
```

Expected: eight distinct ids, no gaps beyond crash-safety, and the watermark
strictly above the maximum id. Record the actual output.

- [ ] **Step 13: Stop read commands from migrating the store**

`connectReadonly` is gone, so `recover`, `freshness` and `sidecar` route through
`bootstrapStore()`, which may rebuild the database. `.gitignore` states the read
path was made read-only on purpose; this reverted it without saying so.

The distinction to restore is **rebuilding a missing derived cache is not
migrating an existing store**. Rehydrating an absent `.db` from the tracked
sidecar is legitimate and the goldens depend on it. Migrating a legacy file, or
touching a corrupt one, is authority a read command must not have.

In `bootstrapStore`, take a flag:

```ts
function bootstrapStore(p: string, opts: { readonly allowMigration: boolean }) {
  const shape = classifyStore(p);
  if (shape === "corrupt") {
    // ... refuse, as in Step 9
  }
  if (shape === "legacy") {
    if (!opts.allowMigration) {
      process.stderr.write(
        `refusing: the session store at ${p} is in the pre-port schema and this is a read-only command. ` +
        `Run a write command, or \`fm-session import-sidecar\`, to migrate it.\n`,
      );
      process.exit(2);
    }
    // ... existing migration, unchanged
  } else if (shape === "absent") {
    SqliteSessionStore.open(p).close();
  }
  rehydrateFromSidecarIfEmpty(p);
}
```

Pass `allowMigration: !READ_ONLY_CMDS.has(cmd)` from `connect()`. `READ_ONLY_CMDS`
already exists at `:20` and already lists `recover`, `freshness` and `sidecar`;
it is currently only consulted for the sidecar refresh.

- [ ] **Step 14: Prove a read command no longer migrates**

```ts
test("a read-only command refuses to migrate a legacy store", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-roguard-"));
  try {
    const p = join(dir, "session.db");
    const db = new DatabaseSync(p);
    try {
      db.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT)");
      db.exec("INSERT INTO schema_meta VALUES('version','3')");
      db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY, statement TEXT)");
    } finally {
      db.close();
    }
    const before = statSync(p).mtimeMs;
    const res = spawnSync(process.execPath, ["--import", "tsx", ENTRY, "recover"], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, FOREMAN_SESSION_DB: p },
    });
    assert.notEqual(res.status, 0, "recover migrated a legacy store instead of refusing");
    assert.match(res.stderr, /read-only command/);
    assert.equal(statSync(p).mtimeMs, before, "a read-only command modified the store");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Adapt `ENTRY` and the tsx loader to match how `fm-session-main.test.ts` already
spawns the CLI, if it does; otherwise mirror `fm-session-golden.test.ts:237`.

- [ ] **Step 15: Prove each of the four fixes fails without its fix**

Per `AGENT_TRAPS.md` §3 Rule 2. For each fix, remove it, confirm the matching
test fails, restore it. Record the four results.

```bash
cd /home/charl/fm-wt/sdb-task6
git diff --stat   # must show only the intended changes when finished
```

- [ ] **Step 16: Full gate and commit**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck 2>&1 | tail -10
npm run build && npm run verify-runtime 2>&1 | tail -5
npm test 2>&1 | tail -10
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -5
bats tests/session.bats 2>&1 | tail -5
bash skills/foreman/scripts/docs-check.sh
git add packages/session-store/src packages/orchestration/src skills/foreman/runtime
git ls-files -s packages/session-store/src packages/orchestration/src | grep -v '^100644' || echo "modes ok"
git commit -F <your message file>
git status --porcelain
```

The commit message must state, for each of the four findings, what changed and
what proves it. Do not claim a fix on a passing test alone — name the mutation
that made it fail.

---

### Task 2: `retireMeasurement` on the port

The CLI's `retire <id> --by <existingId>` points one **existing** measurement at
another **existing** one. `supersedeMeasurement` always **inserts** a
replacement, so it cannot express this. Without a port method, Task 9's
predicate 1 cannot pass.

Fan-in is legal and is the point: measurement 17 in the live record is named by
predecessors 1, 8, 14 and 15.

**Files:**

- Modify: `packages/session-store/src/port.ts`
- Modify: `packages/session-store/src/sqlite-store.ts`
- Modify: `packages/session-store/src/contract-suite.ts`
- Test: `packages/session-store/src/contract.test.ts` (runs `ALL_CASES`; no edit needed)

**Interfaces:**

- Consumes: `raise` and `SessionStoreFailureReason` from `./failures.js`; `MeasurementRow` from `./entities.js`; the private `this.tx()` and `this.queueProjection()` helpers already in `SqliteSessionStore`.
- Produces: `SessionStore.retireMeasurement(id: number, byId: number, reason: string | null, at: string): MeasurementRow`. Task 7 calls it.

- [ ] **Step 1: Write the failing conformance cases**

Add these to the end of the `CASES` array in
`packages/session-store/src/contract-suite.ts`, before the closing `];`. They
use the file's existing `assert`, `assertRejects` and `seedFixture` helpers.

```ts
  {
    name: "retire/points-one-existing-measurement-at-another",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const a = s.addMeasurement({
          metric: "suite.pass",
          value: "700",
          value_num: 700,
          command: "bats tests/",
          measured_ts: "2026-08-08T11:00:00Z",
          measured_sha: "aaa111",
          scope_paths: "tests",
          session_id: "S1",
        });
        const b = s.addMeasurement({
          metric: "suite.pass",
          value: "720",
          value_num: 720,
          command: "bats tests/",
          measured_ts: "2026-08-08T12:00:00Z",
          measured_sha: "bbb222",
          scope_paths: "tests",
          session_id: "S1",
        });
        const before = s.listMeasurements().length;
        const retired = s.retireMeasurement(a.id, b.id, "stale", "2026-08-08T12:00:01Z");
        assert(retired.superseded_by === b.id, "superseded_by was not set to byId");
        assert(retired.superseded_at === "2026-08-08T12:00:01Z", "superseded_at was not set");
        assert(retired.supersede_reason === "stale", "supersede_reason was not set");
        assert(
          s.listMeasurements().length === before,
          "retire inserted a row; it must only link existing rows",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "retire/fan-in-many-predecessors-onto-one-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v: string, ts: string) =>
          s.addMeasurement({
            metric: "suite.pass",
            value: v,
            value_num: Number(v),
            command: "bats tests/",
            measured_ts: ts,
            measured_sha: "ccc333",
            scope_paths: "tests",
            session_id: "S1",
          });
        const p1 = mk("1", "2026-08-08T11:00:00Z");
        const p2 = mk("2", "2026-08-08T11:01:00Z");
        const p3 = mk("3", "2026-08-08T11:02:00Z");
        const fresh = mk("4", "2026-08-08T12:00:00Z");
        for (const p of [p1, p2, p3]) {
          s.retireMeasurement(p.id, fresh.id, "retired by a fresh reading", "2026-08-08T12:00:01Z");
        }
        const rows = s.listMeasurements();
        const naming = rows.filter((r) => r.superseded_by === fresh.id);
        assert(naming.length === 3, `expected 3 rows naming ${fresh.id}, got ${naming.length}`);
        // The snapshot must survive integrity validation and round-trip: this
        // is the shape the live record is actually in.
        const back = decodeSnapshot(encodeSnapshot(s.snapshot()));
        assert(snapshotsEqual(s.snapshot(), back), "fan-in snapshot did not round-trip");
      } finally {
        s.close();
      }
    },
  },
  {
    name: "retire/refuses-missing-target",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        assertRejects(
          () => s.retireMeasurement(9999, 1, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "retire/refuses-missing-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const only = s.listMeasurements()[0];
        assert(only !== undefined, "fixture has no measurement");
        assertRejects(
          () => s.retireMeasurement(only.id, 9999, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "retire/refuses-self-retire",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const only = s.listMeasurements()[0];
        assert(only !== undefined, "fixture has no measurement");
        assertRejects(
          () => s.retireMeasurement(only.id, only.id, "r", "2026-08-08T12:00:00Z"),
          "invalid_argument",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "retire/refuses-already-retired-target",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v: string, ts: string) =>
          s.addMeasurement({
            metric: "m",
            value: v,
            value_num: Number(v),
            command: null,
            measured_ts: ts,
            measured_sha: null,
            scope_paths: "x",
            session_id: "S1",
          });
        const a = mk("1", "2026-08-08T11:00:00Z");
        const b = mk("2", "2026-08-08T11:01:00Z");
        const c = mk("3", "2026-08-08T11:02:00Z");
        s.retireMeasurement(a.id, b.id, "first", "2026-08-08T11:03:00Z");
        // Supersession columns are set-once. The legacy CLI silently overwrote
        // this pointer; that is the defect this case pins.
        assertRejects(
          () => s.retireMeasurement(a.id, c.id, "second", "2026-08-08T11:04:00Z"),
          "supersession_incomplete",
        );
      } finally {
        s.close();
      }
    },
  },
  {
    name: "retire/refuses-a-retired-successor",
    run: (f) => {
      const s = f();
      try {
        seedFixture(s);
        const mk = (v: string, ts: string) =>
          s.addMeasurement({
            metric: "m",
            value: v,
            value_num: Number(v),
            command: null,
            measured_ts: ts,
            measured_sha: null,
            scope_paths: "x",
            session_id: "S1",
          });
        const a = mk("1", "2026-08-08T11:00:00Z");
        const b = mk("2", "2026-08-08T11:01:00Z");
        const c = mk("3", "2026-08-08T11:02:00Z");
        s.retireMeasurement(b.id, c.id, "b is retired", "2026-08-08T11:03:00Z");
        assertRejects(
          () => s.retireMeasurement(a.id, b.id, "r", "2026-08-08T11:04:00Z"),
          "invalid_argument",
        );
      } finally {
        s.close();
      }
    },
  },
```

- [ ] **Step 2: Run the cases to verify they fail**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -20
```

Expected: FAIL. `retireMeasurement is not a function`.

- [ ] **Step 3: Add the method to the port interface**

In `packages/session-store/src/port.ts`, inside `interface SessionStore`,
immediately after the `supersedeMeasurement` declaration:

```ts
  /**
   * Mark `id` superseded by the ALREADY EXISTING measurement `byId`.
   *
   * Distinct from supersedeMeasurement, which inserts a replacement. One fresh
   * full-suite reading retires several stale ones, so fan-in onto `byId` is
   * legal: N rows may name the same successor. Only the inverse question
   * ("what did Y supersede") is one-to-many; each row still carries a single
   * superseded_by.
   *
   * Returns the retired row, not a SupersedeResult: no replacement is created,
   * and a `replacement` field holding an untouched pre-existing row would be
   * false.
   */
  retireMeasurement(
    id: number,
    byId: number,
    reason: string | null,
    at: string,
  ): MeasurementRow;
```

- [ ] **Step 4: Implement it**

In `packages/session-store/src/sqlite-store.ts`, immediately after
`supersedeMeasurement`:

```ts
  retireMeasurement(
    id: number,
    byId: number,
    reason: string | null,
    at: string,
  ): MeasurementRow {
    return this.tx(() => {
      if (byId === id) {
        raise("invalid_argument", `measurement ${id} cannot supersede itself`);
      }
      const cur = this.db
        .prepare("SELECT superseded_by FROM measurements WHERE id = ?")
        .get(id) as { superseded_by: number | null } | undefined;
      if (!cur) raise("invalid_argument", `no such measurement ${id}`);
      if (cur.superseded_by !== null) {
        raise(
          "supersession_incomplete",
          `measurement ${id} is already superseded; supersession columns are set-once`,
        );
      }
      const by = this.db
        .prepare("SELECT superseded_by FROM measurements WHERE id = ?")
        .get(byId) as { superseded_by: number | null } | undefined;
      if (!by) raise("invalid_argument", `no such measurement ${byId}`);
      if (by.superseded_by !== null) {
        raise(
          "invalid_argument",
          `measurement ${byId} is itself superseded by ${by.superseded_by}; a retired measurement cannot supersede another`,
        );
      }
      this.db
        .prepare(
          "UPDATE measurements SET superseded_by = ?, superseded_at = ?, supersede_reason = ? WHERE id = ?",
        )
        .run(byId, at, reason, id);
      this.queueProjection("measurement", id, "retract", at);
      return this.db
        .prepare(
          "SELECT id, metric, value, value_num, command, measured_ts, measured_sha, scope_paths, session_id, superseded_by, superseded_at, supersede_reason FROM measurements WHERE id = ?",
        )
        .get(id) as unknown as MeasurementRow;
    });
  }
```

- [ ] **Step 5: Run the cases to verify they pass**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -20
npm run typecheck 2>&1 | tail -20
```

Expected: PASS, and `report.results.length === ALL_CASES.length` still holds
because `contract.test.ts` compares against `ALL_CASES` rather than a literal
count.

- [ ] **Step 6: Prove each guard discriminates, by mutation**

A refusal case that passes without its guard proves nothing. For each of the
five `raise` calls added in Step 4: comment it out, re-run, confirm the matching
case **fails**, then restore it.

```bash
cd /home/charl/fm-wt/sdb-task6
# Repeat once per guard. Example for the set-once guard:
#   comment out the `supersession_incomplete` raise
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | grep -c 'refuses-already-retired-target'
git diff --stat packages/session-store/src/sqlite-store.ts   # must be empty when done
```

Expected: with a guard removed, its case fails. After restoring all five,
`git diff` on `sqlite-store.ts` shows only the intended addition. Record which
five guards you mutated and the result of each.

- [ ] **Step 7: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck && npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -5
bash skills/foreman/scripts/docs-check.sh
git add packages/session-store/src/port.ts packages/session-store/src/sqlite-store.ts packages/session-store/src/contract-suite.ts
git ls-files -s packages/session-store/src | grep -v '^100644' || echo "modes ok"
git commit -m "feat(session-store): retire one existing measurement by another

The CLI's retire points one existing measurement at another existing one.
supersedeMeasurement always inserts a replacement, so it could not express
that, and with retire left on raw SQL the no-backend-access-outside-the-port
predicate could not pass.

Fan-in onto the successor is asserted, not merely permitted: measurement 17
in the live record is named by predecessors 1, 8, 14 and 15, and the fan-in
snapshot is round-tripped through encode and decode to prove the shape the
live record is actually in survives validation.

Supersession stays set-once. The legacy CLI silently overwrote the pointer
when retiring an already-retired measurement; this refuses.

Each of the five guards was removed in turn and its case confirmed to fail."
git status --porcelain
```

---

### Task 3: Freeze the remaining CLI surface as goldens

Six commands and refusal paths have no frozen output. Migrating them without an
oracle means "byte-identical" is unverifiable. Record these **on the legacy
path**, before any command moves.

**Files:**

- Modify: `packages/orchestration/src/fm-session-golden.test.ts`
- Create: six fixture triples under `packages/orchestration/src/__golden__/`

**Interfaces:**

- Consumes: the existing `golden(name, args)` helper at `fm-session-golden.test.ts:283`.
- Produces: fixtures `retire`, `retire-self`, `retire-missing-target`, `retire-missing-by`, `supersede-superseded`, `close-done`. Tasks 6 and 7 diff against them.

- [ ] **Step 1: Add the golden cases**

Append to `packages/orchestration/src/fm-session-golden.test.ts`, after the
existing `close-unknown` test:

```ts
// Seed measurements are 3,4,5,6,7 and none is superseded (see seed.ndjson).
// retire has no recorded defect, so these four must stay byte-identical
// through the cutover.
test("golden: retire a measurement", () =>
  golden("retire", ["retire", "3", "--by", "7", "--reason", "superseded by a fresh reading"]));

test("golden: retire refuses self-supersession", () =>
  golden("retire-self", ["retire", "3", "--by", "3", "--reason", "r"]));

test("golden: retire refuses a missing target", () =>
  golden("retire-missing-target", ["retire", "9999", "--by", "7", "--reason", "r"]));

test("golden: retire refuses a missing superseder", () =>
  golden("retire-missing-by", ["retire", "3", "--by", "9999", "--reason", "r"]));

// KNOWN DEFECT, frozen deliberately. Fact 16 is already superseded by 32 in the
// seed. Today the legacy path overwrites that pointer; supersession is meant to
// be set-once. Task 7 changes this to a refusal and re-records this golden in
// the same commit.
test("golden: supersede an already-superseded fact", () =>
  golden("supersede-superseded", ["supersede", "16", "replacement", "--reason", "r"]));

// KNOWN DEFECT, frozen deliberately. Obligation 7 is already done in the seed.
// Today the legacy path closes it again and wipes its blocker. Task 6 changes
// this to a refusal and re-records this golden in the same commit.
test("golden: close an already-done obligation", () =>
  golden("close-done", ["close", "7", "--status", "done"]));
```

- [ ] **Step 2: Record the fixtures**

```bash
cd /home/charl/fm-wt/sdb-task6
GOLDEN_UPDATE=1 npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -10
git status --porcelain packages/orchestration/src/__golden__
```

Expected: 18 new files (six names x `.out`/`.err`/`.exit`), and **no
modification to the ten existing fixtures**. A changed existing fixture means
the new tests perturbed shared state — stop and find out why.

- [ ] **Step 3: Read every fixture you just recorded**

```bash
cd /home/charl/fm-wt/sdb-task6
for n in retire retire-self retire-missing-target retire-missing-by supersede-superseded close-done; do
  echo "===== $n (exit $(cat packages/orchestration/src/__golden__/$n.exit)) ====="
  echo "--- stdout"; cat packages/orchestration/src/__golden__/$n.out
  echo "--- stderr"; cat packages/orchestration/src/__golden__/$n.err
done
```

Expected, and confirm each by reading rather than assuming:

| Fixture | Expected |
| --- | --- |
| `retire` | exit 0, stdout `measurement 3 retired, superseded by 7` |
| `retire-self` | exit 2, stderr `refusing: a measurement cannot supersede itself` |
| `retire-missing-target` | exit 2, stderr `refusing: no measurement 9999 to retire` |
| `retire-missing-by` | exit 2, stderr `refusing: no measurement 9999 to supersede it` |
| `supersede-superseded` | **exit 0** — the defect. Fact 16's pointer is overwritten. |
| `close-done` | **exit 0** — the defect. Obligation 7 is closed again. |

If `supersede-superseded` or `close-done` is already non-zero, the defect is not
what this plan assumes. Stop and re-measure before continuing.

- [ ] **Step 4: Verify the goldens now pass on a clean run**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
```

Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
git ls-files -s packages/orchestration/src/__golden__ | grep -v '^100644' || echo "modes ok"
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src/fm-session-golden.test.ts packages/orchestration/src/__golden__
git commit -m "test(session): freeze retire, set-once supersede and re-close as goldens

Six paths had no frozen output, so byte-identical was unverifiable for them.
Four retire cases carry no recorded defect and must not move through the
cutover. Two are frozen as known defects and change deliberately later:
superseding an already-superseded fact overwrites a set-once pointer, and
closing an already-done obligation succeeds and wipes its blocker.

Recorded on the legacy path, before any command moves, so the oracle predates
the change it is meant to catch."
git status --porcelain
```

---

### Task 4: Add the backend seam and prove it reaches the child

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: module-level `const BACKEND: "legacy" | "port"`, read by every command in Tasks 5-8.

- [ ] **Step 1: Add the seam**

In `packages/orchestration/src/fm-session-main.ts`, after the import block
(after line 18):

```ts
/**
 * Which store backs the CLI.
 *
 * Deliberately NOT FM_SESSION_CMD. That variable holds the INVOCATION command
 * (`tests/session.bats:13`: SESS="${FM_SESSION_CMD:-node .../fm-session.js}")
 * and is named in v0.3.0 exit predicate 3. A seam keyed on it would read false
 * under the entire Bats suite -- so the suite would measure the legacy path
 * while appearing to exercise the port -- and after the default flips it would
 * silently switch that suite to the port instead.
 *
 * Defaults to legacy until every command is migrated, so a half-finished
 * migration cannot ship silently. Task 8 flips the default.
 */
const BACKEND: "legacy" | "port" =
  process.env["FM_SESSION_BACKEND"] === "port" ? "port" : "legacy";
```

- [ ] **Step 2: Prove the variable reaches the CLI subprocess**

The golden harness builds the child env as
`{...sanitizedCheckpointEnv(process.env), GOLDEN_UPDATE: "", FOREMAN_SESSION_DB: ...}`
(`fm-session-golden.test.ts:237`). `sanitizedCheckpointEnv`
(`round-live-services.ts:143`) strips only names beginning `git_`,
case-insensitively, so `FM_SESSION_BACKEND` should pass through. **A code
reading is not evidence.** Prove it by mutation.

Add a temporary probe at the top of `main()`:

```ts
  if (process.env["FM_SESSION_PROBE"] === "1") {
    process.stderr.write(`BACKEND=${BACKEND}\n`);
    process.exit(0);
  }
```

Then:

```bash
cd /home/charl/fm-wt/sdb-task6
rm -rf /tmp/seamprobe && mkdir -p /tmp/seamprobe/.foreman && cd /tmp/seamprobe
git init -q .
export FOREMAN_SESSION_DB=/tmp/seamprobe/.foreman/session.db
FM_SESSION_PROBE=1 npx tsx /home/charl/fm-wt/sdb-task6/packages/orchestration/src/fm-session-main.ts recover
FM_SESSION_PROBE=1 FM_SESSION_BACKEND=port npx tsx /home/charl/fm-wt/sdb-task6/packages/orchestration/src/fm-session-main.ts recover
```

Expected: `BACKEND=legacy` then `BACKEND=port`. If the second prints `legacy`,
the variable is not arriving and nothing downstream can be trusted.

- [ ] **Step 3: Prove it survives the golden harness specifically**

The probe above tests a direct spawn, not the harness. Temporarily change one
golden assertion to depend on the backend — the cheapest honest check is to make
`recover` write the backend to stderr under the probe variable and run the
harness with it set:

```bash
cd /home/charl/fm-wt/sdb-task6
FM_SESSION_PROBE=1 npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -20
```

Expected: every golden **FAILS** with drifted stderr, because the probe line is
present in the child's output. That failure is the evidence the environment
crosses into the child through the harness. Then:

```bash
FM_SESSION_PROBE= npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
```

Expected: PASS. Record both results.

- [ ] **Step 4: Remove the probe**

Delete the `FM_SESSION_PROBE` block added in Step 2.

```bash
cd /home/charl/fm-wt/sdb-task6
grep -n FM_SESSION_PROBE packages/orchestration/src/fm-session-main.ts || echo "probe removed"
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
git diff --stat packages/orchestration/src/__golden__
```

Expected: `probe removed`, goldens PASS, and **no golden fixture changed**.

- [ ] **Step 5: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck 2>&1 | tail -5
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src/fm-session-main.ts
git ls-files -s packages/orchestration/src/fm-session-main.ts | grep -v '^100644' || echo "modes ok"
git commit -m "feat(session): add the backend seam, named apart from FM_SESSION_CMD

FM_SESSION_CMD already holds the invocation command (tests/session.bats:13)
and is named in v0.3.0 exit predicate 3. A seam keyed on it reads false under
the whole Bats suite, so the suite would measure the legacy path while
appearing to exercise the port; after the default flipped it would silently
switch that suite to the port. The seam is FM_SESSION_BACKEND.

Reachability into the CLI subprocess was proven by mutation rather than by
reading sanitizedCheckpointEnv: with a probe set every golden failed on
drifted stderr, and with it unset every golden passed. sanitizedCheckpointEnv
strips only GIT_* names, so the seam variable crosses intact."
git status --porcelain
```

---

### Task 5: Migrate the read commands

Reads cannot corrupt anything, so they go first. `recover` and `freshness` must
be byte-identical.

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`

**Interfaces:**

- Consumes: `BACKEND` from Task 4; `SqliteSessionStore`, `listFacts`, `listMeasurements`, `listObligations`, `currentSession` from `@foreman/session-store`.
- Produces: `openStore(): SqliteSessionStore` and `currentSessionId(store): string | null`, used by Tasks 6-8.

- [ ] **Step 1: Add the store helpers**

After the `connect()` function in `fm-session-main.ts`:

```ts
/**
 * One port instance per invocation.
 *
 * Not opened per command: bootstrapStore() runs on every open, and the
 * end-of-run sidecar refresh opens its own store, so a per-command open would
 * bootstrap repeatedly and hold three connections to one file in a single run.
 */
function openStore(path?: string): SqliteSessionStore {
  const p = path ?? dbPath();
  mkdirSync(dirname(p), { recursive: true });
  bootstrapStore(p);
  return SqliteSessionStore.open(p);
}

/** The port equivalent of the legacy currentSession(conn). */
function currentSessionId(store: SqliteSessionStore): string | null {
  return store.currentSession()?.session_id ?? null;
}
```

`store.currentSession()` is a direct swap: its query is
`WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1`
(`sqlite-store.ts:340`), identical to the legacy
`currentSession(conn)` at `fm-session-main.ts:529`.

- [ ] **Step 2: Add port-backed recovery and freshness builders**

Add beside `buildRecovery`. The legacy versions filter and order in SQL; these
do it in TypeScript over the port's list methods. Ordering must match: legacy
uses `ORDER BY id DESC`, so sort descending explicitly rather than relying on
the port's declared ordering.

```ts
function buildRecoveryFromStore(store: SqliteSessionStore) {
  const head = gitSha();
  const sessions = [...store.listSessions()].sort((a, b) =>
    a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0,
  );
  const sess = sessions[0] ?? null;

  const facts = [...store.listFacts()]
    .filter((r) => r.superseded_by === null)
    .sort((a, b) => b.id - a.id)
    .map((r) => ({
      kind: "fact", id: r.id, statement: r.statement, evidence: r.evidence,
      established_ts: r.established_ts,
    }));

  const measurements = [...store.listMeasurements()]
    .filter((r) => r.superseded_by === null)
    .sort((a, b) => b.id - a.id)
    .map((r) => {
      const [validity, why] = measurementValidity(r.measured_sha, r.scope_paths);
      return {
        kind: "measurement", id: r.id, metric: r.metric, value: r.value,
        command: r.command, measured_ts: r.measured_ts,
        measured_sha: (r.measured_sha || "").substring(0, 12),
        scope_paths: (r.scope_paths || "").split("\n").filter(Boolean),
        validity, validity_reason: why,
      };
    });

  const obligations = [...store.listObligations()]
    .filter((r) => r.status !== "done")
    .map((r) => ({
      kind: "obligation", id: r.id, statement: r.statement,
      status: displayStatus(r), blocker: r.blocker, opened_ts: r.opened_ts,
    }));
  const obligationRank = (o: { status: string; blocker: string | null }): number => {
    if (o.status === "open" && !o.blocker) return 0;
    if (o.status === "open" || o.status === "blocked") return 1;
    return 2;
  };
  obligations.sort((a, b) => {
    const ra = obligationRank(a);
    const rb = obligationRank(b);
    if (ra !== rb) return ra - rb;
    return b.id - a.id;
  });

  return {
    recovered_at: nowIso(),
    head_sha: ((head as string) || "").substring(0, 12),
    last_session: sess,
    facts,
    measurements,
    obligations,
    counts: {
      facts: facts.length,
      measurements_fresh: measurements.filter((m) => m.validity === "fresh").length,
      measurements_stale: measurements.filter((m) => m.validity === "stale").length,
      measurements_unknown: measurements.filter((m) => m.validity === "unknown").length,
      obligations_open: obligations.filter((o) => o.status === "open").length,
      obligations_blocked: obligations.filter((o) => o.status === "blocked").length,
    },
  };
}

function buildFreshnessFromStore(store: SqliteSessionStore, staleOnly: boolean) {
  const out: any[] = [];
  const rows = [...store.listMeasurements()]
    .filter((r) => r.superseded_by === null)
    .sort((a, b) => b.id - a.id);
  for (const row of rows) {
    const [validity, why] = measurementValidity(row.measured_sha, row.scope_paths);
    if (staleOnly && validity === "fresh") continue;
    out.push({
      id: row.id, metric: row.metric, value: row.value,
      verdict: validity === "stale" ? "STALE" : validity,
      reason: why, command: row.command || "(no command recorded)",
      scope: (row.scope_paths || "").split("\n").filter(Boolean).join(","),
      sha: row.measured_sha || "", timestamp: row.measured_ts,
    });
  }
  return out;
}
```

- [ ] **Step 3: Route the read commands**

Replace the `recover` block (`fm-session-main.ts:591`) with:

```ts
  if (cmd === "recover") {
    const rec = BACKEND === "port"
      ? (() => { const s = openStore(); try { return buildRecoveryFromStore(s); } finally { s.close(); } })()
      : buildRecovery(conn);
    if (parsed.options.json) {
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
    } else {
      process.stdout.write(render(rec) + "\n");
    }
    return 0;
  }
```

And the `freshness` block (`:601`) with:

```ts
  if (cmd === "freshness") {
    const staleOnly = !!parsed.options["stale-only"];
    const measurements = BACKEND === "port"
      ? (() => { const s = openStore(); try { return buildFreshnessFromStore(s, staleOnly); } finally { s.close(); } })()
      : buildFreshness(conn, staleOnly);
    process.stdout.write(renderFreshness(measurements, parsed.options.format) + "\n");
    return 0;
  }
```

- [ ] **Step 4: Prove reads are byte-identical on both backends**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
git diff --stat packages/orchestration/src/__golden__
```

Expected: PASS both times, and **no fixture changed**. `recover`,
`recover-json` and `freshness` are the cases that matter here; if any drifts,
the ordering or filtering differs and must be fixed rather than re-recorded.

- [ ] **Step 5: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck 2>&1 | tail -5
npm test 2>&1 | tail -8   # see Global Constraints re: the launcher artifact
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src/fm-session-main.ts
git commit -m "feat(session): read recover and freshness through the port

Reads first: they cannot corrupt anything. Filtering and ordering move from
SQL into TypeScript over listFacts, listMeasurements, listObligations and
currentSession, with id DESC applied explicitly rather than inherited from
the port's declared ordering.

currentSession is a direct swap -- the port's query is already
WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1.

One store per invocation, not one per command: bootstrapStore runs on every
open and the sidecar refresh opens its own, so per-command opens would
bootstrap repeatedly and hold three connections to one file.

Every golden passes unchanged on both backends."
git status --porcelain
```

---

### Task 6: Migrate the write commands, and change `close` deliberately

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`
- Modify: `packages/orchestration/src/__golden__/close-unknown.*`, `close-done.*`

**Interfaces:**

- Consumes: `openStore`, `currentSessionId` from Task 5; `reasonOf`, `isSessionStoreFailure` from `@foreman/session-store`.
- Produces: `refuseFromPort(e: unknown, legacyMessage: string): never`, used by Task 7.

- [ ] **Step 1: Add the failure-mapping helper**

The port raises `SessionStoreError` with its own messages, which are not the
CLI's. For every command whose behaviour is not deliberately changing, the exact
legacy stderr text and exit code must survive.

```ts
/**
 * Translate a port failure into the CLI's own refusal.
 *
 * The goldens compare bytes, so a command whose behaviour is unchanged must
 * keep its exact legacy stderr text. Only supersede and close change their
 * output deliberately, and they pass their new text here explicitly.
 */
function refuseFromPort(e: unknown, legacyMessage: string): never {
  if (isSessionStoreFailure(e) || reasonOf(e) !== null) {
    process.stderr.write(legacyMessage);
    process.exit(2);
  }
  throw e;
}
```

Add `isSessionStoreFailure` and `reasonOf` to the existing
`@foreman/session-store` import block at the top of the file.

- [ ] **Step 2: Migrate `begin`, `end`, `fact`, `measure`, `obligation`**

Replace each command body, keeping the legacy branch intact below it. Shown for
all five; the printed id must come from the port's returned row and every
trailing newline must stay.

```ts
  if (cmd === "begin") {
    if (BACKEND === "port") {
      const store = openStore();
      try {
        const rec = buildRecoveryFromStore(store);
        const sid = mintSessionId();
        store.beginSession({ session_id: sid, started_ts: nowIso(), start_sha: gitSha(), note: parsed.options.note || null });
        process.stdout.write(render(rec) + "\n\n");
        process.stdout.write(`SESSION BEGUN: ${sid}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const rec = buildRecovery(conn);
    const sid = mintSessionId();
    conn.prepare("INSERT INTO sessions(session_id,started_ts,start_sha,note) VALUES(?,?,?,?)").run(sid, nowIso(), gitSha(), parsed.options.note || null);
    process.stdout.write(render(rec) + "\n\n");
    process.stdout.write(`SESSION BEGUN: ${sid}\n`);
    return 0;
  }
```

```ts
  if (cmd === "end") {
    if (BACKEND === "port") {
      const store = openStore();
      try {
        const sid = parsed.args[0] || currentSessionId(store);
        if (!sid) {
          process.stderr.write("no open session\n");
          process.exit(2);
        }
        try {
          store.endSession(sid, nowIso());
        } catch (e) {
          refuseFromPort(e, "no open session\n");
        }
        process.stdout.write(`session ended: ${sid}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const sid = parsed.args[0] || currentSession(conn);
    if (!sid) {
      process.stderr.write("no open session\n");
      process.exit(2);
    }
    conn.prepare("UPDATE sessions SET ended_ts=? WHERE session_id=?").run(nowIso(), sid);
    process.stdout.write(`session ended: ${sid}\n`);
    return 0;
  }
```

```ts
  if (cmd === "fact") {
    const statement = parsed.args[0];
    const evidence = parsed.options.evidence || null;
    if (BACKEND === "port") {
      const store = openStore();
      try {
        const row = store.addFact({
          statement, evidence, established_ts: nowIso(),
          session_id: currentSessionId(store),
        });
        process.stdout.write(`fact ${row.id}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const id = mintId(conn, "fact");
    conn.prepare("INSERT INTO facts(id,statement,evidence,established_ts,session_id) VALUES(?,?,?,?,?)").run(id, statement, evidence, nowIso(), currentSession(conn));
    process.stdout.write(`fact ${id}\n`);
    return 0;
  }
```

```ts
  if (cmd === "measure") {
    if (parsed.options.scope.length === 0) {
      process.stderr.write("refusing: --scope is required. A measurement with no path scope can never be shown stale, which is the entire point.\n");
      process.exit(2);
    }
    const metric = parsed.args[0];
    const value = parsed.args[1];
    const command = parsed.options.command || null;
    const vnum = parsed.options.num !== undefined ? parseFloat(parsed.options.num) : scalarOf(value);
    if (BACKEND === "port") {
      const store = openStore();
      try {
        const row = store.addMeasurement({
          metric, value, value_num: vnum, command,
          measured_ts: nowIso(), measured_sha: gitSha(),
          scope_paths: parsed.options.scope.join("\n"),
          session_id: currentSessionId(store),
        });
        process.stdout.write(`measurement ${row.id}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const id = mintId(conn, "measurement");
    conn.prepare("INSERT INTO measurements(id,metric,value,command,measured_ts,measured_sha,scope_paths,session_id,value_num) VALUES(?,?,?,?,?,?,?,?,?)").run(
      id, metric, value, command, nowIso(), gitSha(), parsed.options.scope.join("\n"), currentSession(conn), vnum
    );
    process.stdout.write(`measurement ${id}\n`);
    return 0;
  }
```

```ts
  if (cmd === "obligation") {
    const statement = parsed.args[0];
    const blocker = parsed.options.blocker || null;
    if (BACKEND === "port") {
      const store = openStore();
      try {
        const row = store.addObligation({
          statement, blocker, opened_ts: nowIso(),
          session_id: currentSessionId(store),
        });
        process.stdout.write(`obligation ${row.id}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const id = mintId(conn, "obligation");
    conn.prepare("INSERT INTO obligations(id,statement,status,blocker,opened_ts,session_id) VALUES(?,?,?,?,?,?)").run(
      id, statement, "open", blocker, nowIso(), currentSession(conn)
    );
    process.stdout.write(`obligation ${id}\n`);
    return 0;
  }
```

- [ ] **Step 3: Run the goldens after each command**

Do this after each of the five, not once at the end.

```bash
cd /home/charl/fm-wt/sdb-task6
FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
git diff --stat packages/orchestration/src/__golden__
```

Expected: PASS, no fixture changed.

- [ ] **Step 4: Migrate `close`, changing behaviour deliberately**

The port refuses a non-open obligation, never writes `blocker`, and always
stamps `closed_ts`. `ObligationStatus` excludes `"open"` for a close, so an
unknown `--status` is rejected before the port is reached.

```ts
  if (cmd === "close") {
    const obligationId = parseInt(parsed.args[0], 10);
    const status = parsed.options.status;
    const blocker = parsed.options.blocker || null;
    if (BACKEND === "port") {
      const store = openStore();
      try {
        if (status !== "done" && status !== "dropped") {
          process.stderr.write(`refusing: --status must be done or dropped, got ${JSON.stringify(status)}\n`);
          process.exit(2);
        }
        try {
          store.closeObligation(obligationId, status, nowIso());
        } catch (e) {
          refuseFromPort(e, `refusing: obligation ${obligationId} is not open; only an open obligation may be closed\n`);
        }
        process.stdout.write(`obligation ${obligationId} -> ${status}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    conn.prepare("UPDATE obligations SET status=?, blocker=?, closed_ts=? WHERE id=?").run(
      status, blocker, status === "done" ? nowIso() : null, obligationId
    );
    process.stdout.write(`obligation ${obligationId} -> ${status}\n`);
    return 0;
  }
```

- [ ] **Step 5: Re-record the two `close` goldens, deliberately**

```bash
cd /home/charl/fm-wt/sdb-task6
FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -20
GOLDEN_UPDATE=1 FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
git diff --stat packages/orchestration/src/__golden__
cat packages/orchestration/src/__golden__/close-unknown.exit packages/orchestration/src/__golden__/close-done.exit
```

Expected: exactly two fixture names change — `close-unknown` and `close-done` —
both now non-zero. **Any third fixture changing is a defect, not a re-record.**
Remove the KNOWN DEFECT comment above the `close-done` test in the same commit.

- [ ] **Step 6: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck 2>&1 | tail -5
FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -5
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src/fm-session-main.ts packages/orchestration/src/fm-session-golden.test.ts packages/orchestration/src/__golden__
git ls-files -s packages/orchestration/src | grep -v '^100644' || echo "modes ok"
git commit -m "feat(session): write begin, end, fact, measure, obligation and close through the port

Migrated one command at a time with the goldens run after each. Ids print from
the port's returned row rather than a rowid, and every trailing newline is
preserved, because the goldens compare bytes.

Port failures are mapped back to the CLI's own refusal text. The port's
messages are not the CLI's, and every command whose behaviour is unchanged
must keep its exact stderr.

close changes deliberately: the port refuses a non-open obligation, never
writes blocker, and always stamps closed_ts. The shipping CLI accepted any
--status and wiped blocker. Two goldens re-recorded in this commit for that
reason and no other: close-unknown and close-done, both now non-zero."
git status --porcelain
```

---

### Task 7: Migrate `supersede` and `retire`

This closes the sharpest defect the migration exists to fix.

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`
- Modify: `packages/orchestration/src/__golden__/supersede-missing.*`, `supersede-superseded.*`
- Modify: `packages/orchestration/src/fm-session-main.test.ts`

**Interfaces:**

- Consumes: `openStore`, `currentSessionId`, `refuseFromPort`; `retireMeasurement` from Task 2.
- Produces: nothing further.

- [ ] **Step 1: Migrate `supersede`**

```ts
  if (cmd === "supersede") {
    const factId = parseInt(parsed.args[0], 10);
    const statement = parsed.args[1];
    const evidence = parsed.options.evidence || null;
    const reason = parsed.options.reason;
    if (!reason) {
      process.stderr.write("error: option --reason requires an argument\n"); process.exit(2);
    }
    if (BACKEND === "port") {
      const store = openStore();
      try {
        let res;
        try {
          res = store.supersedeFact(
            factId,
            { statement, evidence, established_ts: nowIso(), session_id: currentSessionId(store) },
            reason,
            nowIso(),
          );
        } catch (e) {
          refuseFromPort(e, `refusing: cannot supersede fact ${factId}: it does not exist or is already superseded\n`);
        }
        process.stdout.write(`fact ${factId} superseded by ${res.replacement.id}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const newId = mintId(conn, "fact");
    conn.prepare("INSERT INTO facts(id,statement,evidence,established_ts,session_id) VALUES(?,?,?,?,?)").run(newId, statement, evidence, nowIso(), currentSession(conn));
    conn.prepare("UPDATE facts SET superseded_by=?, superseded_at=?, supersede_reason=? WHERE id=?").run(newId, nowIso(), reason, factId);
    process.stdout.write(`fact ${factId} superseded by ${newId}\n`);
    return 0;
  }
```

- [ ] **Step 2: Migrate `retire`, preserving the legacy check ORDER**

`retire` has no recorded defect, so its output must not move. The legacy check
order is self-supersession **first**, then target existence, then superseder
existence (`fm-session-main.ts:731-748`). The port checks self-supersession
first too, but its messages differ, and `retire 9999 --by 9999` must produce the
self-supersession refusal rather than a missing-id one. Keep the self and
existence checks in the CLI so ordering and text are exact, and let the port be
the transactional authority.

```ts
  if (cmd === "retire") {
    const measurementId = parseInt(parsed.args[0], 10);
    const byId = parseInt(parsed.options.by, 10);
    const reason = parsed.options.reason;
    if (isNaN(byId)) {
      process.stderr.write("error: option --by requires an argument\n"); process.exit(2);
    }
    if (!reason) {
      process.stderr.write("error: option --reason requires an argument\n"); process.exit(2);
    }
    if (byId === measurementId) {
      process.stderr.write("refusing: a measurement cannot supersede itself\n");
      process.exit(2);
    }
    if (BACKEND === "port") {
      const store = openStore();
      try {
        const rows = store.listMeasurements();
        if (!rows.some((r) => r.id === measurementId)) {
          process.stderr.write(`refusing: no measurement ${measurementId} to retire\n`);
          process.exit(2);
        }
        const by = rows.find((r) => r.id === byId);
        if (!by) {
          process.stderr.write(`refusing: no measurement ${byId} to supersede it\n`);
          process.exit(2);
        }
        if (by.superseded_by !== null) {
          process.stderr.write(`refusing: measurement ${byId} is itself superseded by ${by.superseded_by}. A retired measurement cannot supersede another one.\n`);
          process.exit(2);
        }
        try {
          store.retireMeasurement(measurementId, byId, reason as string, nowIso());
        } catch (e) {
          refuseFromPort(e, `refusing: measurement ${measurementId} is already superseded\n`);
        }
        process.stdout.write(`measurement ${measurementId} retired, superseded by ${byId}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    const target = conn.prepare("SELECT id FROM measurements WHERE id=?").get(measurementId);
    if (!target) {
      process.stderr.write(`refusing: no measurement ${measurementId} to retire\n`);
      process.exit(2);
    }
    const row: any = conn.prepare("SELECT id, superseded_by FROM measurements WHERE id=?").get(byId);
    if (!row) {
      process.stderr.write(`refusing: no measurement ${byId} to supersede it\n`);
      process.exit(2);
    }
    if (row.superseded_by !== null) {
      process.stderr.write(`refusing: measurement ${byId} is itself superseded by ${row.superseded_by}. A retired measurement cannot supersede another one.\n`);
      process.exit(2);
    }
    conn.prepare("UPDATE measurements SET superseded_by=?, superseded_at=?, supersede_reason=? WHERE id=?").run(byId, nowIso(), reason as string, measurementId);
    process.stdout.write(`measurement ${measurementId} retired, superseded by ${byId}\n`);
    return 0;
  }
```

- [ ] **Step 3: Confirm the four `retire` goldens did not move**

```bash
cd /home/charl/fm-wt/sdb-task6
FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -20
git diff --stat packages/orchestration/src/__golden__
```

Expected: `retire`, `retire-self`, `retire-missing-target` and
`retire-missing-by` all PASS unchanged. Only `supersede-missing` and
`supersede-superseded` should be failing at this point.

- [ ] **Step 4: Re-record the two `supersede` goldens, deliberately**

```bash
cd /home/charl/fm-wt/sdb-task6
GOLDEN_UPDATE=1 FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
git diff --stat packages/orchestration/src/__golden__
cat packages/orchestration/src/__golden__/supersede-missing.exit packages/orchestration/src/__golden__/supersede-missing.err
cat packages/orchestration/src/__golden__/supersede-superseded.exit
```

Expected: exactly two fixture names change, both now non-zero, with stderr
naming the id. Remove the KNOWN DEFECT comments above both tests in this commit.

- [ ] **Step 5: Add the two-step case the golden harness cannot reach**

`golden()` runs one invocation, and no seed measurement is superseded, so
"retire an already-retired measurement" needs a direct test. Add to
`packages/orchestration/src/fm-session-main.test.ts`:

```ts
test("retire refuses an already-retired measurement", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-retire-"));
  try {
    const db = join(dir, "session.db");
    const store = SqliteSessionStore.open(db);
    try {
      const mk = (v: string, ts: string) =>
        store.addMeasurement({
          metric: "m", value: v, value_num: Number(v), command: null,
          measured_ts: ts, measured_sha: null, scope_paths: "x", session_id: null,
        });
      const a = mk("1", "2026-08-08T11:00:00Z");
      const b = mk("2", "2026-08-08T11:01:00Z");
      const c = mk("3", "2026-08-08T11:02:00Z");
      store.retireMeasurement(a.id, b.id, "first", "2026-08-08T11:03:00Z");
      assert.throws(
        () => store.retireMeasurement(a.id, c.id, "second", "2026-08-08T11:04:00Z"),
        /already superseded/,
      );
      // The legacy path overwrote the pointer instead of refusing.
      const after = store.listMeasurements().find((r) => r.id === a.id);
      assert.equal(after?.superseded_by, b.id, "the original pointer was overwritten");
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Ensure `mkdtempSync`, `rmSync`, `tmpdir`, `join`, `SqliteSessionStore` and
`assert` are imported in that file; add whichever are missing.

- [ ] **Step 6: Prove the orphan defect is actually closed**

```bash
cd /home/charl/fm-wt/sdb-task6
rm -rf /tmp/sdbverify && mkdir -p /tmp/sdbverify/.foreman && cd /tmp/sdbverify
git init -q .
cp /home/charl/foreman/.foreman/session.ndjson .foreman/
export FOREMAN_SESSION_DB=/tmp/sdbverify/.foreman/session.db
npx tsx /home/charl/fm-wt/sdb-task6/packages/orchestration/src/fm-session-main.ts import-sidecar .foreman/session.ndjson
before=$(sqlite3 "$FOREMAN_SESSION_DB" "select count(*) from facts;")
set +e
FM_SESSION_BACKEND=port npx tsx /home/charl/fm-wt/sdb-task6/packages/orchestration/src/fm-session-main.ts supersede 9999 phantom --reason r
echo "exit=$?"
set -e
after=$(sqlite3 "$FOREMAN_SESSION_DB" "select count(*) from facts;")
echo "facts before=$before after=$after"
```

Expected: non-zero exit and `before` equal to `after`. Under the legacy path
this inserted an orphan and exited 0. Note this copies the sidecar, never the
live `.db`, and pins `FOREMAN_SESSION_DB`.

- [ ] **Step 7: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck 2>&1 | tail -5
FM_SESSION_BACKEND=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -5
npx tsx --test packages/orchestration/src/fm-session-main.test.ts 2>&1 | tail -5
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src/fm-session-main.ts packages/orchestration/src/fm-session-main.test.ts packages/orchestration/src/fm-session-golden.test.ts packages/orchestration/src/__golden__
git commit -m "feat(session): supersede and retire through the port

supersede changes deliberately. It inserted an orphan row, updated nothing,
reported success and exited 0 for a fact that did not exist, then wrote that
through into the tracked NDJSON -- a mistyped id silently corrupted the record
of truth and staged it for commit. It now refuses, proven by row-count
invariance on a copy of the live sidecar. Superseding an already-superseded
fact is refused too: the columns are set-once.

retire keeps its exact output. The self-supersession and existence checks stay
in the CLI because the legacy order puts self-supersession first, so
retire 9999 --by 9999 must refuse as self-supersession rather than as a
missing id, and the port's messages differ from the CLI's. The port remains
the transactional authority via retireMeasurement.

Retiring an already-retired measurement now refuses instead of overwriting a
set-once pointer. That path needs two invocations, which the single-invocation
golden harness cannot express, so it is a direct test.

Two goldens re-recorded in this commit and no others: supersede-missing and
supersede-superseded."
git status --porcelain
```

---

### Task 8: Flip the default to the port

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`

**Interfaces:**

- Consumes: `BACKEND` from Task 4.
- Produces: a CLI that runs on the port with no environment variable set.

- [ ] **Step 1: Flip it**

```ts
const BACKEND: "legacy" | "port" =
  process.env["FM_SESSION_BACKEND"] === "legacy" ? "legacy" : "port";
```

Update the surrounding comment: the default is now the port and `legacy` is an
explicit opt-out that Task 9 removes.

- [ ] **Step 2: Prove both directions**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
FM_SESSION_BACKEND=legacy npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -20
```

Expected: with nothing set, PASS — the port is now the default. With
`legacy` set, the four re-recorded fixtures **FAIL**, because the legacy path
still has the defects. That asymmetry is the evidence the seam works in both
directions; it is not a regression.

- [ ] **Step 3: Run the Bats suite**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run build && npm run verify-runtime 2>&1 | tail -5
bats tests/session.bats 2>&1 | tail -10
```

Expected: 29/29. `tests/session.bats` sets `FM_SESSION_CMD`, which is the
invocation and is untouched by the seam, so the suite now exercises the port.

- [ ] **Step 4: Commit**

```bash
cd /home/charl/fm-wt/sdb-task6
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src/fm-session-main.ts skills/foreman/runtime
git ls-files -s packages/orchestration/src skills/foreman/runtime | grep -v '^100644' || echo "modes ok"
git commit -m "feat(session): default fm-session to the port

legacy becomes an explicit opt-out, removed in the next commit. With nothing
set every golden passes; with FM_SESSION_BACKEND=legacy the four deliberately
re-recorded fixtures fail, because the legacy path still carries the defects.
That asymmetry is the evidence the seam works in both directions.

tests/session.bats is 29/29 and now exercises the port: it sets
FM_SESSION_CMD, which is the invocation and is untouched by the seam."
git status --porcelain
```

---

### Task 9: Delete the embedded store and prove the predicates

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`
- Modify: `packages/orchestration/src/fm-session-main.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2-8.
- Produces: `fm-session-main.ts` with no `node:sqlite` import and no `@ts-nocheck`.

- [ ] **Step 1: Confirm `mintId` and `currentSession` are dead before deleting them**

Do not assume. `mintId` and the legacy `currentSession(conn)` were called only
by the write commands migrated in Tasks 6 and 7.

```bash
cd /home/charl/fm-wt/sdb-task6
grep -n 'mintId(' packages/orchestration/src/fm-session-main.ts
grep -n 'currentSession(conn)\|currentSession(cur' packages/orchestration/src/fm-session-main.ts
grep -rn 'mintId' packages/orchestration/src --include='*.ts' | grep -v fm-session-main.ts
```

Expected: every remaining hit is inside a `BACKEND === "legacy"` branch about to
be deleted, and no other file imports them. If any hit is outside, resolve it
before continuing.

- [ ] **Step 2: Delete the legacy path**

Remove, in this order:

1. every `if (BACKEND === "legacy")` branch and every legacy fall-through body left below a `return 0` in Tasks 5-7
2. the `BACKEND` constant itself
3. `connect()`, `mintId()`, `currentSession()`, `buildRecovery()`, `buildFreshness()` — superseded by `openStore()`, `buildRecoveryFromStore()` and `buildFreshnessFromStore()`
4. `legacyDumpV1()`, `classifyStore()` and `storeIsEmpty()` **only if** `bootstrapStore()` no longer needs them — it does need them for legacy-file migration, so keep all three and keep their `DatabaseSync` usage in mind for Step 4
5. the `conn` variable and the `import-sidecar` connect-target setup in `main()`

Note on step 4: `bootstrapStore` must keep reading legacy-shaped files, and that
requires raw SQLite. Move `classifyStore`, `legacyDumpV1` and `storeIsEmpty`
together with their `DatabaseSync` import into a new module
`packages/orchestration/src/session-legacy-shape.ts`, so
`fm-session-main.ts` itself holds no backend access. The v1 reader is already
isolated this way in `session-store`; this mirrors it.

- [ ] **Step 3: Verify the sidecar fsync survived the move**

```bash
cd /home/charl/fm-wt/sdb-task6
grep -rn "fsyncSync" packages/*/src | grep -v "\.test\.ts"
```

Expected: at least one call site, on whichever module renames the sidecar. Zero
means the Task 4 durability fix was deleted along with the helper.

- [ ] **Step 4: Remove the type suppression and fix what surfaces**

Delete `// @ts-nocheck` from line 1.

```bash
cd /home/charl/fm-wt/sdb-task6
npm run typecheck 2>&1 | tail -40
```

Expected: errors, because this file has never been type-checked. Fix them. Do
not re-add the suppression and do not silence errors with `any` — the file is
now small enough to type honestly.

- [ ] **Step 5: Prove predicate 1 — no backend access outside the port**

```bash
cd /home/charl/fm-wt/sdb-task6
grep -rn "node:sqlite" packages/*/src --include='*.ts' | grep -v session-store | grep -v '\.test\.ts'
```

Expected: one hit, `packages/orchestration/src/session-legacy-shape.ts`, whose
sole purpose is recognizing and dumping a pre-port file so it can be rebuilt.
`fm-session-main.ts` must not appear. Record this exemption in the commit
message with its reason; a legacy-shape reader that may not read raw SQLite
cannot do its job. Test files are exempt for the same class of reason — a test
verifying the port's schema against the declared model must inspect the backend
to discriminate at all.

- [ ] **Step 6: Prove predicate 2 — CLI behaviour unchanged**

```bash
cd /home/charl/fm-wt/sdb-task6
npm run build && npm run verify-runtime 2>&1 | tail -5
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
bats tests/session.bats 2>&1 | tail -8
```

Expected: goldens PASS and 29/29. The only fixtures differing from Task 3 are
the four changed deliberately in Tasks 6 and 7.

- [ ] **Step 7: Prove predicate 3 — the suite was not weakened**

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -8
git log main..HEAD --oneline -- packages/session-store/src/contract-suite.ts
git diff main...HEAD --stat -- packages/session-store/src/contract-suite.ts
```

**Predicate 3.** The conformance suite was not weakened to accommodate the CLI
cutover. Checkable as: (a) `git log main..HEAD -- packages/session-store/src/contract-suite.ts`
contains no commit from the CLI-migration tasks; (b) every case removed or
inverted is justified by a recorded model correction, not by a CLI failure —
currently exactly one, `hostile/two-rows-supersede-the-same-target`, superseded
by the fan-in case because live measurement 17 has four predecessors; (c) no
surviving case had an assertion loosened.

- [ ] **Step 8: Prove predicate 4 — correctness independent of projection**

```bash
cd /home/charl/fm-wt/sdb-task6
grep -rn "MemoryIndex" packages/orchestration/src | grep -v "\.test\.ts"
```

Expected: no output. The system of record must not import the projection.

- [ ] **Step 9: Full gate and commit**

```bash
cd /home/charl/fm-wt/sdb-task6
mv launcher/dist/foreman-launch /tmp/foreman-launch.bak   # see Global Constraints
npm run verify 2>&1 | tail -20
bats tests/ 2>&1 | tail -15
mv /tmp/foreman-launch.bak launcher/dist/foreman-launch
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src skills/foreman/runtime
git ls-files -s packages/orchestration/src | grep -v '^100644' || echo "modes ok"
git commit -m "refactor(session): delete the embedded session store

fm-session now runs entirely on @foreman/session-store. The BACKEND seam, the
legacy command bodies, the embedded schema, connect(), mintId(), the legacy
currentSession(), buildRecovery(), buildFreshness() and the @ts-nocheck
suppression are gone, and the file type-checks for the first time.

Recognizing a pre-port file still requires raw SQLite, so classifyStore,
legacyDumpV1 and storeIsEmpty moved to session-legacy-shape.ts with their
node:sqlite import. That module is the one exemption to predicate 1 and it is
deliberate: a legacy-shape reader forbidden from reading the legacy shape
cannot do its job. fm-session-main.ts itself holds no backend access.

There is now one SessionDB."
git status --porcelain
```

- [ ] **Step 10: Whole-branch QA review**

The per-task preflight has already run eight times. This is the review, not
another preflight.

```bash
cd /home/charl/fm-wt/sdb-task6
git diff main...HEAD --stat
git ls-files -s packages/session-store/src packages/orchestration/src | grep -v '^100644' || echo "modes ok"
bash skills/foreman/scripts/docs-check.sh
```

Follow `plugins/foreman-qa/commands/foreman-qa-review.md`: hand the complete
diff, the mode listing and the exact `docs-check.sh` output to the
`foreman-qa-reviewer` doctrine. Relay findings verbatim — do not soften,
summarize or omit a verdict.

Do not claim this plan is complete on an exit code alone. `tests/run.sh` in
shadow mode can print `RESULT ERROR` and still exit 0.

---

### Task 10: Record the traps and the obligations

**Files:**

- Modify: `AGENT_TRAPS.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing. This task closes the documentation debt.

- [ ] **Step 1: Add three traps to `AGENT_TRAPS.md` § 1**

Append these rows to the § 1 Environment traps table, symptom first, since the
symptom is what the next session searches for.

```markdown
| A backend seam keyed on `FM_SESSION_CMD` reads false under the whole Bats suite while every golden stays green | That variable holds the **invocation command** (`tests/session.bats:13`) and is named in v0.3.0 exit predicate 3, not a backend selector. Use a distinct name; `FM_SESSION_BACKEND` is the session-store seam. |
| `secret-scan.test.ts` refuses the worktree with `{"_tag":"Refused","reason":"bound_exceeded"}` while the tree looks clean | Any single file over `MAX_FILE_BYTES` (16 MB) trips it, and the scan walks the raw filesystem — it prunes only `.git` and `.harness`, deliberately, for shell parity. A gitignored 94 MB `launcher/dist/foreman-launch` fails the test after every launcher build. Move it aside for a full-suite run; do not report it as a branch defect. |
| A graphify run asked for four-way parallelism and took as long as a serial one, reporting nothing unusual | The `claude-cli` backend forces `max_concurrency = 1` unless `GRAPHIFY_CLAUDE_CLI_PARALLEL=1` is set (`llm.py:2327`). With it set, 96 files took 713 s against 628 s for two chunks serially. |
```

- [ ] **Step 2: Record the two out-of-scope items as obligations**

These are not fixed here — they belong to other work, and the plan's own
precedent for the stale `CLAUDE.md` reference is to record rather than fix
inline. Run from the worktree with the store pinned so the base checkout's live
store is untouched.

```bash
cd /home/charl/fm-wt/sdb-task6
export FOREMAN_SESSION_DB=/home/charl/foreman/.foreman/session.db
npx tsx packages/orchestration/src/fm-session-main.ts obligation \
  "secret-scan's bounds treat a gitignored build artifact as a corpus file, so a green local suite depends on the developer's build state. launcher/dist/foreman-launch at 94 MB trips MAX_FILE_BYTES. Decide whether the scan should prune ignored paths or whether the bound should exclude them."
npx tsx packages/orchestration/src/fm-session-main.ts obligation \
  "CLAUDE.md still instructs agents to run python3 skills/foreman/scripts/fm-session.py recover. That file was retired in b6e9ed0 and only a stale .pyc remains."
npx tsx packages/orchestration/src/fm-session-main.ts obligation \
  "docs/superpowers/specs/2026-08-06-v030-checkpoint.md is mode 100755 on main. Pre-existing, not introduced by the SessionDB work; clear the executable bit in a commit scoped to filemode hygiene."
```

This is the one place the plan writes to the real store, deliberately: these
obligations are the record of what this work leaves behind. Confirm afterwards:

```bash
cd /home/charl/fm-wt/sdb-task6
npx tsx packages/orchestration/src/fm-session-main.ts recover 2>&1 | tail -20
cd /home/charl/foreman && git status --porcelain .foreman/
```

Expected: three new obligations visible, and `.foreman/session.ndjson` shows as
modified in the base checkout. Commit that sidecar change in the base checkout,
not the worktree.

- [ ] **Step 3: Commit the traps**

```bash
cd /home/charl/fm-wt/sdb-task6
bash skills/foreman/scripts/docs-check.sh
git add AGENT_TRAPS.md
git ls-files -s AGENT_TRAPS.md | grep -v '^100644' || echo "modes ok"
git commit -m "docs: record the seam-name, secret-scan and graphify-parallelism traps

Each fired while completing the SessionDB cutover. Symptom first, because the
symptom is what the next session searches for.

The seam-name trap is the sharpest: a backend selector keyed on FM_SESSION_CMD
reads false under the entire Bats suite while every golden stays green, because
that variable holds the invocation command and is named in a v0.3.0 exit
predicate."
git status --porcelain
```

- [ ] **Step 4: Mark the PR ready**

```bash
cd /home/charl/fm-wt/sdb-task6
git push origin design/sessiondb-port-unification
gh pr view 45 --json isDraft -q .isDraft
```

Update the PR body's "What is left" section to reflect what actually landed, then
mark it ready for review only if Task 9 Step 10's review returned no Major or
Critical findings.

---

## Self-review

**Spec coverage.** Every section of
`docs/superpowers/specs/2026-08-12-sessiondb-completion-design.md` maps to a
task: W0 → Task 1; W1 → Task 2; W2 → Tasks 3-8; W3 → Task 9; W4 → Task 10. The
spec's error-mapping requirement is Task 6 Step 1; its store-lifecycle
requirement is Task 5 Step 1; its restated predicate 1 is Task 9 Step 5.

**Two things this plan adds beyond the spec**, both forced by measurement:

- **Task 3 did not exist in the spec.** `retire` had no golden at all, so
  "output-neutral" had no oracle. Six fixtures are frozen on the legacy path
  first.
- **A fourth deliberate behaviour change.** Retiring an already-retired
  measurement: legacy overwrites a set-once pointer, the port refuses. Not
  reachable in one CLI invocation because no seed measurement is superseded, so
  it is a conformance case plus a direct test rather than a golden.

**One thing the spec assumed that this plan corrects.** The spec implies
`fm-session-main.ts` ends with no `node:sqlite` at all. It cannot:
`bootstrapStore` must recognize and dump a pre-port file, which requires raw
SQLite. Task 9 Step 2 moves that into `session-legacy-shape.ts` so the CLI
itself is clean and the exemption is one named module rather than a hedge in the
predicate.

**Type consistency.** `openStore()`, `currentSessionId()`, `refuseFromPort()`,
`buildRecoveryFromStore()`, `buildFreshnessFromStore()` and
`retireMeasurement()` are each defined once and referenced with the same
signature throughout. `retireMeasurement` returns `MeasurementRow` in Task 2's
interface, implementation, conformance cases and Task 7's call site.
