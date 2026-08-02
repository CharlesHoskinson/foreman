# Regression harness tier budgets

The machine-readable policy is
[`regression-tier-budgets.json`](regression-tier-budgets.json). The fixed
material budget-review margin is 20%.

| Tier | Maximum runtime | Maximum vendor cost | Cadence |
|---|---:|---:|---|
| Tier 0 | 120 seconds | USD 0 | every commit |
| Tier 1 | 30 seconds | USD 0 | every commit or pull request |
| Tier 2 | 7,200 seconds | USD 18 | explicit maintainer invocation only |

Tier 2's maximum cost covers two comparison conditions across at most 12
specs, repeated three times: `2 x 12 x 3 = 72` calls at a declared maximum
of USD 0.25 per call. It has an empty `automatic_triggers` array and no Tier 3
entry because Tier 3 was cut.

`tests/tier2-collect.sh` is the manual-only collection boundary. It requires
the literal `--acknowledge-paid-vendor-calls` option and an explicitly supplied
adapter path; nothing in the repository invokes it automatically. Its tests
use only `tests/fixtures/tier2/fixture-adapter.sh`, which reads recorded JSON.
`tests/tier2-compare.sh` then evaluates a collected record and never invokes an
adapter. Each comparison output embeds the relevant declared budget, measured
runtime and cost, planned call count/cost, breach delta, and review flag.

Every run record also names its invocation source. Tier 0 permits `commit`,
Tier 1 permits `commit` or `pull_request`, and Tier 2 permits only `manual`.
An explicit override can admit another source for Tiers 0 or 1, but never for
Tier 2: release, scheduled, commit, and pull-request Tier 2 sources are refused.

For a nonzero budget, measured use above the budget is a breach; measured use
strictly above 120% of the budget also requires review. For a zero cost budget,
any nonzero spend is an unconditional breach and review, and its percentage
margin is `uncomputable` because the declared budget is the zero denominator.
