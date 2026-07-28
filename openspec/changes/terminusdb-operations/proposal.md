# Change: terminusdb-operations

## Why

`graph-store-port` specifies the port abstraction, the frozen schema, the TerminusDB
adapter, and generic guardrails (pin the version, back it up, run a quarterly health
re-check with unnamed trigger conditions, prove the store is regenerable). What it does
not specify is the runbook: how the container is actually deployed and pinned in
practice, where the data directory physically lives, how backup is *rehearsed* rather
than merely described, what happens when the ontology changes after data already
exists -- the question R8 flags as "most likely to bite us later" -- how N2's 24
competency questions become a permanent regression suite instead of one-off queries
written when someone needs them, how an operator monitors a database whose own
`/api/metrics` endpoint is Enterprise-gated, and what specific number moves the
operator from "wait and see" to "execute the exit path" rather than that decision
being made under pressure, after the fact, by whoever is on call.

R8 (`docs/research/vnext/R8-terminusdb-store.md`) measured the store live against
12.0.6: 2.6 s cold start, 38 MB idle RSS, 9.7 MB on disk for 5,500 documents,
~1,070 docs/s bulk insert, 202 ms to list 5,058 documents. It also measured the
project's fragility directly: one author wrote ~793 of ~860 commits in the last year
(~93%), the project produced 27 commits in all of 2024 and shipped nothing for
12.5 months before DFRNT assumed stewardship in 2025, npm `terminusdb` sees 105
downloads/month, and the founder's last commit was 2025-04-22. Apache-2.0 since 2020,
no rug-pull signal. And it measured two silent-empty failure modes that return HTTP
200 with a wrong answer (section 5.1's `branch:`-prefixed diff, and WOQL's own documented
"most common debugging issue"), plus a commit log that scans at ~2.4 ms/commit,
dead linear, with O(offset) paging -- the fast version of which is the literal
Enterprise upsell. The owner has decided to ship anyway, on the condition that these
facts are operationalized rather than merely acknowledged. This package is that
operationalization.

This package assumes `graph-store-port`'s port, frozen schema, adapter, and ingest
path land; it specifies the operations layer on top of them and does not duplicate
their requirements. Where this package's requirements sharpen a generic
`graph-store-port` requirement with concrete numbers or procedure (e.g. the health
re-check's trigger conditions), it says so explicitly rather than restating the
generic requirement.

## What changes

- **Docker deployment** with the server version *and* the image digest pinned, refusing
  to start on a mismatch, with credentials from environment/secret store rather than
  hardcoded.
- **Data directory placement rule**: the store's data directory lives on a native
  filesystem (WSL ext4 root or Windows-native path), never under `/mnt/*`, for the same
  fsync-integrity reason `events.jsonl` and `stream.ndjson` already exclude `/mnt/*`
  (`skills/foreman/references/durable-lanes.md`).
- **Backup and restore, rehearsed**: stop-and-tar backup before every version change and
  on a fixed weekly cadence, with a restore drill that reproduces query-layer results,
  not just a documented procedure nobody has run.
- **A schema migration/evolution runbook**: dry-run-then-backup-then-apply, weakening vs.
  strengthening changes handled per TerminusDB's own migration semantics, and
  rebuild-from-source (not the migration API) for inheritance restructuring, because
  `ChangeParents` is unimplemented upstream.
- **The named query layer**: one named, regression-tested query per N2 section 9 competency
  question (24 total), each declaring its non-emptiness contract, wired into CI.
- **Monitoring without Prometheus**: `/api/metrics` is Enterprise-gated; monitoring uses
  `/api/info`, container RSS/disk size, and document counts instead, on an hourly poll,
  never the commit log.
- **Timed drop-and-rebuild**: the regenerability property `graph-store-port` requires,
  run on a monthly schedule against the live data directory with a duration budget
  derived from R8's measured throughput, not just proven once in a test fixture.
- **A rehearsed exit path with named numeric tripwires**: concrete thresholds (not the
  generic "commit cadence, second maintainer, release cadence" language) that convert
  `graph-store-port`'s quarterly health re-check from a judgment call into a
  pre-registered decision.

## Impact

- **New**: deployment script + compose definition; backup/restore drill script and
  cadence record; migration runbook; the 24-query regression suite plus its manifest;
  the monitoring poll script; the scheduled drop-and-rebuild job; the tripwire-check
  script and the exit-path rehearsal record.
- **Affected**: none of Foreman core's behavior changes -- this package is purely
  operational scaffolding around the port `graph-store-port` defines, matching that
  package's own framing that the port makes deferral (or, here, adoption) a bounded
  cost rather than a behavior change.
- **Depends on** `graph-store-port` landing first (port, schema, adapter, ingest) and on
  Council 1's frozen schema for the exact class/relation names the query-layer manifest
  references -- if those names differ from the R8 draft schema used here, the manifest
  update is a mechanical rename, not a redesign, because the manifest is one query per
  competency question, not a schema restatement.
- **Deferral-assuming text found in sibling packages, now superseded by the ship
  decision** (flagged per instruction, not edited -- that correction belongs to those
  packages):
  1. `graph-store-port/proposal.md` section Impact: "May be deferred by architect decision
     behind GP-7's query census (SYNTHESIS section 5). If the census finds genuine multi-hop
     cross-run queries are rare, this package is frozen and nothing above it changes."
     -- superseded; the product owner has decided to ship independent of the census
     outcome.
  2. `graph-store-port/design.md` section "The shape of the decision": "Does Foreman need a
     queryable, versioned, schema-enforced store? Unresolved. GP-7's query census
     answers it." -- superseded; this question is now resolved (yes) by the product
     owner.
  3. `graph-eval-falsification/proposal.md` section Impact: "Governs GP-6
     (`graph-store-port`). The census outcome is the architect's documented basis for
     landing or freezing the store." -- the census may still run and can still inform
     later tuning or an exit-path trigger, but it no longer gates whether the store
     lands; that decision is already made.
