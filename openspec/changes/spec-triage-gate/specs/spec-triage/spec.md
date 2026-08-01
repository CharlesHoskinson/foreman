# Spec delta — spec-determinability triage gate

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: an under-determined spec is refused at all three grok entry points and routed to foreman-discover

WHEN a spec is submitted for grok/worker dispatch — soft mode via
`grok-implementer`'s Preflight, hard mode via `worker-run.sh`, or the durable
third path via `lane-run.sh`'s `LANE_VENDOR=grok` branch — the spec-triage
gate SHALL run BEFORE grok/CMD is spawned. IF the spec's declared
`determinability` is `exploratory` or `hybrid` or unset, OR the gate's
under-determination scan detects one of the narrowly-anchored
empirical-discovery signals (below), THEN the gate SHALL REFUSE the
dispatch: exit non-zero, emit `alert{kind:"spec_underdetermined"}`, and the
worker/grok process SHALL NOT be spawned, with a hint to route the spec to
`foreman-discover` first.

- The refusal SHALL mirror the existing refuse-at-the-door shape of the
  grok-secrets and Use-path-readiness gates in `lane-run.sh` (CMD never
  spawned, alert emitted, non-zero exit) — not a new refusal pattern.
- The gate SHALL fire at ALL THREE grok entry points: `worker-run.sh` (hard
  mode), `grok-implementer`'s Preflight (soft mode), and `lane-run.sh`'s
  `LANE_VENDOR=grok` branch (durable) — placed beside `lane_grok_secrets_scan`
  and gated on `LANE_VENDOR=="grok"` only, so the unset-`LANE_VENDOR` frozen
  path is byte-unaffected.
- The gate SHALL apply to implementer-lane dispatch only (grok/codex worker
  lanes); it SHALL NOT gate `foreman-discover`'s own worktree-isolated
  invocation.

#### Scenario: an exploratory spec is refused before grok runs (soft mode)

- WHEN a spec whose Objective reads "Reverse-engineer the live ledger API and
  figure out the live dust frontier" and whose Verification section is empty
  is submitted to `grok-implementer`
- THEN `spec-triage.sh` refuses with `spec_underdetermined` in its output and
  a "route to foreman-discover first" hint
- AND grok is never invoked (STATUS: refused, no CMD spawned).

#### Scenario: the same refusal fires on the lane-run.sh durable third path

- WHEN `lane-run.sh` is invoked with `LANE_VENDOR=grok` for a lane whose spec
  is under-determined
- THEN, inside the existing `LANE_VENDOR=="grok"` block (beside
  `lane_grok_secrets_scan`), the gate refuses the dispatch
- AND `el_emit "$RUN" alert "$LANE" '{"kind":"spec_underdetermined"}'` is
  emitted, `lane-run.sh` exits `$EXIT_CONFIG`, and CMD is never spawned
- AND a lane with `LANE_VENDOR` unset (the frozen path) is unaffected by this
  block.

### Requirement: the under-determination scan is narrowly anchored — it does not false-positive on legitimately-determined specs

The gate's scan SHALL match only unambiguous, anchored empirical-discovery
PHRASES in the Objective/Interfaces text — "reverse-engineer", "figure out
the live", "resolve the live", "determine … behavior empirically", "probe …
to determine", "discover what/how … behaves" — and SHALL NOT match bare
verbs such as `explore` or `discover the …` in isolation. A determined spec
that merely contains the word "explore", or the legitimate EARS example
*"discover the dirty file set,"* SHALL PASS the gate.

- The Verification signal SHALL refuse ONLY when the `## Verification`
  section body is EMPTY or every non-blank line is parenthetical-prose or a
  placeholder (`(manual smoke)`, `TBD`, `by inspection`, `manually`). The
  gate SHALL NOT maintain a command allow-list: an unrecognized-but-real
  verification command (`cargo build`, `make check`, `python -m http.server`,
  `shellcheck …`) SHALL be accepted as concrete verification and SHALL NOT be
  refused.

#### Scenario: a determined spec containing "explore"/"discover the dirty file set" is not refused

- WHEN a spec's Objective reads "Add an `explore` subcommand and, per the
  EARS example, discover the dirty file set" and its Verification is
  `cargo build && bash foo.sh explore --since HEAD~1`
- THEN `spec-triage.sh` exits `EXIT_OK`
- AND the spec is not classified as under-determined.

#### Scenario: an unrecognized-but-real verification command is not refused

- WHEN a spec's Verification section reads `python -m http.server 8080` and
  `make check` and its Objective contains no discovery phrase
- THEN `spec-triage.sh` exits `EXIT_OK`, because the gate maintains no
  command allow-list and treats any concrete, non-placeholder line as valid
  verification.

#### Scenario: empty or parenthetical-only verification is still refused

- WHEN a spec's `## Verification` section is empty, or contains only
  `(by inspection)` or `TBD`
- THEN `spec-triage.sh` exits non-zero with `spec_underdetermined`, because
  no concrete verification line survives.

### Requirement: the declaration alone is not sufficient — the narrow scan also refuses a mis-declared spec

The gate SHALL NOT trust the `determinability:` declaration alone. WHEN a
spec declares `determinability: determined` BUT its Objective/Interfaces
text matches one of the narrow, anchored discovery phrases above, THEN the
gate SHALL STILL REFUSE the dispatch.

- This SHALL mitigate the triage false-negative risk the parent design
  names: an exploratory spec mis-declared `determined`.

#### Scenario: a mis-declared spec is caught by the scan

- WHEN a spec's Objective reads "reverse-engineer the SDK" and its `## Meta`
  declares `determinability: determined`
- THEN `spec-triage.sh` still exits non-zero
- AND the declaration is overridden by the scan finding, not honored at face
  value.

### Requirement: after discovery converges, the gate admits — but does not compel — offloading a determined sub-spec (C4 doctrine, not an enforced gate)

WHEN `foreman-discover` converges and emits determined implementation
sub-specs, the architect SHOULD re-run the spec-triage gate on each
sub-spec. IF a sub-spec declares `determinability: determined` AND passes
the narrow under-determination scan (concrete Verification, no anchored
discovery phrases), THEN the gate SHALL ADMIT it to grok dispatch.

- The gate ADMITS the sub-spec; it does NOT and CANNOT compel the architect
  to route it to grok rather than self-implementing it. There is NO coded
  gate on the architect's own edits — foreman cannot refuse the top model
  its own write access. This requirement SHALL NOT be read as "the gate
  enforces admission" or "the gate enforces offload"; any such claim is
  withdrawn.
- C4 (re-decomposition and offload after discovery converges) SHALL be
  documented in `five-part-spec.md`/`roles.md` as a discipline, not enforced
  doctrine. Its only signal is the `workload-fit-accounting` package's C5
  fit-report: a low offload fraction flags the poor cost-fit when the
  architect self-implements a determinable slice instead of offloading it.

#### Scenario: a post-discovery sub-spec is admitted to grok (not compelled)

- WHEN a determined implementation sub-spec produced by `foreman-discover`
  (facts inlined, concrete Verification, `determinability: determined`) is
  re-submitted to the spec-triage gate
- THEN the gate exits `EXIT_OK`
- AND the sub-spec MAY be dispatched to `grok-implementer`
- AND nothing coded prevents the architect from implementing it directly
  instead — that choice is a discipline (C4), measured only by the C5
  fit-report, not enforced by this gate.
