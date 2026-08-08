# v0.3.1 Session Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session state portable — `fm-session` runs on the `SessionStore`
port, and the port is proven by a second implementation that passes the same
conformance suite unchanged.

**Architecture:** Freeze the CLI's exact output as a golden oracle before
touching it. Land a second `SessionStore` implementation so the contract is
proven while the CLI still runs on the old code. Then migrate the CLI
command-by-command behind the `FM_SESSION_CMD` seam, diffing against the golden
at every step. Cut over only when every command is clean.

**Tech Stack:** Node.js 24, TypeScript (strict, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), `node:test`, Bats, esbuild
bundling via `scripts/build-runtime.ts`.

## Global Constraints

- Node.js 24, TypeScript only. No new Python, no new shell.
- `@foreman/session-store` must not import from `@foreman/orchestration`.
  Dependency runs one way: orchestration depends on session-store.
- The system of record must never import `MemoryIndex`. An import-boundary test
  in `packages/session-store/src/contract.test.ts` already enforces this; keep it
  passing.
- Every file you create must be mode `100644`. Files copied from `/mnt/c` land
  `755`. Check with `git ls-files -s <paths> | grep -v '^100644'` before every
  commit and clear with `git update-index --chmod=-x`.
- Never add `Co-Authored-By` or AI attribution to a commit.
- Before claiming any task done, run `/foreman-qa-preflight` and report evidence.
- `NullMemoryIndex` stays the default. No task may make Foreman require network
  access or credentials.
- Consult `AGENT_TRAPS.md` § 1 before dispatching any vendor lane.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `tests/session-golden.bats` | Golden oracle. Runs a fixed command corpus and diffs exact bytes |
| `tests/golden-session/corpus.txt` | The command corpus: one command per row |
| `tests/golden-session/expected/` | Frozen stdout, stderr, exit code, sidecar per command |
| `packages/session-store/src/files-only.ts` | `FilesOnlySessionStore`, second implementation |
| `packages/session-store/src/files-only.test.ts` | Conformance suite run against files-only |
| `packages/session-store/src/broken-store.ts` | Deliberately broken store; the suite's negative control |
| `packages/session-store/src/open.ts` | Backend factory reading `FOREMAN_SESSION_BACKEND` |
| `packages/orchestration/src/fm-session-sync.ts` | `fm-session sync`, drains `memory_outbox` |

**Modified:**

| Path | Change |
|---|---|
| `packages/session-store/src/contract-suite.ts` | Add `brokenFactory`, `MIN_INDEPENDENT_BROKEN_CATEGORIES`, category tagging |
| `packages/session-store/src/sqlite-store.ts` | Add `listOutbox`/`clearOutbox` for the drain |
| `packages/session-store/src/index.ts` | Export the new surface |
| `packages/orchestration/src/fm-session-main.ts` | Migrate onto the port; drop `// @ts-nocheck` |
| `scripts/build-runtime.ts` | Add the `fm-session-sync` bundle entry |
| `package.json` | Add session-store test glob (already present) and golden bats wiring |

---

## Task 1: Golden oracle

The oracle comes first. Everything after this depends on it.

**Files:**

- Create: `tests/golden-session/corpus.txt`
- Create: `tests/golden-session/capture.ts`
- Create: `tests/session-golden.bats`
- Create: `tests/golden-session/expected/` (generated)

**Interfaces:**

- Consumes: nothing.
- Produces: `tests/golden-session/expected/<slug>.{out,err,code,sidecar}` — the
  frozen bytes every later task diffs against. Slug is the corpus row's first
  column.

- [ ] **Step 1: Write the command corpus**

Create `tests/golden-session/corpus.txt`. The slug, then a space, then the
arguments passed to the CLI. One row per behaviour worth freezing. Space
delimited rather than tab, because the repository's markdownlint rejects hard
tabs and the corpus is quoted in this plan.

```text
# slug args
begin-plain begin
begin-note begin --note first-note
fact-plain fact "the port is the contract"
fact-evidence fact "checked" --evidence packages/session-store/src/port.ts
measure-num measure typecheck.errors 0 --command "npm run typecheck"
measure-scope measure tests.pass 29 --scope tests --scope packages
obligation-open obligation "write the suite"
obligation-blocked obligation "land the port" --blocker "review pending"
close-done close 1
supersede-fact supersede 1 "sharpened" --by "the port declared" --reason sharpened
retire-oblig retire 2 --reason "no longer needed"
recover-empty recover
recover-json recover --json
freshness-all freshness
freshness-stale freshness --stale-only
freshness-json freshness --format json
sidecar-out sidecar
end-plain end
```

- [ ] **Step 2: Write the capture script**

Create `tests/golden-session/capture.ts`. It builds a fixed git repo, replays
the corpus in order against one store, and writes exact bytes per command.

```typescript
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const EXPECTED = join(here, "expected");

/** Deterministic repo: fixed content, fixed identity, fixed message. */
function makeRepo(root: string): void {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.sh"), "one\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@e.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("-c", "core.hooksPath=", "commit", "-qm", "base");
}

function parseCorpus(): { slug: string; args: string[] }[] {
  const text = readFileSync(join(here, "corpus.txt"), "utf8");
  const rows: { slug: string; args: string[] }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    const slug = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? "" : line.slice(sp + 1);
    if (!slug || !rest) continue;
    // Split on spaces but keep quoted phrases together.
    const args = (rest.match(/"[^"]*"|\S+/g) ?? []).map((a) =>
      a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a,
    );
    rows.push({ slug, args });
  }
  return rows;
}

/** Git shas and timestamps vary per run; mask them so the diff is meaningful. */
export function normalise(text: string): string {
  return text
    .replace(/\b[0-9a-f]{40}\b/g, "<SHA40>")
    .replace(/\b[0-9a-f]{7,12}\b/g, "<SHA>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, "<TS>")
    .replace(/S-[0-9a-f]+/g, "<SESSION>");
}

const cmd = process.env["FM_SESSION_CMD"];
if (!cmd) {
  console.error("FM_SESSION_CMD is required");
  process.exit(2);
}

const root = process.env["GOLDEN_REPO"] ?? "/tmp/golden-session-repo";
rmSync(root, { recursive: true, force: true });
makeRepo(root);
const db = join(root, ".foreman", "session.db");
mkdirSync(EXPECTED, { recursive: true });

for (const { slug, args } of parseCorpus()) {
  const parts = cmd.split(" ");
  const bin = parts[0] as string;
  const r = spawnSync(bin, [...parts.slice(1), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FOREMAN_SESSION_DB: db },
  });
  writeFileSync(join(EXPECTED, `${slug}.out`), normalise(r.stdout ?? ""));
  writeFileSync(join(EXPECTED, `${slug}.err`), normalise(r.stderr ?? ""));
  writeFileSync(join(EXPECTED, `${slug}.code`), `${r.status}\n`);
}

// Freeze the store's wire form once, at the end, after every mutation.
const parts = cmd.split(" ");
const side = spawnSync(parts[0] as string, [...parts.slice(1), "sidecar"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, FOREMAN_SESSION_DB: db },
});
writeFileSync(join(EXPECTED, "final.sidecar"), normalise(side.stdout ?? ""));
console.log(`captured ${parseCorpus().length} commands to ${EXPECTED}`);
```

