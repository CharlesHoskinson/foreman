# Foreman roadmap

Architect-maintained release roadmap. Each release links its design/plan docs;
per-lane raw reports live under `docs/research/`. Workflow failures that drive
enhancements are logged in `bugeventlog.md`.

## v0.1.0 — released 2026-07-15

Combined skill: soft/hard modes, five-part specs, cross-vendor lanes
(Grok implement / Codex Sol audit / Claude advisor), worktree fan-out,
docs gate, release-triggered maintenance. Tag `v0.1.0`.

## v0.2.0 — durable lanes (released 2026-07-17)

Crash-safe, observable agent rounds: append-only event log as source of truth,
git-plumbing checkpoints, NATS/JetStream one-way transport, stall watchdog,
resume-from-checkpoint.

- Spec: `docs/superpowers/specs/2026-07-15-durable-lanes-design.md`
- Plan: `docs/superpowers/plans/2026-07-15-durable-lanes.md`
- Status: shipped — T0-T7 + perf bundle (el-emit spawn reduction,
  test-harness fork-tax) merged; deferred merge gate closed green on main
  (full suite 127/127 + docs-check) at `f24057c`. Tag `v0.2.0` (Nightwatch).
  WATCH_VTICK and remaining perf items deferred to v0.2.5 by design.

## v0.2.5 — orchestration hardening (released 2026-07-18)

Eliminated the F1–F6 workflow failure classes (see `bugeventlog.md`) with
the primitives the orchestration deep-research report recommended, keeping
the event-log and checkpoint core: foreman-launch (Bun/Job Objects —
orphans impossible by construction, POSIX build from the same source),
pueue lane admission with per-vendor groups + the host-wide `gate` mutex
and a per-shell quote-preserving submit layer, round ownership (lane-run
--round: the daemon owns implement→gate→report→round_done; attempt-fresh
terminal predicate), event schema v2 (attempt entity, replay, atomic
compaction), VTICK injectable clock + the 10-state watch v2 (heartbeat
liveness, phase thresholds), vendor config isolation plumbing (normalized
vendor-home paths), merge-freshness gate + wt-merge/wt-cleanup repairs,
and the bounded auto-resume supervisor. Six prevention criteria proven
(SC-A live; SC-B..F by permanent tests) — see
`docs/notes/2026-07-18-v025-sc-proof.md`. Suite 127→245 tests; four
product defects caught pre-push by the gate discipline. Tag `v0.2.5` (Beacon).

Honest residuals: T5b real-vendor concurrency verdict UNVERIFIED (grok
CLI absent; caps stay grok=1 codex=1); `[audit.policy]` keys wired but
consumed only from v0.3.0; launcher-absent lanes outside auto-resume
scope; WATCH_VTICK's `bats --jobs` parallelism still deferred.

- Plan: `docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md`
  (as amended by the 2026-07-18 4-lens audit, recorded in the plan itself)
- Reference: `skills/foreman/references/orchestration-hardening.md`
- Depends on: v0.2.0. Feeds: v0.3.0 (adapters spawn via the launcher),
  v0.4.0 (schema v2 telemetry).

## v0.2.7.5 — usability: close the five not-usable-yet gaps (released 2026-07-18)

Convert v0.2.5's documented not-usable-yet capabilities into working ones and
reframe foreman around a three-stage lifecycle (Setup & Environment → Use →
Cleanup) that runs identically on Windows and WSL/Linux. Informed by seven
read-only research lanes (grok CLI, vendor concurrency, sandboxed-worker SOTA,
re-port + MCP schema, POSIX cascade parity w/ live WSL probes, worktree
guards, WSL reliability + deps). Nine OpenSpec packages — seven implemented,
two approved specs for the next release.

