# Foreman workflow bug/event log

Append-only log of workflow failures, friction, and near-misses observed while
running Foreman, so recurring patterns can be studied and the workflow enhanced.
Format per entry: date, phase, what happened, evidence, root cause, impact,
proposed enhancement. Newest at the bottom.

---

## 2026-07-16 — tool-check.sh unrunnable from WSL on a CRLF checkout

- **Phase:** session startup, environment inventory
- **What happened:** `wsl bash env/tool-check.sh --profile durable` failed at
  line 4 with `set: pipefail: invalid option name`.
- **Evidence:** reproduced twice (plain and `bash -lc` invocations) against
  `/mnt/c/Users/charl/foreman`.
- **Root cause:** the Windows checkout has CRLF line endings (core.autocrlf);
  WSL bash parses `set -euo pipefail\r` and rejects `pipefail\r`. Git Bash
  tolerates CRLF in scripts; WSL bash does not.
- **Impact:** the WSL half of the reference-environment inventory is unusable
  from a Windows checkout; architect fell back to manual `command -v` probes.
- **Proposed enhancement:** ship `.gitattributes` forcing `*.sh text eol=lf`
  (and re-normalize), or have tool-check.sh self-heal (`sed -i 's/\r$//'` a
  temp copy) — plus a documented note in reference-environment.md.

## 2026-07-16 — tool-check.ps1 durable profile reports coreutils missing despite Git Bash stdbuf

- **Phase:** environment inventory
- **What happened:** `tool-check.ps1 -Profile durable` returned `READY: no`,
  `must_fail: coreutils:missing`, while `/usr/bin/stdbuf` exists and works in
  Git Bash (where the durable scripts actually run).
- **Root cause:** the PowerShell checker probes the Windows PATH only; the
  durable toolchain executes under Git Bash whose /usr/bin is not on the
  Windows PATH.
- **Impact:** false NOT-READY gate; architect had to override with manual
  verification. A stricter session could have triggered an unnecessary
  bootstrap install.
- **Proposed enhancement:** for tools whose runtime is Git Bash, tool-check.ps1
  should probe via `bash -lc 'command -v <tool>'` instead of Get-Command.

## 2026-07-16 — implementer lane died to a mid-response API server error with zero progress signal

- **Phase:** Round A rework dispatch (grok-implementer subagent)
- **What happened:** the rework agent was killed by "API Error: Server error
  mid-response" seconds after starting ("Now writing the spec file for Grok");
  nothing had been written to the worktree. No liveness signal existed between
  dispatch and the failure notification.
- **Impact:** wall-clock loss only (the lane had produced nothing), but the
  failure mode generalizes: a lane dying 25 minutes into implementation would
  lose everything since dispatch. User: "we have to solve this liveness
  problem. See all the wasted work."
- **Proposed enhancement:** (a) session-level: arm a stall watchdog Monitor per
  background lane at dispatch (now standing practice + memory); (b) structural:
  durable-lanes T3/T5/T6 (lane-run heartbeats + checkpoints, watch.sh
  escalation, resume.sh restart-from-checkpoint) — in flight as Rounds B/C.

## 2026-07-16 — Grok CLI 600s subprocess timeout swallowed the worker's closing message

- **Phase:** Round A implementation (grok-implementer)
- **What happened:** the grok subprocess hit the 600s timeout before flushing
  its final summary; all edits and verification had completed, so the round
  succeeded, but the worker's own report of what it did was lost.
- **Impact:** benign this time (wrapper agent reconstructed the report from
  transcript fragments + independent verification), but a timeout landing
  mid-edit instead of mid-summary would be worse.
- **Proposed enhancement:** lane-run.sh (T3) stream-tees stdout continuously so
  a timeout never destroys evidence; consider making the wrapper's subprocess
  timeout configurable per round size.

## 2026-07-16 — audit wall-clock serializes every merge (27 min full, 24 min scoped)

- **Phase:** Round A audit + re-audit (codex-auditor, GPT-5.6 Sol high)
- **What happened:** full audit of a 208-line lib diff took ~27 min; even the
  scoped 5-finding re-audit took ~24 min. Both verdicts were valuable (2 real
  high findings, then a corroborated clean resolution check), but every merge
  gate pays the full latency serially.
