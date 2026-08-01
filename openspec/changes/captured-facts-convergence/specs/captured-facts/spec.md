# Spec delta — captured-facts convergence artifact

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: discovery emits a captured-facts artifact with provenance

`foreman-discover` SHALL emit a `captured-facts.md` artifact (per
`skills/foreman/templates/captured-facts.md`) in the run dir, containing
`## Resolved interfaces` (real API/SDK signatures + a sample
request+response per call), `## Observed behavior`, `## Constraints
discovered`, and `## Provenance`. Every fact SHALL cite the probe that
established it.

- A fact with no cited probe SHALL NOT be included in the artifact —
  provenance is mandatory, not optional.

#### Scenario: captured-facts.md carries provenance for every fact

- WHEN `foreman-discover` converges and emits `captured-facts.md`
- THEN each entry under `## Resolved interfaces` / `## Observed behavior` /
  `## Constraints discovered` has a corresponding `## Provenance` citation
  naming the live probe that established it
- AND no fact appears without a cited probe.

### Requirement: a discovery-derived grok spec inlines the facts (write-first, zero reads-first)

WHEN the architect composes a grok implementation sub-spec from a
`captured-facts.md` artifact, the architect SHALL INLINE the relevant
resolved interfaces and constraints directly into the spec's `##
Interfaces` and `## Constraints` sections. The spec SHALL NOT merely
reference the artifact (e.g. "see captured-facts.md").

- This SHALL result in a spec requiring ZERO reads-first — FORMALIZING
  (not superseding) `agents/grok-implementer.md:98-104`'s existing
  single-burst write-first/inline-first doctrine, so grok's first agentic
  action can be a concrete Write.

#### Scenario: a discovery-derived spec is write-first with facts inlined

- WHEN the architect writes a grok sub-spec from a converged
  `captured-facts.md`
- THEN the spec's `## Interfaces` and `## Constraints` sections contain the
  resolved API signatures/constraints text inline
- AND the spec contains no "see captured-facts.md"-style reference requiring
  grok to read the artifact before writing.
