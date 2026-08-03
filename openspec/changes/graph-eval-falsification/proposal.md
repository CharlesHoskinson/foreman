# Change: graph-eval-falsification

## Why

This is the package that decides whether the graph plane was worth building.
It is written so that the answer can be **no**.

SYNTHESIS §3 states the case against without hedging, and the numbers are not
close:

- **BM-25 beats all nine GraphRAG systems on True/False** (84.49 against a best
  graph score of 82.59 and a worst of 77.22), and **six of nine fall below
  BM-25 on the reasoning metric**. A zero-LLM-cost lexical retriever
  out-reasons most graph pipelines in the benchmark.
- **LightRAG spent 83.9M construction tokens and 12,976 seconds of indexing to
  score 71.22 — below TF-IDF's 71.71.** Microsoft GraphRAG spent 79.9M tokens
  for +0.79 over TF-IDF, roughly 101M tokens per accuracy point.
- **An assembled neurosymbolic pipeline lost to its own text-only baseline:
  61.6% against 67.3%**, with the deterministic sub-check locally perfect
  (one credit went 50% → 100%). The composition was net-negative because
  extraction failures and conservatism cost more globally than the symbolic
  precision bought. This is the default failure mode of the architecture
  Foreman is building.
- **Nine frontier LLMs across seven families behave as ~2 effective
  independent votes.** Individual top models matched or exceeded the full
  panel; the gap to the independence ideal was 8–22 pp and better aggregation
  closed at most 11% of it. The independence argument justifies roughly two
  vendors, not four.
- **"Graphs reduce hallucination" is unmeasured.** The KG-hallucination survey
  contains no measured reduction anywhere and its table has no performance
  column.
- Foreman has **never run a cost-matched single-agent baseline**, and the paper
  that measured auto-designed multi-agent systems at up to 10× cost for no gain
  charges precisely that omission — *"masking critical architectural gaps by
  failing to account for the marginal utility of increased computational
  cost."*

Two independent lanes converge on the same demand. N1 §9 Q2: *"what is 'just
prompt the model with well-chosen context' worth on Foreman's actual tasks?
**Without this number the graph plane cannot be justified or falsified.**"*
R6 §6.2: *"the honest null hypothesis for vNext is 'one strong model, one
long-context session, host-side deterministic checks, and a merge gate' — and
Foreman has never measured itself against it."* R4 §10.5 sets the ship gate in
the same terms and expects to fail it for single-task context.

Meanwhile the two numbers the release most needs are currently **uncomputable**.
M5, the per-vendor-pair unique-catch rate — *"the metric that decides whether
multi-vendor pays for itself, the single most important number in this
document"* — cannot be computed because nothing in the current gate records
findings as first-class objects. And Foreman's own run-to-run σ has never been
measured, which means every improvement claim the release could make is
currently unfalsifiable in the most boring way: nobody knows the noise floor.

A falsification harness that cannot return a negative verdict is the same
failure mode as a test that cannot fail. This package therefore pre-registers
its kill criteria, with their thresholds and their actions, **before** the
measurements are taken.

## What changes

- **A query census.** One release of real architect and worker queries,
  instrumented rather than recalled, classified into point-lookup /
  single-document / genuine multi-hop-cross-run. The census instrumentation
  ships with GP-1 and runs ahead of the rest of this package. If the
  multi-hop-cross-run share is small, the store materialisation is *activity
  without progress* and GP-6 is frozen.
- **A locked prompt-only baseline arm.** "One strong model + spec + diff +
  report in the prompt + deterministic checks", at equal cost, measured and
  **locked — content-hashed and committed — before the graph arm is measured**,
  so it cannot be quietly tuned after the fact. A baseline that improves after
  you see the treatment result is not a baseline.
- **σ measured before any improvement is claimed.** The first release's canary
  budget goes to measuring Foreman's own run-to-run variance, not to claiming
  an improvement. No delta smaller than the measured confidence interval may be
  reported as one.
- **Shadow-mode Tier-3.** Open-world evidence-sufficiency checks run in shadow
  for a pre-declared number of merges, precision measured on our own data, and
  promotion to blocking only on a pre-declared threshold. Never on vibes.
- **A per-vendor serializer and K sweep.** Format preference *inverts* across
  vendors and model generations — JSON +9.68 over Markdown on one model, −7.33
  on its successor; plaintext 76.2 against JSON 21.95 within one family; the
  intersection-over-union of best-format sets across model series is *"often
  below 0.2."* A single serializer choice is a bet on one vendor, and Foreman is
  explicitly cross-vendor. The sweep is per vendor, and an unswept vendor is
  flagged as unvalidated rather than assumed fine.
- **M5 per vendor pair, made computable.** Defined, computed from GP-1's
  finding telemetry, and computable offline against the replay corpus by
  swapping one recorded auditor transcript for another vendor's on the same
  diff — at zero new spend.
- **Every metric carries its misreading and its companion number**, per R6's
  Table III discipline. A high resolution compression ratio is not automatically
  good: compression alone rewards over-merging, and an over-merged graph is
  connected and false.
- **A pre-registration register**: each kill criterion with its one metric, its
  one fixed threshold, its one measuring subject, its one action
  (revert / descope / keep-off), an explicit rule for when its metric has no
  value, and a timestamped commit that lands before the measuring run. A
  criterion whose denominator is zero returns `UNCOMPUTABLE`, which is never a
  pass; a criterion no achievable measurement could trip is re-baselined or
  struck.

## Impact

- **New:** the census instrumentation and classifier; the baseline arm and its
  lock; the σ measurement; the shadow-mode Tier-3 harness; the serializer/K
  sweep; the M5 computation; the pre-registration register; the falsification
  report published each release.
- **Affected:** the release checklist gains the falsification report; the PR
  body and README gain the claim restrictions this package enforces (no
  hallucination-reduction claim; no four-vendor independence claim below the M5
  threshold).
- **Depends on GP-5 (`graph-context-builder`)** for the artifact under
  evaluation — the hashed, budgeted context block — and on **GP-1
  (`decision-lineage-and-telemetry`)** for the usage, finding and verdict events without
  which M1–M8 and every cost-matched comparison are uncomputable. Neither is
  implemented here. The census instrumentation is the one part that ships with
  GP-1 rather than waiting.
- **Sole owner of M5 (cross-vendor unique-catch rate).** The current metric
  reference consumes this package's definition, so exactly one definition
  exists. M5 is the only number that
  justifies the vendor count, and two definitions of it would have let two
  packages report different answers to the release's central question.
- **Governs GP-6 (`graph-store-port`).** The census outcome is the architect's
  documented basis for landing or freezing the store.
- **May conclude the graph plane was not worth building.** That outcome has a
  landing path specified here — an off-switch, an A/B path, and a published
  report — rather than being an outcome the harness structurally cannot reach.