- [ ] **Step 2b: Verify the normaliser does not mask everything**

Run: `npx tsx -e "import {normalise} from './tests/golden-session/capture.ts'; console.log(normalise('fact 1 recorded at 2026-08-08T10:00:00Z sha abc1234'))"`

Expected: `fact 1 recorded at <TS> sha <SHA>` — the *values that matter* (`fact`,
`1`, `recorded`) survive. If the output is all placeholders, the oracle is
blind and the task fails here.

- [ ] **Step 3: Capture the golden on unmodified fm-session**

Run:

```bash
npm run build
FM_SESSION_CMD="node skills/foreman/runtime/dist/fm-session.js" \
  npx tsx tests/golden-session/capture.ts
```

Expected: `captured 17 commands to .../expected`

- [ ] **Step 4: Write the golden diff test**

Create `tests/session-golden.bats`.

```bash
#!/usr/bin/env bats
# @description Golden oracle for fm-session. Freezes exact stdout, stderr, exit
#   code and sidecar bytes for a fixed command corpus. session.bats asserts
#   shapes; this asserts values. A port that changes a printed number passes
#   session.bats and fails here.

setup() {
  ROOT="$BATS_TEST_DIRNAME/.."
  SESS="${FM_SESSION_CMD:-node $ROOT/skills/foreman/runtime/dist/fm-session.js}"
  export GOLDEN_REPO="$BATS_TEST_TMPDIR/repo"
}

@test "every corpus command reproduces its golden bytes" {
  run env FM_SESSION_CMD="$SESS" GOLDEN_ACTUAL="$BATS_TEST_TMPDIR/actual" \
    npx tsx "$ROOT/tests/golden-session/verify.ts"
  [ "$status" -eq 0 ]
  [[ "$output" == *"golden: 17/17 match"* ]]
}

@test "the oracle discriminates: a mutated command fails the diff" {
  # Positive control. If this passes, the diff is not actually comparing.
  run env FM_SESSION_CMD="$SESS" GOLDEN_MUTATE=1 \
    GOLDEN_ACTUAL="$BATS_TEST_TMPDIR/actual-bad" \
    npx tsx "$ROOT/tests/golden-session/verify.ts"
  [ "$status" -ne 0 ]
  [[ "$output" == *"mismatch"* ]]
}
```

- [ ] **Step 5: Write the verifier with its own positive control**

Create `tests/golden-session/verify.ts`. `GOLDEN_MUTATE=1` appends a byte to
every captured stdout before comparing, which must make the diff fail. That is
how we know the comparison is real.

```typescript
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const EXPECTED = join(here, "expected");
const MUTATE = process.env["GOLDEN_MUTATE"] === "1";

// Reuse the capture module's repo builder, corpus parser and normaliser.
const { normalise } = await import("./capture.ts");

function readCorpus(): { slug: string; args: string[] }[] {
  const text = readFileSync(join(here, "corpus.txt"), "utf8");
  const out: { slug: string; args: string[] }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    const slug = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? "" : line.slice(sp + 1);
    if (!slug || !rest) continue;
    const args = (rest.match(/"[^"]*"|\S+/g) ?? []).map((a) =>
      a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a,
    );
    out.push({ slug, args });
  }
  return out;
}

const cmd = (process.env["FM_SESSION_CMD"] ?? "").split(" ");
const root = process.env["GOLDEN_REPO"] ?? "/tmp/golden-verify-repo";
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "a.sh"), "one\n");
const git = (...a: string[]) =>
  execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.email", "t@e.com");
git("config", "user.name", "t");
git("add", "-A");
git("-c", "core.hooksPath=", "commit", "-qm", "base");

const db = join(root, ".foreman", "session.db");
const corpus = readCorpus();
let matched = 0;
const failures: string[] = [];

for (const { slug, args } of corpus) {
  const r = spawnSync(cmd[0] as string, [...cmd.slice(1), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FOREMAN_SESSION_DB: db },
  });
  let actualOut = normalise(r.stdout ?? "");
  if (MUTATE) actualOut += "X";
  const wantOut = readFileSync(join(EXPECTED, `${slug}.out`), "utf8");
  const wantCode = readFileSync(join(EXPECTED, `${slug}.code`), "utf8").trim();
  if (actualOut === wantOut && String(r.status) === wantCode) {
    matched++;
  } else {
    failures.push(
      `mismatch ${slug}\n  want code=${wantCode}\n  got  code=${r.status}\n` +
        `  --- want stdout ---\n${wantOut}\n  --- got stdout ---\n${actualOut}`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`golden: ${matched}/${corpus.length} match`);
  process.exit(1);
}
console.log(`golden: ${matched}/${corpus.length} match`);
```

- [ ] **Step 6: Run both golden tests**

Run: `npx bats tests/session-golden.bats`

Expected: 2 passing. The first proves the corpus reproduces. The second proves
the diff can fail — without it, a comparison that silently compares nothing
would look identical to success.

- [ ] **Step 7: Check file modes, then commit**

```bash
git ls-files -s tests/golden-session tests/session-golden.bats | grep -v '^100644' || echo "modes clean"
git add tests/golden-session tests/session-golden.bats
git commit -m "test: freeze fm-session exact output as the migration oracle"
```

