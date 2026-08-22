# Task 6a re-review — commit `913a9d0`

`fix(session): bootstrap through the port and let it own the sidecar`, committed
2026-08-11, reviewed 2026-08-12. The original review died on an internal error
before returning a verdict; this is that review, run late and against the
committed tree.

Reviewed under `plugins/foreman-qa/agents/foreman-qa-reviewer.md`. Every finding
below that is marked `execution-derived` carries the command and its actual
output. Nothing in the worktree was written by this review; all probe artefacts
live under `/tmp/qa6a`.

## Two premises in the review brief, corrected before anything else

**The brief states this commit removed the one-to-one supersession invariant
from `packages/session-store/src/integrity.ts`. It did not.**

```console
$ git log --oneline -8 -- packages/session-store/src/integrity.ts
913a9d0 fix(session): bootstrap through the port and let it own the sidecar
9152bb2 feat(session-store): read the v1 sidecar format, allow supersession fan-in
cc5f705 Clear the executable bit on files copied in from /mnt/c
4035c2d Define the storage port contract: SessionStore and MemoryIndex

$ git show 9152bb2 -- packages/session-store/src/integrity.ts | grep '^-' | head
-    const targetCount = new Map<number, number>();
-      targetCount.set(by, (targetCount.get(by) ?? 0) + 1);
-    for (const [target, n] of targetCount) {
-          detail: `row ${target} supersedes ${n} rows; at most one is allowed`,
```

The `targetCount` cardinality check was removed two commits earlier, in
`9152bb2`. `913a9d0`'s entire change to `integrity.ts` is the new `at()` helper
that appends the row's identity fields to five shape-violation messages — an
improvement, and the thing `tests/session.bats` now asserts on (`id=7`).

**On the merits, the fan-in relaxation is justified by real data, not
convenience.** Measured against both the live sidecar and the golden seed:

```console
$ python3  # group predecessors by successor, .foreman/session.ndjson
  successor ('facts', 32) <- predecessors [16]
  successor ('facts', 34) <- predecessors [30]
  successor ('measurements', 10) <- predecessors [2, 9] FAN-IN
  successor ('measurements', 14) <- predecessors [13]
  successor ('measurements', 17) <- predecessors [1, 8, 14, 15] FAN-IN
```

Measurement 17 is named by four predecessors, exactly as `9152bb2` claims, and
measurement 10 by two — a second instance the commit message does not mention.
`superseded_by` remains single-valued, so "what superseded row X" still has one
answer, and the neighbouring dangling / self-supersession / cycle checks are
intact at `integrity.ts:232-266`. The invariant contradicted the data; removing
it was correct. See finding 11 for the coverage gap it left behind.

## What holds

Recorded so the findings are read against a correct baseline. Each was run at
`913a9d0` in `/home/charl/fm-wt/sdb-task6`.

```console
$ npm test
ℹ tests 1432   ℹ pass 1428   ℹ fail 0   ℹ cancelled 0   ℹ skipped 4

$ bats tests/session.bats
1..29
ok 1 .. ok 29                       (all 29 pass; no RESULT ERROR in the output)

$ npm run typecheck                 (tsc -b && tsc -p tsconfig.all.json: clean)
$ npm run verify-runtime
verify-runtime: ok
```

`verify-runtime: ok` is the evidence that the committed
`skills/foreman/runtime/dist/fm-session.js` bundle matches
`skills/foreman/runtime/manifest.json`, so the bundle `tests/session.bats`
exercises is the one built from the sources reviewed here.

The seed repair claim checks out. Decoding the fixture directly:

```console
$ tsx  # decodeSnapshot + findViolations + countRows
  golden seed:  decoded, rows=73 violations=0 nextIds={"fact":35,"measurement":8,"obligation":35}
  live sidecar: decoded, rows=92 violations=0 nextIds={"fact":37,"measurement":20,"obligation":35}
```

