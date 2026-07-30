# WITHDRAWN 2026-07-30 — TerminusDB

These three packages are archived, not deleted. They hold real research, a 24-item
competency-query mapping, and a live-verified schema load.

## Why

A four-lens design council withdrew TerminusDB from the stack.

- **Availability.** Recovery runs mid-lane and offline. A store that can be down
  during recovery cannot hold recovery-relevant state, which is most of this
  ontology.
- **Direction.** The release moved all CI local to shed infrastructure. A server,
  auth, backups and an operations package invert that.
- **Nothing read it.** No adapter existed, no server ran, no data was written.

## What replaced it

`skills/foreman/ontology/schema.sql` — the same class vocabulary as SQLite tables.
Disjointness is now **store-enforced** by a `node_kind(kind, plane)` composite FK,
which is stronger than the frozen design, whose own comment conceded it was
"enforced by discipline, not the store".

## What must NOT be lost

`terminusdb-operations` made the **24 competency queries a permanent CI-run suite**,
because two silent-empty footguns were found. That discipline is owed to the SQL
queries and is the requirement most likely to be dropped by accident.

`terminusdb-schema/scripts/schema-live-gate.sh` encodes four checks worth porting:
positive acceptance, invalid-enum rejection, undeclared-field rejection, and
drop-and-rebuild identity.

## Also rejected

**sqlite-graph** — evaluated by building it and running 28 queries. Zero schema
enforcement, silently wrong answers (AND yields [], ORDER BY/LIMIT/count ignored,
SET and DELETE are no-ops that report success), cannot load under Python stdlib
sqlite3, and no variable-length path operator, so it cannot express a supersession
chain.

**mem0 + pgvector** — ADD-only pipeline, no ORDER BY, no supersedes edge. It would
have returned two contradictory values as equally-ranked neighbours.
