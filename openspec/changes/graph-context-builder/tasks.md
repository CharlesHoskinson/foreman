# Tasks — graph-context-builder

Ordering note: T1 is a prerequisite for everything (nothing can be cited until
edges have identity). T2-T5 are serial along the pipeline. T6-T9 may run in
parallel once T5 lands. T10 is the gate.

Preconditions: `knowledge-plane-refresh` (GP-3) has landed, so the graph is
version-stamped, freshness-measurable and single-writer safe;
`work-dag-projection` (GP-4) has landed, so `worklog.jsonl` exists. Note what
GP-3 does **not** provide: the published artifact carries `"directed": false` —
no graphify CLI cadence can publish anything else — and direction is
reconstructed here at load with `build_from_json(raw, directed=True)`. This package does **not** wait on
`graph-store-port` (GP-6) and must not acquire a dependency on it.

## T1 — edge identity

- [ ] Implement `edge_key` = truncated `sha256(source ‖ target ‖ relation ‖
      source_file ‖ source_location)`, computable from `graph.json` alone.
- [ ] Verify against the committed graph that the key is unique across all links
      — report any collisions rather than truncating harder to hide them.
- [ ] In-block short aliases (`e01`, …) plus the alias-to-`edge_key` table, with
      the table inside the content hash.
- [ ] Confirm that two edges differing only in `source_location` get distinct
      keys.
- [ ] Document the key recipe in `skills/foreman/references/graph-context.md` so
      a consumer can recompute it without the builder.

## T2 — seed resolution and role scoping

- [ ] Extract surface forms from the task: spec title and body, target module
      paths, touched file paths, referenced spec/finding/claim IDs.
- [ ] Vocabulary expansion against the graph's label vocabulary before matching —
      the same obligation the MCP path carries; log the expansion.
- [ ] Cap the seed set at 8.
- [ ] Zero seeds emits `NO GRAPH CONTEXT` and stops. No fallback subgraph. Test
      this explicitly; it is the requirement most likely to be "helpfully"
      violated later.
- [ ] Role-scoped edge-type allowlists for implementer, auditor, synthesizer and
      planner, applied before expansion; the auditor list is the implementer list
      plus evaluation/verdict/criterion/support edges.

## T3 — candidate generation and ranking

- [ ] Load `graph.json` with `build_from_json(raw, directed=True)` under the
      pinned interpreter; never branch on the artifact's `directed` field, which
      is `false` on every merge-cadence refresh. Test that `u → v` is present
      and `v → u` absent after the load.
- [ ] 2-hop bounded expansion from the seeds over the allowlist; hard bound k=2.
- [ ] Candidate cap with truncation by hop distance then ascending degree; set
      the `truncated` flag.
- [ ] Linear scorer: task-text relevance, directional distance features from each
      seed with direction, verified status. Recency weight present but defaulted
      to zero and labelled unvalidated.
- [ ] No PPR, no PageRank, no GNN. Add a comment at the scorer naming the
      measurements that closed each option so the next author does not re-open
      them.
- [ ] Top-K selection with `K = floor(budget/14)`, clamped to `[40, 290]`.

## T4 — serializer

- [ ] Subject-grouped arrow DSL with inline aliases as the default serializer,
      behind one replaceable function.
- [ ] Measure tokens/edge on our own graph with the tokenizers of the vendors we
      ship, and record the number — do not inherit 13.7 as a fact about our
      corpus.
- [ ] Assert the emitted block's token count against its stated budget; the block
      states served edges, tokens and budget.
- [ ] Hard cap at 4,000 tokens regardless of configuration, with the clamp
      recorded in the block.

## T5 — assembly and layout

- [ ] Task restated first and last.
- [ ] Groups ordered ascending by highest member score.
- [ ] Conflicts block: separately headed, explicitly labelled as disputes, ≤10
      edges, outside the K budget, never interleaved.
- [ ] Pinned artifact-version block: ≤10 edges, marked unvalidated.
- [ ] Freshness stamp from `graphify-out/refresh-meta.json` in every block.
- [ ] Citation contract text plus at least one worked demonstration.

## T6 — deterministic verification

- [ ] Post-run verifier producing `HALLUCINATED_EDGE_ID`,
      `OUT_OF_CONTEXT_CITATION` and `UNSUPPORTED_CLAIM`.
- [ ] Exact lookups only; no model, no entailment judgement, in that path.
- [ ] Verdict contract gains `cited_edges` and `uncited_claims`; a lane that
      returns neither is recorded as uncited rather than accepted.
- [ ] Results written to the run record and exposed to `gate-eval.sh`.
- [ ] Keep the verifier out of any selection or reranking loop — a checker used
      to optimise output is no longer usable to evaluate it.

## T7 — absence and contradiction queries

- [ ] Deterministic queries over `graph.json` + `worklog.jsonl` for missing
      required evidence and for contradictory edge pairs.
- [ ] Results served as stated findings inside the block.
- [ ] Add a lint that fails on any prompt text asking a model what is missing
      from, disconnected in, or globally inconsistent about a subgraph.

## T8 — hashing, persistence and replay

- [ ] Content hash over the whole block including the alias table; hash into the
      run record; block persisted under the run directory.
- [ ] Auditor dispatch serves the implementer's persisted bytes plus the auditor
      role extension; both hashes recorded.
- [ ] Replay command: rebuild from the same graph, task, role and budget and
      compare hashes; a mismatch is a reported determinism defect.
- [ ] Determinism audit of the builder itself — no set iteration order, no
      unsorted dict traversal, no wall-clock in the hashed content.

## T9 — the MCP escape hatch

- [ ] `skills/foreman/scripts/graph-mcp.sh`: read-only wrapper doing vocabulary
      expansion, logging it, returning structured JSON with node IDs and source
      locations.
- [ ] Fail loudly on empty expansion; never return a prose string to a lane.
- [ ] ~40-edge result cap, charged against the lane's graph budget.
- [ ] Available only in the four justified situations; the wrapper refuses
      otherwise and names the reason.
- [ ] Instrument whether `truncated == true` actually predicts escape-hatch use —
      GP-7 consumes this, and if the correlation is absent the hatch should be
      removed rather than kept for symmetry.

## T10 — gate

- [ ] `tests/graph-context.bats`: zero-seed marker with no fallback; K clamping
      at both ends; hard cap under a misconfigured budget; conflicts never
      interleaved; ordering places the top group last; alias/`edge_key`
      round-trip; all three verification codes fired by constructed inputs;
      replay hash stability; auditor served identical bytes.
- [ ] Each verification code test SHALL be shown to fail when its check is
      disabled — prove the checks detect the defect.
- [ ] One end-to-end run on a real task: block built, lane dispatched, citations
      verified, hashes recorded, replay reproduces the hash. Record the served
      edge count and token count.
- [ ] `shellcheck` clean on every new and modified script; shdoc headers on every
      function.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate graph-context-builder --strict` passes.
- [ ] Assert no code path in this package reads the `directed` field of
      `graph.json` — direction comes from the load, not from the artifact's
      self-description.
- [ ] Confirm no import, config key or code path in this package references the
      graph store — the files-only boundary is a deliverable, not an intention.
- [ ] Record in `skills/foreman/references/graph-context.md` that this package
      claims citation precision and multi-hop outcomes only, and does not claim
      reduced hallucination.
