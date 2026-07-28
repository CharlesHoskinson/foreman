# PKG — workflow improvement packages for v0.2.9

Four OpenSpec change packages covering the orchestration loop's own
reliability, authored from `bugeventlog.md` (33 entries, 882 lines) and the
vnext research lane. All four pass `openspec validate --strict`; they are the
second through fifth packages in the repository to do so.

Domain boundary: these packages own the **loop**. They do not own the lock
primitive, the test harness, the WSL seam, the vendor argv contract, or the
graph plane — each of which has its own package. Where a dependency exists it is
stated under Impact rather than re-specified.

---

## 1. `round-ownership-default`

**Capability:** `round-ownership`

Turns the durable round loop on by default and closes the release's dominant
failure class.

**The finding that shaped it.** `.foreman/config.toml:29` has
`durable.enabled = false`, but the flag is also **inert**: `DURABLE_ENABLED`
occurs exactly twice in the codebase, both inside `lib/config.sh` (`:66`, `:148`),
and no script reads it. `references/durable-lanes.md:71` records its consumer
honestly as `(documented gate; soft-mode routing)` while every sibling key names
a script. So flipping the default alone is a null change — the condition at
`SKILL.md:174` is evaluated by a reader of prose, and the failure class exists
precisely because models do not reliably do what prose says.

**What it specifies.** `durable.enabled` gains a consumer at the dispatch
boundary and defaults to true; an unowned dispatch is refused rather than
silently downgraded; round mode requires an explicit gate command with no
default (a `true` gate would manufacture the false completion signal the
machinery exists to prevent); completion is defined by artifacts at every layer;
and the escape hatch for stateful/live targets is explicit and emits an `alert`
carrying its reason.

**Migration.** Setup reports an explicit `enabled = false` as divergence from
the new default and never rewrites the user's config; `resume_max_attempts`
becomes explicit because bounded auto-resume becomes reachable; hosts without
`launcher/dist` get degraded-but-owned rounds with the existing
`alert{kind:"degraded"}`.

**Ordering.** Lands **after `lock-primitive-hardening`** — universal durable
dispatch multiplies `el_emit` contention on a mutex measured non-atomic on the
reference host.

