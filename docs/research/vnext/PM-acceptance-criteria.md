# PM — v0.2.9 acceptance criteria, anti-criteria, and pre-registered kill criteria

Product-management artifact for Foreman v0.2.9 (`plan/v029-graph-multivendor`,
HEAD `1e21a81`). Written 2026-07-28 against R1–R8, N1–N4 and `F-uutils-mkdir-blocker`
in this directory, plus `SYNTHESIS.md`, `ROADMAP.md` and `bugeventlog.md`.
**Revised the same day** after R8 and `SYNTHESIS.md` landed — see the revision log
at the end. One kill criterion (K-3) reversed on new evidence.

This is not a plan. It is the **definition of done** and the **definition of
"this was worth doing"**. The plan is owned by the architect; the OpenSpec
packages own the tasks. This document owns the gates.

## How to read this

Every criterion carries four things:

| Field | Meaning |
|---|---|
| **Falsifier** | the command, measurement, or inspectable artefact that decides it. If you cannot run it, it is not a criterion. |
| **Evidence** | which lane and which number motivated it. |
| **Owner** | the OpenSpec package that satisfies it. Bare names exist under `openspec/changes/`. `GP-n` names are the graph-plane packages planned in `SYNTHESIS.md` §5 — specced, not yet authored. |
| **Basis** | **measured** (a number in a lane), **published** (a number in a cited external source), or **judgement** (I picked it; the reasoning is stated and the number is arbitrary within a band). |

**Thresholds marked `judgement` are not measurements.** They are pre-registration
devices: their value is that they were fixed before the data arrived, not that
they are correct. Where the honest answer is "we have no baseline", the
criterion is *establish the baseline*, and it says so.

### Two corrections that change how the source material must be cited

Both come from lanes that were asked to fact-check, and both are load-bearing.

1. **`§VIII`, `Table III` and `Table VI` are not Karpathy.** They are in
   `SOURCE-karpathy-graph-engineering.txt`, an independent synthesis whose own
   acknowledgment says it is "not affiliated with or endorsed by Andrej
   Karpathy". R1's central finding is that the synthesis **misdescribes its own
   primary sources**. Use it as a hypothesis generator. Do not cite it as
   evidence, and do not cite it as Karpathy in any shipped Foreman doc.
2. **AgentHub is a 5-column table.** R1 verified: a commit node carries
   `hash`, `parent_hash` (first parent only), `agent_id`, `message` (subject
   line), `created_at`. **There is no metric on the node** and **no foreign key
   from `posts` to `commits`**. The base autoresearch loop is a *linear*
   ratchet — `git reset --hard` destroys discarded lineage — so "the DAG was the
   second system, not the first". `karpathy/agenthub` is now HTTP 404 and
   `autoresearchhub.com` does not resolve; there is **no evidence the swarm ever
   ran at scale**. Foreman is designing forward from a 5-column table, not
   adopting a proven schema. Every v0.2.9 doc that implies otherwise is wrong.

---

# 1. Release-level acceptance criteria

These are the conditions for tagging `v0.2.9`. All are falsifiable by a command
or an artefact in the release commit.

## 1.1 The floor — these are blockers, and none of them is about the graph

| # | Criterion | Falsifier | Evidence | Owner | Basis |
|---|---|---|---|---|---|
| **RA-1** | A fresh clone on a reference WSL box produces an **interpretable** suite result: every non-pass is either a product failure or a skip with a named unmet precondition. Zero bare skips. Zero unexplained failures. | `git clone && env/bootstrap-wsl.sh && tests/run.sh` exits 0; `tests/run.sh --json` shows `unexplained_failures: 0`; every skip line names a precondition; per-file skips ≤ `tests/skip-budget.tsv`. | F-uutils: fresh clone = **373 pass / 9 fail**. `test-infrastructure-hardening` triage: only **2 of 9** were product defects; the other 7 were platform, privilege, load or test-validity problems "wearing the same red `not ok`". | `test-infrastructure-hardening` | measured |
| **RA-2** | The lock primitive provides mutual exclusion **on the resolved `mkdir`/`flock` of the host**, proven by a contention test, not by a comment. | The release-contention test: 15 rounds × 8 racers on `fm_lock_acquire`, on **both** the `flock` path and the forced-`mkdir` fallback path → **0 critical-section violations**. Same test run against uutils `mkdir` directly must still show violations (a positive control that the test can detect the bug). | F-uutils, measured on this box: uutils 0.8.0 `mkdir` = **57 violations / 15 rounds**; GNU 9.7 = **0**. `strace` shows uutils does `statx` then never issues `mkdir(2)` — userspace TOCTOU. Blast radius: `.seq.lock`, `.attempt.lock`, `el_compact`, `wt-new` locks. Caps are grok=3 / codex=2, so contention is the normal mode. | `lock-primitive-hardening` | measured |
| **RA-3** | The bats suite runs on CI, on Linux and on Windows, on the release commit. | A green `ubuntu-latest` job and a green `windows-latest` job on the tagged commit, both running `tests/run.sh` (not only `install.ps1`). | `wsl-ci-parity` proposal: "the bats suite … runs on NO CI platform today". R5 §8.2: `windows-smoke.yml` triggers only on `install.ps1` changes and runs under `pwsh` (PS7), while the v0.2.8.1 field failure was specific to `powershell.exe` 5.1. | `wsl-ci-parity` | measured |
| **RA-4** | No fresh WSL clone runs degraded. | On a fresh clone after Setup, a full round emits **no** `alert{kind:"degraded",reason:"launcher_absent"}`; `env/tool-check.sh` reports the launcher present. | ROADMAP v0.2.9 P1: "every fresh WSL clone silently runs `launcher_absent`/degraded, losing the pidns kill-cascade". Round-ownership — the structural fix for the #1 failure class — depends on it. | `wsl-launcher-shipped` | measured |
| **RA-5** | The exec-bit / line-ending invariant holds repo-wide, not for 3 files. | A permanent test: **every `#!`-led file tracked by git has index mode `100755`**; `git ls-files --eol` shows `lf` for every text file; `git status --porcelain skills/` is empty immediately after `install.sh` on a fresh clone. | R5 §8.1, verified: `git ls-files -s skills/foreman/scripts/` reports `100644` for **all 35 entries**; `install.sh:61-63` chmods the working tree in place, permanently dirtying every installed clone (33 ` M` entries) and **missing `scripts/nats/setup.sh`**. ROADMAP scopes P2 to "3 extensionless SDD scripts" — a strict undercount. | `crlf-extensionless-hardening` + `wsl-seam-doctrine` | measured |

## 1.2 The telemetry precondition — this is the criterion the release turns on

| # | Criterion | Falsifier | Evidence | Owner | Basis |
|---|---|---|---|---|---|
| **RA-6** | Every lane completion and audit completion records **model identity, effort, tokens, and cost**. | `jq -e 'select(.type=="round_done") \| .payload.usage \| has("model") and has("input_tokens") and has("output_tokens") and has("cost_usd") and has("effort") and has("vendor")'` succeeds for every `round_done` in every run dir produced during the release. | R6 §2.4, verified by grep: the emitted event vocabulary is `alert, heartbeat, round_done, state, checkpoint, ownership, merge_base, prompt, resume` and `grep -rn 'token\|cost_usd\|usage' skills/foreman/scripts/` returns "only incidental matches, **no accounting**". R5 §3.2 gaps 1, 2, 9: vendor is inferred from a path string; `WC_*_MODEL` is never logged; cost/tokens/wall-clock per attempt do not exist. | GP-1 `work-plane-telemetry` | measured |
| **RA-7** | Gate-blocking findings are **first-class events**, so M5 (unique-catch rate) is computable. | One `finding` event per gate-blocking finding, `{id, source: checks\|audit\|architect, severity, upheld}`; `gate-eval.sh` and `audit-run.sh` both source `lib/eventlog.sh` and emit; a `metrics.json` rollup per run and a `docs/metrics/v0.2.9.json` committed with the tag. | R5 §3.2 gap 3, verified: `audit-verdict.json` and `gate-decision.json` are written as **files, never events**; neither script contains an `el_emit` call, so "the audit/gate outcome is outside the lineage store". R6 §4.1: M5 "is the metric that decides whether multi-vendor pays for itself… Today Foreman cannot compute it." | GP-1 `work-plane-telemetry` | measured |
| **RA-8** | Foreman's own run-to-run **σ** is measured and published, before any improvement is claimed. | `docs/metrics/v0.2.9.json` contains a per-metric σ from N≥3 repeats on the locked spec set, with a percentile-bootstrap CI. Every comparative claim in `ROADMAP.md` cites it. No claim smaller than σ is stated as an improvement. | R6 §7 Q1: "Every claim of improvement is meaningless until this is measured… First release should spend its budget measuring σ rather than measuring an improvement." Published agent-benchmark σ ≈ 1.5–2.7 pp with 3-run CI half-widths 2.7–4.9 pp (R6, INFERRED) — use ours, not theirs. | GP-1 `work-plane-telemetry` | measured |

## 1.3 Multi-vendor

| # | Criterion | Falsifier | Evidence | Owner | Basis |
|---|---|---|---|---|---|
| **RA-9** | One adapter contract, two verbs, four vendors — with **no half-wired lane**. | For each of `grok, codex, gemini, claude`: either all eight R3 contract points are implemented and a conformance test passes, **or** the vendor is refused at the earliest gate with a named reason. A test asserts that a lane which passes the vendor map also passes the argv builder. | R5 §8.2: `claude` is plumbed at four sites (`wt-new.sh:106-109`, `lane-run.sh:210`, `lane-queue.sh:422`, `tool-check.sh:83`) and then **dies at `wc_build_argv`** because there is no claude branch. "A gemini lane must not repeat this half-wiring." | `vendor-adapter-contract` | measured |
| **RA-10** | The cross-vendor invariant is enforced **in code, at every tier**, including soft mode. | A test dispatches an audit with `audit.vendor == worker.vendor` in **soft** mode and asserts refusal. A second test asserts the ordered-preference router filters the worker vendor deterministically and records `auditor_vendor` + `auditor_selected_because` in the round report. | R5 §5.4, verified: the invariant is enforced in **exactly one line** (`audit-run.sh:31-33`), hard mode only, and stated in prose at six sites. "Soft mode has no code enforcement at all." Adding a 4th vendor takes the routing matrix from 3×2 to 4×3 while enforcement stays one `if`. ROADMAP schedules the fix for v0.4.0. | `vendor-adapter-contract` | measured |
| **RA-11** | `gemini` ships at **cap 1** and its auth tier is reported, not assumed. | `lane-queue.sh` shows `gemini:1`. `foreman-setup` reports which gemini auth tier is active (API-key free / Pro / Ultra / Vertex), not merely "authenticated". No cap raise without a GREEN row in `docs/research/vendor-concurrency-results.md`. | R3 §6.1: quota is **requests per user per day** (1,000 / 1,500 / 2,000 by tier; API-key free tier **250/day and Flash-only**), so "a Foreman gemini lane on a free key is *not* getting Pro-class reasoning, which quietly breaks the auditor-runs-at-highest-effort doctrine". R3 §1.13: no published concurrency guidance exists; existing doctrine (`lane-queue.sh:375-383`) requires a cited GREEN row. | `vendor-adapter-contract` | measured |
| **RA-12** | No lane can narrate success while writing nothing — for **any** vendor. | `wrote_files` is a `git status --porcelain` sha256 digest on every implement lane, all vendors; a replay round seeded with an empty burst asserts a loud `EMPTY-BURST FAILED`; `mutated_tree` is asserted empty after **every** audit including gemini plan mode. | R3 §6.4: two distinct silent-zero-write mechanisms now exist (grok prompt-cancelled writes + single burst; gemini `ask_user`→`deny` in headless), "and both can end `rc=0` with confident narration". `bugeventlog.md` 2026-07-28: a grok round exited 0 in 58 s with **zero files changed** and a red build. R3 §1.5: gemini plan mode still permits `.md` writes, so the tamper assert stays mandatory. | `vendor-adapter-contract` | measured |

