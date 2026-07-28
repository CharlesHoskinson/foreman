# Design -- terminusdb-operations

## Approach

The sequence is deployment -> data placement -> backup/restore -> migration -> query
layer -> monitoring -> drop-and-rebuild -> exit path. Each stage is specified as a
runbook with a verification step, not as prose advice, because R8's dominant finding
about this database is that its failure modes are silent (a `branch:`-prefixed diff
returns `[]` with HTTP 200; WOQL's own docs name silent-empty results as "the single
most common WOQL debugging issue") -- a runbook nobody has to remember to run is the
only mitigation that survives contact with a 2 a.m. incident.

**Data directory placement.** `durable-lanes.md` excludes `events.jsonl` and
`stream.ndjson` from `/mnt/*` for fsync integrity on the WSL/Windows boundary. The
store's data directory is a database's durability guarantee in exactly the same way;
it gets the same rule, enforced at deployment-script startup rather than left as a
convention someone can forget.

**Migration.** TerminusDB's migration API (`POST /api/migration/{path}`,
`?dry_run=true&verbose=true`) distinguishes weakening changes (no instance-data
transform -- add optional field, add class, widen type) from strengthening changes
(instance data transforms, and fails without an explicit default -- add required
field, delete class, narrow type). That split is real and is the backbone of the
runbook. The one operation the API cannot do is `ChangeParents` -- documented
upstream as unimplemented. Because `graph-store-port` already requires the store to
be fully regenerable from `events.jsonl` + `graph.json` + lane journals, an
inheritance restructuring is not a blocked operation, it is a drop-and-rebuild under
the new schema -- the regenerability property doubles as the migration escape hatch
for the one thing the vendor's own migration API cannot express.

**Query layer.** N2 section 9 is explicit that the 24 competency questions *are* the
specification the ontology exists to satisfy -- 10 need negation-as-failure, 7 need
recursive path queries, 4 need aggregation. R8 verified two footguns that make an
un-regression-tested query layer dangerous specifically here: an unwrapped `Path`
query returned 10 rows for 4 correct answers (needs `Distinct`), and both the
`branch:`-prefixed diff and WOQL's `xsd:anyURI`-vs-string unification both fail
*silently empty* rather than erroring. A query layer that is a permanent,
CI-run regression suite converts "did this quietly break" from a question nobody
asks into a build failure.

