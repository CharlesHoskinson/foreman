# Tasks — work-dag-projection

Ordering: T1 is the input audit and blocks everything — if the events this plane
projects are not in the log, the projection is empty and the work is wasted. T2
is the record schema. T3-T5 are the projector proper and are serial. T6 is
determinism, and it is where this package earns its invariant. T7 is wiring and
honesty reporting. T8 is the gate.

**Do not start before `decision-lineage-and-telemetry` has merged.** Without the
vendor, model, usage, universal attempt, verdict, finding and gate-decision
events, this projection produces a work DAG with no decisions in it.

**Do not start before `knowledge-plane-refresh` has merged.** Without an
automated refresh, `--directed` in force, a pinned graphify version and the
rename map, the node ids this projection keys on drift out from under it.

## T1 — audit the inputs before writing a projector

- [ ] Confirm every event type and payload key this plane projects is actually
      emitted: `vendor`, `model`, `usage`, universal `attempt`, `audit_verdict`,
      `finding`, `gate_decision`. Record file:line evidence for each.
- [ ] Confirm `graphify-out/refresh-meta.json` carries `graphify_version` and the
      `renames` map.
- [ ] Confirm checkpoint refs resolve to real commits and that `git diff-tree`
      over one yields repository-relative paths.
- [ ] Measure current graph coverage: distinct `source_file` values in
      `graph.json` against `git ls-files`. Record the number; it is the ceiling on
      symbol-level attribution.
- [ ] IF any input is missing, STOP and report which package owes it. Do not
      synthesise it here.

## T2 — the record schema

- [ ] Define the record kinds: attempt, verdict, gate decision, finding, rename,
      coverage, and the edge kinds `modified`, `produced`, `evaluated_by`,
      `gated_by`, `descends_from`, `about`, `supersedes`, and the per-round
      hyperedge over spec, implementer, gate, auditor and merge.
- [ ] Every record carries: the canonical work id, the consumed event sequence,
      the producing graphify version, and an outcome or status field.
- [ ] Findings carry the content-derived id and the retained raw text.
- [ ] Records carry references and digests only — never diff text, prompt text,
      transcripts or file contents.
- [ ] Document the total record ordering key and freeze it; the determinism
      invariant depends on it.

## T3 — the projector core

- [ ] Create `skills/foreman/scripts/graph-project.sh` with shdoc headers on every
      function and a top-of-file purpose comment.
- [ ] Read the run's event log through the existing replay helper; tolerate a torn
      tail by projecting the valid prefix and marking the set incomplete.
- [ ] Take no event-log lock. Open `graph.json` and `refresh-meta.json` read-only.
- [ ] Project attempts, verdicts, gate decisions and findings with their edges.
- [ ] Mark, never infer: an absent input produces an incomplete record naming the
      missing input.
- [ ] Write through a temp file and an atomic rename; a crash leaves the prior
      file intact.

## T4 — the checkpoint bridge

- [ ] For each attempt, resolve its checkpoint shas and run `git diff-tree
      --name-only` over them; sort the output.
- [ ] Resolve each path to a node by `source_file` equality.
- [ ] Refine to the symbol node with the greatest `source_location` at or before
      the first changed hunk line.
- [ ] Fall back to the file node when no symbol matches, and record that no symbol
      matched. Never select a different symbol.
- [ ] Emit a path-keyed unrepresented record when the path is absent from the
      graph, and count it.
- [ ] Carry changed line ranges as provenance only; never key on them.

## T5 — rename lineage and the version stamp

- [ ] Consume the rename map from `refresh-meta.json`; do not implement rename
      detection here.
- [ ] Project an id change caused by a move as a rename record carrying prior id,
      new id and causing commit.
- [ ] Never emit delete-plus-create for a move.
- [ ] Never rewrite a previously projected record.
- [ ] Stamp `graphify_version` on every record referencing a node id; stamp an
      explicit unknown when the metadata is absent.

## T6 — determinism, and the check mode that proves it

- [ ] No projector-generated timestamps; every timestamp copied from an event.
- [ ] `LC_ALL=C` byte-wise ordering over the frozen record key.
- [ ] No absolute paths, home directories, worktree paths or hostnames in any
      record.
- [ ] Pin and record the rename-detection threshold used.
- [ ] Implement `--check`: re-project to a temp file and diff against the current
      one; report the difference, never silently reconcile it.
- [ ] Test byte-identity across two runs, and across two checkout directories, on
      the same recorded inputs.
- [ ] Add `--check` to the docs gate so a hand edit or a drifted projection is a
      failure rather than a fact.

## T7 — wiring, coverage and honest reporting

- [ ] Add a projection stage to `maintenance.sh` beside the knowledge-plane
      refresh stage.
- [ ] Support projecting a single run on demand.
- [ ] Report coverage: attempts projected, records incomplete, paths
      unrepresented, and whether the run used durable lanes.
- [ ] A run with no events reports zero attempts and the reason — never an empty
      result presented as a clean one.
- [ ] Document the plane in `references/durable-lanes.md` and the README graph
      section: what it answers and what it does not.
- [ ] Publish the "still cannot answer" list from `design.md` alongside the
      artifact, so a consumer reads the limits with the data.

## T8 — gate

- [ ] `tests/graph-project.bats` green, including: byte-identical re-projection,
      cross-directory identity, torn-tail partial projection, symbol fallback,
      unrepresented path counting, rename lineage, unknown version stamping, and
      coverage reporting on a non-durable run.
- [ ] Prove the purity claim: after a projection, the event log and `graph.json`
      are byte-identical to their pre-run contents.
- [ ] Prove the isolation claim: a forced projector failure changes no gate
      decision and no merge outcome.
- [ ] Prove the sibling claim: a graphify refresh leaves `worklog.jsonl`
      unchanged and every record still resolvable.
- [ ] `shellcheck` clean on `graph-project.sh`.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate work-dag-projection --strict` passes.
- [ ] `bugeventlog.md` entry appended recording the gap this package closes and
      the gaps it explicitly does not.