## 1.4 Workflow

| # | Criterion | Falsifier | Evidence | Owner | Basis |
|---|---|---|---|---|---|
| **RA-13** | Round-mode dispatch is the **default path**, not an opt-in. | `config/foreman.toml.example` and `.foreman/config.toml` ship `durable.enabled = true`; a test asserts that a lane dispatched by the documented default path runs under `lane-run.sh --round`. | R5 §6.2, the single highest-leverage workflow finding: the "background-and-stop" attractor is the #1 failure class with **11+ self-counted occurrences across 3 vendors' models**, is **prompt-immune** ("the pattern survived direct, capitalized prohibitions in two different models"), and its structural fix is shipped but **disabled in this repo's own config** (`.foreman/config.toml:29`). | GP-1 `work-plane-telemetry` | measured |
| **RA-14** | An errored lane is not a dissenting lane. | The verdict schema carries three outcomes — `CONFIRMED` / `REFUTED` / `UNVERIFIED` — and a test asserts a lane that dies on a rate limit or a missing CLI produces `UNVERIFIED`, never `BLOCKED`. `gate-eval.sh` treats `UNVERIFIED` as "gate cannot decide", not as approval. | R2 P2, called "the highest-value single change in the lane": "a codex-auditor that dies on a rate limit must produce `unverified`, not a rejection… **an errored lane is not a dissenting lane**". Shipped upstream as a bugfix at CC v2.1.196. | GP-2 `audit-groundedness-gate` | published |
| **RA-15** | Verdicts cannot be internally contradictory, and findings must point at the diff. | `gate-eval.sh` enforces: `APPROVED` ⇒ no `critical`/`high` finding; `BLOCKED` ⇒ ≥1 `critical`/`high` finding or an explicit criterion miss; every finding's `file` exists in the diff's changed-file set; every finding's `line` falls in a changed hunk or is an explicit file-level `0`. | N4 G9/G1/G2, each stated at **0% false-positive rate by construction**. N4 on today's gate: `gate-eval.sh` "accepts a BLOCKED-with-no-findings without comment". N4 §7.7: these checks "require **no knowledge graph at all**… **If the graph plane slips, the gate improvements should not slip with it.**" | GP-2 `audit-groundedness-gate` | published |
| **RA-16** | The release declares a budget before it starts and reports consumed-vs-declared. | `docs/metrics/v0.2.9.json` carries `budget: {max_usd, max_wall_clock, max_model_calls, max_concurrent_workers, max_retries, min_evidence}` and `consumed: {…}`, both populated. Any round that exhausts its budget returns a **partial artefact with a stated stop reason**, not a fluent summary. | SOURCE §VIII-B (hypothesis generator, not evidence): ten declared limits; "Do not hide partial failure behind a fluent final answer." R6 §7 Q12: Foreman has `round_done` but **no partial-artifact contract**. | GP-1 `work-plane-telemetry` | judgement |

## 1.5 Graph plane — conditional criteria

The graph plane is the only part of this release that can be **descoped without
breaking anything else**. Its criteria are therefore written as conditionals: if
it ships, these must hold; if it does not ship, RA-17..RA-20 are vacuous and
`ROADMAP.md` records why.

| # | Criterion | Falsifier | Evidence | Owner | Basis |
|---|---|---|---|---|---|
| **RA-17** | The work-DAG is a **companion store**, not rows inside `graph.json`, and it is derivable deterministically at zero token cost. | `graph-project.sh` reads `el_read RUN 0` + checkpoint SHAs and writes `graphify-out/worklog.jsonl` (append-only). A test asserts a full `graphify --update` does not lose a single work record. Token cost of a projection run = **0**. | R5 §4.5: `graphify --update` **rebuilds from the filesystem**, so injected nodes are at risk on every refresh; `graph.json` is a 2.6 MiB git-tracked blob and per-round writes would recreate the `wt-merge`/gitignore pathologies at `bugeventlog.md:71-90`. R5 §4.1, verified: the committed graph was built at **0 input / 0 output tokens**; 3,499 of 3,579 nodes are `_origin:"ast"`. | GP-4 `work-dag-projection` | measured |
| **RA-18** | Exactly **three** queries work, and they are the acceptance test. | `children`, `leaves`, `lineage` over the Foreman run graph return correct answers on a seeded corpus, with a test per query. No richer query is a v0.2.9 criterion. | R1: these "are the only three queries that matter", and in AgentHub they are three SQL statements over `(hash, parent_hash)`. "Foreman should expose exactly these three over its own run graph before building anything richer." SOURCE Table II exit criterion for a persistent graph is "**cross-session queries work**" — nothing more. | GP-4 `work-dag-projection` | published |
| **RA-19** | No artefact enters the run graph without a resolvable parent, and no claim enters without provenance. | The projector rejects an orphan (400-equivalent) if `parent_run` is unresolvable. A validator **fails closed** on any node/edge missing `source_file` + producing `run_id` + `graphify_version`. `graphify diagnose multigraph --json` counts (dangling / missing-endpoint / collapsed / self-loop / unverified) are gate signals. | R1: AgentHub's push handler 400s on an unresolvable `parent_hash` — "reject orphans at the door". R7 §5.1: graphify's own validation is **advisory** — "`build_from_json` filters out `'does not match any node id'` errors and merely prints… **Nothing aborts**"; unknown `file_type` is silently coerced to `"concept"`; there is **no `graphify_version` field in `graph.json` — we must add it ourselves at ingest**. | GP-4 `work-dag-projection` | measured |
| **RA-20** | Exactly one process writes the graph. | A two-process write race against a scratch corpus loses **zero** nodes. Lanes have read-only access; the host-side consolidate step is the only writer. | R7 §9.4: "**two processes CANNOT safely update one graph**, except in the narrow `watch`/hook/`update` triangle on POSIX", and on Windows `fcntl` is absent so the lock "degrades to an unconditional `yield True`, i.e. **no locking at all**". `write_json_atomic` is last-writer-wins; "the shrink guard… only fires when the loser's graph has *fewer* nodes. Two lanes each adding disjoint nodes… both pass the guard, and the second silently discards the first's work **with no warning at all**." R7 calls this "the single biggest correctness gap". | GP-4 `work-dag-projection` | measured |

## 1.6 Honesty criteria

| # | Criterion | Falsifier | Evidence | Owner | Basis |
|---|---|---|---|---|---|
| **RA-21** | The `ROADMAP.md` v0.2.9 entry carries an **Honest residuals** block naming every UNVERIFIED claim, in the voice of v0.2.5 / v0.2.7.5 / v0.2.8. | The block exists and names at minimum: the Gemini adapter row re-derived against `agy` (R3 characterised the wrong binary), gemini T5b (unrun), gemini quota-exhaustion headless behaviour (untested), TerminusDB commit-log scaling past 478 commits (extrapolated, not measured) and its community responsiveness (unobserved), the cost-matched single-agent baseline (unmeasured), and Tier-3 precision on Foreman data (unknown). | The precedent is the repo's own: every prior release ships one. R3 §7 lists five things that "must be run before this becomes doctrine"; R8 §14 lists nine; the synthesis lists ten. | architect | judgement |
| **RA-22** | The three **stale** OpenSpec folders are reconciled before the release, not carried. | `hard-mode-launcher`, `el-emit-spawn-reduction` and `test-harness-fork-tax` are either archived with a note or their contradiction with `ROADMAP.md` is resolved in-file. | R5 §7/§8.2, verified: all three claim 0% execution while `ROADMAP.md` records them shipped in v0.2.8 / v0.2.0, and the code visibly contains the optimisations (`lib/eventlog.sh:88-110`). Every live package is 0/N. | architect | measured |
| **RA-23** | No claim of "verified" appears without the command that produced it. | Grep the release notes and every touched reference doc: each `VERIFIED`/`proven`/`measured` claim cites a command, a file:line, or a metrics artefact. | Repo doctrine; R6/R3/R7 all use explicit VERIFIED/INFERRED labelling and R1's whole finding is what happens when a synthesis does not. | architect | judgement |

---

# 2. Anti-criteria — things that must NOT be true

An anti-criterion fails the release even if every positive criterion passes.
Each has its own detector.

| # | Must NOT be true | Detector | Evidence |
|---|---|---|---|
| **AC-1** | **Silent coverage loss.** A test slice scoring green with zero exercised assertions; a bare `skip` with no reason; a script refactor that quietly takes a slice dark. | Coverage-honesty rule: the runner **refuses to score** any slice with zero exercised assertions and treats a reasonless `skip` as a failure. CI fails on any **per-slice** baseline drop, never on the aggregate. | R6 §5 Tier 0, from Layer-Isolated Evaluation (VERIFIED): six injected local regressions moved the **aggregate pass rate by only −1.7 to −5.9 pp** while **the owning slice dropped −25 to −91 pp**. An aggregate gate would have missed all six. |
| **AC-2** | **An unprovenanced claim in the graph.** Any node or edge without `source_file`, producing `run_id`, and `graphify_version`; any `INFERRED`/`AMBIGUOUS` edge treated as evidence; any `--force` without a recorded reason. | Fail-closed ingest validator (RA-19). `INFERRED`/`AMBIGUOUS` edges are stored, segregated, and **excluded from evaluator grounding by default**. Every `--force` writes a reason to the run record. | R4 §10.3 and R7 §11 #5. R7 §5.1: graphify validation never aborts; confidence is **self-asserted by the extracting LLM** against a prose rubric; graphify's own production distribution was measured **bimodal at >50% at 0.5 and >40% at 0.85+** (N2), i.e. the rubric collapses to a binary. |
| **AC-3** | **A vendor lane that narrates success while writing nothing** is scored as a success. | RA-12's git-status digest, on every vendor, every implement round. Exit code is never the completion signal. | `bugeventlog.md` 2026-07-28: "the exit status of a vendor CLI carries no information about whether the round was completed." Two lanes exited 0 in states that were not done. |
| **AC-4** | **A blocking gate whose false-positive rate is a measured percentage rather than a structural zero.** | Every blocking check is closed-world — "a set-membership or structural test over data Foreman itself produced". Anything open-world runs in **shadow/WARN** mode. | N4, the central rule. The arithmetic: at **93% precision and 40 merges/week a blocking evidence-sufficiency check false-blocks ~3 correct merges per week** — "worse, it teaches the operator to bypass the gate." Foreman's own `bugeventlog.md` already logs a force-merge (`:677-706`). |
| **AC-5** | **A metric reported as a bare average, or without its companion number.** | Every metric in `docs/metrics/v0.2.9.json` carries p50 **and** p90, a catastrophic-case count, and its named companion (M1↔architect-authored share; M3↔tokens-per-merged-line; M5↔blocking-verdict precision). | R6 §4: "A metric without a companion is a metric that will be gamed." SOURCE Table III Operations row: "Average success hides catastrophic cases." |
| **AC-6** | **A vendor cap raised without a cited GREEN row.** | `lane-queue.sh` caps are diffed against `docs/research/vendor-concurrency-results.md`; a raise with no matching row fails the gate. | Existing doctrine, `lane-queue.sh:375-383` and `:415-421`: "A future cap raise here MUST cite a specific GREEN row added to that doc." Default-on-doubt is 1. |
| **AC-7** | **An LLM in the per-commit graph path.** | The projector and the per-commit `graphify update` are asserted to consume **0 tokens**; a test fails if `cost.json` grows on a code-only change. | R4 §3: "Any LLM in the per-commit path is a cost and nondeterminism bug." R4 §2.2 headline: GraphRAG's community-summary layer costs **~14M tokens** to refresh on a corpus change. R7 §6.3: "Code-only change set → **zero LLM cost**… This is the common Foreman case." |
| **AC-8** | **A decision edge round-tripped through an undirected simple graph, or through an exporter.** | `SUPPORTS`/`CONTRADICTS`/`SUPERSEDES` between the same pair must survive a store round-trip as three distinct edges with distinct provenance. The store ingests **`graph.json`**, never `cypher.txt` and never `export neo4j`. | R4 §9.1 #11 (BLOCKING): the committed graph is `directed: false, multigraph: false`; "a Foreman-side layer **must not** round-trip decision edges through an undirected simple-graph `graph.json` — they will be silently collapsed." R7 §8.3: `to_cypher` emits **five values total** and drops `source_file`, `source_location`, `confidence_score`, `context`, hyperedges, `community`, `built_at_commit`, `_origin` — "**Do not use it.**" |
| **AC-9** | **A comparison across a model-version change.** | Every metrics file pins model versions; a version bump invalidates the baseline and forces a re-baseline, recorded as such. | R6 §5 Tier 2 and §7 Q11 ("every pinned model bump invalidates every locked baseline"). R3 §6.5: gemini `auto` **silently routes simple prompts to 2.5-Flash** and `--model` does not bind sub-agents, so pinning `-m` is necessary but not sufficient — the round report must record the models actually reported. |
| **AC-10** | **A package marked done with unchecked tasks, or a ROADMAP entry contradicting its own change folder.** | `openspec/changes/*/tasks.md` checkbox counts are asserted against the ROADMAP claims at release time. | R5 §7: every one of the 9 live packages is **0% executed**; three of them contradict `ROADMAP.md` outright. |
| **AC-11** | **A "graph gate" that reads as a correctness gate.** | Any shipped validation surface carries the mandatory disclaimer, verbatim in the doctrine: a green symbolic validation means claims are well-formed, sourced and internally consistent — **it does not mean the work is correct**. | N4: "The graph gate is a **provenance and citation gate**, not a correctness gate… the first time it is wrong will be expensive." |
| **AC-12** | **Multi-vendor justified by independence in any shipped doc, absent an M5 number.** | Grep README / SKILL.md / lanes.md / ROADMAP for independence claims; each must cite a measured unique-catch rate or be rewritten as a capability/coverage/availability claim. | R6 §6.1: **9 frontier LLMs across 7 families behave as ~2 genuinely independent votes**; "roughly three-quarters of the panel's nominal independence is lost"; individual top models **matched or exceeded** the full panel; the gap to the independent-voting ideal was **8–22 pp** and sophisticated aggregation closed **at most 11%** of it. |