**CQ to named query mapping** (full 24; `NEG`=negation, `REC`=recursive path,
`AGG`=aggregation; schema element names follow `graph-store-port`'s frozen schema and
get a mechanical rename if Council 1's final names differ):

| # | CQ (abbreviated) | Tags | Query ID | Emptiness contract | Note |
|---|---|---|---|---|---|
| W1 | attempts descending from round X, lane/vendor per run | -- | Q-W1 | expect-non-empty (healthy round) | `HAS_ATTEMPT` traversal + `AgentRun.vendor`/lane |
| W2 | attempt that produced the commit reachable from release tag | REC | Q-W2 | expect-non-empty when tag resolves | recursive over `PRODUCED`/`REVISES` |
| W3 | lanes in round X with no terminal verdict past stall threshold | NEG | Q-W3 | true-negative-capable | negation over `EVALUATES` backlink + time threshold |
| W4 | shortest path, failing Evaluation back to violated Spec clause | REC | Q-W4 | GAP: no shortest-path operator exists in TerminusDB (R8 section 6); implemented as bounded `{n,m}` traversal, not true shortest-path | flag as partial |
| W5 | attempts superseded, and which spec revision triggered it | -- | Q-W5 | true-negative-capable | `SUPERSEDES` (timestamp+reason) + `REVISES` on `Spec` |
| W6 | agent runs whose vendor/model differs from routing policy | NEG | Q-W6 | true-negative-capable | dependency: routing-policy data as an in-graph fact is Council 1/2 scope |
| W7 | artifacts from a run missing required provenance (SLSA-incomplete) | NEG | Q-W7 | true-negative-capable | negation over required-field presence |
| W8 | do any `DEPENDS_ON` cycles exist | REC | Q-W8 | expect-emptiness is the healthy state | non-empty result is an invariant violation, must alert |
| W9 | commits landed on base branch after worktree creation (merge-freshness) | NEG | Q-W9 | true-negative-capable | joins `Commit.created_at` against git ancestry |
| W10 | attempts that consumed an artifact already superseded at start | -- | Q-W10 | true-negative-capable | time-comparison, `DERIVED_FROM`/consumed + `SUPERSEDES.timestamp` |
| W11 | attempts before PASS; input-set diff vs. last failure | AGG | Q-W11 | expect-non-empty | aggregation + input-set diff |
| W12 | runs over N tokens, no artifact surviving to a passing evaluation | AGG-NEG | Q-W12 | true-negative-capable | cost-attribution/waste |
| W13 | full attribution chain for a commit back to architect decision | REC | Q-W13 | expect-non-empty | dependency: architect decision as a node is Council 1 scope; flagged if absent |
| K14 | claims supported by no source at all | NEG | Q-K14 | true-negative-capable | negation over `sourced_from` |
| K15 | claims supported only by agent-produced sources, no human anchor | NEG-REC | Q-K15 | true-negative-capable | recursive over `PRODUCED`/`SUPPORTS` |
| K16 | entities mentioned by 2+ sources, never `RESOLVED_TO` canonical | NEG | Q-K16 | true-negative-capable | aggregation(>=2) + negation |
| K17 | claims audit verdict V contradicts, sources on each side | -- | Q-K17 | expect-non-empty when V has contradictions | direct `CONTRADICTS` |
| K18 | full provenance chain, claim C back to human-authored source | REC | Q-K18 | expect-non-empty | recursive `Path`, must wrap in `Distinct` |
| K19 | claim pairs re: same entity, contradicting, neither superseded | NEG | Q-K19 | true-negative-capable | live unresolved contradictions |
| K20 | superseded claims: when/by-what, does a live artifact still depend on one | -- | Q-K20 | true-negative-capable | `SUPERSEDES` + reverse `DERIVED_FROM` |
| X21 | specs with no passing evaluation; criteria covered by no evaluation | NEG | Q-X21 | true-negative-capable | the canonical closed-world question -- mandatory third canary alongside R8's two silent-empty canaries |
| X22 | failed evaluation's feedback contradicts a claim in the run's context | -- | Q-X22 | expect-non-empty when it occurs | dependency: context-block hash reference is GP-5 `graph-context-builder` scope, not yet landed |
| X23 | bugeventlog failures -> roadmap claim -> now passing evaluation | REC-AGG | Q-X23 | true-negative-capable | dependency: bugeventlog ingestion into the graph is ingest/Council-2 scope |
| X24 | metrics regressed between commits A/B; which run introduced it | AGG | Q-X24 | expect-non-empty when a regression exists | `Measurement`/`Metric` joined against `Commit` |

Four rows (W6, W13, X22, X23) are flagged as dependent on graph elements or ingest
paths this package does not itself define -- they are mapped, not gaps, and the
mapping becomes exercisable once the dependency lands. W4 is a genuine partial
implementation because TerminusDB has no shortest-path primitive.

**Monitoring.** `/api/metrics` (Prometheus) is Enterprise-gated and absent from OSS
(R8 section 2.7). The replacement is not a monitoring stack -- R8 section 9 is explicit this is a
single WSL box holding a 38 MB idle process -- it's an hourly poll of `/api/info`,
container RSS/disk (via the runtime, not the store), and a document count via the
store's own listing endpoint, alerting when RSS or disk exceeds 3x the R8 baseline
(38 MB idle RSS, 9.7 MB/5,500 docs) for the current document count. It never touches
`/api/log` -- that endpoint is banned from every query path by `graph-store-port`.

**Drop-and-rebuild, timed.** `graph-store-port` requires the store be provably
regenerable; this package requires that proof be exercised on a schedule against the
*live* data directory, with a duration budget derived from R8's measured ~1,070
docs/s bulk-insert rate, re-derived as the corpus grows rather than fixed forever.

**Exit path, named tripwires.** `graph-store-port`'s health re-check names its
trigger categories (commit cadence, second maintainer, release cadence, capability
moving to Enterprise) but leaves them qualitative. This package supplies the
numbers, grounded directly in what R8 measured, so the decision is pre-registered
rather than made under pressure: fewer than 50 commits/rolling-6-months (the 2024 dormancy
year averaged ~2.25/month -- 50/6mo is approximately 8.3/month, a wide, deliberately early margin
above that floor); a single author above 90% of commits across two consecutive quarterly
checks (R8 measured ~93% today -- the threshold is a decline detector, not a
false-alarm at the current number, hence "sustained across two checks"); any
depended-on capability moving to Enterprise (already true for RDF export, Prometheus
metrics, and fast commit-history queries -- the trigger is a currently-used
capability moving, not any capability existing behind the paywall); any license
change away from Apache-2.0.

## Alternatives REJECTED

- **Rely on TerminusDB Enterprise for Prometheus metrics.** Rejected: this is
  exactly the Enterprise-creep risk `graph-store-port/design.md` names as a
  standing risk; paying to unblock monitoring the OSS deployment silently converts
  a guardrail into a dependency on the paid tier.
- **Use `/api/log` growth as a monitoring signal.** Rejected: it is a banned query
  path (`graph-store-port`'s "work-DAG stored as documents" requirement), and R8
  measured it as a ~2.4 ms/commit linear scan -- using it for routine monitoring
  would itself become the performance problem it is meant to detect.
- **In-place migration always, never rebuild-from-source.** Rejected: `ChangeParents`
  is unimplemented upstream, so some schema changes cannot be expressed as a
  migration at all. Because `graph-store-port` already requires full regenerability,
  refusing to use that property for inheritance changes would mean blocking on a
  vendor gap that has a working answer sitting right next to it.
- **Ad hoc queries, written when needed, discarded after.** Rejected: N2 section 9 frames
  the 24 competency questions as the specification the ontology exists to satisfy.
  Ad hoc queries lose regression coverage exactly where R8 found the two silent-empty
  footguns -- an un-regression-tested `Distinct`-missing `Path` query or an
  unwrapped negation query would resurface those footguns invisibly.
- **A full Prometheus/Grafana monitoring stack.** Rejected as disproportionate: R8
  section 9 measured a 38 MB idle single-container deployment on one WSL box with one
  operator. A stack sized for that footprint is activity without benefit; a
  lightweight hourly poll script matches the actual deployment shape.
- **Leave tripwire thresholds qualitative, matching `graph-store-port`'s generic
  health-recheck language.** Rejected specifically for this package: qualitative
  triggers invite "it's probably still fine" exactly when a bus-factor-1 project
  that already went dormant once needs an unambiguous answer. Numeric, pre-registered
  thresholds -- the same discipline `graph-eval-falsification` applies to its kill
  criteria -- remove the judgment call at the moment it is hardest to make well.

## Risks

- **A strengthening migration silently fails without an explicit default.** Mitigated
  by the mandatory dry-run-then-backup-then-apply sequence; the dry run is inspected
  before the live run is authorized.
- **The named-query manifest drifts from Council 1's final schema.** Mitigated by
  making the manifest test-driven: a missing class or relation fails the regression
  suite loudly, naming the missing element, rather than the query silently returning
  nothing.
- **The monitoring script becomes unmaintained shelfware.** Mitigated by wiring it
  into the same cadence as the drop-and-rebuild job -- the same lesson
  `graph-store-port/design.md` states about the files-only implementation ("a
  fallback that nobody runs is a fallback that does not work") applied to monitoring.
- **Tripwire numbers age.** Mitigated: the quarterly check re-fetches live upstream
  commit-cadence, author-share, and licensing data rather than hardcoding R8's
  2026-07-28 snapshot forever.
- **The exit-path rehearsal is treated as a one-time checkbox.** Mitigated by
  requiring re-rehearsal within one release of any tripwire firing, not just once
  before go-live.
