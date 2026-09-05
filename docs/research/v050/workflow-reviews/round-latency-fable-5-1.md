# Round latency review (Fable 5.1)

Scope: one implement round on the queue path, traced end to end at commit
07f4569 on the reference WSL2 host. Evidence is file:line in this tree,
`~/.foreman/runs/*/events.jsonl`, `~/.local/share/pueue/state.json` (read as
a file, not through pueue), and read-only timings taken today. The
`council-binding-20260905` / `-successor1` runs (seven Grok lanes, five gate
tasks, pueue ids 1455-1466) are the measured round family; the three Codex
rounds of `pidns-remedy-20260905` ran through the `codex-implementer` agent
path and left no lane events, so they are cited from their reports and the
devlog.

## Where the weight is

### The measured round family (pueue 1455-1466, 2026-09-04 20:30 to 2026-09-05 01:09 local)

| Bucket | Wall clock | Share |
|---|---:|---:|
| Lane tasks running a model (7 tasks: 16, 0.1, 11, 5, 31, 12.7, 28 min) | 104 min | 37% |
| Gate tasks (5 tasks: 10 s, 23 s, 4 m 08 s, 29 s, 22 s) | 5.5 min | 2% |
| Nothing running: architect reading, deciding, typing the next command | 169 min | 61% |
| Total | 279 min | 100% |

Four of the seven lane runs failed (1455 exit 1 after 16 min; 1456
`grok_secrets_refused` after 4 s; 1459 exit 1 after 5 min; 1461
`round_incomplete` after 31 min). The idle gap after a failure was 17, 20
and 15 min; after a success it was 1 to 3 min. One 97 min gap (23:17 to
00:54) preceded the pristine `checks-run.sh` task.

### Steps, serial waits, and what they buy

