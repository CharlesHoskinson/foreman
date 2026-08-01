# Design — readme-refresh

## The problem this design is actually solving

Not "the README is out of date." The README is *confidently wrong about its own
safety properties*, and it is wrong in a document whose stated purpose is to
teach. A reader who believes `README.md:240` believes hard mode cannot ship a
diff that failed audit. It can.

So the ordering is the design. Truth, then structure, then prose. Each stage
constrains the next:

1. **Disposition every flagged claim** into a ledger. No prose in a section is
   rewritten while a claim inside it is undispositioned.
2. **Rebuild the structure** — twelve unnumbered sections, five-part spec moved
   to position 3, reference material relocated, two new sections for the
   release's material.
3. **Apply one prose rule**, recorded in `docs/STYLE.md`, and measure the result
   against ceilings.
4. **Re-check the finished text** with a different model family.

Reversing 1 and 3 is the failure mode this design most wants to avoid. A
well-turned false sentence survives review; a clumsy one gets rewritten and its
falsehood gets noticed on the way past.

## Where the honesty about checking lives

The brief for this package was explicit that a README change is trivially
satisfiable, and that this release has already burned two audit rounds on
predicates that could not discriminate what they claimed. The design's answer is
a hard split, stated per requirement rather than assumed:

**Mechanical, implemented as a `readme` stage in `docs-check.sh`:**

- ledger completeness, with the expected row count *derived from
  `EDIT-readme-facts.md`* rather than hardcoded, so the check cannot pass by
  agreeing with a stale constant;
- no empty or unrecognised disposition;
- the exact ordered heading sequence, failing at the first position that differs;
- no numbered heading, no `section <digit>` or `§<digit>` in prose;
- every `](#slug)` resolves against slugs computed from the file's own headings;
  every relative link resolves against the tree;
- each relocated item absent from `README.md` **and present at its destination**
  — checking both ends, because a cut that lost the material is not a
  relocation;
- the banned phrase `fail-closed at every stage` absent unless a registry row
  proves it;
- `Four roles, four producers` absent; `GraphStore`, the files-only fallback,
  the work-DAG projection and the telemetry gap present;
- the stated count of Quint models equal to the count of `formal/specs/*.qnt` in
  the tree — so a fifth model breaks the check instead of silently ageing the
  sentence;
- the four prose ceilings, with the sentence-splitting rule printed so a
  disputed count is reproducible, and recorded exceptions read from the
  decisions file rather than by editing the check;
- `As of v` absent, and no `v0.x.y` outside the lineage subsection;
- an answer recorded, attributed and non-`TBD` for each of the four ambiguities.

**Human-judged, with the judge and the standard named:**

- *Are the dispositions right?* The architect re-reads each `corrected` and
  `kept-with-evidence` row against the code it cites. A `deleted` claim that
  reappears in other words is a failure. Standard: `EDIT-readme-facts.md`
  sections 1, 2 and 6.
- *Does each safety claim state its enforcement strength?* Five claims —
  cross-vendor invariant, git-write ban, lock serialisation, dirty-safety, the
  gate — are each enforced in one place, prompt text, or not at all. The
  architect judges whether a reader can tell which. There is no regex for
  "leaves the reader unable to tell".
- *Is the teach/look-up boundary respected by new prose?* The enumerated
  relocations are mechanical; the rule going forward is not.
- *Does the record section oversell?* Judged against the roadmap's own
  disconfirming evidence: BM-25 beating all nine GraphRAG systems, ~2 effective
  independent votes across nine frontier models, and TerminusDB's bus factor of
  one. This evidence produced the 2026-07-30 withdrawal.
- *Was a sentence rewritten only to move a count?* Goodhart's guard, judged by
  the architect.
- *Does the final text make ungrounded claims?* An audit lane on a different
  model family produces the verdict; the architect adjudicates disputes.

Every human gate produces a written artefact naming what was compared. A
checkbox is not a judgement.

## Why the checks live in `docs-check.sh` and not a new script

`docs-check.sh` is already the documentation gate, already exits `0/1/2`, and
already fails closed on a missing tool. A one-off `readme-check.sh` would be a
second thing to remember to run, and the failure mode of documentation checks is
not running them. `doctrine-reality-drift` is wiring its own stage into the same
file; the two land serially.

## Alternatives rejected

**Rewrite first, fact-check after.** The natural order, and the reason the
current README is in this state — its best-written passages are among its least
true. Rejected: it inverts the constraint. Once a sentence is good, the reviewer
argues about whether it is *really* false.

