# Design — work-dag-projection

## What a projection is, and why the word matters

`worklog.jsonl` is not a database and not a log. It is the image of a pure
function applied to recorded inputs:

```text
worklog.jsonl = project(events.jsonl, run-dir artifacts, checkpoint commits,
                        graph.json, refresh-meta.json)
```

Three properties follow, and they are the entire safety argument for this plane:

1. **It is regenerable.** Deleting it loses nothing. That is what makes the
   downstream store (`graph-store-port`) a materialisation rather than a system
   of record. Before the 2026-07-30 withdrawal, this property bounded the
   TerminusDB bus-factor risk to a re-materialisation instead of a rewrite.
2. **It is verifiable.** "Is the graph correct?" becomes "re-project and diff",
   which is a deterministic check rather than an audit.
3. **It has nowhere to put a model.** A projection cannot hallucinate, because
   every output field is a copy of, or a mechanical derivation from, a recorded
   input. The prohibition on LLM authorship (N2 §3, refuse-list item 1) is
   enforced by the shape of the artifact rather than by a rule someone has to
   remember.

Property 3 is why this is a projector and not an extractor. An extractor would
have the same inputs and would be free to be wrong.

## Determinism is a design constraint, not an aspiration

Byte-identical re-projection is easy to claim and easy to lose. The specific
hazards, and the rules that close them:

| Hazard | Rule |
|---|---|
| Wall-clock in the output | The projector emits no timestamp of its own. Every timestamp is copied from an event's `ts`. |
| Locale-dependent sort | All ordering is `LC_ALL=C`, byte-wise, over the record key. |
| Hash-map iteration order | Records are emitted in a total order defined on `(run, lane, attempt, record-kind, key)` — never in traversal order. |
| Floating point | No computed floats. Durations are integers copied or subtracted from recorded integers. |
| Environment leakage | Absolute paths, `$HOME`, worktree paths and hostnames never enter a record; paths are repository-relative. |
| Non-deterministic git | `git diff-tree` output is sorted; rename detection uses a pinned threshold recorded in the record set. |
| Partial writes | The projector writes a temp file and renames, exactly as the event log does. A crashed projection leaves the previous file intact. |

The `--check` mode is the enforcement: re-project into a temp file, `cmp` against
the committed one, and report the diff. It runs in the docs gate, so drift
between the log and the projection is caught by the same machinery that catches
documentation drift — and a hand-edited `worklog.jsonl` is detected on the next
gate rather than trusted forever.

## Why a sibling file, and the alternatives rejected

**Rows inside `graph.json`.** Rejected, and this is the load-bearing rejection.
Graphify rebuilds from the filesystem through its code-only update path or its
semantic extraction path. A record not derivable from a file on disk is
unspecified under an incremental rebuild, and no "preserve these nodes"
contract exists in the artifact. Injected lineage would be destroyed on a
routine refresh — silently, and at the worst possible time, since refresh is
exactly when the ids the lineage references change. Secondary: a 2.6 MiB tracked
blob written at round frequency is a merge-conflict magnet, and the repository
already has that scar (`bugeventlog.md:71-90`).

**A graphify exporter plugin.** Rejected: R7 §8.2 establishes that exporters are
not a real extension point — adding one requires a fork or an upstream PR. Taking
a fork dependency on a project with the maintenance profile R7 documents, in
order to write a file we can write ourselves, is a bad trade.

**`graphify export neo4j` / `falkordb` / `cypher.txt` as the interchange.**
Refused outright, per refuse-list item 7 and R7 §8.3: five fields survive the
export, and `source_file`, `source_location`, `confidence_score`, hyperedges and
communities do not. The audit trail is the thing being built here; an export that
destroys it is not an option at any convenience.

**TerminusDB as the write target.** This option was rejected for this package
and deferred to `graph-store-port`. The backend was withdrawn on 2026-07-30. The
proposed store was a queryable materialisation, never the system of record
(SYNTHESIS §0.3). Writing the projection to files first means the context
builder and the gate never block on the store, and a store that dies costs a
re-materialisation.