| Step or artifact | Evidence | Cost class | Why it exists |
|---|---|---|---|
| Architect assembles the dispatch argv: 7 or 14 Endstop/release flags, 7 `lane-run.sh` positionals, 11 vendor flags | pueue task 1463 command is 1,100 chars after the queue strips the release block; SKILL.md:262-300 | tokens (about 1,000 to 1,600 chars typed per dispatch), 1 human step, error-prone | Contract-bound admission: an uncontracted request is invalid (SKILL.md:318-322) |
| `wt-new.sh` (worktree add under index lock, 30 s lock timeout) + `hash_snapshot` | wt-new.sh:73-74, :136; measured `hash_snapshot tests/** .github/**` 1.21 s | seconds, 1 human step | Isolated tree; protected-path drift detection |
| `npm ci` in the new worktree | brokenwindows.md BW-017; measured warm-cache `npm ci --ignore-scripts` 3.7 s | seconds (was minutes when BW-017 was written) | A symlinked `node_modules` builds a different artifact |
| `merge-gate.sh record` | merge-gate.sh `cmd_record`; git merge-base only | sub-second, 1 human step | Parallel-history and stale-base refusal at merge |
| `lane-queue.sh add`: node start 74 ms, status probe 1 s bound, `pueue add` 10 s bound, daemon spawn retry 5 x 1 s, Endstop ledger reserve | queue-services.ts:27,33; queue-admission.ts:586-593; queue-cli.ts:359-390 | sub-second normally; 1 human step | Concurrency caps (lane-queue.sh:6-7: grok 3, codex 2, gate 1), one child reservation per action |
| Queue wait at the group cap | `round_done.phases.queue_wait_s` is `null` in every round today; lane-run.sh:991 reads `LANE_QUEUED_AT`, nothing writes it | unmeasured | Not a safety property; a missing instrument |
| `lane-run.sh` preamble: `cfg_load` 7 ms, profile admission 68 ms, grok secret scan 0.49 s, `lane.lock` mkdir, attempt id, WSL clock preflight 0.20 s, prompt event, launcher probe 66 ms | lane-run.sh:302-311, :439-447, :902, :1007-1013, :1136-1139; timed today | about 1 s | Credential isolation, secrets never uploaded, event ordering, containment record |
| Background instrumentation: `sleep 1` loop, heartbeat event every 30 s, checkpoint every 20 s when the stream grew | lane-run.sh:1045-1046, :1072-1105; config.toml:44-45; checkpoint 0.37 s measured on the 55 MB tree | background, not serial; about 60 events per 30 min round | Resume from checkpoint; stall detection |
| `lane_emit_ownership`: poll `$hb` every 0.1 s, bound 20 s | lane-run.sh:720-790 | 0 to 1 s measured (ownership 0-1 s after prompt in 7 of 7 rounds); 21 s only in the degraded lane `pidns-e2e/lane-c` | Kill target for cleanup; watcher dispatch |
| Model turn under the launcher, heartbeat file every 15 s | lane-run.sh:1295; `implement_s` 270, 725, 1660 s today | minutes (the only step that must be long) | The work |
| CMD exit: tee pid poll (100 x 0.02 s), `reap_tee_bounded` grace 5 s, final checkpoint | lane-run.sh:1342, :605-625, :1367 | about 0.5 s measured; the 5 s grace fires only when a descendant holds the pipe | Bounded reap; no unbounded `wait` (Rework Round 3, finding 2) |
| Gate phase: second launcher spawn, `lane_refresh_gate_ownership_pid` 20 s bound, `GATE_CMD` | lane-run.sh:1483-1513; `gate_s` 22-29 s (Moriarty `pnpm check`) | seconds to minutes | Round ownership: no round_done without a green gate and a fresh report |
| Attempt-fresh report predicate | lane-run.sh:1529-1537 | sub-second | A prior round's report never completes a new round (bugeventlog 2026-07-17 stale-report false fire) |
| `watch.sh` in the architect's foreground: tick 15 s, first transition 27-38 s after prompt, `wd_wait_ownership` default 3 s (doctrine asks for 25 s) | watch.sh:373-380, :694; SKILL.md:351-355; events seq 1 to 4 in `council-binding-20260905` | seconds per tick (jq over the log: 3 ms); blocks the architect | Stall escalation |
| Watcher false exit during every gate phase | successor1 seq 80 `verifying` 04:19:40 then seq 81 `AGENT_ABANDONED` 04:19:53; seq 111 to 112; seq 172 to 173; council-binding seq 36 to 39. Mechanism: watch.sh:1000 tests the `ownership` event's `launcher_pid`, which is CMD's launcher and has exited; lane-run.sh:863-881 refreshes only a shell variable and emits no event | 1 human step per round (re-poll by hand), minutes of idle | None; a defect |
| Architect commits the worker's diff by hand, then `checks-run.sh` from a pristine archive: archive 0.25 s, `git init/add/commit` 0.95 s, `npm ci` 3.7 s, `npm run verify` (typecheck 4.9 s, test 177 s, verify-runtime 8.3 s, three small scripts about 1 s), `docs-check.sh` 5.0 s | config.toml:13-14; pueue 1464 (4 m 08 s), 1465 and 1466 archive an explicit commit sha; timings today | about 200 s for this repository; 2 human steps | Verification from a pristine commit, never the dirty tree (SKILL.md hard invariants) |
| The same `npm run verify` run again inside the worker's turn | pidns-remedy reports: `implement-queue.md` is 15 KB, mostly verification transcripts; devlog 2026-09-05 addendum: the Codex sandbox could not open the tsx socket, the architect re-ran everything | minutes of model time, thousands of report tokens per round | Nothing the gate does not already buy |
| The same `npm run verify` run a third time by the architect after merge (`npm run build && verify-runtime`, `policy-check --base`) | devlog 2026-09-05 addendum; lanes.md:16 "architect re-runs checks" | about 195 s, 2 human steps | Verification authority (SKILL.md:427-437) |
| `docs-check.sh` is red on the base tree | measured at 07f4569: status fail, markdownlint 1,668 findings, codespell 3, 5.0 s | a decision per round | None while it cannot discriminate |
| Audit: Codex GPT-5.6 high, bound `limits.round_timeout_min` 30 min | config.toml:18; audit-run.sh `AUDIT_TIMEOUT_MIN`; AGENT_TRAPS.md:84 (graphify stalls 25 min+) | minutes to 30 min, serial after checks | Audit vendor differs from worker vendor |
| `merge-gate.sh check`, `wt-merge.sh`, cleanup, Endstop outcome registration | merge-gate.sh `cmd_check`; wt-merge.sh; SKILL.md:286-291 | sub-second each; 4 human steps | Freshness, squash merge, ledger |
| A gate process that outlived its round | `verify-runtime` pid 460860 running 47,754 s (13 h) in `foreman-wt-pidns-remedy-20260905-implement-queue`, a worktree whose index status is `cleaned` | host CPU; evidence that unowned gate runs escape | Argument for keeping the bounded kill ladder, not against it |

