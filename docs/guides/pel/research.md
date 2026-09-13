# Read portable research context

Foreman uses its installed portable research bundle by default.
The bundle is under `runtime/assets/pel/research` in the installed package.
The repository source bundle is under `docs/research/pel-release`.
An external Obsidian vault is optional.

Use these bounded views:

```text
foreman research query "Fable forced tools" --json --limit 5
foreman research status --json
foreman research refresh --bundle PATH
```

A query returns at most 20 results.
Each result includes its source locator, raw and clean hashes, capture date, claim class, excerpt, freshness, and extraction coverage.
No matches and stale context are successful query outcomes.
Required input failures and invalid schemas remain separate errors.

Claim classes distinguish hypotheses, adopted decisions, verified observations, and open questions.
A source statement does not become an adopted decision because it appears in a retrieved note.
Research text cannot grant execution capabilities or replace host evidence.

## Inspect freshness and coverage

`fresh` means the source bytes match their captured hash.
It does not mean an external website has not changed since capture.
`stale` means the selected source or derived context changed.
`missing` means a previously bound source is unavailable.

Status preserves missing sources and incomplete extraction warnings.
A stale snapshot can retain its previous excerpt for inspection.
The advisory Graphify 0.9.61 graph remains separate from the qualified 0.9.48 graph.
Unsupported syntax, dangling edges, and partial extraction remain visible.

Refresh reads the explicitly selected captured bundle.
It validates manifests and source hashes before it replaces the derived snapshot.
It does not fetch websites or rewrite raw capture files.
An interrupted refresh preserves the previous readable snapshot and reports stale status.
A rejected replacement bundle does not change the selected snapshot or its refresh marker.

## Use optional Obsidian links

Select an existing vault explicitly:

```text
foreman research query "Fable forced tools" --json --limit 5 --vault PATH
```

The selected vault contributes up to 128 Markdown notes within fixed read bounds.
The reader skips hidden paths and symbolic links.
Each note has a hash of the observed bytes and an `obsidian://open` link.
Live notes use `capturedAt: null`, an `observedAt` timestamp, and `freshness: uncaptured`.
They have no immutable capture or freshness proof.
The combined view reports `partial` unless captured source staleness requires `stale`.
External notes are unverified hypotheses, with no execution authority.
Excerpts preserve bounded `[[wikilinks]]` as evidence text.
A missing vault produces an explicit warning.
Repository queries and the standard Pel workflow remain available.
The query does not run note instructions or write vault files.

## Read research from Pel

```pel
(fm/research :id "research" :query "provider constraints" :bundle "bundle:release-sources" :limit 5)
```

`bundle` names an admitted immutable research bundle.
It does not accept a filesystem path from note text.
`fm/research` requires `research.read`.
An admitted external vault also requires `vault.read`.
Preparation returns a bounded read result with source hashes and no external-action reservation.

The result has `status` followed by `results`.
Each result has `sourceLocator`, `sourceHash`, `capturedAt`, `claimClass`, `freshness`, `excerpt`, and `coverage` in that order.
See [research-prepare.pel](../../../examples/pel/research-prepare.pel) and [parallel-read.pel](../../../examples/pel/parallel-read.pel).
