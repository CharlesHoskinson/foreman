# Tasks — knowledge-plane-refresh

Ordering note: T1 is a measurement and runs first because the package's central
claim is currently code-derived rather than observed. T2-T4 are serial (they
build `graph-refresh.sh` and its pin and lock). T5-T9 may run in parallel once
T4 lands. T10 is the gate.

Precondition: `lock-primitive-hardening` has landed. T4 builds on `lib/lock.sh`.

## T1 — reproduce the concurrency claim before building on it

- [ ] Two-process write race against a scratch corpus: two writers each add
      disjoint nodes to the same `graphify-out/`, both via the skill/`extract`
      path that takes no lock.
- [ ] Record whether the second writer's document discards the first's nodes,
      and whether the shrink guard fires. The prediction is: discards, and does
      not fire.
- [ ] IF the prediction is wrong, stop and report — the single-writer
      requirement's justification changes and the spec must be amended before
      implementation continues.
- [ ] Record the measurement, the host, the graphify version and the date in
      `env/reference-manifest.toml` next to the pin.

## T2 — the refresh driver

- [ ] Create `skills/foreman/scripts/graph-refresh.sh` with a top-of-file purpose
      comment and shdoc headers on every function.
- [ ] `--cadence merge` runs the AST-only incremental update; `--cadence slow`
      runs semantic extraction, clustering and labelling.
- [ ] `--directed` passed to every build and diagnose invocation.
- [ ] Read `cost.json` before and after; assert a zero token delta on the merge
      cadence; treat an absent `cost.json` as a zero baseline and create it.
- [ ] Publish-or-refuse: on any gate failure, leave the previous `graph.json`
      untouched and exit non-zero with the failing counter named.
- [ ] Never pass `--force` / `GRAPHIFY_FORCE=1` without recording the reason in
      `refresh-meta.json`.

## T3 — pin the interpreter and the version

- [ ] Add a `[graphify]` block to `env/reference-manifest.toml`: required
      version, the interpreter resolution rule, and the recorded hazard that
      three versions coexisted on the reference box (0.9.16 PATH / 0.9.18
      python3 / 0.9.15 skill) with the date.
- [ ] Resolve the interpreter from `graphify-out/.graphify_python`, falling back
      to the manifest. No candidate loop.
- [ ] Refuse to run when the resolved version differs from the pin; report both
      versions and the interpreter path.
- [ ] Report the graphify version as a row in `env/tool-check.sh`'s inventory.
- [ ] Run `graphify install` as part of adopting the pin so the skill version
      stops disagreeing with the package version.

## T4 — single-writer discipline

- [ ] Every write path in `graph-refresh.sh` acquires the Foreman graph lock via
      `lib/lock.sh`; exactly one unconditional release on every exit path.
- [ ] Readers (`query`, `path`, `explain`, the MCP server, the context builder)
      do not take the lock — document this asymmetry where the lock is defined.
- [ ] Bounded acquire timeout with a named error; never an unbounded wait.
- [ ] Add a comment at the lock site stating explicitly that the shrink guard is
      not a concurrency control and why.

## T5 — health gate and the metadata sidecar

- [ ] Run `graphify diagnose multigraph --json --directed` against the candidate
      artifact, not against the pre-build extraction dictionary.
- [ ] Refuse to publish on non-zero `dangling_endpoint_edges`,
      `missing_endpoint_edges`, `non_object_edges`, or either collapsed-edge
      counter.
- [ ] Create `graphify-out/refresh-meta.json`: `graphify_version`, interpreter
      path, `built_at_commit`, `directed`, cadence, timestamp, all health
      counters, non-isolated-node fraction, token cost, cohesion map, community
      labels, `renames`, and `last_refresh_failed`.
- [ ] Lift cohesion and community labels out of `.graphify_analysis.json` before
      any cleanup step deletes it; record unavailability honestly if it is
      already gone.
- [ ] Update `.gitignore` so `refresh-meta.json` is tracked while
      `graphify-out/.graphify_*` stays ignored.

## T6 — freshness contract

- [ ] Create `skills/foreman/scripts/graph-freshness.sh` using only git and
      `jq`: ancestor check, commit drift, count of tracked files absent from the
      graph's `source_file` set.
- [ ] Report a non-ancestor `built_at_commit` as *unrelated*, distinct from
      *stale*.
- [ ] Wire the check into `merge-gate.sh`: attempt the refresh; BLOCK on a
      refresh that ran and failed; record `SKIPPED` plus drift when graphify is
      absent.
- [ ] Add the freshness check to `.github/workflows/maintenance.yml` — it needs
      no graphify, so it works in CI where the refresh does not. Leave the
      refresh out of CI and leave the existing comment's reasoning intact.

## T7 — rename lineage

- [ ] Compute the rename set with `git diff --find-renames` over the refreshed
      commit range.
- [ ] Emit `renames` in `refresh-meta.json` mapping old to new node IDs for the
      file node and every symbol derived from it.
- [ ] Record unmappable symbols explicitly with both paths; never guess.
- [ ] Test with a real move of a multi-symbol script.

## T8 — the slow cadence

- [ ] `--cadence slow` entry point plus the scheduling hook (nightly or
      pre-release; the release checklist gains the step).
- [ ] Record token cost; mark community labels, cluster membership and cohesion
      advisory in `refresh-meta.json`.
- [ ] Ensure `_origin` remains the discriminator between AST and LLM records
      through the merge, and assert it in a test.
- [ ] Reject any gate citation that resolves to an advisory record.

## T9 — ban the lossy export path

- [ ] Docs-gate rule failing on `graphify export neo4j` / `export falkordb` /
      `cypher.txt` outside the paragraph that documents the ban.
- [ ] Record the fidelity table (five values survive; the audit trail does not)
      in the doc that states the ban, so the next reader does not re-derive it.
- [ ] Update `skills/foreman/SKILL.md:87-91` and `README.md:595-605`: the graph
      doctrine now names `graph-refresh.sh` rather than a bare
      `graphify --update`, and states that `graph.json` is the only supported
      downstream source.

## T10 — gate

- [ ] `tests/graph-refresh.bats`: pin refusal on version mismatch; refusal on a
      non-zero collapsed-edge counter; refusal on dangling endpoints with the
      previous graph left intact; zero-token assertion failing on a seeded
      non-zero delta; lock serialisation under at least two concurrent writers
      adding disjoint nodes; rename map correctness; cohesion captured before
      cleanup.
- [ ] The concurrency test SHALL fail against an unlocked writer — prove it
      detects the defect, do not merely observe it passing.
- [ ] First directed refresh lands as its own reviewable commit, with the
      node/edge delta versus the undirected build stated in the commit message.
- [ ] Freshness after the first automated refresh is zero commits of drift and
      zero unrepresented tracked source files; state both numbers.
- [ ] `shellcheck` clean on `graph-refresh.sh`, `graph-freshness.sh` and the
      modified `maintenance.sh`.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate knowledge-plane-refresh --strict` passes.
- [ ] `bugeventlog.md` entry appended: manual-refresh drift as a workflow failure
      class, with the measured 3-commit / 26-file evidence, root cause, impact
      and the enhancement.
