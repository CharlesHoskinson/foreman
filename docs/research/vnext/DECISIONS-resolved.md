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

### D1 amendment — 2026-07-29, after two independent audits

**The 41 was also wrong.** It was a fourth count, arrived at by enumerating
three directories, and two audit rounds falsified it:

- GPT-5.6 Sol (round 1) — the SDD family was a hardcoded three-path list, so a
  new SDD script escaped and the test passed.
- Claude Opus (round 2) — the fix did not generalise. `skills/foreman/scripts/`
  was still swept with a `*.sh` filter, so an extensionless script there
  escaped, proven with a controlled pair whose only variable was the directory.
  Opus additionally found a **fourth region reached by no pathspec at all**:
  `install.sh` is tracked, bash-shebang, Foreman-owned, mode `100644`, and
  `README.md:355` tells users to run `./install.sh` — which fails
  `Permission denied` on a fresh clone. It satisfies every predicate in the
  spec's own definition of the measured set.

**Root cause of all three misses: the set was derived by DIRECTORY.** Any
directory list is an enumeration wearing a sweep's clothing, and a hardcoded
count is what the decision was supposed to eliminate.

**Amended decision: derive by PROPERTY.** The inventory is every tracked file
under the Foreman-owned executable trees whose **index blob** begins with a
bash shebang, plus `skills/superpowers/hooks/*` as a deliberate directory
sweep (it bundles non-bash members — `run-hook.cmd` is a polyglot, and the
hook installers package the whole directory). Reading the index blob rather
than the worktree is what lets the regression test run against a synthetic
`GIT_INDEX_FILE`.

Two things this settles that a directory sweep could not:

- `skills/foreman/scripts/adapters/verdict.schema.json` is excluded naturally
  — it has no shebang. Simply dropping the `*.sh` filter would have pulled it
  in and demanded `100755` of a JSON data file.
- `install.sh`, `env/bootstrap-wsl.sh`, `env/tool-check.sh` and
  `env/wsl-clock-preflight.sh` are now covered. Only `install.sh` is invoked by
  direct exec; the three `env` scripts are invoked as `bash env/…`. **All four
  get the exec bit anyway.** An exec bit on a bash-invoked shebang script is
  harmless; hand-carving an exception back into the derivation is the exact
  defect this decision exists to remove, and it would have to be re-litigated
  every time a caller changes how it invokes a script.

**The count at this commit is 45. The count is not the specification** — the
derivation is. Any future document quoting a number instead of the derivation
is repeating the mistake for a fifth time.


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

---

## D5 — The Git-Bash half of the S1 gate is deferred, not satisfied

**Decided 2026-07-29 by the product owner.**

`lock-primitive-hardening` T7 required the full suite green on Git-Bash *with
the mkdir fallback actually taken*, and stated that "a run in which every
acquisition refused does not satisfy this line." That is unsatisfiable in the
current environment.

**Why.** Taking the fallback requires a trusted `pinned-mechanism` verdict,
which requires the resolved `mkdir.exe` SHA-256 to match a register entry
citing a **committed syscall trace captured on a Foreman-controlled
MSYS2/Git-Bash host**. No such host is available. The L2 implementer was
offered the option to seed the register anyway and correctly refused, recording
in `env/reference-manifest.toml`: *"no Foreman-controlled MSYS2/Git-Bash host
was available to capture a real syscall trace. Do not invent a digest."*

**What was considered and rejected.** Seeding a plausible digest would make the
gate pass and the release ship with a trust anchor nobody traced — the precise
failure this package exists to prevent, committed by the package itself. A
version-string match is explicitly not a digest match, and the spec says so.

**Decision.** Split the requirement into the part that is testable without the
host and the part that is not:

- **Kept and required:** the fallback *code path* is proven reachable against a
  structurally valid entry in a temporary manifest; the refusal path on an
  unpinned host is exercised and names the route back to availability; the real
  register ships empty with its reason.
- **Deferred:** the on-host Git-Bash green run with a real pin.

**What this costs, stated plainly.** Durable lanes on MSYS2/Git-Bash are
**unavailable** in v0.2.9 — not degraded, unavailable — until someone commits a
real pin from a traced host. Lanes taking no foreman lock are unaffected. The
fallback's only reason to exist is that host, so this release ships a mechanism
that is correct-by-construction and unexercised on the platform it was built
for. That is a real gap and it belongs in the roadmap's honest residuals, not
in a footnote.