**bugeventlog entries closed:** the background-and-stop attractor in full —
`:284-322` (occurrences 1-4), `:395-408` (#5), `:409-416` (#6), `:466-476` (#7),
`:497-506` (#8), `:507-524` (the ~1h audit-orphan release-gate loss),
`:557-560` (#9-11), `:648-676` (the occurrence that landed on the lane
implementing its own fix), `:730-742` (P1/P4 with the `gate.lock` leak), and
2026-07-28 (two lanes, ~50 min, zero reports, exit 0 on a red build).
Partially addresses `:150-166` and `:180-217` (orphan reaping) by removing the
unowned-wrapper case that produces them.

---

## 2. `three-outcome-verdicts`

**Capability:** `audit-verdict`

`APPROVED / WARNING / BLOCKED / UNVERIFIED`, so an auditor that errored, timed
out, or returned unparsable output can never be recorded as a clean verdict in
either direction.

**The finding that shaped it.** When the auditor fails, `audit-run.sh` `die`s on
one of five paths (`:92`, `:94`, `:95`, `:104`, `:108`) **without writing
`audit-verdict.json`**. `$RD` is stable across rounds and nothing removes the
prior file, so a failed re-audit leaves the previous round's verdict in the
gate's input directory — and `gate-eval.sh:43-47` reads it with **no freshness
check of any kind**. A stale `APPROVED` of an old diff is indistinguishable at
the gate from a fresh one. This is the same defect `lane-run.sh --round` already
fixed one layer down with its attempt-freshness predicate (SC-D); the merge gate
has no equivalent.

**What it specifies.** `UNVERIFIED` assigned by the harness, never offered to
the model (the model-facing schema stays three-valued, deliberately, and both
files say why); an artifact written on every path, atomically; mandatory
provenance including the vendor and model that *actually ran*; evidence binding
at the gate on the **diff content hash, not the head sha**, so a rebase with no
content change does not invalidate a 27-minute audit; `UNVERIFIED` failing
closed with a distinct reason and **not consuming a rework round**, because the
worker did nothing wrong; `[audit.policy]` finally read by `gate-eval.sh`; and
findings addressed by stable id with consolidation forbidden from rewriting
evidence text (R2 P5).

**Audit latency — scoped, and the deferral stated.** In scope: a wall-clock
bound on the audit call (there is none today — a hung audit hangs the gate
forever) and a recorded `duration_s`, which turns the 24-27 minute figure from
two hand-timed anecdotes into a distribution. **Explicitly deferred to v0.4.0
and not specified here:** effort tiering, sharded parallel audit, pre-packaged
audit bundles, hunk-scoped re-audits, session reuse.

**bugeventlog entries closed:** `:44-59` (chronic 24-27 min audit latency —
bounded and measured, not solved); `:91-105` (the WARNING-versus-"when approved"
gate-semantics round-trip, closed by making `[audit.policy]` executable);
2026-07-19 codex `--device-auth` (the unrecorded fallback to an in-session
auditor becomes visible provenance); 2026-07-19 grok `--prompt-file` (a vendor
CLI exiting 0 having produced nothing is now representable).

---

## 3. `decision-lineage-and-telemetry`

**Capabilities:** `decision-lineage`, `run-telemetry`

Audit and gate decisions enter the event log; tokens, cost, model identity and
phase timing become recordable; a per-run `metrics.json` rollup is derived from
the log.

**The finding that shaped it.** `grep -c el_emit` returns **0** for both
`audit-run.sh` and `gate-eval.sh`; neither sources `lib/eventlog.sh`. The
complete 11-type event vocabulary records how lanes *ran* and nothing about what
was *decided*. `audit-run.sh:114` logs the reviewing model to stderr — the only
place in the system that identity appears. Separately, no orchestration code
anywhere records tokens or cost.

**Additivity confirmed before relying on it** (per R5 §1-§2): `el_emit` treats
`type` opaquely (`lib/eventlog.sh:26-35`, and `alert`/`state` joined the
vocabulary with no code change); `payload` is arbitrary validated JSON;
`is_collapsible` matches `heartbeat` only (`:374`), so decision events are
structural and never rolled up. The change adds four event types and one payload
key and **touches no library code** — verifying that claim is task T1, and if it
fails the change is re-scoped rather than forced.

**What it specifies.** `audit_verdict`, `finding` (one per finding, with
`upheld` filled later by a *new* event, never a rewrite), `gate_decision`
(carrying the `REASONS[]` array the gate already builds), and `usage`. A
mandatory `source ∈ {vendor_reported, estimated, unavailable}` — an unmeasured
cost is recorded as unmeasured and **never as zero**, and every cost aggregate
publishes its unavailable share. `metrics.json` **derived by replaying the log,
never accumulated in memory**, so a crashed run still rolls up correctly and the
figures are reproducible. Every metric ships with the companion number that
detects its misreading (R6's rule). Payloads carry references and hashes, never
prompt or diff text.

**Dependency to state elsewhere:** this is the **prerequisite for the graph
plane**. Without it the graph would project a work-DAG with no verdicts in it.

**bugeventlog entries closed:** `:438-451` (audit trail no longer independently
reconstructable after `wt-cleanup` lost V2-V4 reports — decisions now live in
the append-only log, not in worktree files); `:677-706` and `:707-729` (the
force-merge and the push on a misread exit code — the gate's reasons and inputs
become part of the permanent record rather than console scrollback);
`:114-148` (dispatch-to-first-write latency per lane, the metric that entry
asks for). Makes the release's own success criteria computable at all.

---

## 4. `doctrine-reality-drift`

**Capability:** `doctrine-integrity`

A deterministic check that catches documentation claiming something the code
contradicts.

**The finding that shaped it.** R5 §8.2 tabulates **eleven** live
contradictions found in one reading — the caps mismatch (`ROADMAP.md:44-47`
says `grok=1 codex=1`; `lane-queue.sh:422` ships `grok:3 codex:2`) **misled a
reader today**; `[audit.policy]` documented as gate policy that the gate never
reads; durable lanes documented as the normal path while disabled and inert;
`audit.vendor` documented as configurable while hard-refused;
`claude` documented as a worker lane with no argv branch; "CI remains final
authority" over a suite that runs on no CI; `openspec/README.md` claiming
conventions all sixteen prior packages fail. `docs-check.sh` today runs
markdownlint, codespell, lychee and comment coverage — all four pass a document
that is beautifully formatted, correctly spelled, fully linked and false.

**What it specifies.** A claim registry (`docs/doctrine-claims.tsv`) binding each
pinned-fact claim to a deterministic probe, with the value observed at
registration recorded so a moved probe target is diagnosable as a stale probe
rather than a false claim. **An empty probe result is a failure, never a pass** —
that is how checks of this shape normally die. The checker reports registered
claim counts and **never a percentage**, because the denominator is unknowable
and a coverage figure would be the same dishonesty one level up. Probes are
proven able to fail by mutation, adopting `test-infrastructure-hardening`'s
regression-injection discipline rather than building a second one. Plus two
adjacent checks on the same mechanism: stale change folders (three exist), and
workaround stamps carrying the model and date they were added for (R2 P21 +
N1 §8.4's silent frontier drift under a fixed alias) — counted first, with no
failure threshold set before the count is measured.

**Scope honesty.** The checker verifies pinned facts, not prose, and says so in
the same paragraph as its own name. It fixes the checker, not most of the
claims — each false claim is routed to the package owning the code it describes.

**bugeventlog entries closed:** `:479-496` (the architect violating its own
serialised-gates doctrine written earlier the same session — doctrine that is a
sentence rather than a mechanism); `:323-341` (a `bash -n`-only edit carried
across a session boundary as "done pending tests"); and R5 taxonomy class #9
(doctrine/scope mismatches) as a class.

---

## Cross-package ordering

```text
lock-primitive-hardening
        ├─→ round-ownership-default
        └─→ decision-lineage-and-telemetry
three-outcome-verdicts ──→ decision-lineage-and-telemetry ──→ graph plane
vendor-adapter-contract ──(audit call argv)──→ three-outcome-verdicts
test-infrastructure-hardening ──(precondition helper, injection discipline)──→ all four
doctrine-reality-drift ──(registers the claims every other package closes)
```

`doctrine-reality-drift` lands last in the release and gates on the others'
claims being true.

## What was deliberately not specified

- **Fast audit** — effort tiering, sharding, bundles, hunk-scoped re-audits,
  session reuse. v0.4.0 owns it. Only bounding and measurement are here.
- **The graph plane** — its own package. This lane supplies its prerequisite
  decision events and states the dependency.
- **Watchdog liveness redesign** (failure class #2, six false-signal modes).
  `round-ownership-default` reduces the surface by removing the unowned-wrapper
  case, but the typed-state work belongs with `watch.sh`, not here.
- **Host contention corrupting the gate signal** (failure class #3). The
  quiet-host precondition appears in every package's gate task, but the
  structural fix — a mutex covering bats-versus-heavy-non-bats load — is not
  specified here.
- **The vendor argv contract**, **the lock primitive**, **the test harness**,
  and **the six WSL seam packages**. Referenced, never re-specified.
