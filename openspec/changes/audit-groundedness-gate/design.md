# Design — audit-groundedness-gate

## The one rule

**Only a closed-world check may block.**

A closed-world check is a set-membership, range-containment, or structural
implication test over data Foreman itself produced: the diff, the run record,
the verdict artifact, the repository at a named sha, the spec. Its answer is
determined by the inputs; there is no judgement in it and no probability
attached to it.

An open-world check asks whether evidence *supports* a claim. It is a judgement,
its accuracy is a measured percentage, and by §4's numbers the best available is
88-94% precision.

The operational form of the rule, and the one a reviewer should test this
package against:

> A blocking check must be structurally incapable of a false positive. Not
> "measured at 0%" — *structurally*. If the check's specification cannot state
> the sentence that makes a false positive impossible, the check is not
> blocking. There is no configuration value that overrides this.

This is why `G1` in this package is not exactly `G1` in N4 §7.3 — see
"Where this package refines N4" below.

## Why `jq` and `git`, and no engine

N4 §7.7 items 1-5 and §10 recommendation 2 both land in the same place: the
checks that matter are expressible over JSON with tools already in the manifest.
Three engine options were considered.

**SHACL Core with a pinned engine.** Rejected for v0.2.9. The shapes are
declarative and the report vocabulary is standardised, which is genuinely
better than ad-hoc scripts — but it is a Python (or JVM) runtime dependency on
the merge path of a project that is bash + jq + git, and the measured
engine-disagreement risk is real: one engine classified **41.1% of valid
results as invalid** on a larger dataset; pySHACL is **8,500× slower than Jena**
on the ERA SPARQL shape set; and §6.6's fail-open (`Conforms: True`, exit 0, on
data violating every invariant) was hit on the first attempt with the reference
implementation on a five-shape file. What *is* adopted from SHACL is the output
shape — one addressed record per violation, with the `sh:message` string written
*as* the `required_evidence` sentence, so the transform is a projection rather
than a translation (N4 §6.5).

**Stratified Datalog with reified violation predicates.** Technically the
strongest option — P-complete rather than NP-hard, proof trees rather than
pointers, derived predicates rather than none. Rejected on dependency weight,
not merit: every engine in N4 §3.5.8 is a C++ toolchain, a Rust library, or a
commercial licence. None of the checks in this package needs recursion. The
recorded re-open condition is a constraint that genuinely needs unbounded
recursion — the likely candidates being "every claim traces to a Source within
k hops" and a cycle check over the work DAG, both of which may be expressible
with a bounded path instead.

**A learned classifier over audit output.** Rejected outright, and this is a
refuse-list item (N4 §3.2): 95% accuracy is the same reliability band as the
thing being disciplined. A gate whose checker is as unreliable as its subject
adds cost and confidence without adding safety.

## Why every check ships in shadow, including the closed-world ones

The closed-world checks are structurally 0% FP *against the contract they are
written to*. They are not guaranteed 0% FP against the contract as the auditor
actually uses it — the schema permits `line: 0`, the audit prompt permits
repo-context reasoning, and prose doctrine is not machine-checkable. The gap
between "the check is sound" and "the corpus obeys the contract" is exactly
where the ~3-false-blocks-per-week failure lives, and it is measurable.

So: every check ships evaluated and recorded, blocking nothing. Promotion needs
a threshold declared *before* the measurement, a recorded count of merges the
check ran over, and the observed violation and false-positive counts committed
to the repository. N4 §7.4: *"Do not promote on vibes; the whole point of this
lane is that the promotion criterion should be a number."*

The counter-argument, stated fairly: shadow mode delays the protection, and a
check that never gets promoted is theatre. The mitigation is that promotion has
an owner and a deadline in `tasks.md`, and that the shadow record itself is a
gate signal — a check sitting in shadow for a release with a clean record is a
release-checklist item, not a permanent state.

## Where this package refines N4

N4 §7.3 assigns `G1` (every cited file resolves to a changed file) and `G2`
(every cited line falls inside a changed hunk) a false-positive rate of "0% by
construction". That is true of the *check*. It is not true of the *contract*,
because Foreman's auditor is deliberately given repository context and is asked
about regressions — so a finding of the form "this change breaks caller X",
where X is not in the diff, is a legitimate finding citing a file outside the
diff. Blocking on it would be a false positive by any operator's definition.

