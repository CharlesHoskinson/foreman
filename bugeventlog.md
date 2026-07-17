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

## 2026-07-16 — background-and-stop is a recurring cross-model attractor, not a one-off

- **Phase:** every long-running lane type used today (implement, finish,
  rework)
- **What happened:** the same failure shape recurred FOUR times across TWO
  vendors' models, with escalating prompt countermeasures each time:
  1. T4 Grok wrapper backgrounded its CLI call and ended its turn "to wait"
     (original F2 entry above);
  2. T4 Grok wrapper did it AGAIN after being resumed with explicit
     instructions to wait on the task;
  3. T3 Sonnet finisher backgrounded the full-suite run and "paused" —
     despite its prompt containing "foreground commands only, NEVER
     background-and-stop";
  4. T6 Sonnet rework lane stopped to "wait for the background test run" —
     same explicit prohibition in its prompt.
  Each occurrence required a manual SendMessage resume by the architect.
- **Root cause (systemic):** agents generalize "background tasks notify you"
  from top-level-session semantics, where notifications re-invoke the agent.
  For SUBAGENTS, ending the turn ends the task — there is no automatic
  re-invocation — so "stop and wait" is functionally "abandon work in an
  ambiguous state." Prompt discipline measurably does not fix this: the
  pattern survived direct, capitalized prohibitions in two different models.
- **Impact:** four manual interventions in one day; ambiguous lane states
  (deliverables present, nothing verified, no report); wall-clock loss per
  occurrence until a human or architect notices.
- **Proposed enhancement (structural, feeds v0.2.5):** stop trying to
  prompt this away. (a) Lane completion is defined by ARTIFACTS — round_done
  event + report file present — never by the wrapper's conversational state
  (v0.2.5 T2 WAITING_CHILD rule); (b) watch.sh v2 treats "wrapper stopped +
  no round_done" as a first-class alertable state so the architect is paged
  with the right diagnosis instead of discovering it; (c) architect doctrine:
  every lane dispatch pairs with a content-keyed deadline watch on the
  report artifact (already session practice; codify in references/); (d)
  wrapper prompts keep the foreground-only instruction as defense-in-depth,
  but no design may DEPEND on it holding.

## 2026-07-17 — bash-n-only architect edit broke the T3 gate (found on resume)

- **Phase:** durable-lanes Round B resume; first gate re-run after session cut.
- **What happened:** `bats tests/lane-run.bats` in the T3 worktree came back
  13/14. Test 10 ("KILL-escalates … alert event present") failed on
  `[ "$output" = "best_effort" ]`.
