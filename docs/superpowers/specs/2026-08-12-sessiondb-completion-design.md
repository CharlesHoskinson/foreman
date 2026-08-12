# SessionDB Completion Design

> Status: approved for planning. Amends
> `docs/superpowers/plans/2026-08-11-sessiondb-port-unification.md` Tasks 6 and 7
> and inserts two work items around them. The design in
> `docs/superpowers/specs/2026-08-11-sessiondb-port-unification-design.md` still
> governs everything it already decided; this document does not reopen any of it.

**Goal:** finish the cutover. `@foreman/session-store` becomes the only
SessionDB, `fm-session-main.ts` becomes a thin CLI over the port with no
`node:sqlite` import and no `// @ts-nocheck`, and the four v0.3.1 exit
predicates are provable rather than approximately true.

## Where the work actually stands

Tasks 1 through 6a are committed on `design/sessiondb-port-unification` (draft
PR #45, 17 commits, zero behind `main`). Measured against the tree rather than
the plan's checkboxes, which are all still unticked and are therefore not a
status signal:

```console
$ head -3 packages/orchestration/src/fm-session-main.ts
// @ts-nocheck
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

$ wc -l packages/orchestration/src/fm-session-main.ts
797 packages/orchestration/src/fm-session-main.ts

$ grep -n 'BACKEND\|FM_SESSION_CMD' packages/orchestration/src/fm-session-main.ts
(no output)
```

Task 6a already moved bootstrap, sidecar ownership and id minting onto the port.
What remains on raw SQL is the command bodies: `begin`, `end`, `fact`, `measure`,
`obligation`, `close`, `supersede`, `retire`, and the `recover` / `freshness`
read paths.

## Four defects in the existing plan

Each was found by reading the tree against the plan, and each changes what the
remaining tasks must do.

### 1. `retire` has no port equivalent

The CLI's `retire <id> --by <existingId>` points one **existing** measurement at
another **existing** one (`fm-session-main.ts:749`). The port's
`supersedeMeasurement(id, replacement: NewMeasurement, reason, at)` always
**inserts** a replacement (`sqlite-store.ts:568`). No port method links two rows
that both already exist.

Task 6 Step 4 as written — "route it through `store.supersedeFact` and
`store.supersedeMeasurement`" — cannot express `retire`. If `retire` stays on
raw SQL, Task 7 predicate 1 cannot pass.

This is the operation the design's own headline evidence depends on. Measurement
17 is named by predecessors 1, 8, 14 and 15; that is four `retire --by 17` calls
onto a row that already existed.

A second asymmetry the plan does not record: `retire` **already** validates both
ids and refuses a superseded superseder (`:731-748`). The phantom-insert defect
lives only in `supersede` for facts (`:706-719`), which has no existence check at
all.

### 2. The seam variable name is already taken

Task 6 Step 1 proposes:

```ts
const BACKEND = process.env["FM_SESSION_CMD"] === "port" ? "port" : "legacy";
```

`FM_SESSION_CMD` already means something else. It holds the **invocation
command**:

```bash
# tests/session.bats:13
SESS="${FM_SESSION_CMD:-node $SCRIPTS/../runtime/dist/fm-session.js}"
```

It is also named in v0.3.0 exit predicate 3 (`ROADMAP.md:32`). As written the
seam reads false under the entire Bats suite, so the suite would measure the
legacy path while appearing to exercise the port. After Step 7's flip
(`=== "legacy" ? "legacy" : "port"`) the same suite would silently switch to the
port. Both directions are wrong, and a golden run cannot see either.

### 3. The plan's line references predate Task 6a

Task 6's worked example replaces an `INSERT INTO facts(statement,…)` and reads
`res.lastInsertRowid`. The tree now mints an explicit id first
(`mintId(conn, "fact")`, `:621-623`). `supersede` is at `:706`, not `:690`.
Follow the plan's steps; do not trust its line numbers.

### 4. Predicate 1 is unprovable as written

Task 7 Step 4 expects `grep -rn "node:sqlite" packages/*/src | grep -v
session-store` to return "no output except possibly test files". Two test files
import `DatabaseSync` today, so the predicate has no pass condition.

## Design

### W0 — Re-review Task 6a, blocking

`913a9d0` is committed but unreviewed: its review died on an internal error. The
eight Minor findings PR #45 attributes to "the plan's ledger" exist nowhere —
not in the plan, not in the PR body, and PR #45 carries zero reviews and zero
review comments. They are treated as lost and re-derived from the diff, not
hunted for.

Follow `plugins/foreman-qa/commands/foreman-qa-review.md`: hand the
`foreman-qa-reviewer` doctrine the complete diff, the `git ls-files -s` mode
listing, and the exact `docs-check.sh` output. Relay findings verbatim.

This blocks W1 through W3. Task 6a changed bootstrap, sidecar ownership, id
minting and `integrity.ts` — every golden recorded after it is anchored to that
baseline, and a defect found later would be buried under eight more steps.

### W1 — `retireMeasurement` on the port

Its own commit, before Task 6, because Task 6 consumes it and it carries its own
evidence.

```ts
// port.ts, SessionStore
/**
 * Mark `id` superseded by the ALREADY EXISTING measurement `byId`.
 *
 * Distinct from supersedeMeasurement, which inserts a replacement. A fresh
 * full-suite reading retires several stale ones, so fan-in onto `byId` is
 * legal: N rows may name the same successor.
 */
retireMeasurement(
  id: number,
  byId: number,
  reason: string | null,
  at: string,
): MeasurementRow;
```

One transaction, five refusals:

| Condition | Reason |
| --- | --- |
| no measurement `id` | `invalid_argument` |
| no measurement `byId` | `invalid_argument` |
| `byId === id` | `invalid_argument` |
| `id` already superseded | `supersession_incomplete` (set-once) |
| `byId` itself superseded | `invalid_argument` |

On success it sets the supersession triple on `id`, queues a `retract`
projection for `id`, and returns the updated row. Fan-in onto `byId` is
allowed and is asserted, not merely permitted.

It returns a bare `MeasurementRow` rather than `SupersedeResult<MeasurementRow>`
because no replacement is created. A `replacement` field holding a row that
already existed and was never touched would be false in the type.

New conformance cases are **added** to `contract-suite.ts`. The existing 28 stay
unedited; that they need no editing is still the point of the exercise.

### W2 — Task 6, the cutover

The plan's eight steps stand, with three amendments.

**The seam is `FM_SESSION_BACKEND`.** A distinct variable, so
`tests/session.bats` keeps `FM_SESSION_CMD` meaning what it has always meant and
v0.3.0 predicate 3 stays intact.

```ts
/**
 * Which store backs the CLI. Deliberately NOT FM_SESSION_CMD: that variable
 * holds the invocation command (tests/session.bats:13) and is named in v0.3.0
 * exit predicate 3. Defaults to legacy until every command is migrated, so a
 * half-finished migration cannot ship silently.
 */
const BACKEND = process.env["FM_SESSION_BACKEND"] === "port" ? "port" : "legacy";
```

**Step 4 routes `retire` through `retireMeasurement`,** not
`supersedeMeasurement`.

**Error-message mapping is a component, not a detail.** `retire` has no recorded
defect, so its migration must be output-neutral — and the port raises
`SessionStoreError` with its own messages, which are not the CLI's. Every
command whose behaviour is not deliberately changing maps port failures back to
its exact legacy stderr text and exit code, using the `isSessionStoreFailure`
and `reasonOf` helpers the port already exports. Exactly two commands change
output deliberately: `supersede` for facts, and `close`.

**Store lifecycle:** one port instance per invocation, opened after
`bootstrapStore` and closed in a `finally`, behind a single `openStore()` helper
replacing `connect()`. Not opened per command as the plan's example shows — that
re-bootstraps on every call and leaves the end-of-run sidecar refresh opening a
third connection to the same file.

`recover` and `freshness` filter and order in TypeScript over `listFacts()`,
`listMeasurements()`, `listObligations()` and `currentSession()`. `currentSession()`
is a direct swap: the port's query is already
`WHERE ended_ts IS NULL ORDER BY session_id DESC LIMIT 1`, identical to the
CLI's.

### W3 — Task 7, the deletion

Delete the seam, the legacy branches, the `DatabaseSync` import, the embedded
schema constants, and `mintId` — which becomes dead once every write command
moves, since those commands are its only callers. Remove `// @ts-nocheck` and
fix what the type checker then finds, without `any` and without re-adding the
suppression.

Predicate 1 is restated so it has a pass condition:

```bash
grep -rn "node:sqlite" packages/*/src --include='*.ts' | grep -v session-store | grep -v '\.test\.ts'
```

Expected: no output. Test files are exempt by design, and the exemption is
recorded rather than assumed: a test that verifies a legacy-shaped database, or
the port's own schema against the declared model, must inspect raw SQLite. A
test forbidden from doing so could not discriminate the thing it exists to
check.

### W4 — Trap and obligation debt

Three traps observed while surveying this branch go into `AGENT_TRAPS.md` § 1,
symptom first, as the footguns skill and QA preflight step 6 both require:

- `FM_SESSION_CMD` carries the invocation command, not a backend selector. A
  seam keyed on it reads false under the whole Bats suite while every golden
  stays green.
- `secret-scan.test.ts` refuses the worktree with `bound_exceeded` when any file
  exceeds `MAX_FILE_BYTES` (16 MB), because the scan walks the raw filesystem
  and prunes only `.git` and `.harness`. A 94 MB `launcher/dist/foreman-launch`
  is gitignored and still fails the test. The scan's `.gitignore` blindness is
  deliberate — shell parity — so this recurs after every launcher build.
- graphify's `claude-cli` backend silently forces `max_concurrency = 1` unless
  `GRAPHIFY_CLAUDE_CLI_PARALLEL=1` is set (`llm.py:2327`). A run that requested
  four-way parallelism executes serially and reports nothing unusual.

Two items are recorded as obligations rather than fixed inline, following the
plan's own precedent for the stale `CLAUDE.md` reference:

- `secret-scan`'s scan bounds treat a gitignored build artifact as a corpus
  file, so a green local suite depends on the developer's build state.
- `CLAUDE.md` still instructs agents to run
  `python3 skills/foreman/scripts/fm-session.py recover`. That file was retired
  in `b6e9ed0`.

## Sequencing

Strictly serial: W0 → W1 → W2 → W3. W4 folds into whichever commit surfaces each
item. Nothing parallelises — W1 changes the port W2 consumes, and W3 deletes
what W2 leaves behind.

## Testing

Every check is demonstrated to fail against a known-bad input before it is
trusted. Four defects on this branch were fake verification: a check that
answered a known-bad and a known-good identically.

- Each of W1's five refusals gets a positive case and a mutation test — remove
  the guard, confirm the case fails.
- Fan-in gets its own case: retire three measurements onto one `byId`, then
  `decodeSnapshot` and `assertIntegrity` the resulting sidecar. That shape must
  round-trip or the tracked record becomes unreadable.
- A refusal case for "already superseded" proves nothing against a fixture with
  no superseded row. The seed carries one, asserted.
- Seam reachability is proven by mutation before any golden run is believed: set
  `FM_SESSION_BACKEND` to a wrong value and confirm the goldens **fail**.
  `sanitizedCheckpointEnv` is a `GIT_*`-only denylist
  (`round-live-services.ts:143`) so it should pass through, but a code reading is
  not evidence.
- Goldens run after every single command. `git diff --stat
  packages/orchestration/src/__golden__` must be empty except the two deliberate
  fixtures; unexplained movement reverts rather than re-records.
- The orphan-insert defect is proven closed by row-count invariance plus a
  non-zero exit, on a copy of the live store.
- `bats tests/session.bats` at 29/29 after each write command; `npm run verify`
  and `bats tests/` at W3.

## Risks

- **Working from a worktree does not isolate the live store.** `dbPath()`
  resolves through `repoRoot()`, which is
  `dirname(git rev-parse --git-common-dir)` (`:57`). From a worktree that is the
  base checkout, where the live `session.db` sits. Every manual run pins
  `FOREMAN_SESSION_DB` to a scratch path; nothing rehearses against
  `.foreman/session.db`.
- **`npm test` fails locally on the 94 MB launcher artifact.** Move it aside for
  a full-suite run. Never report that failure as a branch defect — a fresh CI
  checkout does not have the file.
- **Golden churn is the signal.** A fixture that moves for a reason not written
  in the commit message means something migrated wrong.
- **`mintId` deletion.** Confirm by grep that the write commands are its only
  callers before deleting it, rather than assuming.

## Out of scope

Unchanged from the governing design: bi-temporal event-time columns, the dedup
ladder, replaceability scoring, semantic recall through `MemoryIndex`, and
fact-text sanitization, which needs its own threat model.

Also out of scope here: correcting the stale line references throughout
`2026-08-11-sessiondb-port-unification.md`. The steps are sound and the drift is
recorded above; editing a plan mid-execution to fix line numbers risks changing
its meaning.

## Authority

- Governing design:
  `docs/superpowers/specs/2026-08-11-sessiondb-port-unification-design.md`
- Implementation plan being amended:
  `docs/superpowers/plans/2026-08-11-sessiondb-port-unification.md`
- Storage port contract: `docs/architecture/storage-port.md`
- Environment and vendor traps: `AGENT_TRAPS.md`
- QA doctrine: `plugins/foreman-qa/`