73 rows, zero violations, and the `fact` watermark of 35 is what makes
`supersede-missing.out` read `fact 9999 superseded by 35`. The 71 → 73 move is
accounted for: 74 raw records in the file, less the one `schema_meta` row the v1
reader drops, is 73; the old walk counted `schema_meta` as a row and reached 71
over 70 entity rows.

`docs-check.sh`, as supplied in the review context and **not re-derived by this
review**:

```text
docs-check: markdownlint=pass codespell=pass lychee=pass agent-invocations=pass comments=pass
```

`modes.txt` contains zero entries that are not `100644`.

### The commit-message claim about the two new checks is substantiated

This is the claim `AGENT_TRAPS.md` §3 Rule 2 exists to make people prove, and
four defects on this branch were fake verification, so it was re-derived rather
than taken. Each known-bad input below is the state the fix removed, and the
committed check's own assertions were re-run against it.

```console
$ tsx /tmp/disc.ts
== PROBE A: test (d) against the pre-fix bootstrap ==
  port open() onto a legacy file threw: NO - returned cleanly
  has store_meta: true
  legacy schema_meta survived: true
  watermarks: {"fact":1,"measurement":1,"obligation":1} (test (d) demands 37 / 20 / 35)
  obligation 34: {"status":"blocked","blocker":"a blocker"} (test (d) demands status "open")
  => test (d) DISCRIMINATES: true

== PROBE B: test (b) against a non-transactional snapshot ==
  neuterTransaction=false: interleave fired=true facts=0 measurements=0
    test (b) assertions hold: true
  neuterTransaction=true: interleave fired=true facts=0 measurements=1
    test (b) assertions hold: false
  => test (b) DISCRIMINATES: true

== PROBE C: the new bats grep against a sqlite_schema-walk sidecar ==
  tables the walk found: facts, measurements, memory_outbox, obligations, sessions, store_meta
  grep 'store_meta|memory_outbox|schema_meta' matches the walked sidecar: true
  same grep against encodeSnapshot output: false
  => the bats grep DISCRIMINATES: true
```

All three fail on their known-bad and pass on the known-good. The
commit-message sentence "Both were confirmed to fail when the fix is removed" is
true. Probe B additionally confirms the reworked case (b): the `BEGIN`/`COMMIT`
added at `sqlite-store.ts:291` is load-bearing, and the decision to arm the
probe on `DatabaseSync.prototype` rather than a caller-held connection is the
correct one — the port opens its own connection, so a probe on a caller's
instance would have sat beside the code under test.

Two further positive results:

- A refused legacy migration is non-destructive. The legacy file is
  byte-identical afterwards and leaves no debris (probe Z9 below).
- Every numeric-id `INSERT` in `fm-session-main.ts` now goes through `mintId`;
  there is no unconverted path left that lets SQLite choose an id.
  `sessions` inserts a string primary key and needs none. `retire` and `close`
  are `UPDATE`s and leave the watermark correct (`next_id.measurement` = 3 after
  two measures and a retire).

## Findings

### 1. The sidecar writer can still emit a tracked record the reader refuses, and the CLI calls it success

```text
severity: blocking
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:462
```

**Claim.** The defect this commit was written to fix is stated in its own message
as "`decodeSnapshot` refused the canonical record it had just produced." Only one
cause of that was removed — undeclared tables. The write path still has no
integrity assertion: `sidecarNdjson` calls `encodeSnapshot(store.snapshot())`,
and `encodeSnapshot` (`packages/session-store/src/sidecar.ts:97`) validates
nothing, while `decodeSnapshot` ends in `assertIntegrity`. So any snapshot that
violates a rule the reader enforces is written out, reported as
`sidecar refreshed: N row(s)` with rc 0, and is unreadable from that moment on.
`rehydrateFromSidecarIfEmpty` (`:196`) then swallows the read failure into a
`WARNING`, so a cold clone comes up silently empty rather than loudly broken.

**Evidence.** The write side does not validate:

