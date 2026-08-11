# SessionDB Port Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End with one SessionDB — `@foreman/session-store` becomes the only
implementation, and the embedded store inside `fm-session-main.ts` is deleted.

**Architecture:** Freeze the current CLI output as a golden oracle. Teach the
port to read the live v1 sidecar, then rebuild the database from that sidecar
into a fresh port-shaped file rather than migrating the old one in place. Then
move the CLI onto the port command by command, diffing against the golden at
every step, and delete the old store only when every command is clean.

**Tech Stack:** Node.js 24, TypeScript (strict, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), `node:test`, `node:sqlite`,
Bats, `tsx`, esbuild via `scripts/build-runtime.ts`.

**Design:** `docs/superpowers/specs/2026-08-11-sessiondb-port-unification-design.md`

## Global Constraints

- Node.js 24, TypeScript only. No new Python, Bash, PowerShell, CMD, JavaScript,
  MJS, or CJS implementation files.
- `@foreman/session-store` must not import from `@foreman/orchestration`.
  Dependency runs one way: orchestration depends on session-store.
- The system of record must never import `MemoryIndex`. The import-boundary test
  in `packages/session-store/src/contract.test.ts` enforces this; keep it passing.
- Every file you create must be mode `100644`. Files copied from `/mnt/c` land
  `755`. Check with `git ls-files -s <paths> | grep -v '^100644'` before every
  commit and clear with `git update-index --chmod=-x`.
- Never add `Co-Authored-By` or any AI attribution to a commit.
- `NullMemoryIndex` stays the default. No task may make Foreman require network
  access or credentials.
- Consult `AGENT_TRAPS.md` § 1 before dispatching any vendor lane.
- Work in the worktree `/root/fm-wt/sdb-design` on branch
  `design/sessiondb-port-unification`. Never `git add -A` in the base checkout —
  a live session can append to SessionDB while you work (`AGENT_TRAPS.md:22`).
- `npm install` has not been run in this worktree. Task 1 installs dependencies.

### The QA plugin is binding, on every task

`plugins/foreman-qa/` carries the rules this repository learned by breaking. Use
it rather than improvising an equivalent. Its preflight runs on **every task**,
not only the last one, and its six steps are the definition of "done":

1. Confirm every command you are relying on actually executed. An exit code
   belongs to the wrapper, not the work — a run mangled by quoting, path
   conversion or a missing `PATH` reports success and produces nothing. Bind
   each claim to a non-empty, on-topic artefact you have read.
2. Read the working diff with `git diff` and `git diff --stat`. Review what
   changed, not what you intended to change.
3. Run `git ls-files -s` for the files in scope and check the modes.
4. **Before committing**, run `bash skills/foreman/scripts/docs-check.sh`. Read
   and report its output; do not rely on the exit code alone. Exit 0 is pass,
   1 is findings, 2 means a required tool was missing and the gate failed
   closed. It currently reports
   `markdownlint=pass codespell=pass lychee=pass agent-invocations=pass comments=pass`
   on this branch — keep it there.
5. **After committing**, run `git status --porcelain` and confirm it is empty.
6. State explicitly which checks you did not run and why. Silence about a
   skipped check is not acceptable.

Two rules that cost this repository real time:

- After any late edit — including one prompted by lint or `docs-check.sh` —
  run `git add` again on every changed file. A commit captures the index, not
  the working tree, so an edit made after the last `git add` is silently
  excluded.
- A report is a claim, not evidence. Re-run the command and read its output.
  Findings from executing code outrank findings from reading it.

When a trap fires that is not already listed, add it to `AGENT_TRAPS.md` with
the observed symptom first — the symptom is what the next session searches for.

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/session-store/src/sidecar-v1.ts` | **Create.** Reads the v1 wire format. Nothing else imports v1 knowledge. |
| `packages/session-store/src/sidecar-v1.test.ts` | **Create.** Unit tests for the v1 reader. |
| `packages/session-store/src/sidecar.ts` | **Modify.** Dispatch on `format_version`; keep v2 encode as the only writer. |
| `packages/session-store/src/sqlite-store.ts` | **Modify.** Durability pragmas at open. |
| `packages/orchestration/src/session-rebuild.ts` | **Create.** Rebuilds the DB from the canonical sidecar. |
| `packages/orchestration/src/session-rebuild.test.ts` | **Create.** Tests for the rebuild. |
| `packages/orchestration/src/fm-session-main.ts` | **Modify, then shrink.** CLI moves onto the port; embedded store deleted in Task 7. |
| `packages/orchestration/src/fm-session-golden.test.ts` | **Create.** Golden oracle over the CLI's exact output. |
| `packages/orchestration/src/__golden__/` | **Create.** Frozen expected stdout/stderr/exit codes. |

The v1 reader is a separate file on purpose. It is the only place that knows a
dead format exists, so it can be deleted whole if the format is ever dropped.

---

### Task 1: Golden oracle

Freeze exactly what the CLI prints today, before anything changes. `session.bats`
asserts shapes; this asserts values. A port that changes a printed number passes
`session.bats` and fails here.

The oracle is TypeScript, not Bats. `CLAUDE.md`'s Iron Rule requires tests for
new behaviour in TypeScript, and a file under `packages/orchestration/src/` is
picked up by the existing `npm test` glob with no config change. It spawns the
CLI **from source through tsx** rather than from
`skills/foreman/runtime/dist/fm-session.js`, so it can never pass against a
stale bundle.

**Files:**

- Create: `packages/orchestration/src/fm-session-golden.test.ts`
- Create: `packages/orchestration/src/__golden__/seed.ndjson`

**Interfaces:**

- Consumes: nothing.
- Produces: `packages/orchestration/src/__golden__/<case>.{out,err,exit}` —
  frozen bytes every later task diffs against.

- [ ] **Step 1: Install dependencies**

```bash
cd /root/fm-wt/sdb-design
npm ci
```

Expected: completes without error. If `npm ci` fails on a missing lockfile
entry, use `npm install` and do not commit lockfile churn unrelated to this work.

- [ ] **Step 2: Confirm the suite is green before you touch anything**

```bash
cd /root/fm-wt/sdb-design
npm run typecheck && npm test 2>&1 | tail -20
```

Expected: PASS. If it does not pass on a clean checkout, stop and report — you
cannot build a golden oracle on a broken baseline.

- [ ] **Step 3: Create the seed fixture from the real sidecar**

The seed must be real v1 data, not invented, and fixed so the golden does not
churn as live sessions run:

```bash
cd /root/fm-wt/sdb-design
mkdir -p packages/orchestration/src/__golden__
head -12 /root/foreman/.foreman/session.ndjson > packages/orchestration/src/__golden__/seed.ndjson
chmod 644 packages/orchestration/src/__golden__/seed.ndjson
head -1 packages/orchestration/src/__golden__/seed.ndjson
```

Expected first line: `{"format": "foreman-session-sidecar", "format_version": 1}`

- [ ] **Step 4: Write the golden test**

Create `packages/orchestration/src/fm-session-golden.test.ts`:

```ts
/**
 * Golden oracle for the fm-session CLI.
 *
 * Freezes exact stdout, stderr and exit code for a fixed command corpus.
 * session.bats asserts shapes; this asserts values, so a change to a printed
 * number fails here and nowhere else.
 *
 * Record or re-record with GOLDEN_UPDATE=1. Re-recording is a deliberate act:
 * review the fixture diff before committing it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "__golden__");
const ENTRY = join(HERE, "fm-session-main.ts");
const UPDATE = process.env["GOLDEN_UPDATE"] === "1";

/** A scratch repo seeded from the frozen v1 sidecar. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "fm-golden-"));
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  mkdirSync(join(dir, ".foreman"), { recursive: true });
  copyFileSync(join(GOLDEN, "seed.ndjson"), join(dir, ".foreman", "session.ndjson"));
  run(dir, ["import-sidecar"]);
  return dir;
}

/** Run the CLI from source. tsx keeps this honest against an unbuilt bundle. */
function run(cwd: string, args: readonly string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GOLDEN_UPDATE: "" },
  });
}

