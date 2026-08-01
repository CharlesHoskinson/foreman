# Design — captured-facts-convergence

Parent design:
`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` (C3).
Parent plan: `docs/superpowers/plans/2026-07-19-empirical-workloads.md`
(Package C).

## Approach

1. **Template.** `skills/foreman/templates/captured-facts.md`: `## Resolved
   interfaces` (real API/SDK signatures + a sample request+response per
   call), `## Observed behavior` (empirical findings), `## Constraints
   discovered`, `## Provenance` (which live probe established each fact +
   when). Every fact cites its probe.
2. **Doctrine.** `skills/foreman/references/captured-facts.md` states the
   convergence-artifact role and the INLINE mandate: the architect composes
   each grok implementation sub-spec by inlining the relevant resolved
   interfaces + constraints into the spec's `## Interfaces` + `##
   Constraints` sections — never "see captured-facts.md", since a reference
   forces a read-first, and grok's single-burst `--prompt-file`
   (`agents/grok-implementer.md`'s "Single-burst: write-first specs", the
   inline-first rule at `:98-104`) spends the whole burst orienting and
   exits having written nothing (empty-burst) if the first required action
   is a read. This doctrine FORMALIZES `:98-104`'s existing rule with a named
   artifact + provenance discipline; it does not invent inline-first.
3. **Spec template note.** `five-part-spec.md` gains: a spec derived from
   discovery MUST inline the captured facts (not reference the artifact); a
   determined sub-spec carries its facts inline — tying this package to the
   `determinability: determined` declaration the `spec-triage-gate` package
   adds.

## Key decisions

- **Inline, never reference.** This is the load-bearing decision: the whole
  point of the convergence artifact is that grok never has to read it.
  Referencing `captured-facts.md` from the spec would recreate the
  reads-first-then-orient failure mode the parent design diagnosed (grok
  wrote nothing across rounds 1-2 + grok-multiround).
- **Provenance is mandatory, not optional.** Every fact in
  `captured-facts.md` cites the probe that established it — an unproven
  claim is not a captured fact; this keeps the artifact honest and auditable
  (an Opus audit can check a fact against its cited probe).
- **Reuses, does not modify, the write-first doctrine.**
  `agents/grok-implementer.md:98-104`'s existing write-first / empty-burst
  rules are cross-linked, not changed — this package FORMALIZES that
  pre-existing doctrine (a named artifact + a provenance discipline), it does
  not present inline-first as net-new; it is the upstream artifact that
  makes a discovery-derived spec already write-first by construction.

## Verification

Review-verified (template + doctrine, not executable code): the template's
four sections are present and each demonstrably requires a probe citation; a
worked example spec shows facts inlined into `## Interfaces`/`##
Constraints` with zero "see captured-facts.md" references; docs-check
green. Implementer: Sonnet 5. Audit: Opus 4.8.