- **Impact:** the audit lane is the critical path of every round; user demanded
  a structural fix ("we can't have these 35 minute stalls").
- **Proposed enhancement:** release v0.4.0 (planning in flight): effort tiering
  (xhigh→high measured as the single biggest lever), sharded parallel audit +
  consolidation, pre-packaged audit bundles (no auditor repo recon),
  hunk-hash-scoped re-audits, session/thread reuse (v0.3.0 transport).

## 2026-07-16 — file-mtime stall watchdogs false-alarm on read-heavy and completed lanes

- **Phase:** session-level liveness monitoring (Monitor tool)
- **What happened:** (a) the Round A rework lane tripped STALL after 8 quiet
  minutes, then RECOVERED — the quiet stretch was legitimate reasoning +
  verification; (b) the v0.4.0 research lane tripped STALL *after* its agent
  had already completed successfully (no more writes ever coming); (c) a
  read-only audit lane is quiet by design for 20+ minutes, so mtime watching
  had to be swapped for a deadline watch ad hoc.
- **Root cause:** file mtime is the wrong liveness signal for lanes whose work
  is reading/reasoning, and watchdogs are not lane-state-aware (no notion of
  "lane completed — stand down").
- **Impact:** alert noise; risk of the operator tuning out real stalls.
- **Proposed enhancement:** exactly the T5 plan-time audit findings — liveness
  from lane-filtered event types (prompt/heartbeat/checkpoint), completion
  detection via round_done before stall logic, and watchdog teardown wired to
  lane completion. Session-level: stop each Monitor when its lane's completion
  notification arrives (procedural, now noted).

## 2026-07-16 — wt-merge.sh aborts when FOREMAN_REPORT files are gitignored

- **Phase:** Round A merge (wt-merge.sh dl2 implement lib-hardening)
- **What happened:** wt-merge exited 1 during its auto-commit-worker-changes
  step with git's "The following paths are ignored by one of your .gitignore
  files: FOREMAN_REPORT.json / FOREMAN_REPORT.md" refusal; the squash-apply
  never happened.
- **Evidence:** two identical failures; worktree left with changes staged but
  uncommitted on the branch.
- **Root cause (suspected):** wt-merge's auto-commit explicitly passes the
  report filenames to `git add` (to exclude them from the commit via pathspec
  or to handle them), which errors when the files are ignored — the bats test
  ("wt-merge auto-commit excludes Foreman report files", #46) evidently covers
  a tree where the reports are NOT gitignored, so the regression is untested
  in the ignored configuration introduced by the later gitignore commit.
- **Impact:** merge path broken for every worktree round in this repo; the
  architect fell back to manual `git commit` (branch) + `cherry-pick -n`
  (squash-stage) — equivalent but unguarded by wt-merge's fail-closed checks
  (dirty-index refusal, overlap detection, metadata marking).
- **Proposed enhancement:** fix wt-merge to build its add list from
  `git status --porcelain` (which never lists ignored files) or add
  `--ignore-missing`-safe handling; add a bats case where FOREMAN_REPORT.* are
  gitignored; consider `git add -A -- ':(exclude)FOREMAN_REPORT*'`.

## 2026-07-16 — merge gate semantics: user condition "when approved" vs WARNING verdict

- **Phase:** Round A ship decision
- **What happened:** the user's standing instruction was "merge it and kick off
  round B when approved". The re-audit returned WARNING (all 5 findings
  resolved; one new low-severity comment nit, fixed pre-merge). The architect
  proceeded toward merge on judgment; the permission classifier blocked the
  action as exceeding the stated gate, and the user was asked explicitly
  (answer: merge now).
- **Impact:** one blocked command + one interactive round-trip; no bad merge.
  The safety layering (classifier catching an architect judgment call that
  outran the literal user gate) worked as designed.
- **Proposed enhancement:** define verdict-to-action policy in doctrine ahead
  of time: e.g. "WARNING with all named findings resolved and only low-severity
  residuals = mergeable at architect discretion; WARNING with unresolved
  medium+ findings = ask; BLOCKED = never" — and confirm the user's preferred
  policy once, in .foreman/config.toml, instead of per-round.

## 2026-07-16 — 4-way parallel Grok fan-out appears to serialize at the CLI

- **Phase:** Round B implement dispatch (T3/T4/T5/T6 grok-implementer lanes,
  four separate worktrees, spawned in one turn)