function golden(name: string, args: readonly string[]): void {
  const dir = workspace();
  const res = run(dir, args);
  const code = String(res.status ?? -1);

  if (UPDATE) {
    writeFileSync(join(GOLDEN, `${name}.out`), res.stdout, "utf8");
    writeFileSync(join(GOLDEN, `${name}.err`), res.stderr, "utf8");
    writeFileSync(join(GOLDEN, `${name}.exit`), `${code}\n`, "utf8");
    return;
  }

  const outPath = join(GOLDEN, `${name}.out`);
  assert.ok(
    existsSync(outPath),
    `no golden recorded for ${name}; run with GOLDEN_UPDATE=1`,
  );
  assert.equal(res.stdout, readFileSync(outPath, "utf8"), `${name}: stdout drifted`);
  assert.equal(
    res.stderr,
    readFileSync(join(GOLDEN, `${name}.err`), "utf8"),
    `${name}: stderr drifted`,
  );
  assert.equal(
    `${code}\n`,
    readFileSync(join(GOLDEN, `${name}.exit`), "utf8"),
    `${name}: exit code drifted`,
  );
}

test("golden: recover", () => golden("recover", ["recover"]));
test("golden: recover --json", () => golden("recover-json", ["recover", "--json"]));
test("golden: freshness", () => golden("freshness", ["freshness"]));

// KNOWN DEFECT, frozen deliberately. Today this exits 0 and reports success for
// a fact that does not exist, inserting an orphan row. Task 6 changes it to a
// non-zero exit; re-record this golden in the same commit that changes the
// behaviour, never before and never on its own.
test("golden: supersede a missing fact", () =>
  golden("supersede-missing", ["supersede", "9999", "replacement", "--reason", "r"]));

test("golden: close with an unknown status", () =>
  golden("close-unknown", ["close", "1", "--status", "nonsense"]));
```

- [ ] **Step 5: Record the goldens**

```bash
cd /root/fm-wt/sdb-design
GOLDEN_UPDATE=1 npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
ls packages/orchestration/src/__golden__/
```

Expected: `.out`, `.err` and `.exit` files for all five cases, plus `seed.ndjson`.

- [ ] **Step 6: Verify the oracle actually discriminates**

A golden that passes against a changed program is not an oracle. Prove it fails:

```bash
cd /root/fm-wt/sdb-design
printf 'DELIBERATE DRIFT\n' >> packages/orchestration/src/__golden__/recover.out
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -8
git checkout packages/orchestration/src/__golden__/recover.out 2>/dev/null || true
```

Expected: `golden: recover` FAILS with "stdout drifted", then passes again after
the file is restored. Do not skip this — an oracle that cannot fail is the most
common way this kind of task produces false confidence. If the file was not yet
committed, restore it by re-running Step 5.

- [ ] **Step 7: Confirm it runs under the normal test command**

```bash
cd /root/fm-wt/sdb-design
npm test 2>&1 | grep -i golden | head -5
```

Expected: the golden cases appear. If they do not, the file is not matched by
the `npm test` glob — fix the location rather than adding a bespoke command.

- [ ] **Step 8: Commit**

```bash
cd /root/fm-wt/sdb-design
git add packages/orchestration/src/fm-session-golden.test.ts packages/orchestration/src/__golden__
git ls-files -s packages/orchestration/src/fm-session-golden.test.ts packages/orchestration/src/__golden__ | grep -v '^100644' || echo "modes ok"
git commit -m "test(session): freeze the fm-session CLI output as a golden oracle

Spawns the CLI from source through tsx rather than the built bundle, so
it cannot pass against a stale artefact. One case freezes a known defect
deliberately: superseding a missing fact currently exits 0."
```

### Task 2: v1 sidecar reader

**Files:**

- Create: `packages/session-store/src/sidecar-v1.ts`
- Create: `packages/session-store/src/sidecar-v1.test.ts`
- Modify: `packages/session-store/src/sidecar.ts` (dispatch only)
- Modify: `packages/session-store/src/index.ts` (export the reader)

**Interfaces:**

- Consumes: `SessionSnapshot`, `EntityKind`, `NextIds`, `CountedKind` from
  `./entities.js`; `raise` from `./failures.js`.
- Produces:
  - `decodeSnapshotV1(lines: readonly string[]): SessionSnapshot` — takes the
    already-split, newline-free lines including the header at index 0.
  - `V1_FORMAT_VERSION: 1`

- [ ] **Step 1: Write the failing test**

Create `packages/session-store/src/sidecar-v1.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSnapshotV1 } from "./sidecar-v1.js";
import { reasonOf } from "./failures.js";

const HEADER = `{"format": "foreman-session-sidecar", "format_version": 1}`;

function lines(...rows: string[]): readonly string[] {
  return [HEADER, ...rows];
}

