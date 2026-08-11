# SessionDB Port Unification Design

> Status: approved for planning. Supersedes the sidecar assumptions in
> `docs/superpowers/plans/2026-08-08-v031-session-portability.md`.

**Goal:** end with one SessionDB. `@foreman/session-store` becomes the only
implementation. The embedded store inside `packages/orchestration/src/fm-session-main.ts`
is deleted along with its `// @ts-nocheck`, and orchestration becomes a thin CLI
over the port.

## The problem

There are two SessionDBs on `main`, and the designed one is dead code.

| | Live (ships) | Port (designed) |
| --- | --- | --- |
| Location | `packages/orchestration/src/fm-session-main.ts` | `packages/session-store/src/` |
| Size | 775 lines, `// @ts-nocheck` at line 1 | 9 files + a 28-case conformance suite |
| Foreign keys | `OFF` at runtime | `ON` (`sqlite-store.ts:151`) |
| Supersession | INSERT then UPDATE in autocommit, no existence check (`fm-session-main.ts:690-692`) | atomic, set-once, rejects a missing or already-superseded target (`sqlite-store.ts:500`, `:514`, `:547`) |
| Sidecar format | v1 `{table,row}` | v2 `{kind,row}` (`sidecar.ts:243`) |
| Imported by | everything | nothing |

Nothing outside `packages/session-store` imports the port. Only
`fm-session-main.ts:3` and its test import `node:sqlite`. The v0.3.1 exit
predicate "no direct backend access outside the port" therefore fails today.

Because the port already implements the correct behaviour, fixing bugs in the
live file duplicates work that the cutover deletes. The blocker is not design
quality. It is that the port cannot read today's data.

### Four independent breaks

Verified against the live store at `.foreman/session.db` and `.foreman/session.ndjson`:

1. **Sidecar format.** Live header is `{format, format_version: 1}` with records
   `{table, row}`. `parseHeader` raises unless `format_version === 2`
   (`sidecar.ts:175-178`), and `decodeSnapshot` rejects any record whose keys are
   not exactly `kind,row` (`sidecar.ts:243-246`).
2. **Missing header fields.** v1 carries no `session_model_version` and no
   `next_ids`; both are mandatory (`sidecar.ts:179-195`).
3. **Undeclared status value.** Five obligations hold `status='blocked'`, which is
   absent from `OBLIGATION_STATUSES` (`entities.ts:64`).
4. **Counter table.** The live DB has `schema_meta` (version 3); the port expects
   `store_meta` watermarks.

`UPGRADES` (`sidecar.ts:59`) does not solve any of these. It is keyed on the
**model** version and applied to an already-decoded snapshot
(`sidecar.ts:289`), while breaks 1 and 2 are on the **format** axis and abort
decoding before that line is reached. The two version axes are distinct and the
existing plan conflates them.

## Design

### 1. v1 format reader

Add `decodeSnapshotV1(text): SessionSnapshot` to `sidecar.ts` and dispatch on the
header's `format_version` before `parseHeader` asserts its equality check.

- map `table` to `kind` (plural to singular)
- fold `schema_meta` rows into header material rather than entity buckets
- synthesize `session_model_version: 1`
- compute `next_ids[kind]` as `max(id) + 1` over decoded rows, defaulting to 1 for
  an empty kind

Encoding remains v2-only: read both, write one. `UPGRADES` stays empty and
untouched; it serves model evolution, and this change does not evolve the model.

A v1 sidecar is not a historical artifact. The stale Windows checkout at
`C:\Users\charl\foreman` still holds one, and live obligation 24 records that the
installed-plugin junction still points at that checkout. A reader keeps working
for those; a one-shot conversion script would not.

### 2. Model reconciliation

A separate migration with its own before-and-after evidence, because unlike the
reader it mutates rows.

- rewrite the five `blocked` obligations to `status='open'`, retaining `blocker`
- create `store_meta` with watermarks derived from `max(id)` per counted kind
- enable `foreign_keys=ON`

The status rewrite is lossless. In the live data `blocked` holds if and only if
the row is open and carries a blocker, with no overlap:

| status | blocker present | rows |
| --- | --- | --- |
| `blocked` | yes | 5 |
| `open` | no | 19 |
| `done` | no | 10 |

The port's model is the correct one. `blocker` is already a column, so "blocked"
is derived state that the live implementation denormalized into `status`. After
migration it becomes a display-time derivation.

Enabling foreign keys is safe on today's data: both supersession-pointer
integrity queries return zero dangling rows.

### 3. Durability

The port does not inherit these fixes. Verified: it sets no `journal_mode`, no
`busy_timeout` and no `synchronous`, and `sidecar.ts` performs no I/O at all, so
fsync is the caller's responsibility and no caller discharges it.

- set `journal_mode=WAL`, `synchronous=NORMAL` and a non-zero `busy_timeout` when
  the store is opened
- fsync the sidecar before rename