- **Implemented:** lifecycle-three-stage (Setup/Use/Cleanup; all model auth
  moves into Setup — never mid-Use; foundational), grok-lane-activation (grok
  verified live end-to-end during planning — Grok Build 0.2.103, signed in),
  t5b-concurrency-verdict, posix-cascade-parity (pidns-init = the
  KILL_ON_JOB_CLOSE analog, probed working on WSL), worktree-hardening (the
  operator's stalls/git-issues guard bundle), wsl-reliability-env-refresh
  (full WSL setup — co-equal Linux target; fixes 2 live bugs; Bun held at
  1.3.14), docs-readme-refresh (README/USAGE/CLAUDE.md brought to the shipped
  surface + a prose pass; sequenced last). Shipped: full suite 245 → 359
  green; tag `v0.2.7.5`.
- **Approved specs (next release):** hard-mode-launcher (worker-run/pr-open on
  the launcher + devcontainer/egress-firewall), v030-soft-mode-report (v0.3.0
  re-port via per-commit `git am -3` onto soft-mode — architect decision).
  These two stay active under `openspec/changes/` (not archived).
- **Honest residuals:** T5b destructive concurrency verdict UNVERIFIED —
  isolated per-lane auth staging was blocked in the build env and no
  lower-tier key was available; the harness enforces all four abort monitors
  and vendor caps stay at 1 until a future session with destructive-auth
  permission (or a scoped key) runs it green. wt-cleanup's grandchild reap is
  best-effort on MSYS/Git-Bash (neither `taskkill //T` nor a POSIX pgid
  reaches a plain bash-forked grandchild — a Cygwin limit, documented). The
  prose pass used `russellian-style`: the requested `blader/humanizer` plugin
  was not installed in the build env (a one-command follow-up:
  `/plugin marketplace add blader/humanizer`).
- Execution: Sonnet 5 implements, Opus 4.8 audits (explicit pin this release).
- Design: `docs/superpowers/specs/2026-07-18-v0275-usability-design.md`
- Packages: `openspec/changes/{lifecycle-three-stage,grok-lane-activation,
  t5b-concurrency-verdict,posix-cascade-parity,worktree-hardening,
  wsl-reliability-env-refresh,docs-readme-refresh,hard-mode-launcher,
  v030-soft-mode-report}/`
- Depends on: v0.2.5. Feeds: v0.3.0 (session transport re-port + POSIX/WSL
  foundation).

## v0.2.8 — vendor concurrency + hard mode (released 2026-07-19)

Closes the last two v0.2.7.5 "not-usable-yet" residuals.

- **T5b destructive concurrency verdict — GREEN (live, user-authorized
  shared-account run).** grok GREEN at N=2 and N=3, codex GREEN at N=2. Pueue
  caps raised to the proven-green N: **grok 1→3, codex 1→2**; grok promoted to a
  verified default-eligible implementer. Rows in
  `docs/research/vendor-concurrency-results.md`; doctrine reconciled across
  README/SKILL/lanes/orchestration-hardening/CLAUDE.
- **hard-mode-launcher shipped** (`worker-run.sh` + `pr-open.sh`, both formerly
  stubs). Two profiles selected by `hard_mode.profile` (default launcher-only):
  launcher-only (foreman-launch supervision, clean-slate env, host-side
  evidence and commit, worker never commits) and container (clean `git archive`
  file-copy
  work dir; hardened devcontainer on an egress-capable bridge with a root-applied
  default-deny firewall — IPv4 + IPv6 — that a `gosu`-dropped unprivileged worker
  cannot flush; `--read-only` + tmpfs; no docker.sock, no host secrets;
  delete-aware sync-back). `pr-open`: gate precondition → HTTPS `GIT_ASKPASS` push
  with a fine-grained single-repo PAT → `gh pr create --draft`. Plan survived 3
  Opus audit rounds; each of 3 implementation lanes Sonnet-implemented +
  Opus-audited + architect-verified; **container proven live on WSL docker
  29.6.2** (firewall default-deny v4+v6, unprivileged worker, writable HOME under
  read-only, github allowed / non-allowlisted host blocked).
- **Honest residuals:** the container LIVE bats test skips where Docker is not on
  the (Git-Bash) PATH — proven manually on WSL; a full in-container worker E2E
  needs vendor auth inside the container (API-key mode). codex proven at N=2
  (cap 2); N=3 unrun. **grok must be on PATH** for grok lanes (installed at
  `/c/root/.local`, not on the default inherited PATH — a Setup-stage concern);
  the `lane-run` grok Use-path readiness gate runs a network-flaky `timeout 10
  grok models` probe, so the grok-lane / vendor-isolation unit tests are coupled
  to live grok readiness (a robustness follow-up: stub the probe in those unit
  tests; have `foreman-setup` persist grok on PATH).
- Execution: Sonnet 5 implements, Opus 4.8 audits.
- Packages: `openspec/changes/archive/.../hard-mode-launcher/`.
- Depends on: v0.2.7.5 (worktree-hardening + posix-cascade-parity). Feeds: v0.3.0.

## v0.2.8.1 — field-failure fixes (released 2026-07-19)

Fixes the four failures from the first real EXTERNAL run (a Midnight target),
logged in `bugeventlog.md` (`d359b49`), deep-debugged and fixed via the
`superpowers` brainstorm → plan → subagent-execute flow (design +
plan in `docs/superpowers/`).

- **install.ps1 Windows link** — was `cmd /c mklink /J` (PowerShell parse-fragile;
  aborted a real Windows install). Now native `New-Item -ItemType Junction`, plus a
  `windows-latest` CI smoke test (`.github/workflows/windows-smoke.yml`).
- **grok `--prompt-file` empty-burst** — single-burst grok can spend the burst
  orienting and write nothing on exploration-heavy specs. Added write-first
  doctrine (spec's first action must be a Write, API facts inlined), an
  empty-burst-vs-cancelled-writes distinction, and `grok-multiround.sh` — a bounded
  re-prompt loop that feeds forward "wrote nothing; Write now" until files change or
  the round budget is spent (then a loud EMPTY-BURST FAILED).
- **codex headless auth** — `codex login --device-auth` (0.144.x) falls back to a
  localhost browser flow that dies on detach. Documented the headless path
  (`printenv OPENAI_API_KEY | codex login --with-api-key`) and that interactive login
  is operator-run (`! codex login`).
- **worktree unfit for a stateful/live target** — added `soft_mode.target=live`
  config key + a `wt-new` guard (resolved against the CALLER's git-root) that refuses
  to cut a worktree for live targets, plus the stateful/live-target profile doctrine
  (no worktree; grok in the working checkout; architect verifies against live services).
- **Execution:** Sonnet 5 implemented (3 lanes), Opus 4.8 audited — the final review
  caught a BLOCKING config-resolution bug in the wt-new guard (it read the foreman
  skill's OWN config, not the target repo's — the exact external-target case), now
  fixed and regression-guarded.
- **Residuals (documented future options, not built):** grok true multi-turn via
  `grok agent stdio`; the optional `.foreman/live-target.toml` preflight-WARN.
- Depends on: v0.2.8.

## v0.2.9 — Total GeorgeCall — graph engineering, multi-vendor, and an interpretable suite (PLANNED)

![Total GeorgeCall](assets/v029-total-georgecall.png)

Codename **Total GeorgeCall**, following `v0.2.0` (Nightwatch) and `v0.2.5`
(Beacon). The release art is committed at
`assets/v029-total-georgecall.png`.

The largest release so far, and deliberately so: WSL compatibility, a fourth
vendor lane, a two-plane graph, workflow fixes driven by `bugeventlog.md`, and a
test suite whose result can actually be believed. Planned from twelve parallel
deep-research lanes (eight external via scrapling, four on the neurosymbolic
literature) plus a Fable synthesis and a product-manager acceptance pass, all
under `docs/research/vnext/`.

**The reframe.** v0.2.9 was originally scoped as WSL compatibility alone. A
fresh WSL clone during planning showed that work had largely already been done —
`bootstrap-wsl.sh --profile full` came up clean on all 20 tools — leaving two
real defects (the unbuilt POSIX launcher, and an exec-bit problem that is 33
files rather than the 3 the original plan scoped). The WSL packages therefore
survive as a hygiene tranche inside a much larger release.

### The blocker found during planning

`lock-primitive-hardening` (**P0, lands first**). Every lock in the durable core
is a `mkdir` mutex, justified in-code by "mkdir is atomic on Git Bash and WSL".
On Ubuntu 26.04 that premise is false: the distro ships a hybrid coreutils where
`mkdir`, `stat`, `date`, `sort` and `ln` are uutils (Rust) 0.8.0 while `mv` and
`rm` are GNU 9.7. Measured on the reference box with 8 racers contending on one
lock: **uutils 57 mutual-exclusion violations / 15 rounds, GNU 0**. `strace`
isolates the mechanism — uutils does a `statx()` existence check and never
issues `mkdir(2)`, a textbook TOCTOU, where GNU takes `EEXIST` from the kernel.
The blast radius is `el_emit`'s `.seq.lock`, which allocates sequence numbers
for the event log that the durable design calls the source of truth. `flock` was
measured as the replacement before being specified: **0 violations on ext4,
tmpfs and drvfs**. Full evidence: `docs/research/vnext/F-uutils-mkdir-blocker.md`.

### The architecture — two planes, two write disciplines

Settled in `docs/research/vnext/SYNTHESIS.md`, which resolves four live
disagreements between lanes rather than averaging them:

- **The work-DAG is a deterministic projection of the event log.** No LLM ever
  writes it and it never passes through graphify. `events.jsonl` is already the
  lineage store; measured ontology-learning competence collapses up the layer
  cake (taxonomy F1 0.02-0.66, axioms 0.03-0.36), so LLM-authored structure is
  not an option.
- **The knowledge plane is graphify's, on two cadences** — AST-only per merge
  (measured zero tokens), semantic extraction and clustering on a slow cadence.
  No LLM in the per-commit path, ever.
- **TerminusDB is a regenerable materialisation behind a `GraphStore` port with
  a files-only fallback — never the system of record.** GP-1 through GP-5 carry
  no store dependency at all, so if the store is deferred or the project dies,
  the plane loses time-travel and cross-run query ergonomics — not the gate, not
  the context, not the record.
- **Closed-world document schema; OWL rejected** — 10 of 24 competency questions
  require negation-as-failure. Confirmed live: the draft 18-class ontology
  loaded into TerminusDB 12.0.6 and all three lineage queries, including the
  negation query, ran correct on first attempt.
- **Consumption is a pre-serialized, content-hashed, token-budgeted context
  block, not agentic traversal** — measured at 89.80 vs 82.6 for traversal at
  one-sixth to one-eighth the LLM calls, and it is the only design where the
  audit trail can prove what the worker saw.
- **Only closed-world checks block the gate.** Open-world grounding runs at
  88-94% precision, which is ruinous as a blocking gate at merge volume.

### Packages

Twenty-six change packages across ten stages; full contention analysis and
serialisation rule in `docs/research/vnext/LANDING-ORDER.md`.

| Stage | Packages |
|---|---|
| S0 | archive `test-harness-fork-tax`, `el-emit-spawn-reduction` (stale — merged in v0.2.0) |
| S1 | `crlf-extensionless-hardening` (widened to 33 files), `lock-primitive-hardening` |
| S2 | `test-infrastructure-hardening` |
| S3 | `wsl-launcher-shipped`, `wsl-tool-path-persistence`, `wsl-preflight`, `wsl-seam-doctrine` |
| S4 | `decision-lineage-and-telemetry`, `three-outcome-verdicts`, `round-ownership-default`, `doctrine-reality-drift` |
| S5 | `vendor-preflight`, `vendor-adapter-contract`, `agy-lane-activation`, `cross-vendor-audit-routing`, `vendor-concurrency-and-quota` |
| S6 | `knowledge-plane-refresh`, `work-dag-projection`, `audit-groundedness-gate` |
| S7 | `graph-context-builder` |
| S8 | `graph-store-port`, `terminusdb-schema`, `terminusdb-adapter`, `terminusdb-operations`, `graph-eval-falsification` |
| S9 | `wsl-ci-parity` |

`env/tool-check.sh` and `lane-run.sh` are each claimed by eight packages, and
`config/foreman.toml` by six. Within S3, S4 and S5, packages touching the same
file land **serially, not in parallel worktrees** — bugeventlog `:479-496`
records what happens otherwise.

### What this release bets, and how it can be proven wrong

The research was instructed to hunt disconfirming evidence, and it found some.
Recorded here because a roadmap that only lists reasons to proceed is not a
roadmap:

- Nine frontier LLMs across seven families collapse to **~2 effective
  independent votes**. The independence argument justifies about two vendors,
  not four — so the fourth lane ships as **routing coverage** (it closes the
  hole where codex-implemented work had no cross-vendor auditor), and every
  independence claim waits on a measured per-pair unique-catch rate.
- On GraphRAG-Bench, **BM-25 beats all nine GraphRAG systems** on True/False,
  and LightRAG spent 83.9M tokens to score below TF-IDF. The graph plane is
  therefore never sold as retrieval accuracy or hallucination reduction; the bet
  is cross-session provenance queries and 0%-FP deterministic gate checks.
- An assembled neurosymbolic pipeline scored **61.6% against its own text-only
  baseline at 67.3%** — named in the synthesis as the default failure mode of
  exactly this architecture.
- TerminusDB has **bus-factor 1** (one author wrote ~93% of the last year's
  commits), already went dormant once for 12½ months, and sits at 105 npm
  downloads/month.

`graph-eval-falsification` carries ten pre-registered kill criteria, each with a
threshold and one action, registered before the measurement runs. The spec
forbids using any unregistered criterion to justify keeping the plane, and
requires the report to publish on a negative verdict with an executable
off-switch.

**The hinge is telemetry, not the graph.** Foreman today records no tokens, no
cost and no model identity, and `gate-eval.sh`/`audit-run.sh` never call
`el_emit` — so verdicts live outside the lineage store and none of this
release's comparative claims are currently computable. `decision-lineage-and-telemetry`
lands in S4 and is the release's spine: no criterion requiring a comparison may
be accepted before it, and Foreman's own σ must be published before any
difference is called an improvement.

### Checker soundness — the workstream this release earned the hard way

The test-infrastructure thesis began as an argument from research: seeded
regressions move an aggregate by only -1.7 to -5.9 pp while the owning slice
drops -25 to -91 pp, so an aggregate pass rate cannot see a subsystem break.
During planning it stopped being an argument. **Four checks in a single session
returned a confident wrong answer, from four different actors:**

1. An audit lane whose success predicate was the process exit code: it exited 0,
   announced its report was "ready for its required final repository write", and
   had written nothing — having run its own existence check and seen the file
   absent.
2. A pass/fail predicate of `grep "violation"`, which matches the success string
   `[ok] No violation found`. Every run reported as failed, including the
   controls, briefly appearing to show the lock fix failing.
3. An invariant (`rework_rounds_bounded`) that is **trivially true in exactly the
   scenario it was meant to detect**, because the counter it constrains never
   advances in that failure. It inverted the reported conclusion; the correct
   property violates.
4. A model checked against the wrong module's step function, returning a vacuous
   "safe".

**None was caught by the check itself.** Each was caught by cross-checking an
independent result. This is a distinct class from the one the harness already
addresses: a test that never fires is silent, whereas **a checker whose predicate
does not match its claim passes loudly**, and a loud pass is trusted.

The workstream therefore requires: every gate, probe and assertion introduced by
this release SHALL be demonstrated to FAIL against a known-bad input before it is
trusted; success predicates SHALL bind to artifacts and content, never to exit
codes, substring matches, or an agent's own account of its state; invariants that
hold vacuously SHALL be reported as vacuous rather than passing; and any result
that would change a release decision SHALL be corroborated by an independent
check using a different predicate.

- Packages: `test-infrastructure-hardening` (extended), `formal-model-suite`,
  `regression-harness-tiers`, `release-metrics`, `evidence-contracts`.

### Formal models — three subsystems, seven defects

Four Quint models were built against the shipped code and every result re-run
by the architect. Two of the three reproduce a defect that was already measured
in the field, which is what makes them trustworthy; the third reproduces one
found only by modelling.

| Model | Pre-fix | Post-fix | Method |
|---|---|---|---|
| `eventlog_concurrency` | VIOLATED x2 | holds x2 | 20k samples + Apalache 8 |
| `audit_gate` | VIOLATED x2 | holds x2 | Apalache 1-10 |
| `lane_lifecycle` | VIOLATED x2 | holds | Apalache 12 |
| `evidence_contract` | VIOLATED x3 | holds | 15k samples |

The concurrency counterexample is `seqHolders: Set(0, 1)` — the exact state
measured live in the uutils `mkdir` finding, derived independently from the code.

**Seven defects surfaced that no review lane found, each verified by the
architect against the shipped source:**

- The structural fix for failure class #1 **holds only until the first
  auto-resume**: `lane-supervise.sh:343-345` re-dispatches in PLAIN mode because
  `GATE_CMD`/`REPORT_PATH` are recorded in no event payload. The supervisor
  reopens the attractor it exists to recover from.
- **`three-outcome-verdicts` binds only one of three gate inputs.**
  `gate-eval.sh` also gates on `checks-result.json` and `docs-check.json`,
  binding neither — and `checks-run.sh:41` already writes a `sha` the gate never
  reads.
- **UNVERIFIED admits non-termination**: it consumes no rework round, so
  `max_rework_rounds` cannot bound an infra-failure loop. A separate
  `max_audit_attempts` is required.
- **`lock-primitive-hardening` does not reach the worst call site**:
  `wt-new.sh:203` **fails open** after 30s and proceeds unsynchronised, so
  mutual exclusion breaks even with an atomic `mkdir`.
- `el_compact` can overwrite `events.jsonl` with a pre-append snapshot, silently
  losing a committed event from the source of truth.
- `.nats-bridge.lock` has no reclamation path.
- The gate-to-merge TOCTOU survives the verdict fix, and `WARNING` silently
  authorises merge.

- Models and evidence: `formal/specs/*.qnt`, `formal/reports/`
  (`VERIFY-quint-architect.md` records every re-run, including two corrections
  to the architect's own earlier claims).
- Honest limit: these are bounded (Apalache depths 8-12) and sampled (20k
  traces) results. They establish reachability and absence-within-depth, not
  unbounded correctness.

### Live defects found while planning (not from a lane)

- `durable.enabled` is not merely false, it is **inert** — `DURABLE_ENABLED`
  appears twice in the codebase, both in `lib/config.sh`, read by nothing.
  Flipping the default alone is a null change.
- `gate-eval.sh` reads `audit-verdict.json` with **no freshness check**, while
  `audit-run.sh` dies on five paths without writing it and nothing deletes the
  stale file — so a failed re-audit leaves the previous round's `APPROVED`
  gating a reworked diff. Fixed by binding evidence to the diff content hash.
- A verdict of `APPROVED` alongside a `critical` finding passes the gate today.
- The exec-bit defect is 33 files, not 3; `install.sh:61-63` chmods them in the
  working tree, leaving every installed clone permanently dirty and poisoning
  the dirty-guards in `wt-cleanup`/`resume`/`wt-merge` when running Foreman on
  Foreman.
- All sixteen pre-existing OpenSpec packages **fail `openspec validate`** while
  `openspec/README.md` claims the repo follows OpenSpec conventions. The
  packages authored for this release are the first that validate strict.

### Honest residuals

- The baseline suite on a fresh WSL clone is **373 pass / 9 fail**, and only two
  of the nine were product defects. Two (`#138 kill_cmd_bounded`, `#343`
  container hardened-run) remain untriaged and are carried as open items rather
  than assumed benign.
- `agy`'s per-lane isolation is unsolved: `GEMINI_CLI_HOME` is a no-op, and
  relocating `HOME` moves all state except the OAuth token, so an isolated home
  is credential-less. The spec's fallback is a shared home at cap 1 rather than
  a leaky credential seed.
- Audit latency (chronic 24-27 min) is **bounded and measured here, not solved**
  — effort tiering, sharding, bundles and session reuse stay with v0.4.0.
- **The store question is decided: TerminusDB ships.** The product owner chose
  adoption over the PM lane's recommendation to defer the adapter behind the
  query census. That reasoning is preserved in `PM-acceptance-criteria.md`
  K-3f, and every guardrail it argued for is kept: the `GraphStore` port
  stays, the files-only implementation stays and runs in CI, GP-1 through
  GP-5 carry no store dependency, and the timed drop-and-rebuild remains a
  per-release gate. Adoption changes which implementation is default, not
  whether the plane can survive without one.
- The longevity risk is accepted, not resolved: bus-factor 1, a prior
  12.5-month dormancy, and 105 npm downloads/month.
  `terminusdb-operations` carries the named tripwires and a rehearsed exit
  path back to files-only.
- `audit-groundedness-gate` remains independent of the store either way — its
  first five checks need no graph at all and catch a failure class nothing
  catches today.

- Research: `docs/research/vnext/` (12 lane reports, `SYNTHESIS.md`,
  `PM-acceptance-criteria.md`, `LANDING-ORDER.md`, `F-uutils-mkdir-blocker.md`)
- Tag on release: `v0.2.9` (Total GeorgeCall).
- Depends on: v0.2.8.1. Feeds: v0.3.0 (session transport), v0.4.0 (fast audit).

## v0.3.0 — session transport (remote branch `dev/foreman-v1`)

Subscription-session workers (zero API keys): codex mcp-server threadId
continuity, Claude `-p/--resume`, Grok headless login auth; model-family
decorrelation; cockpit viewers. Implemented remotely.

- Spec/plan: on the branch (`docs: design spec for session transport`,
  `docs: session transport implementation plan`)
- **Reviewed 2026-07-16 (Codex GPT-5.6 Sol): BLOCKED for direct merge** —
  full report: `docs/research/v030-review/codex-review.md`. Engineering
  quality is good (fail-closed MCP parsing, correct process-group reaping,
  honest security posture, no bats regressions); blockers are structural:
  1. The branch shares NO git ancestry with main (parallel 55-commit
     history), and main has evolved past the architecture the series splices
     into (main's `worker-run.sh` is a stub, no `adapters/` dir, divergent
     `lib/common.sh`). Cherry-pick/`git am` will fail or silently resurrect a
     deprecated hard-mode architecture. Required: deliberate file-by-file
     content-diff re-port onto main's current soft-mode shape — an architect
     decision (revive hard mode vs port into soft-mode path) with advisor
     consult before starting.
  2. The plan's own live-acceptance step (Task 11, `docs/demo-log.md`) was
     never executed — the real `codex mcp-server` tool schema used by
     `adapters/codex.sh` is unverified against a live install; all 46 plan
     checkboxes are unchecked.
- Landing order: after v0.2.0 tags; before v0.4.0's session-reuse tasks (T7).

## v0.4.0 — fast audit (planned 2026-07-16)

Cut audit wall-clock from 27-35 min to <10 min median without losing
cross-vendor rigor. Three-lane planning fan-out complete (search / plan /
scrapling-backed research); architecture: tiered screen→deep audit with an
always-deep floor, sharded parallel audit + mandatory structural pass above a
file threshold, incremental checkpoint-stream audit (flagship, builds on
v0.2.0), audit bundle pre-packaging (no auditor recon), hunk-hash verdict
cache for scoped re-audits, session-thread reuse (builds on v0.3.0), and a
config-driven risk-class → (model, effort, scope) routing table. The
vendor≠worker invariant is centralized in one shared `lib/audit-call.sh` and
enforced at every tier. Verdict schema v2 is additive; `gate-eval.sh`
dual-reads v1/v2 during migration.

Measured levers behind the target (see research citations): effort xhigh→high
(largest single win), parallel shard+consolidate, pre-packaged context
(~19% of Codex wall time is harness/tool-call residual), schema-constrained
terse output, thread reuse + cache-stable prefixes. Combined sanity math:
4-6x → 5-9 min typical.

- Task breakdown (T0-T12): `docs/research/v040/plan-report.md`
- Audit-path map: `docs/research/v040/search-report.md`
- External research: `docs/research/v040/research-summary.md` (+ citations in
  `research-citations.md`)
- Ordering constraint: `audit-run.sh` is owned serially by T3 → T8 → T9.
- Open questions for the architect are listed at the end of the plan report;
  advisor consult on final scope happens before implementation starts.
- Depends on: v0.2.0 (checkpoint stream), v0.3.0 (session transport).

## Later / unscheduled

- tool-check portability: Git Bash-aware Windows probes (WSL CRLF failure is
  fixed by v0.2.5's .gitattributes task).
- (wt-merge gitignore fix and verdict-to-action gate policy moved into
  v0.2.5 Tasks 6–7.)