### What runs while the model is idle, and while the human is idle

While the model is idle (between `round_done` and the next `prompt`): the
architect polls a watcher that has already exited 5, reads the report and
the diff, commits the worktree, enqueues `checks-run.sh` (200 s), reads its
log, runs the auditor, runs `merge-gate check` and `wt-merge`, re-runs the
verify set in main (195 s), registers the outcome, writes the next spec,
assembles the next argv. Measured: 1 to 3 min after a success, 15 to 20 min
after a failure, 97 min once.

While the human is idle (the model turn): `lane-run.sh` sleeps 1 s at a
time, emits a heartbeat every 30 s and a checkpoint every 20 s, the launcher
writes a heartbeat line every 15 s, and `watch.sh` samples every 15 s. None
of this is on the critical path; the launcher, probe, and checkpoint costs
are all under 0.5 s. The serial 20 s bounds (ownership, gate ownership
refresh) resolve in under 1 s when the launcher is present.

The weight is not in `lane-run.sh`. It is in verification run four times
per change (worker turn, in-round gate, pristine `checks-run.sh`,
architect re-run: about 10 min of a 40 min round), in a watcher that dies
at the gate boundary so a human polls, and in about eighteen serial human
steps per round with 1 to 20 min of idle between them.

## Ranked proposals

### 1. Verify once per tree: the in-round gate becomes the pristine check

- What changes: in `--round` mode, after CMD exits, `lane-run.sh` (or the
  planned `lane-round` runtime) commits the worker's pending changes to the
  lane branch host-side (the `commit_worktree_pending` logic of
  `wt-merge.sh`, excluding `FOREMAN_REPORT.*`), archives that commit, runs
  `GATE_CMD` in the archive, and writes `checks-result.json` and
  `docs-check.json` with `diff_sha256` and `tree_sha256` exactly as
  `checks-run.sh` does today. `checks-run.sh` returns the existing result
  when a result for the same `tree_sha256` exists and re-runs otherwise.
  The post-merge re-run is replaced by a tree comparison: if the squash
  result tree equals the verified lane tree, the recorded result stands;
  otherwise run once.
- Expected speedup: removes two of four `npm run verify` executions per
  round, about 400 s of serial time (200 s pristine check + 195 s
  architect re-run, both measured today), and two human steps. On a 40 min
  round this is 15 to 20%.
- Safety property touched: "checks run from a pristine commit, never the
  dirty worktree" and "worker claims are never evidence". Preserved and
  strengthened: today the in-round gate runs on the dirty tree; after this
  it runs on an archive of a host-made commit under the launcher. The
  result is bound to the tree sha, which `gate-eval.sh:119-130` already
  compares.
- Effort: M. Risk: low; the binding fields and the gate comparison already
  exist. Files: `skills/foreman/scripts/lane-run.sh` (ROUND_MODE block
  :1463-1560), `skills/foreman/scripts/checks-run.sh`,
  `skills/foreman/scripts/wt-merge.sh` (share `commit_worktree_pending`),
  `packages/orchestration/src/round-transaction.ts`,
  `skills/foreman/SKILL.md` "Soft verification + audit",
  `skills/foreman/references/lanes.md:16`.