---

## Task 2: FilesOnlySessionStore

Land the second implementation while the CLI still runs on the old code, so a
contract defect surfaces before the migration depends on it.

**Files:**

- Create: `packages/session-store/src/files-only.ts`
- Create: `packages/session-store/src/files-only.test.ts`
- Modify: `packages/session-store/src/index.ts`

**Interfaces:**

- Consumes: `SessionStore`, `SessionSnapshot`, `NextIds`, `assertIntegrity`,
  `encodeSnapshot`, `decodeSnapshot`, `raise` from this package.
- Produces: `class FilesOnlySessionStore implements SessionStore` and
  `openFilesOnlySession(dir: string): FilesOnlySessionStore`. Task 4's factory
  calls `openFilesOnlySession`.

- [ ] **Step 1: Write the failing conformance test**

Create `packages/session-store/src/files-only.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ALL_CASES, formatReport, runSuite } from "./contract-suite.js";
import { openFilesOnlySession } from "./files-only.js";

describe("SessionStore contract suite (files-only)", () => {
  it("passes every conformance case, unchanged", () => {
    const dirs: string[] = [];
    const report = runSuite(() => {
      const d = mkdtempSync(join(tmpdir(), "fm-files-"));
      dirs.push(d);
      return openFilesOnlySession(d);
    });
    try {
      if (!report.ok) assert.fail(formatReport(report));
      assert.equal(report.failed, 0);
      assert.equal(report.results.length, ALL_CASES.length);
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test packages/session-store/src/files-only.test.ts`

Expected: FAIL — `Cannot find module './files-only.js'`.

- [ ] **Step 3: Implement FilesOnlySessionStore**

Create `packages/session-store/src/files-only.ts`. Hold the snapshot in memory,
persist by writing the canonical sidecar atomically on every mutation. Reuse the
codec so the two implementations cannot drift in wire format.