- **What happened:** all four stall watchdogs fired simultaneously at the
  10-minute mark. Diagnostics at that moment: exactly ONE `grok.exe` process
  alive on the host, and `git status` showed ZERO modified files in all four
  worktrees — versus Round A, where a single lane began writing files within
  ~2 minutes of dispatch.
- **Evidence:** `tasklist` grok.exe count = 1; `git -C <each worktree> status
  --short | wc -l` = 0 for all four, >10 min after dispatch; no agent failure
  notifications received (lanes alive, not dead).
- **Root cause (suspected, unconfirmed):** the Grok CLI serializes concurrent
  invocations from one account/host — plausibly a lock on `~/.grok`
  config/session state, or account-level request queuing. The four wrapper
  agents each block waiting for their `grok` subprocess, so the "parallel"
  fan-out degrades to roughly sequential execution (~4x single-lane
  wall-clock), defeating the worktree parallelism.
- **Impact:** Round B wall-clock potentially ~4x worse than planned; watchdog
  noise (four synchronized STALL alerts for what is really one queue); risk of
  misdiagnosing queued-but-healthy lanes as dead.
- **Proposed enhancement:** (a) confirm the serialization mechanism (strace the
  lock vs observe request timing; check grok CLI docs/flags for concurrent
  sessions or per-invocation config dirs, e.g. isolated GROK_CONFIG_DIR per
  lane); (b) if confirmed account-level, cap concurrent grok lanes at 1-2 and
  route the rest to codex-implementer (cross-vendor race doctrine already
  allows this) — the routing table planned for v0.4.0 (risk-class → model,
  effort, scope) should also carry a per-vendor max-concurrency field;
  (c) make lane watchdogs queue-aware: a lane whose CLI subprocess has not
  STARTED yet should report QUEUED, not STALL (ties into durable-lanes
  lane-run.sh, which emits a `prompt` event only when the round actually
  begins); (d) log dispatch→first-write latency per lane in events.jsonl as a
  standard metric (v0.4.0 T10 telemetry).

## 2026-07-16 — remote lane produced an unmergeable parallel git history

- **Phase:** v0.3.0 session-transport review (branch `dev/foreman-v1`,
  implemented by a remote agent)
- **What happened:** the branch shares no common ancestor with `main`
  (`git merge-base` exits 1; distinct root commits; 55-commit parallel
  lineage). The remote agent evidently rebuilt the repository history rather
  than branching from the pushed main. Compounding it, `main` independently
  evolved past the architecture the series depends on (worker-run.sh stubbed,
  `adapters/` removed, `lib/common.sh` rewritten), so no mechanical merge
  path exists at all — Codex review verdict: BLOCKED for direct merge;
  file-by-file content-diff re-port required.
- **Impact:** ~1900 lines of good engineering stranded behind a manual
  re-port; review had to reconstruct the intended splice points; landing
  cost is now a multi-round port project instead of a rebase.
- **Proposed enhancement:** (a) remote/cloud lanes MUST branch from the
  current pushed main and be rejected at dispatch if `git merge-base` with
  origin/main fails — add this as a lane preflight check; (b) long-lived
  remote branches need a periodic re-sync contract (rebase cadence or a
  "merge-target freshness" check in CI); (c) architecture-refactor commits on
  main (like stubbing worker-run.sh) should trigger a review of open remote
  branches that touch the same files.

## 2026-07-16 — implementer wrapper stopped while its CLI subprocess kept running

- **Phase:** Round B T4 (grok-implementer wrapper agent)
- **What happened:** the T4 wrapper backgrounded its long `grok` invocation,
  then ended its own turn "to wait for the notification" — which terminated
  the wrapper while the grok subprocess kept writing to the worktree. The
  architect had to notice the ambiguous completion (agent "finished" with no
  report, deliverable files present but unverified) and manually resume the
  wrapper to finish verification. Related: T6's wrapper hit the same 10-min
  grok subprocess timeout, and a leftover grok child had to be force-killed
  before independent verification to avoid two concurrent writers.
- **Impact:** ambiguous lane state (done? dead? queued?), manual babysitting,
  risk of concurrent writers in one worktree.
