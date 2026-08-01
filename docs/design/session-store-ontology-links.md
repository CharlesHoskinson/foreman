# Linking the session store (SQLite) and the ontology (TerminusDB)

Status: design. Written 2026-07-30 after both stores existed independently.

## The problem, stated bluntly

They were designed separately and **they overlap**. The TerminusDB schema
(`openspec/changes/terminusdb-schema/design.md`) already declares `Claim`,
`Measurement`, `Finding`, `Commit`, `Provenance`, `Supersession`. The session
store (`skills/foreman/scripts/fm-session.py`) independently implements facts,
measurements and obligations.

Two stores holding the same concepts, with no stated relationship, is exactly
the two-sources-of-truth failure the checkpoint work exists to eliminate. This
must be settled before either grows further.

## The boundary

They are not competitors; they answer different questions and have different
availability requirements.

| | SQLite session store | TerminusDB ontology |
|---|---|---|
| Question | *What is true right now, and can I still trust it?* | *What is known, how does it relate, and what did it supersede?* |
| Scope | Hot, session-local, operational | Cold, cross-session, durable knowledge |
| Availability | Zero-dependency file; works offline, mid-lane, on a laptop | Needs a running server |
| Write cost | Microseconds, transactional | Network round trip |
| Read shape | Exact SQL, deterministic | Graph traversal, WOQL |
| Lifetime | Truncatable; rebuildable from events | Permanent record |

**Rule: SQLite is the write path. TerminusDB is the read-optimised projection.**
One direction only. Bidirectional sync would reintroduce two writers, which is
the original disease.

## The store travels with the repository

The earlier decision to ignore `.foreman/session.db` as machine-local state is
reversed. The SQLite store is the authoritative record of session facts,
measurements, and obligations, so it must be tracked and travel between hosts.

SQLite is a binary format, and Git cannot merge two hosts' changes to it. The
generated `.foreman/session.ndjson` sidecar is a deterministic, faithful text
dump of that database. It is a recovery artifact, not another write path:
normal commands write SQLite, and `sidecar` regenerates the text file.

The sidecar and the ontology projection are deliberately different
serialisers. `project` remains a lossy, one-directional view shaped as
`Claim`, `Measurement`, `Finding`, and `Supersession` documents for the graph.
The sidecar instead emits one `{table, row}` record for every SQLite row and
discovers every table, column, and primary key from SQLite's schema. Records
are ordered by table name and primary key, JSON keys are sorted, and a single
format-version record leads the file. All schema and row reads share one SQLite
read transaction, so concurrent writes cannot produce a dump assembled from
different database states. This prevents a future schema column from
disappearing merely because a hand-maintained field list was not updated.

`import-sidecar` restores those row dictionaries exactly inside one write
transaction. It refuses an unknown format version, a row that does not match
the target schema, or any row SQLite cannot insert; it never fabricates a
replacement. The populated-target check remains inside the same transaction
and requires `--force` before existing operational rows can be replaced.

Measurement freshness is absent from the sidecar because it is absent from the
database: validity remains computed from Git at read time. To resolve a
conflict, merge `.foreman/session.ndjson` as text first, keeping one format
record and reconciling rows by table and primary key. Remove the conflicted
`.foreman/session.db`, rebuild it with `fm-session.py import-sidecar
.foreman/session.ndjson`, regenerate the sidecar with `fm-session.py sidecar`,
and stage both generated files. This recovers the reviewable database contents
instead of choosing either host's SQLite blob.

## The four links that actually matter

### 1. `measured_sha` → `Commit` (the join key that already exists)

`Measurement.subject` is a `Commit` in the ontology; the session store already
records `measured_sha` on every measurement. **This is a free join** — the same
git SHA is the key on both sides. Nothing needs to be invented.

### 2. `scope_paths` → `about: Set<Entity>` (the link only SQLite can supply)

The ontology's `Measurement` has `metric`, `subject`, `value`, `at` — and **no
scope**. It therefore cannot compute staleness at all. The session store's
`scope_paths` is precisely the missing edge: those paths are `Entity` /
`Artifact` nodes in the graph.

Projecting `scope_paths` into `about` gives the ontology something it currently
cannot express: *which entities invalidate this measurement*. That is the
highest-value link in this design, and it flows SQLite → TerminusDB.

### 3. `facts.superseded_by` → `Supersession` (SQLite's version is degenerate)

The ontology reifies supersession deliberately, and says why:

> "N2 requires SUPERSEDES to carry `at` and `reason`, and a plain field cannot
> carry them."

The session store's `facts.superseded_by` is a bare foreign key — **no `at`, no
`reason`**. That is a defect on the SQLite side, found by this comparison. A
superseded fact whose replacement carries no reason is a fact nobody can audit.

**Action: add `superseded_at` and `supersede_reason` to `facts`.** Cheap now,
painful after the table has history.

### 4. `obligations` → `Finding` / `Claim.contradicts` (the reconciliation gap)

`Claim` carries `contradicts: Set<Claim>` and `status: ClaimStatus`. The session
store has no notion of two facts disagreeing — it can only supersede in a
straight line. For operational recovery that is adequate; for the durable record
it is not, because contradiction is exactly what an audit needs to see.

Obligations map to `Finding` (which has `FindingSeverity`); blockers map to a
`ClaimStatus`. Neither needs to change in SQLite — the projection resolves it.

## Type mismatch that will bite

`Measurement.value` is `xsd:decimal` — **numeric only**. The session store's
`value` is TEXT, and today holds things like `"447 pass / 0 fail / 19 skip"`.
That does not project.

**Action: measurements should carry a numeric `value` plus an optional text
`detail`.** `447` is the value; the rest is detail. Retrofitting this after a
few hundred rows exist is worse than doing it now.

## What must NOT be linked

- **Recovery must never read TerminusDB.** If the ontology server is down, or
  slow, or mid-migration, recovery must still work. Recovery is SQL against a
  local file, full stop.
- **The ontology must never write back into the session store.** One writer.
- **No vector similarity anywhere on the recovery path** — settled already, and
  it applies to graph retrieval too: `about` traversal is exact, embeddings are
  not.

## Projection trigger

At `fm-session.py end` (and on demand), project the closed session's rows into
the ontology. Session end is the correct boundary: the rows are final, the tree
is still, and a network failure costs nothing because SQLite already holds the
record. A failed projection is retried, never blocking.

## Ordered work

1. Add `superseded_at` + `supersede_reason` to `facts` (link 3).
2. Split measurement `value` into numeric + `detail` (type mismatch).
3. Write the projector: SQLite rows → `Claim` / `Measurement` / `Finding` /
   `Supersession`, joining on `measured_sha` = `Commit` and `scope_paths` =
   `about`.
4. Only then implement `terminusdb-adapter`, so the adapter is built against a
   real consumer instead of speculatively.

Item 4 matters: `terminusdb-adapter` is currently unimplemented and was going to
be built blind. This projection is its first real caller, and building the
adapter to serve it is far more likely to produce the right API than building it
against the schema alone.
