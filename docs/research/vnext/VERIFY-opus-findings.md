# Architect verification of REVIEW-opus.md blocking findings

Opus returned APPROVED-WITH-FIXES with six blocking findings. Foreman doctrine
is that an auditor's verdict is a claim with provenance, not an unexamined
gate — so the mechanically checkable findings were re-verified by the architect
against the live tooling before being accepted. Recorded 2026-07-28.

## Finding 1 — CONFIRMED, and the real mechanism identified

**Claim:** `knowledge-plane-refresh`'s `--directed` mandate is unimplementable;
`--directed` exists only on `diagnose multigraph` as a post-build simulation.

**Verified.** `graphify --help` on the installed 0.9.16:

```
diagnose multigraph    report same-endpoint edge collapse risk in graph.json
  --graph <path>          path to graph/extraction JSON
  --json                  emit machine-readable JSON
  --max-examples N        max same-endpoint examples to print (default 5)
  --directed              force directed post-build simulation
  --undirected            force undirected post-build simulation
```

`graphify update` accepts only `--force` and `--no-cluster`. So the package as
written mandates a flag the refresh command does not have, and gates publication
on a counter produced by simulating directedness over a graph whose parallel
edges have **already collapsed** — a check structurally incapable of observing
what it gates, sitting in the merge path. Opus is right, and the severity is
correctly stated.

**The fix Opus did not supply.** Directed construction is real, but it lives in
the Python API, not the CLI: the graphify skill's Step 4 calls
`build_from_json(extraction, root=..., directed=IS_DIRECTED)`, and the skill
documents `--directed` as a *skill-level* build option ("build directed graph
(preserves edge direction: source→target)"). So `knowledge-plane-refresh` must:

1. Specify the refresh as a call into `build_from_json(..., directed=True)`
   (pinned interpreter, per the package's own version-pinning requirement),
   **not** as `graphify update --directed`.
2. Keep `diagnose multigraph` as a **post-build assertion** that collapse did
   not occur — which is what it is actually for — rather than as the mechanism
   that produces directedness.
3. Add a requirement that the published `graph.json` carries `directed: true`,
   which is directly checkable with `jq` and is the honest gate. The committed
   graph today is `directed:false, multigraph:false`.

This also repairs the downstream citation: `graph-context-builder`'s `edge_key`
rationale cites the `--directed` mandate, and inherits the defect until fixed.

## Finding 6 — CONFIRMED (arithmetic), partially my error

`LANDING-ORDER.md` says 24 live packages / 13 authored / 11 pre-existing. It was
written when 24 existed; GP-2 and GP-4 landed afterwards, making the true count
**26 live / 16 authored / 10 pre-existing** — which matches
`ls openspec/changes | grep -vc archive` = 26 and the 16 that validate strict.
The document is stale, not wrong-at-the-time, but it is wrong now and must be
corrected. `hard-mode-launcher` and `v030-soft-mode-report` appearing in no
stage is a genuine omission.

## Findings 2-5 — ACCEPTED without independent re-verification

2. The `audit-run.sh:31-33` contradiction between `cross-vendor-audit-routing`
   T4 ("replaced") and `audit-groundedness-gate` T4 ("stays as-is… do not
   delete one for the other") is a direct textual contradiction between two
   packages in adjacent stages, which the serialisation rule does not catch.
   Two lanes authored these independently; that is exactly the class of defect
   a cross-package review exists to find.
3. `doctrine-reality-drift` at S4 failing closed on claims owned by S5/S6/S9 is
   a real ordering deadlock. The `closes_in` column is the cheaper fix.
4. `graph-eval-falsification` not importing the PM's already-fixed thresholds,
   while carrying a clause invalidating unregistered criteria, is
   self-defeating. K-2 and K-8 having no owner is a genuine gap.
5. The census cannot gate the store when both sit at S8 and the census needs a
   full release of data. This one is load-bearing for the scope decision below.

## Consequence for the TerminusDB decision

Finding 5 says the store's stated gate is unexecutable in v0.2.9, and Opus
recommends deferral more strongly than the PM did.

**The owner has decided TerminusDB ships.** That decision stands and the council
is authoring against it. What finding 5 changes is not *whether* the store
lands but *what may be claimed for it*: the query census cannot return a verdict
inside this release, so v0.2.9 must not assert that the store was validated by
the census. The honest framing is that the store ships on R8's live evidence —
ontology loaded, all three lineage queries correct first attempt, 12/12
concurrent writers, time-travel verified — with the census reporting in v0.3.x
and the tripwires and rehearsed files-only exit standing in the meantime.

Opus's Q1 amendment is adopted regardless of scope: **keep the query wrapper and
the non-emptiness contract in scope**, because "no rows" from `jq` is exactly as
ambiguous as an empty WOQL binding. That is a files-only concern too.

## What Opus got right that is worth keeping

Evidence fidelity: 24 claims sampled, 23 reproduced exactly. The one class of
error found was in my own `LANDING-ORDER.md` contention table, which counts
*mentions* rather than *modifications* — so `test-infrastructure-hardening`
appears as a `tool-check.sh` claimant on the strength of a sentence saying it
does **not** touch that file. The eight-way contention figure I reported is
therefore an overcount, and the serialisation rule it justified should be
re-derived from actual modification claims.