**Appending records as the lane runs.** Rejected. It introduces a write path that
can fail inside the round, contends with the event log, and makes the artifact a
function of execution order rather than of the log. N4 §9.3 poses the same choice
for the gate's run subgraph and reaches the same answer: building from
`events.jsonl` on demand is consistent with Foreman's degrade-and-continue
posture. The projection is a pure function run after the fact, and a projection
failure cannot affect a run.

**Line numbers as identity.** Rejected. `source_location` drifts on every edit;
R5 §9.1 lists it as the unstable half of the knowledge-plane id space. Identity is
the graphify node id — path plus symbol, content-independent, NFKC-normalised,
casefolded. Line numbers are carried as provenance only, never as keys.

**Re-modelling git commit ancestry as graph edges.** Refused, per refuse-list
item 19. Git already answers children, leaves, lineage and diff; R1 measured the
AgentHub equivalent as three SQL statements over a two-column table. Duplicating
ancestry into the projection buys nothing and adds a synchronisation failure mode.
`Commit` references in the projection are shas, and the sha is the join to git.

## Where this diverges from R1's commit DAG, deliberately

R1's asymmetric publication rule is the sharpest idea in the primary source:
*"Post EVERY result — including failures and discards"* to the message board, but
*"Only push improvements"* to the git tree. Negative results go to the board;
positive results go to the DAG. R1 measures the payoff — the DAG's value density
is roughly 18× the raw attempt stream, because it records what worked rather than
what was tried.

**This projection records every attempt, including the discards.** That is a
deliberate divergence, and the reason is the question being served. Foreman's
motivating queries — *which findings recur*, *which spec patterns produce escaped
defects*, *what did we believe at round 3* — are questions **about the failures**.
A DAG of successes cannot answer any of them.

What is adopted instead is the *separation*, not the discarding: every record
carries an outcome status, so a consumer wanting R1's clean monotone improvement
structure filters for it, and a consumer studying failure modes filters the other
way. R1's board was unstructured prose joined to commits by a `commit:<hash>`
naming convention with **no foreign key** — that is the part worth not copying.
Here the failures are in the same typed record space as the successes, with real
join keys, and the value-density cost is paid at query time by a filter rather
than at write time by a deletion.

## The two amendments from R7, and why each is not optional