---

# 3. Per-capability acceptance criteria

Written to be pasted into each package's `tasks.md` gate section verbatim.

## 3.1 WSL compatibility — `wsl-launcher-shipped`, `wsl-preflight`, `wsl-tool-path-persistence`, `wsl-seam-doctrine`, `crlf-extensionless-hardening`, `wsl-ci-parity`

```
GATE — WSL compatibility
[ ] W1  Fresh clone + bootstrap-wsl.sh + foreman-setup.sh on a reference WSL box
        yields tool-check READY for the soft profile, with the launcher present.
        Falsifier: env/tool-check.sh --profile soft; grep -q 'foreman-launch.*ok'
[ ] W2  A full round on that fresh clone emits no
        alert{kind:"degraded",reason:"launcher_absent"}.
        Falsifier: jq -e 'select(.type=="alert" and .payload.reason=="launcher_absent")'
                   over events.jsonl returns nothing.
[ ] W3  Every #!-led git-tracked file has index mode 100755, repo-wide (35 entries
        under skills/foreman/scripts/ plus scripts/nats/setup.sh plus the 3 SDD
        scripts). git status --porcelain skills/ is empty after install.sh.
        [R5 §8.1 — the defect is 33 files, not 3]
[ ] W4  git ls-files --eol shows i/lf for every text file; a binary carve-out list
        exists in .gitattributes; an index-based (not worktree-based) test guards it.
[ ] W5  Preflight refuses (or loud-warns with an override) when FOREMAN_HOME is
        under /mnt, and when the resolved mkdir is not kernel-atomic (see L4).
[ ] W6  ~/.foreman/env.sh persists WSL-native tool PATH; a non-interactive lane
        resolves grok/codex/gemini without an interactive login shell.
[ ] W7  The grok readiness probe is stubbed in unit tests — no unit test is coupled
        to live vendor readiness or the network.
        [ROADMAP v0.2.8 residual: the network-flaky `timeout 10 grok models` probe]
[ ] W8  CI: ubuntu-latest runs tests/run.sh + shellcheck + launcher build + install.sh.
        windows-latest runs tests/run.sh under shell: bash AND invokes install.ps1
        via powershell.exe (5.1), not only pwsh.
        [R5 §8.2 — the v0.2.8.1 BOM failure was specific to PS 5.1]
```

## 3.2 Lock primitive — `lock-primitive-hardening`

```
GATE — lock primitive
[ ] L1  lib/lock.sh exists; el_emit, el_attempt_new, el_compact and the worktree
        locks all route through it. No direct mkdir-mutex remains in the durable core.
        Falsifier: grep -rn 'mkdir .*\.lock' skills/foreman/scripts/ returns only lib/lock.sh
[ ] L2  Mechanism selection is resolved once per process and reported, so a run
        record says which primitive was used.
[ ] L3  RELEASE-CONTENTION TEST: 15 rounds x 8 racers, 0 critical-section violations,
        on BOTH the flock path and the forced-mkdir fallback path.
        [F-uutils measured: uutils mkdir = 57 violations/15 rounds; GNU = 0]
[ ] L4  POSITIVE CONTROL: the same test, run against a deliberately non-atomic
        mkdir, MUST report violations. A test that cannot fail is not a test.
        [F-uutils: the existing test 43 "passes in isolation (load-sensitive)"]
[ ] L5  A Setup/preflight probe asserts the resolved mkdir takes EEXIST from the
        kernel and refuses or loud-warns otherwise.
[ ] L6  Test 50 ("append failure leaves a gap, never a duplicate seq") is valid
        under EUID 0: either skipped with a named precondition or the failure is
        forced by a means root cannot bypass.
        [F-uutils: the WSL default user is root; root bypasses chmod 000 and the
         assertion inverts. Test-validity bug, not a product defect.]
[ ] L7  No silent infinite wait: every acquire is bounded and fails with a named error.
```

## 3.3 Test infrastructure — `test-infrastructure-hardening`

```
GATE — test infrastructure
[ ] T1  tests/lib/preconditions.bash provides require_platform / require_tool /
        require_non_root / require_built / require_no_live_vendor. Every skip names
        its unmet requirement and, where applicable, the command that satisfies it.
[ ] T2  A bare skip with no reason FAILS the run.                        [AC-1]
[ ] T3  tests/skip-budget.tsv (file x platform -> permitted skips) exists and the
        runner fails when a file exceeds its budget.
[ ] T4  The suite is SLICED, with a locked per-slice baseline in the repo. CI fails
        on any slice dropping below its lock, never on the aggregate.
        Proposed slices (R6 §5): spec-parse, worktree, admission/queue,
        launcher/cascade, eventlog/replay, checkpoint/resume, watchdog-state-machine,
        evidence-collect, audit-call vendor-not-worker invariant, gate-eval verdict
        truth table, merge-freshness, cleanup/reap, config-resolution, vendor-isolation.
        [Justification: 6 injected regressions moved the aggregate only -1.7..-5.9 pp
         while the owning slice dropped -25..-91 pp]
[ ] T5  COVERAGE-HONESTY: the runner refuses to score any slice with zero exercised
        assertions.
[ ] T6  REGRESSION-INJECTION SELF-TEST, once per release: mutate one scaffold file,
        assert the owning slice ranks worst. Report the rank.
        Target: mean rank <= 1.5, owning slice in the top 3 on every injection.
        [Reference harness achieved mean rank 1.29, worst-of-19 in 5 of 7, top-3 in 7 of 7.
         Our target is a JUDGEMENT loosening of that, for a first attempt.]
[ ] T7  A fresh-clone run reports zero unexplained failures.             [RA-1]
[ ] T8  REPLAY CORPUS v1 (Tier 1): FOREMAN_VENDOR_REPLAY=<dir> replays recorded
        stdout/exit-code/file-writes instead of calling a vendor CLI. >= 10 frozen
        rounds, DELIBERATELY including the pathological ones: an empty grok burst,
        a BLOCKED audit the architect overturns, a stalled lane the watchdog kills,
        a merge-freshness conflict, a dirty-resume refusal, a live-target worktree
        refusal, a worker writing outside the worktree, a detached-HEAD audit start.
        Assertions are on the DECISION TRACE (event-type sequence, gate verdict,
        artefacts, state-machine path), never on prose.
[ ] T9  RULE, adopted permanently: every new bugeventlog.md entry adds a replay round.
        Falsifier: a CI check comparing bugeventlog entry count to corpus round count.
```

## 3.4 Multi-vendor lanes — `vendor-adapter-contract`

> **Input defect, flagged by the synthesis lane (§2.6): every gemini-specific
> falsifier below is about the wrong binary.** R3 evaluated
> `@google/gemini-cli` 0.52.0. The mandated Gemini lane is **`agy` (Antigravity
> CLI 1.1.7)**, which reportedly has `--json-schema`, `--mode plan|accept-edits`
> and `--effort` — i.e. schema-forced verdicts and a first-class read-only mode,
> which close the two largest shims R3 designed around. **R3's adapter contract
> stands** (eight points; stdin is never the prompt channel; git-status digest as
> the only write evidence; per-lane config-home isolation; cap 1 until a green
> T5b row; unavailability always reported). **R3's gemini row does not.**
>
> Therefore, as a gate item in its own right:
> `[ ] V0  The entire gemini adapter row is re-derived LIVE against agy 1.1.7
>          before vendor-adapter-contract freezes — exit codes, isolation env var,
>          schema forcing, read-only mode, write-authorization flag, auth probe,
>          and the headless quota-exhaustion behaviour R3 named as its single most
>          important untested item. V3's gemini bullets below are placeholders
>          until that lands.`
> This does not weaken RA-9 through RA-12, which are vendor-agnostic. It does mean
> **no gemini criterion below may be marked satisfied on R3's evidence.**

```
GATE — multi-vendor
[ ] V1  adapters/<vendor>.sh for grok|codex|gemini|claude, each defining the seven
        R3 contract functions. lib/worker-cmd.sh is retired or delegates.
[ ] V2  The AUDIT verb has an argv builder. audit-run.sh and agents/codex-auditor.md
        no longer carry two hand-maintained copies of the same invocation.
[ ] V3  CONFORMANCE SUITE, per vendor, all passing or explicitly refused:
        - prompt never arrives on stdin
        - implement lane can write (grok: --allow Write --allow Edit;
          gemini: --approval-mode auto_edit --skip-trust;
          codex: --sandbox workspace-write)
        - audit lane cannot write to tracked source (grok: --permission-mode plan;
          codex: --sandbox read-only; gemini: --approval-mode plan)
        - post-audit `git status --porcelain` is empty  [MANDATORY for gemini:
          plan mode permits .md writes]
        - a non-conforming verdict is STATUS: fail, not a verdict
          [gemini has NO --output-schema equivalent; schema is prompt-forced and the
           adapter must validate against adapters/verdict.schema.json itself]
        - rc_unavailable set published per vendor
          [gemini 41 = unauthenticated and is UNDOCUMENTED; arg errors return 1,
           not the documented 42]
        - gemini -o json: stdout AND stderr captured to separate files
          [on failure stdout is EMPTY and the JSON object goes to stderr; Google's own
           published `| jq -r '.response'` recipe yields an empty string and rc 0]
[ ] V4  No half-wired lane: a vendor that passes the LANE_VENDOR map also passes the
        argv builder, or is refused at the map.                          [RA-9]
[ ] V5  Cross-vendor invariant enforced in code in SOFT mode.            [RA-10]
[ ] V6  Ordered auditor preference list; worker vendor auto-filtered; the round report
        records auditor_vendor + auditor_selected_because. Substitution is never silent.
[ ] V7  gemini cap = 1 in lane-queue.sh; auth tier reported by Setup.    [RA-11]
[ ] V8  vendor-multiround.sh (generalised from grok-multiround.sh) applies the
        git-status digest to every vendor.                               [RA-12]
[ ] V9  Model pinning: every lane passes an explicit -m. A test asserts no lane runs
        on gemini `auto`. The round report records the models actually reported in
        the result event's per-model token breakdown.
[ ] V10 NO separate plain-GPT lane. "Broaden GPT" is delivered by parameterising the
        codex adapter on model + -p/--profile.
        [R3 §2.4: a plain-GPT path means writing our own Responses-API client, tool
         loop and file-write layer, and losing the sandbox for free]
```

