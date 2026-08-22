## Verdict

Adopt with changes. The two-port split is the right decomposition: a synchronous, exact system of record plus an optional semantic projection is the only shape that satisfies both the sync CLI and the external service's actual SDK, and the rejected single-port design would have failed for exactly the reasons stated. But the design as written has a hole in the middle — it defines two ports and never defines the projector that connects them, which is where every hard problem (delivery, retries, redaction, staleness) actually lives. It also mislabels supersession as append-only, leaves the "fully rebuilt" clause of the invariant untestable as worded, and ships session content to an external LLM with no redaction story.

## Material defects

1. **The projector is undefined.** The CLI is "fully synchronous and exits immediately"; the MemoryIndex is async HTTP. There is no moment at which projection can run: inline writes either block the CLI on the network or are abandoned when the process exits. Without a declared mechanism — an outbox table in SQLite plus an explicit `fm-session sync` command (or a projection driven purely from the sidecar) — the MemoryIndex will silently never be populated, or worse, be populated only when the network happened to win the race with process exit. This also needs idempotency keys, because the external service has no transactions and a retried `updateAtomic` after a timeout must not double-write.

2. **"Fully rebuilt from the sidecar" is unfalsifiable as written.** The external service's writes are LLM-mediated and non-deterministic, so two rebuilds from the same sidecar produce different indexes. You cannot test "fully rebuilt" as equality of any kind. The invariant must be split: (a) re-projection of every sidecar row *completes without error* (testable), and (b) no correctness property reads the index (testable, see below). As worded, the invariant sounds strong but no CI job can check its first half.

3. **Stale-recall poisoning.** A destroyed-and-rebuilt index is handled, but a *live* index that still contains superseded facts is not. If recall surfaces a superseded fact's content directly, an agent acts on retracted information — "degrades recall only" is technically true and practically false. The design needs either supersession propagation (`deleteAtomic`/tombstone on supersede, best-effort) or, better, the rule that MemoryIndex returns only entity references and every consumer re-hydrates current truth from the SessionStore.

4. **Data exfiltration to a third-party LLM.** `evidence` and `command` fields routinely contain paths, hostnames, and tokens pasted from shell sessions. Projecting them verbatim through `MEMORY_LLM_*` endpoints is a silent confidentiality regression versus a local SQLite file. The port contract must declare which fields are projectable, and the projector needs a redaction pass and an explicit opt-in.

