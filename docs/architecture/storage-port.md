# Storage port contract — v0.3.1

Foreman keeps session state in a **system of record** and, optionally, mirrors a
redacted view of it into a **semantic index**. These are two ports with disjoint
responsibilities, not two implementations of one port.

## Why not one port

An external agent-memory service was evaluated as a second implementation of
a single `SessionStore`. Its SDK cannot satisfy that contract:

| Session state requires | The external service provides |
|---|---|
| Synchronous access (`fm-session` is sync top to bottom and exits) | HTTP, `Promise`-only; no sync path |
| Transactions | None |
| Exact integer identity and reference chains | None |
| Deterministic, byte-exact round-trip | Memory formation is LLM-mediated (`MEMORY_LLM_*` required), so writes are non-deterministic |
| Works offline, no credentials | Endpoint, API key, and team/agent/user isolation ids required |

Forcing substitutability would make the CLI async, oblige that service to fake
transactions and identity, and put network availability on the critical path of
local correctness. The split below avoids all of that.

## Port 1 — `SessionStore` (system of record)

Authoritative, synchronous, transactional, exact. SQLite is the reference
implementation. `SqliteSessionStore` and `FilesOnlySessionStore` are complete
implementations and pass the same backend-neutral contract.

Owns: identity, ordering, supersession, durability, round-trip fidelity.

Three properties define it:

1. **The model is declared, not reflected.** `entities.ts` is the contract.
   Previously the portable contract was whatever `sqlite_schema` and
   `PRAGMA table_info` reported at runtime, which meant it silently changed
   whenever a migration ran and no non-SQLite backend could express it. The
   SQLite schema is now validated *against* the model at open, and drift is a
   startup error.

2. **Identity is port-minted.** Columns are plain `INTEGER PRIMARY KEY` with no
   `AUTOINCREMENT`. Ids come from counters in `store_meta`, and `nextIds` is
   part of the snapshot — allocation state is observable behaviour, so it
   round-trips. The backend never assigns identity.

3. **Absent means `null`, never a missing key.** Every declared field is present
   on every row, so snapshot equality is decidable with no optional-vs-null
   ambiguity.

### Supersession is not append-only

Recording a successor UPDATEs the predecessor. Those three columns
(`superseded_by`, `superseded_at`, `supersede_reason`) are the only mutable
fields on a supersedable entity. They are **set-once**, **all-or-none**, and
written in the same transaction as the insert of the superseding row.

`PRAGMA foreign_keys` is now ON, with `defer_foreign_keys` inside the import
transaction so a forward pointer can be satisfied by a row written later in the
same transaction. The port enforces the rules regardless, because the previous
code ran with foreign keys off and nothing checked them:

- referenced row exists, same kind, not self
- no cycles
- at most one successor per row
- supersession metadata all present or all absent
- an obligation may be closed only from `open`

### Version policy

The sidecar format version and the session model version are independent.

| Sidecar model version | Behaviour |
|---|---|
| Equal | Validate, then apply |
| Older | Run registered pure upgrades, validate the result, then apply |
| Newer | **Refuse before any mutation.** Never partial, never best-effort, never silently discard unknown fields |

### Canonical encoding

All of this is contract; changing any of it bumps `SESSION_MODEL_VERSION`.

- NDJSON, LF endings, exactly one trailing newline, exactly one header record
- Rows in `ENTITY_ORDER`, and within a kind by that kind's declared `ordering`
- Keys in **declared field order**, not sorted
- Every declared field emitted, including nulls
- Shortest-round-trip numbers; `-0` encodes as `0`; non-finite values are
  rejected at write time, since JSON cannot represent them and SQLite `REAL` can
  hold them
- Strings pass through as stored — no Unicode normalisation, which would
  silently rewrite session content

### Storage implementations

SQLite commits entity rows, allocation counters, and projection outbox changes
in one database transaction. A writable open can migrate a legacy database.
A read-only open never migrates or repairs state.

Files-only stores immutable NDJSON generations. Each published token names a
snapshot file in `generations/` and its matching outbox file in
`outbox-generations/`. A mutation writes and syncs both files and their
directories before it replaces and syncs `CURRENT`. A failure before the
`CURRENT` replacement leaves the previous pair active. A new-format generation
with a missing or malformed matching outbox is corrupt; it is not an empty
queue.

Files-only writer exclusion is a single-host process claim. It is not a network
filesystem lease. Use one writer and one drainer for each files-only directory.

### Snapshot import

