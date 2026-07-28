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

## The register, as committed (RECONCILE R3)

The roadmap claimed ten pre-registered criteria "each with a threshold and one
action". Six of the ten carried no number — they said "the registered share",
"the registered threshold", "the registered margin" — and the numbers the PM
lane had already fixed were never imported. The register's own clause forbidding
the use of an unregistered criterion then invalidated the whole register: a
criterion whose threshold is a placeholder was not registered, so nothing it
governed could be acted on.

Three things fix that, and all three are plan-time edits:

1. **Every number PM §4 already fixed is transcribed verbatim, with
   attribution.** 20% multi-hop census share (K-1 A); relation F1 0.60,
   non-isolated 70%, any false merge, 40% one-pass merge ceiling (K-2); the
   clean drop-and-rebuild with its wall clock (K-3b — transcribed at 15 minutes
   and re-baselined to 60 seconds on fireability grounds, see below); zero
   time-travel/graph-diff queries and the files-only-within-2x head-to-head
   (K-3c); ~5% unique catch (K-4); the 100-merge shadow window with a
   zero-false-block promotion bar (K-6); >= 50% reduction over >= 30 lane-starts
   (K-8).
2. **The four thresholds PM left open are fixed here, now, as architect
   decisions**, each anchored on a measurement rather than invented: KC-3's 5.0
   pp half-width sits one decimal above the published three-run band of 2.7–4.9
   pp; KC-7's 72% is the published ALCE citation ceiling, applied to an easier
   target (a row, not a paragraph), so failing it falsifies the citation
   contract; KC-8's 10% cost margin exists only to bound rounding churn, because
   dollar cost is exactly accounted; KC-9's 8 hours is one working day per
   release against PM K-3f's stated ~5 developer-day adoption cost plus a
   quarterly health obligation.
3. **Atomicity is enforced structurally.** Every criterion carries one metric,
   one number, one measurement, one subject, one action and one uncomputable
   rule. Multi-branch source criteria were split before registration (K-1
   Measurement B into KC-2a and KC-2b; K-2 into KC-11a–d), which is why there are
   now nineteen criteria rather than ten. `ROADMAP.md`'s "ten pre-registered
   criteria" sentence is therefore stale; it is the architect's to correct, not
   this package's.
4. **Every criterion states what happens when its metric has no value.** The
   uncomputable rule is a required field, not a remark, and `UNCOMPUTABLE` is
   never a pass. The reasoning is in "The uncomputable state" below.
5. **Every threshold was checked for fireability before registration**, and the
   one that could not be tripped by any achievable measurement — KC-13's
   15-minute rebuild bound — was re-baselined onto the measurement it is
   anchored on. See "Fireability" below.

### Why the action enum was extended exactly once

The declared enum was `revert | descope | keep`. Eight imported criteria call
for an outcome none of those three states: the component stays in the tree, is
disabled by default, and carries no claim. `revert` says the code is removed;
`descope` says a narrower scope ships *enabled*. Forcing "ships dark" into
`descope` would also erase the distinction this package depends on elsewhere —
the counterfactual A/B arm requires the code to be present and off, which is
precisely what `descope` does not guarantee.

So the enum is extended once, in the register, by `keep-off`, and every source
phrasing that meant it — "keep off", "stay warning-only", "block promotion",
"freeze" — is mapped onto that single value. `keep` survives in the enum but is
barred as a met-action, because a criterion whose consequence is "keep" cannot
fail anything and is therefore not a criterion.

Two criteria (KC-8, KC-9) have conjunctive conditions in their sources — cost
rises *and* nothing improves; maintenance exceeds a bound *and* no escape was
prevented. Splitting them would produce two criteria neither of which is the
one PM registered. They are instead registered as single derived metrics, with
the conjunction stated as the metric's definition and one measurement
evaluating it. That keeps "one condition, one threshold, one action" true.
This treatment is no longer a two-name exception: it is generalised below into a
rule that KC-13 and KC-15 also satisfy, with a totality and a disclosure
obligation attached, because naming exceptions individually is how the atomicity
rule erodes.

### The K-1 contradiction, resolved: KC-1 governs GP-5 only

PM K-1 contradicts itself. Measurement A says a sub-20% multi-hop share descopes
the knowledge plane *and* freezes GP-6 ("one census, two decisions"). Its own
"Action if killed" says the opposite: "**Do not infer anything about the store.**
K-1 kills GP-5; GP-6 is decided separately by K-3c… Two bets, two verdicts."

The "Action if killed" branch wins, and the Measurement-A freeze branch is
struck. Three reasons, in order of weight:

1. **The store already landed by product-owner decision on R8's live evidence.**
   A criterion cannot gate a decision that has been taken on a different
   evidence base; pretending otherwise would make the register decorative.
