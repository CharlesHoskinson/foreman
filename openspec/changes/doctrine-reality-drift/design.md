# Design — doctrine-reality-drift

## What can actually be checked

A checker cannot verify prose. It cannot decide whether *"durable lanes are the
normal path"* is true.

What it can verify is the class of claim that actually misleads people: a
**pinned fact** — a number, a path, a default, a supported value, or the
existence of a capability — asserted in a document and independently observable
in the code. Every one of R5's eleven is of that shape:

- a cap value (`grok=1` vs `grok:3`)
- a config default (`enabled = false` vs "the normal path")
- whether a consumer exists (`gate-eval.sh` reading `[audit.policy]`)
- whether a code branch exists (a `claude` arm in `wc_build_argv`)
- which interpreter a CI job uses (`pwsh` vs `powershell.exe`)
- whether a tool validates (`openspec validate` over the change packages)

So the registry's unit is a claim about a pinned fact, and the scope limit is
stated in the spec rather than discovered by a disappointed user.

## The registry row, and why the observed value is in it

A row is:

```text
claim_id | doc_ref | claim_text | probe | expected | observed_at_registration | owner
```

`observed_at_registration` is the value the probe returned on the day the row
was written. It exists for one reason: **it lets the checker distinguish "the
probe disagrees" from "the probe found nothing."**

A probe whose target has been renamed or moved returns empty. Compared against
`expected`, empty is just a mismatch, and a maintainer under time pressure will
"fix" the row by loosening it. Compared against a recorded prior observation,
empty is diagnosable: the claim's subject has moved and the probe needs
repointing, which is a different job from correcting a document.

`owner` names the change package or reference document responsible for the
claim, so a failure routes to someone rather than to everyone.

## The empty-result rule

**An empty probe result is a failure, never a pass.** This is the single most
important detail in the design, because it is how every check of this shape
dies: the probe silently stops matching, the check goes permanently green, and
the gate becomes a decoration that costs CI time and buys nothing.

`test-infrastructure-hardening` states the general rule for the suite — *"a test
that cannot fail is not a test"* — and this package adopts it rather than
inventing a second mechanism. The concrete adoption: the checker's own test
suite mutates the repository fixture and asserts each probe class goes red.

## Alternatives considered and REJECTED

**A documentation review pass each release.** Rejected on the evidence. This
repo already has a documentation gate, an attentive maintainer, an append-only
bug log, and a habit of writing honest "honest limits" sections — and it
accumulated eleven live contradictions anyway, several surviving multiple
releases. Human review is what found them; the finding is that it found them
once, late, and by accident. Review is not being replaced, it is being given a
ratchet so the same eleven cannot come back.

**Generate the documentation from the code.** The strongest alternative, and
rejected only for scope. It works well for reference tables — config keys, exit
codes, event vocabularies, the caps list — and those are genuinely the safest
subset. It does not work for the claims that mislead, which are narrative:
*"durable lanes are the normal path"*, *"CI remains final authority"*, *"empty
vendor = auto"*. No generator produces those sentences, and a generator that
covered only the tables would leave the narrative claims exactly as unchecked as
they are now while creating the impression that documentation is derived. A
narrow generated subset is a good v0.4.0 candidate and is named as such; it is
not this release's mechanism.

**An LLM auditor that reads the docs and the code and reports contradictions.**
Rejected as the mechanism, permitted as a discovery tool. N1 §8.1 is direct: an
LLM is not a sound verifier, and its output is a claim, not a gate. N1 §8.3(15)
is more specific still — *"semantic RAG is fundamentally unsuited for rule
enforcement."* A gate that costs a model call per commit will be skipped, will
be non-deterministic, and will produce false positives that erode trust in the
gate itself. What an LLM sweep is genuinely good at is **finding candidate
claims to register** — a one-off seeding job, whose output is then converted to
deterministic probes by hand. That use is permitted and its output is not
trusted until it is a probe.

**Fail the build on any unregistered claim in a document.** Rejected as
unimplementable. There is no way to enumerate "claims" in prose, so the rule
could not be evaluated; and pretending it could would make the checker dishonest
about its own coverage, which is the exact failure mode this package exists to
prevent.

**Report a coverage percentage.** Rejected. A percentage requires a denominator
— the total number of claims in the documentation — which is unknowable. The
checker reports the count of registered claims and their pass/fail state, and
nothing that could be read as coverage. A green doctrine check means *"every
registered claim still holds"*, and the output says exactly that.

## Where it runs

Inside `docs-check.sh`, alongside `markdownlint-cli2`, `codespell` and
`lychee`, recorded in the same result structure. That gate already runs on every
change package's task list and is already a merge-gate input via
`docs-check.json` (`gate-eval.sh:49-53`), so wiring it there gives it teeth
without inventing a new enforcement point.

It must be fast. Every probe is a `grep`, a `jq`, a `git` invocation or a
`toml_get` — no builds, no network, no model calls. If a probe cannot be
expressed that cheaply, the claim is probably narrative and does not belong in
the registry.

## Two adjacent checks that share the mechanism

**Stale change folders.** A package under `openspec/changes/` whose `tasks.md`
has zero completed checkboxes while `ROADMAP.md` records the work as shipped is
a contradiction between two documents rather than between a document and the
code, but it is the same defect and the same probe shape. Three exist today
(`hard-mode-launcher`, `el-emit-spawn-reduction`, `test-harness-fork-tax`), and
R5 flags all three.

**Unstamped workarounds.** R2's P21 and N1 §8.4 together: a workaround added for
a model's behaviour becomes dead weight, or actively wrong, when the model
changes — and frontier behaviour has been measured drifting under a fixed alias
with no version bump. A workaround comment carrying no model and no date cannot
be re-evaluated by anyone. This is reported, not failed, at first: the registry
starts by counting them, and the release decides the threshold once the count is
known. Failing a gate on a number nobody has measured is how a gate gets
disabled.

## Risks

- **The registry rots.** Mitigated by the empty-result rule, by
  `observed_at_registration`, and by the checker's own mutation tests. Not
  eliminated — this is the residual risk of the whole approach and it should be
  stated in the reference documentation rather than discovered.
- **Coverage theatre.** A green doctrine check will be read as "the docs are
  true." Mitigated by reporting registered-claim counts and never a percentage,
  and by the reference documentation stating the scope limit — pinned facts,
  not prose — in the same paragraph as the gate's name.
- **A probe that is too clever.** A probe encoding a regex over five files is a
  second implementation of the thing it checks, and it will drift on its own.
  Probes must be short and about one fact. A claim needing a complicated probe
  is a signal that the claim is really several claims.
- **False failures block merges.** The checker fails with the claim id, the doc
  location, the expected value and the observed value. That is enough to either
  correct the code, correct the document, or repoint the probe — none of which
  requires investigation. A failure that cannot be acted on from its own message
  is a bug in the probe.