### 2. Make the watcher survive the gate phase and block until terminal

- What changes: at gate spawn `lane-run.sh` emits a second `ownership`
  event carrying the gate launcher pid and child pid (the values
  `lane_refresh_gate_ownership_pid` already parses); `wd_sample_v2` takes
  the latest `ownership`; while `WD2_VERIFYING == 1`, `wd_classify_v2`
  judges liveness from `$hb` and the event log before it consults a pid
  (the doctrine in orchestration-hardening.md:179-181 already names `$hb`
  as the gate-phase authority). `WATCH_OWNERSHIP_WAIT` defaults to 25,000
  ms so the doctrine value needs no environment variable. `watch.sh` prints
  one terminal line with the report path and the gate rc.
- Expected speedup: removes the false `AGENT_ABANDONED` exit that fired in
  4 of 4 gate phases today, 13 s after `state verifying`, and the manual
  re-poll it forces. Saves one human step and the 1 to 3 min gap after a
  success; part of the 15 to 20 min gap after a failure.
- Safety property touched: abandoned-round detection. Preserved: the pid
  check still runs, against the pid that is actually alive, and the
  STALLED to DEAD ladder is unchanged.
- Effort: S. Risk: low; `tests/watch.bats` and `tests/round-ownership.bats`
  pin the observable chain and must keep passing through the gate group.
  Files: `skills/foreman/scripts/lane-run.sh:863-881, :1483-1513`,
  `skills/foreman/scripts/watch.sh:797-812, :880-1046, :694`,
  `tests/watch.bats`, `tests/round-ownership.bats`,
  `packages/policy/src/architecture-adapter.ts` (pin update, with reason).

### 3. One command per round: `lane-round dispatch` and `lane-round wait`

- What changes: the `lane-round` CLI in `packages/orchestration` (already
  planned by `lane-runtime-typescript`) gains `dispatch RUN SLUG VENDOR
  SPEC --contract FILE`: it runs `wt-new.sh`, `npm ci` when the lock file
  changed, `merge-gate.sh record`, builds the release block from the
  contract JSON, calls `lane-queue.sh add` with `LANE_QUEUED_AT` set, and
  prints the task id. `wait RUN LANE` blocks on the fixed watcher and
  prints the report path, the gate rc, and the checks tree sha.
- Expected speedup: six human steps become one; the architect no longer
  types the 1,000 to 1,600 char argv (measured on task 1463) or the 14-flag
  release block. With gaps of 1 to 3 min per step, 5 to 15 min per round
  of idle disappears, and the dispatch argv errors that cost a full round
  today (1456: 4 s refusal after a mis-set profile) become impossible.
- Safety property touched: Endstop contract binding and merge-base
  recording. Preserved: the same `queue-cli.ts` admission path runs; the
  release block is generated from the contract file, not skipped.
- Effort: M. Risk: medium (a new CLI surface; must not become a fifth way
  to dispatch). Files: `packages/orchestration/src/round-cli.ts`,
  `round-main.ts`, `queue-cli.ts` (export `LANE_QUEUED_AT` into the pueue
  environment), `skills/foreman/scripts/wt-new.sh`,
  `skills/foreman/SKILL.md` "Durable rounds", `openspec/changes/
  lane-runtime-typescript/tasks.md`.

### 4. Bounded automatic rework on a failed gate

- What changes: when the gate fails or the report is stale
  (`waiting_child` + `round_incomplete`, lane-run.sh:1546-1559), the round
  writes the last 80 lines of the gate log and the failing test names to
  `$RUN/rework-<attempt>.md` and, while `limits.max_rework_rounds` allows
  and the operator pre-approved the family, re-enqueues the same lane with
  spec plus rework file through `--endstop-prior-reservation-id`. The
  pattern is `vendor-multiround.sh`'s empty-burst retry, applied to gate
  failures. Secrets refusal and containment refusal stay terminal.