Both matter more than they look. `.gitignore:43` ignores `session.db` while
`.foreman/session.ndjson` is tracked, so the NDJSON is the record that travels
and the SQLite file is a rebuildable cache. The canonical artifact is the one
written without a flush: `writeAtomic` (`fm-session-main.ts:409`) writes and
renames, and `fsyncSync` is imported at line 8 and never called. Concurrent
writers are documented as normal operation in `AGENT_TRAPS.md:22`, so the absence
of WAL and `busy_timeout` is a live hazard rather than a theoretical one.

### 4. Recovery payload

Replace the silent `.slice(0, 20)` at `fm-session-main.ts:320`, `:327` and `:338`
with explicit, disclosed selection.

- order by actionability: open obligations and unsuperseded facts first
- always print what was withheld and how to retrieve it
- keep `--json` and the text rendering in agreement

At three sessions `recover` already emits 20,673 bytes across 109 lines while
hiding 16 of 36 facts and 14 of 34 obligations, and the JSON and text outputs
disagree. The binding constraint on this store is the recovery payload against an
agent's context budget, not disk: the whole database is 94 KB. Truncation is the
right idea; silence and an arbitrary constant are not.

### 5. Write-path validation

Supersession of a missing or already-superseded target must fail inside the
transaction. The port already does this, so the fix arrives with the cutover, but
it needs a conformance case pinning the exit code and the stderr shape.

This is the sharpest defect the migration closes. Reproduced against a copy of
the live store:

```console
$ fm-session supersede 8888 "second phantom" --reason "r2"   # 8888 does not exist
fact 8888 superseded by 38
$ echo $?
0
```

An orphan row is inserted, zero rows are updated, success is reported, and the
result is written through into the tracked `session.ndjson` (94 to 95 rows). A
mistyped id silently corrupts the record of truth and stages it for commit.

## Cutover

The sequencing in the existing plan is sound and is kept:

1. freeze today's exact stdout, stderr, exit codes and sidecar bytes as a golden
   oracle
2. land the v1 reader and the reconciliation, with the CLI still on the old code
3. migrate command by command behind the `FM_SESSION_CMD` seam, diffing against
   the golden at every step
4. cut over only when every command is clean, then delete the embedded store

The plan needs a task inserted before its Task 5. As written it reaches the CLI
migration with no v1 reader and no reconciliation, and fails on contact with live
data.

## Testing

- the v1 reader is proven by decoding the real `.foreman/session.ndjson`, not a
  fixture, and re-encoding to v2
- the reconciliation asserts row-level before and after states, including that no
  `open` row acquires a blocker and no `done` row is touched
- the existing 28-case conformance suite runs unchanged against the store; that
  it must not need editing is the point of the exercise
- a conformance case pins supersession of a missing target to a non-zero exit
- a case asserts `recover` discloses withheld rows and that `--json` agrees with
  the text output

## Risks

- **Golden oracle captures a bug as expected behaviour.** The phantom-supersede
  output is currently "correct" by definition. Any golden case covering it must
  be marked as a known defect and changed deliberately at cutover, not silently.
- **`store_meta` watermarks set below live ids.** `ensureCounters` would then
  flag every row. The migration computes from `max(id)`, and an assertion that
  each watermark exceeds the live maximum runs before commit.
- **v1 reader accepts something the v2 encoder cannot round-trip.** Mitigated by
  decoding the real sidecar and re-encoding, comparing row counts per kind.

## Out of scope

Parked deliberately. Each is attractive and none belongs in a change whose goal
is collapsing two implementations into one.

- bi-temporal event-time columns alongside the existing transaction-time
  supersession columns
- a deterministic dedup ladder (exact, then MinHash/LSH, then Jaccard, gated by
  an entropy test)
- replaceability scoring to make eviction a recorded property
- semantic recall through the `MemoryIndex` port

Fact-text sanitization is excluded as a separate security change rather than
parked. Fact statements are written with no validation and rendered by raw
interpolation (`fm-session-main.ts:321`) beneath a header asserting "durable,
true by construction", so untrusted text an agent has read can reach a later
session's context as ground truth. That needs its own threat model.

## Prior art consulted

Four systems were examined before settling on this scope. The conclusion was that
SessionDB's existing model is sound and the work is internal.

- **Mem0** removed LLM-arbitrated UPDATE and DELETE from its OSS extraction path
  in favour of single-pass ADD-only, reporting a LoCoMo improvement from 71.4 to
  91.6 at half the latency. Evidence for append-only supersession.
- **Graphiti** mutates edges in place, so it holds no row-level history, and puts
  an LLM in the write path. Its bi-temporal schema is worth studying; its
  invalidation has no end-to-end test, and Zep's own README states production
  runs a separate proprietary engine.
- **TencentDB-Agent-Memory** is a team-memory hub rather than a session store,
  with no test files in the repository and CI that never runs the type checker.
- **LangGraph, Letta, Temporal and the vendor SDKs** converge on append-only logs
  with resumption only at declared boundaries, and on WAL with
  `synchronous=NORMAL` as the default durability posture.
