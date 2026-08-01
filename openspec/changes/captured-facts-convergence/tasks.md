# Tasks — captured-facts-convergence

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. `skills/foreman/templates/captured-facts.md`** — the artifact
  template: `## Resolved interfaces` (real API/SDK signatures + a sample
  request+response per call), `## Observed behavior`, `## Constraints
  discovered`, `## Provenance` (probe + when, per fact). Every fact SHALL
  cite its probe.
- [ ] **2. `skills/foreman/references/captured-facts.md`** — doctrine:
  captured-facts is the CONVERGENCE artifact that FORMALIZES the existing
  `agents/grok-implementer.md:98-104` inline-first/write-first doctrine (not
  net-new); the architect composes each grok implementation sub-spec by
  INLINING the relevant resolved interfaces + constraints into `##
  Interfaces`/`## Constraints`, so the spec is write-first (zero
  reads-first); cross-link `grok-implementer.md:98-104` directly.
- [ ] **3. `five-part-spec.md` note** — a spec derived from discovery MUST
  inline the captured facts (never "see captured-facts.md"); a determined
  sub-spec carries its facts inline.
- [ ] **4. Verify** — docs-check green; review a worked example (a sample
  discovery-derived spec) to confirm zero read-first references and full
  provenance coverage; commit per the plan (`feat(captured-facts):
  convergence artifact schema + inline-into-grok-spec doctrine`).

Acceptance: `captured-facts.md` template exists with all four sections and
mandatory per-fact provenance; the inline-doctrine reference exists and is
cross-linked to `grok-implementer.md`'s write-first rule; `five-part-
spec.md` carries the inline-facts note; docs-check green.
