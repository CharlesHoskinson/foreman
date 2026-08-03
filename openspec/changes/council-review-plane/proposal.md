# Change: council-review-plane

## Why

Foreman's review step is one auditor, from one vendor family, reading whatever
happens to be sitting in a lane worktree. Every part of that sentence failed
during a single session on 2026-08-01, and each failure produced a confident,
well-formatted, false answer.

**One reviewer is not a quorum.** The cross-vendor invariant guarantees the
auditor differs from the worker; it guarantees nothing about the auditor being
right. Three rounds of audit on a 60-line script produced three BLOCKED
verdicts, of which one round contained three HIGH findings where **one was real,
one was false, and one was misattributed** (`bugeventlog.md`, 2026-08-02
Event 1). A single verdict carries no signal about its own reliability, and
nothing in the loop can detect an unstable judge.

**The reviewer reads the wrong artifact.** It is handed the lane worktree, which
is cumulative uncommitted state on whatever base the worktree happened to be
created from. In the round above, the worktree sat at `3eb6af6` while the
release branch was at `d5501ad`: the auditor filed a HIGH finding saying `jq`
had not been promoted to a mandatory dependency, three commits after it was.
A second finding flagged a file as out-of-scope that was carry-over from an
earlier round. Both were artifacts of the input, not judgements about the work.

**Nothing is blinded and nothing is order-checked.** The reviewer knows which
vendor produced the candidate, and a decisive comparison runs once, in one
order.

Council already specifies the fix, in `components/council/`, as normative
requirements with named failure modes: independent sealed proposals, blinded
candidate identity, deterministic checks before deliberation, quorum over
**independent failure domains** with the explicit rule that raw worker count
MUST NOT satisfy diversity, non-author order-checked judges, evidence-backed
minority blocking closure, and typed abstention including `judge_unstable`.

Its schema and domain packages are implemented and green — 114 tests in 9 files,
strict OpenSpec valid. What is missing for review is **not** provider adapters:
the Council localization plan forbids Council from launching a provider outside
Foreman lane ownership, and `host-integration/spec.md` requires that provider
workers cannot control Council. Foreman already owns dispatch through
`ac_select_auditor` and the lane machinery.

So the split is: **Foreman dispatches reviewers, Council decides.** This split
makes the advisory plane reachable in Council v0.3 before the Effect
application shell exists.

## What Changes

- Foreman gains `lane-review-bundle.sh`, producing an immutable record of **one
  round** — base SHA, head SHA, the round diff, and a refusal when the base is
  not an ancestor of the lane HEAD.
- Foreman gains `council-advise.sh`, which dispatches reviewers through the
  existing adapter path, collects verdicts, hands them to Council, and writes
  **one advisory artifact**. It is structurally incapable of writing
  `audit-verdict.json`.
- Council gains a `review` capability in `packages/domain`: admissibility
  checks, candidate blinding, quorum evaluation over failure domains, ranking,
  and a typed outcome.
- Council gains a bundle decoder in `packages/schema` and a CLI entry point so
  Bash can call it without an Effect runtime.
- `gate-eval.sh` MAY read the advisory record. It is never bound by it.

## Impact

- Affected specs: `council-review` (new).
- Affected code: `skills/foreman/scripts/lane-review-bundle.sh` (new),
  `skills/foreman/scripts/council-advise.sh` (new),
  `skills/foreman/scripts/lib/review-quorum.sh` (new),
  `components/council/packages/domain/src/review.ts` (new),
  `components/council/packages/schema/src/bundle.ts` (new),
  `tests/lane-review-bundle.bats`, `tests/review-quorum.bats`,
  `tests/council-advise.bats`, `tests/baseline.tsv`.
- **Not affected, deliberately:** `gate-eval.sh` and `merge-gate.sh` remain the
  only release and merge authorities. `audit-verdict.json` stays Foreman's.
  Council remains advisory for the whole of Council v0.3.
- Risk if this ships wrong: a shadow plane that quietly becomes an authority.
  The mitigation is structural rather than procedural — `council-advise.sh`
  refuses gate artifact filenames by name, and a test proves the refusal.
