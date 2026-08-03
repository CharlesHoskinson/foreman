# Change: work-dag-projection

## Why

**Foreman has a high-quality per-run execution trace and no work DAG.**

`events.jsonl` is the source of truth for durable lanes, and R5 §3.1 shows it
already answers ten lineage questions with `el_read` and `jq` alone: what command
started attempt N of lane L, which checkpoint a round produced, whether the round
was launcher-owned or degraded, which process owned a lane, how many attempts a
lane consumed, whether it was resumed, what base it was dispatched from, where it
stalled, whether it ended without a fresh report, and the full ordered wall-clock
reconstruction.

R5 §3.2 lists what it cannot answer, and the shape of that list is the point:
**there are no edges between runs.** `seq` and cursors are per-run; there is no
index over runs, no parent-run pointer, no shared identifier between two lanes
racing the same spec, and no cross-run key on a finding. So the questions this
release exists to serve — *which findings recur*, *which spec patterns produce
escaped defects*, *what did we believe at round 3* — are not queries. They are
archaeology across per-run JSON files that `wt-cleanup` eventually archives.

R5's own assessment: *"the event log is a high-quality per-run execution trace.
It is not yet a DAG."*

### The join already exists, mechanically, at zero token cost

A checkpoint is a real git commit (`lib/checkpoint.sh:42`). So
`git diff-tree --name-only` over a checkpoint SHA yields the exact set of
repository-relative paths an attempt touched — and those strings are **already
graphify's node key**, `nodes[].source_file`. Symbol-level refinement is the node
whose `source_location` line is the greatest one at or before the first changed
hunk line, with a documented fall back to the file node and **never a guess**.

That is the whole bridge. No model, no embedding, no extraction, no inference.
R5 §9.2 (JK-2) gives it explicitly, and the reason it has not been built is that
nothing writes the result anywhere.

### No LLM may author this plane

N2 §3 measured what happens when an LLM is asked to author structure: taxonomy
F1 **0.02-0.66**, axioms **0.03-0.36**, with a gibberish ablation showing the
models are lexical-prior matching rather than reasoning about structure. Foreman's
run and lane identifiers are opaque strings — exactly the adversarial input for a
lexical matcher.

SYNTHESIS §0.1 settles it: *"The work-DAG plane is a deterministic projection of
the event log. No LLM ever writes it, and it never passes through graphify."*
Refuse-list item 1 restates it as a standing prohibition. This package is the
implementation of that decision, and its design job is to make the prohibition
structural rather than aspirational — a projection has no place to put a model.

### And it cannot live inside `graph.json`

R5 §4.5 is decisive on the storage question. Graphify **rebuilds from the
filesystem** through a code-only update or semantic extraction: any node the
harness injected that is not derivable from a file on disk is unspecified under
an incremental rebuild, and nothing in the current local artifact records a
"preserve these nodes" contract. Work-DAG records written into
`graph.json` are at risk on every refresh.

The secondary reasons are as strong. `graph.json` is a 2.6 MiB git-tracked JSON
blob; appending per-attempt records at round frequency would make it a
merge-conflict magnet and inflate the repository — recreating exactly the
`wt-merge`/gitignore pathologies already logged at `bugeventlog.md:71-90`. The
event log deliberately avoids this shape: append-only JSONL, one line per event,
stored outside every worktree.

So the work-DAG is a **sibling** of `graph.json`, keyed by graphify node id, and
`graph.json` stays regenerable-from-source at all times.

## What changes

- **New `skills/foreman/scripts/graph-project.sh`** — a deterministic projector
  that reads a run's event log, the run directory's decision artifacts, and the
  checkpoint commits, and writes `graphify-out/worklog.jsonl`. It reads
  `graph.json` and `refresh-meta.json`; it never writes them, never invokes
  graphify's write path, and never calls a model.
- **`graphify-out/worklog.jsonl`** — append-only JSONL, a sibling of
  `graph.json`, one record per projected entity or edge, keyed by the JK-1..5
  identifier scheme.