The refinement, which preserves N4's intent while obeying the one rule:

| N4 check | Blocking form here | Advisory form here |
|---|---|---|
| `G1` | the cited path resolves to **no file** in the diff and **no file** in the repository at `HEAD` — a path that exists nowhere is a hallucination, with no judgement involved | the cited path exists but is outside the diff — counted, reported, and attributed |
| `G2` | the cited line is **beyond the end of the cited file** at `HEAD` — a line that cannot exist | the cited line exists but falls outside every changed hunk for that file — the "reviewed the file, not the diff" signal |

Both blocking forms are strictly closed-world and cannot be wrong. Both advisory
forms carry the signal N4 wanted and are exactly the candidates the shadow
measurement is for: if the out-of-diff citation rate on our corpus turns out to
be zero, the stricter form is promotable by number, which is the discipline this
package exists to install.

`line: 0` is a file-level finding in the existing schema and is never a
violation of either form.

## What the canary has to prove

The canary does not prove the checks are correct. It proves they are *able to
fail*. Those are different claims, and only the second is cheap.

Design consequences:

1. **One mutant per check, minimum.** A conforming baseline artifact plus, for
   each check, a mutation of that baseline that the check must flag, with the
   expected violation count and focus recorded in the fixture.
2. **Assert the count and the focus, not just non-emptiness.** RDF4J silently
   truncated results and corrupted a peer-reviewed benchmark's published numbers
   (N4 §8.6); a checker that reports "some violations" is a checker that can
   report the wrong ones.
3. **Run it on every invocation, not at build time.** The fail-open cases in
   N4 §6.6 and §8.6 are all *runtime* conditions — a flag change, an engine
   upgrade, an unsupported component. A build-time canary would have passed all
   five.
4. **A canary miss is `UNVERIFIED`, not `pass` and not `fail`.** It has the same
   epistemic shape as an errored audit, and `three-outcome-verdicts` already
   established the vocabulary: the checker did not produce a judgement. It fails
   the gate closed with its own reason string, never conflated with a real
   violation.

The cost objection is answered by measurement: the fixture corpus is a handful
of small JSON files and the check set is `jq`, so the canary is milliseconds. If
it ever is not, the fixture corpus is too large.

## Conditional obligations are separate checks, never combinators

N4 §6.6 Finding A, executed: an `sh:xone` formulation detected the violation and
reported it uselessly, because a logical combinator reports at its own level and
swallows the inner messages — the very strings that *are* the
`required_evidence`. The fix, also executed, was two separately-targeted shapes,
one per epistemic status, each carrying its own message.

Translated out of SHACL: **a check with a conditional obligation splits into one
check per branch, each with its own id, its own message, and its own
`required_evidence` sentence.** `G9` is the case in this package —
"`APPROVED` implies no critical/high finding" and "`BLOCKED` implies at least
one critical/high finding or a declared criterion miss" are two checks with two
messages, not one check with a disjunction. A violation must always name the
missing evidence, not the failed combinator.

## What the gate must not be allowed to imply

N4 §7.6, adopted verbatim as doctrine:

> A green symbolic validation means *the claims about the work are well-formed,
> sourced, and internally consistent*. It does not mean the work is correct. The
> graph gate is a **provenance and citation gate**, not a correctness gate.
> Correctness remains the job of `checks-result.json`.

The predictable failure this guards against is a run that produces
beautifully-provenanced, fully-cited, coherent claims about a diff that does not
work. Every measured result in N4 §4-5 says the symbolic layer passes that diff.
Hence the requirement that the gate output and the PR body state the scope in
words. This is cheap and it is the difference between a useful signal and a
misleading one.

### Stated plainly, what cannot be made symbolic

Published beside the checks so the gate's silence is not read as coverage
(N4 §7.5):

1. **Whether a natural-language acceptance criterion is met by a diff.** The
   oracle problem. `G3` can verify a criterion is *addressed*; nothing here can
   verify it is *satisfied*. Closing that gap means making criteria executable,
   which is a change to how specs are written, not to the gate.