```console
$ tsx /tmp/disc2.ts
== X2. does integrity flag a row id at or above its watermark? ==
   nextIds: {"fact":1,"measurement":1,"obligation":1} row id present: 36
   findViolations: [{"kind":"fact","field":"id","detail":"id 36 is at or above nextIds.fact (1)"}]
   encodeSnapshot threw: NO
```

End to end through the shipped bundle, the CLI reports success and the file it
wrote cannot be read back:

```console
$ node skills/foreman/runtime/dist/fm-session.js fact "new fact"
fact 1
sidecar refreshed: 2 row(s) -> /tmp/qa6a/e2e/repo/.foreman/session.ndjson
  rc=0

== X1. is the sidecar the corrupted store just wrote readable? ==
   {"format":"foreman-session-sidecar","format_version":2,"session_model_version":1,"next_ids":{"fact":2,...}}
   {"kind":"fact","row":{"id":1,...}}
   {"kind":"fact","row":{"id":36,...}}
   decodeSnapshot FAILED: snapshot violates 1 integrity rule(s):
  fact.id: id 36 is at or above nextIds.fact (2)
```

This is `AGENT_TRAPS.md` §3 Rule 1 in the negative: the success predicate here is
bound to `writeAtomic` returning, not to the artefact being a readable record.

**Suggested fix.** Assert integrity on the way out, in `encodeSnapshot` or in
`sidecarNdjson` before `writeAtomic`, and let the command fail loudly. The check
already exists and already produces the right message; the writer simply does
not call it. Also stop `rehydrateFromSidecarIfEmpty` from downgrading an
unreadable tracked record to a warning.

### 2. `classifyStore` reads the exact corrupted intermediate this commit exists to fix as healthy

```text
severity: blocking
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:101
```