```typescript
/**
 * Files-only SessionStore: the second implementation of the port.
 *
 * Persists by writing the canonical sidecar atomically after every mutation.
 * It shares the codec with SQLite deliberately — a second wire format would
 * prove nothing about the contract.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  COUNTED_KINDS,
  SESSION_MODEL_VERSION,
  emptySnapshot,
  type CountedKind,
  type FactRow,
  type MeasurementRow,
  type NextIds,
  type ObligationRow,
  type ObligationStatus,
  type SessionRow,
  type SessionSnapshot,
} from "./entities.js";
import { assertIntegrity } from "./integrity.js";
import { raise } from "./failures.js";
import { decodeSnapshot, encodeSnapshot } from "./sidecar.js";
import type {
  ImportOptions,
  NewFact,
  NewMeasurement,
  NewObligation,
  SessionStore,
  SupersedeResult,
} from "./port.js";

export class FilesOnlySessionStore implements SessionStore {
  readonly modelVersion = SESSION_MODEL_VERSION;
  private snap: SessionSnapshot;
  private readonly path: string;
  private closed = false;

  constructor(path: string) {
    this.path = path;
    this.snap = existsSync(path)
      ? decodeSnapshot(readFileSync(path, "utf8"))
      : emptySnapshot();
  }

  private flush(next: SessionSnapshot): void {
    assertIntegrity(next);
    const text = encodeSnapshot(next);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, this.path);
    this.snap = next;
  }

  private mint(kind: CountedKind): [number, NextIds] {
    const id = this.snap.nextIds[kind];
    const nextIds = { ...this.snap.nextIds, [kind]: id + 1 } as NextIds;
    return [id, nextIds];
  }

  snapshot(): SessionSnapshot {
    return this.snap;
  }

  listSessions(): readonly SessionRow[] {
    return this.snap.sessions;
  }

  listFacts(): readonly FactRow[] {
    return this.snap.facts;
  }

  listMeasurements(): readonly MeasurementRow[] {
    return this.snap.measurements;
  }

  listObligations(): readonly ObligationRow[] {
    return this.snap.obligations;
  }

  peekNextId(kind: CountedKind): number {
    return this.snap.nextIds[kind];
  }

  currentSession(): SessionRow | null {
    const open = this.snap.sessions.filter((s) => s.ended_ts === null);
    if (open.length === 0) return null;
    return [...open].sort((a, b) =>
      a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0,
    )[0] as SessionRow;
  }

  beginSession(args: {
    readonly session_id: string;
    readonly started_ts: string;
    readonly start_sha: string | null;
    readonly note: string | null;
  }): SessionRow {
    const row: SessionRow = {
      session_id: args.session_id,
      started_ts: args.started_ts,
      start_sha: args.start_sha,
      ended_ts: null,
      note: args.note,
    };
    const sessions = [...this.snap.sessions, row].sort((a, b) =>
      a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0,
    );
    this.flush({ ...this.snap, sessions });
    return row;
  }

  endSession(sessionId: string, endedTs: string): SessionRow {
    const idx = this.snap.sessions.findIndex((s) => s.session_id === sessionId);
    if (idx < 0) raise("invalid_argument", `no such session ${JSON.stringify(sessionId)}`);
    const prev = this.snap.sessions[idx] as SessionRow;
    const row: SessionRow = { ...prev, ended_ts: endedTs };
    const sessions = [...this.snap.sessions];
    sessions[idx] = row;
    this.flush({ ...this.snap, sessions });
    return row;
  }

  addFact(fact: NewFact): FactRow {
    const [id, nextIds] = this.mint("fact");
    const row: FactRow = {
      id,
      statement: fact.statement,
      evidence: fact.evidence,
      established_ts: fact.established_ts,
      session_id: fact.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    this.flush({ ...this.snap, nextIds, facts: [...this.snap.facts, row] });
    return row;
  }

  addMeasurement(m: NewMeasurement): MeasurementRow {
    if (m.value_num !== null && !Number.isFinite(m.value_num)) {
      raise("field_type", `value_num must be finite, got ${String(m.value_num)}`);
    }
    const [id, nextIds] = this.mint("measurement");
    const row: MeasurementRow = {
      id,
      metric: m.metric,
      value: m.value,
      value_num: m.value_num,
      command: m.command,
      measured_ts: m.measured_ts,
      measured_sha: m.measured_sha,
      scope_paths: m.scope_paths,
      session_id: m.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    this.flush({
      ...this.snap,
      nextIds,
      measurements: [...this.snap.measurements, row],
    });
    return row;
  }

  addObligation(o: NewObligation): ObligationRow {
    const [id, nextIds] = this.mint("obligation");
    const row: ObligationRow = {
      id,
      statement: o.statement,
      status: "open",
      blocker: o.blocker,
      opened_ts: o.opened_ts,
      closed_ts: null,
      session_id: o.session_id,
    };
    this.flush({
      ...this.snap,
      nextIds,
      obligations: [...this.snap.obligations, row],
    });
    return row;
  }

  closeObligation(
    id: number,
    status: Exclude<ObligationStatus, "open">,
    closedTs: string,
  ): ObligationRow {
    const idx = this.snap.obligations.findIndex((o) => o.id === id);
    if (idx < 0) raise("invalid_argument", `no such obligation ${id}`);
    const prev = this.snap.obligations[idx] as ObligationRow;
    if (prev.status !== "open") {
      raise(
        "invalid_argument",
        `obligation ${id} is already ${prev.status}; only an open obligation may be closed`,
      );
    }
    const row: ObligationRow = { ...prev, status, closed_ts: closedTs };
    const obligations = [...this.snap.obligations];
    obligations[idx] = row;
    this.flush({ ...this.snap, obligations });
    return row;
  }

  supersedeFact(
    id: number,
    replacement: NewFact,
    reason: string | null,
    at: string,
  ): SupersedeResult<FactRow> {
    const idx = this.snap.facts.findIndex((f) => f.id === id);
    if (idx < 0) raise("invalid_argument", `no such fact ${id}`);
    const prev = this.snap.facts[idx] as FactRow;
    if (prev.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `fact ${id} is already superseded; supersession columns are set-once`,
      );
    }
    const [newId, nextIds] = this.mint("fact");
    const next: FactRow = {
      id: newId,
      statement: replacement.statement,
      evidence: replacement.evidence,
      established_ts: replacement.established_ts,
      session_id: replacement.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    const superseded: FactRow = {
      ...prev,
      superseded_by: newId,
      superseded_at: at,
      supersede_reason: reason,
    };
    const facts = [...this.snap.facts];
    facts[idx] = superseded;
    facts.push(next);
    this.flush({ ...this.snap, nextIds, facts });
    return { superseded, replacement: next };
  }

  supersedeMeasurement(
    id: number,
    replacement: NewMeasurement,
    reason: string | null,
    at: string,
  ): SupersedeResult<MeasurementRow> {
    const idx = this.snap.measurements.findIndex((m) => m.id === id);
    if (idx < 0) raise("invalid_argument", `no such measurement ${id}`);
    const prev = this.snap.measurements[idx] as MeasurementRow;
    if (prev.superseded_by !== null) {
      raise(
        "supersession_incomplete",
        `measurement ${id} is already superseded; supersession columns are set-once`,
      );
    }
    const [newId, nextIds] = this.mint("measurement");
    const next: MeasurementRow = {
      id: newId,
      metric: replacement.metric,
      value: replacement.value,
      value_num: replacement.value_num,
      command: replacement.command,
      measured_ts: replacement.measured_ts,
      measured_sha: replacement.measured_sha,
      scope_paths: replacement.scope_paths,
      session_id: replacement.session_id,
      superseded_by: null,
      superseded_at: null,
      supersede_reason: null,
    };
    const superseded: MeasurementRow = {
      ...prev,
      superseded_by: newId,
      superseded_at: at,
      supersede_reason: reason,
    };
    const measurements = [...this.snap.measurements];
    measurements[idx] = superseded;
    measurements.push(next);
    this.flush({ ...this.snap, nextIds, measurements });
    return { superseded, replacement: next };
  }

  importSnapshot(snapshot: SessionSnapshot, opts: ImportOptions = {}): number {
    assertIntegrity(snapshot);
    if (snapshot.modelVersion !== this.modelVersion) {
      raise(
        "model_version_unsupported",
        `snapshot model version ${snapshot.modelVersion} != store ${this.modelVersion}`,
      );
    }
    const occupied =
      this.snap.sessions.length > 0 ||
      this.snap.facts.length > 0 ||
      this.snap.measurements.length > 0 ||
      this.snap.obligations.length > 0;
    if (occupied && !(opts.force ?? false)) {
      raise("store_not_empty", "target store already has rows; pass force to replace it");
    }
    if (occupied && (opts.onIdCollision ?? "refuse") === "remap") {
      raise(
        "invalid_argument",
        "remap id-collision policy is not implemented; import into an empty store",
      );
    }
    this.flush(snapshot);
    let n = 0;
    for (const k of COUNTED_KINDS) n += this.snap[
      k === "fact" ? "facts" : k === "measurement" ? "measurements" : "obligations"
    ].length;
    return n + this.snap.sessions.length;
  }

  close(): void {
    this.closed = true;
  }
}

export function openFilesOnlySession(dir: string): FilesOnlySessionStore {
  return new FilesOnlySessionStore(join(dir, "session.ndjson"));
}
```

- [ ] **Step 4: Run the conformance suite against files-only**

Run: `npx tsx --test packages/session-store/src/files-only.test.ts`

Expected: PASS, `report.results.length === ALL_CASES.length`.

If any case fails, the failure is information: either files-only is wrong, or
the case encodes a SQLite assumption that leaked into the port. Fix whichever it
is — do not weaken the case.

- [ ] **Step 5: Export it**

In `packages/session-store/src/index.ts`, add after the `sqlite-store` export
block:

```typescript
export {
  FilesOnlySessionStore,
  openFilesOnlySession,
} from "./files-only.js";
```

- [ ] **Step 6: Typecheck and run both suites**

Run: `npm run typecheck && npx tsx --test packages/session-store/src/*.test.ts`

Expected: 0 type errors; both `contract.test.ts` and `files-only.test.ts` pass.

- [ ] **Step 7: Check modes, then commit**

```bash
git ls-files -s packages/session-store | grep -v '^100644' || echo "modes clean"
git add packages/session-store
git commit -m "feat: add FilesOnlySessionStore as the second port implementation"
```

---

## Task 3: Negative control

A green suite currently proves only that it ran. `graph-store` has `stubFactory`
for exactly this reason.