5. **"Append-only" supersession isn't.** Setting `superseded_by`/`superseded_at`/`supersede_reason` on the *old* row is an UPDATE. That's acceptable, but the contract must say so precisely: those three columns are the only mutable fields on facts/measurements, set-once, atomically with the insert of the superseding row. A truly append-only alternative — `supersedes` on the *new* row, superseded status derived — would also make import single-pass; the current forward pointer forces two-pass validation on import (the target row doesn't exist yet when the old row is read).

6. **With `PRAGMA foreign_keys=OFF`, nothing enforces referential integrity today**, and the port inherits that duty with no listed constraints. Unenforced right now: dangling `superseded_by`, self-supersession, cycles (A↔B), `superseded_at` set without `superseded_by` (and vice versa), `session_id` referencing no session, `obligations.status` outside the enum, `closed_ts` present on an open obligation. Any of these round-trips "successfully" through the sidecar and corrupts every future consumer.

7. **Byte-stable `encode()` is unspecified for floats.** `value_num REAL` can hold `-0.0`, `Infinity`, `NaN` (SQLite permits them; JSON doesn't) and `1.0` vs `1` formatting differs across serializers. Without a canonical number encoding (shortest-round-trip, and an explicit reject-or-encode policy for non-finite values), byte-stability fails on real data the first time someone measures a rate of ∞.

## Enhancements

1. **Add an outbox.** A `memory_outbox` table written in the same SQLite transaction as the source row; `fm-session sync` drains it with retries and idempotency keys derived from `(table, id, mutation)`. This makes projection exactly-once-effective, offline-safe, and keeps the CLI sync.

2. **Restate the invariant as two CI-testable clauses**: (a) the entire CLI conformance suite must pass byte-identically under three MemoryIndex implementations — null, always-throwing, and always-hanging-with-timeout — including exit codes and stderr; (b) add a *poison* implementation returning plausible garbage, and assert outputs are still identical, which catches correctness paths that merely *read* recall. The thing that sneaks a dependency in: `recover` or `freshness` consulting the index, or error-path coupling where index failure changes an exit code.

3. **`SESSION_MODEL_VERSION` policy**: monotonic integer in every sidecar header; import refuses a *newer* version with an actionable error (never best-effort partial import); import of *older* versions runs registered pure upgrade functions before validation. Bump the version for any change to fields, nullability, enum values, canonical encoding, or declared `ordering` — the encoding rules are part of the model, not incidental.

4. **Keep integer identity but move minting into the port.** Don't switch to UUIDs: it breaks existing sidecars, human ergonomics (`fm-session supersede 42`), and cheap ordering. Instead, the port assigns ids from its own per-table counter (persisted in a meta row) and SQLite merely stores them; conformance then requires any backend to accept caller-supplied integer ids on import. Define the id-collision policy for import into a non-empty store explicitly (refuse by default; a remap mode must also rewrite `superseded_by` pointers).

5. **Specify canonical encoding fully**: UTF-8 NFC-as-stored (no normalization on write), sorted or declared key order, LF line endings, shortest-round-trip float formatting, explicit policy rejecting NaN/±Infinity at write time, and a documented tie-break (id) when the declared `ordering` timestamp collides.

6. **Validate SQLite against `entities.ts` at open**, not just at import: compare `PRAGMA table_info` to the model on every CLI start and fail loudly on drift, so a stray migration can't silently reintroduce the original defect in the opposite direction.

## Conformance cases

- `import(export(store))` yields an equal snapshot; `export ∘ import ∘ export` is byte-identical to the first export; two consecutive exports of an untouched store are byte-identical.
- Every declared field present on every row; a sidecar row with an absent key (vs explicit `null`) is rejected; an unknown extra key is rejected.
- Sidecar with `SESSION_MODEL_VERSION + 1` is refused with a clear error and zero partial writes; version `− 1` migrates then validates.
- Hostile supersession: dangling `superseded_by`, self-reference, two-node cycle, `superseded_at` without `superseded_by`, `supersede_reason` on a non-superseded row, cross-table pointer, pointer to a row in the same file *later* in the stream (must still resolve — two-pass) — each rejected atomically.
- Attempted mutation of any non-supersession field on facts/measurements is rejected; supersession columns are set-once.
- `obligations.status` outside `open|done|dropped` rejected; `closed_ts` on an `open` obligation rejected; `session_id` referencing no session rejected.
- Floats: `value_num` of `0.1+0.2`, `-0.0`, `1e300`, and non-finite values — round-trip byte-stable or rejected per policy, never silently reformatted.
- Unicode: statement containing NFD sequences, astral-plane characters, and embedded newlines round-trips exactly (NDJSON escaping).
- Duplicate primary key within one sidecar rejected; import into non-empty store follows the declared collision policy.
- Crash durability: `kill -9` mid-write, reopen, all integrity constraints still hold and the store validates against the model.
- Two concurrent CLI processes writing (SQLITE_BUSY path): no lost writes, no constraint violations.
- Full CLI suite under null / throwing / hanging / poison MemoryIndex: byte-identical stdout, stderr, and exit codes across all four.
- Outbox (if adopted): write with network down, `sync` later delivers exactly once; retried delivery after timeout does not duplicate.

## Disagreements

- Expect at least one reviewer to argue for collapsing back to one async port ("just await in the CLI"). Wrong: the sync/offline property is not an implementation convenience, it's the product — an `fm-session fact` that can hang on an external endpoint or demand LLM credentials is a different, worse tool.
- Expect a push to replace integer ids with UUIDs "for portability." That trades a real, migration-costing break (existing sidecars, human-facing ids, ordering) for a theoretical benefit the sidecar already provides — ids are portable data the moment import preserves them; who *mints* them is the only thing worth changing.
- Expect someone to call the MemoryIndex port over-engineered and demand deleting the external index entirely. The null-default port costs almost nothing and the invariant contains the blast radius; the actual risk is the undefined projector and the redaction gap, not the port's existence.
- Expect the "append-only" framing to be accepted at face value. It shouldn't be — the old-row UPDATE is the exact spot where a second implementation will diverge unless the contract names it.