**Build a README claim checker.** Tempting, because README claims have a
specific shape. Rejected outright: `doctrine-reality-drift` exists precisely for
docs-contradict-code, including the empty-probe-is-a-stale-probe rule this would
have to reinvent. Two checkers means two registries, and the second one is the
one nobody updates. This package supplies rows and consumes the mechanism.

**Ship the 32 line edits as 32 tasks.** Rejected on the line editor's own
argument: a list is applied once, a rule is applied every time. The 32 edits are
retained as worked examples inside `docs/STYLE.md`, not as the deliverable.

**Prose quality scored by a model judge, or by a readability index.** Rejected.
An LLM prose score is unfalsifiable and would have passed the current README —
which is, by the line editor's assessment, well written and wrong. A readability
index measures sentence length. Neither can fail for the reason that matters.
Where prose is the property, a human is named.

**Guess the four ambiguities.** Rejected as the single most dangerous shortcut
available here. Each is a meaning question — what "four producers" counts,
whether the v0.2.5 baseline is deliberate, what `CMD`/`GATE` are, what "host
identity" means. A confident guess produces a fluent new false claim, which is
exactly the defect the package exists to end. They block the gate.

**Keep numbered sections and repair the five broken cross-references.** Cheapest
option. Rejected: the numbers have already lied five times under ordinary
maintenance, and a fifteen-to-twelve restructure renumbers nearly every section.
The evidence for the failure mode is in the file.

**Split the README into `README.md` + `CONCEPTS.md` + `STATUS.md`.** The
three-documents diagnosis suggests it. Rejected: the evaluating engineer decides
in ten minutes from one file, and a split relocates the interleaving problem
into a link graph while creating three surfaces to drift instead of one. The
concept paper stays; the operator manual goes to the file that already claims
it; the release ledger goes to `ROADMAP.md`. That is two relocations, not a
split.

**Generate the shipped/stub table from the code.** Attractive, and it would kill
a whole class of staleness. Rejected for this package: it would need a per-stage
notion of "shipped" that does not exist yet, and generated prose reads as
reference material in a document that is supposed to teach. The ledger rows plus
registry probes get most of the benefit at a fraction of the machinery. Worth
revisiting once `doctrine-reality-drift`'s registry has a release of use behind
it.

**Defer the README to v0.3.0, since v0.2.9 is already the largest release.**
Rejected: the release adds a fourth lane, a graph plane and a checker-soundness
doctrine. Shipping those behind a README that says "Four roles, four producers"
and "fail-closed at every stage" makes the document wrong in more places than it
is today, and the fact-check's findings would be a year old before anyone acted
on them.

## Risks

**The ceilings become the goal.** Counting `never` is a crude proxy for prose
that has stopped shouting, and a rewrite can hit the number while getting worse.
Mitigations: the ceilings are ceilings, not targets; the *rule* in
`docs/STYLE.md` is the artefact under review; exceptions are recorded in the
decisions file rather than by relaxing the check; and "rewritten only to move a
count" is an explicit review failure with a named judge.

**Relocation creates a second drift surface.** Moving the exit-code tables to
`docs/USAGE.md` does not make them true — it makes them true in one place
instead of two. Mitigation: relocated factual content is eligible for registry
rows on the same terms, and the relocation check verifies presence at the
destination, so nothing is silently lost.

**Coupling to packages that may not land.** The README's description of the
gate, the locks and the `claude` lane each depend on another package's outcome.
Mitigation: those requirements are `IF ... THEN ...`, satisfied by either
outcome and failed only by a sentence that mismatches the outcome that occurred.
The cost is that this package must land late, which is accepted.

**Human gates get rubber-stamped.** The honest risk of naming a human instead of
a script. Mitigation: each human gate produces a written artefact naming what
was compared against what, and the cross-family fact-check is a second,
independent opinion on the same text — the release's own corroboration rule
applied to its documentation.

**The rewrite introduces new false claims.** Fifty-five corrections and five new
errors is not progress. Mitigation: the cross-family fact-check runs against the
*final text*, not the diff summary, and any ungrounded shipped-behaviour claim
it names must be corrected, marked as doctrine or planned, or registered with a
probe before the gate passes.

**Concurrent edits to `README.md` from other packages in this release.**
Several packages change behaviour the README describes. Mitigation: this package
owns the README text for the release; other packages record what their change
means for the README as a ledger row rather than editing the prose, and this
package lands after them.