**Files:**

- Create: `packages/session-store/src/broken-store.ts`
- Modify: `packages/session-store/src/contract-suite.ts`
- Modify: `packages/session-store/src/contract.test.ts`

**Interfaces:**

- Consumes: `SessionStore`, `SqliteSessionStore`.
- Produces: `brokenFactory: StoreFactory`, `CASE_CATEGORY: Record<string, string>`,
  `failedCategories(report): Set<string>`, `MIN_INDEPENDENT_BROKEN_CATEGORIES = 3`.

- [ ] **Step 1: Write the failing test**

Add to `packages/session-store/src/contract.test.ts`:

```typescript
import {
  brokenFactory,
  failedCategories,
  MIN_INDEPENDENT_BROKEN_CATEGORIES,
} from "./contract-suite.js";

describe("negative control", () => {
  it("fails the deliberately broken store for multiple independent reasons", () => {
    const report = runSuite(brokenFactory);
    assert.equal(report.ok, false, "the broken store must not pass the suite");
    const cats = failedCategories(report);
    assert.ok(
      cats.size >= MIN_INDEPENDENT_BROKEN_CATEGORIES,
      `expected >= ${MIN_INDEPENDENT_BROKEN_CATEGORIES} independent failure categories, got ${cats.size}: ${[...cats].join(", ")}`,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test packages/session-store/src/contract.test.ts`

Expected: FAIL — `brokenFactory` is not exported.

- [ ] **Step 3: Implement the broken store**

Create `packages/session-store/src/broken-store.ts`. Each defect is independent,
so a suite that catches only one is still measurably weak.

```typescript
/**
 * Deliberately broken SessionStore. The suite's negative control.
 *
 * Four independent defects, each a real failure mode a careless second
 * implementation would exhibit:
 *   1. ids restart from 1 instead of advancing (identity)
 *   2. supersession columns are not set-once (supersession)
 *   3. rows are returned in insertion order, not declared order (ordering)
 *   4. non-finite value_num is accepted (validation)
 */

import { SqliteSessionStore, openMemoryStore } from "./sqlite-store.js";
import type { NewMeasurement, SessionStore, SupersedeResult } from "./port.js";
import type { CountedKind, FactRow, MeasurementRow } from "./entities.js";
import type { NewFact } from "./port.js";

export class BrokenSessionStore implements SessionStore {
  private readonly inner: SqliteSessionStore;
  readonly modelVersion: number;

  constructor() {
    this.inner = openMemoryStore();
    this.modelVersion = this.inner.modelVersion;
  }

  // Defect 1: identity never advances.
  peekNextId(_kind: CountedKind): number {
    return 1;
  }

  // Defect 4: accepts non-finite values.
  addMeasurement(m: NewMeasurement): MeasurementRow {
    const safe = Number.isFinite(m.value_num ?? 0) ? m : { ...m, value_num: null };
    return this.inner.addMeasurement(safe);
  }

  // Defect 2: supersession is not set-once — supersede twice silently succeeds.
  supersedeFact(
    id: number,
    replacement: NewFact,
    reason: string | null,
    at: string,
  ): SupersedeResult<FactRow> {
    try {
      return this.inner.supersedeFact(id, replacement, reason, at);
    } catch {
      const row = this.inner.addFact(replacement);
      return { superseded: row, replacement: row };
    }
  }

  // Defect 3: reverses declared order.
  listFacts(): readonly FactRow[] {
    return [...this.inner.listFacts()].reverse();
  }

  snapshot() {
    const s = this.inner.snapshot();
    return { ...s, facts: [...s.facts].reverse() };
  }

  listSessions() {
    return this.inner.listSessions();
  }
  listMeasurements() {
    return this.inner.listMeasurements();
  }
  listObligations() {
    return this.inner.listObligations();
  }
  currentSession() {
    return this.inner.currentSession();
  }
  beginSession(a: Parameters<SessionStore["beginSession"]>[0]) {
    return this.inner.beginSession(a);
  }
  endSession(a: string, b: string) {
    return this.inner.endSession(a, b);
  }
  addFact(f: NewFact) {
    return this.inner.addFact(f);
  }
  addObligation(o: Parameters<SessionStore["addObligation"]>[0]) {
    return this.inner.addObligation(o);
  }
  closeObligation(
    id: number,
    status: Parameters<SessionStore["closeObligation"]>[1],
    ts: string,
  ) {
    return this.inner.closeObligation(id, status, ts);
  }
  supersedeMeasurement(
    id: number,
    r: NewMeasurement,
    reason: string | null,
    at: string,
  ) {
    return this.inner.supersedeMeasurement(id, r, reason, at);
  }
  importSnapshot(
    s: Parameters<SessionStore["importSnapshot"]>[0],
    o?: Parameters<SessionStore["importSnapshot"]>[1],
  ) {
    return this.inner.importSnapshot(s, o);
  }
  close() {
    this.inner.close();
  }
}
```

- [ ] **Step 4: Tag cases with categories and export the factory**

In `packages/session-store/src/contract-suite.ts`, add after the `ALL_CASES`
declaration:

```typescript
import { BrokenSessionStore } from "./broken-store.js";

export const MIN_INDEPENDENT_BROKEN_CATEGORIES = 3;

/** Which independent property each case exercises. */
export const CASE_CATEGORY: Readonly<Record<string, string>> = {
  "roundtrip/empty-store": "roundtrip",
  "roundtrip/populated-store": "roundtrip",
  "roundtrip/import-of-export-is-equal": "roundtrip",
  "encoding/byte-stable-across-repeated-encodes": "encoding",
  "encoding/ends-with-exactly-one-newline": "encoding",
  "identity/ids-are-port-minted-and-advance": "identity",
  "identity/allocation-state-round-trips": "identity",
  "supersession/set-once": "supersession",
  "obligation/close-is-once-only": "obligation",
  "write/rejects-non-finite-value-num": "validation",
  "import/refuses-non-empty-store-without-force": "import",
  "import/newer-model-version-refused-without-mutation": "import",
};

export function failedCategories(report: SuiteReport): Set<string> {
  const out = new Set<string>();
  for (const r of report.results) {
    if (r.passed) continue;
    out.add(CASE_CATEGORY[r.name] ?? "hostile");
  }
  return out;
}

export const brokenFactory: StoreFactory = () => new BrokenSessionStore();
```

