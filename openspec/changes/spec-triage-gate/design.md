# Design — spec-triage-gate

Parent design:
`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` (C1, C4).
Parent plan: `docs/superpowers/plans/2026-07-19-empirical-workloads.md`
(Package A).

## Approach

One new script, THREE call sites (the audit's third-path correction), one
doctrine addition:

1. `skills/foreman/scripts/spec-triage.sh SPEC_FILE` — sources `common.sh`;
   reads the spec; extracts `determinability:` from its `## Meta` section
   (default: unset). REFUSES (`EXIT_CONFIG`, printing `spec_underdetermined:
   <reason>; route to foreman-discover first`) when ANY of:
   - **(a) declaration** — `determinability` is `exploratory`/`hybrid`/unset.
   - **(b) discovery phrases (narrow, anchored)** — the Objective/Interfaces
     match only unambiguous empirical-discovery PHRASES, never bare verbs:

     ```bash
     grep -iEq 'reverse[ -]engineer|figure out the (live|real)|resolve the live|determine .*behavior (empirically|by probing)|probe .* to determine|discover (what|how) .* (behaves|returns)' "$spec"
     ```

     This deliberately does NOT match bare `explore` or `discover the …`, so
     a determined spec adding an `explore` subcommand, or the legitimate EARS
     example *"discover the dirty file set,"* is NOT refused.
   - **(c) non-concrete verification** — refused ONLY when the `##
     Verification` body is EMPTY or every non-blank line is
     parenthetical-prose/placeholder (`(manual smoke)`, `TBD`, `by
     inspection`, `manually`). The gate maintains NO command allow-list: any
     surviving concrete line — including an unrecognized-but-real command
     like `cargo build`, `make check`, `python -m http.server`, or
     `shellcheck …` — counts as verification and PASSES.

   Else exits `EXIT_OK`.
2. Wired into ALL THREE grok dispatch paths:
   - `agents/grok-implementer.md`'s Preflight (soft mode, after the `grok
     --version` check).
   - `skills/foreman/scripts/worker-run.sh` (hard mode, before the "Build
     worker argv" section, `worker-run.sh:99-140`).
   - `skills/foreman/scripts/lane-run.sh`'s `LANE_VENDOR=grok` branch
     (`lane-run.sh:344`, the durable third path the audit flagged as
     previously ungated) — added right beside `lane_grok_secrets_scan`,
     gated on `LANE_VENDOR=="grok"` only so the unset-`LANE_VENDOR` frozen
     path is byte-unaffected.

   All three mirror the grok-secrets refusal shape (`el_emit "$RUN" alert
   "$LANE" '{"kind":"grok_secrets_refused"}'` → here
   `'{"kind":"spec_underdetermined"}'` → then `exit "$EXIT_CONFIG"`/`die
   EXIT_CONFIG`). Guarded so the gate only applies to implementer-lane
   dispatch, not `foreman-discover`'s own worktree-isolated invocation.
3. C4 re-decomposition (doctrine, not a gate): after `foreman-discover`
   converges, the architect SHOULD re-run `spec-triage.sh` on each
   implementation sub-spec it emitted; a sub-spec now declaring `determined`
   (facts inlined per the `captured-facts-convergence` package) passes and
   is ADMITTED to grok. But there is no coded gate on the architect's own
   edits — foreman cannot refuse the top model its own write access, so
   nothing forces the architect to actually offload rather than
   self-implement. `five-part-spec.md`/`roles.md` document C4 honestly as a
   discipline whose only signal is the `workload-fit-accounting` package's
   C5 fit-report (a low offload fraction flags the poor cost-fit) — NOT as
   enforced doctrine.

## Key decisions

- The declaration alone is never sufficient: the scan runs even when
  `determinability: determined` is declared, so a mis-declared exploratory
  spec ("reverse-engineer the SDK" declared `determined`) is still refused —
  this is the false-negative mitigation the parent design names under Risks.
- The scan is deliberately NARROW, not broad: anchored phrases over bare
  verbs, and empty/parenthetical-only over a command allow-list — this is
  the false-positive mitigation the audit required (no refusing a
  legitimately-determined spec that says "explore" or "discover the dirty
  file set", and no refusing real-but-unrecognized verification commands).
- The gate is a REFUSAL (CMD never spawned), not a warning — matching the
  "refuse-at-the-door" pattern the grok-secrets and Use-path-readiness gates
  already use in `lane-run.sh`, not a new shape. This now applies uniformly
  at all three grok entry points, not just two.
- C1 only ADMITS a re-triaged sub-spec to grok; it does NOT and CANNOT
  compel the architect to route there instead of self-implementing (C4 is
  unenforceable by construction — see the parent design's Risks). Any
  language claiming the gate "enforces admission" or "enforces offload" is
  withdrawn; C4 is doctrine measured by C5, not a guarantee.
- Does not touch grok-multiround / the empty-burst detector: they remain the
  safety net for a spec that slips through mis-classified as `determined`;
  this gate's job is to catch it earlier, not replace the backstop.

## Verification

`tests/spec-triage.bats` proves: a determined spec (concrete verification, no
discovery phrases) passes; an exploratory spec (discovery phrases,
non-concrete verification) is refused with `spec_underdetermined`/
`foreman-discover` in the output; a spec DECLARED `determined` but whose text
contains discovery phrases is still refused (declaration is not enough); a
determined spec that merely contains "explore"/"discover the dirty file set"
passes (false-positive guard); a determined spec whose verification is an
unrecognized-but-real command (`cargo build`, `python -m http.server`) passes
(no command allow-list); a determined spec with empty/parenthetical-only
verification is refused. Implementer: Sonnet 5. Audit: Opus 4.8.
