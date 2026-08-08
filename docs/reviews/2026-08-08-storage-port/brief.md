# Design review brief — Foreman v0.3.1 storage port contract

You are one of three independent reviewers. Review the design below and propose
enhancements. Be specific and adversarial. Do not be agreeable by default.

## Context

Foreman is a TypeScript monorepo (Node 24, strict TS, ESM) that orchestrates
multi-vendor AI coding agents. It keeps **session state** in a local SQLite
database at `.foreman/session.db` via `node:sqlite` `DatabaseSync`.

Session state consists of four entity kinds:

- `sessions`   — session_id (PK, text), started_ts, start_sha, ended_ts, note
- `facts`      — id (INTEGER PK AUTOINCREMENT), statement, evidence,
                 established_ts, session_id, superseded_by REFERENCES facts(id),
                 superseded_at, supersede_reason
- `measurements` — id (INTEGER PK AUTOINCREMENT), metric, value, value_num REAL,
                 command, measured_ts, measured_sha, scope_paths, session_id,
                 superseded_by REFERENCES measurements(id), superseded_at,
                 supersede_reason
- `obligations` — id (INTEGER PK AUTOINCREMENT), statement, status
                 (open|done|dropped), blocker, opened_ts, closed_ts, session_id

The CLI (`fm-session`) has commands: begin, end, recover, freshness, fact,
measure, obligation, close, supersede, retire, sidecar, import-sidecar.
It is **fully synchronous** top to bottom and exits immediately.

There is already an NDJSON "sidecar" export/import used for backup and restore.

## The defect being fixed

The sidecar round-trip contract is currently defined by **SQLite introspection**:

```ts
function storeSchema(conn) {
  const tables = conn.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);
  for (const table of tables) {
    const info = conn.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    ...
  }
}
```

`validateSidecar()` then checks each imported row's columns against that
reflected schema. So the portable contract is literally "whatever SQLite's
schema happens to be at runtime." No non-SQLite backend can express or satisfy
this, and the contract silently changes whenever a migration runs.

## The second system: TencentDB-Agent-Memory

We evaluated adopting TencentDB-Agent-Memory (Tencent's open-source agent memory
system) for storage. Its actual v3 TypeScript SDK surface is:

- L0 `addConversation` / `queryConversation` / `searchConversation` / `deleteConversation` / `countConversation`
- L1 `updateAtomic` / `queryAtomic` / `searchAtomic` / `deleteAtomic` / `countAtomic`
- L2 `listScenarios` / `readScenario` / `writeScenario` / `rmScenario`
- L3 `readCore` / `writeCore`

Verified properties:

- HTTP only, `Promise`-returning only. No synchronous path.
- Requires `endpoint`, `apiKey`, and strict isolation ids (`teamId`/`agentId`/`userId`).
- Deployment requires two sets of LLM credentials (`MEMORY_LLM_BASE_URL`,
  `MEMORY_LLM_API_KEY`, `MEMORY_LLM_MODEL`). Memory formation is LLM-mediated
  and therefore **non-deterministic**.
- No transactions, no integer identity/autoincrement, no foreign keys, no
  guarantee of exact set enumeration.

## The design under review

**Rejected:** one `SessionStore` port with SQLite and TencentDB as two
substitutable implementations. Rationale: it would force the port async
(rewriting the sync CLI), force TencentDB to fake transactions/integer
identity/FK supersession, break byte-exact round-trip because writes are
LLM-mediated, and make Foreman non-functional offline.

**Adopted:** two ports with disjoint responsibilities.

### Port 1 — `SessionStore` (system of record)

- Authoritative. Synchronous. Transactional. Exact.
- Owns: identity, ordering, supersession, durability, round-trip fidelity.
- Implementation: SQLite (required, the only complete implementation).
- The canonical entity model is declared in TypeScript (`entities.ts`), NOT
  derived from backend introspection. SQLite is validated *against* the model.
- Nullability rule: an absent value is always `null`, never an absent key.
  Every declared field is present on every row, so snapshot equality is decidable
  with no optional-vs-null ambiguity.
- Round-trip guarantee: `import(export(store))` reproduces an equal snapshot,
  and `encode()` is byte-stable given a declared per-entity `ordering`.

### Port 2 — `MemoryIndex` (derived projection)

- Non-authoritative. Asynchronous. Eventually consistent. Semantic. Optional.
- Owns: recall by meaning, across sessions and repos.
- Implementation: TencentDB-Agent-Memory (optional); a null implementation is
  the default.

### The governing invariant

> The MemoryIndex is a projection of the SessionStore. It may be destroyed at
> any time and fully rebuilt from the sidecar NDJSON. No Foreman correctness
> property may depend on the MemoryIndex being present, reachable, or fresh.

Consequences: offline or credential-less operation is fully functional;
TencentDB being unreachable degrades recall only, never correctness.

## What to review

1. Is the two-port split correct, or is there a better decomposition?
2. Is the governing invariant strong enough to be *testable*? How would you
   falsify it in CI? What sneaks a MemoryIndex dependency into correctness?
3. The canonical model replaces SQLite introspection. What does that break, and
   what migration/versioning story does `SESSION_MODEL_VERSION` need? How should
   the port handle a sidecar written by a newer model version?
4. Supersession is append-only with `superseded_by` pointing forward. Is that
   the right shape? What integrity constraints must the port enforce that
   SQLite's FKs currently do (note: the code runs `PRAGMA foreign_keys=OFF`)?
5. Identity: `facts`/`measurements`/`obligations` use INTEGER AUTOINCREMENT.
   That is a backend-assigned identity leaking into the portable contract.
   Should the port mint its own identity instead? What breaks if it does?
6. What belongs in the conformance suite so a second SessionStore implementation
   could be trusted? Name concrete cases, including hostile ones.
7. Anything materially wrong, missing, or over-engineered.

## Output format

Return markdown with exactly these sections:

- `## Verdict` — one paragraph: is the design sound? Adopt / adopt-with-changes / reject.
- `## Material defects` — numbered; each with the concrete failure it causes.
- `## Enhancements` — numbered; each concrete and actionable.
- `## Conformance cases` — a bulleted list of specific test cases you would require.
- `## Disagreements` — where you expect other reviewers to be wrong, and why.

Be concise. No preamble. Do not restate the brief back.