- [ ] **Step 5: Run the negative control**

Run: `npx tsx --test packages/session-store/src/contract.test.ts`

Expected: PASS. The broken store fails in at least 3 independent categories. If
it fails in fewer, the suite is weaker than it looks and needs cases added —
that is the finding, and it is worth having.

- [ ] **Step 6: Check modes, then commit**

```bash
git ls-files -s packages/session-store | grep -v '^100644' || echo "modes clean"
git add packages/session-store
git commit -m "test: add the conformance suite's negative control"
```

---

## Task 4: Backend factory

**Files:**

- Create: `packages/session-store/src/open.ts`
- Create: `packages/session-store/src/open.test.ts`
- Modify: `packages/session-store/src/index.ts`

**Interfaces:**

- Consumes: `SqliteSessionStore.open`, `openFilesOnlySession`.
- Produces: `openSessionStore(opts?: { backend?: string; path?: string }): SessionStore`.
  Task 5's CLI calls this and never names a backend.

- [ ] **Step 1: Write the failing test**

Create `packages/session-store/src/open.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { openSessionStore } from "./open.js";

describe("backend factory", () => {
  it("defaults to sqlite", () => {
    const d = mkdtempSync(join(tmpdir(), "fm-open-"));
    try {
      const s = openSessionStore({ path: join(d, "session.db") });
      assert.equal(s.constructor.name, "SqliteSessionStore");
      s.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("selects files-only when asked", () => {
    const d = mkdtempSync(join(tmpdir(), "fm-open-"));
    try {
      const s = openSessionStore({ backend: "files", path: d });
      assert.equal(s.constructor.name, "FilesOnlySessionStore");
      s.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("refuses an unknown backend by name", () => {
    assert.throws(
      () => openSessionStore({ backend: "postgres", path: "/tmp/x" }),
      /unknown session backend "postgres"; known: files, sqlite/,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test packages/session-store/src/open.test.ts`

Expected: FAIL — `Cannot find module './open.js'`.

- [ ] **Step 3: Implement the factory**

Create `packages/session-store/src/open.ts`:

```typescript
/**
 * The single point at which a backend is selected. The CLI never names one.
 */

import { openFilesOnlySession } from "./files-only.js";
import { raise } from "./failures.js";
import type { SessionStore } from "./port.js";
import { SqliteSessionStore } from "./sqlite-store.js";

export const KNOWN_BACKENDS = ["files", "sqlite"] as const;
export type BackendName = (typeof KNOWN_BACKENDS)[number];

export function openSessionStore(opts: {
  readonly backend?: string | undefined;
  readonly path: string;
}): SessionStore {
  const name = (opts.backend ?? process.env["FOREMAN_SESSION_BACKEND"] ?? "sqlite").trim();
  if (!(KNOWN_BACKENDS as readonly string[]).includes(name)) {
    raise(
      "invalid_argument",
      `unknown session backend ${JSON.stringify(name)}; known: ${KNOWN_BACKENDS.join(", ")}`,
    );
  }
  return name === "files"
    ? openFilesOnlySession(opts.path)
    : SqliteSessionStore.open(opts.path);
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx --test packages/session-store/src/open.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Export and commit**

Add to `packages/session-store/src/index.ts`:

```typescript
export { openSessionStore, KNOWN_BACKENDS, type BackendName } from "./open.js";
```

```bash
npm run typecheck
git ls-files -s packages/session-store | grep -v '^100644' || echo "modes clean"
git add packages/session-store
git commit -m "feat: add the session backend factory"
```

---

## Task 5: Migrate fm-session onto the port

The risky task. It is last among the build tasks because Tasks 1-4 make it safe.

**Files:**

- Modify: `packages/orchestration/src/fm-session-main.ts`
- Modify: `packages/orchestration/package.json` (add `@foreman/session-store` dep)

**Interfaces:**

- Consumes: `openSessionStore` from `@foreman/session-store`.
- Produces: no new exports. The CLI's stdout, stderr and exit codes are
  unchanged, which is exactly what Task 1's golden asserts.

- [ ] **Step 1: Add the dependency**

In `packages/orchestration/package.json`, add to `dependencies`:

```json
"@foreman/session-store": "0.3.1"
```

Add to `packages/orchestration/tsconfig.json` `references`:

```json
{ "path": "../session-store" }
```

- [ ] **Step 2: Confirm the golden is green before you change anything**

Run:

```bash
npm run build
npx bats tests/session-golden.bats tests/session.bats
```

Expected: golden 2/2, session 29/29. This is your baseline. If it is not green
now, stop — you cannot attribute a later failure to your change.

- [ ] **Step 3: Replace the store layer, one command at a time**

Work through the commands in this order, because each depends only on those
before it: `recover`, `freshness`, `sidecar`, `begin`, `end`, `fact`, `measure`,
`obligation`, `close`, `supersede`, `retire`, `import-sidecar`.

For each command, replace its direct `conn.prepare(...)` calls with port calls.
The connection helpers `connect`, `connectReadonly` and `dbPath` collapse into
one factory call:

```typescript
import { openSessionStore } from "@foreman/session-store";

function openStore() {
  return openSessionStore({ path: dbPath() });
}
```

Read paths become port reads. For example `currentSession` becomes:

```typescript
const store = openStore();
const current = store.currentSession();
```

Write paths become port writes. For example the `fact` command becomes:

```typescript
const row = store.addFact({
  statement,
  evidence: parsed.options.evidence ?? null,
  established_ts: nowIso(),
  session_id: currentSessionId,
});
```

- [ ] **Step 4: After EACH command, run both suites**

Run: `npm run build && npx bats tests/session-golden.bats tests/session.bats`

Expected: golden 2/2 and session 29/29, after every single command.

Do not proceed to the next command while either is red. A golden mismatch prints
the exact expected and actual stdout; the difference is your defect, not the
oracle's.

- [ ] **Step 5: Remove the type suppression**

Delete the `// @ts-nocheck` on line 1 of `fm-session-main.ts` and fix every
error the compiler now reports.

Run: `npm run typecheck`

Expected: 0 errors.

- [ ] **Step 6: Verify no direct backend access remains**

Run:

