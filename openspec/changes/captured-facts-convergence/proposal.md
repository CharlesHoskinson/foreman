# Change: captured-facts-convergence

## Why

Operator feedback from a real run (reverse-engineering a live ZK SDK +
indexer) showed that once facts ARE discovered, nothing in foreman today
turns them into a grok-executable spec. `agents/grok-implementer.md:98-104`
already prescribes the doctrine this gap needs: the five-part spec's first
instruction to grok must be a concrete Write with facts inlined — zero
required reads before the first Write — and, for genuinely exploratory work,
either do the exploration architect-side and inline the findings or route
through `grok-multiround.sh`. That existing inline-first/write-first rule
is why grok's `--prompt-file` (one agentic burst, no follow-up turn) exits
having written NOTHING when a spec requires reading first (an empty-burst
failure). `docs/superpowers/specs/2026-07-19-empirical-workloads-
design.md` (C3) names the missing piece: not a new doctrine, but a named
convergence artifact and provenance discipline that FORMALIZES the existing
`grok-implementer.md:98-104` inline-first rule — captured facts inlined into
the grok spec, not referenced, so the resulting spec requires zero
reads-first and IS write-first by construction, the mechanism that turns
"grok wrote nothing" into "grok writes the determined deliverable."

## What changes

- `foreman-discover` (see the `foreman-discover-lane` package) emits
  `captured-facts.md` in the run dir: the resolved interfaces (real API/SDK
  signatures, sample requests + responses), the observed empirical behavior,
  the constraints discovered, and the provenance (which live probe
  established each fact).
- New `skills/foreman/templates/captured-facts.md`: the artifact template
  with sections `## Resolved interfaces`, `## Observed behavior`, `##
  Constraints discovered`, `## Provenance`. Every fact SHALL cite its
  probe — no unproven claims.
- New `skills/foreman/references/captured-facts.md`: the doctrine —
  captured-facts is the CONVERGENCE artifact; it FORMALIZES the existing
  `agents/grok-implementer.md:98-104` inline-first/write-first doctrine (not
  net-new) by giving it a named artifact + a provenance discipline: the
  architect composes each grok implementation sub-spec by INLINING the
  relevant resolved interfaces + constraints into the spec's `## Interfaces`
  and `## Constraints` sections (not "see captured-facts.md" — grok can't
  read-first), cross-linked to `grok-implementer.md:98-104` directly.
- `skills/foreman/references/five-part-spec.md` gains a note: a spec derived
  from discovery MUST inline the captured facts; a determined sub-spec
  carries its facts inline.

## Impact

- Affected: new `skills/foreman/references/captured-facts.md`, new
  `skills/foreman/templates/captured-facts.md`,
  `skills/foreman/references/five-part-spec.md` (inline-facts note).
- No change to `grok-implementer.md`'s existing write-first doctrine
  (`:98-104`) — this package FORMALIZES it (named artifact + provenance
  discipline), cross-linking rather than modifying its mechanics; inline-first
  itself is pre-existing, not introduced by this package.