**What would close it.** One trace on any Foreman-controlled Git-Bash host,
committed as an artifact, with its digest and covered filesystem classes
recorded in the register. The procedure is documented; the blocker is access,
not design.

---

## D6 — S4's impossible order, resolved by splitting rather than reordering

**Closes FINAL-opus F4.**

`decision-lineage-and-telemetry` sits at position 1 of S4 and states in bold
*"Do not start before `three-outcome-verdicts` has merged"*, which is position
2. The stated order cannot be executed.

**Root cause:** the dependency is real but applies to only half the package.
Verdict lineage genuinely needs the three-outcome vocabulary to exist. Token
counts, cost, model identity, and the plain fact that `gate-eval.sh` and
`audit-run.sh` call `el_emit` at all need nothing from it.

**Ruling — split the package:**

- **4a `decision-lineage-emission`** — `el_emit` from `gate-eval.sh` and
  `audit-run.sh`; per-lane tokens, cost, wall-clock, model identity and vendor.
  **No dependency.** Starts immediately.
- **4b `decision-lineage-verdicts`** — verdict lineage bound to the diff content
  hash, consuming the three-outcome vocabulary. Follows `three-outcome-verdicts`.

This is a smaller change than reordering the stage and it unblocks the half we
most need. Today's session produced roughly fifteen lane dispatches, ten audit
verdicts and ten hours of wall clock, and **not one byte of it is in
`events.jsonl`** — so every question about whether the audit rounds were worth
their cost can currently be answered only in prose. 4a fixes exactly that.

## D7 — Every new gate lands in shadow mode first

**Closes FINAL-opus F1, and is the mechanism for D9.**

`doctrine-reality-drift` as specified fails the merge gate closed for every
stage after it. The general problem: this release adds several gates, and a
gate that is wrong is worse than a gate that is absent, because it blocks
correct work while looking principled.

**Ruling.** Every gate, probe and blocking check introduced by v0.2.9 SHALL
land in **shadow mode**: it computes its verdict, records it via `el_emit`, and
reports it — but it does **not** block. It is promoted to gating only after it
has produced a verdict on **at least ten of Foreman's own runs** with no false
positive, and the promotion is recorded with the run identifiers that justified
it.

This is not a weakening. A gate promoted on measured field evidence is stronger
than one switched on at merge because its author believed it. It also makes
`doctrine-reality-drift` landable immediately rather than blocking S5 onward.

**Precedent from today:** the lane reaper's first two predicates each produced a
false positive on their first real run — once against a live interactive
session, once against a healthy lane blocked on a model response. Both would
have killed correct work had they shipped gating. Both were caught by running
them in report-only mode. This ruling generalises that accident into policy.

## D8 — `lib/evidence.sh` is owned by `evidence-contracts`

**Closes FINAL-opus F6.**

`three-outcome-verdicts` (S4) and `evidence-contracts` (S6) both claim
`skills/foreman/scripts/lib/evidence.sh` and both encode the function
identically. A pure ownership ruling was required.

**Ruling: `evidence-contracts` owns and creates the file.**
`three-outcome-verdicts` consumes it and SHALL NOT define it. Two reasons:
the file is the subject matter of `evidence-contracts` rather than an
incidental dependency, and under the contention-derived schedule (D9)
`evidence-contracts` lands in wave 1 while `three-outcome-verdicts` lands in
wave 6, so the owner lands first in execution order as well as in principle.

## D9 — Dogfood every enhancement in the session that produces it

**The rule: nothing waits for the tag.**

Foreman's enhancements are for orchestrating exactly the work that builds
Foreman. Holding them until release means the release is built without them,
which is how this session went — the strandings, the undetected suspension, the
unattributable foreign watchdog, and the checker that reported a pass it had
not earned are all failures the release's own packages exist to prevent, and
all of them happened because those packages were unbuilt.

**Ruling.** Every enhancement SHALL be put into use in Foreman's own workflow
in the same session it becomes runnable, under D7 shadow mode, and the evidence
from those runs is what promotes it. Concretely, for the packages now in flight:

| Package | How it is used the day it lands |
|---|---|
| `decision-lineage-emission` (4a) | every audit and implement lane this project dispatches is recorded — tokens, cost, model, wall clock. First real dataset on what a round costs. |
| `evidence-contracts` | lane success is decided by a content hash over a declared deliverable set instead of the architect eyeballing `git status`. |
| `round-ownership-default` | dispatch stops relying on a prompt telling a lane not to background itself; today that prohibition was stated verbatim and violated twice. |
| `lane-ownership-and-reaping` | already in use — `tools/lanectl.sh` and `tools/reap-stale-lanes.sh` were written and used the same day. |
| `vendor-preflight` | run before every dispatch, so a false `not_authenticated` cannot gate a round again. |
| `test-infrastructure-hardening` | the tiered suite becomes the pre-merge check for every remaining package. |