2. **The census verdict will not exist inside v0.2.9** (RECONCILE §4 and R2c:
   the census runs for one full release and reports in v0.3.x). A criterion that
   structurally cannot return in time is not a gate on a component landing now —
   it constrains the *claims*, which is where the census evidence is redirected.
3. **The atomicity rule forbids it anyway.** One measurement with two subjects
   and two actions is exactly the shape this fix exists to remove. Had the
   freeze branch been kept, KC-1 would have had to split into two criteria, and
   the GP-6 half would have duplicated KC-14 and KC-15 — which measure the
   store's actual differentiators (time-travel and graph-diff usage, and the
   files-only head-to-head) rather than a proxy for them.

The census still reports its share, and the share still constrains what the
release may claim for the store. It no longer decides whether the store ships.

### The override rule

Adopted from the Codex finding, verbatim in substance: an architect override in
the same release **records the criterion as FAILED and keeps the affected
component OFF**. There is no override path that produces a passing outcome, no
"waived", no "inapplicable", no "superseded". Any rescue requires a new
criterion, registered prospectively, in a later release, evaluated only on data
recorded after that registration — the overriding release's own data may not be
re-read into a pass.

The reasoning is the one-line version of this whole package: a criterion that
can be overridden into success is not a criterion. The override loophole in the
original text ("any decision to override it SHALL be recorded as an explicit
architect override naming the criterion and the reason") recorded the *fact* of
the override but left the component's fate unspecified, which in practice means
it stays on. Naming the outcome closes it.

### The two criteria nothing else owned

PM K-2 (extraction quality: four numbers) and PM K-8 (round-mode occurrence
reduction) had no owning package anywhere in the release. Both are registered
here, as KC-11a–d and KC-12, with their measurements specified as requirements
so the register is not the only place they exist. The measured subjects live
elsewhere — `knowledge-plane-refresh`'s slow cadence for KC-11, and
`round-ownership-default`'s occurrence telemetry for KC-12 — and
`round-ownership-default` still needs its own emitting requirement and task per
RECONCILE R3. That is a cross-package dependency recorded in T8, not an edit
made here.

### The uncomputable state, and why silence was the register's largest hole

The re-audit found that several criteria compute a rate over a denominator that
can be zero, and that the register said nothing about what happens then. Left
alone, the arithmetic answers for you, and it usually answers in the component's
favour: precision over zero predicted blocks reads as flawless, a one-pass merge
share over zero merges reads as 0% and therefore under the 40% ceiling, zero
false merges out of an empty gold sample reads as a clean sheet, and a
time-travel query count from instrumentation that never ran reads as the zero
KC-14 is looking for. Four of those are passes obtained by measuring nothing.
The same shape appears one level up: a criterion whose measurement cannot run in
the release it gates was simply silent, and silence ships the component enabled.

So the register now returns one of three outcomes — `MET`, `NOT-MET`,
`UNCOMPUTABLE` — and every criterion carries an explicit uncomputable rule
naming its denominators and its minimum observation counts. `UNCOMPUTABLE` is
not `NOT-MET`, is not a pass, is not a waiver, and cannot be overridden; the
component it governs does not ship enabled by default, no claim resting on it is
published, and the criterion is carried into the next release under the same
identifier. A criterion omitted from the report's outcome table counts as
`UNCOMPUTABLE`, so forgetting to report one is not a way to pass it.

The consequence is deliberately uncomfortable and is stated rather than
softened. Several criteria are structurally uncomputable inside v0.2.9 — the
census runs for a full release and reports in v0.3.x, KC-4 needs a 100-merge
shadow window, KC-5 needs a Tier-1 replay corpus — and under this rule the
components they govern do not ship enabled by default in v0.2.9. That is the
price of not letting an unmeasured release count as a measured pass, and it is
the same price KC-12 was already paying alone under its "not evaluated" rule.
KC-12's rule is retained and simply renamed onto the general vocabulary; the
other eighteen criteria are brought up to it.

The distinction that does most of the work is **a measured zero is not an absent
measurement**. KC-14's threshold is literally zero, so a release that never
instrumented the store would satisfy it without observing anything. Requiring
the instrumentation record to exist before a count of zero may be reported turns
that from a pass into an `UNCOMPUTABLE`.

### Fireability: KC-13's fifteen minutes could not be tripped

A criterion whose threshold no achievable measurement could cross is the same
defect class as a checker that cannot fail, and one of the transcribed
thresholds turned out to be exactly that. KC-13's wall-clock bound was taken
verbatim from PM §4 K-3b: a drop-and-rebuild that exceeds **15 minutes** kills
the store. Its own basis is R8's measurement of about **1,070 documents per
second** and 9.7 MB on disk for about **5,500 documents** — which puts the
rebuild at roughly **5.1 seconds**. Fifteen minutes is 900 seconds: about 176
times the achievable measurement, needing a corpus near one million documents to
approach. No measurement this release can produce could trip it.

It is re-baselined to **60 seconds**, about twelve times the measured rebuild
time. That is still generous against machine-to-machine variance and cold-cache
effects, and it is trippable by a genuine throughput regression, which is what
the criterion is for. The amendment is legal because the register forbids
amendment only *after* the governed measurement has run, and this one has not;
the 15-minute figure and the reason it was replaced stay in the register so the
change is on the record rather than quietly applied. The criterion's other two
inputs — the rebuild does not complete, the diff is not clean — were fireable as
transcribed and are untouched.

The sweep found no second criterion that cannot fire. The narrowest margin is
KC-3, whose 5.0 pp half-width sits just above a published band of 2.7–4.9 pp;
it is retained because that band belongs to other people's harnesses and
Foreman's own half-width is exactly the unmeasured quantity T2 exists to
produce. That reasoning is recorded in the criterion's basis field so the next
reader does not have to re-derive it.

### Multi-condition criteria: one generalised rule instead of two special cases

The first round asserted "one metric, one number, one action" and then carved
out KC-8 and KC-9 by name because their sources are conjunctive. Two criteria
were left carrying more than one condition without a rule to cover them: KC-13
disjoins three distinct failure modes, and KC-15 conjoins three correctness
answers with a latency ratio. Naming exceptions one at a time is how the rule
erodes, so the carve-out is generalised into a test that KC-8, KC-9, KC-13 and
KC-15 all pass and that a genuinely bad proposal fails.

A predicate over several measured quantities may be registered as one metric
only where every input comes from **one** measurement, the combinator is written
out in the register as a total boolean function, every input shares the
criterion's **one** subject and **one** action, and the report prints each
input's value beside the verdict — naming which input made a disjunction true.
A proposal whose branches carry different actions, different subjects, or inputs
from two measurements is split instead, which is the original rule preserved.
The known-bad input this rejects: a criterion combining T4 task success with T7
unique-catch under "either" — two measurements, two subjects, two actions, and
no way to say what the number meant.

### Thresholds against locked measurements

Several criteria — KC-2a, KC-2b, KC-6, and by extension KC-8's and KC-10's
half-width comparisons — express their threshold against the run-to-run
confidence half-width rather than an invented constant. Read strictly, the
register's own "no fixed number, no registration" rule made them unregistrable,
which would have been the wrong outcome: a bar set against a *prior, locked,
hashed* measurement is more defensible than a number chosen from the air,
because it is the resolution of the instrument rather than a preference.

The rule is therefore stated instead of left implicit. A threshold counts as
fixed where the quantity it references was locked, published and hashed by an
**earlier** registered measurement, committed before the governed measurement
runs, and the register names both the supplying measurement (T2) and the locking
commit. A threshold against a quantity produced by the same run it governs is
still refused — a run that sets its own bar cannot fail it — and that is the
known-bad input the rule rejects.

### Every predicate in this package, and the known-bad input it rejects

| predicate | known-bad input it rejects |
|---|---|
| uncomputable on a zero denominator | KC-4 over a shadow window in which the checks would have blocked nothing: precision 0/0, reported as `UNCOMPUTABLE`, not as 100% and not as grounds for promotion |
| measured zero is not an absent measurement | KC-14 in a release whose census instrumentation never covered the store: the count is `UNCOMPUTABLE`, not the zero its threshold is looking for |
| uncomputable never counts as not-met | a v0.2.9 report that omits KC-1 because the census reports in v0.3.x: the omission is read as `UNCOMPUTABLE` and GP-5 does not ship enabled by default |
| uncomputable cannot be overridden | an architect override recorded against a criterion with no measured number; refused rather than recorded, since it would be the only route from "nothing measured" to "component ships" |
| fireability check | KC-13's 15-minute bound against a 5.1-second measured rebuild; re-baselined to 60 s before any governed measurement ran |
| derived-predicate rule | a proposed criterion joining T4 task success and T7 unique-catch under "either": two measurements, two actions, refused and split |
| locked-threshold carve-out | a criterion whose threshold is the half-width computed by its own T4 run; refused, while T2's pre-locked and hashed half-width is accepted |
| one action per criterion | KC-3's and KC-15's round-1 entries, which carried an action *and* a publication obligation in the same field; the obligation moved to a separate `Report:` field |

The one predicate in this package that cannot yet be demonstrated against a
known-bad input is the register's own pre-registration timestamp check, because
no measurement has run against it. It is listed here as an open item rather than
counted as closed.
