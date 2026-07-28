# Design — graph-store-port

## The shape of the decision

There are two independent questions here and they are worth keeping apart:

1. **Does Foreman need a queryable, versioned, schema-enforced store?**
   Unresolved. GP-7's query census answers it. Nothing in this package
   pretends otherwise.
2. **If it does, what bounds the downside?**
   A port with a working files-only implementation on the other side of it.

This package answers (2) properly so that (1) can be answered late, by
measurement, without either answer being expensive. That is the whole design.

## Why a port, and why the files-only implementation is the default

R8's health verdict is *alive but fragile*: one human wrote ~93% of the last
year's commits, the founder left in April 2025, the project produced 27 commits
in the whole of 2024 and shipped nothing for 12½ months, and the current npm
client sees 105 downloads a month. No fork has more than one star. There is no
successor project to fall back to.

The mitigation is not "pick something else" — R8 ranked the alternatives and
TerminusDB won on the two axes that matter here, versioning and ontology
enforcement, and lost on every other axis. The mitigation is that **losing the
store must cost a re-materialisation, not a rewrite**. Two properties deliver
that:

- **Regenerability.** Everything in the store is derivable from `events.jsonl`
  (append-only, frozen schema v2), `graph.json`, and the per-lane `GraphUpdate`
  journals. The store holds no fact that exists nowhere else. This is a
  requirement, and the CI drop-and-rebuild test is what keeps it true rather
  than aspirational.
- **A files-only implementation that is exercised on every commit**, not a
  stub kept warm on paper. If it is only run when the store breaks, it will be
  broken when the store breaks.

Making files-only the *default* rather than the fallback is the load-bearing
choice. A fallback that nobody runs is a fallback that does not work; a default
that everyone runs is tested by definition. The TerminusDB adapter is opt-in
per host.

## Why the work-DAG is documents, not commits

The obvious design — one commit per graph write, then read lineage out of the
commit log — is the design TerminusDB's marketing invites. R8 measured it and
it does not survive:

| Commits on branch | `/api/log` full scan |
|---|---|
| 178 | 459 ms |
| 278 | 680 ms |
| 378 | 932 ms |
| 478 | 1,152 ms |

~2.4 ms per commit, a clean linear fit, extrapolating to ~24 s at 10,000
commits. Offset paging is O(offset): `count=10 start=400` costs 442 ms against
35 ms at `start=0`. You can read the head of history cheaply; you cannot walk
back through it. And the fast version is explicitly the paid tier — the README
sells *"very fast commit history queries"* and *"query millions of commits with
sub-second response times"* as Enterprise features.

Modelled as documents, the same lineage questions run at ~230 ms over 5,000
documents **independent of commit count**. So the division of labour is:

- `events.jsonl` — system of record for work lineage;
- store documents — queryable projection;
- store commits — audit trail only, never on a query path.

The commit `author` field carries `run_id`/lane (an arbitrary caller-supplied
string, verified), and the authenticated `user` field carries the
non-spoofable identity. Both are useful. Neither is load-bearing.

## Why the two silent-empty footguns get hard requirements

R8 found two independent paths where this database returns a wrong answer with
HTTP 200:

```
{"before_data_version":"main",        "after_data_version":"lane-b"} -> correct diff
{"before_data_version":"commit:<id>", ...}                           -> correct diff
{"before_data_version":"branch:main", ...}                           -> [] SILENTLY
{"before_data_version":"admin/foreman/local/branch/main", ...}       -> errors loudly
```

and the vendor's own troubleshooting page names silent-empty WOQL results as
*"the single most common WOQL debugging issue"*, caused by comparing a
URI-typed value against a string literal where unification simply fails.

For most applications a silently empty result is a bug. For an audit trail it
is worse than a bug: it is *"the audit says nothing changed"* when something
did. A gate that reads an empty result as "no violations found" is N4's
pySHACL canary failure all over again — a no-op check is worse than no check,
because it is trusted.

Hence: every query declares its expected-emptiness, version references are
normalised at the wrapper boundary, and CI carries one canary fixture per known
silent-empty path whose *only* job is to fail if the assertion machinery stops
working. The canaries assert on mechanism, not on luck.