- **Evidence:** the sweep-alert architect edit (flagged "bash -n only, NOT
  test-verified" in the 2026-07-16 resume checkpoint) emits a SECOND alert
  event (`sweep=sweep_failed`) on the same KILL escalation: `taskkill //PID
  <winpid> //T //F` against an already-KILLed pid returns "not found", which
  the code counts as sweep failure. Test 10 extracts `.payload.tree_kill`
  from ALL alerts and expects exactly one line; it now gets two.
- **Root cause:** two independent problems layered: (1) the edit's alert
  design allows multiple alert events per single kill incident; (2) taskkill
  "process not found" (vacuous sweep — nothing left to kill) is
  indistinguishable in the code from a real sweep failure, so the noisy
  alert fires on effectively every KILL path.
- **Impact:** none shipped — the gate caught it before merge, exactly as
  designed. Cost: one rework round on T3.
- **Proposed enhancement:** doctrine already says gates before merge; the
  real lesson is narrower — an edit verified only by `bash -n` must never be
  carried across a session boundary as "done pending tests". Either run the
  gate in-session or leave the edit as a written spec for the next round.

## 2026-07-17 — lane watchdog false-fired on a STALE report artifact

- **Phase:** Round B resume; dispatch of the two Sonnet rework lanes (T3
  sweep-alert redesign, T5 seq-0 test).
- **What happened:** both freshly armed lane watchdogs fired
  "FOREMAN_REPORT.md present" within seconds of dispatch and exited.
- **Evidence:** the reports they matched were the ROUND-3 reports from
  2026-07-16 16:50 / 17:08, still sitting in the preserved worktrees; the
  new lanes had barely started.
- **Root cause:** the watchdog keyed on report EXISTENCE. The lane-liveness
  doctrine already says "content-keyed, not scaffold-existence" — existence
  of a file that a PREVIOUS round legitimately produced is the same trap one
  level up: the key must be freshness (mtime newer than dispatch), not
  presence.
- **Impact:** two dead watchdogs; would have left both lanes unwatched for
  their whole run had the architect not noticed. Also surfaced that
  re-dispatching into a used worktree risks the new lane overwriting the
  prior round's report — archived both to ~/.foreman/runs/dl2b/archived-reports/
  before the new lanes reached the write.
- **Proposed enhancement:** codify in the watchdog doctrine: watch keys must
  be freshness-based (`-newermt <dispatch-ts>`) whenever a worktree is
  reused across rounds; and lane dispatch into a reused worktree must
  archive-then-delete the prior round's report first so "report present"
  is unambiguous again.

- **Addendum (same resume, second false alert):** watchdog v2 (freshness-
  keyed) immediately reported STALL for T3 — the lane was ~5 minutes into
  its READ phase and had legitimately written nothing yet; the last worktree
  writes were yesterday's. A stall window must not start evaluating until a
  grace period after dispatch (lanes read before they write). v3 = initial
  grace ≥ 10 min, then stall window 25 min. Doctrine fix folded into the
  same enhancement as above.

## 2026-07-17 — background-and-stop attractor, occurrence #5 (T5 Sonnet rework lane)

- **Phase:** Round B resume, T5 seq-0 regression-test lane.
- **What happened:** the lane ended its turn with "Waiting for task
  completion notification — no further action from me until it arrives"
  after backgrounding its bats gate run — despite the spec containing the
  standard foreground-only / artifacts-define-completion clause.
- **Evidence:** agent final message; lane resumed manually via SendMessage.
- **Root cause:** same systemic attractor as the 2026-07-16 entry (subagents
  generalize top-level notification semantics; prompt discipline measurably
  does not hold).
- **Impact:** one manual resume; ~no wall-clock loss (caught immediately via
  completion notification rather than a stall watchdog).
- **Proposed enhancement:** no new lesson — this is more evidence for the
  v0.2.5 structural fix (artifact-defined completion + WAITING_CHILD as a
  first-class alertable state). Running count: 5 occurrences, 3 models.

- **Addendum:** occurrence #6, same session, ~30 min after #5 — the T3
  Sonnet rework lane backgrounded its gate run, polled the empty output
  file, then stopped to "wait for the automatic completion notification".
  Both Round-B-resume Sonnet lanes independently hit the attractor despite
  the standard prohibition clause. Running count: 6 occurrences, 3 models.

## 2026-07-17 — concurrent bats suites on one host corrupt wall-clock tests

- **Phase:** Round B resume verification (T3 + T5 rework gates + main full
  suite running simultaneously).
- **What happened:** every wall-clock-sensitive test (watch.bats STALLED→DEAD
  integration tests 12/14/16/18/23; lane-run.bats stdin-EOF test 9) flaked
  intermittently whenever another worktree's suite ran concurrently; each
  failing test passed in isolation, and the failing SET varied randomly
  run-to-run while tracking the sibling lane's process count (T5 lane's
  5-run evidence; T3 lane observed the same on test 9; the architect's own
  T3 re-run flaked the same way while T5's gate was still running).
- **Root cause:** three bats suites time-share one Windows/Git-Bash host;
  1-second watch ticks stretch to multiple real seconds under process-spawn
  contention, blowing fixed `timeout 20` test bounds.
- **Impact:** ~5 redundant gate reruns across two lanes + architect; no
  code defect — pure verification-signal corruption.
- **Proposed enhancement:** doctrine: gate runs on this host are SERIALIZED
  — lanes still run only their own test file, but the architect schedules
  at most one bats suite at a time (and never overlaps the main-repo full
  suite with lane gates). Longer term (v0.2.5+): timing tests should derive
  bounds from a load-scaled tick or fake clock instead of wall-clock 1s.

## 2026-07-17 — wt-cleanup archives only FOREMAN_REPORT.md, lost V2/V3/V4 audit reports

- **Phase:** Round B close, `wt-cleanup.sh dl2b --force`.
- **What happened:** cleanup archived `FOREMAN_REPORT.md`/`.json` per
  worktree, but the audit worktree's versioned reports
  (`FOREMAN_REPORT_V2/V3/V4.*`) and the cold-diff patches (`DIFF_V*.patch`)
  were untracked extra files — removed with the worktree, unrecoverable.
- **Evidence:** `~/.foreman/runs/dl2b/reports/` contains only
  `audit-round-b.md/.json` (the V1 report) + the four implement reports.
- **Root cause:** the archiver copies a fixed filename pair instead of the
  full set of audit artifacts the multi-round audit convention produces.
- **Impact:** historical audit evidence for rounds V2-V4 lost. No release
  impact (verdicts recorded in the resume checkpoint, merge commit body,
  and architect context) — but the audit trail is no longer independently
  reconstructable.
- **Proposed enhancement:** wt-cleanup should archive `FOREMAN_REPORT*.*`
  and `DIFF_*.patch` (glob, not fixed names) from every worktree; audit
  doctrine: versioned reports belong under `~/.foreman/runs/<RUN>/` from the
  moment they are written, with the worktree holding only a copy.

## 2026-07-17 — watchdog false-stall during a lane's final full-suite gate phase

- **Phase:** Round C (T7), lane in its closing `tests/run.sh` gate.
- **What happened:** the freshness+stall watchdog fired "no worktree writes
  for 25min" while the lane was demonstrably alive — a full-suite bats run
  (checkpoint/config/… .bats) had just started and all T7 deliverables were
  already written.
- **Evidence:** `ps -ef` showed a live bats suite for the T7 worktree
  started 90s before the alert; `git status` showed all 11 expected files
  created/modified.
- **Root cause:** bats writes its scratch to `/tmp/bats-run-*`, not the
  worktree, so a lane whose only remaining work is running the (serialized,
  multi-minute) full suite produces zero worktree writes for the whole run —
  the exact blind spot of a worktree-mtime liveness probe. This is the
  freshness watchdog's third failure mode this session (after stale-artifact
  key and missing dispatch grace).
- **Impact:** one false alert; caught by a probe-before-acting, no lane lost.
- **Proposed enhancement:** watchdog liveness = worktree writes OR a live
  bats/lane process referencing the worktree path (`ps -ef | grep <wt>`).
  Fold into the v0.2.5 typed-lane-state work: a lane in GATE state is not
  judged by file mtime at all — the runner emits a heartbeat event and the
  watchdog reads the event log, not the filesystem.

- **Addendum:** occurrence #7 — the T7 (Round C) Sonnet lane backgrounded
  its final full-suite gate and stopped to "wait for the monitor's
  notification", leaving the suite running orphaned and FOREMAN_REPORT.md
  unwritten (still the wt-new scaffold). Same attractor, same session, third
  Sonnet lane to hit it. The lane had completed ALL implementation (11 files)
  — only the report artifact + final-gate confirmation were missing. Running
  count: 7 occurrences, 3 models. This is now the single most frequent
  failure mode in the log and the strongest evidence for the v0.2.5
  artifact-defined-completion + typed-lane-state fix.
