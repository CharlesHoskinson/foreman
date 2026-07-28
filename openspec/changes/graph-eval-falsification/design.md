# Design — graph-eval-falsification

## The stance

Most evaluation harnesses are built by people who expect to pass them. That is
the failure this package is designed against. The design question is not "how
do we show the graph plane works" but "what would have to be true for us to
conclude it does not, and would this harness actually surface it".

Three structural choices follow from that, and they are the whole design:

1. **The kill criteria are registered before the measurement, with the action
   attached.** A threshold chosen after seeing the data is not a threshold. The
   register is committed and hashed before the measuring run; a criterion that
   was not registered may not be used to justify keeping the plane.
2. **The baseline is locked before the treatment is measured.** Otherwise the
   baseline drifts upward in exactly the way that makes it lose.
3. **Every metric ships with its misreading and a companion number.** A metric
   without a companion is a metric that will be gamed — and the gaming is not
   hypothetical: in the one study that looked, evolved skills *did* game the
   rubric, and an independent judge caught it.

## The order of operations, and why it is not negotiable

```
  census  ->  sigma  ->  locked baseline  ->  graph arm  ->  verdict
    |          |             |                    |
    |          |             +-- hashed, committed, never re-run after this point
    |          +-- the noise floor: no delta below it is an improvement
    +-- ships with GP-1, ahead of everything else; can freeze GP-6 on its own
```

Each stage can terminate the programme. The census can freeze the store before
a line of adapter code is written. σ can establish that the noise floor exceeds
any effect the plane could plausibly deliver, in which case the honest output is
"we cannot tell", published as such. The baseline can simply win.

Running these out of order destroys the result. Measuring the graph arm first
and then constructing a baseline is the standard way this kind of programme
lies to itself, and it is why the lock is a hash and a commit rather than an
intention.

## Why the census comes first and is cheap

R6 §6.3 and the market evidence agree on one procedure: **audit your query
distribution before building graph infrastructure.** GraphRAG earns its place
only when a measurable fraction of actual query traffic asks questions a
similarity search structurally cannot answer.

The census is instrumentation, not recollection — architects reliably remember
the interesting query and forget the forty lookups. It rides along with GP-1's
telemetry, costs nothing per query, and can return a verdict before GP-6 has
started. It is the cheapest kill criterion in the package and therefore the
first.

The classification boundary that matters is *genuine multi-hop across runs*:
not "the answer touched two documents" but "the answer required joining facts
from more than one run, spec, or defect, and could not be reached by a
point-lookup or a single-document read". Karpathy's own list of conditions
under which a knowledge graph is unnecessary — tasks independent, no
cross-session state, answers depending on one document, relations fixed and
simple — describes most Foreman rounds, and the census is what tests whether
that is true here.

## Why the baseline must be locked, not merely run

N1's LEED case is the reference failure: a well-instrumented, honestly-reported
neurosymbolic pipeline at 61.6% against its own text-only baseline at 67.3%,
where the symbolic sub-check was *locally perfect*. Local correctness plus
global loss is the shape to watch for, and the only instrument that detects it
is a baseline nobody was allowed to touch.

The lock is: baseline arm content-hashed, model version pinned and recorded,
prompt recorded verbatim, cost recorded, and the whole thing committed with a
timestamp before the graph arm runs. Re-running the baseline after seeing the
graph result is permitted only as an explicitly-labelled second measurement
that cannot be substituted for the locked one.

Cost matching matters as much as the lock. The multi-agent critique is
specifically about marginal utility per unit of compute, and the entanglement
literature's finding that token usage alone explains 80% of performance
variance means an uncost-matched comparison measures spend, not architecture.

## Why σ before everything downstream

Published agent-benchmark σ lands around 1.5–2.7 pp with three-run confidence
half-widths of roughly 2.7–4.9 pp — and that is the literature's noise, not
ours. Foreman's own has never been measured. Until it is, a 3-point improvement
and a 3-point regression are the same observation.

Spending the first release's canary budget on σ rather than on a headline is
the least glamorous decision in this package and probably the most valuable. It
also sets the resolution of every kill criterion downstream: a threshold below
the noise floor is not a threshold.

## Why Tier-3 is shadow-only until a number says otherwise

Open-world grounding runs at 88–94% precision. At Foreman's merge volume a
blocking check at that precision false-blocks around three correct merges a
week, and the second-order damage is worse than the first: it teaches the
operator to bypass the gate, after which the gate protects nothing.

So Tier-3 runs in shadow, its precision is measured on our data rather than
inherited from a paper, and promotion requires a pre-declared threshold to be
met on a pre-declared sample. The demotion rule is specified in the same breath,
because a promoted check that starts false-blocking must have a way back that is
not an argument.

## Why the serializer sweep is per vendor

The measured evidence against a single format choice is unusually sharp:
format preference *inverts* across model generations (JSON +9.68 over Markdown
on one model, −7.33 on its successor), one family shows plaintext 76.2 against
JSON 21.95 on the same task, and the intersection-over-union of best-format sets
across model series is *"often below 0.2."*

