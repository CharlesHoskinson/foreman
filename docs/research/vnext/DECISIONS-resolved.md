# v0.2.9 Total GeorgeCall — open decisions, resolved

Every blocking decision and ambiguity, resolved with its evidence, so
implementation can start without waiting on a conversation.

**Standing:** each of these is evidence-derived, not invented. Where the
answer required intent rather than evidence, that is said so explicitly and the
question is left open. The `readme-refresh` package bars *model-generated*
answers to the four README ambiguities; what follows are answers read out of
the diagram, the code and the release history, offered for ratification rather
than substituted for judgement.

---

## D1 — Exec-bit scope: **41 files**, not 34, 33 or 3

Three documents disagreed: `LANDING-ORDER.md` said 34 scripts plus
`nats/setup.sh`, `ROADMAP.md` said 33, and the package itself scoped 3
extensionless SDD scripts. **All three were wrong.**

Derived mechanically from the index — every Foreman-owned script that is
directly executed and is currently `100644`:

| Set | Count |
|---|---|
| `skills/foreman/scripts/**/*.sh` (includes `nats/setup.sh`) | 34 |
| Extensionless SDD scripts under `skills/superpowers/.../scripts/` | 3 |
| `skills/superpowers/hooks/*` | 4 |
| **Total `100644` and directly executed** | **41** |

**Decision:** `crlf-extensionless-hardening` scopes the **inventory, not a
number**. Its requirement and Task 3 take the set from a mechanical sweep —
tracked, directly-executed, Foreman-owned — and the regression test asserts
that inventory rather than a literal count. A hardcoded number is what produced
three contradictory documents; a derived one cannot drift.

This closes final-audit blocker **C1** (codex) and **C1** (opus).

---

## D2 — The four README ambiguities

### A1 — "Four roles, four producers" (`README.md:50-51`)

**Answer: four roles, four producers, and they are different sets.**
From the diagram at `:53-70`: the **roles** are architect, implementer, auditor,
advisor. The **producers** are the four lane boxes — `grok-implementer`,
`codex-implementer`, `codex-auditor`, `foreman-advisor`. The architect is a
role but not one of the four producers; the two implementer lanes are **two
producers sharing one role**.

The sentence is true but reads as a coincidence when it is a near-collision.
**v0.2.9 breaks it anyway** — the `agy` lane makes five producers against four
roles — so the rewrite should state the two sets separately and stop counting
them together.

### A2 — `v0.2.5` at `:266-270` — **stale, not deliberate**

The passage calls launcher-only "the planned default" and says hard mode
"**would** work out of the box on top of what v0.2.5 already shipped."
`ROADMAP.md:108` records **hard-mode-launcher shipped in v0.2.8**. This is
v0.2.7.5-era text describing as planned something that has since shipped.

**Decision:** stale. The section moves to past tense and cites v0.2.8. The
version reference itself then leaves, per `readme-refresh` requirement 10 —
version stamps belong in `ROADMAP.md`.

### A3 — `CMD` and `GATE` (`README.md:311-315`)

**Answer, from `lane-run.sh:147`:**
`lane-run.sh --round GATE_CMD REPORT_PATH RUN_ID LANE WORKTREE -- CMD...`

- **`CMD`** is the worker command — the vendor CLI invocation that types code.
- **`GATE`** is `GATE_CMD`, the gate command the daemon runs after the worker,
  which produces the round verdict.

The chain `foreman-launch(--detach) → lane-run.sh → foreman-launch(CMD) →
foreman-launch(GATE)` means the launcher supervises the worker, then supervises
the gate, both as separate spawns. The rewrite should say that in words rather
than assume the reader decodes the argument names.

### A4 — "host identity" (`README.md:293`)

**Answer: the config directory, i.e. `$HOME`** — not the machine and not the
OS user.

The constraint is stated in its own sentence: concurrent instances race on
`.claude.json`, and the rule is "not several sharing a config dir". Two
sessions on one machine under different `$HOME`s are fine; two sharing one
`$HOME` are not.

**Decision:** replace "per host identity" with "per Claude Code config
directory (`$HOME`)". The term "host identity" is doing no work and misleads
toward machine-level isolation.

---

## D3 — `bin/lane.sh`: **keep, under a package**

Product code a lane created outside any package's declared scope. It implements
the artifact-assertion doctrine — runs a round and asserts a fresh artifact
before calling it done — which is exactly what `evidence-contracts` specifies.

**Decision:** keep it, but it lands **through `evidence-contracts`**, not as
planning debris. That package owns `lib/evidence.sh` and the bounded evidence
loop; `bin/lane.sh` is an early implementation of the same idea and should be
reconciled with the specified helper rather than living beside it. Until then
it stays uncommitted — committing product code that contradicts a spec written
the same day is how the doctrine/reality drift this release documents gets
created.

---

## D4 — OpenSpec conformance debt: **amend the README, do not migrate**

Eight pre-existing packages fail `openspec validate --strict` because they use
`## ADDED Requirement: <title>` where the CLI parses
`## ADDED Requirements` → `### Requirement:`.

**Decision:** correct `openspec/README.md` rather than migrate the eight.

The eight are v0.2.9-adjacent work not in this release's scope, and a
mechanical header transform across them is churn that touches files four
in-flight packages already claim. The README currently asserts a conformance
the repo does not have, which is precisely the defect `doctrine-reality-drift`
exists to catch — so the honest fix is to state the actual convention and note
that packages authored from v0.2.9 onward validate.

`lock-primitive-hardening` T8 keeps the migration as a **future option** with
this decision recorded, rather than an open question.

---

## D5 — S0 archives

`test-harness-fork-tax` and `el-emit-spawn-reduction` both merged in v0.2.0 and
are visible in the code; `test-harness-fork-tax` additionally collides with
`test-infrastructure-hardening` on the `test-harness` capability.

**Decision:** archive both, as `hard-mode-launcher` was — moved, not deleted,
because they are the specification record for shipped work.

---

## What is NOT resolved here, and needs you

- **Whether to keep auditing or start implementing.** The finding rate is
  relocating rather than converging (102 → 37 findings, structural share up
  75.5% → 78%, 11 of 12 closure claims carrying a new defect in the same
  package). My read is that another audit round produces another fix round
  that introduces its own defects, and that the two packages with
  live-reproduced root causes — the lock primitive and the exec-bit fix —
  should be implemented so working code adjudicates the specs. That is a
  judgement about risk appetite, not a fact.
- **The remaining S2/S4/S5/S9 blockers** from `FINAL-opus.md`: the 382-row
  control inventory, the S4 ordering impossibility, `doctrine-reality-drift`
  failing every later gate, and `GraphUpdate` — an artifact no package
  produces — carrying a load-bearing requirement in `graph-store-port`.