- Expected speedup: the failure gap (17, 20, 15 min today, 52 of 279 min)
  drops to queue latency. If half the failures are gate-fixable in one
  rework, about 25 min per feature of the size measured.
- Safety property touched: bounded execution (no unbounded retries).
  Preserved by `max_rework_rounds = 3` (config.toml:17) and one Endstop
  reservation per attempt.
- Effort: M. Risk: medium; a rework prompt must carry the gate evidence,
  not the worker's narrative. Files: `skills/foreman/scripts/lane-run.sh`
  ROUND_MODE failure branch, `packages/orchestration/src/queue-cli.ts`,
  `skills/foreman/scripts/vendor-multiround.sh` (share the retry prompt
  builder), `.foreman/config.toml`.

### 5. Tier the in-round gate; run the full suite once at merge

- What changes: the in-round `GATE_CMD` for this repository becomes
  `npm run typecheck && node --import tsx --test <patterns for the
  packages touched> && npm run build && npm run verify-runtime` (measured:
  4.9 s + a fraction of 177 s + 3.5 s + 8.3 s), selected from
  `git diff --name-only BASE...HEAD`. The full `npm run verify` runs once,
  at `merge-gate check`, on the tree proposal 1 already bound.
- Expected speedup: in-round gate about 200 s to under 60 s; with proposal
  1 the full suite runs once per change instead of four times.
- Safety property touched: full-suite verification before merge. Preserved:
  it still runs once, before merge, under the gate group. The tier budgets
  doctrine (regression-tier-budgets.md: tier 0 at 120 s per commit) already
  frames this.
- Effort: S. Risk: low; an empty test selection must fail (run-tests.ts
  already refuses zero matches). Files: `.foreman/config.toml [checks]`,
  `scripts/run-tests.ts` (accept a path list), `skills/foreman/scripts/
  checks-run.sh`, `skills/foreman/references/regression-tier-budgets.md`.

### 6. Run the audit beside the gate, not after it

- What changes: `lane-round dispatch` (or the architect) enqueues
  `audit-run.sh` in the `codex` group at the same time the pristine check
  runs in the `gate` group; both consume the same committed tree.
  `gate-eval.sh` already refuses a verdict whose `tree_sha256` or attempt
  does not match (gate-eval.sh:137-160), so ordering adds nothing. Every
  `codex exec` in the audit path gets `timeout 1200` per AGENT_TRAPS.md:84.
- Expected speedup: the shorter of the two disappears from the critical
  path: about 3.4 min per round for this repository, more where the audit
  is fast and the checks are slow.
- Safety property touched: audit binds to the verified tree. Preserved by
  the existing hash and attempt binding.
- Effort: S. Risk: low. Files: `skills/foreman/scripts/audit-run.sh`,
  `skills/foreman/scripts/lib/audit-call.sh`,
  `skills/foreman/SKILL.md` "Soft verification + audit" step order.

### 7. Stop verifying inside the model turn

- What changes: implement specs no longer instruct the worker to run
  `npm run typecheck && npm test && npm run build && npm run
  verify-runtime` and paste transcripts. The worker runs only the tests it
  touched and reports commands, not output. The launcher-owned gate is the
  evidence.
- Expected speedup: minutes of model time per round (the pidns-remedy
  reports carry 200-line transcripts of runs that took about 195 s each)
  and thousands of report tokens the architect then reads. Codex could not
  run tsx in its sandbox today, so those turns produced no evidence at all.
- Safety property touched: none; foreman-qa doctrine already says a report
  is a claim and the gate is the measurement.
- Effort: S. Risk: low. Files: `skills/foreman/references/five-part-spec.md`,
  `agents/codex-implementer.md`, `agents/grok-implementer.md`,
  `skills/foreman/SKILL.md` "Soft verification + audit" item 2.

