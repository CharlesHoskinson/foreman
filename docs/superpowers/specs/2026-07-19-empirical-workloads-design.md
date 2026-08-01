# foreman — empirical-workload support: DISCOVER → CONVERGE → IMPLEMENT (design)

**Status:** approved design (brainstorming, 2026-07-19). **Source:** operator
feedback from a real run (reverse-engineering a live ZK SDK + indexer). Verdict:
foreman's framework, gates, and audit held up honestly, but its **core cost
premise — cheap grok implements what an expensive architect fully-determines —
failed** on this workload. grok wrote nothing across rounds 1-2 + grok-multiround
(all empty-burst, correctly detected); the expensive Claude lane did BOTH the
empirical discovery AND the implementation.

## The diagnosis (why the premise failed)

foreman routes on *"how much does the outcome depend on judgment the spec can't
capture?"* (`SKILL.md:102-105`): little → grok; a lot → *"keep with architect."*
For **exploratory/empirical** work the spec can't be finished because the required
knowledge **does not exist yet** — it must be discovered against a live system (an
undocumented API, a ZK SDK's real behavior). So the task falls into "keep with
architect," which **abandons the cost premise entirely** — the expensive lane does
discovery *and* implementation. grok-multiround + the empty-burst detector
(v0.2.8.1) worked exactly right: they caught grok writing nothing and failed
loudly. But detecting the failure after 3 wasted rounds is not the same as
**never handing grok an under-determined spec** and **still offloading the
determinable slices** once the unknowns are resolved.

The insight: exploratory work is not one indivisible "judgment-heavy" blob. It is
a **DISCOVERY phase** (empirical, inherently high-judgment — grok cannot
reverse-engineer a live API from narration; discovery *should* be the expensive
lane) followed by an **IMPLEMENTATION phase** that becomes *determined and
offloadable to grok once discovery converges*. Today foreman collapses both into
the expensive lane. This enhancement splits them.

## The reframe: a DISCOVER → CONVERGE → IMPLEMENT pipeline

Turn the binary route (grok *or* architect) into a pipeline:

```text
task → [determinability triage] → determined?  → grok implement → audit
                                 → exploratory? → foreman-discover (bounded, empirical)
                                                    → captured-facts + determined sub-specs
                                                    → [re-triage] → grok implement → audit
                                 → hybrid?      → discover the unknowns, offload the rest to grok
                              (+ workload-fit accounting throughout)
```

The cost premise is preserved on the **implementation slice** even for exploratory
work: discovery (expensive, unavoidable, correct) produces a determined spec whose
implementation grok can execute.

## Honest scope (post-audit reframe)

An Opus audit (2026-07-19) found the first draft over-promised. This section is the
correction of record; every component below is written to it. The core finding:

**You cannot refuse the top-model architect its own write access.** C1's gate stops
the *grok door*; nothing coded stops the architect from implementing a determinable
slice itself. So the enhancement does **not** *force* offloading — it can't. What it
actually delivers is two coded/measurable levers plus a discipline:

1. **C1 — coded pre-refusal (the one genuinely-new enforcement).** Refuses an
   under-determined spec *before* any grok burst is spawned, at all three grok entry
   points. This is what stops the "3 empty rounds" waste. Self-contained and testable.
2. **C5 — honest measurement (the one genuinely-new signal).** An up-front fit
   estimate and a post-run discovery-vs-offload split with a poor-fit verdict. This is
   what would have told the operator, up front, that their run was a poor cost-fit.
3. **C3/C4 — discipline, not machinery.** Offloading the determinable slice back to
   grok stays an architect *discipline*. C3 makes discovery-derived specs write-first
   so the slice *can* offload cleanly; C4 is the re-triage doctrine. Neither is a gate.
   **C4's only signal is the C5 fit-report** — the design makes no "enforces offload"
   claim.

Consequent corrections carried into the components:

- **C5 event source.** Agent-dispatched lanes emit **zero** `el_emit` entries
  (`el_emit` is called only by host-side scripts — `lane-run.sh`, `lane-supervise.sh`,
  `resume.sh`, `watch.sh`, `worker-run.sh`). The fit-report therefore **cannot** read
  discovery effort from the event log. It reads a host-side **fit ledger**
  (`$RD/fit.jsonl`) that the architect appends to at estimate-time and split-time. Where
  it counts the offload side from real lane events, the grok label is **`worker-grok`**
  (`worker-run.sh:77`), never `grok:1`.
- **C1 heuristics.** Discovery detection anchors on unambiguous *objective* phrasing
  ("reverse-engineer", "figure out the live", "resolve … behavior empirically"), not
  bare verbs — so it does **not** refuse a determined spec that merely contains
  "explore"/"discover" (e.g. the legitimate EARS example *"discover the dirty file
  set"*). Verification is refused only when **empty or parenthetical-prose**
  (`(manual smoke)`, `TBD`), **never** for an unrecognized-but-real command
  (`cargo build`, `make`, `python -m http.server`, `shellcheck`).
- **C1 third path.** The gate is wired into `lane-run.sh`'s `LANE_VENDOR=grok` branch
  (mirroring the `grok_secrets_scan` refusal shape), so all three grok entry points —
  `worker-run.sh` (hard), `grok-implementer` (soft), `lane-run.sh` (durable) — refuse
  under-determined specs.
- **C2 guarantees.** `foreman-discover` is a bounded **workflow + agent-def**, not a
  coded lane. Its round budget is an **advisory self-report** (a Claude agent cannot
  hard-enforce its own turn budget the way `lane-run.sh`'s coded timeout/kill can). Its
  one sound, checkable guarantee is the **convergence criterion**: the sub-specs it
  emits must themselves pass C1 before any grok dispatch. It never writes product code.
- **C3 provenance.** Captured-facts formalizes the **existing** write-first doctrine at
  `grok-implementer.md:98-104`; it is a spec-authoring reference, not net-new machinery.

## The five components

### C1 — Spec-determinability triage gate (coded; capability `spec-triage`)

A coded pre-implement gate that classifies every implement request and **refuses
to route an under-determined spec to grok** (routing it to discovery instead) —
catching the empty-burst waste *before* it happens (the empty-burst detector
catches it *after*).

- The five-part spec envelope gains a required `determinability:
  determined | exploratory | hybrid` declaration (the architect's explicit call),
  AND the gate scans for under-determination signals. The scan is deliberately
  **narrow** to avoid false-positives on legitimately-determined specs:
  - **Objective** — matches only unambiguous empirical-discovery *phrases*
    ("reverse-engineer", "figure out the live", "resolve … behavior empirically",
    "determine … by probing"), NOT bare verbs. A determined spec that merely
    contains "explore" or "discover" (e.g. the real EARS example *"discover the
    dirty file set"*) is NOT refused.
  - **Verification** — refused only when the section is **empty** or is
    **parenthetical prose** (`(manual smoke)`, `TBD`, `by inspection`). An
    unrecognized-but-real command (`cargo build`, `make`, `python -m http.server`,
    `shellcheck …`) is accepted — the gate does not maintain a command allow-list.
  - **Interfaces** — matches a literal `discover X` / `TBD` placeholder, not a
    named-but-unfamiliar symbol.
- IF `determinability != determined` OR the scan detects under-determination,
  THEN a grok/worker dispatch is REFUSED (non-zero, `alert{kind:"spec_underdetermined"}`,
  CMD never spawned) with a "route to foreman-discover first" hint — the same
  refuse-at-the-door shape as the grok-secrets and Use-path-readiness gates. The gate
  fires at **all three grok entry points**: `worker-run.sh` (hard mode),
  `grok-implementer` preflight (soft mode), and `lane-run.sh`'s `LANE_VENDOR=grok`
  branch (durable) — mirroring `grok_secrets_scan`'s placement.
- After foreman-discover converges, the same gate is RE-RUN on the implementation
  sub-specs; now `determined` → grok is admitted. This is where the cost premise is
  recovered on the implementation slice — but note the gate only *admits* grok; it
  does not *compel* the architect to route there (see C4).

### C2 — `foreman-discover` workflow + agent-def (new, top-model; capability `discover-lane`)

A **bounded, empirical** investigation workflow — an `agents/foreman-discover.md`
def plus the doctrine for driving it. It is a *soft* lane (an agent dispatch), not a
coded lane like `lane-run.sh`; the honest-scope note above spells out which of its
bounds are enforceable. Deliverable is NOT product code — it is resolved facts + a
determined spec.

- New `agents/foreman-discover.md`, top-Claude tier (Fable/Opus) — discovery is
  high-judgment; grok is explicitly NOT eligible for it. Worktree-isolated (like
  foreman-search/plan) but, unlike read-only search, it MAY execute empirical
  probes (Bash/network) against the live system. It never writes product code — this
  bound IS enforceable, via the agent's `tools`/role, not via budget.
- **Budget (advisory).** The def declares a discovery budget (max probe iterations /
  token cap / wall-clock) and instructs the agent to stop and report `partial` on
  exhaustion. This is a *self-report*, not a coded kill: a Claude agent cannot
  hard-enforce its own turn budget the way `lane-run.sh`'s coded timeout/kill can.
  The doctrine states the budget's advisory nature plainly so the operator isn't
  misled into treating it as a guarantee.
- **Convergence exit criterion (checkable).** The unknowns are resolved into
  concrete, testable facts sufficient to write a `determined` implementation spec —
  operationalized as: *the sub-specs it emits must pass the C1 gate*. This is the one
  hard, mechanical guarantee: nothing reaches grok until C1 admits it. Output
  verdict: `converged | partial`.
- Input: a DISCOVERY BRIEF (the unknowns, the live system to probe, the
  convergence goal). Output: the C3 artifact.

### C3 — Captured-facts convergence artifact (capability `captured-facts`)

The bridge that makes the implementation spec write-first/determined. This
**formalizes an existing doctrine** rather than inventing one: `grok-implementer.md:98-104`
already prescribes inline-first / write-first (do exploration architect-side and
inline the facts, or route through `grok-multiround.sh`). C3 gives that doctrine a
named artifact and a provenance discipline — a spec-authoring reference, not net-new
machinery. (grok can only execute a spec whose first action is a Write with facts
inlined.)

- `foreman-discover` emits `captured-facts.md` (in the run dir): the resolved
  interfaces (real API/SDK signatures, sample requests + responses), the observed
  empirical behavior, the constraints discovered, and the provenance (which live
  probe established each fact).
- The architect composes each grok implementation sub-spec by INLINING the
  relevant captured facts into the spec's INTERFACES + CONSTRAINTS sections — so
  the grok spec requires ZERO reads-first and IS write-first. This is the
  mechanism that turns "grok wrote nothing" into "grok writes the determined
  deliverable."

### C4 — Post-discovery re-decomposition (capability `spec-triage`, doctrine only)

The cost-premise-preservation **discipline** — and, honestly, the part foreman
cannot *enforce*. After discovery converges, the architect SHOULD re-run C1's
triage on the implementation, decompose it into grok-executable determined
sub-specs, and OFFLOAD them — rather than implementing directly (which is what
happened on this run: the contract-runner and client-frontier were determinable
post-discovery but the expensive lane built them anyway).

Doctrine: *"discovery converged ⇒ the implementation is now determined ⇒ it routes
to grok, not the architect."* But there is **no coded gate on the architect's own
edits** — you cannot refuse the top model its own write access, so nothing forces
this. C1 *admits* the offloaded sub-spec to grok; it does not *compel* the architect
to produce one. **C4's only signal is the C5 fit-report**: if the architect
self-implements a determinable slice, the post-run split shows a low offload fraction
and flags the poor cost-fit. The discipline is made visible and defaulted-to — not
guaranteed. This is the honest reframe of the first draft's "the C1 gate enforces
admission," which was false.

### C5 — Workload-fit accounting (capability `workload-fit`)

Automate the operator's manual honest verdict.

- **Up-front prediction:** at task start the architect declares a fit estimate
  (`fit: discovery_fraction: high|medium|low`) and foreman WARNS when
  discovery_fraction is high — "poor cost-fit: this workload is mostly empirical
  discovery; the expensive lane will dominate; grok offload will be small." The
  operator decides to proceed knowingly. The declaration is appended to a host-side
  **fit ledger** (`$RD/fit.jsonl`) — see the event-source note below.
- **Post-run split report:** a `foreman-fit-report` that reads the **fit ledger**,
  NOT the event log. This is the load-bearing correction from the audit:
  agent-dispatched lanes (`foreman-discover`, `foreman-search`, `foreman-plan`) emit
  **zero** `el_emit` entries — `el_emit` is only ever called by host-side scripts —
  so a report reading the event log's `lane` field for a discovery label would find
  nothing and mis-report a discovery-heavy run as *good* fit (the inverse of its
  purpose). Instead:
  - The architect (or the host-side wrapper that dispatches discovery) appends
    one `fit.jsonl` record per phase: `{"phase":"discover"|"implement",
    "lane":"...","tokens":N|null,"note":"..."}`. This is a small, explicit ledger
    the architect keeps — the same posture as the manual verdict, just structured.
  - For the offload (implement) side, where the report counts *real* grok/codex
    lane activity from the event log, it matches the actual worker label
    **`worker-grok`** (`worker-run.sh:77`) / `worker-codex`, never the illustrative
    `grok:1`. Test fixtures use these real labels.
  - Output: a discovery-vs-offload split + a `fit_verdict: good | poor` derived
    from the split (poor when discovery dominates and offload is small). Turns the
    manual post-mortem ("foreman is a poor fit for empirical spelunking") into a
    first-class, automatic, per-run signal.

## How it uses / changes existing pieces

- **Extends the routing table** (`SKILL.md:95-105`) with an EXPLORATORY row →
  foreman-discover, and the deciding rule to distinguish "judgment the spec can't
  capture *yet* (discover it)" from "judgment that's irreducible (keep with
  architect)."
- **New lane** `foreman-discover` alongside foreman-search (read-only recon) /
  foreman-plan (codebase planning) — discovery is the missing *live-system,
  empirical, spec-producing* lane.
- **Reuses** the write-first doctrine (C3), the refuse-at-the-door pattern (C1,
  like grok-secrets / readiness gates), the event log (C5), and the worktree/report
  isolation (C2).
- **Does NOT change** grok-multiround / the empty-burst detector (they remain the
  safety net for a spec that slips through mis-classified as determined).

## Risks / open questions

- **C4 is unenforceable by construction** — the deepest honest limit. foreman
  cannot stop the architect from self-implementing a determinable slice; there is no
  coded gate on the top model's own edits. The lever is *measurement* (C5 flags the
  low-offload run) and *doctrine* (C4), not a guarantee. Anyone expecting a hard
  "offload or refuse" will be disappointed — and correctly so.
- **Triage false-positives** (a determined spec wrongly refused): the narrowed C1
  scan (anchored phrases, empty/prose-only verification refusal) is designed to avoid
  refusing foreman's own documented verifications (`cargo build`, `python -m http.server`)
  and the legitimate "discover the dirty file set" EARS example. The explicit
  `determinability: determined` declaration is the architect's override.
- **Triage false-negatives** (an exploratory spec mis-declared `determined`): the
  empty-burst detector remains the backstop; the gate's under-determination scan is
  best-effort heuristic + the explicit declaration.
- **Fit ledger is only as honest as the architect** — C5's discovery side is a
  self-kept ledger, not an automatic meter (agent lanes can't emit events). A lazy or
  dishonest ledger yields a meaningless split. This is accepted: the whole feature
  automates an *honesty* discipline the operator already practiced manually; it
  structures and defaults it, it does not police it.
- **Discovery that never converges** (genuinely open-ended research): the budget +
  `partial` verdict bound it; foreman surfaces "did not converge" honestly rather
  than looping — and the fit report shows it as all-discovery (poor fit).
- **The cost premise still doesn't pay on ~all-discovery tasks** — and that's
  correct/honest: C5 says so up front. The win is on HYBRID tasks (most real work),
  where the determinable slices now offload instead of the expensive lane doing
  everything.
- **Who runs discovery probes against a live/prod system** — the discovery lane
  inherits the same auth/secrets/safety gates as any lane; probing a live system is
  the operator's authorization (like any Use-stage action).
- **Release packaging** — a major enhancement; the 4 OpenSpec/EARS packages
  (spec-triage-gate, foreman-discover-lane, captured-facts-convergence,
  workload-fit-accounting) ARE this planning artifact, authored now under
  `openspec/changes/` and archived on ship (the v0.2.9 pattern). Version TBD
  (orthogonal to v0.3.0 session transport).

## Acceptance

An exploratory task (spec can't be finished) is REFUSED at the grok door — at all
three grok entry points — and routed to a bounded `foreman-discover` workflow;
discovery probes the live system, converges (or reports `partial` within its
advisory budget), and emits `captured-facts.md` + determined implementation
sub-specs; those sub-specs pass the re-run C1 triage as `determined` so grok is
**admitted** to implement them (write-first, facts inlined) — grok now *can* write
them; and foreman reports a workload-fit prediction up front + an actual
discovery-vs-offload split (from the fit ledger + real `worker-grok` events) after,
with a `good | poor` verdict. On the ZK-SDK-style workload, the discovery is still
the expensive lane (correct), and the contract-runner/client-frontier-style
implementation slices are now *offloadable* to grok — whether the architect takes
that offload is a discipline (C4) that C5 measures, not a guarantee foreman enforces.
The honest headline: foreman no longer hands grok under-determined junk (C1, coded)
and it tells the operator, up front and after, when a run is a poor cost-fit (C5,
measured). Packaged as OpenSpec and EARS, gated, released.