**Claim.** `classifyStore` returns `"port"` on the first sight of a `store_meta`
table. But the corruption the commit describes — the port opened straight onto a
legacy file — *creates* `store_meta` while leaving `schema_meta` in place and
every watermark at 1. A store in that state is therefore classified `"port"`,
accepted without repair, and the next write mints an id far below the live rows.
The docstring justifies deciding structurally "because the number is what is
untrustworthy here"; the presence of `store_meta` is untrustworthy in precisely
the same way, and a sound discriminator is already implemented one package over
(`findViolations`' id-vs-watermark rule, quoted in finding 1).

**Evidence.** Build a legacy file, let the pre-fix code path touch it, then run
the shipped post-fix CLI against it:

```console
--- shape after the pre-fix open ---
  tables: ['facts', 'measurements', 'memory_outbox', 'obligations', 'schema_meta',
           'sessions', 'sqlite_sequence', 'store_meta']
  store_meta: [('next_id.fact','1'), ('next_id.measurement','1'), ('next_id.obligation','1')]
  max fact id: 36

$ node skills/foreman/runtime/dist/fm-session.js recover     # no migration, rc=0
FACTS (1) — durable, true by construction
  [36] live fact
$ node skills/foreman/runtime/dist/fm-session.js fact "new fact"
fact 1
sidecar refreshed: 2 row(s)
  rc=0
--- shape after ---
  tables: [... 'schema_meta' ... 'store_meta' ...]     # legacy schema still there
  store_meta: [('next_id.fact','2'), ...]
  fact ids: [1, 36]                                    # id 1 minted beside live 36
```

`fact ids: [1, 36]` with a watermark of 2 is the corruption verbatim, reached
through the new bootstrap, on a file the new classifier called port-shaped. The
resulting sidecar is the unreadable one in finding 1.

Two things bound this. Whether such a file exists on any machine today is
**unverified** — I cannot inspect other checkouts, and the parent commit's bundle
did not use the port for the main store (`journal_mode=delete` at `4d5b0fe`
versus `wal` at `913a9d0`, probe Z5), so the shipped CLI never produced this
state. The commit message nonetheless asserts the corruption happened, which
means it was produced by hand at least once. The class matters more than the
instance: `Task 8: Flip the default to port` and every golden frozen from Task 3
onward anchor to this bootstrap.

**Suggested fix.** Make the classifier reject rather than assume. Treat a file
carrying both `schema_meta` and `store_meta` as a third shape — corrupt — and
refuse it by name. Independently, cross-check each watermark against
`max(id)` for its table before returning `"port"`, so a store whose identity
counters sit behind its rows is repaired instead of written to. Both are cheap
and both would have caught the state above.

### 3. `mintId` replaces an atomic insert with a read-modify-write that has no lock

```text
severity: major
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:522
```

**Claim.** The pre-fix path was one statement — `INSERT INTO facts(statement,…)`
against an `AUTOINCREMENT` column — and could not collide. `mintId` is a `SELECT`
in one autocommit transaction, an `INSERT OR REPLACE` in a second, and the
caller's row `INSERT` in a third, with nothing holding a write lock across them.
Two processes that read the watermark before either bumps it mint the same id.
`PRAGMA busy_timeout=5000` does not help: neither process is ever blocked, so
there is no busy condition to wait out. `sqlite-store.ts:152` cites
`AGENT_TRAPS.md:22` to establish that concurrent writers here are "normal
operation, not a theoretical" hazard, which is the same standard this path
should be held to.

**Evidence.** The mechanism, run deterministically against one store:

```console
$ tsx /tmp/disc2.ts
== X3. mintId atomicity: two interleaved minters on one store ==
   A minted 1 / B minted 1 -> identical: true
   B's INSERT: UNIQUE constraint failed: facts.id
   watermark after both: 2 rows: [{"id":1,"statement":"A"}]
```

Both minters take id 1, one row is lost, and the watermark absorbs only one of
the two increments.

Reported honestly: **eight genuinely concurrent CLI processes did not collide.**

```console
   1 rc=0 out=fact 8 | 2 rc=0 out=fact 2 | 3 rc=0 out=fact 4 | 4 rc=0 out=fact 6
   5 rc=0 out=fact 5 | 6 rc=0 out=fact 3 | 7 rc=0 out=fact 7 | 8 rc=0 out=fact 9
   fact ids: [1,2,3,4,5,6,7,8,9]  count: 9   next_id.fact: 10
```

Node startup dominates the window, so the race is latent rather than observed in
the field. It is still a real loss of an atomicity property the previous code
had, and the failure mode is a dropped fact with a non-zero exit on one lane.

**Suggested fix.** Wrap the mint and the row insert in a single
`BEGIN IMMEDIATE` … `COMMIT` on the same connection, so the write lock is held
across the read of the watermark and the insert of the row. The port's own
`importSnapshot` already uses `BEGIN IMMEDIATE` for exactly this reason.

### 4. `recover`, `freshness` and `sidecar` now write to the store

```text
severity: major
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:212
```

**Claim.** `connectReadonly` is gone. All three read-only commands now route
through `connect()` → `bootstrapStore()`, which may rebuild the database from
scratch, and through `SqliteSessionStore.open()` on the sidecar path, which runs
`db.exec(SCHEMA)` and `ensureCounters()`. `READ_ONLY_CMDS` at `:20` survives but
now gates only the sidecar refresh in `mainWithSidecar`, not the connection.
A read command that destroys and re-creates the file it is reading is a
surprising amount of authority for `fm-session recover`.

The repo already ruled on this. `.gitignore` explains why `.foreman/session.db`
is untracked and names, among the reasons, that "it was rewritten on every READ
until the read path was opened read-only." This commit reverts that property
without saying so.

**Evidence.**

```console
=== Y2. does a READ-ONLY command mutate session.db? ===
  recover rc=0
  freshness rc=0
  identical bytes after two read-only commands: NO
  mtime changed: YES
  files now beside the store:
session.db
session.db-shm
session.db-wal
session.ndjson
```

**Suggested fix.** Separate the two concerns the commit fused. Bootstrapping is
a write operation and belongs to write commands (and to an explicit `migrate`);
a read command should classify the store, and refuse with a message naming the
required migration if the shape is wrong, rather than performing it. If reads
must keep bootstrapping, say so in the commit record and update the `.gitignore`
rationale that currently claims the opposite.

### 5. The CLI never closes its connection, leaving an un-checkpointed WAL after every write

```text
severity: minor
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:212
```

**Claim.** `connect()` returns a `DatabaseSync` that no code path closes; the
diff removed the one `conn.close()` that existed, on the sidecar-refresh path
(`git show 913a9d0 … | grep close()` → `-    conn.close();`). Combined with the
port switching the file to `journal_mode=wal`, every write command now exits
with the tail of its own work sitting in `session.db-wal` rather than in
`session.db`, and the next command silently checkpoints it.

**Evidence.**

```console
=== Z2. when do -wal/-shm appear, and what writes on a read? ===
  after: fact (write cmd)      db=aaa599d1cb93  wal=16512 shm=present
  after: recover (read cmd)    db=3c482a38cbc1  wal=0     shm=present
  after: recover again         db=3c482a38cbc1  wal=0     shm=present
  after: freshness (read cmd)  db=3c482a38cbc1  wal=0     shm=present

=== Z5. journal mode: parent commit vs this one ===
  old bundle (4d5b0fe): journal_mode=delete
  new bundle (913a9d0): journal_mode=wal
```

16512 bytes of committed session state living outside `session.db` after the
command has exited is what makes finding 6 matter, and is also the write that
finding 4 observes on the following read.

**Suggested fix.** Close the connection before every `return` from `main`, or
hold it in a `try`/`finally` around the command dispatch.

### 6. Four new artefacts appear beside the store and none of them is git-ignored

```text
severity: minor
kind: execution-derived
.gitignore:43
```

**Claim.** `.gitignore` ignores `.foreman/session.db` exactly. This commit
introduces three new sibling paths and makes a fourth reachable, and none is
matched by that pattern: `session.db-wal` and `session.db-shm` (new because the
journal mode moves `delete` → `wal`, probe Z5), `session.db.legacy.ndjson` (the
migration carrier written at `fm-session-main.ts:179`, which holds the entire
session content in plain text and is removed only in a `finally` — a `SIGKILL`
leaves it in the tree), and `session.db.rebuild` (`session-rebuild.ts:40`, left
behind if `importSnapshot` throws).

**Evidence.**

```console
$ git check-ignore -q <path>
IGNORED   .foreman/session.db
TRACKABLE .foreman/session.db-wal
TRACKABLE .foreman/session.db-shm
TRACKABLE .foreman/session.db.legacy.ndjson
TRACKABLE .foreman/session.db.rebuild
```

`AGENT_TRAPS.md` §1 records "Never `git add -A` in the base checkout" as a
standing trap. This widens the blast radius of exactly that mistake, and
`session.db-wal` can hold committed session state (finding 5).

**Suggested fix.** Change the pattern to `.foreman/session.db*`. Better, put the
migration carrier in a temp directory rather than next to the tracked record —
it is a transient of the migration, not an artefact of the store.

### 7. A refused legacy migration is reported to the caller as `sqlite3.OperationalError`

```text
severity: minor
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:186
```

**Claim.** `bootstrapStore` writes an accurate diagnosis and rethrows; the
`catch` around `connect()` in `main` then unconditionally writes
`sqlite3.OperationalError` and exits 1. The two lines contradict each other, and
the second is the one a caller matching on error class will act on. It says the
database could not be opened, when the database opened fine and the migration
was refused on data grounds.

**Evidence.**

```console
=== Z9. a refused legacy migration ===
   refusing: the legacy session store at …/session.db could not be migrated to the port schema:
     snapshot violates 1 integrity rule(s):
     fact.statement: null in a non-null field (id=7)
   sqlite3.OperationalError
   rc=1
  legacy file byte-identical after the refusal: YES
  leftovers: session.db
```

The `(id=7)` is the new `at()` helper doing its job, and the byte-identical
result confirms `legacyDumpV1`'s "never writes to it" docstring. Only the second
line is wrong.

**Suggested fix.** Distinguish a bootstrap failure from an open failure — throw a
tagged error from `bootstrapStore` and let `main` re-raise it without
relabelling, the way the `import-sidecar` branch already narrows on
`unable to open database file`.

### 8. `rebuildFromSidecar` renames a fresh database over a file whose `-wal` and `-shm` it leaves in place

```text
severity: minor
kind: execution-derived
packages/orchestration/src/session-rebuild.ts:51
```

**Claim.** The rebuild's whole point is that a migration must land in a fresh
file. It builds `${dbPath}.rebuild` correctly, then `renameSync`s it over
`dbPath` while any `${dbPath}-wal` / `${dbPath}-shm` from the file being replaced
survive untouched — now sitting beside a completely different database. SQLite's
documented rule is that a database and its `-wal` must be moved together; a WAL
left beside a replaced database is the state in which frames belonging to the old
file can be applied to the new one. Finding 5 makes this reachable: after this
commit the CLI leaves a populated `-wal` behind on every write.

**Evidence.**

```console
=== Y4. does rebuildFromSidecar leave a stale -wal/-shm beside the target? ===
  before: -wal true  -shm true
  after : -wal true  -shm true
  -> a -wal/-shm pair belonging to the REPLACED file survives the rename
```

**Not demonstrated to corrupt.** I showed only that the stale pair survives the
rename; I did not construct a case where SQLite replays it. Reported at minor for
that reason.

**Suggested fix.** `rmSync(dbPath + "-wal", { force: true })` and the same for
`-shm` immediately before the rename, and the same cleanup for `${tmpPath}-wal` /
`-shm`.

### 9. Test (d)'s first assertion passes on the known-bad

```text
severity: minor
kind: execution-derived
packages/orchestration/src/fm-session-main.test.ts:188
```

**Claim.** `assert.ok(tables.has("store_meta"), "the store was not rebuilt into
the port schema")` cannot fail in the scenario it names. Opening the port
straight onto a legacy file — the state the fix removes — *creates* `store_meta`
via `CREATE TABLE IF NOT EXISTS`, so the assertion holds either way and its
failure message is untrue. The surrounding test does discriminate (the watermark
assertions and `!tables.has("schema_meta")` all fail on the known-bad, probe A),
so this is one vacuous assertion inside a sound test rather than a fake check.
`AGENT_TRAPS.md` §3 Rule 3 requires it be named as vacuous rather than counted
as coverage — and it is the same blind spot that finding 2 exploits.

**Evidence.**

```console
== PROBE A: test (d) against the pre-fix bootstrap ==
  port open() onto a legacy file threw: NO - returned cleanly
  has store_meta: true          <- the assertion at :188 holds on the known-bad
  legacy schema_meta survived: true
  watermarks: {"fact":1,"measurement":1,"obligation":1}
```

**Suggested fix.** Replace it with the property that actually distinguishes a
rebuilt store: `sqlite_sequence` absent, or `schema_meta` absent, which the next
line already asserts. Then delete this one rather than keep an assertion whose
message is false.

### 10. The new bats assertion is redundant with its own hunk and matches on row content

```text
severity: minor
kind: execution-derived
tests/session.bats:253
```

**Claim.** `! grep -q 'store_meta\|memory_outbox\|schema_meta'` does discriminate
against the removed `sqlite_schema` walk (probe C), so it is not a fake check.
Two weaker problems remain. It is an unanchored substring match over the entire
file including row content, so a fact, measurement or obligation whose text
mentions any of those three table names fails the test for a reason that has
nothing to do with the property — `AGENT_TRAPS.md` §2 lists "the regex lacked a
boundary and matched the prefix" among the twelve. And the same hunk already
rejects an undeclared kind structurally, twice, via
`list(document.keys()) != ["kind","row"]` and
`seen != {"fact","measurement","obligation"}`, so the grep adds no discrimination
that the assertions above it do not already have.

**Evidence.**

```console
== PROBE C ==
  tables the walk found: facts, measurements, memory_outbox, obligations, sessions, store_meta
  grep 'store_meta|memory_outbox|schema_meta' matches the walked sidecar: true
  same grep against encodeSnapshot output: false
== PROBE D ==
  encodeSnapshot iterates ENTITY_ORDER, a frozen constant: session, fact, measurement, obligation
```

**Suggested fix.** Anchor it on the record key it is really about —
`! grep -q '"kind":"\(store_meta\|memory_outbox\|schema_meta\)"'` — or drop it
and rely on the two structural assertions already in the hunk.

### 11. The golden seed contains no supersession fan-in, so the goldens never exercise the relaxed invariant

```text
severity: minor
kind: execution-derived
packages/orchestration/src/__golden__/seed.ndjson:1
```

**Claim.** The relaxation was justified by measurement 17 being named by four
predecessors. That shape is in the live sidecar. It is not in the golden seed
this commit re-recorded, which carries only two one-to-one supersessions. Since
Tasks 3-9 freeze further goldens against this seed, the fixture that guards the
cutover never sees the shape the rule was changed for.

**Evidence.**

```console
$ python3   # predecessors grouped by successor
--- packages/orchestration/src/__golden__/seed.ndjson
  successor ('facts', 32) <- predecessors [16]
  successor ('facts', 34) <- predecessors [30]
--- .foreman/session.ndjson
  successor ('measurements', 10) <- predecessors [2, 9] FAN-IN
  successor ('measurements', 17) <- predecessors [1, 8, 14, 15] FAN-IN
```

The relaxation is covered at the unit level by conformance cases added in
`9152bb2`, so this is a fixture-realism gap, not an untested rule. It matters
because the seed is described in the commit message as "spliced back verbatim
from the live record" while omitting the one shape that made the live record
interesting.

**Suggested fix.** Splice measurements 1, 8, 14, 15 and 17 into the seed when
Task 3 freezes its goldens, so the fan-in the invariant was relaxed for is in the
fixture the cutover is measured against.

### 12. A v1 `blocked` obligation with a null blocker is silently indistinguishable from an open one

```text
severity: minor
kind: execution-derived
packages/orchestration/src/fm-session-main.ts:272
```

**Claim.** `displayStatus` re-derives `blocked` only when `blocker` is truthy,
and `normalize()` in `sidecar-v1.ts:156` rewrites status to `open` regardless of
whether a blocker is present. A v1 row with `status="blocked"` and
`blocker=null` therefore reads back as a plain open obligation with nothing
recording that it was blocked. Both docstrings assert this unconditionally —
"Rewriting loses nothing", "nothing about the row is lost."

**Evidence.** The claim is true of today's data and only of today's data:

```console
--- .foreman/session.ndjson
  (status, has_blocker): ('blocked', True) -> 5
  (status, has_blocker): ('done', False) -> 10
  (status, has_blocker): ('open', False) -> 19
  blocked-with-null-blocker ids: []
--- packages/orchestration/src/__golden__/seed.ndjson
  (status, has_blocker): ('blocked', True) -> 5
  blocked-with-null-blocker ids: []
```

All five blocked obligations carry a blocker, so the round trip is lossless here
and the "five obligations would have vanished" claim in the commit message is
correct. The derivation nonetheless holds for a reason the code does not
enforce, which `AGENT_TRAPS.md` §3 Rule 3 asks be named rather than counted as a
pass.

**Suggested fix.** Have `normalize()` refuse, or record, a `blocked` row with no
blocker instead of flattening it, and narrow both docstrings to the condition
they actually depend on.

## Verdict

**BLOCKED** — the commit's own stated defect, a tracked record the reader
refuses, is still reachable through an unvalidated write path (finding 1) and
through a classifier that reads the corruption it exists to fix as healthy
(finding 2), both demonstrated end to end through the shipped bundle; the two
new checks the commit adds do genuinely discriminate, and the rest of the work —
the seed repair, the snapshot transaction, the derived `blocked` state, the
id minting — verifies as claimed.
