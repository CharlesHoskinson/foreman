# Design — cross-vendor-audit-routing

## The invariant is about correlated failure, so it must be about model family

The rule "auditor vendor ≠ worker vendor" is a proxy. What it is trying to buy
is that the reviewer does not share the implementer's blind spots. CLI identity
was an adequate proxy while every CLI mapped to one model family. It stops being
adequate the moment a CLI is a gateway.

`agy` is a gateway. Its live model list includes `claude-sonnet-4-6`,
`claude-opus-4-6-thinking` and `gpt-oss-120b-medium` alongside the Gemini
family. So under a name-based check, "claude implemented, agy audited" passes
while the auditor may literally be an Anthropic model reviewing an Anthropic
model's work. The check would be satisfied and the property would be absent.

The fix is to compare what the proxy was standing in for. Each adapter publishes
the family a configured model belongs to; the router compares families and
refuses a match. This is a small change with an uncomfortable implication worth
stating: it means the invariant depends on a mapping Foreman maintains, and a
model name Foreman does not recognise cannot be classified. The design
therefore fails closed — an unclassifiable model is refused as an auditor with
a named reason, rather than assumed distinct.

## Enforcement has to be at every tier, because most rounds never reach the one that has it

`audit-run.sh` is a hard-mode script. Soft mode — the default — routes audits
through an agent lane and enforces nothing in code. So today's one enforcement
point covers the minority of rounds. Centralizing into `lib/audit-call.sh` and
calling it from both tiers is the whole of the structural change; the
`ROADMAP.md:238-239` entry already describes it, and this package is arguing
only that it cannot wait for v0.4.0 when the fourth vendor lands in v0.2.9.

The soft-mode call site is the harder half, because soft mode's "invocation" is
an architect model choosing an agent. The enforcement therefore has to happen
where the choice is recorded rather than where a process is spawned: the round
report carries the auditor's vendor, model and family, and a round whose
recorded auditor family equals its worker family is a gate failure. That is
weaker than refusing to spawn — it catches the violation after the fact rather
than preventing it — and the design accepts that asymmetry rather than
pretending soft mode has a chokepoint it does not have.

## Why an ordered list rather than architect judgement

Today the auditor is either the configured scalar or, when that is unusable, an
architect decision made fresh. Three problems: it is not reproducible, it is
not reportable, and it is not testable. An ordered preference list with the
worker vendor filtered out is deterministic, and the filter's output is a
recordable fact: "codex was preferred, codex was the worker, agy selected."

Substitution frequency also changes with four vendors. With two, substitution
was rare enough to narrate. With four and a race, it is routine — which is
exactly when silent substitution becomes dangerous, and why
`auditor_selected_because` is a required field rather than a nicety.

## Dual audit is specified and deliberately not defaulted

Two family-distinct auditors on one cold diff is now possible, and it is
tempting. The evidence says be careful.

R6 §6.1: a nine-model panel across seven families delivers about two effective
independent votes; individual top models matched or exceeded the full panel;
sophisticated aggregation closed at most 11% of the gap to the
independent-voting ideal; de-entangled reweighting bought at most +4.5% over
majority voting. R6 §6.2 adds the cost side — Anthropic's own measurement of
15× tokens, with token usage explaining 80% of performance variance.

So a second auditor is a real cost with a small and unmeasured benefit. It is
specified here because when it *is* warranted — a commitment boundary, a
migration, a diff that resisted two rounds — having it defined beats improvising
it. It is not defaulted because defaulting it would double audit cost on the
strength of an argument the evidence does not support.

**On disagreement, escalate rather than take the strictest verdict.** Defaulting
to strictest sounds safe and is not: it makes the system's verdict equal to its
most pessimistic member, which converts any auditor's false positive into a
block and trains the architect to override audits. Escalation to
`foreman-advisor` keeps the decision with a component that can read both
verdicts and the diff.

## Alternatives considered and rejected

**Keep the scalar `[audit] vendor` and let the architect substitute.** Rejected:
not reproducible, not reportable, not testable, and it scales badly — the
substitution rule has to be re-derived by a model on every round, which is
precisely the kind of implicit decision Cognition's multi-agent post-mortem
identifies as the dominant failure mode.

**Enforce in hard mode only, and document soft mode.** Rejected. That is today's
state, and today's state is why the invariant is stated six times in prose: the
prose is compensating for absent enforcement. Six restatements of a rule are
evidence the rule is not enforced, not evidence it is well documented.

**Compare CLI names and add a special case for gateway CLIs.** Rejected. A
special case is a list of known gateways that will be wrong the moment another
CLI adds a model from another family — and the whole reason this was caught is
that a CLI quietly became a gateway between one research lane and the next.
Comparing families is the same amount of code and does not need maintaining as
vendors change shape.

**Default to dual audit with a strictest-verdict rule.** Rejected on both
halves, above.

**Wait for v0.4.0 as `ROADMAP.md` schedules.** Rejected on sequencing: the
routing matrix grows from 3×2 to 4×3 in this release. Adding the fourth vendor
first and centralizing enforcement later means shipping a release in which the
number of ways to violate the invariant doubles while the number of places that
check it stays at one.

## Risks

- **The family mapping is a maintenance burden and a new failure mode.** A model
  Foreman cannot classify is refused as an auditor, which is safe but will
  produce refusals when a vendor renames models. Mitigation: the mapping lives
  with the adapter that knows the vendor, the refusal message names the
  unclassified model, and adding a mapping is a one-line change.
- **Soft-mode enforcement is after-the-fact.** A violating round is caught at
  the gate, not prevented. Mitigation: the gate failure is explicit and names
  both families; the alternative — pretending soft mode has a chokepoint — is
  worse.
- **Removing the codex-only refusal opens `audit-run.sh` to auditors whose
  adapters are less proven.** Mitigation: the router refuses a vendor with no
  audit adapter at selection time, with a named reason, and the post-audit
  tamper assertion applies to every vendor without exception.
- **Config migration.** Repos carrying `[audit] vendor = "codex"` must keep
  working. The scalar is read as a one-element list; a repo whose worker equals
  its only auditor now fails at selection, which is a behaviour change and is
  the intended one.