## 3.5 Workflow improvements — GP-1 `work-plane-telemetry` (round-mode default) + GP-2 `audit-groundedness-gate`

```
GATE — workflow
[ ] F1  durable.enabled defaults to true in the example config and this repo's config.
        A test asserts the documented default dispatch path runs under lane-run --round.
        [R5 §6.2 — class-1 is the #1 failure class, 11+ occurrences, prompt-immune,
         and its structural fix is currently OFF by default]
[ ] F2  Three-outcome verdicts CONFIRMED|REFUTED|UNVERIFIED; an errored lane
        produces UNVERIFIED; gate-eval treats UNVERIFIED as "cannot decide".   [RA-14]
[ ] F3  G9 verdict/finding consistency enforced in gate-eval.sh.               [RA-15]
[ ] F4  G1/G2 finding groundedness: every finding's file is in the diff's changed-file
        set; every finding's line is in a changed hunk or an explicit file-level 0.
        [N4: 0% FP by construction, ~15 lines of jq for G9, a JSON side-file for G1/G2]
[ ] F5  G4 cross-vendor invariant and G5 rubric-version existence at BASE_SHA are
        enforced deterministically.
[ ] F6  Budget declared before the round; consumed/declared recorded; a budget-exhausted
        round returns a partial artefact with a stated stop reason.            [RA-16]
[ ] F7  A predicted-effect field on every spec: {predicted_fix[], predicted_regression[]},
        with payload.prediction_outcome the following round.
        [R6 §3.2 / 2604.25850's decision observability: "pairs every edit with a
         self-declared prediction, later verified against the next round's outcomes"]
[ ] F8  No new process ceremony is added to the WORKER's job as a v0.2.9 deliverable.
        [R6 §6.4: agent-written tests do not move outcomes (VERIFIED, 2602.07900);
         2604.25850's ablation found gains came from tools, middleware and memory,
         NOT system prompts. Any "write tests first / self-review" clause is assumed
         ineffective until measured.]
[ ] F9  RATCHET RULE, written into ROADMAP.md and the merge gate:
        "An orchestration change is kept only if the Tier-0/Tier-1 harness improves or
         holds at equal-or-lower cost on the locked baseline. A regression reverts.
         A lateral move at lower cost is kept. A lateral move at higher cost reverts."
        With anchor discipline, an independent auditor of the metric itself, and a
        failure-expecting default.
```

## 3.6 Telemetry — GP-1 `work-plane-telemetry`. **This package gates everything comparative.**

```
GATE — telemetry
[ ] E1  payload.usage = {vendor, model, effort, input_tokens, output_tokens,
        cached_tokens, cost_usd} on every lane-completion and audit-completion event.
        All additive inside payload — the frozen top-level {seq,ts,type,lane,commit?,
        payload} shape is untouched.       [lib/eventlog.sh:6-11 states the freeze]
[ ] E2  payload.spec = {id, five_part_hash, diff_loc, files_touched, risk_class}
        at round start.
[ ] E3  payload.finding = {id, source: checks|audit|architect, severity, upheld}
        — ONE EVENT PER GATE-BLOCKING FINDING. This is what makes M5 and M9 computable.
[ ] E4  payload.vendor and payload.model at the prompt emit site (lane-run.sh:851),
        sourced from $LANE_VENDOR and WC_*_MODEL.
        [R5 §3.2 gap 1: today vendor is inferred from a PATH STRING in
         ownership.payload.config_dir. There is no vendor field on any event.]
[ ] E5  payload.attempt is MANDATORY on every event type (today only ownership and
        state carry it). Schema-legal, no el_emit signature change.
[ ] E6  gate-eval.sh and audit-run.sh source lib/eventlog.sh and emit.
        [R5 §3.2 gap 3: neither contains an el_emit call; the decision is outside
         the lineage store]
[ ] E7  metrics.json rollup per run, written by gate-eval.sh; docs/metrics/v0.2.9.json
        aggregate committed with the tag.
[ ] E8  M1-M4, M7, M8, M12 computable from the release's own runs.
        M5, M6, M9, M14 computable OR explicitly listed as blocked, with the blocker.
[ ] E9  Foreman's own run-to-run sigma measured and published.                  [RA-8]
[ ] E10 Every metric carries p50, p90, a catastrophic-case count, and its companion.
                                                                               [AC-5]
```

## 3.7 Graph plane

Split into four sub-gates. **Only G-EXTRACT and G-DAG are candidates for
v0.2.9.** G-STORE and G-CONSUME are pre-registered here so their kill criteria
are fixed in advance; see §4.

```
GATE — G-EXTRACT (deterministic extraction only)
[ ] X1  Per-commit path is AST-only. Token cost of a code-only update = 0, asserted.
        [AC-7; R7 §6.3 "Code-only change set -> zero LLM cost"]
[ ] X2  graphify --update runs AUTOMATICALLY (post-merge hook or CI job), not by hand.
        [R5 §4.4: "the graph is refreshed by hand, at release time, by the architect.
         That is the single biggest operational weakness of adopting it as the
         substrate." R5 §4.3: 26 files entirely unrepresented after only 3 commits.]
[ ] X3  ONE interpreter and ONE graphify version pinned and recorded.
        [R7 §3: three versions coexist on this box — PATH 0.9.16, dist-packages
         0.9.18, installed SKILL.md 0.9.15. "Two different code paths in one repo."]
[ ] X4  Every ingest stamps graphify_version (absent from graph.json by design).
[ ] X5  Node-ID churn is modelled as RENAME-WITH-LINEAGE, not delete+create.
        [R7 §8.5: IDs are stable under content edits but change on file move/rename
         and on a graphify stem-recipe change (this already happened: #1504)]
[ ] X6  graphify diagnose multigraph --json counters are gate signals: dangling,
        missing-endpoint, collapsed, self-loop, unverified.
[ ] X7  Ingest reads graph.json, NEVER an exporter.                            [AC-8]
[ ] X8  BLOCKER TO RESOLVE FIRST: R4 requires a DIRECTED MULTIGRAPH (`--directed`,
        parallel typed edges). R7's verbatim CLI surface shows NO --directed flag on
        `graphify update` or `graphify extract`, and the committed graph is
        directed:false / multigraph:false. Neither lane demonstrates the capability.
        Falsifier: produce a directed multigraph from a documented CLI invocation,
        or the decision-edge design is redesigned before any of it is built.

GATE — G-DAG (work-DAG projector)
[ ] D1  graph-project.sh derives worklog.jsonl from el_read + checkpoint SHAs.
        Deterministic, zero-token, re-runnable.                                [RA-17]
[ ] D2  A full `graphify --update` loses zero work records.                    [RA-17]
[ ] D3  children / leaves / lineage answer correctly on a seeded corpus.       [RA-18]
[ ] D4  Orphans rejected at the door; fail-closed provenance validator.        [RA-19]
[ ] D5  Single writer proven by a two-process race.                            [RA-20]
[ ] D6  JOIN KEYS fixed and tested: JK-1 foreman:run/<RUN>/lane/<LANE>/attempt/<N>;
        JK-2 checkpoint SHA -> git diff-tree --name-only -> nodes[].source_file;
        JK-4 foreman:finding/<sha256(file+line+summary)>.
        Symbol resolution: greatest source_location <= first changed hunk line;
        fall back to the FILE node when no symbol matches — NEVER guess.
[ ] D7  RETENTION POLICY exists. When is a RUN_ID's subgraph archived?
        [R4 §11 Q10: "No retention policy is designed." A DAG grows without bound.]

GATE — G-STORE (GP-6; adapter may be deferred behind the census — see K-3f)

R4's five pre-registered store questions are now ANSWERED by R8 against a live
TerminusDB 12.0.6. Recorded here so nobody re-litigates them:
  S1 parallel typed edges  -> YES. supports/contradicts are distinct Set properties
                              on Claim; decision edges are store-native and never
                              round-trip through graph.json.
  S2 write-time validation -> YES. Schema-enforced; the store rejects anything not
                              in the schema. (Contrast graphify, whose validation is
                              advisory and never aborts.)
  S3 per-lane attribution  -> YES, but NOT via commits. Commit `author` is an
                              arbitrary caller string and commits carry no structured
                              metadata; attribution is a `run_id` FIELD on GraphNode.
  S4 selective un-merge    -> STILL ASSUMED NO. R8 §14 Q3 leaves it open. The additive
                              RESOLVED_TO layer stays non-negotiable. CONFIRM, do not
                              assume.
  S5 no @subdocument       -> ADOPTED as a rule for Claim/Evaluation/Finding/Source.

The live gate is therefore the guardrails, not the capability:
[ ] S6  GraphStore port exists; files-only implementation ships FIRST and GP-1..GP-5
        contain no store dependency.                                        [K-3a]
[ ] S7  Drop-and-rebuild from events.jsonl + graph.json + journals is DEMONSTRATED,
        diffs clean, < 15 min. Run every release.                           [K-3b]
[ ] S8  Work-DAG is stored as DOCUMENTS. No query path touches /api/log or uses
        `start=` paging.                    [measured 2.4 ms/commit, O(offset)]
[ ] S9  Every wrapper normalises version refs and asserts non-empty; a test passes
        `branch:main` and asserts the wrapper RAISES.                       [K-3e]
[ ] S10 CAS header on every shared-document read-modify-write; branch-per-lane for
        independent work; TERMINUSDB_SERVER_WORKERS raised above 8 for ~10 lanes.
[ ] S11 `Distinct` wraps every Path query.       [10 rows returned for 4 answers]
[ ] S12 MENTIONS reified now; SUPPORTS/CONTRADICTS reification PLANNED (no edge
        properties exist; retrofit is a migration + backfill).
[ ] S13 Version pinned; store directory backed up by stop-and-tar; longevity
        tripwires (K-3d) recorded in the release checklist.

GATE — G-CONSUME (deferred; criteria pre-registered)
[ ] C1  Context block is IMMUTABLE and CONTENT-HASHED; the hash goes in the run record.
[ ] C2  Serialization: subject-grouped arrow DSL with explicit edge IDs.
        [N3 measured, 30-edge Foreman subgraph, o200k: 412 tok = 13.7 tok/edge,
         vs JSON-LD expanded 1500 tok = 3.64x. Pretty-printed JSON costs 2.8x.]
[ ] C3  Budget: K = floor(budget_tokens / 14); default 2,000 tokens ~= 145 edges;
        floor 40; HARD CAP 4,000 tokens ~= 290 edges.
        BUT: our knee must be measured on OUR graph before the default is trusted
        (N3 §11 Q1 — Foreman edges carry long free-text objects).
[ ] C4  Hard hop bound k=2; |seeds| <= 8; candidate cap 2,000 edges; truncation flagged.
[ ] C5  If |seeds| == 0: emit NO GRAPH CONTEXT. Never fall back to a global or
        random subgraph.
[ ] C6  Never summarize the served subgraph. Serve edges verbatim with their IDs.
        [ALCE: summarizing evidence costs -8 to -15 citation precision]
[ ] C7  Citations are inline during generation, never post-hoc.
        [ALCE: post-hoc citation recall collapses 73.6 -> 26.7, a 46.9-point drop,
         while correctness barely moves (-2.1)]
[ ] C8  Post-generation DETERMINISTIC verification: HALLUCINATED_EDGE_ID /
        OUT_OF_CONTEXT_CITATION / UNSUPPORTED_CLAIM. "Missing" and "contradictory"
        are graph QUERIES, never model judgements.
        [ALCE ceiling ~72% citation precision => roughly 1 in 4 cited edges is wrong.
         Foreman's advantage: the citation target is a row, not a paragraph.]
[ ] C9  A .vocab.txt expansion pre-step is MANDATORY on every graph query, logged for
        auditability, and fails loudly on empty expansion.
        [R7 §9.3: graphify's matcher is case-folded substring + IDF with no stemming,
         no synonyms, no cross-language match. "Any Foreman lane that calls query_graph
         over MCP without doing this will get silent zero-recall."]
[ ] C10 We must not both optimize against and evaluate with the same citation checker.
```

