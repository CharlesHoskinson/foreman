# Tasks — graph-store-port

Ordering note: T1 and T2 are serial and own the port and the schema. T3 (files-only)
must land before T4 (adapter) — the fallback is not allowed to be the thing written
last. T5–T8 may run in parallel once T4 lands. T9 is the gate.

Precondition: `lock-primitive-hardening` has landed. GP-3 supplies a fresh,
`--directed`, version-stamped `graph.json`; GP-4 supplies `worklog.jsonl` under
JK-1..5. Neither is built here.

## T1 — the GraphStore port

- [x] Define the `GraphStore` port: schema registration, document upsert, typed
      document lookup, the lineage query set, and the expected-emptiness
      contract. Shdoc headers on every function.
- [x] Keep store-specific concepts (branches, commits, data-version tokens) out
      of the required argument surface.
- [x] Define the optional-capability protocol: time-travel, branch/merge, and
      cross-run query ergonomics are queried before use and degrade rather than
      raise when absent.
- [x] Write the port conformance suite first, against the port alone, so both
      implementations are graded by the same assertions.
- [ ] Add a repository scan to the gate: no SQLite ontology import, local
      database file access, or SQL construction outside the adapter directory.

## T2 — the frozen schema

- [ ] Author the schema document covering `Task`, `Round`, `Attempt`,
      `AgentRun`, `Agent`, `Artifact` (+ `Spec`, `Commit`, `Source` subtypes),
      `Evaluation`, `Claim`, `Entity`, `Metric`, `Measurement`.
- [ ] Split `PARENT_OF` into `HAS_ATTEMPT`, `SUBTASK_OF`, `BROADER_THAN`.
- [ ] `EVALUATES` as a tagged union with exactly one target.
- [ ] `RESOLVED_TO` functional, acyclic, with provenance and a reviewer field.
- [ ] `SUPERSEDES` carries timestamp and reason; `DERIVED_FROM` / `REVISES` /
      `SUPERSEDES` mutually exclusive on a pair.
- [ ] `DEPENDS_ON` acyclicity checked, not assumed.
- [ ] `MENTIONS` demoted to a derived index, excluded from anything served to a
      model. Record the measurement N2 asked for: `MENTIONS` share of edges in
      the real `graph.json`, and which of the 24 competency questions degrade
      without it.
- [ ] Every LLM-populated field an enum or a reference — no free floats, no
      open strings.
- [ ] `Claim` / `Evaluation` / `Finding` / `Source` top-level, never
      sub-documents.
- [ ] No relation both symmetric and transitive.
- [ ] Abstract bases thin and stable (the parent-changing migration operation
      is unimplemented upstream).
- [ ] OWL 2 RL-shaped: no property chains, no complex class expressions.
- [ ] One human author, reviewed, frozen. Record the freeze and the reviewer.
- [ ] Map each of N2's 24 competency questions to the schema elements that
      answer it; any CQ with no mapping is a gap and is recorded as one.

## T3 — the files-only implementation (lands before the adapter)

- [x] Implement the port over `graph.json` + `worklog.jsonl` + run-dir JSON,
      with no database, no container, no network.
- [x] Make it the default implementation; the adapter is opt-in per host.
- [x] Report the three optional capabilities as unavailable, by name.
- [x] Full conformance suite green, and wired into root tests on every local
      verify path (`packages/graph-store/src/**/*.test.ts` in root `npm test`
      and the package gate). Hosted CI wiring is not claimed here.
- [ ] Prove a full round runs end to end with no store: gate evaluates,
      context block builds and hashes, run record complete.

## T4 — the SQLite ontology adapter

- [ ] Target the local database file directly through the standard-library
      SQLite API.
- [ ] Schema registration, including verification of the exact schema and its
      hash before use.
- [ ] Document upsert via create-or-replace with deterministic lexical keys.
- [ ] The lineage query set, expressed against documents.
- [ ] Never read the write-audit event log on a query path; add a test that
      fails if such a read is made.