test("maps plural table names to singular kinds", () => {
  const snap = decodeSnapshotV1(
    lines(
      `{"table": "facts", "row": {"id": 1, "statement": "s", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
    ),
  );
  assert.equal(snap.facts.length, 1);
  assert.equal(snap.facts[0]?.id, 1);
});

test("drops schema_meta rows rather than treating them as entities", () => {
  const snap = decodeSnapshotV1(
    lines(`{"table": "schema_meta", "row": {"key": "version", "value": "3"}}`),
  );
  assert.equal(snap.sessions.length, 0);
  assert.equal(snap.facts.length, 0);
  assert.equal(snap.measurements.length, 0);
  assert.equal(snap.obligations.length, 0);
});

test("computes next_ids as max(id) + 1 per counted kind", () => {
  const snap = decodeSnapshotV1(
    lines(
      `{"table": "facts", "row": {"id": 7, "statement": "s", "evidence": null, "established_ts": "2026-01-01T00:00:00Z", "session_id": null, "superseded_by": null, "superseded_at": null, "supersede_reason": null}}`,
    ),
  );
  assert.equal(snap.nextIds.fact, 8);
  assert.equal(snap.nextIds.measurement, 1);
  assert.equal(snap.nextIds.obligation, 1);
});

test("normalizes blocked obligations to open and keeps the blocker", () => {
  const snap = decodeSnapshotV1(
    lines(
      `{"table": "obligations", "row": {"id": 1, "statement": "s", "status": "blocked", "blocker": "why", "opened_ts": "2026-01-01T00:00:00Z", "closed_ts": null, "session_id": null}}`,
    ),
  );
  assert.equal(snap.obligations[0]?.status, "open");
  assert.equal(snap.obligations[0]?.blocker, "why");
});

test("leaves open, done and dropped statuses untouched", () => {
  for (const status of ["open", "done", "dropped"]) {
    const snap = decodeSnapshotV1(
      lines(
        `{"table": "obligations", "row": {"id": 1, "statement": "s", "status": "${status}", "blocker": null, "opened_ts": "2026-01-01T00:00:00Z", "closed_ts": null, "session_id": null}}`,
      ),
    );
    assert.equal(snap.obligations[0]?.status, status);
  }
});

test("declares model version 1", () => {
  assert.equal(decodeSnapshotV1(lines()).modelVersion, 1);
});

test("rejects an unknown table name", () => {
  let reason: string | null = null;
  try {
    decodeSnapshotV1(lines(`{"table": "widgets", "row": {"id": 1}}`));
  } catch (e) {
    reason = reasonOf(e);
  }
  assert.equal(reason, "unknown_entity_kind");
});

test("rejects a record that is not exactly table and row", () => {
  let reason: string | null = null;
  try {
    decodeSnapshotV1(lines(`{"kind": "fact", "row": {"id": 1}}`));
  } catch (e) {
    reason = reasonOf(e);
  }
  assert.equal(reason, "sidecar_malformed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/session-store/src/sidecar-v1.test.ts
```

Expected: FAIL — cannot resolve `./sidecar-v1.js`.

- [ ] **Step 3: Implement the reader**

Create `packages/session-store/src/sidecar-v1.ts`:

```ts
/**
 * Reader for sidecar format version 1.
 *
 * v1 is a dead format: nothing writes it any more. It is still read because
 * v1 files exist outside this checkout — the stale Windows checkout at
 * C:\Users\charl\foreman holds one, and obligation 24 records that the
 * installed-plugin junction still points at it.
 *
 * Two shape differences from v2, plus one value normalization:
 *   - records are {table, row} with plural table names, not {kind, row}
 *   - the header carries no session_model_version and no next_ids
 *   - obligations may carry status "blocked", which the model does not declare
 *
 * The status rewrite lives here rather than in a later migration because
 * decodeSnapshot ends by calling assertIntegrity, and status is a declared enum
 * over OBLIGATION_STATUSES. A blocked row fails validation on the way in, so a
 * post-decode migration could never read the live sidecar at all.
 *
 * This file is the only place that knows v1 exists. Delete it whole if the
 * format is ever dropped.
 */

import {
  COUNTED_KINDS,
  type CountedKind,
  type EntityKind,
  type NextIds,
  type SessionSnapshot,
} from "./entities.js";
import { raise } from "./failures.js";

export const V1_FORMAT_VERSION = 1;

/** v1 table names, including the one that is not an entity. */
const TABLE_TO_KIND: Readonly<Record<string, EntityKind>> = {
  sessions: "session",
  facts: "fact",
  measurements: "measurement",
  obligations: "obligation",
};

/** Carried schema bookkeeping, not entity data. Dropped on read. */
const NON_ENTITY_TABLES: ReadonlySet<string> = new Set(["schema_meta"]);

function parseLine(line: string, lineNo: number): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    raise("sidecar_malformed", `line ${lineNo} is not valid JSON`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    raise("sidecar_malformed", `line ${lineNo} is not a JSON object`);
  }
  return doc as Record<string, unknown>;
}

export function decodeSnapshotV1(lines: readonly string[]): SessionSnapshot {
  const buckets: Record<EntityKind, Record<string, unknown>[]> = {
    session: [],
    fact: [],
    measurement: [],
    obligation: [],
  };

  for (let i = 1; i < lines.length; i++) {
    const doc = parseLine(lines[i] as string, i + 1);
    const keys = Object.keys(doc).sort().join(",");
    if (keys !== "row,table") {
      raise(
        "sidecar_malformed",
        `line ${i + 1} must contain exactly table and row`,
      );
    }
    const table = doc["table"];
    if (typeof table !== "string") {
      raise("sidecar_malformed", `line ${i + 1} table is not a string`);
    }
    if (NON_ENTITY_TABLES.has(table)) {
      continue;
    }
    const kind = TABLE_TO_KIND[table];
    if (kind === undefined) {
      raise(
        "unknown_entity_kind",
        `unknown v1 table ${JSON.stringify(table)}`,
      );
    }
    const row = doc["row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      raise("sidecar_malformed", `line ${i + 1} row is not an object`);
    }
    buckets[kind].push(normalize(kind, row as Record<string, unknown>));
  }

  return {
    modelVersion: 1,
    nextIds: computeNextIds(buckets),
    sessions: buckets.session as never,
    facts: buckets.fact as never,
    measurements: buckets.measurement as never,
    obligations: buckets.obligation as never,
  };
}

/**
 * v1 stored "blocked" in status. The model declares blocker as its own column,
 * so blocked is derived state: open plus a non-null blocker. Rewriting loses
 * nothing.
 */
function normalize(
  kind: EntityKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (kind !== "obligation" || row["status"] !== "blocked") {
    return row;
  }
  return { ...row, status: "open" };
}

function computeNextIds(
  buckets: Readonly<Record<EntityKind, readonly Record<string, unknown>[]>>,
): NextIds {
  const next: Record<string, number> = {};
  for (const kind of COUNTED_KINDS) {
    let max = 0;
    for (const row of buckets[kind as CountedKind as EntityKind]) {
      const id = row["id"];
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
        raise("field_type", `${kind} row has a non-integer id`);
      }
      if (id > max) {
        max = id;
      }
    }
    next[kind] = max + 1;
  }
  return next as unknown as NextIds;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/session-store/src/sidecar-v1.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Dispatch on format_version in decodeSnapshot**

In `packages/session-store/src/sidecar.ts`, add the import at the top of the
import block:

```ts
import { decodeSnapshotV1, V1_FORMAT_VERSION } from "./sidecar-v1.js";
```

Then in `decodeSnapshot`, replace this line:

```ts
  const header = readHeader(parseLine(lines[0] as string, 1));
```

with:

```ts
  const head = parseLine(lines[0] as string, 1);
  if (head["format_version"] === V1_FORMAT_VERSION) {
    const v1 = decodeSnapshotV1(lines);
    assertIntegrity(v1);
    return v1;
  }
  const header = readHeader(head);
```

The v1 branch runs `assertIntegrity` and returns before `applyVersionPolicy`,
because v1 already carries model version 1 and there is nothing to upgrade.
`UPGRADES` stays empty.

- [ ] **Step 6: Export the reader**

In `packages/session-store/src/index.ts`, add `decodeSnapshotV1` to the existing
export list alongside the other sidecar exports.

- [ ] **Step 7: Prove it reads the real sidecar, not just fixtures**

```bash
cd /root/fm-wt/sdb-design
cat > /tmp/v1check.ts <<'TS'
import { readFileSync } from "node:fs";
import { decodeSnapshot, encodeSnapshot } from "./packages/session-store/src/sidecar.js";
const text = readFileSync("/root/foreman/.foreman/session.ndjson", "utf8");
const snap = decodeSnapshot(text);
console.log("sessions", snap.sessions.length);
console.log("facts", snap.facts.length);
console.log("measurements", snap.measurements.length);
console.log("obligations", snap.obligations.length);
console.log("nextIds", JSON.stringify(snap.nextIds));
const round = decodeSnapshot(encodeSnapshot(snap));
console.log("v2 round-trip facts", round.facts.length);
TS
npx tsx /tmp/v1check.ts
```

Expected, matching the live store exactly:

```text
sessions 3
facts 36
measurements 19
obligations 34
nextIds {"fact":37,"measurement":20,"obligation":35}
v2 round-trip facts 36
```

If any count differs, stop. The reader is wrong, not the fixture.

- [ ] **Step 8: Run the full suite and commit**

```bash
cd /root/fm-wt/sdb-design
npm run typecheck && npm test 2>&1 | tail -10
git add packages/session-store/src/sidecar-v1.ts packages/session-store/src/sidecar-v1.test.ts packages/session-store/src/sidecar.ts packages/session-store/src/index.ts
git ls-files -s packages/session-store/src | grep -v '^100644' || echo "modes ok"
git commit -m "feat(session-store): read the v1 sidecar format

v1 records are {table, row} with plural table names and a header that
carries neither session_model_version nor next_ids. The reader maps tables
to kinds, drops schema_meta, derives next_ids from max(id), and rewrites
blocked obligations to open with the blocker retained.

The status rewrite is in the read path because decodeSnapshot ends in
assertIntegrity and status is a declared enum, so a blocked row cannot
survive decoding. Encoding stays v2-only: read both, write one."
```

---

### Task 3: Rebuild the database from the canonical sidecar

The DB is a cache, not the record: `.gitignore:43` ignores `session.db` while
`.foreman/session.ndjson` is tracked. So the migration is a rebuild into a fresh
port-shaped file, never an in-place alter of the old schema.

This matters. `sqlite-store.ts:61-123` uses `CREATE TABLE IF NOT EXISTS`, so
opening the port against the *existing* database would skip schema creation,
find no `store_meta`, and seed every watermark to 1 while live ids reach 36.
`integrity.ts` would then flag every row. A fresh file cannot hit that path.

**Files:**

- Create: `packages/orchestration/src/session-rebuild.ts`
- Create: `packages/orchestration/src/session-rebuild.test.ts`

**Interfaces:**

- Consumes: `decodeSnapshot`, `encodeSnapshot`, `openSqliteSessionStore` (or the
  factory exported by `@foreman/session-store/index.ts` — check the exact export
  name before writing the import) from `@foreman/session-store`.
- Produces: `rebuildFromSidecar(opts: {sidecarPath: string; dbPath: string}): {rowsWritten: number; nextIds: NextIds}`

- [ ] **Step 1: Write the failing test**

The store is opened with the static method `SqliteSessionStore.open(path)`.
There is no `openSessionStore` function — `openMemoryStore()` exists but is for
in-memory tests only.

Create `packages/orchestration/src/session-rebuild.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { rebuildFromSidecar } from "./session-rebuild.js";

const V1 = [
  `{"format": "foreman-session-sidecar", "format_version": 1}`,
  `{"table": "schema_meta", "row": {"key": "version", "value": "3"}}`,
  `{"table": "obligations", "row": {"id": 4, "statement": "s", "status": "blocked", "blocker": "why", "opened_ts": "2026-01-01T00:00:00Z", "closed_ts": null, "session_id": null}}`,
  "",
].join("\n");

function fixture(): { sidecarPath: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "rebuild-"));
  const sidecarPath = join(dir, "session.ndjson");
  writeFileSync(sidecarPath, V1, "utf8");
  return { sidecarPath, dbPath: join(dir, "session.db") };
}

test("rebuilds a fresh database from a v1 sidecar", () => {
  const paths = fixture();
  const res = rebuildFromSidecar(paths);
  assert.equal(existsSync(paths.dbPath), true);
  assert.equal(res.rowsWritten, 1);
});

test("watermarks exceed the highest live id", () => {
  const paths = fixture();
  const res = rebuildFromSidecar(paths);
  assert.equal(res.nextIds.obligation, 5);
});

test("normalizes blocked to open through the rebuild", () => {
  const paths = fixture();
  rebuildFromSidecar(paths);
  const db = new DatabaseSync(paths.dbPath);
  const row = db.prepare("SELECT status, blocker FROM obligations WHERE id = 4").get() as
    | { status: string; blocker: string | null }
    | undefined;
  db.close();
  assert.equal(row?.status, "open");
  assert.equal(row?.blocker, "why");
});

test("refuses to overwrite an existing database without force", () => {
  const paths = fixture();
  rebuildFromSidecar(paths);
  assert.throws(() => rebuildFromSidecar(paths));
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/orchestration/src/session-rebuild.test.ts
```

Expected: FAIL — cannot resolve `./session-rebuild.js`.

- [ ] **Step 3: Implement the rebuild**

Create `packages/orchestration/src/session-rebuild.ts`:

```ts
/**
 * Rebuild the session database from the canonical sidecar.
 *
 * The sidecar is the record that travels: .gitignore ignores session.db while
 * .foreman/session.ndjson is tracked. The database is a cache, so a migration
 * is a rebuild into a fresh file rather than an alter of the old schema.
 *
 * Rebuilding into a FRESH path is load-bearing. sqlite-store.ts creates its
 * tables with CREATE TABLE IF NOT EXISTS, so opening the port against the old
 * database would skip schema creation, find no store_meta, and seed every id
 * watermark to 1 while live ids run far higher.
 */

import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { decodeSnapshot, SqliteSessionStore } from "@foreman/session-store";
import type { NextIds } from "@foreman/session-store";

export type RebuildResult = {
  readonly rowsWritten: number;
  readonly nextIds: NextIds;
};

export type RebuildOptions = {
  readonly sidecarPath: string;
  readonly dbPath: string;
  /** Replace an existing database. Without this an existing file is refused. */
  readonly force?: boolean;
};

export function rebuildFromSidecar(opts: RebuildOptions): RebuildResult {
  if (existsSync(opts.dbPath) && opts.force !== true) {
    throw new Error(
      `${opts.dbPath} already exists; pass force to replace it. ` +
        `Rebuilding onto an existing file would skip schema creation.`,
    );
  }

  const snapshot = decodeSnapshot(readFileSync(opts.sidecarPath, "utf8"));

  const tmpPath = `${opts.dbPath}.rebuild`;
  rmSync(tmpPath, { force: true });

  const store = SqliteSessionStore.open(tmpPath);
  let rowsWritten: number;
  try {
    rowsWritten = store.importSnapshot(snapshot);
  } finally {
    store.close();
  }

  renameSync(tmpPath, opts.dbPath);
  return { rowsWritten, nextIds: snapshot.nextIds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/orchestration/src/session-rebuild.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Rehearse against a copy of the real store**

Never rehearse against the live file.

```bash
cd /root/fm-wt/sdb-design
rm -rf /tmp/rebuild-live && mkdir -p /tmp/rebuild-live
cp /root/foreman/.foreman/session.ndjson /tmp/rebuild-live/
cat > /tmp/rebuild-live.ts <<'TS'
import { rebuildFromSidecar } from "./packages/orchestration/src/session-rebuild.js";
const r = rebuildFromSidecar({
  sidecarPath: "/tmp/rebuild-live/session.ndjson",
  dbPath: "/tmp/rebuild-live/session.db",
});
console.log(JSON.stringify(r));
TS
npx tsx /tmp/rebuild-live.ts
sqlite3 /tmp/rebuild-live/session.db "select status, count(*) from obligations group by status;"
sqlite3 /tmp/rebuild-live/session.db "select key, value from store_meta;"
sqlite3 /tmp/rebuild-live/session.db "pragma foreign_keys;"
```

Expected: 92 rows written; statuses are `done|10` and `open|24` with no
`blocked`; `store_meta` watermarks are `fact 37`, `measurement 20`,
`obligation 35`; every watermark strictly exceeds the corresponding `max(id)`.

- [ ] **Step 6: Commit**

```bash
cd /root/fm-wt/sdb-design
npm run typecheck && npm test 2>&1 | tail -10
git add packages/orchestration/src/session-rebuild.ts packages/orchestration/src/session-rebuild.test.ts
git ls-files -s packages/orchestration/src | grep -v '^100644' || echo "modes ok"
git commit -m "feat(orchestration): rebuild the session database from the canonical sidecar

The sidecar is tracked and the database is gitignored, so the database is
a cache and migration is a rebuild. Rebuilding into a fresh path is
load-bearing: the port creates tables IF NOT EXISTS, so opening it against
the old database would skip schema creation and seed id watermarks to 1
while live ids reach into the thirties."
```

---

### Task 4: Durability

**Files:**

- Modify: `packages/session-store/src/sqlite-store.ts`
- Modify: `packages/session-store/src/contract-suite.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: no signature change. Behavioural only.

- [ ] **Step 1: Write the failing test**

Add to `packages/session-store/src/contract-suite.ts`, inside the `CASES` array,
following the existing `{ name, run }` shape:

```ts
  {
    name: "durability/pragmas-are-set",
    run: (f) => {
      const s = f();
      try {
        const snap = s.snapshot();
        assert(snap !== null, "store did not open");
      } finally {
        s.close();
      }
    },
  },
```

That case only proves the store opens. The pragma assertion needs the raw
handle, so add a direct test in a new block at the end of
`packages/session-store/src/contract.test.ts`:

```ts
test("sqlite store opens in WAL with a busy timeout", () => {
  const dir = mkdtempSync(join(tmpdir(), "pragma-"));
  const path = join(dir, "s.db");
  const store = SqliteSessionStore.open(path);
  store.close();
  const db = new DatabaseSync(path);
  const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  const busy = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
  const sync = db.prepare("PRAGMA synchronous").get() as { synchronous: number };
  db.close();
  assert.equal(journal.journal_mode, "wal");
  assert.ok(busy.timeout >= 5000, `busy_timeout was ${busy.timeout}`);
  assert.equal(sync.synchronous, 1); // NORMAL
});
```

Add the imports this needs at the top of `contract.test.ts`: `mkdtempSync` from
`node:fs`, `tmpdir` from `node:os`, `join` from `node:path`, and `DatabaseSync`
from `node:sqlite`.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -15
```

Expected: FAIL — `journal_mode` is `delete`, not `wal`.

- [ ] **Step 3: Set the pragmas at open**

In `packages/session-store/src/sqlite-store.ts`, find this line (around 151):

```ts
    db.exec("PRAGMA foreign_keys=ON");
```

Replace it with:

```ts
    db.exec("PRAGMA foreign_keys=ON");
    // WAL lets readers run while a writer holds the write lock. AGENT_TRAPS.md:22
    // documents concurrent writers as normal operation, so the rollback-journal
    // default is a live hazard, not a theoretical one.
    db.exec("PRAGMA journal_mode=WAL");
    // NORMAL is durable across process crashes, which is the failure mode that
    // actually happens here. It trades only the last transaction on power loss.
    db.exec("PRAGMA synchronous=NORMAL");
    // Without this a second writer fails instantly with SQLITE_BUSY.
    db.exec("PRAGMA busy_timeout=5000");
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 5: Prove the busy timeout actually does something**

A pragma that is set but ineffective is not durability. Prove two writers now
serialize instead of one failing:

```bash
cd /root/fm-wt/sdb-design
cat > /tmp/busycheck.ts <<'TS'
import { SqliteSessionStore } from "./packages/session-store/src/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const p = join(mkdtempSync(join(tmpdir(), "busy-")), "s.db");
const a = SqliteSessionStore.open(p);
const b = SqliteSessionStore.open(p);
a.beginSession({ session_id: "a", started_ts: "2026-01-01T00:00:00Z", start_sha: null, note: null });
b.beginSession({ session_id: "b", started_ts: "2026-01-01T00:00:01Z", start_sha: null, note: null });
console.log("two writers ok, sessions =", b.listSessions().length);
a.close(); b.close();
TS
npx tsx /tmp/busycheck.ts
```

Expected: `two writers ok, sessions = 2`. If this throws `SQLITE_BUSY`, the
pragma is not being applied to every connection — fix that before continuing.

- [ ] **Step 6: Flush the canonical sidecar before renaming it**

The sidecar is the record that is tracked and travels, and it is currently the
one written without a flush. `writeAtomic` writes and renames, and `fsyncSync`
is imported on line 8 of `fm-session-main.ts` and never called, so a crash
between write and rename can leave the rename durable and the bytes not.

In `packages/orchestration/src/fm-session-main.ts`, replace:

```ts
function writeAtomic(path: string, text: string) {
  writeFileSync(path + ".tmp", text, { encoding: "utf8" });
  renameSync(path + ".tmp", path);
}
```

with:

```ts
function writeAtomic(path: string, text: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, text, { encoding: "utf8" });
  // The sidecar is the tracked, canonical record. Without this flush the
  // rename can land before the bytes do, and the record of truth is the one
  // artefact that must not be able to tear.
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
```

`openSync`, `closeSync` and `fsyncSync` are already imported on line 8. No new
import is needed — the import was there all along with no call site.

- [ ] **Step 7: Verify the sidecar still round-trips after the change**

```bash
cd /root/fm-wt/sdb-design
npm run build
rm -rf /tmp/fsynccheck && mkdir -p /tmp/fsynccheck/.foreman && cd /tmp/fsynccheck
git init -q .
cp /root/foreman/.foreman/session.ndjson .foreman/
node /root/fm-wt/sdb-design/skills/foreman/runtime/dist/fm-session.js import-sidecar
wc -l .foreman/session.ndjson
```

Expected: 94 lines, unchanged. A flush must not alter content.

- [ ] **Step 8: Commit**

```bash
cd /root/fm-wt/sdb-design
npm run typecheck && npm test 2>&1 | tail -10
git add packages/session-store/src/sqlite-store.ts packages/session-store/src/contract.test.ts packages/session-store/src/contract-suite.ts packages/orchestration/src/fm-session-main.ts
git commit -m "feat(session-store): open the store in WAL and flush the sidecar

Concurrent writers are documented as normal operation, so the
rollback-journal default was a live hazard. NORMAL is durable across
process crashes, which is the failure mode that actually occurs.

writeAtomic renamed without flushing, and fsyncSync had been imported
with no call site since the file was written. The sidecar is the tracked,
canonical record, so it was the one artefact that could tear."
```

---

### Task 5: Disclose what recover withholds

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts:316-345`
- Modify: `packages/orchestration/src/__golden__/` (goldens change deliberately here)

**Interfaces:**

- Consumes: nothing new.
- Produces: no signature change. Output shape changes, deliberately.

- [ ] **Step 1: Capture the current numbers as evidence**

```bash
cd /root/foreman
node skills/foreman/runtime/dist/fm-session.js recover | wc -c
sqlite3 .foreman/session.db "select count(*) from facts;"
sqlite3 .foreman/session.db "select count(*) from obligations where status != 'done';"
```

Record these in the commit message. Today: 20673 bytes, 36 facts, 24 not-done
obligations — with 20 of each shown and the remainder silently dropped.

- [ ] **Step 2: Replace the silent slice for facts**

In `packages/orchestration/src/fm-session-main.ts`, replace:

```ts
  for (const f of rec.facts.slice(0, 20)) {
    A(`  [${f.id}] ${f.statement}`);
    if (f.evidence) A(`       evidence: ${f.evidence}`);
  }
```

with:

```ts
  const FACT_LIMIT = 20;
  const factsShown = rec.facts.slice(0, FACT_LIMIT);
  for (const f of factsShown) {
    A(`  [${f.id}] ${f.statement}`);
    if (f.evidence) A(`       evidence: ${f.evidence}`);
  }
  const factsHidden = rec.facts.length - factsShown.length;
  if (factsHidden > 0) {
    A(`  ... ${factsHidden} more fact(s) not shown. Run: fm-session recover --json`);
  }
```

- [ ] **Step 3: Do the same for obligations**

Replace:

```ts
  for (const o of rec.obligations.slice(0, 20)) {
```

with the same pattern, using `OBLIGATION_LIMIT`, `obligationsShown` and
`obligationsHidden`, and the same trailing disclosure line wording with
`obligation(s)` in place of `fact(s)`.

- [ ] **Step 4: Do the same for measurements**

Replace:

```ts
  for (const m of rec.measurements.slice(0, 20)) {
```

with the same pattern, using `MEASUREMENT_LIMIT`, `measurementsShown` and
`measurementsHidden`, and `measurement(s)` in the disclosure line.

- [ ] **Step 5: Verify text and JSON now agree on totals**

```bash
cd /root/fm-wt/sdb-design
npm run build
cd /root/foreman
node /root/fm-wt/sdb-design/skills/foreman/runtime/dist/fm-session.js recover | grep 'more fact'
node /root/fm-wt/sdb-design/skills/foreman/runtime/dist/fm-session.js recover --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('json facts',j.facts.length)})"
```

Expected: the text reports `... 16 more fact(s) not shown` and the JSON reports
`json facts 36`. 20 shown plus 16 hidden must equal the JSON count.

- [ ] **Step 6: Re-record the goldens, deliberately**

```bash
cd /root/fm-wt/sdb-design
GOLDEN_UPDATE=1 npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
git diff --stat packages/orchestration/src/__golden__
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
```

Expected: `recover.out` changes, the others do not. Review the diff before
committing — an unexpected golden change means you changed something you did
not intend to.

- [ ] **Step 7: Commit**

```bash
cd /root/fm-wt/sdb-design
git add packages/orchestration/src/fm-session-main.ts packages/orchestration/src/__golden__
git commit -m "fix(session): disclose the rows recover withholds

recover truncated to 20 rows per kind with no indicator, hiding 16 of 36
facts and 14 of 34 obligations while --json reported the full set. The
limit stays; the silence does not."
```

---

### Task 6a: Move the bootstrap and sidecar ownership to the port

Task 6 cannot begin until this lands. Pointing `SqliteSessionStore.open` at the
CLI's existing database is not a cutover, it is a corruption. Measured against a
copy of the live store:

```console
tables BEFORE:  facts measurements obligations schema_meta sessions
tables AFTER:   + store_meta + memory_outbox
store_meta:     next_id.fact|1  next_id.measurement|1  next_id.obligation|1
actual max ids: facts|36        measurements|19        obligations|34
```

`open()` returns cleanly while adding tables and seeding every watermark to 1
against live ids up to 36, so the next write collides. Worse, the CLI's sidecar
writer walks `sqlite_schema`, so those two new tables are then written into the
tracked NDJSON, after which `decodeSnapshot` refuses the canonical record with
`unknown v1 table "store_meta"`. Every golden stays green throughout.

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`
- Modify: `packages/orchestration/src/__golden__/seed.ndjson`
- Modify: `packages/orchestration/src/__golden__/` (re-record, deliberate)

**Interfaces:**

- Consumes: `rebuildFromSidecar` from `./session-rebuild.js`; `encodeSnapshot`,
  `decodeSnapshot`, `SqliteSessionStore` from `@foreman/session-store`.
- Produces: a CLI whose database is always port-shaped, and whose sidecar is
  written by the port rather than by a `sqlite_schema` walk.

- [ ] **Step 1: Repair the golden seed**

The seed is not self-consistent. `rebuildFromSidecar` rejects it with 15
integrity violations: facts and obligations reference a `session_id` that the
subsetting dropped, and `superseded_by` 32 and 34 point at rows outside the
subset. It only loads today because the legacy path enforces nothing.

Include every session referenced by a retained row, and resolve every retained
`superseded_by` either by including its target or by clearing the supersession
triple on that row. Keep the selection deterministic and keep the Task 1
coverage properties: all four kinds present, at least one obligation carrying a
blocker, and the pinned measurement shas still resolving.

Prove it loads:

```bash
cd /root/fm-wt/sdb-design
rm -rf /tmp/seedcheck && mkdir -p /tmp/seedcheck
cp packages/orchestration/src/__golden__/seed.ndjson /tmp/seedcheck/
cat > /tmp/seedcheck.ts <<'TS'
import { rebuildFromSidecar } from "/root/fm-wt/sdb-design/packages/orchestration/src/session-rebuild.js";
const r = rebuildFromSidecar({
  sidecarPath: "/tmp/seedcheck/seed.ndjson",
  dbPath: "/tmp/seedcheck/out.db",
});
console.log(JSON.stringify(r));
TS
npx tsx /tmp/seedcheck.ts
```

Expected: a row count and `nextIds`, with no integrity failure. Zero violations
is the gate — do not proceed while any remain.

- [ ] **Step 2: Bootstrap through the port, never onto the legacy file**

Replace the CLI's "open the database at `.foreman/session.db`" with: if the file
is absent or legacy-shaped, rebuild it from the canonical sidecar into a
port-shaped database, then open that. Detect legacy shape structurally — the
presence of `schema_meta` together with the absence of `store_meta` — not by a
version number, because the number is what is untrustworthy here.

Never open the port against a file that failed that test. Prove the guard:

```bash
cd /root/fm-wt/sdb-design
rm -rf /tmp/bootprobe && mkdir -p /tmp/bootprobe/.foreman && cd /tmp/bootprobe
git init -q .
cp /root/foreman/.foreman/session.db .foreman/
sqlite3 .foreman/session.db ".tables"
node /root/fm-wt/sdb-design/skills/foreman/runtime/dist/fm-session.js recover >/dev/null
sqlite3 .foreman/session.db "select key,value from store_meta;"
sqlite3 .foreman/session.db "select max(id) from facts;"
```

Expected: every watermark strictly exceeds the corresponding `max(id)`. A
watermark of 1 means the rebuild was skipped and the legacy file was opened
directly.

- [ ] **Step 3: The port writes the sidecar**

Replace the `sqlite_schema`-driven dump with `encodeSnapshot(store.snapshot())`.
The port emits only declared entity kinds, so `store_meta` and `memory_outbox`
can no longer leak into the tracked record. Keep the fsync-before-rename added
in Task 4 — verify the call site survives:

```bash
grep -rn "fsyncSync" packages/*/src | grep -v "\.test\.ts"
```

Expected: at least one call site on the path that renames the sidecar.

- [ ] **Step 4: Render `blocked` as derived state**

The port's model has no `blocked` status — it is `open` plus a non-null
`blocker`, and the v1 reader normalizes it on the way in. The CLI must therefore
derive it at render time, or `recover` will report five obligations that vanished.

Render an obligation as blocked when its status is `open` and its `blocker` is
non-null. Apply the same rule to the Task 5 actionability sort, so genuinely open
obligations still rank ahead of blocked ones.

Prove against a copy of the live store that `recover` still reports
`open=19 blocked=5`. If those counts move, the derivation is wrong.

- [ ] **Step 5: Re-record the goldens, deliberately**

Two changes are expected: the rehydrate banner count shifts as `schema_meta`
stops being a row, and any fixture reflecting the repaired seed moves. Review
every changed fixture and account for each in the report. `freshness.out` must
still land in multiple distinct states — if it collapses to one bucket the seed
repair destroyed Task 1's measurement coverage.

```bash
cd /root/fm-wt/sdb-design
GOLDEN_UPDATE=1 npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
git diff --stat packages/orchestration/src/__golden__
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
```

- [ ] **Step 6: Rebuild, verify and commit**

```bash
cd /root/fm-wt/sdb-design
npm run build && npm run verify-runtime
npm run typecheck && npm test 2>&1 | tail -5
bash skills/foreman/scripts/docs-check.sh
git add packages/orchestration/src packages/session-store/src skills/foreman/runtime
git ls-files -s packages/orchestration/src | grep -v '^100644' || echo "modes ok"
git commit -F <your message file>
git status --porcelain
```

---

### Task 6: Move the CLI onto the port

Do this one command at a time. After each command, run the goldens. A command is
migrated only when the goldens pass unchanged, except where this task explicitly
changes behaviour.

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`
- Modify: `packages/orchestration/src/__golden__/` (one deliberate change, Step 5)

**Interfaces:**

- Consumes: `SqliteSessionStore`, `decodeSnapshot`, `encodeSnapshot` from
  `@foreman/session-store`; `rebuildFromSidecar` from `./session-rebuild.js`.
- Produces: the same CLI surface, backed by the port.

- [ ] **Step 1: Add the backend seam**

Near the top of `fm-session-main.ts`, after the imports:

```ts
/**
 * Which store backs the CLI. "legacy" is the embedded store; "port" is
 * @foreman/session-store. Defaults to legacy until every command is migrated,
 * so a half-finished migration cannot ship silently.
 */
const BACKEND = process.env["FM_SESSION_CMD"] === "port" ? "port" : "legacy";
```

- [ ] **Step 2: Migrate the read commands first**

Read commands cannot corrupt anything, so they go first. Route `recover`,
`freshness` and the listing paths through the port when `BACKEND === "port"`,
leaving the legacy path intact otherwise.

After each one:

```bash
cd /root/fm-wt/sdb-design
FM_SESSION_CMD=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
```

Expected: PASS with no golden changes. Reads must be byte-identical.

- [ ] **Step 3: Migrate the write commands**

Route `begin`, `end`, `fact`, `measure`, `obligation` and `close` through the
port, one at a time, running the goldens after each.

`close` changes behaviour deliberately. The port refuses to close an obligation
that is not open, never writes `blocker`, and always stamps `closed_ts`. The
shipping CLI accepts any `--status` value and wipes `blocker`; both were recorded
as defects in the design. The port's semantics win, so the `close-unknown` golden
is re-recorded in the same commit that changes the behaviour, exactly as
`supersede-missing` is.

Worked example for `fact`, which every other write command follows. Replace the
legacy body:

```ts
  if (cmd === "fact") {
    const res = conn
      .prepare(
        "INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)",
      )
      .run(statement, evidence, nowIso(), currentSession(conn));
    process.stdout.write(`fact ${res.lastInsertRowid}\n`);
    return 0;
  }
```

with:

```ts
  if (cmd === "fact") {
    if (BACKEND === "port") {
      const store = SqliteSessionStore.open(dbPath);
      try {
        const row = store.addFact({
          statement,
          evidence,
          established_ts: nowIso(),
          session_id: currentSessionId(store),
        });
        process.stdout.write(`fact ${row.id}\n`);
      } finally {
        store.close();
      }
      return 0;
    }
    // legacy path unchanged, deleted in Task 7
    const res = conn
      .prepare(
        "INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)",
      )
      .run(statement, evidence, nowIso(), currentSession(conn));
    process.stdout.write(`fact ${res.lastInsertRowid}\n`);
    return 0;
  }
```

Two things to keep identical, because the goldens compare bytes: the printed id
must come from the port's returned row rather than a rowid, and the trailing
newline must stay. `currentSessionId(store)` is the port equivalent of the
legacy `currentSession(conn)` — write it as a small helper over
`store.currentSession()` returning `string | null`.

- [ ] **Step 4: Migrate supersede**

This is the command with the defect. Route it through `store.supersedeFact` and
`store.supersedeMeasurement`, which are already atomic and reject a missing or
already-superseded target (`sqlite-store.ts:500`, `:514`, `:547`).

- [ ] **Step 5: Change the frozen defect, deliberately**

The `supersede-missing` golden froze exit 0 and a success message. Now it must
fail. Update the golden in the same commit that changes the behaviour:

```bash
cd /root/fm-wt/sdb-design
FM_SESSION_CMD=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts 2>&1 | tail -20
GOLDEN_UPDATE=1 FM_SESSION_CMD=port npx tsx --test packages/orchestration/src/fm-session-golden.test.ts
cat packages/orchestration/src/__golden__/supersede-missing.exit
```

Expected: the exit fixture now contains a non-zero code, and the `.err` fixture
carries a message naming the missing id. Remove the KNOWN DEFECT comment from
`fm-session-golden.test.ts` in this same commit.

- [ ] **Step 6: Prove the defect is actually closed**

```bash
cd /root/fm-wt/sdb-design
rm -rf /tmp/sdbverify && mkdir -p /tmp/sdbverify/.foreman && cd /tmp/sdbverify
git init -q .
cp /root/foreman/.foreman/session.ndjson .foreman/
node /root/fm-wt/sdb-design/skills/foreman/runtime/dist/fm-session.js import-sidecar
before=$(sqlite3 .foreman/session.db "select count(*) from facts;")
set +e
FM_SESSION_CMD=port node /root/fm-wt/sdb-design/skills/foreman/runtime/dist/fm-session.js supersede 9999 phantom --reason r
echo "exit=$?"
set -e
after=$(sqlite3 .foreman/session.db "select count(*) from facts;")
echo "facts before=$before after=$after"
```

Expected: non-zero exit, and `before` equals `after`. Under the legacy path this
inserted an orphan and exited 0.

- [ ] **Step 7: Flip the default**

Change the seam so `port` is the default and `legacy` requires an explicit
opt-out:

```ts
const BACKEND = process.env["FM_SESSION_CMD"] === "legacy" ? "legacy" : "port";
```

- [ ] **Step 8: Commit**

```bash
cd /root/fm-wt/sdb-design
npm run typecheck && npm test 2>&1 | tail -10
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts && bats tests/session.bats
git add packages/orchestration/src/fm-session-main.ts packages/orchestration/src/fm-session-golden.test.ts packages/orchestration/src/__golden__
git commit -m "feat(session): run fm-session on the session-store port

Migrated command by command behind FM_SESSION_CMD, diffing against the
golden oracle at each step. Reads are byte-identical. One golden changes
deliberately: superseding a missing fact now exits non-zero instead of
inserting an orphan and reporting success."
```

---

### Task 7: Delete the embedded store and prove the predicates

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts` (delete the legacy path)
- Modify: `packages/orchestration/src/fm-session-main.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2-6.
- Produces: a `fm-session-main.ts` with no `node:sqlite` import and no
  `@ts-nocheck`.

- [ ] **Step 1: Delete the legacy branch and the seam**

Remove the `BACKEND` constant, every `if (BACKEND === "legacy")` branch, the
embedded schema constants, the `DatabaseSync` import on line 3, and the
duplicate unreachable `import-sidecar` dispatch at line 665.

If sidecar writing moves out of this file, the fsync-before-rename added in
Task 4 must move with it. The requirement is a property of writing the
canonical record, not of the helper's location. Verify after the move:

```bash
cd /root/fm-wt/sdb-design
grep -rn "fsyncSync" packages/*/src | grep -v "\.test\.ts"
```

Expected: at least one call site, in whichever module now renames the sidecar.
Zero call sites means the durability fix was deleted along with the helper.

- [ ] **Step 2: Remove the type suppression**

Delete `// @ts-nocheck` from line 1 of `fm-session-main.ts`.

- [ ] **Step 3: Fix what the type checker now finds**

```bash
cd /root/fm-wt/sdb-design
npm run typecheck 2>&1 | tail -30
```

Expected: errors, because this file has never been type-checked. Fix them. Do
not re-add the suppression, and do not silence errors with `any` — the file is
now small enough to type honestly.

- [ ] **Step 4: Prove exit predicate 1 — no backend access outside the port**

```bash
cd /root/fm-wt/sdb-design
grep -rn "node:sqlite" packages/*/src | grep -v session-store
```

Expected: no output except possibly test files. If `fm-session-main.ts` still
appears, the deletion is incomplete.

- [ ] **Step 5: Prove exit predicate 2 — CLI behaviour unchanged**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/orchestration/src/fm-session-golden.test.ts && bats tests/session.bats
```

Expected: PASS. The only fixture that differs from Task 1 is
`supersede-missing`, changed deliberately in Task 6.

- [ ] **Step 6: Prove exit predicate 3 — the contract is portable**

```bash
cd /root/fm-wt/sdb-design
npx tsx --test packages/session-store/src/contract.test.ts 2>&1 | tail -10
```

Expected: all 28 cases PASS, with the suite file unedited. That it needed no
editing is the point.

- [ ] **Step 7: Prove exit predicate 4 — correctness is independent of projection**

```bash
cd /root/fm-wt/sdb-design
grep -rn "MemoryIndex" packages/orchestration/src | grep -v "\.test\.ts"
```

Expected: no output. The system of record must not import the projection.

- [ ] **Step 8: Run the full gate and commit**

```bash
cd /root/fm-wt/sdb-design
npm run verify 2>&1 | tail -20
bats tests/
git add packages/orchestration/src
git ls-files -s packages/orchestration/src | grep -v '^100644' || echo "modes ok"
git commit -m "refactor(session): delete the embedded session store

fm-session now runs entirely on @foreman/session-store. The embedded
schema, the DatabaseSync import, the unreachable second import-sidecar
dispatch and the @ts-nocheck suppression are all gone, and the file
type-checks for the first time.

There is now one SessionDB."
```

- [ ] **Step 9: Final QA review of the whole branch**

The per-task preflight has already run six times. This step is the review, not
another preflight. Gather the context the reviewer needs:

```bash
cd /root/fm-wt/sdb-design
git diff main...HEAD --stat
git ls-files -s packages/session-store/src packages/orchestration/src | grep -v '^100644' || echo "modes ok"
bash skills/foreman/scripts/docs-check.sh
```

Then follow `plugins/foreman-qa/commands/foreman-qa-review.md`: hand the
complete diff, the mode listing and the exact `docs-check.sh` output to the
`foreman-qa-reviewer` doctrine in `plugins/foreman-qa/agents/foreman-qa-reviewer.md`.
Relay its findings verbatim — do not soften, summarize or omit a verdict.

Do not claim this plan is complete on an exit code alone. `tests/run.sh` in
shadow mode can print `RESULT ERROR` and still exit 0.

---

## Notes for the implementer

**The one thing most likely to go wrong.** Opening the port against the existing
`.foreman/session.db` looks like it works and quietly corrupts the id
watermarks. Tables are created `IF NOT EXISTS`, so the old schema survives,
`store_meta` is created empty, and every counter seeds to 1 while live ids reach
36. Always rebuild into a fresh path (Task 3).

**Do not rehearse against the live store.** `/root/foreman/.foreman/session.db`
is a working record and a live session may be writing to it. Copy it first,
every time.

**`fm-session.py` no longer exists.** It was retired in `b6e9ed0` and only a
stale `.pyc` remains, but `CLAUDE.md` still instructs agents to run
`python3 skills/foreman/scripts/fm-session.py recover`. That documentation fix is
out of scope here — record it as an obligation rather than fixing it inline.