R7 §8.5 verified graphify's id derivation in code: `id = normalize(path without
extension + symbol)`, NFKC-normalised and casefolded, idempotent. Ids survive
content edits, formatting churn, a different machine, a different checkout
directory, and Unicode variance. Two cases break them.

**A file move re-IDs the file node and every symbol in it.** So an id change is
ambiguous between "this entity was deleted and another created" and "this entity
moved". Projecting it as delete-plus-create severs every historical `modified`
edge from the thing it described, which is precisely the lineage this plane
exists to hold. The projection therefore emits a rename record carrying the old
id, the new id, and the commit that caused it, and historical records keep their
original ids — a query traverses the rename chain rather than being silently
rewritten. This is also why the projection consumes
`knowledge-plane-refresh`'s `renames` map instead of guessing at renames itself:
the refresh already computes it with `git diff --find-renames` at the moment it
has both graph states in hand.

**A graphify version upgrade can migrate the entire id space.** This is not
hypothetical — R7 records it happening at upstream #1504, when the stem recipe
widened from immediate-parent to full path. `graph.json` does not record the
producing version. So every record stamps the `graphify_version` from
`refresh-meta.json`, and an id-space migration becomes diagnosable — a record
stamped with a prior version is a record whose ids must be resolved through the
migration, not compared directly.

Neither amendment costs anything at projection time. Both are unrecoverable if
omitted, because the information exists only at the moment of the change.

## The symbol-refinement rule, stated exactly

For each path in `git diff-tree --name-only <checkpoint>`:

1. Resolve the file node by `source_file` equality against `graph.json`.
2. Refine to the symbol node whose `source_location` line number is the greatest
   one at or before the first changed hunk line for that file.
3. **If no symbol matches, fall back to the file node. Never guess.**
4. If the path is not represented in `graph.json` at all, emit a path-keyed
   placeholder marked unrepresented, and count it.

Step 4 exists because graph coverage is partial by measurement: R5 §4.3 found the
graph references 358 distinct `source_file` values against 471 tracked files —
about 76%. A placeholder that says "not in the graph" is honest; a silently
dropped edge is a hole in the lineage that nothing reports.

## What this can newly answer

Only what follows mechanically from a recorded input:

- which vendor and model produced a given attempt, and what it cost;
- which files and symbols an attempt touched, at zero token cost;
- which verdict evaluated which attempt, under which auditor;
- which gate decision gated which attempt, and on which reasons;
- which findings recur across runs, by content-hashed id;
- which attempt superseded which, and from which base each descended;
- cross-run: which runs and which vendors have touched a given file or symbol;
- how much of the record the projection consumed, and therefore whether it is
  current.

## What this still cannot answer — the honest list

Every item is a gap in the *inputs*, not in the projector. None is closable by
making the projection cleverer, and each names what would close it.

1. **Which spec produced this attempt.** `prompt.payload.cmd` records argv. For
   `grok --prompt-file SPEC` the spec content sits behind a path in a worktree
   that may since have been deleted. Until specs are content-hashed at dispatch,
   spec identity is a path string, not a reference. (R5 §3.2 gap 6.)
2. **Rework causality.** Nothing links attempt 3 to *the finding in attempt 2
   that caused it*. The projection can place both in the DAG and order them; it
   cannot assert the causal edge without inventing it. Closable only by recording
   an `addresses` reference at dispatch.
3. **Cross-lane relationships.** Two lanes racing the same spec share no
   identifier today, so the projection cannot group them. Closable by a task or
   spec id emitted at dispatch.
4. **Human decisions.** The architect's merge, ask or never call under
   `[audit.policy]` is doctrine consumed by a model and never recorded; a human
   override of a gate outcome leaves no event. The DAG will show the outcome and
   not the decision.
5. **Why a symbol changed.** `modified(attempt, node)` is mechanical; the reason
   is prose in a report, and the projector does not read prose. This is a
   permanent boundary of the design, not a gap to close — reading the prose is
   what the knowledge plane's slow cadence is for, and its output is advisory.
6. **Whether two findings are the same finding.** `JK-4` hashes file, line and
   normalised summary. A reworded finding is a new id, so measured recurrence is a
   floor and not a truth. The raw text is retained so a split is visible.
7. **Anything from rounds that ran without durable lanes.** No events, no
   projection. Coverage equals the durable-lane share of dispatches, which the
   projection reports as a number rather than hiding.
8. **Symbol-level attribution for unrepresented or stale files.** About 76% of
   tracked files are in the graph; the rest get file-path placeholders. A graph
   staler than the checkpoint attributes to the symbols that existed at build
   time, and the record says which build it used.
9. **Line-level history across a file move.** The rename record preserves the
   lineage, but historical records still carry pre-move ids, so a query must walk
   the rename chain. Nothing rewrites history.
10. **Whether any of it is true.** The projection is a faithful restatement of
    the log. If a round degraded, if `round_done` is missing, if the log's tail
    was torn at read time, the projection is wrong in exactly the same way — and
    marks the affected records incomplete rather than repairing them. A
    projection is only as honest as its inputs, and its job is to not add
    dishonesty.

## Risks

- **Silent staleness.** A projection consumed as current when the log has moved
  on. Mitigation: the consumed event offset is on every record, and `--check`
  reports both drift and staleness.
- **Hand-edited `worklog.jsonl`.** Mitigation: `--check` in the docs gate makes
  the edit a failure rather than a fact.
- **Coverage misread as completeness.** A DAG that silently omits non-durable
  rounds looks like a complete record of the release. Mitigation: coverage is a
  reported number, and consumers are specified to surface it.
- **Id churn under a graphify upgrade.** Mitigation: the version stamp plus the
  rename-with-lineage rule; a cross-version comparison without resolving the
  migration is a detectable error rather than a wrong answer.
- **Scope creep into a store.** The temptation to add indexes, then queries, then
  a schema. Mitigation: the reconstructible-and-diffable invariant is the
  boundary — anything that cannot be regenerated from the log belongs to
  `graph-store-port`, not here.
