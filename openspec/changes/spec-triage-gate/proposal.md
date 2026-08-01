# Change: spec-triage-gate

## Why

Operator feedback from a real run (reverse-engineering a live ZK SDK +
indexer). Verdict: foreman's cost premise — cheap grok implements what an
expensive architect fully-determines — failed on that workload. grok wrote
nothing across rounds 1-2 + grok-multiround (all empty-burst, correctly
detected by the v0.2.8.1 empty-burst detector), and the expensive Claude lane
did BOTH the empirical discovery AND the implementation.

`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` diagnoses
why: foreman routes on "how much does the outcome depend on judgment the spec
can't capture?" (`skills/foreman/SKILL.md:102-105`) — little goes to grok, a
lot stays with the architect. For exploratory work the spec can't be finished
because the required knowledge does not exist yet, so the task always falls
into "keep with architect," abandoning the cost premise entirely. The
empty-burst detector catches the resulting waste, but only AFTER 3 rounds are
already spent. Nothing today refuses an under-determined spec BEFORE it
reaches grok.

## What changes

- A coded pre-implement gate, `spec-triage.sh`, classifies every implement
  request and refuses to route an under-determined spec to grok — routing it
  to `foreman-discover` instead — catching the empty-burst waste before it
  happens.
- The five-part spec envelope gains a required `## Meta` declaration
  `determinability: determined | exploratory | hybrid` (the architect's
  explicit call).
- The under-determination scan is deliberately NARROW to avoid
  false-positives on legitimately-determined specs: it matches only
  anchored, unambiguous empirical-discovery PHRASES in the Objective/
  Interfaces ("reverse-engineer", "figure out the live", "resolve the live",
  "determine … behavior empirically", "probe … to determine", "discover
  what/how … behaves") — NOT bare verbs like `explore`/`discover the`. A
  determined spec merely containing "explore" or the legitimate EARS example
  "discover the dirty file set" SHALL pass.
- Verification is refused ONLY when the `## Verification` body is empty or
  entirely parenthetical-prose/placeholder (`(manual smoke)`, `TBD`, `by
  inspection`) — NOT for an unrecognized-but-real command (`cargo build`,
  `make`, `python -m http.server`, `shellcheck`). The gate maintains NO
  command allow-list.
- IF `determinability != determined` OR the narrowed scan detects
  under-determination (per the above), THEN the gate REFUSES (non-zero exit,
  `alert{kind:"spec_underdetermined"}`, CMD never spawned) with a "route to
  foreman-discover first" hint. The declaration alone is never sufficient —
  the scan runs regardless of the declared value.
- The gate fires at ALL THREE grok entry points: `agents/grok-implementer.md`'s
  Preflight (soft mode), `skills/foreman/scripts/worker-run.sh` (hard mode),
  and `skills/foreman/scripts/lane-run.sh`'s `LANE_VENDOR=grok` branch
  (durable third path) — all three mirroring the existing grok-secrets
  refusal shape (`lane-run.sh`'s `grok_secrets_refused` alert).
- After `foreman-discover` converges, the SAME gate is re-run on the
  implementation sub-specs it emits; a `determined` sub-spec is now
  ADMITTED to grok. This is where the cost premise is recovered on the
  implementation slice (C4) — but the gate only ADMITS the offloaded
  sub-spec to grok; it does NOT compel the architect to produce one. There
  is no coded gate on the architect's own edits — foreman cannot refuse the
  top model its own write access. C4 is doctrine, not a gate; its only
  signal is the `workload-fit-accounting` package's C5 fit-report (a low
  offload fraction flags the poor cost-fit).

## Impact

- Affected: new `skills/foreman/scripts/spec-triage.sh` +
  `tests/spec-triage.bats`; `agents/grok-implementer.md` (Preflight hook);
  `skills/foreman/scripts/worker-run.sh` (hard-mode gate, guarded so it does
  not apply to `foreman-discover`'s own dispatch);
  `skills/foreman/scripts/lane-run.sh` (the `LANE_VENDOR=grok` branch, durable
  third path); `skills/foreman/references/five-part-spec.md` (the
  `determinability:` field + template note); `skills/foreman/references/
  roles.md` (C4 re-triage doctrine, stated as unenforceable-by-construction).
- No change to grok-multiround / the empty-burst detector — they remain the
  backstop for a spec that slips through mis-classified as `determined`.