- [ ] Never scan or page the write-audit event log during an ontology query.
- [ ] Write identity: each write carries run and lane identity in its write-audit
      event; record the authenticated user as the non-spoofable identity.
- [ ] Full conformance suite green against the adapter, with only the declared
      optional capabilities diverging from files-only.

## T5 — the query wrapper and the non-emptiness contract

- [ ] Every query and diff declares expected-empty or expected-non-empty.
- [ ] Unexpected emptiness raises a named error; it never returns empty.
- [ ] Normalise schema-hash references; reject prefixed or noncanonical forms
      explicitly, naming the accepted forms.
- [ ] Wrap every path query in the deduplication operator — a path query
      returns one row per path, not one per answer.
- [ ] Canary fixture 1: the prefixed schema-hash reference. Must fail closed.
- [ ] Canary fixture 2: a guarded traversal stopped by a cycle. Must fail
      closed.
- [ ] Prove both canaries detect a disabled assertion layer by running the
      suite with assertions off and confirming both fail.

## T6 — concurrency

- [ ] Distinct-document appends: no compare-and-swap.
- [ ] Shared-document read-modify-write: guarded write transaction mandatory;
      wrapper refuses an unguarded call before it reaches the store.
- [ ] Independent lane work: one complete batch per lane, applied in one
      transaction.
- [ ] Stale-state responses treated as retryable conflicts with bounded
      retry, then a named error — no silent infinite retry.
- [ ] Configure a finite busy timeout before running more than eight lanes;
      record the setting.
- [ ] Concurrency tests reproducing R8's three measured cases: twelve
      distinct-document writers, contending shared-document writers (require
      both lanes' changes in the final document), and the unguarded shared-write
      rejection.

## T7 — ingest

- [ ] Read `graph.json` directly; refuse Cypher and graph-database export files
      with an error naming the dropped fields.
- [ ] Schema registered before the first document write.
- [ ] Two passes: documents before link-valued properties.
- [ ] Idempotent re-ingest — same input twice produces no document differences.
- [ ] Stamp the producing extraction-substrate version on every batch.
- [ ] Identifier change recorded as rename-with-lineage, never delete+create.
- [ ] Reify `Mention`; drop cosmetic edge properties explicitly and record the
      drop; fail ingest on an edge property with neither a reified target nor a
      drop rule.
- [ ] Document the designed-but-unapplied reification of `SUPPORTS` and
      `CONTRADICTS`, so it is later an insert rather than a migration.

## T8 — pinning, backup, health, exit

- [ ] Pin the schema and its hash; refuse to start on a mismatch.
- [ ] Transactionally consistent backup procedure, mandatory before any
      schema-hash change.
- [ ] Prove the rebuild path: delete the local database file, rebuild from the
      source artifacts, confirm conformance queries match.
- [ ] Quarterly health re-check with named triggers: commit cadence, second
      maintainer, release cadence, and any in-use capability moving behind the
      paid tier. Calendarise it with the release checklist.
- [ ] Document the exit path — fall back to files-only within one release — and
      **rehearse it once** by running a full round on files-only after the
      adapter has been in use.
- [ ] Degradation behaviour when the store disappears mid-round: continue on
      files-only, report which capabilities degraded.

## T9 — gate

- [ ] Conformance suite green against both implementations; divergences limited
      to the three declared optional capabilities.
- [ ] The no-store round passes end to end.
- [ ] The drop-and-rebuild test passes.
- [ ] Both silent-empty canaries fail closed when assertions are disabled —
      verified by running it, not by reading the code.
- [ ] The write-audit-on-a-query-path test fails when such a call is introduced.
- [ ] The adapter-boundary repository scan is clean.
- [ ] Every one of N2's 24 competency questions is either mapped to schema
      elements or recorded as a known gap.
- [ ] `shellcheck` clean on every new script; docs gate green
      (`markdownlint-cli2`, `codespell`, `lychee`).
- [x] `openspec validate graph-store-port --strict` passes.
- [ ] `bugeventlog.md` appended with any workflow failure or friction event
      encountered while implementing this package.