## Alternatives considered and REJECTED

**Adopt TerminusDB directly, without a port.** Rejected on the health numbers.
Bus factor 1 with a prior 14-month dormancy is not a risk you take without an
exit, and an exit you have not built is not an exit. The port costs perhaps a
day of the ~5-day estimate; a rewrite under duress costs the release.

**Skip the store entirely; keep files only.** Genuinely tempting, and GP-7 may
yet choose it. Rejected *as the specification* because the ontology work, the
identifier scheme and the ingest path are store-agnostic and have to be
written either way, and because writing them against a port costs nothing
extra while writing them against files-forever forecloses the measurement.
Note that this package is explicitly deferrable — SYNTHESIS §5 grants the
architect that call, and the specs are shaped so deferral is a decision, not a
rewrite.

**Postgres / SQLite with explicit tables** (R8's rank 2). Zero longevity risk,
total operational familiarity, hireable. Rejected as the *first* adapter
because you then hand-build versioning, time-travel, branch/merge and
write-time schema enforcement — the four things that are the entire reason a
store is being considered — and R4 §9.2 lists exactly those as the things a
git-like store gives free. It remains the strongest second adapter, and the
port exists so that writing it later is a contained piece of work rather than
a migration.

**Neo4j** (R8 rank 5). Best-in-class traversal, huge community, real hiring
pool. Rejected: GPL/commercial licensing, JVM weight on a single WSL box, and
version control is entirely the caller's problem — which is the requirement,
not a nice-to-have.

**FalkorDB** (R8 rank 6), already a graphify exporter target so it looks free.
Rejected: no versioning, no ontology enforcement, weak provenance. R8's phrase
is exact — *a query cache, not a system of record*. It would be a reasonable
read replica and a bad store.

**Oxigraph / a plain RDF store** (R8 rank 4). Apache-2.0, embeddable, real
SPARQL 1.1 property paths. Rejected: no versioning, no write-time schema
enforcement (SHACL is bolt-on, and N4 measured a SHACL engine silently
reporting `Conforms: True` while evaluating nothing), and RDF's ergonomics tax
without the document layer that makes TerminusDB pleasant.

**OWL as the formalism.** Rejected upstream by SYNTHESIS §2.5 and not
relitigated here: 10 of N2's 24 competency questions require
negation-as-failure, which is unanswerable in principle under the open-world
assumption. Foreman's graph records a bounded, fully-observed process, so
closed-world is the correct model of the world and not merely a convenience.
R8 then verified the negation query live in WOQL. The schema stays OWL 2
RL-shaped — no property chains, no complex class expressions — purely so a
mechanical RDF export remains possible later.

**TerminusDB commits as the lineage representation.** Rejected on the measured
linear scan above. This is the single most load-bearing rejection in the
package, because it is the design the product's own documentation leads you to.

**`graphify export neo4j` / `falkordb` as the ingest path.** Rejected
absolutely. It emits 5 fields and drops `source_file`, `source_location`,
`confidence_score`, hyperedges and communities (R7 §8.3). It would ingest a
graph stripped of precisely the provenance the store is for. Ingest reads
`graph.json`.

**Per-triple provenance via one commit per edge.** Rejected: it is the same
linear-scan trap approached from the other side, at ~28 ms p50 per commit
(~35 commits/s serial). Provenance lives as fields on the document
(`run_id` on `GraphNode`) instead.

**`@subdocument` for `Claim`/`Evaluation`/`Finding`/`Source`.** Rejected —
cascade-delete silently violates the invariant that superseded objects remain
addressable (N4 §6.4). They are top-level document classes.

**A deep inheritance hierarchy.** Rejected: the migration API's
`ChangeParents` operation is documented as **unimplemented**, so the
inheritance hierarchy is the one part of the schema that cannot be restructured
by migration. `GraphNode` and `WorkNode` stay thin and stable, and everything
interesting hangs off them as properties.

## Reification, and paying for it once

TerminusDB is a document graph. Edges are RDF predicates and cannot carry
attributes. graphify's exporters set `SET r += $props` on every edge; there is
nowhere for those to go.

The decision is to reify `Mention` now (span and confidence are genuine edge
attributes and R8's live schema already does it), drop cosmetic edge props, and
**design** the reification of `SUPPORTS`/`CONTRADICTS` now while writing it
later. The asymmetry is deliberate: adding a reified class before data exists is
a schema addition; adding it afterwards is `MoveClassProperty` plus a backfill
across every existing claim. Writing the target shape down now converts a future
migration into a future insert.

## Concurrency: three rules from three measurements

R8 ran three tests and they give three different answers, which is why one blanket
rule would be wrong:

- **12 concurrent writers, distinct documents, one branch** → 12/12 HTTP 200,
  12 documents landed, 12 serialized commits, zero errors. The optimistic
  retry machinery works. This is Foreman's fan-in case and it needs no CAS.
- **10 concurrent writers, same document** → 10/10 HTTP 200 and the last writer
  silently won. No conflict, no error, no warning. Same-branch contention is
  last-write-wins; conflict detection exists only at *merge*, between
  *branches*.
- **CAS via the `TerminusDB-Data-Version` header** → the stale write was
  rejected with `api:DataVersionMismatch` and did not clobber. This is not on
  the docs' concurrency page; R8 found it by testing.

The catch is that the precondition is **branch-scoped, not document-scoped**:
under N lanes, any other commit invalidates the token, so blanket CAS produces a
retry storm. Hence the three-way rule in the spec — no CAS for distinct-document
appends, CAS required for shared-document read-modify-write, branch-per-lane
plus `/api/apply` for independent lane work. And `TERMINUSDB_SERVER_WORKERS` is
raised above its default of 8 before running ~10 lanes.

## What this package deliberately does not do

- It does not make the store load-bearing for the merge gate, the context
  block, or the run record. Those are GP-2, GP-5 and GP-1, and they run on
  files.
- It does not add a reasoner, a SHACL engine, or a Datalog engine. Write-time
  document-schema validation is the only validation the store performs.
- It does not re-model git commit ancestry as graph edges. `Commit` nodes hold
  a sha reference; git answers children/leaves/lineage/diff.
- It does not claim TerminusDB's schema acceptance is a trust signal. N1 §6.3
  measured single-axiom ontology edits achieving 93.3% attack success with
  100% consistency-checker stealth and detection at chance. Ontology changes
  are code: reviewed, signed, gated.

## Risks

- **The store becomes load-bearing by accident.** The most likely way this
  package fails is that someone writes a gate check or a context builder that
  quietly requires the adapter, and the files-only path rots. Mitigation: the
  conformance suite runs the identical assertions against both
  implementations, and CI runs the files-only path by default.
- **The silent-empty assertions are themselves silently disabled.** A wrapper
  that stops asserting looks exactly like a wrapper that asserts and passes.
  Mitigation: the two canary fixtures, which must fail closed; this is
  directly N4's pySHACL lesson.
- **The linear extrapolation of commit-log cost is `INFERRED`.** R8 measured
  to 478 commits and extrapolated to 10k/100k on a clean linear fit. If the
  curve bends favourably, the documents-not-commits decision is merely
  unnecessary rather than wrong — the risk is one-directional, which is why
  it is acceptable to act on the extrapolation.
- **Cross-version store-directory compatibility is undocumented.** `/api/info`
  reports `storage.version: "2"`; upgrade and downgrade rules are stated
  nowhere in 296 crawled pages. Mitigation: pin the digest, back up by
  stop-and-tar before any version bump, and prove the rebuild path works
  rather than trusting the directory.
- **The project dies again.** It already did once. Mitigation is the exit
  path, and the honest statement that the exit path costs a
  re-materialisation and the loss of time-travel — which is a real loss, and
  a survivable one.
- **Enterprise creep.** Performance headroom, RDF serialisations and
  Prometheus metrics are already gated, and there is no pricing page and no
  edition-comparison matrix anywhere in the documentation. Mitigation: use
  OSS-only features, re-check each release, and treat any OSS capability
  moving behind the paywall as a health-check trigger.