- **The identifier scheme, adopted from R5 §9.2:** `JK-1` the canonical work id
  `foreman:run/<RUN>/lane/<LANE>/attempt/<N>`; `JK-2` the checkpoint-SHA bridge
  to `nodes[].source_file`; `JK-3` the reverse lookup via `payload.nodes` on
  `round_done`; `JK-4` content-hashed finding ids; `JK-5` vendor and model as
  first-class recorded keys.
- **R7's two amendments, both load-bearing.** An identifier change caused by a
  file move is projected as a **rename with lineage** carrying both ids and the
  commit that caused it, never as a delete plus a create — because graphify node
  ids are path-derived, so a move re-IDs the file node and every symbol in it.
  And every record carries the **graphify version** that produced the ids it
  references, taken from `refresh-meta.json`, because `graph.json` does not
  record it and a version upgrade has migrated the whole id space before.
- **The reconstructible-and-diffable invariant.** The projection SHALL be a pure
  function of its recorded inputs; re-running it on identical inputs SHALL
  produce a byte-identical file. Every record carries the highest event sequence
  it consumed, so "is the projection current" and "is the projection correct"
  are both deterministic checks. A `--check` mode re-projects and diffs, and the
  diff is the answer.
- **Edge vocabulary from R5 §9.3:** `modified`, `produced`, `evaluated_by`,
  `gated_by`, `descends_from`, `about`, `supersedes`, and a per-round hyperedge
  over spec, implementer, gate, auditor and merge.
- **Failures are projected, not discarded.** Every attempt enters the work DAG
  with its outcome, including the ones that were abandoned, timed out, or were
  gated out.
- **Degradation is recorded, never repaired.** A torn event-log tail, a missing
  `round_done`, a lane that ran without a launcher — the projection marks the
  affected records incomplete and carries the reason. It never infers the
  missing value.
- **Invoked from `maintenance.sh`** alongside the knowledge-plane refresh, and
  on demand for a single run.

## Impact

- Affected: `skills/foreman/scripts/maintenance.sh` (one new stage beside the
  graph stage), `skills/foreman/references/durable-lanes.md`, `README.md`'s graph
  section, `.gitignore` policy for `graphify-out/`.
- New: `skills/foreman/scripts/graph-project.sh`,
  `graphify-out/worklog.jsonl`, `tests/graph-project.bats`,
  `tests/fixtures/graph-project/**`.
- **Not affected, deliberately:** `skills/foreman/scripts/lib/eventlog.sh` and
  `graphify-out/graph.json`. The projector is a pure reader of both. It takes no
  event-log lock, writes no event, and mutates no graphify artifact. A reviewer
  should check that claim first: if the projector writes to either, the design
  has been inverted.
- **Depends on `decision-lineage-and-telemetry`.** The vendor, model, usage,
  universal `attempt`, `audit_verdict`, `finding` and `gate_decision` events must
  exist before they can be projected. Without that package this projection
  produces a work DAG **with no verdicts in it** — a record of how lanes ran and
  no record of what was decided. It is not worth building first.
- **Depends on `knowledge-plane-refresh`.** This package assumes an automated
  AST refresh, `--directed` in force, a pinned graphify version, and
  `graphify-out/refresh-meta.json` carrying `graphify_version` and the `renames`
  map. Without automated refresh the node ids drift out from under the join: R5
  §4.3 measured 26 files entirely unrepresented after only three commits. The
  projector consumes that package's rename map rather than computing its own.
- **Depends on `round-ownership-default`** for coverage. With `durable.enabled`
  false the event log is empty for most rounds, so the projection's coverage is
  exactly the durable-lane share of dispatches — a number this package reports
  rather than hides.
- **Depends on `lock-primitive-hardening`** only transitively: the projector
  reads a log written under that lock and must tolerate a torn tail rather than
  serialise against writers.
- **Consumed by `graph-context-builder` and `graph-store-port`.** The context
  builder reads `worklog.jsonl` and `graph.json` directly, so it does not block
  on a store; the store port ingests both. **This package implements neither**
  and defines no store schema, no query interface and no context format.
- Behaviour change: none to any running lane. The projector is an offline reader.
  A projection failure SHALL NOT affect a run, a gate, or a merge.
