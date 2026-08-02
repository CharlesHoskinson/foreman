# Design — council review plane

## The split that makes this reachable

Council's README lists provider adapters, Effect application services, research
tools, the MCP server and native host plugins as unimplemented. Read naively,
that puts a Council-backed review after all of them.

It does not, because Council must not dispatch providers anyway:

- The localization plan's global constraints say Council must not launch a
  provider process outside Foreman lane ownership.
- `host-integration/spec.md` requires that provider workers cannot recursively
  control Council.
- Foreman already owns dispatch: `ac_select_auditor` in `lib/audit-call.sh`
  selects a family-distinct auditor, the adapters exist, and `lane-run.sh` owns
  process lifecycle, timeouts and reaping.

So the boundary is **Foreman dispatches, Council decides**. Council needs no
provider code to become review-ready; it needs a way to receive verdicts and a
typed way to decide over them. That is a bundle decoder, a review module in the
existing runtime-free domain, and a CLI entry point.

## Why the bundle, and not the worktree

The reviewer currently reads a lane worktree. Three properties of that input
produced false findings in one round on 2026-08-01:

| Property of the worktree | Failure it produced |
|---|---|
| Base is whatever the worktree was created from | A HIGH finding that `jq` was not a mandatory dependency, filed three commits after it was promoted |
| State is cumulative across rounds | A HIGH finding that a file was out-of-scope, when it was carry-over from round 1 |
| Reviewer sees paths, not a round | No way to attribute a change to a round |

The bundle fixes all three by construction: it carries both SHAs, refuses a base
that is not an ancestor, and records the round diff. The refusal matters more
than the record — a reviewer reading superseded state files findings that look
correct and cannot be distinguished from real ones without re-verifying each,
which is the cost the bundle removes.

## Why quorum is the load-bearing requirement

Of everything Council specifies, the quorum rule is the one whose absence is
measurable today. The current loop has exactly one reviewer, so it cannot
distinguish "the reviewer is right" from "the reviewer is confident". Council's
rule — at least three admissible verdicts from at least two independent failure
domains, with raw count explicitly not satisfying diversity — converts that into
a stated, checkable condition, and its `quorum_not_met` outcome is honest where
a single verdict is merely available.

`evaluateAutomaticQuorum` already implements it in
`packages/domain/src/quorum.ts` with defaults `minimumProposals = 3`,
`minimumDomains = 2`. The Bash port in `lib/review-quorum.sh` exists so the
gate path does not require a Node runtime, and both are tested against the same
cases so they cannot drift.

## Reviewer supply

Quorum needs three admissible verdicts across two families. Available families:

| Vendor | Family | Usable as reviewer |
|---|---|---|
| `codex` | openai | Yes |
| `grok` | xai | Yes, unless grok authored the change |
| `claude` | anthropic | Orchestrator; usable as a reviewer |
| `agy` | (pinned per model) | **No** — `foreman-setup.sh --lane agy` fails before the adapter probe |

With grok as the implementer, the reviewer pool is `codex` and `claude`: two
families, three verdicts only if one family supplies two instances. That
satisfies `minimumDomains = 2` but makes the third verdict same-family, so the
domain count stays at two rather than three. Admitting `agy` — Task 1 of the
Council localization plan — is what makes a third independent domain available,
and it is sequenced accordingly.

## What stays out

Calibrated confidence weighting, critique rounds, minority-blocks-closure and
synthesis are all specified by Council and all deferred. Each needs the Effect
application shell, none is required to fix a measured defect, and adding them
would move Council from advisory toward decisive — which the release constraint
forbids.

## Failure mode this design accepts

The advisory plane can be ignored. If nobody reads the advisory record, the
review loop is exactly as good as it is today and the machinery is decoration.
This is accepted deliberately for v0.2.9.0 rather than mitigated by making
Council binding: a shadow plane that quietly becomes an authority is a worse
outcome than one that is ignored. The counter-measure is reporting, not
enforcement — `gate-eval.sh` may surface the advisory outcome so it is visible
at the moment a human decides.