**Proof this works, from today:** `AGENT_TRAPS.md` was written mid-session and
handed to every subsequent lane; `lanectl.sh` and `reap-stale-lanes.sh` were
written and immediately used to diagnose a `SIGTTIN`-suspended lane that a
`pgrep` watchdog had reported as alive. Same-session use is also what exposed
both reaper false positives. Deferred tooling would have caught none of it.

**The one constraint.** Dogfooding unreleased gates in the harness that builds
them is a bootstrap risk: a buggy gate could block correct work. D7 shadow mode
is precisely the mitigation, and no enhancement may be dogfooded in blocking
mode before it earns promotion.

## D10 — The remaining work is scheduled by contention, not by stage number

`docs/research/vnext/parallel-schedule.py` derives the conflict graph from the
same claim-extraction rules as `contention-derive.py` (two packages conflict iff
they claim a common file, because LANDING-ORDER requires same-file claimants to
land serially) and greedily colours it into waves of pairwise-disjoint write
sets.

**Result: 25 remaining packages collapse from 11 sequential stages into 8
waves, with a widest wave of 10.**

**What actually bounds throughput** — and it is not the graph:

- `lane-run.sh` is claimed by 8 packages, `config/foreman.toml.example` by 7,
  `env/tool-check.sh` by 6. Those three files serialise most of S3, S4 and S5
  no matter how the schedule is drawn.
- Vendor concurrency caps are grok 3, codex 2, claude 3, so a wave wider than
  about five implement lanes cannot all run regardless of file disjointness.
- **The real limit is round depth, not width.** S1 took roughly eleven rounds
  across four packages because each audit must follow its fix and each fix
  round has historically introduced a new defect. Parallelism cannot compress a
  serial audit-rework cycle; only better specification up front can.

**Therefore the schedule is advisory on ordering and binding on nothing.** Wave
membership says what MAY run together, not what MUST. Logical dependencies
still apply on top of it — D6's 4a should run in wave 1 despite the contention
graph placing `decision-lineage-and-telemetry` in wave 3, because the split
removes the dependency that put it there.

---

## D11 — The exec-bit exclusion list, and why it is by pattern

**Decided 2026-07-29, after round 5 of `crlf-extensionless-hardening`.**

D1's amendment ruled that the inventory is derived by **property** rather than
by directory, because any inclusion list can be relocated out of — which it
was, five times. Round 5 implemented a whole-repository sweep over the index
blob shebang and the result is an inventory of **84**: 43 already `100755`, and
**41 tracked files at `100644`** that the sweep newly covers.

Round 5 correctly **reported** those 41 rather than chmod-ing them, because
modes are an architect decision. This is that decision.

**"chmod all 41" is wrong.** Verified invocation evidence:

- `sandbox/entrypoint.sh`, `sandbox/init-firewall.sh` — `sandbox/Dockerfile`
  does `COPY` followed by `RUN chmod 0755`. Container-side direct exec is
  satisfied at image build, not by the index. An independent audit reached the
  same conclusion.
- `skills/superpowers/tests/**` (30 files) — test scripts invoked by their own
  runners as `bash …` / `sh …`.
- `skills/superpowers/scripts/lint-shell.sh` — documented as
  `bash scripts/lint-shell.sh`.
- `skills/superpowers/skills/brainstorming/scripts/{start,stop}-server.sh` —
  documented as `sh skills/brainstorming/scripts/start-server.sh`.
- `tests/helpers.bash` — **sourced**, never executed.
- `tests/run.sh` — the suite runner, invoked as `bash tests/run.sh`.

And one genuine inclusion the sweep earned:

- `skills/superpowers/skills/systematic-debugging/find-polluter.sh` — invoked
  as `./find-polluter.sh` in `root-cause-tracing.md:104` **and in its own usage
  string**. Direct exec, mode `100644`. Broken today, exactly like `install.sh`
  was.

**Ruling — the exclusion list is BY PATTERN, with a stated reason per entry,
never by filename.** A filename list is an enumeration, and enumerations are
what this package has spent five rounds failing to escape. Excluding a pattern
means a new file added under it inherits a decision someone already justified;
excluding a filename means the next file gets no decision at all.

The exclusions, each carrying its reason in the code:

| Pattern | Reason |
|---|---|
| `sandbox/**` | modes set by `Dockerfile` `RUN chmod 0755` at image build |
| `skills/superpowers/tests/**` | test scripts invoked via `bash`/`sh` by their runners |
| `skills/superpowers/scripts/**` | documented `bash scripts/<name>` invocations |
| `skills/superpowers/skills/*/scripts/**` | documented `sh skills/…/<name>` invocations |
| `*.bash` | sourced helpers, never executed |
| `tests/run.sh` | the suite runner, invoked as `bash tests/run.sh` |

Everything the sweep covers and the exclusions do not remove **gets the exec
bit**. The implementer derives that residue mechanically and reports it; it is
not enumerated here, for the same reason the inventory is not.

**The standing rule this establishes:** adding a pattern to the exclusion list
requires writing down why, in the file, at the point of exclusion. An exclusion
without a reason is indistinguishable from an oversight, and it is how the
inclusion lists rotted. A reviewer must be able to falsify each entry by
checking the invocation it claims.

**Honest residual.** The exclusions are justified by how these scripts are
invoked *today*, read out of documentation and call sites. If a caller changes
from `bash x` to `./x`, the exclusion silently becomes wrong and nothing
detects it. The durable fix is to derive direct-exec targets from call sites
rather than from documentation — noted in `wsl-seam-doctrine` as the checker
that would close it. Until then this is a documented approximation, not a
proof, and it is recorded as such rather than presented as settled.

---

## D12 — Premises cite behaviour and carry their check command; never a line number or an unverified count

**Decided 2026-07-29, after auditing every premise stop-condition in the
release against the work already committed.**

Five packages open with a "re-confirm the premises, and **stop** if any fails"
task. That discipline is right — it prevents building on a false assumption —
but the premises themselves were written in two forms that rot.

**Form 1: pinned to line numbers.** `three-outcome-verdicts` says
*"`gate-eval.sh:43-47` performs no freshness check"*. After
`decision-lineage-emission` added `el_emit` to that file, lines 43-47 are the
**hash-drift check**. The semantic claim is still true; the coordinates are
not. A lane sent to verify a claim at those lines finds unrelated code.
`round-ownership-default` cites `lane-run.sh:1143-1245` for a completion
predicate; that region is now a payload comment block.

**Form 2: an unverified count.** `round-ownership-default` says
`DURABLE_ENABLED` has *"exactly two occurrences, both in `lib/config.sh`
(`:66`, `:148`)"*. Measured: **one** occurrence, at `:66`. And at the original
planning base `65728f7`, also **one**. **The premise was false when written** —
nobody ran the grep. A lane would have correctly stopped, having spent a round
to discover something a single command answers.

This is the same defect the release already documents twice over: three
documents carrying three different counts for the exec-bit fix, all three
wrong; and an inventory asserting 41 files while structurally unable to see the
42nd. **A number in a specification is a claim, and an unrun claim is a guess.**

**Ruling.** Every premise SHALL:

1. **State a behaviour, not a location.** "`gate-eval.sh` performs no freshness
   check on the verdict artifact" is checkable forever. "`gate-eval.sh:43-47`
   performs no freshness check" expires on the next edit to that file.
2. **Carry the command that verifies it**, inline, so re-confirmation is
   mechanical and its result is reproducible by the next reader.
3. **Never assert a count that has not been run** at the commit the premise is
   written against. If a count is load-bearing, the command producing it is
   part of the premise.

**Consequence for the two affected packages.** Their premises are amended in
place rather than left to fail a lane: the line citations are replaced with
behavioural statements plus check commands, and the `DURABLE_ENABLED` premise
is corrected from two occurrences to one, with the grep that establishes it.
The stop-conditions themselves are kept — they are the part that works.

**Consequence for dogfooding (D9).** Shipping an enhancement invalidates the
stated premises of packages downstream of it. `release-metrics` T1 told its
implementer to confirm that `gate-eval.sh` and `audit-run.sh` contain **zero**
`el_emit` calls and to stop if not — a premise that `decision-lineage-emission`
inverted **by design**, four hours after it was written. That package was
re-baselined before dispatch rather than being allowed to stop.

**Therefore: re-baseline the premises of every package downstream of a
just-shipped enhancement, before dispatching it.** Under D9 the codebase moves
while the plan is being executed, so a premise written against the planning
snapshot is a claim about a repository that no longer exists. This is the
standing cost of dogfooding, and it is cheaper than the alternative — but it
has to be paid deliberately, at dispatch time, by the architect.