2. **Whether evidence supports a claim.** 88-94% precision at best. Tier 3,
   advisory, permanently until a number says otherwise.
3. **Domain-convention correctness.** The ICD-10-CM result — 0/20 across four
   models from three families — shows neither symbolic nor model catches a
   convention nobody wrote down. Writing the rule down fixes it; then it is
   symbolic.
4. **The Category D architectural residual** — unarticulated architectural
   intent not yet expressed as an enforceable rule. Definitionally not symbolic,
   and the legitimate permanent home of the cross-vendor audit lane.
5. **Category C runtime properties** — races, partial failure, load behaviour.
   Out of gate scope; the gate must not imply coverage it does not have.
6. **Category E specification defects.** Human loop, permanently.

## Alternatives rejected

**Block on Tier 3 evidence sufficiency.** Rejected: 88-94% precision, ~3
false-blocked correct merges per week at current volume, and the failure mode is
not the respawns but gate bypass becoming normal. This is refuse-list item 18.

**Make the auditor check its own output.** Rejected: three independent measured
results say self-critique scaffolding is flat-to-negative, and that a sound
external verifier plus simple re-prompting captures most of the available gain
(N1 §8.3.17). The checker is deterministic and external precisely because the
auditor cannot be its own verifier.

**Derive criterion ids from a hash of the criterion text** (N4 §9.2's cheaper
encoding). Rejected for wave 3's blocking form, recorded as considered: a
reworded criterion silently becomes a new id, so coverage resets to zero
invisibly and the check reports full coverage of a criterion set nobody wrote.
Explicit stable ids in the spec format cost the architect a few characters and
make rewording visible. Text-hash ids remain acceptable for the *advisory*
recurrence signal, where a split is a nuisance rather than a false green.

**Show the auditor the Tier-2 results before it runs.** Rejected for this
release, and it is an open question rather than a settled one (N4 §9.8). The
argument for is that it stops the model wasting attention on tampering and scope,
which are now deterministic. The argument against is that telling a model what
has already been checked biases it toward not looking. It is testable and
currently unmeasured; `graph-eval-falsification` is the right place to measure
it.

**Enforce `G4` unconditionally in every mode.** Rejected: soft mode legitimately
permits configurations this package should not silently outlaw, and a blocking
check that contradicts a supported configuration is a false positive. `G4`
blocks WHERE the configured policy requires cross-vendor separation and warns
otherwise — still closed-world, because it compares two recorded strings against
a recorded policy.

**Let a check assume a missing input.** Rejected everywhere. A check with a
missing input SHALL be silent and SHALL be counted as silent. R2's P6 —
*"if a workflow bounds coverage, log what was dropped; silent truncation reads
as 'covered everything' when it didn't"* — applied to checks. The composite
shape this preserves is N4's: *symbolic is never wrong and often silent; the
model is usually right and never silent.* Silence that is not counted is
indistinguishable from coverage, which is the fail-open failure again in a
different costume.

## Risks

- **Canary rot.** A fixture corpus that stops matching the artifact shape
  produces either constant `UNVERIFIED` or a canary that passes while checking
  nothing. Mitigation: the fixtures are generated from the same schema the
  checker reads, and a fixture/schema mismatch is itself a failure.
- **Shape-set growth.** Every brittleness story in N4 §8.5 starts with a check
  set that seemed reasonable. Mitigation: a declared cap on blocking checks in
  config, and each check carries a measured cost on the fixture corpus.
- **Wave 3 authoring drag.** Criterion ids and scope globs are architect
  overhead on every spec. Mitigation: they land only after wave 1 and 2 have
  shown value, and the spec-format change is one package's decision, not a
  gate-side imposition.
- **Rename and delete findings.** A finding citing a path deleted by the diff,
  or the pre-rename side of a rename, resolves at neither `HEAD` nor the diff's
  new-side paths. Mitigation: path resolution consults the diff's old-side names
  and `git diff --find-renames`, and an unresolvable-but-plausible path is a
  warning, never a block.
- **The scope sentence being deleted as clutter.** The PR-body sentence about
  what the layer checks is the cheapest and most fragile part of the design.
  Mitigation: it is a spec requirement with a scenario, not a comment.