- **Proposed enhancement:** wrapper agents must either run the CLI in the
  foreground with an adequate timeout, or, if backgrounding, explicitly wait
  on the task rather than ending the turn; lane-run.sh's worktree lock (T3)
  plus `round_done` events are the structural fix — a lane is only "done"
  when round_done exists, not when the wrapper stops talking.

## 2026-07-16 — unreaped grok subprocess blocked the T3 lane for ~70 minutes

- **Phase:** Round B T3 (grok-implementer wrapper, verification phase)
- **What happened:** a grok subprocess started 10:46 was still alive at 11:41
  (55+ min; the wrapper-level 600s timeout evidently fired without reaping the
  process tree), leaving the T3 wrapper blocked on a shell call from ~10:54
  and the lane write-quiet since 10:56. Meanwhile the lane's actual work was
  COMPLETE and correct — the architect ran tests/lane-run.bats independently:
  5/5 pass in ~150s. ~53 bash processes had accumulated host-wide, 18 of
  which vanished the moment the stale grok was killed (a chain of shells
  blocked on the dead-end pipe).
- **Escalation friction (by design):** the architect's first kill attempt
  selected the process by age (>40 min) and was blocked by the permission
  classifier — reasonable, since earlier STALL→RECOVERED cycles proved
  long-quiet lanes can be healthy. A non-destructive status-check message to
  the wrapper couldn't land because the wrapper was blocked inside the very
  call that needed killing (queued messages deliver at the next tool round —
  which never came). Resolution required explicit user authorization:
  kill grok PID 37052, stop the wrapper agent, hand the mechanical finish
  (full suite + report) to a Sonnet 5 lane with Fable checking.
- **Root cause chain:** (1) the grok CLI wrapper's subprocess timeout does not
  kill the process GROUP (same bug class the v0.3.0 session-transport branch
  fixes remotely: "reap group_timeout watchdog and session on abort/success";
  also the T6 wrapper reported force-killing a leftover grok child); (2) no
  PID-tracked lifecycle exists for lane subprocesses, so cleanup must resort
  to age heuristics that rightly trip the safety classifier; (3) a wrapper
  blocked in a synchronous call is unreachable by messages — no out-of-band
  health probe exists.
- **Impact:** ~70 min of wall-clock on a lane whose work was already done;
  host process-table pollution; manual multi-step intervention.
- **Proposed enhancement (BRAINSTORM SCHEDULED with the user):** candidate
  directions to evaluate — (a) lane-run.sh (T3, now built) becomes the ONLY
  way lanes invoke CLIs: it owns the child PID, records it in an event, and
  its cleanup trap kills the process group on exit/timeout — making every
  lane subprocess PID-tracked and safely killable by ref, not by age;
  (b) wrapper doctrine: one foreground CLI call per turn with a hard timeout,
  and a `timeout --kill-after` style group-kill wrapper (or Windows Job
  Object equivalent) around every grok/codex invocation; (c) a host-side
  reaper in maintenance.sh: kill lane CLI processes whose run has a
  round_done event or whose owning agent is gone (ownership from the PID
  event, not age); (d) port the v0.3.0 group_timeout reaping fix forward
  during the re-port; (e) watchdogs escalate to a health probe that inspects
  the lane's recorded PID instead of paging the architect blind.

## 2026-07-16 — finisher lane's cwd silently reset to a DIFFERENT lane's worktree

- **Phase:** Round B T3 close-out (Sonnet finisher lane)
- **What happened:** after a background-task resume, the finisher's shell cwd
  silently pointed at `foreman-wt-dl2b-implement-t5-watch` — an unrelated
  lane's worktree — between tool calls. The agent caught it via `pwd`/file
  checks BEFORE any writes; T5's files were never touched; all steps were
  re-verified with explicit `cd` into the correct tree.
- **Impact:** none this time, but the failure it nearly caused is severe:
  cross-worktree contamination (reports or fixes written into the wrong
  lane's tree) that verification and audit would then attribute to the wrong
  diff.
- **Proposed enhancement:** lane doctrine — every lane-touching command uses
  absolute paths or an explicit leading `cd <worktree> &&`; finisher/wrapper
  prompts state the worktree as the FIRST constraint (already practice) AND
  require a `pwd` guard before any write; structurally, lane-run.sh's
  lane.lock plus report-path assertions (report must be written inside the
  lane's own tree) make the contamination detectable at write time.