An import into an empty store is an exact replacement. For a non-empty store,
`force` with the default `refuse` policy keeps the destructive replacement
behaviour. `force` with `remap` performs an additive merge: it preserves target
rows, pending outbox receipts, and queue order; allocates every donor counted
row from target counters per kind; rewrites same-kind supersession pointers;
and remaps colliding session identities. The complete candidate is validated
before one atomic commit.

## Port 2 — `MemoryIndex` (derived projection)

Non-authoritative, asynchronous, eventually consistent, semantic, optional.
`NullMemoryIndex` is the default, so Foreman is fully functional offline and
without credentials.

Owns: recall by meaning, across sessions and repos.

**It returns entity references, never content.** Consumers rehydrate current
truth from the `SessionStore`. This is what prevents stale-recall poisoning: a
superseded fact still sitting in the index cannot be acted on, because its
content is not what the index hands back. Superseded rows are also excluded from
projection at the source.

### Redaction is subtractive

Fields are excluded unless `PROJECTABLE_FIELDS` lists them.

| Kind | Projectable |
|---|---|
| `fact` | `statement` |
| `measurement` | `metric`, `value` |
| `obligation` | `statement`, `status` |

`evidence`, `command`, `scope_paths`, `note` and `start_sha` routinely carry
absolute paths, hostnames and pasted credentials. Projecting them verbatim to a
third-party LLM endpoint would be a confidentiality regression against a local
SQLite file, so they never leave the machine.

## The governing invariant

Stated as two separately testable clauses, because "fully rebuilt" is not
falsifiable on its own — an LLM-mediated backend is non-deterministic, so no
equality test over rebuilt content can exist.

> **I1 — Re-projection completeness.** Every row of a snapshot can be projected
> without error. Rebuild restores query *availability*, not identical semantic
> output.
>
> **I2 — Correctness independence.** No `SessionStore` operation and no core CLI
> command reads the `MemoryIndex`. Observable behaviour is identical under a
> `MemoryIndex` that is absent, throwing, hanging, or returning plausible
> garbage.

I2 is the one that matters and the one that rots. It is enforced three ways:

- **Structurally** — `SessionStore` takes no `MemoryIndex` parameter at all.
- **By fault injection** — the suite runs against `Null`, `Throwing`, `Hanging`
  and `Poison` implementations and asserts identical output. `Poison` returns
  references to ids that do not exist; it is the one that finds real bugs.
- **By import boundary** — a test asserts the system-of-record modules do not
  import or mention `MemoryIndex`.

## The outbox

Each live entity has one stable desired-state key, `${kind}:${id}`. The
operation stores `mutation` as a separate `upsert` or `retract` field. Each
changed desired operation receives a fresh opaque receipt. A later operation
for the same identity replaces the pending operation, but acknowledgement uses
the exact receipt. A stale drain therefore cannot delete a newer operation.

SQLite writes the outbox entry in the same transaction as the entity change.
Files-only publishes the outbox and snapshot as the paired generation described
above. The outbox is deliberately **not** part of `SessionSnapshot`: it is
derived delivery state and only the projector may drain it.

`fm-session sync` drains the oldest bounded batches through `MemoryIndex`.
Effect supplies typed failures, cancellation, per-attempt timeouts, and bounded
retry. The drainer acknowledges a batch only after `MemoryIndex.project`
resolves. A rejection or timeout acknowledges nothing. An acknowledgement
failure stops the drain and leaves the entries pending.

The guarantee is durable idempotent at-least-once, not exactly-once. A crash
after remote success and before local acknowledgement must replay the batch.
Every real `MemoryIndex` adapter must therefore make repeated desired-state
operations idempotent. `NullMemoryIndex` is the only shipping adapter.
Projection epochs and an external adapter remain deferred.

## Conformance

`contract-suite.ts` is backend-neutral and factory-driven. Its 49 cases pass
unchanged against SQLite and files-only. It covers round-trip and byte
stability, port-minted identity and allocation round-trip, set-once
supersession, remap import, outbox receipt safety, the version policy, and
hostile input. A do-nothing negative-control store fails 24 cases across eight
independent categories, so a backend cannot pass the suite without implementing
the material contract.

## Review

Reviewed 2026-08-08 by an independent three-model panel (grok-4.5,
gpt-5.6-sol, claude-fable-5); all three returned adopt-with-changes and their
findings are folded in above. Reviews are archived under
`docs/reviews/2026-08-08-storage-port/`.
