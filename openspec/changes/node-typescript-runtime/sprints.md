# Sprint plan — Node.js and TypeScript runtime migration

## Execution rule

Run sprints in numeric order. A later sprint can start only after the earlier
sprint's immutable accepted commit is pushed. Each sprint uses Grok for
implementation, a different model family for cold audit, and Council at the
listed commitment boundary. One admissible Council `changes_requested`
verdict requires a new candidate and a new Council round.

## Sprint 0 — governance and baseline

**Outcome:** Freeze the runtime decision and remove known stale authorities.

**Work:** Add the Iron Rule, this OpenSpec, `typescriptmigration.md`, the
package-matrix row, the current Graphify inventory, and the first tracked-file
purge.

**Exit:** Strict OpenSpec, package-matrix, docs, link, and diff checks pass.
Council reviews one immutable planning commit with three admissible verdicts
from at least two non-author model-family failure domains and no unresolved
dissent.

## Sprint 1 — workspace, core, and architecture policy

**Outcome:** Establish the build and shared safe primitives before a product
port uses them.

**Work:** Add the root npm workspace, exact lockfile, strict TypeScript config,
`@foreman/core`, `@foreman/policy`, deterministic self-contained bundles, and
the installed runtime manifest.

**Exit:** Node.js 24 is enforced; clean install, type checks, unit tests,
double-build byte comparison, copied-skill smoke test, Linux policy controls,
and Windows policy controls pass. Known-bad fixtures prove every policy branch
can fail.

## Sprint 2 — GraphStore

**Outcome:** Replace the first production Python module.

**Work:** Implement the GraphStore port, closed schemas, deterministic IDs,
safe generations, files-only backend, expected-emptiness contract, and lineage
queries in TypeScript.

**Exit:** Contract, corruption, link, path, hard-link, generation, concurrency,
and query controls pass through the compiled Node.js CLI. No product caller or
current document references Python GraphStore. Delete its seven Python files.

## Sprint 3 — launcher

**Outcome:** Run Foreman supervision on Node.js without Bun-only APIs or
unreaped adopted children.

**Work:** Port CLI parsing, streams, heartbeats, timeouts, cancellation, and
platform containment capability reporting. Use Effect scopes for every owned
resource.

**Exit:** Sustained creation of more than 1,000 short descendants does not grow
the zombie count while the worker remains live. Linux/WSL and Windows controls
pass. The launcher refuses unsupported hard containment before dispatch and no
longer requires Bun.

## Sprint 4 — event log and SessionDB

**Outcome:** Put recovery and durable session authority on one typed event
foundation.

**Work:** Implement `@foreman/event-log` and `@foreman/session`. Add fact
retraction, existing-successor supersession, lossless sidecar hydration, and a
separate non-hydratable current-authority export.

**Exit:** Duplicate keys, invalid UTF-8, non-finite values, suffix data, torn
records, stale cursors, and transaction crash seams fail closed. The canonical
sidecar round-trips byte-identically. Hourly checkpoint and recovery commands
use Node.js. Delete `fm-session.py`.

## Sprint 5 — release evidence

**Outcome:** Make release measurements and package evidence typed and
deterministic.

**Work:** Implement metrics rollup, release sigma, positive-control inventory,
package matrix, immutable package audits, and Tier 2 trigger/cost finality in
`@foreman/release`.

**Exit:** Outputs bind to commit, tree, event-log digest, definitions,
denominators, and commands. Mixed or mutable sources fail. Delete both Tier 2
Python helpers and remove every planned `package-audit.py` reference.

## Sprint 6 — knowledge and doctrine

**Outcome:** Build one current knowledge unit from immutable inputs without
trusting path races or stale live prose.

**Work:** Implement Graphify contract, refresh, generations, freshness,
doctrine registry, and current-authority projection in `@foreman/knowledge`.

**Exit:** One deadline owns version, update, and diagnose. Executable identity,
Git tree, source manifest, stdout, stderr, argv, status, and artifact digests
are bound. Link races, hard links, Git failures, overflow, detached descendants,
and publication crash seams fail closed. The rebuilt graph has no current edge
to deleted sources.

## Sprint 7 — orchestration and preflight

**Outcome:** Move round recovery and environment readiness into typed modules.

**Work:** Implement round identity, recovery transactions, prompt decoding,
vendor preflight, WSL preflight, and tool-path persistence in
`@foreman/orchestration`.

**Exit:** Recovery identities are unique, provenance is closed, sync failures
are visible, event inputs are validated, process output is bounded, and cleanup
is scoped. Existing Setup, lane, and tool-check paths contain forwarding logic
only.

## Sprint 8 — zero-Python and stale-knowledge closure

**Outcome:** Remove all residual Python, not only product Python.

**Work:** Port or retire two research calculators, one archived evidence
script, one ontology test, one Superpowers test utility, and the five vendored
Scrapling files. Externalize Scrapling instead of silently maintaining a fork
if parity is not part of Foreman's product scope. Delete migrated legacy logic
and correct every active reference.

**Exit:** `git ls-files '*.py'` returns no paths. The runtime policy reports no
new non-TypeScript executable source. Graphify health and current-authority
checks report zero deleted-source, dangling, stale-location, or retired-doctrine
references.

## Sprint 9 — release convergence

**Outcome:** Produce one reviewable v0.2.9.0 candidate.

**Work:** Run clean install, type checks, Node tests, deterministic build,
runtime-manifest verification, compatibility gates, strict OpenSpec, docs,
Graphify, cold audits, immutable package audits, and final Council.

**Exit:** All release predicates pass at one unchanged pushed commit. Council
has quorum with no unresolved dissent. Only then can the merge gate authorize
the tag.