```bash
grep -rn "node:sqlite" packages/*/src | grep -v "packages/session-store/src"
```

Expected: no output. This is exit predicate 1.

- [ ] **Step 7: Run the full gate, check modes, commit**

```bash
npm run typecheck && npm test
npx bats tests/session-golden.bats tests/session.bats
git ls-files -s packages/orchestration packages/session-store | grep -v '^100644' || echo "modes clean"
git add packages/orchestration packages/session-store
git commit -m "refactor: run fm-session on the SessionStore port"
```

---

## Task 6: fm-session sync and remap

**Files:**

- Create: `packages/orchestration/src/fm-session-sync.ts`
- Create: `packages/orchestration/src/fm-session-sync.test.ts`
- Modify: `packages/session-store/src/sqlite-store.ts`
- Modify: `packages/session-store/src/port.ts`
- Modify: `scripts/build-runtime.ts`

**Interfaces:**

- Consumes: `SessionStore`, `MemoryIndex`, `buildProjection`.
- Produces: `syncOutbox(store, index): Promise<{ delivered: number; retried: number }>`
  and `OutboxRow = { key: string; kind: CountedKind; entity_id: number; mutation: string; queued_ts: string }`.

- [ ] **Step 1: Write the failing exactly-once test**

Create `packages/orchestration/src/fm-session-sync.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openMemoryStore } from "@foreman/session-store";
import type { MemoryIndex, ProjectionRecord, EntityRef } from "@foreman/session-store";
import { syncOutbox } from "./fm-session-sync.js";

/** Fails the first delivery of each key, then succeeds. Records every call. */
class FlakyIndex implements MemoryIndex {
  readonly name = "flaky";
  readonly seen: string[] = [];
  private failed = new Set<string>();
  async project(records: readonly ProjectionRecord[]): Promise<void> {
    for (const r of records) {
      this.seen.push(r.key);
      if (!this.failed.has(r.key)) {
        this.failed.add(r.key);
        throw new Error("transient");
      }
    }
  }
  async recall(): Promise<readonly EntityRef[]> {
    return [];
  }
  async beginEpoch(): Promise<string> {
    return "e1";
  }
  async activateEpoch(): Promise<void> {}
}

describe("fm-session sync", () => {
  it("delivers each outbox key exactly once despite retries", async () => {
    const store = openMemoryStore();
    try {
      store.beginSession({
        session_id: "S1",
        started_ts: "2026-08-08T10:00:00Z",
        start_sha: null,
        note: null,
      });
      store.addFact({
        statement: "one",
        evidence: null,
        established_ts: "2026-08-08T10:01:00Z",
        session_id: "S1",
      });
      const index = new FlakyIndex();
      const r = await syncOutbox(store, index);
      assert.ok(r.retried > 0, "expected at least one retry");
      const unique = new Set(index.seen);
      assert.equal(
        unique.size,
        1,
        `expected 1 distinct key delivered, saw ${[...unique].join(", ")}`,
      );
      const second = await syncOutbox(store, index);
      assert.equal(second.delivered, 0, "a drained outbox must deliver nothing");
    } finally {
      store.close();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test packages/orchestration/src/fm-session-sync.test.ts`

Expected: FAIL — `Cannot find module './fm-session-sync.js'`.

- [ ] **Step 3: Expose the outbox on the port**

Add to `packages/session-store/src/port.ts`:

```typescript
export type OutboxRow = {
  readonly key: string;
  readonly kind: CountedKind;
  readonly entity_id: number;
  readonly mutation: string;
  readonly queued_ts: string;
};
```

Add to the `SessionStore` interface:

```typescript
  /** Projection bookkeeping. Only the projector may call these. */
  listOutbox(): readonly OutboxRow[];
  clearOutboxKeys(keys: readonly string[]): void;
```

Implement in `sqlite-store.ts`:

```typescript
  listOutbox(): readonly OutboxRow[] {
    return this.db
      .prepare(
        "SELECT key, kind, entity_id, mutation, queued_ts FROM memory_outbox ORDER BY queued_ts, key",
      )
      .all() as unknown as readonly OutboxRow[];
  }

  clearOutboxKeys(keys: readonly string[]): void {
    if (keys.length === 0) return;
    this.tx(() => {
      const stmt = this.db.prepare("DELETE FROM memory_outbox WHERE key = ?");
      for (const k of keys) stmt.run(k);
    });
  }
```

Implement in `files-only.ts` (files-only has no outbox; it is honest about that):

```typescript
  listOutbox(): readonly OutboxRow[] {
    return [];
  }

  clearOutboxKeys(_keys: readonly string[]): void {}
```

- [ ] **Step 4: Implement the drain**

Create `packages/orchestration/src/fm-session-sync.ts`:

```typescript
/**
 * Drains memory_outbox into a MemoryIndex.
 *
 * The only code permitted to read the outbox. Delivery is keyed by the outbox
 * key, so a retry after a timeout cannot double-write, and a key is cleared
 * only after its delivery is acknowledged.
 */

import {
  buildProjection,
  type MemoryIndex,
  type OutboxRow,
  type ProjectionRecord,
  type SessionStore,
} from "@foreman/session-store";

export const MAX_ATTEMPTS = 3;

export async function syncOutbox(
  store: SessionStore,
  index: MemoryIndex,
): Promise<{ delivered: number; retried: number }> {
  const pending: readonly OutboxRow[] = store.listOutbox();
  if (pending.length === 0) return { delivered: 0, retried: 0 };

  const byKey = new Map<string, ProjectionRecord>();
  for (const rec of buildProjection(store.snapshot())) byKey.set(rec.key, rec);

  const done: string[] = [];
  let retried = 0;

  for (const row of pending) {
    const rec = byKey.get(row.key);
    if (!rec) {
      // The entity was superseded or retracted; nothing to project. Clear it.
      done.push(row.key);
      continue;
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await index.project([rec]);
        done.push(row.key);
        break;
      } catch {
        retried++;
        if (attempt === MAX_ATTEMPTS) break;
      }
    }
  }

  store.clearOutboxKeys(done);
  return { delivered: done.length, retried };
}
```

- [ ] **Step 5: Run the test**

Run: `npx tsx --test packages/orchestration/src/fm-session-sync.test.ts`

