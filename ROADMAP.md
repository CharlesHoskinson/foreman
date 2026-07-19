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