### 8. Instrument the whole round before and after the cuts

- What changes: `lane-queue.sh add` exports `LANE_QUEUED_AT`; the round
  records `phases.preamble_s`, `phases.gate_s` (present), and a
  `round_summary` event at merge with `checks_s`, `audit_s`, `merge_s`,
  and `idle_s` (prompt of the next attempt minus `round_done` of this
  one). `foreman-fit-report.sh` prints the per-round table.
- Expected speedup: none directly; it turns every proposal above into a
  measured before/after and exposes the 61% idle share on every run.
- Safety property touched: none. Effort: S. Risk: none. Files:
  `packages/orchestration/src/queue-cli.ts`, `skills/foreman/scripts/
  lane-run.sh:985-995`, `skills/foreman/scripts/foreman-fit-report.sh`.

### 9. Trim the fixed cadences that gate the first human signal

- What changes: `durable.watch_tick` 15 to 5 s (a tick costs one jq pass,
  3 ms measured on a 174-event log); `WATCH_OWNERSHIP_WAIT` default 25,000
  ms (proposal 2); keep heartbeat 30 s, checkpoint 20 s, launcher heartbeat
  15 s as they are.
- Expected speedup: first `RUNNING_IMPL` line 27-38 s after prompt becomes
  under 10 s; terminal detection latency after `round_done` drops from up
  to 15 s to 5 s. Under 30 s per round; cheap.
- Safety property touched: stall thresholds (`stall_warn` 300,
  `stall_dead` 900, `impl_stale` 300, `verify_stale` 600). Unchanged.
- Effort: S. Risk: the frozen v1 bats tests size their bounds on the tick;
  set the value through config, not the built-in default. Files:
  `.foreman/config.toml [durable]`, `skills/foreman/scripts/watch.sh:375`.

### 10. Make the docs gate discriminate

- What changes: `docs-check.sh` compares findings against the base commit
  and fails only on new findings, or the tree is fixed until it is green
  at HEAD. Today it fails on the base tree (markdownlint 1,668, codespell
  3), so every round's `docs-check.json` is red before the worker starts.
- Expected speedup: one manual override decision per round disappears;
  `checks-run.sh` regains a usable docs signal.
- Safety property touched: fail-closed docs gate. Preserved: a new finding
  still fails.
- Effort: S. Risk: low. Files: `skills/foreman/scripts/docs-check.sh`,
  `.markdownlint-cli2.jsonc`, `skills/foreman/scripts/checks-run.sh`.

Taken together, proposals 1 to 6 remove about 400 s of duplicated
verification, the failure gaps, the watcher re-poll, and five of the
serial human steps from each round. On the measured family (279 min, 104
min of model time) the reachable floor is model time plus one verification
per change plus the decisions a human must still make: about 130 min,
which is better than half.

## What must not be cut