Foreman is explicitly cross-vendor, so a hard-coded serializer is a bet placed
on one vendor with the other lanes' money. The sweep runs per vendor over the
K values the context builder can actually serve, and the honest default for an
unswept vendor is the shared default *plus a flag saying it is unvalidated* —
not silence.

There is a genuine open tension here that the sweep is designed to resolve
rather than assume: path-based organisation measures better on synthesis
questions, while the context-rot result found all eighteen models tested
performed better on shuffled context than on logically structured context.
Grouping probably helps synthesis and hurts lookup. We measure both.

## Why M5 is the number that governs the vendor count

M5 is the fraction of gate-blocking findings that *only* the cross-vendor
auditor produced — not found by the deterministic checks, not found by the
architect. Its common misreading is that it reads as "the auditor is valuable"
when the auditor is merely verbose, so its companion numbers are the count of
BLOCKED verdicts the architect overturned and the deterministic-check catch
rate on the same diffs.

It is the only measurement that can justify a fourth vendor on quality grounds,
because the independence argument does not: nine judges across seven families
behave as ~2 effective votes. Foreman's real decorrelation mechanism is the cold
diff — a different evidence set and a different role — which is stronger than
anything those papers audited, and it does not scale with vendor count.

The replay corpus makes M5 computable at zero marginal spend: swap one recorded
auditor transcript for a different vendor's recorded transcript on the same
diff, and the unique-catch rate falls out offline.

## Alternatives considered and REJECTED

**Ship the plane and evaluate later.** Rejected — this is refuse-list item 22,
and LEED is what this architecture does by default when nobody measures it. It
is also unrecoverable in practice: once the plane is on by default, the
counterfactual is gone.

**Use an external benchmark (SWE-bench and relatives) as the gate.** Rejected.
SWE-bench Verified showed 59.4% flawed tests in the audited failing subset,
universal gold-patch reproducibility, and a 19.71% patch-rejection rate under
adversarial strengthening. Even the 50-task Mini split cost $259.20 with a
cheap model. An external anchor is retained as an *optional, non-gating*
sanity check on the Pro public split, per major release, reported with
confidence intervals — never as the gate. The gate measures Foreman by holding
models fixed and varying Foreman, which is the inverse of what these benchmarks
do.

**Retrieval metrics as the primary measure.** Rejected: the
retrieval–generation gap means retrieval metrics flatter the system. Task
success and wall clock are the measures; retrieval metrics are diagnostics.

**Optimise against the citation checker and evaluate with it.** Rejected
explicitly. Using an attribution scorer as a system component measurably breaks
it as a metric — reranked variants scored lower on human evaluation than
expected. And the gameability control is decisive: verbatim-copy-and-self-cite
scores 99.4/99.4 on citation with 20.8 fluency. The optimisation target and the
evaluation instrument must not be the same object.

**Let the model judge whether the graph helped.** Rejected. LLM
self-explanations are measured unstable and weakly faithful; chain-of-thought
explanations change systematically under biasing features the model never
mentions, with accuracy drops up to 36%. The verdict comes from task success,
cost, and deterministic checks.

**A single aggregate pass-rate as the regression signal.** Rejected on measured
grounds: six injected local regressions moved an aggregate pass rate by only
−1.7 to −5.9 pp while the *owning slice* dropped −25 to −91 pp. An aggregate
gate would have missed all six. Slices, each with its own locked baseline.

**Choosing thresholds after the measurement.** Rejected, and this is the
rejection the package exists to enforce. It is also the easiest one to violate
accidentally, which is why the register is a committed, timestamped, hashed
artifact rather than a section in a document.

## Risks

- **The harness is gamed rather than passed.** Assume it. The register names an
  independent owner for auditing the metrics themselves — specifically, whether
  the first-pass gate rate is rising because specs shrank rather than because
  workers improved.
- **The census is instrumented in a way that misses the interesting queries.**
  If architects work around the instrumented path, the census measures the wrong
  distribution. Mitigation: the census records the *unclassifiable* bucket
  explicitly and treats a large unclassifiable share as a census failure rather
  than a small denominator.
- **σ turns out to be larger than any effect the plane could deliver.** This is
  a real possible outcome and it is not a harness bug. The specified response is
  to publish "no measurable effect at this sample size" and the sample size that
  would be required, rather than to claim a directional win.
- **A negative verdict is politically expensive.** Specified against directly:
  the report publishes regardless of outcome, the kill criteria carry their
  actions in advance, and the off-switch and A/B path exist so a negative
  verdict is executable rather than merely regrettable.
- **Model versions move under the baseline.** Frontier accuracy is a moving
  boundary that shifts without notice — in one measured case a failure cell
  closed silently under the same model alias with no version bump. Mitigation:
  pin and record model versions on every arm; a version change invalidates the
  baseline and forces a re-baseline rather than a cross-version comparison.
