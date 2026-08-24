# Proposal: qualify the v0.4 knowledge plane

## Why

Foreman needs a current, source-located code graph, but Graphify is derived and
replaceable. The v0.4 release must qualify Graphify 0.9.48 before it adopts a
new graph and must remain useful when no qualified graph is available.

The prior package mixed this release requirement with new Bash entry points,
semantic extraction, nightly scheduling, and a private cache layout from
Graphify 0.9.16. Those assumptions conflict with the v0.4 release design and
with the repository's Node 24 implementation boundary.

## What changes

- Pin one Graphify 0.9.48 interpreter in the reference manifest.
- Add a TypeScript qualification core and live CLI.
- Build code-only candidates in isolated temporary destinations.
- Compare two normalized candidate graphs and health reports.
- Refuse nondeterminism, model-token use, invalid source locations, endpoint
  loss, duplicate ordered pairs, dangling edges, wrong versions, and stale
  source identity.
- Serialize publication with one repository-wide advisory lock and atomically
  publish only a qualified graph and canonical metadata.
- Add a Graphify-free freshness check and preserve direct-source fallback.
- Track only `graph.json` and `refresh-meta.json`; keep caches and temporary
  Graphify state ignored.

Semantic extraction, community labelling, scheduled refreshes, and external
graph-database exports are outside v0.4.

## Capabilities

### New capability

- `knowledge-plane-refresh`: deterministic Graphify qualification, publication,
  freshness, and graph-independent fallback.

### Modified capability

- `maintenance`: reports qualified graph freshness without running Graphify.