---

# 4. Kill criteria — pre-registered

This is the section that matters. Each bet gets: the measurement, the threshold,
**fixed now**, and the action. After the fact, everyone finds a reason it worked.

A note on why these are strict. Five independent lanes produced evidence against
parts of this release, and they do not agree with each other by accident: R6
(judge independence), N3 (graph consumption), N1 (neurosymbolic pipelines), R4
(graph memory), N4 (symbolic verification §7.7). The convergent finding is that
**the measured wins in this literature come from deterministic, externally-imposed
checks and from harness changes — not from more models, more structure, or more
prompt ceremony.**

---

## K-1 — The knowledge plane (LLM-extracted semantic graph + consumption)

**The bet:** a knowledge graph makes Foreman's workers and auditors better.

**Measurement A — the query census (do this BEFORE building).**
Log 100 consecutive architect/lane retrieval queries over one release. Classify:
(a) point lookup, (b) single-document, (c) genuine multi-hop across runs/specs/defects.

- **Threshold:** if **(c) < 20%** of queries, the knowledge plane is descoped to
  provenance-only for v0.2.9 **and GP-6 freezes** — the synthesis names the same
  test and the same consequence ("if the multi-hop-cross-run share is small, the
  store materialisation is Table VI's *activity without progress* — freeze GP-6,
  keep the journal and the gate checks"). One census, two decisions.
- **Basis: judgement.** 20% is my number. The band is anchored by R4 §10.5
  ("we should expect to fail it for single-task context and pass it only for
  cross-session and cross-lane questions"), SOURCE §VIII-C's seven disqualifying
  conditions (of which Foreman meets *tasks are independent*, *answers depend on
  one document*, and arguably *a relational table answers every query*), and
  N3 §11 Q9 ("Needs a question-type census of real Foreman tasks **before** we
  size the graph plane"). No source gives a share threshold; I am fixing one so
  the answer cannot be argued after the census.

**Measurement B — the head-to-head (do this BEFORE shipping consumption).**
On the Tier-1 replay corpus, ≥10 rounds × 3 repeats, three arms, models pinned:

| Arm | Content |
|---|---|
| **A** | graph context block (the §3.7 G-CONSUME design) |
| **B** | "just prompt the model with good context" — spec + diff + report, no graph |
| **C** | a lexical (BM-25/TF-IDF) index over the same store |

Metrics: task success; citation precision **against the deterministic checker**;
tokens; wall clock.

- **Threshold:** if arm A does not beat `max(B, C)` by **more than the measured
  run-to-run σ (RA-8)** on task success, the consumption layer is killed.
- **Basis: measured + published.** The σ rule is R6's; the arms are R6 §6.2's
  "honest null hypothesis" and N3's own evidence base.

**Why this threshold and not a friendlier one — the disconfirming evidence, unhedged:**

| Result | Numbers | Source |
|---|---|---|
| BM-25 beats **all nine** GraphRAG systems on True/False | BM-25 **84.49**; best graph 82.59 (−1.90); worst DALK 77.22 (**−7.27**) | GraphRAG-Bench, 9 systems / 1,018 questions / 7M words, VERIFIED |
| The **bare LLM with no retrieval** wins outright on 3 of 6 question types | multi-choice 81.11 (8 of 9 graph systems lose), fill-in-blank 74.29 (LightRAG −9.05), multi-select 76.68 | same |
| LightRAG spent **83.9M tokens + 12,976 s** and scored **71.22 — below TF-IDF's 71.71** | — | same |
| MSFT GraphRAG: **79.9M tokens for +0.79 over TF-IDF ≈ 101M tokens per accuracy point** | — | same |
| A 2026 neurosymbolic pipeline scored **61.6% vs 67.3% for its own text-only baseline** | — | N1 |
| A **full-context baseline beat the memory system in the vendor's own paper** | ~73% vs ~68% J-score | R4 §8.1 |
| **HippoRAG 2 concedes** graph-augmented RAG "drops considerably below standard RAG" on basic factual memory | — | R4 §8.4, "the cleanest published negative result in the family" |
| A typed store with **deliberately no knowledge graph** beat the graph systems | Memanto: LongMemEval **89.8**, LoCoMo **87.1**, no ingestion cost, sub-90 ms | R4 §8.7 |
| Anthropic's own guidance: **under ~200k tokens, skip retrieval entirely** | Foreman's working set — a spec, a diff, a report — is far under this | R4 §8.2 |
| Long context beats RAG on accuracy for all three models tested | Gemini-1.5-Pro avg **LC 49.70 vs RAG 37.33 (+12.37)**. Retrieval's advantage is **cost, not accuracy** | N3 |
| Structure machinery collapses to zero where the structure fits the prompt | StructGPT: **+62.9** on MetaQA-2hop (doesn't fit) → **−4.2** on TabFact (fits) | N3 |
| The prose overstates the tables, twice, in the same direction | Graph-of-Records §3.2 claims it "beats… in every aspect"; its own Table 5 shows it losing GovReport R-2 16.8 vs 17.6 and an **ablated variant beating the full model** | N3 |

**Where the graph *does* win, measured:** open-ended questions (0 of 9 graph
systems lose; HippoRAG **+6.13** over BM-25), multi-hop (ToG CWQ **+21.2**,
WebQSP **+14.2** over CoT), and cross-session provenance. N3's own verdict is
"**Route by question type, not by ideology**" — and it notes that Foreman's
*auditor* checks ("does edge e07 say X") are exactly the lookup shape where a
lexical index wins.

**Action if killed:**
- Revert the consumption layer (GP-5) entirely.
- **Keep** the work-DAG projector (K-1 does not touch it — it is deterministic,
  zero-token, and justified by a different argument: R4 §8.11 grants that git
  already answers lineage, but Foreman's *decision* records — verdicts, findings,
  vendor attribution — are the ones that are currently *nowhere*).
- **Do not infer anything about the store.** K-1 kills GP-5; GP-6 is decided
  separately by K-3c, and the store's differentiators (time-travel, graph
  branch/diff) are not what K-1 measures. The reverse also holds: a frozen GP-6
  says nothing about whether the context block works. Two bets, two verdicts.
- Record the kill in `ROADMAP.md` residuals with the numbers.

---

## K-2 — Semantic extraction quality

**The bet:** LLM extraction produces a graph good enough to reason over.

**Measurement:** a hand-built gold set over Foreman's own corpus. Report entity
P/R/F1 and relation P/R/F1 **with predicate scoring**, false-merge rate, and the
non-isolated-node fraction.

| Signal | Threshold | Action if breached | Basis |
|---|---|---|---|
| Relation F1 (predicate-scored) | **< 0.60** | kill semantic extraction; AST-only plane | published — Anthropic's cookbook baseline band is relations P 0.70–0.85 / R 0.55–0.70 / **F1 0.60–0.75**, and that band is an **upper bound** because "predicate wording is ignored… **so would a semantically wrong predicate like 'destroyed' between the same two entities**" |
| Non-isolated nodes | **< 70%** | kill semantic extraction | measured — N3: KGP **46.03%**; GraphRAG **72.51%**; LightRAG **69.71%**; plain KG methods **~90%**, because richer extraction "inevitably introduces more noise" |
| False merges in the sample | **any (target ≈ 0)** | kill entity resolution; keep surface forms | published — SOURCE §IX-G: "A false merge can contaminate many traversals"; R4 §5.2 target ≈ 0; N2: "Entity resolution errors are the one class of extraction error that corrupts *other* answers rather than just being wrong locally" |
| Nodes merged in one pass | **> 40%** | the pass is a bug, not a discovery — abort | published — R4 §5.3 |
| Compression ratio | **reported, never optimised** | any optimisation of it is a kill | published — Table III: "Compression alone rewards over-merging" |
| Component count | **alarms in BOTH directions** | a sudden rise = resolution regression; a sudden fall = over-merging | published — R4 §10.5 |

**Additional pre-registered ceiling from N2 (all VERIFIED):** LLM competence
collapses as you move up the ontology layer cake — term typing F1 **0.94–0.99**,
taxonomy discovery **0.02–0.66**, non-taxonomic relations **0.03–0.08**, axiom
identification **0.03–0.36**. Domain F1 **0.038** and range F1 **0.030** are at
noise level. Therefore, pre-registered as a **hard rule, not a threshold**:
**never ask an LLM to decide an edge's domain, range, cardinality or
disjointness**, and **never make an LLM infer relations between opaque IDs**
(the gibberish ablation: "LLMs are unable to consistently retrieve the same
taxonomic relationships between analogous concepts"; fine-tuning recovered it,
prompting did not). Every Foreman-invented identifier — run IDs, lane names,
attempt hashes — is adversarial input to LLM extraction.

**Ontology budget, pre-registered as a kill not a warning:** the schema shown to
an LLM in a single prompt must be **≤ 10 node types and ≤ 10 edge types**, every
type name a common English word, every enum closed and short. Exceeding it kills
the schema, not the release. (N2, VERIFIED: "as the number of types increases…"
and the constrained-vs-unconstrained ladder SciERC 7 / Wiki-NRE 45 / WebNLG 159
where richer schemas "hinder extraction performance". Foreman's draft is 9/11 —
"right at that budget, which is a point in its favour, and a reason to resist
the temptation to add more.")

---

## K-3 — TerminusDB as the store

> **Revision note (2026-07-28).** An earlier draft of this criterion killed
> TerminusDB by default on the grounds that no lane had evaluated it. **That was
> wrong.** R8 (`R8-terminusdb-store.md`, 787 lines) landed after this document was
> dispatched. It did not read brochures: it ran TerminusDB **12.0.6 in Docker on
> this WSL box** and measured. The criterion below is re-derived from that
> evidence. My conclusion changed; the discipline did not.

**The bet, as the synthesis defines it:** TerminusDB is a **regenerable
materialisation behind a `GraphStore` port with a files-only fallback, never the
system of record**, with the work-DAG stored as *documents* rather than as store
commits. Under that design GP-1 through GP-5 never touch TerminusDB at all, so
the project dying is a re-materialisation, not a rewrite.

That design changes what a kill criterion must test. The old questions
(*can it model this? does it work?*) are answered. The live-verified evidence:

| Claim | Result | Label |
|---|---|---|
| Full draft Foreman ontology, 18 classes/enums | **loaded and validated** on 12.0.6 | VERIFIED-live |
| All 9 node types / 11 edge types expressible | 10 of 11 as direct properties; only `MENTIONS` needs reification | VERIFIED-live |
| The three lineage queries | **all correct on first attempt** — descendants, leaves-without-evaluation, bidirectional contradicts | VERIFIED-live |
| Negation-as-failure (the case N2 used to reject OWL) | works in WOQL; **the formalism decision is empirically closed, not assumed** | VERIFIED-live |
| Time-travel | Evaluations `[]` at the seed commit, present at HEAD | VERIFIED-live |
| 12 concurrent writers, distinct docs, one branch | **12/12 succeeded, commits serialized** | VERIFIED-live |
| Footprint | 2.6 s cold start, 38 MB idle RSS, 9.7 MB on disk for ~5,500 docs | VERIFIED-live |
| Licensing | Apache-2.0 for 5½ years, no rug-pull signal; 6 open / 1,046 closed issues | VERIFIED-code |
| Ingest cost | ~5 developer-days; `PUT ?create=true` upsert verified idempotent | VERIFIED-live + estimate |

So the question is no longer *does it work*. It is **does it earn its
operational surface and its longevity risk, given that the fallback is files-only
and the whole thing is regenerable?** Four measurements, thresholds fixed now.

### K-3a — The port must be real, and files-only must ship first

- **Falsifier:** `grep -rn 'terminusdb\|:6363' ` over every code path in GP-1
  through GP-5 returns nothing. GP-2 (the gate) and GP-5 (the context builder)
  both run green with `GraphStore=files`.
- **Kill:** any TerminusDB dependency reaching GP-1..GP-5 is reverted on sight.
  This kills the *guardrail breach*, not the store.
- **Basis: structural, 0% FP.** The synthesis is explicit that GP-1..GP-5 never
  touch the store, and that this is what bounds the downside.

### K-3b — Re-materialisation must be demonstrated, not asserted

This is the criterion that actually enforces "never the system of record". A
rebuild path that is never exercised is a rebuild path that does not work.

- **Falsifier:** a timed **drop-and-rebuild** of the entire store from
  `events.jsonl` + `graph.json` + the per-lane `GraphUpdate` journals, followed
  by a diff proving equivalence with the dropped state. Run once per release,
  in CI if it fits the budget.
- **Threshold:** the rebuild completes, diffs clean, and finishes in **< 15
  minutes** at the release's actual corpus size.
- **Basis: judgement, anchored on measurement.** R8 measured bulk insert at
  **~1,070 docs/s** and 9.7 MB on disk for ~5,500 documents. A Foreman-scale
  rebuild should be minutes. 15 is my number, chosen wide.
- **Kill:** if the rebuild cannot be demonstrated end-to-end, then **the store is
  the system of record in practice regardless of what the design document says**,
  and GP-6 is reverted to files-only. No exceptions and no "we'll add the rebuild
  script later" — later is when the store has data nobody can reproduce.

### K-3c — The store must buy something files cannot, and that thing must be used

This is the sharpest one, and the honest reading of R8's own numbers is that the
store may not clear it at v0.2.9 scale.

The only capabilities TerminusDB provides that a files-only implementation
cannot are **time-travel** and **branch/diff/merge over the graph**. Everything
else — the three lineage queries, cross-run finding recurrence, negation — is a
scan over `worklog.jsonl` + `graph.json`. And R8's own latencies say the scan is
competitive: listing 5,058 `Attempt` documents took **202 ms**, and the WOQL
negation scan over 5,056 documents took **~230 ms**. A `jq` pass over a
comparably sized JSONL is in the same band.

- **Measurement 1 — usage:** count the time-travel queries and graph-diff queries
  actually issued during the release.
  **Threshold: if the count is zero, freeze GP-6.** You bought a versioned
  database and never versioned anything.
- **Measurement 2 — head-to-head on the queries the plane exists for:** the three
  cross-run architect questions ("which findings recur", "which spec patterns
  produce escaped defects", "what did we believe at round 3"), Arm A =
  TerminusDB, Arm B = files-only (jq/SQLite over `worklog.jsonl` + `graph.json`).
  **Threshold: if Arm B answers all three correctly within 2× Arm A's latency at
  the release's actual corpus size, freeze GP-6** and record the corpus size at
  which the question should be reopened.
- **Basis: judgement on the 2× band; measured on the latencies it is set
  against.** R8's numbers are what make 2× a plausible outcome rather than a
  rhetorical device.
- **Action on freeze:** the port stays, the ontology stays (it is store-agnostic
  and N2's schema work is not wasted), the adapter is shelved. This is a *freeze*,
  not a deletion — R8's capability findings remain valid and the decision is
  cheap to revisit when the corpus grows.
- **Note:** R8's own comparison ranks TerminusDB first "**only because versioning
  and ontology are weighted heavily. Drop those two and it falls behind Postgres
  and FalkorDB on every remaining axis, especially longevity.**" The census and
  Measurement 1 are precisely the tests of whether that weighting is deserved.

### K-3d — Longevity tripwires, pre-registered, checked at each release

R8's health data is the baseline. Each tripwire is a number, not a feeling.

| Tripwire | Threshold | Action |
|---|---|---|
| Commit cadence on `terminusdb/terminusdb` `main` | **< 50 commits in any rolling 6 months** | freeze; do not upgrade; schedule re-materialisation. Basis: the 2024 dormancy was **27 commits in a full year** with a **12½-month release gap** — that is the measured signature. |
| Maintainer concentration | one author still **> 90%** of commits **and** no second maintainer by v0.3.x | store surface does not expand; files-only stays warm. Basis: **793 of ~860** recent commits by one person (~93%); the founder last committed **2025-04-22**. |
| Adoption | npm `terminusdb` still **< 500 downloads/month** at v0.3.x | early-adopter status is permanent; budget for self-support. Basis: measured **105/month**; **no fork has more than 1 star**; no successor exists. 500 is a judgement call. |
| Licensing | **any** move off Apache-2.0, or any capability we depend on moving to Enterprise | immediate re-materialisation to files-only. Basis: perf headroom, RDF formats and Prometheus metrics are already Enterprise-gated, and there is **no pricing page in 296 pages**. |
| `/api/log` on any query path | **any occurrence** | kill on sight. Basis: measured **2.4 ms/commit, dead linear**, O(offset) paging (`count=500` → 1,172 ms; `start=400` → 442 ms). 10,000 commits ≈ 24 s. The fast version is literally the paywall. |

### K-3e — Operational tripwires from R8's measured footguns

All structural, all 0% FP by construction. R8's summary is the reason: **"the
dominant failure mode of this database is a silent empty result, not an error."**

- Every store wrapper normalises version references and **asserts non-empty**.
  Falsifier: a test that passes `branch:main` to the diff wrapper and asserts it
  *raises*. Basis: `branch:main` returns **`[]` with HTTP 200** — silently — and
  `branch:<id>` is exactly the format the `Terminusdb-Data-Version` *response
  header* returns. Compounded by WOQL's documented "single most common debugging
  issue", which is also a silent zero-binding result.
- **CAS header (`Terminusdb-Data-Version`) on every read-modify-write of a shared
  document.** Basis: 10 concurrent writers contending on one document all
  returned **HTTP 200 and the last writer silently won** — no conflict, no error.
  Same-branch contention is last-write-wins; conflict detection exists only at
  *merge*, between *branches*.
- Appends of distinct documents need no CAS (12/12 green), **but
  `TERMINUSDB_SERVER_WORKERS` is raised above its default of 8 before running
  ~10 lanes**, and independent lane work uses branch-per-lane + `/api/apply`.
- `Distinct` is mandatory around every `Path` query. Basis: query (a) returned
  **10 rows for 4 answers**, one per distinct path.
- Reify `MENTIONS` now and **plan reification for `SUPPORTS`/`CONTRADICTS`**,
  because TerminusDB is a document graph with **no edge properties**, and
  retrofitting reification after data exists is a `MoveClassProperty` plus a
  backfill.

### K-3f — My PM recommendation on sequencing

**Adopt-with-guardrails is the right verdict on the technology. I would still
defer GP-6 behind the census.**

The reasoning is not doubt about R8 — its evidence is the strongest in the
corpus, because it is the only lane that ran the thing. It is that the synthesis
itself establishes GP-1..GP-5 do not need the store, and explicitly grants that
"the architect may legitimately defer GP-6 behind the census with no change to
anything above it." Given that, the cost of deferring is approximately zero,
while the cost of adopting inside v0.2.9 is ~5 developer-days plus a permanent
operational surface plus a quarterly health obligation — spent *before* the
census has told us whether the cross-run query class is frequent enough to
justify it, and before K-3c Measurement 1 has told us whether anyone ever
issues a time-travel query.

**105 downloads a month is a real number and it deserves to be said plainly:**
adopting this store makes Foreman an early adopter of a bus-factor-1 database
with no community to ask. The guardrails make that survivable. They do not make
it free. Deferring one release costs nothing and buys the two numbers that decide
it.

**Decision requested:** land GP-6 as *port + files-only implementation only* in
v0.2.9, with the TerminusDB adapter specced and the schema frozen (that work is
store-agnostic and should not be lost), and gate the adapter on the census plus
K-3c. If the architect prefers to land the adapter now, K-3a–K-3e still apply
unchanged and K-3b is the one that must not be waived.

---

## K-4 — Vendor #4 (Gemini) as a *quality* lane

**The bet:** a fourth vendor makes the cross-vendor audit catch more.

**Measurement:** M5 unique-catch rate **per vendor pair**, computed on the Tier-1
replay corpus by swapping recorded auditor transcripts on the same diff — zero
new vendor spend.

- **Threshold, taken verbatim from R6 §6.1:** if gemini's unique-catch rate over
  the existing codex↔grok pair is **below ~5%**, "it is a cost/capability/
  availability lane, not a quality lane, and should be documented as such."
- **Basis: published.** R6 §6.1 states the 5% figure and the consequence.

**The evidence that makes this the expected outcome:**

- **Nine judges, two effective votes** (VERIFIED): 9 frontier LLMs across 7
  families behave as **~2 genuinely independent votes**; "roughly three-quarters
  of the panel's nominal independence is lost because the models make the same
  mistakes on the same items"; **individual top models matched or exceeded the
  full panel's accuracy**; the gap to the independent-voting ideal was **8–22 pp**
  and sophisticated aggregation closed **at most 11%** of it.
- **Behavioral entanglement** (VERIFIED): 18 LLMs across six families show
  "correlated reasoning patterns and synchronized failures" that "undermine
  systems relying on model independence, such as ensemble verification
  pipelines"; de-entangled reweighting buys **at most +4.5%** over majority vote.
- **The single most direct hit** (N4, Zietsman, VERIFIED): a cross-family panel
  of 4 models from 3 families, 5 runs each, on `validate_diagnosis_sequence`
  (ICD-10-CM V00-Y99) — **0/5, 0/5, 0/5, 0/5. 0/20.** "No model even approximated
  the rule." Cross-vendor diversity bought **nothing**; the BDD specification
  caught it every time. N4's conclusion: "**Diversity reduces correlation.
  Specification eliminates circularity. Both are required.**"

**Action if below 5%:** **keep gemini, delete the independence claim.** Gemini
has a genuine, different justification that survives all of the above: it closes
the documented routing hole where "if Codex implemented, do not use
codex-auditor" leaves a Grok+Codex race with **no cross-vendor auditor at all**
(R3 §0). That is a *coverage* argument, and it is sound. Every shipped doc must
say coverage, not independence (AC-12).

**The honest counterweight I owe the product owner:** R6 also notes that
Foreman's cold-diff audit is a *stronger* decorrelation mechanism than the setups
these papers audited, because the auditor sees the diff and the spec rather than
the implementer's trace — a different evidence set and a different role, which is
what Karpathy's own text says actually buys independence. That defends the
*existing pair*. It does not defend the *fourth vendor*.

---

## K-5 — Multi-agent orchestration itself (the honest null)

**The bet:** Foreman beats one strong model with host-side checks and a merge gate.

**Measurement:** a cost-matched single-agent arm on the Tier-2 canary — "one
strong model, one long-context session, host-side deterministic checks, and a
merge gate" — as a locked arm on the same locked spec set, at equal dollars.

- **Threshold:** if Foreman does not beat that arm by more than σ, the release
  **must publish the number in `ROADMAP.md`**, and no further multi-agent scope
  is added in v0.3.0/v0.4.0 until it does.
- **This is not a revert criterion.** Foreman is the product; the criterion is
  legibility, not deletion.
- **Realistic expectation for v0.2.9:** this arm will probably not be run inside
  the budget. **If it is not run, the criterion downgrades to "the arm exists in
  the harness, locked and unmeasured", and `ROADMAP.md` says so.** That is the
  honest version.

**Evidence:** *The Illusion of Multi-Agent Advantage* (VERIFIED): automatic MAS
"consistently underperform CoT-SC despite being **up to 10x more expensive**",
producing "architectural bloat that prioritizes superficial complexity which does
not translate into functional utility". The mitigation is real — the same paper
finds expert-architected MAS beats auto-MAS on both performance and
cost-efficiency, and Foreman is expert-architected. **But its methodological
charge lands on Foreman verbatim:** evaluations "mask critical architectural gaps
… by failing to account for the marginal utility of increased computational
cost", and **Foreman has never run a cost-matched single-agent baseline.**
Anthropic (VERIFIED): multi-agent uses **~15× more tokens**; "token usage by
itself explains **80% of the variance**"; the 90.2% win was on *research*, and
"most coding tasks involve fewer truly parallelizable tasks than research".

---

## K-6 — Symbolic verification as a blocking gate

**The bet:** graph/SHACL validation improves the merge gate.

**Pre-registered protocol, taken verbatim from N4 §9.1:** run every open-world
check in **shadow mode for 100 merges**, record the verdict alongside the
eventual human/merge outcome, and publish precision, recall and FP rate. Promote
to blocking only if measured precision clears a threshold **set in advance**.
N4's own anti-rule: "**Do not promote on vibes; the whole point of this lane is
that the promotion criterion should be a number.**"

- **Kill:** any check promoted to blocking whose FP rate is **not 0% by
  construction** is reverted to WARN, no discussion. The arithmetic: 93%
  precision × 40 merges/week ≈ **3 false blocks per week**, and "worse, it
  teaches the operator to bypass the gate."
- **Kill:** a SHACL engine dependency in v0.2.9. N4 §9.5 names this "a genuine
  fork in the road and should be decided explicitly, not by drift", and observes
  that a JSON-Schema-plus-scripts implementation of the same checks has "zero new
  runtime dependencies and zero engine-disagreement risk". The engine-brittleness
  number that decides it: engines that pass the official W3C SHACL Test Suite on
  synthetic data **fail on real data**, and a prior study found **41.1% of valid
  results classified as invalid** by one engine at scale.
- **Kill:** a learned surrogate anywhere inside a gate. "A 95%-accurate surrogate
  has a ~4–5% error rate in both directions, which puts it in the same reliability
  band as the LLM auditor it was supposed to discipline."

**The decoupling rule, and it is the most important sentence in N4 for this
release:** items G1–G6 and G9 "deliver most of the value of this lane and require
**no knowledge graph at all**… **If the graph plane slips, the gate improvements
should not slip with it.**" They are RA-15 / F3–F5, and they are ~15 lines of jq
plus a JSON side-file. Ship them regardless of every other kill in this section.

---

## K-7 — graphify as a concurrent write target

**Measurement:** R7's own named 20-minute follow-up — a two-process write race
against a scratch corpus.

- **Expected result, from code:** both writers grow the graph, both pass the
  shrink guard, and the second **silently discards the first's work with no
  warning at all**. On Windows there is no lock at all (`fcntl` absent →
  `yield True`).
- **Kill:** if the race loses nodes and Foreman cannot own the mutex in this
  release, then the graph plane is **single-writer-only** in v0.2.9 —
  `maintenance.sh` at merge cadence, never per-lane. No lane writes.
- **Kill:** if the ingest path cannot be proven to preserve the full provenance
  set, no ingest ships. `cypher.txt` emits **five values total** and drops the
  entire audit trail; the direct push drops hyperedges, drops all non-scalar
  attributes (notably `metadata`, on 472 of 3,579 nodes), and can **invert edge
  direction** on an undirected build. Push is **O(V+E) round trips** — 7,247
  sequential queries for the current graph, with no batching — so it "will not
  scale to a per-commit loop".

R7's own summary of the 24-bug corruption history is the argument in one line:
"the entire class is *silent* corruption of an incrementally-updated graph —
wrong direction, ghost duplicates, stale survivors, non-deterministic winners,
net-negative merges."

---

## K-8 — Round-mode default as the fix for the #1 failure class

**Measurement:** class-1 "background-and-stop" occurrences per 100 lane-starts,
before and after `durable.enabled = true`, over ≥ 30 lane-starts.

- **Baseline:** 11+ self-counted occurrences in `bugeventlog.md` across 3
  vendors' models, one of which "lands *on the task implementing its own fix*".
- **Threshold: judgement.** If occurrences per 100 lane-starts do not fall by
  **≥ 50%**, the structural fix is not structural and the design is reopened.
  I chose 50% and 30 lane-starts; neither number is in any source. They are
  fixed now so the result cannot be reinterpreted later.
- **Why a structural threshold at all:** the log states the prompt-based fix is
  dead — "Prompt discipline measurably does not fix this: the pattern survived
  direct, capitalized prohibitions in two different models."

---

## K-9 — The metrics themselves

**The bet:** the metric set in R6 §4 measures what we think it measures.

**Pre-registered gaming detector:** if **M1 (first-pass gate rate) rises while
median spec diff size falls, or while the architect-authored share of merged
lines rises**, the improvement is not real and is reported as gaming, not as
progress. Same rule for M3 falling while architect-authored share rises, and M6
falling while the count of rounds with zero post-merge exercise rises.

- **Owner:** an independent lane owns auditing the metric. R6 §7 Q10 asks the
  question and the release must answer it by naming someone.
- **Basis: published.** *Who Grades the Grader* (VERIFIED): evolved skills **did**
  game the rubric and an independent judge caught it; "removing anchor guards
  collapses the metric into a vacuous detector"; a "failure-expecting
  architecture is the right default".

---

# 5. Staged rollout

The point of staging is that **the release can stop at the end of any stage and
still be a coherent, taggable thing.** Each stage's gate is the acceptance test
for stopping there.

| Stage | Contents | Gate to exit | If we stop here, the release is… |
|---|---|---|---|
| **S0 — Make the signal real** | `crlf-extensionless-hardening` (extended to 33+ files per R5 §8.1), `lock-primitive-hardening`, `test-infrastructure-hardening` | RA-1, RA-2, RA-5, plus T1–T7 and L1–L7 | **"v0.2.9 — trustworthy test signal on WSL."** A defensible release on its own: the suite now means something, and the durable core's lock is proven rather than assumed. |
| **S1 — Ship the protections** | `wsl-launcher-shipped`, `wsl-tool-path-persistence`, `wsl-preflight`, `wsl-seam-doctrine`, `wsl-ci-parity` | RA-3, RA-4, W1–W8 | **"v0.2.9 — WSL compatibility"**, i.e. the release as originally scoped in `ROADMAP.md`. Coherent and complete. |
| **S2 — Telemetry** | GP-1 `work-plane-telemetry` (incl. `durable.enabled=true`) | RA-6, RA-7, RA-8, RA-13, E1–E10, and **K-8 instrumented** | **"v0.2.9 — WSL + the evaluation plane."** Nothing user-visible improves, and this is still the highest-value stage in the release, because every comparative claim downstream — including the one that decides the store — is blocked on it. |
| **S3 — Multi-vendor** | `vendor-adapter-contract` | RA-9..RA-12, V1–V10, and **K-4 evaluated** | **"v0.2.9 — WSL + multi-vendor."** Gemini ships at cap 1 with its independence claim either substantiated or deleted. Blocked on the `agy` re-derivation (§3.4 note). |
| **S4 — Workflow / gate** | GP-2 `audit-groundedness-gate` | RA-14..RA-16, F1–F9, and **K-8 evaluated** | **"v0.2.9 — WSL + multi-vendor + a gate that catches hallucinated findings."** This is my recommended stopping point if the budget is tight. Needs no graph and no store. |
| **S5a — Deterministic graph** | GP-3 `knowledge-plane-refresh` + GP-4 `work-dag-projection`; G-EXTRACT + G-DAG | RA-17..RA-20, X1–X8, D1–D7, and **K-7 evaluated** | **"…+ a deterministic work-lineage graph."** Zero-token, no LLM in the path, three queries that work, no store. |
| **S5b — Consumption** | GP-5 `graph-context-builder`; G-CONSUME, behind a config flag, default **off** | **K-1 measurements A and B both passed**, K-2 thresholds all clear | The context block ships only if it beats the prompt-only and lexical arms. Reads `graph.json` + `worklog.jsonl` directly — **does not depend on GP-6.** |
| **S5c — Store** | GP-6 `graph-store-port`: port + files-only first; TerminusDB adapter gated | S6–S13, **K-3a/b/e mandatory**, **K-3c decides the adapter** | The full stated scope. Independently killable from S5b in either direction. |

**Hard ordering constraints, from R5 §7.1's file-collision analysis:**

1. `crlf-extensionless-hardening` first — it touches only `.gitattributes` and
   index modes and unblocks everything on ext4.
2. `wsl-tool-path-persistence` lands the `env/tool-check.sh` refactor and the
   readiness-probe decoupling **before** the multi-vendor V2/V3/V10/V11 changes,
   so they apply on top of a settled file rather than racing it.
3. `wsl-preflight` lands **after** the vendor map changes, so the lane-start
   preflight is written once against the final 4-vendor readiness path.
4. `wsl-ci-parity` last within S1 — CI should assert the final surface.
5. `env/tool-check.sh` and `lane-run.sh` are the only three-way contended files.
   **Serialise those two. Everything else can fan out.**
6. Telemetry (S2) touches `lane-run.sh`, `gate-eval.sh` and `audit-run.sh`. It
   must land after S1's `lane-run.sh` work and before S3's, or it will conflict
   with both.
7. **S5b and S5c are independent of each other and must stay that way.** GP-5
   reads `graph.json` + `worklog.jsonl` directly, so killing the store does not
   kill the context builder, and killing the context builder does not kill the
   store. Any commit that couples them breaks K-3a and is reverted.

**What this ordering costs:** the graph plane is last, which means it is the part
most likely to be cut. That is the intent. It is also the part with the weakest
evidence, so the cut is aligned with the evidence rather than with convenience.
Note that the cut is now *granular*: S5a is deterministic and cheap, S5b is the
contested consumption bet, and S5c is the operational commitment. Three separate
decisions, three separate kill criteria, no all-or-nothing.

---

# 6. What we cannot measure yet

R6's finding is blunt and correct: **Foreman records no tokens, no cost, and no
model identity**, so the single number that would justify multi-vendor is
currently uncomputable. Here is the full blocked list.

| Metric / question | Why it is uncomputable today | What must ship | Unblocked at |
|---|---|---|---|
| **M5 — unique-catch rate of the cross-vendor auditor** | Findings are not first-class objects. `audit-verdict.json` and `gate-decision.json` are **files, never events**; neither `gate-eval.sh` nor `audit-run.sh` sources `lib/eventlog.sh`. | `payload.finding` events (E3), gate/audit emit (E6), replay corpus (T8) | **S2 + S3** |
| **M3 — cost per merged change (USD and tokens)** | `grep -rn 'token\|cost_usd\|usage' skills/foreman/scripts/` returns no accounting. | `payload.usage` (E1) | **S2** |
| **Which vendor produced an attempt** | There is **no `vendor` field on any event**. It is inferred from a path string in `ownership.payload.config_dir`. | `payload.vendor` (E4) | **S2** |
| **Which model / effort** | `WC_GROK_MODEL` / `WC_CODEX_MODEL` / `WC_CODEX_REASONING_EFFORT` are never logged. | `payload.usage.model/effort` (E1) | **S2** |
| **M4 — wall clock per phase** | `elapsed_s` exists only inside mirrored launcher heartbeats, and only in hard mode. | phase timestamps + rollup (E7) | **S2** |
| **Foreman's own run-to-run σ** | Never measured. **Every comparative claim in this document is blocked on it.** | E9 + a Tier-2 canary run | **S2** |
| **M6 — escaped-defect rate** | No detection window, no post-merge exercise record, no per-release bugevent linkage. | detection-window policy + linkage | **post-S2** |
| **M14 — prediction-hold rate** | No predicted-effect field exists on a spec. | F7 | **S4** |
| **Cost-matched single-agent baseline** | Never run. Requires M3 to be meaningful. | S2 + a locked Tier-2 arm | **post-S2, probably post-release** |
| **Graph query census (K-1 measurement A)** | Nobody logs architect retrieval queries. There is no instrumentation to census. | query logging (opt-in; graphify's own logging is off by default by design) | **S5a at the earliest** |
| **graphify per-commit AST update wall-clock** | R4 §11 Q6, verbatim: "I verified the design is LLM-free and change-scoped; **I did not measure wall-clock.** Needs one measurement before it goes in a commit hook." | one measurement | **S5a** |
| **graphify concurrent-write behaviour** | R7 §12: "the concurrency conclusion in §9.4 is **code-derived, not experimentally reproduced**." | K-7's 20-minute race | **S5a** |
| **Whether graphify can emit a directed multigraph** | R4 declares `--directed` mandatory; R7's verbatim CLI surface has no such flag on `update`/`extract`; the committed graph is `directed:false, multigraph:false`. Neither lane demonstrates it. **No longer blocks the store**, because R8 confirmed decision edges live as distinct document properties and the synthesis rules that they never round-trip through `graph.json`. It still blocks GP-3's `--directed` mandate. | X8, live | **GP-3** |
| **Tier-3 precision on Foreman data** | Unknown in both directions. N4: our graph "is sparse and young and 'no supporting path' will often mean 'we have not ingested it yet' rather than 'it is false'." | 100-merge shadow run | **post-release** |
| **Everything about the Gemini lane** | Worse than unmeasured: **measured against the wrong tool.** R3 characterised `@google/gemini-cli` 0.52.0; the mandated lane is `agy` 1.1.7 (synthesis §2.6). On top of that: not authenticated on the reference host, no T5b row, and the headless quota-exhaustion behaviour — R3's own "single most important thing to check" — is untested on either binary. | V0 (live re-derivation against agy) + R3 §7's five items | **S3, and it gates the package freeze** |
| **TerminusDB capability** | ~~Unevaluated~~ — **now measured.** R8 ran 12.0.6 live: ontology loaded, three lineage queries correct first-try, time-travel exact, 12/12 concurrent writers, 2.6 s / 38 MB / 9.7 MB footprint. | — | **answered** |
| **Whether TerminusDB earns its surface at our scale** | Unmeasured, and it is the live question. R8's own latencies (202 ms to list 5,058 docs; ~230 ms negation scan over 5,056) put a files-only `jq` scan in the same band. Nobody has counted how many time-travel or graph-diff queries Foreman would actually issue. | K-3c Measurements 1 and 2 | **S5b / GP-6** |
| **TerminusDB commit-log scaling past 478 commits** | R8's extrapolation to 10k/100k commits is a linear fit, explicitly marked INFERRED, not measured. | a dedicated test before commit volume grows | **GP-6** |
| **TerminusDB retry-exhaustion behaviour above 12-way concurrency** | Never triggered; the docs never state what the client sees when the 3 retries are exhausted. | a higher-concurrency run | **GP-6** |
| **TerminusDB cross-version store-directory compatibility** | `/api/info` reports `storage.version: "2"`; upgrade/downgrade rules are undocumented. This is what makes "pin the version and stop-and-tar" a criterion rather than advice. | a live upgrade test | **GP-6** |
| **TerminusDB community responsiveness** | R8 did not join the Discord, which is the only forum. "This is the biggest remaining gap in the health picture." With bus factor 1, response time *is* the support model. | one observation window | **before K-3d's v0.3.x re-check** |

**The ordering rule that follows, stated as a release policy:**

> **No criterion that requires a comparison may be accepted before S2 lands.**
> Until telemetry ships, every claim about whether v0.2.9 improved anything is
> an assertion, not a measurement — and the repo's own doctrine forbids that.

---

# 7. PM verdict — what I think is unjustified on the current evidence

The product owner chose a large scope deliberately. I am not arguing for less
scope; I am making the risk legible and attaching a decision to each item.

### 7.1 Strongly justified, ship it

**S0 and S1 in full.** The WSL work, the lock primitive, and the test
infrastructure are the only parts of this release whose value does not depend on
any contested claim. The lock finding in particular is a genuine correctness bug
in the durable-lanes core with a measured 57-vs-0 result and a clean mechanism,
discovered *outside* a lane during bring-up. Everything else in the release is
built on top of a primitive that does not currently provide mutual exclusion.

**Telemetry (S2).** It is the least glamorous item and the highest-leverage one.
It has no OpenSpec package yet. It should be written before anything in S3–S5
starts, because without it the release cannot make a single defensible claim
about itself — including the claim that multi-vendor was worth doing.

**The non-graph gate improvements (F3–F5 / G1–G6 / G9).** ~15 lines of jq and a
JSON side-file, 0% false-positive rate by construction, and they close a real
hole: `gate-eval.sh` currently accepts a `BLOCKED` verdict with no findings
without comment, and nothing checks that a finding points at a file in the diff.
N4 is explicit that these must not be coupled to the graph plane's fate.

### 7.2 Justified, but not for the stated reason

**Gemini.** The independence argument does not survive contact with the
evidence — nine frontier models across seven families are ~2 effective votes, and
a cross-family panel scored 0/20 on the one rule that mattered. The argument that
*does* survive is coverage: today, a Grok+Codex race has **no eligible
cross-vendor auditor**, because `audit-run.sh:35-37` refuses anything but codex
and doctrine forbids codex auditing codex. Gemini closes that hole. Ship it, at
cap 1, and rewrite every doc that says four vendors buy more independence.

**"Broaden GPT."** Justified as model + profile parameterisation of the codex
adapter. **Not** justified as a separate plain-GPT lane — that means writing and
maintaining our own Responses-API client, tool loop and file-write layer, and
losing the sandbox for free.

### 7.3 Unjustified on the current evidence — decisions requested

**(a) The knowledge plane.** This is the weakest-supported item in the release,
and the evidence against it comes from five independent lanes that were not
coordinating. Summarised: BM-25 beats all nine GraphRAG systems on True/False; a
bare LLM with no retrieval wins three of six question types; LightRAG burned
83.9M tokens to land below TF-IDF; a 2026 neurosymbolic pipeline scored 61.6% vs
its own 67.3% text-only baseline; a full-context baseline beat the memory system
in the vendor's own paper; HippoRAG 2 concedes graph-RAG drops below standard RAG
on basic factual memory; and Anthropic's own guidance is to skip retrieval
entirely under ~200k tokens, which is where Foreman's working set lives.
Meanwhile the *precedent* is thinner than the synthesis suggests: AgentHub is a
five-column table with no metric on the node, its URL is 404, and there is no
evidence the swarm ever ran.
**Decision requested:** ship S5a (the deterministic work-DAG) and put the
knowledge plane behind K-1, expecting to fail it. That is not pessimism — R4's
own ship gate says "we should expect to fail it for single-task context and pass
it only for cross-session and cross-lane questions."

**(b) TerminusDB — position changed, and the change is worth recording.** My
first draft called this "the one decision in the release with no evidence base at
all" and killed it by default. R8 landed afterwards and that judgement does not
survive it: the lane ran 12.0.6 in Docker, loaded the full 18-class ontology,
got all three lineage queries — including the negation query that closed the OWL
question — correct on the first attempt, verified time-travel, and put 12
concurrent writers through one branch cleanly, in a 38 MB container that starts
in 2.6 seconds. **The technology is not the objection any more.**

What survives is a *sequencing* objection, and it is narrower. One person wrote
~93% of the last year's commits, the founder left in April 2025, the project was
dormant for a 12½-month stretch in 2024, and the new v12 npm client does **105
downloads a month** with no fork above one star. The guardrails —
port, files-only fallback, documents-not-commits, regenerability — make that
survivable rather than reckless, and the synthesis is right that they bound the
failure to a re-materialisation. But the synthesis also establishes that
**GP-1 through GP-5 never touch the store**, which means deferring the adapter
costs essentially nothing, while adopting it now spends ~5 developer-days plus a
permanent operational surface before either of the two numbers that decide it
exists: the query census, and a count of how many time-travel or graph-diff
queries Foreman would actually issue (K-3c Measurement 1).
**Decision requested:** land GP-6 as port + files-only in v0.2.9, keep the schema
and adapter spec (both store-agnostic, neither wasted), and gate the adapter on
the census. If the architect lands the adapter anyway, K-3b — the demonstrated
drop-and-rebuild — is the one guardrail that must not be waived, because it is
the only thing that makes "never the system of record" a fact rather than a
sentence.

**(c) A SHACL engine in v0.2.9.** N4 names it a genuine fork in the road and
notes the JSON-Schema-plus-scripts alternative has zero new dependencies and zero
engine-disagreement risk — against a measured backdrop where engines passing the
W3C test suite fail on real data and one engine misclassified 41.1% of valid
results at scale.
**Decision requested:** JSON + jq for v0.2.9. Revisit when the graph plane has
earned its place.

**(d) Any process ceremony added to the worker's job.** "Write tests first",
"explain your reasoning", "self-review". Measured as ineffective (agent-generated
tests do not move outcomes across six strong models; the harness ablation found
gains came from tools, middleware and memory, **not** system prompts). If one is
proposed, it needs a measurement, not an argument.

### 7.4 The thing I would most want changed about this release

When I first wrote this section there was no OpenSpec package for telemetry and
three for the graph, and I called that backwards. **`GP-1 work-plane-telemetry`
is now planned** — `payload.usage`, per-finding events, vendor/model identity,
universal `payload.attempt`, and gate/audit events entering the event log — and
the synthesis lands it first, before every graph package. The gap is closing.

**The flag stays in the record anyway, because the ordering point is the whole
argument.** The graph plane's own kill criteria are uncomputable without
telemetry; so is the multi-vendor justification; so is every ratchet rule in this
document; so is K-3c, which decides the store. GP-1 is not a supporting package
for the graph plane — it is the package that makes the graph plane *falsifiable*,
and it should be treated as the release's spine rather than as its first
dependency. If the release ships nothing else after S1, it will still have
converted Foreman from a system that asserts things about itself into one that
can measure them, which is the precondition for every other bet on this list
being settleable at all.

---

## Appendix — the five questions this release must be able to answer at tag time

1. What did v0.2.9 cost, in dollars and tokens, per merged change? *(M3 — blocked on S2)*
2. What is our run-to-run σ? *(RA-8 — blocked on S2)*
3. What fraction of gate-blocking findings came only from the cross-vendor auditor, per vendor pair? *(M5 — blocked on S2+S3)*
4. Did class-1 "background-and-stop" occurrences fall after round-mode became the default? *(K-8)*
5. What fraction of our retrieval queries are genuinely multi-hop across runs? *(K-1 measurement A)*
6. How many time-travel or graph-diff queries did we actually issue — and can we rebuild the store from files in under 15 minutes? *(K-3c Measurement 1, K-3b)*

If the answer to any of these is a paragraph rather than a number, that item did
not ship — whatever the checkboxes say.

---

## Revision log

| Date | Change |
|---|---|
| 2026-07-28 | First issue, against R1–R7, N1–N4, F, `ROADMAP.md`, `bugeventlog.md`. |
| 2026-07-28 | **K-3 rewritten.** The first issue killed TerminusDB by default on the grounds that no lane had evaluated it. R8 landed after dispatch and measured it live; the premise was false. K-3 is now four measurements (port reality, demonstrated re-materialisation, marginal value over files-only, longevity tripwires) plus the operational footgun set. G-STORE's S1–S5 are recorded as answered; the gate moved to S6–S13, the guardrails. §7.3(b) reversed from "unjustified" to "justified technology, deferrable sequencing", with the reversal left visible. Staged rollout split S5 into S5a/S5b/S5c so the deterministic graph, the consumption bet and the store are three separate decisions. Owners remapped onto `SYNTHESIS.md` §5's GP-1..GP-7. Added the `agy`-vs-`gemini-cli` input defect (V0) flagged by the synthesis. Telemetry "backwards" flag retained, with GP-1's existence noted. |