- Round ownership under the launcher and the attempt-fresh report
  predicate (lane-run.sh `--round`). Justified by bugeventlog 2026-07-17
  "watchdog false-fired on a STALE report artifact" and the
  background-and-stop attractor (occurrence #5): a bare vendor call has no
  owner, and a prior round's report has completed a new round before.
- The `gate` group at `parallel=1` and the bats mutex (`tests/run.sh`,
  `tools/ci-local.sh:244`). Justified by bugeventlog 2026-07-17
  "concurrent bats suites on one host corrupt wall-clock tests": the
  suite's verdict changed with what else was running.
- Verification from a pristine commit, separate from the worker's own
  transcript (SKILL.md hard invariants; AGENT_TRAPS.md section 12; the
  devlog 2026-09-05 rows where Codex reported clean runs its sandbox could
  not execute). Proposal 1 moves this step; it does not remove it.
- The grok secret scan before spawn (lane-run.sh:439-447, 0.49 s). The
  whole-repository upload behaviour of Grok Build is unrefuted; today's
  `grok_secrets_refused` alert shows the guard is live.
- The containment probe, its record in `ownership`, and refusal without
  approval (lane-run.sh:1136-1219; devlog 2026-09-05). It costs 66 ms.
- Endstop contract binding at admission (SKILL.md:318-322). The cost is
  argv assembly, which proposal 3 generates; the binding stays.
- `merge-gate.sh check` before `wt-merge.sh` (v0.2.5 T6): a parallel-
  history branch squash-merges cleanly without it.
- The bounded kill ladder and tee reap (lane-run.sh:533-625, Rework Round
  3 finding 2). The `verify-runtime` process that has run for 13 h in a
  cleaned worktree is what an unowned gate run looks like.
- `npm ci` per worktree (BW-017). It is 3.7 s warm today; the symlink saved
  nothing and shipped a wrong bundle.
- Audit vendor different from worker vendor, and the audit's tree and
  attempt binding in `gate-eval.sh`.

## Measure first

Proposal 1 (verify once):

```bash
# One full pristine verification of this repository, as checks-run.sh runs it.
d=$(mktemp -d); git -C /home/charl/foreman archive HEAD | tar -x -C "$d"
cd "$d" && time bash -lc 'git init -q && git add -A && git -c user.name=F -c user.email=f@l commit -qm s && npm ci --ignore-scripts && npm run verify'
# Expect about 200 s (measured today: test 177 s, verify-runtime 8.3 s, typecheck 4.9 s, npm ci 3.7 s).

# How many times verification ran per change in the last round family.
grep -c 'npm run typecheck' ~/.foreman/runs/pidns-remedy-20260905/reports/implement-*.md
jq -r '.tasks[] | select(.group=="gate") | (.status|to_entries[0].value) as $s | [(.id|tostring), ($s.start//""|.[0:19]), ($s.end//""|.[0:19]), ((.original_command//.command)|.[0:80])] | join(" | ")' ~/.local/share/pueue/state.json | tail -10

# The binding fields already exist; the reuse rule needs nothing new.
jq '{diff_sha256,tree_sha256,status}' ~/.foreman/runs/<run>/checks-result.json
```

Proposal 2 (watcher survives the gate):

```bash
# Every verifying -> AGENT_ABANDONED pair and its delay, from today's logs.
for f in ~/.foreman/runs/council-binding-20260905*/events.jsonl; do
  jq -r 'select(.type=="state" and .payload.state=="verifying" or (.type=="alert" and .payload.state=="AGENT_ABANDONED")) | [.seq,.ts,.type,(.payload.state//"")] | join(" ")' "$f"
done
# Expect each verifying line followed 13 s later by AGENT_ABANDONED, then round_done.

# The gate refresh emits no event.
sed -n 863,881p skills/foreman/scripts/lane-run.sh | grep -c el_emit   # expect 0
# After the fix, through the gate group: tests/watch.bats, tests/round-ownership.bats,
# and one live round with no AGENT_ABANDONED between state verifying and round_done.
```

Proposal 3 (one command per round):

```bash
# Idle between consecutive tasks in the measured family (end of one, start of the next).
jq -r '[.tasks[] | select(.id>=1455 and .id<=1466) | (.status|to_entries[0].value) as $s | {id, start:$s.start, end:$s.end}] | sort_by(.id) | .[] | "\(.id) \(.start[0:19]) \(.end[0:19])"' ~/.local/share/pueue/state.json
# Sum the gaps; expect about 169 of 279 min.

# Bytes the architect assembled per dispatch.
jq -r '.tasks["1463"].original_command | length' ~/.local/share/pueue/state.json   # about 1,100 after the release block was stripped

# Steps per round as documented today: count the numbered commands in
# SKILL.md "Durable rounds (v0.2.5)" and "Soft verification + audit".
```

## Model self-identification

I am running as Claude Fable 5.1 (model id `claude-fable-5-1`). This is a
self-report; nothing in this review verifies the identity independently.