Expected: PASS. One distinct key delivered, at least one retry, second drain
delivers 0.

- [ ] **Step 6: Implement remap**

In `sqlite-store.ts` `importSnapshot`, replace the `remap` refusal. When the
target is occupied and the policy is `remap`, offset every imported id past the
target's watermark and rewrite `superseded_by` with the same offset:

```typescript
      if (occupied && policy === "remap") {
        const offset: Record<string, number> = {};
        for (const kind of COUNTED_KINDS) {
          offset[kind] = this.peekNextId(kind) - 1;
        }
        snapshot = remapIds(snapshot, offset);
      }
```

Add the pure helper to `packages/session-store/src/integrity.ts`:

```typescript
/** Shift every id and superseded_by pointer by a per-kind offset. */
export function remapIds(
  snapshot: SessionSnapshot,
  offset: Readonly<Record<string, number>>,
): SessionSnapshot {
  const shift = (kind: string, v: unknown): unknown =>
    typeof v === "number" ? v + (offset[kind] ?? 0) : v;
  const mapRows = (kind: CountedKind, rows: readonly Record<string, unknown>[]) =>
    rows.map((r) => ({
      ...r,
      id: shift(kind, r["id"]),
      superseded_by: r["superseded_by"] === null ? null : shift(kind, r["superseded_by"]),
    }));
  const nextIds = { ...snapshot.nextIds } as Record<string, number>;
  for (const k of COUNTED_KINDS) nextIds[k] = (nextIds[k] ?? 1) + (offset[k] ?? 0);
  return {
    ...snapshot,
    nextIds: nextIds as unknown as NextIds,
    facts: mapRows("fact", snapshot.facts as never) as never,
    measurements: mapRows("measurement", snapshot.measurements as never) as never,
    obligations: mapRows("obligation", snapshot.obligations as never) as never,
  };
}
```

- [ ] **Step 7: Add the remap conformance case**

In `contract-suite.ts` `CASES`, add:

```typescript
  {
    name: "import/remap-rewrites-supersession-pointers",
    run: (f) => {
      const a = f();
      const b = f();
      try {
        seedFixture(a);
        seedFixture(b);
        const before = b.listFacts().length;
        const n = b.importSnapshot(a.snapshot(), { force: true, onIdCollision: "remap" });
        assert(n > 0, "remap import wrote nothing");
        for (const row of b.listFacts()) {
          if (row.superseded_by === null) continue;
          assert(
            b.listFacts().some((x) => x.id === row.superseded_by),
            `remap left a dangling superseded_by ${row.superseded_by}`,
          );
        }
        assert(before >= 0, "sanity");
      } finally {
        a.close();
        b.close();
      }
    },
  },
```

Add its category to `CASE_CATEGORY`:

```typescript
  "import/remap-rewrites-supersession-pointers": "import",
```

- [ ] **Step 8: Wire the bundle entry**

In `scripts/build-runtime.ts`, add to the entries array:

```typescript
  {
    name: "fm-session-sync",
    entry: join(root, "packages/orchestration/src/fm-session-sync.ts"),
  },
```

- [ ] **Step 9: Run everything, check modes, commit**

```bash
npm run typecheck && npm test && npm run build
npx bats tests/session-golden.bats tests/session.bats
git ls-files -s packages/orchestration packages/session-store scripts | grep -v '^100644' || echo "modes clean"
git add packages/orchestration packages/session-store scripts
git commit -m "feat: add fm-session sync and the remap id-collision policy"
```

---

## Task 7: Measure the exit predicates

**Files:**

- Create: `docs/releases/v0.3.1-predicates.md`

**Interfaces:**

- Consumes: everything above.
- Produces: the release evidence record.

- [ ] **Step 1: Measure all six on one commit**

Run each and record verbatim output:

```bash
# 1 no direct backend access outside the port
grep -rn "node:sqlite" packages/*/src | grep -v "packages/session-store/src" || echo "PASS: none"

# 2 CLI behaviour unchanged
npm run build && npx bats tests/session-golden.bats tests/session.bats

# 3 contract portable
npx tsx --test packages/session-store/src/contract.test.ts packages/session-store/src/files-only.test.ts

# 4 correctness independent of projection
npx tsx --test packages/session-store/src/contract.test.ts

# 5 migration complete
grep -c "@ts-nocheck" packages/orchestration/src/fm-session-main.ts || echo "PASS: 0"

# 6 outbox exactly-once
npx tsx --test packages/orchestration/src/fm-session-sync.test.ts
```

- [ ] **Step 2: Write the predicate record**

Create `docs/releases/v0.3.1-predicates.md` with a row per predicate: the
predicate, the verdict, the exact command, and its verbatim output. Record any
predicate you could not measure as **UNVERIFIED** and name what would settle it.
Never translate a missing measurement into a pass.

- [ ] **Step 3: Run the QA preflight and commit**

```bash
# Follow plugins/foreman-qa/commands/foreman-qa-preflight.md, all six steps.
bash skills/foreman/scripts/docs-check.sh
git ls-files -s docs/releases | grep -v '^100644' || echo "modes clean"
git add docs/releases/v0.3.1-predicates.md
git commit -m "docs: record the v0.3.1 exit predicate measurements"
```

---

## Self-review notes

Spec coverage checked against `2026-08-08-v031-release-design.md`:

| Spec item | Task |
|---|---|
| Predicate 1 no direct backend access | 5 step 6, 7 |
| Predicate 2 CLI unchanged | 1, 5 step 4, 7 |
| Predicate 3 contract portable | 2, 7 |
| Predicate 4 projection independence | 3, 7 |
| Predicate 5 no `@ts-nocheck` | 5 step 5, 7 |
| Predicate 6 outbox exactly-once | 6, 7 |
| `FilesOnlySessionStore` | 2 |
| Backend factory | 4 |
| `fm-session sync` | 6 |
| `remap` policy | 6 |
| `session-golden.bats` | 1 |
| Negative control | 3 |

Dogfooding is carried in Global Constraints (QA preflight per task, AGENT_TRAPS
before lane dispatch, mode checks) rather than as separate tasks, because it
governs how every task is executed rather than being a deliverable of any one.

Council review of each task's diff and SessionDB recording of release facts are
orchestration concerns for the executing session, not steps an implementer
performs inside a task.
