# R5 — Internal Attachment Map (Foreman codebase ground truth)

Research lane R5. **No web research.** Every claim below carries a `file:line`
citation against `/root/foreman` at HEAD `1e21a81`
(`plan(v0.2.9): WSL compatibility …`), working tree otherwise clean except the
33 mode-bit deltas analysed in §8.

Driving paper read: `docs/research/vnext/SOURCE-karpathy-graph-engineering.txt`
(608 lines), §IV–VII. The load-bearing claim for this lane is §V.A
(`SOURCE-karpathy-graph-engineering.txt:293-310`): *"AgentHub's commit DAG
represents work lineage. A knowledge graph represents domain knowledge. They
should not be collapsed."* Foreman already owns a work-lineage store
(`events.jsonl`, §2) and a domain-knowledge store (`graphify-out/graph.json`,
§4). They are today completely disjoint. §9 proposes the join.

---

## 1. Full surface inventory + real call graph

### 1.1 Repo top level

| Path | What it is |
|---|---|
| `skills/foreman/` | the shipped skill: `SKILL.md` (339 L), `references/` (10 docs), `scripts/` (25 scripts + 7 libs + 1 schema) |
| `skills/graphify/`, `skills/scrapling/`, `skills/superpowers/` | vendored reference skills, never locally modified (`skills/VENDORED.md:9`) |
| `agents/` | 7 subagent definitions (`codex-auditor.md`, `codex-implementer.md`, `foreman-advisor.md`, `foreman-audit.md`, `foreman-plan.md`, `foreman-search.md`, `grok-implementer.md`) |
| `config/foreman.toml.example`, `.foreman/config.toml` | config template + this repo's own live config (54 L) |
| `launcher/` | Bun/TypeScript `foreman-launch` process supervisor: `src/launch.ts`, `src/posix.ts`, `src/posix-bootstrap.ts`, `src/supervise.ts`, `src/win/jobobject.ts` + 4 test files |
| `env/` | `tool-check.sh` / `tool-check.ps1`, `bootstrap-wsl.sh` / `bootstrap-windows.ps1`, `reference-manifest.toml`, `wsl-clock-preflight.sh`, `wsl-clock-resync-task.xml` |
| `tests/` | 34 `.bats` files + `helpers.bash` + `run.sh` |
| `.github/workflows/` | exactly two: `maintenance.yml`, `windows-smoke.yml` |
| `openspec/` | 9 live change packages + 8 archived (§7) |
| `graphify-out/` | `graph.json` (2,761,285 B) + `GRAPH_REPORT.md` (99,685 B) (§4) |
| `bugeventlog.md` | 828-line append-only failure log (§6) |
| `ROADMAP.md`, `README.md`, `CLAUDE.md` | 262 L / 33,667 B / 4,551 B |

### 1.2 `skills/foreman/scripts/lib/` — 7 shared libraries

| File | Lines | Exports | Sourced by |
|---|---|---|---|
| `lib/common.sh` | 99 | `log`, `die`, `require_cmd`, `run_dir` (`:37`), `git_nohooks` (`:42`), `toml_get` (`:50`, python3+tomllib), `hash_snapshot` (`:80`), `repo_lock_path` (`:93`); `readonly EXIT_OK/FAIL/CONFIG/MISSING_CLI` (`:4-7`); `FOREMAN_HOME` default `$HOME/.foreman` (`:9`) | nearly every script |
| `lib/eventlog.sh` | 427 | `el_init` `:50`, `el_emit` `:63`, `el_read` `:146`, `el_cursor_get` `:181`, `el_cursor_commit` `:188`, `el_attempt_new` `:212`, `el_read_after` `:262`, `el_compact` `:332` | `lane-run.sh`, `watch.sh`, `resume.sh`, `lane-supervise.sh`, `merge-gate.sh`, `worker-run.sh`, `lib/nats-bridge.sh` |
| `lib/checkpoint.sh` | 76 | `ckpt_snapshot` `:13`, `ckpt_latest` `:61` | `lane-run.sh`, `resume.sh` |
| `lib/config.sh` | 226 | `_cfg_parse_toml` `:115`, `cfg_load` `:176`, `cfg_get` `:210`; `_CFG_ENV_VAR` table `:65-86` | `lane-run.sh`, `watch.sh`, `merge-gate.sh`, `lane-supervise.sh`, `nats-bridge.sh` |
| `lib/worktree.sh` | 160 | `wt_parent_dir` `:18`, `wt_path` `:29`, `wt_branch` `:42`, `wt_role_ok` `:52`, `git_retry` `:73`, `wt_sweep_stale_locks` `:122`, `wt_with_lock` `:150` | `wt-new.sh`, `wt-cleanup.sh`, `wt-merge.sh`, `foreman-cleanup.sh` |
| `lib/worker-cmd.sh` | 76 | `wc_build_argv VENDOR PROMPT_FILE WORKDIR` `:42` → fills `WC_ARGV` | `worker-run.sh` only |
| `lib/launch.sh` | 45 | `fl_resolve_launcher` `:18` (hard-mode launcher resolver, deliberately independent of `lane-run.sh:542`'s own `lane_resolve_launcher`) | `worker-run.sh` |
| `lib/nats-bridge.sh` | 321 | JetStream one-way publish of event-log lines, line-cursor based | `watch.sh` |

### 1.3 `skills/foreman/scripts/` — 25 executables

| Script | L | One line | Called by |
|---|---|---|---|
| `foreman-setup.sh` | 121 | Setup stage: composes `env/tool-check.sh`, per-vendor auth verdicts, never authenticates | operator / architect (`SKILL.md:40`) |
| `foreman-cleanup.sh` | 126 | Cleanup stage: SIGINT lanes, compose `wt-cleanup.sh` (`:95`), stop foreman-owned pueued, sweep run locks | operator (`SKILL.md:60`) |
| `task-new.sh` | 62 | hard-mode INIT: worktree + `meta.json` envelope + `hashes.txt` protected-path snapshot | hard-mode loop |
| `wt-new.sh` | 259 | create a role worktree; provisions `<WT>/.harness/vendor-home/{grok,codex,claude}` (`:106-109`); `soft_mode.target=live` guard; calls `git-guards.sh` (`:80`) | architect / `SKILL.md:164` |
| `wt-consolidate.sh` | 109 | gather every worktree's `FOREMAN_REPORT.md` → `CONSOLIDATED.md` | architect |
| `wt-merge.sh` | 166 | squash-land a lane branch (staged by default) | architect, after `merge-gate.sh check` |
| `wt-cleanup.sh` | 231 | archive reports to `~/.foreman/runs/<RUN>/`, remove worktrees, dirty guard | `foreman-cleanup.sh:95` |
| `git-guards.sh` | 111 | pre-worktree git health guards | `wt-new.sh:80` |
| `lane-queue.sh` | 575 | pueue admission layer; `lq_ensure_group` `:353`; fixed group topology `grok:3 codex:2 claude:3 misc:2 gate:1` at `:422`; quote-preserving `add` `:452-483` | architect, `watch.sh:700`, `lane-supervise.sh:161` |
| `lane-run.sh` | 1252 | **the round runner** — see §1.4 | via `lane-queue.sh add` |
| `watch.sh` | 1308 | per-lane watchdog; 10-state typed machine (`:21-23`); reads the event log + launcher heartbeat file; emits `alert` events (`:476,495,1226,1235`) | architect (`SKILL.md:207`) |
| `lane-supervise.sh` | 587 | bounded auto-resume sweeper (`--all`); emits `alert` `:261,300` and `resume` `:334`; shells to `resume.sh` (`:141`) and `lane-queue.sh` (`:161`) | pueue daemon on a fixed interval |
| `resume.sh` | 302 | restore a worktree to its last checkpoint; `resolve_checkpoint_sha` `:59` reads the event log (`:242 el_read`) with `.commit // .payload.checkpoint` precedence (`:74`) | `lane-supervise.sh`, operator |
| `merge-gate.sh` | 181 | `record` `:86` emits a `merge_base` event (`:101`); `check` `:110` re-verifies ancestry + staleness → `MERGEABLE` / `NOT_MERGEABLE:<reason>` exit 6 (`:70,76`) | architect before `wt-merge.sh` |
| `worker-run.sh` | 431 | hard-mode IMPLEMENT: builds vendor argv via `wc_build_argv` (`:116-122`), env allowlist (`:141-144`), runs under `foreman-launch`, mirrors heartbeats into the event log (`:182`), emits `alert` (`:212,216`) | hard-mode loop |
| `checks-run.sh` | 45 | re-run project checks from the pristine commit; invokes `docs-check.sh --json` (`:38`) | hard-mode CHECK |
| `docs-check.sh` | 137 | markdownlint + codespell + lychee + comment lint; vendored-dir exclusion list at `:23` | `checks-run.sh`, architect |
| `evidence-collect.sh` | 24 | produce `evidence/patch.diff` for the auditor | `audit-run.sh:23` |
| `audit-run.sh` | 114 | AUDIT stage: cross-vendor check `:31-33`, codex-only hard-code `:35-37`, `codex exec --output-schema` `:78-86`, worktree-mutation check `:90-93`, verdict normalisation `:98-112` | hard-mode AUDIT |
| `gate-eval.sh` | 62 | deterministic merge gate — forbidden paths `:28`, hash drift `:35`, checks green `:40`, verdict not BLOCKED `:43-47`, docs-check fail-closed `:49-53`; writes `gate-decision.json` `:56,60` | hard-mode GATE |
| `pr-open.sh` | 108 | gate-gated draft PR via `GIT_ASKPASS` (`:86`) + `gh pr create` | hard-mode PR |
| `grok-multiround.sh` | 110 | bounded re-prompt loop around single-burst `grok --prompt-file`; loud `EMPTY-BURST FAILED` | architect for exploratory grok specs |
| `durable-preflight.sh` | 63 | durable-lanes prerequisite probe | `foreman-setup.sh` |
| `maintenance.sh` | 490 | 3 stages: upstream vendored-skill drift, **graph refresh** (`run_graph` `:249-289`), compat vs manifest | `.github/workflows/maintenance.yml:23` |
| `vendor-concurrency-test.sh` | 393 | the T5b destructive concurrency harness | operator, one-off |
| `nats/setup.sh` | — | JetStream stream provisioning | operator |
| `adapters/verdict.schema.json` | — | the audit verdict JSON Schema (see §3) | `audit-run.sh:41` |

### 1.4 The real call graph of a lane round

Verified from source, not from docs. Note that **inter-script calls always use
`bash "$SCRIPT_DIR/x.sh"`** (`checks-run.sh:38`, `foreman-cleanup.sh:95`,
`wt-new.sh:80`, `lane-run.sh:326`) — except two `command -v` PATH lookups
(`lane-supervise.sh:141`, `watch.sh:700`) which **do** require the exec bit (§8).

```text
Setup (once)
  foreman-setup.sh ──> env/tool-check.sh --profile P [--lane V]
                          └─ vendor_authed()   env/tool-check.sh:56-83
                          └─ "LANE_READY: <v>=yes|no"  env/tool-check.sh:412-414

Per round
  architect
    ├─ wt-new.sh RUN implement SLUG          (worktree + .harness/vendor-home/*)
    │     └─ git-guards.sh                    wt-new.sh:80
    ├─ merge-gate.sh record RUN LANE          → el_emit merge_base   merge-gate.sh:101
    └─ lane-queue.sh add <grok|codex|claude|gate|misc> -- \
             lane-run.sh --round GATE_CMD REPORT_PATH RUN LANE WT -- CMD...
                                              lane-queue.sh:422 (group caps)

  lane-run.sh (owns the WHOLE round — lane-run.sh:53-55)
    1. LANE_VENDOR block                      lane-run.sh:305-367
         lane_vendor_env_var()                lane-run.sh:206-213
         readiness gate  (tool-check --lane)  lane-run.sh:326-330
         grok secrets refusal  → el_emit alert lane-run.sh:344-349
         export GROK_HOME|CODEX_HOME|CLAUDE_CONFIG_DIR  lane-run.sh:367
    2. el_attempt_new RUN LANE                lane-run.sh:838-842
    3. el_emit prompt   {cmd}                 lane-run.sh:851
    4. lane_resolve_launcher                  lane-run.sh:542
       spawn CMD through foreman-launch
         → el_emit ownership {pid,launcher_pid,job_id,worktree,config_dir}  lane-run.sh:649
         → el_emit heartbeat (periodic)       lane-run.sh:912
         → el_emit checkpoint  (mid-run, ckpt_snapshot)  lane-run.sh:938
         → el_emit alert  (kill escalation / degraded / ownership_timeout)  :395,653,966
    5. ROUND_MODE gate phase                  lane-run.sh:1151+
         → el_emit state {state:"verifying",attempt}   lane-run.sh:1168
         run GATE_CMD through the launcher (same heartbeat file)
    6. attempt-fresh report predicate (mtime > round_prompt_epoch, lane-run.sh:832)
         pass → el_emit round_done {exit_code,checkpoint,…} + commit sha  :1242/1246
         fail → el_emit waiting_child :1225  +  el_emit alert round_incomplete :1229
                and exit nonzero WITHOUT round_done

  watch.sh RUN LANE WT   (parallel)
    reads events.jsonl + the launcher heartbeat file; 10 typed states
    (QUEUED, STARTING, RUNNING_IMPL, VERIFYING, WAITING_CHILD, AGENT_ABANDONED,
     STALLED, DEAD, SUCCEEDED, FAILED)          watch.sh:21-23
    emits alert events                          watch.sh:476,495,1226,1235
    exit 3 on DEAD

  lane-supervise.sh --all  (pueue-scheduled sweeper)
    abandoned → el_emit alert :261 ; dirty → el_emit alert :300
    resume    → el_emit resume :334 ; shells resume.sh :141, re-queues :161

  Landing
    merge-gate.sh check RUN LANE BRANCH   → MERGEABLE | NOT_MERGEABLE (exit 6)
    wt-merge.sh                            (squash, staged by default)
    foreman-cleanup.sh RUN [--force] ──> wt-cleanup.sh   foreman-cleanup.sh:95
```

Hard mode is a *separate* chain and does not use `lane-run.sh`:
`task-new.sh` → `worker-run.sh` → `checks-run.sh` → `audit-run.sh` →
`gate-eval.sh` → `pr-open.sh` (`SKILL.md:270-276`).

---

## 2. The event log and checkpoint system — the ACTUAL schema

This is already a lineage store. Characterised precisely below.

### 2.1 Storage layout

Rooted at `FOREMAN_HOME` (`lib/common.sh:9`, default `~/.foreman`);
`run_dir()` is `$FOREMAN_HOME/runs/$1` (`lib/common.sh:37`).

```text
~/.foreman/runs/<RUN>/
  events.jsonl        append-only, one JSON object per line
  .seq                monotonic sequence counter (tmp+rename)
  .seq.lock           mkdir mutex for el_emit AND el_compact
  .attempt.lock       sibling mkdir mutex for el_attempt_new only
  attempts/<LANE>.attempt   per-lane monotonic attempt counter
  cursors/<CONSUMER>.cursor integer LINE-number cursor
  reports/            wt-cleanup archive target
```

### 2.2 Frozen top-level record shape

`lib/eventlog.sh:6-11` states the freeze explicitly:

> `Schema v2 (additive; 2026-07-18, v0.2.5 T3): v2 fields nest INSIDE payload
> only. el_emit's 5-positional signature and the top-level
> {seq,ts,type,lane,commit?,payload} shape are FROZEN -- top-level additions
> would be a signature migration, not additive, and are out of scope.`

The literal constructor (`lib/eventlog.sh:111-114`):

```bash
raw=$(jq -cn --argjson seq "$seq" --arg ts "$ts" --arg type "$type" \
  --arg lane "$lane" --arg commit "$commit" --argjson payload "$payload" \
  '{seq:$seq,ts:$ts,type:$type,lane:$lane,commit:$commit,payload:$payload}
   | if .commit == "" then del(.commit) else . end')
```

- `seq` — integer, per-run, monotonic, **gaps permitted, duplicates never**
  (`lib/eventlog.sh:81-84`).
- `ts` — `%Y-%m-%dT%H:%M:%SZ`, UTC, produced by bash's `printf %()T` builtin,
  not `date` (`lib/eventlog.sh:98`).
- `type` — free string; `el_emit`/`el_read`/`el_compact` treat every type
  **opaquely** (`lib/eventlog.sh:26-35`).
- `lane` — free string at emit time; `el_attempt_new` separately validates
  `^[A-Za-z0-9._-]+$` (`lib/eventlog.sh:214`).
- `commit` — optional, **omitted when empty**; carries the checkpoint SHA
  (`lib/eventlog.sh:10-11`).
- `payload` — arbitrary JSON object, validated only as *parseable JSON*.

### 2.3 The complete event-type vocabulary (every `el_emit` call site)

| `type` | Emitted at | Payload (verbatim / from the constructor) |
|---|---|---|
| `prompt` | `lane-run.sh:851` | `{cmd:"<full CMD joined>"}` (`lane-run.sh:845`) |
| `heartbeat` | `lane-run.sh:912` | `{}` |
| `heartbeat` (mirrored) | `worker-run.sh:182` | a whole launcher heartbeat line `{ts,launcher_pid,pid,job_id,alive,stdout_bytes,stderr_bytes,elapsed_s}` nested under payload (`lib/eventlog.sh:22-25`) |
| `checkpoint` | `lane-run.sh:938` | mid-run payload + top-level `commit=<ckpt sha>` |
| `ownership` | `lane-run.sh:649` | `{pid, launcher_pid, job_id, worktree, config_dir, attempt}` (keys documented `lib/eventlog.sh:16-20`) |
| `state` | `lane-run.sh:1168` | `{state:"verifying", attempt}` — the ONLY `state` event emitted anywhere (`lib/eventlog.sh:28-33`) |
| `waiting_child` | `lane-run.sh:1225` | round-incomplete diagnostics |
| `round_done` | `lane-run.sh:1242` (with sha) / `:1246` (without) | `{exit_code, checkpoint:(sha or null)}` `+ {stream_failed:true}?` `+ {checkpoint_failed:true}?` `+ {exit_source:"child\|timeout\|launcher"}?` — built at `lane-run.sh:1126-1138`; all three are **omitted, not false/null**, when inapplicable |
| `alert` | 11 sites | `{kind:…}` discriminated: `worker_timeout`/`worker_launcher_error` (`worker-run.sh:212,216`), `grok_secrets_refused` (`lane-run.sh:346`), kill-escalation (`:395`), `ownership_timeout` (`:653`), `{kind:"degraded",reason:"launcher_absent"}` (`:966`), `round_incomplete` (`:1229`), abandoned / `resume_refused_dirty` (`lane-supervise.sh:261,300`), watch bridge/stall alerts (`watch.sh:476,495,1226,1235`) |
| `resume` | `lane-supervise.sh:334` | resume attempt record |
| `merge_base` | `merge-gate.sh:101` | `{merge_base:"<sha>", degraded:<bool>}` (`merge-gate.sh:100`) |
| `heartbeat_rollup` | **synthesised by `el_compact`, never by `el_emit`** | `{count, first_seq, last_seq, first_ts, last_ts}` (`lib/eventlog.sh:386-389`) |

### 2.4 The attempt entity

`el_attempt_new RUN LANE` (`lib/eventlog.sh:212-242`):

- one monotonic counter **per lane per run**, starting at 1, persisted to
  `runs/$RUN/attempts/$LANE.attempt` (`:219`), tmp+rename (`:234`);
- serialised under a **sibling** `.attempt.lock`, deliberately not
  `el_emit`'s `.seq.lock`, so attempt allocation never contends the hot emit
  path (`:193-206`);
- the id is **plain payload content** as far as `el_emit` is concerned
  (`:204-206`); callers embed it as `payload.attempt`;
- `lane-run.sh:838-842` degrades to `attempt=1` on failure rather than
  aborting the round.

Attempt is the closest thing Foreman has to the paper's *experiment node*
(`SOURCE-karpathy-graph-engineering.txt:150-160`: "a commit node can carry:
the parent commit, the agent that created it, the hypothesis, the code diff,
the metric, the runtime … the keep-or-discard status").

### 2.5 Read / replay semantics

`el_read RUN FROM_LINE` (`lib/eventlog.sh:146-177`):

- validates **every** line with `jq -e .` *before* applying the from-cursor
  skip (`:159`), so corruption at or before the cursor still yields rc 2;
- strips a trailing `\r` at exactly one point (`:158`) — Windows `jq.exe`
  writes CRLF;
- rc 0 = clean EOF (including a missing log), **rc 2 = stopped at a malformed
  line or a torn tail**, which may be a benign in-progress append (`:139-140`);
- prints only the valid prefix, never partial garbage.

`el_read_after RUN ATTEMPT [TYPE]` (`lib/eventlog.sh:262-285`) — attempt-filtered
replay, e.g. `el_read_after RUN 3 checkpoint`. Layered **on top of** `el_read`
(reads the whole log from line 0, then jq-filters, `:271-282`) so it inherits
the torn-line contract byte-for-byte and propagates rc unchanged. It is a
**pure read: it never touches any cursor file** (`:252-254`).

Cursors (`el_cursor_get` `:181`, `el_cursor_commit` `:188`) are **integer
physical-line numbers**, per consumer, committed after processing —
at-least-once delivery. `nats-bridge.sh` is the only production consumer.

### 2.6 Compaction

`el_compact RUN N_DAYS` (`lib/eventlog.sh:332-427`):

- collapses **only physically-contiguous same-lane `heartbeat` runs older than
  the cutoff** into one `heartbeat_rollup` line each; the predicate is
  `is_collapsible: .type == "heartbeat" and (.payload.state // null) == null
  and .ts < $cutoff` (`:374`);
- an interleaved other-lane heartbeat or any structural event **starts a new
  rollup rather than merging across it** (`:293-296`) — adjacency is never
  fabricated;
- every other event (`prompt`, `checkpoint`, `round_done`, `alert`, `state`,
  `ownership`, `resume`, `merge_base`, `waiting_child`) is **untouched, in
  place, at its original seq** (`:289-292`);
- atomicity: build `.tmp` → `jq -e` validate **every** line → `mv`; on any
  failure the original is untouched and rc is 1 (`:298-304`);
- it acquires **`el_emit`'s own `.seq.lock`** (`:306-313`) because it rewrites
  `events.jsonl` itself;
- known caveats, self-documented: seq gaps grow (`:315-328`); a consumer's
  line-number cursor silently re-resolves to a different physical line after a
  compaction that touched the range behind it (`:325-328`); the cutoff needs
  GNU `date -d`, and a BSD `date` **fails safe** with rc 1 (`:40-43`).

### 2.7 Checkpoints

`ckpt_snapshot WT LANE` (`lib/checkpoint.sh:13-53`) snapshots the working tree
to `refs/checkpoints/<lane>` using an **isolated index** (`GIT_INDEX_FILE` on a
mktemp, `:19-27`) so the running agent's own index/HEAD are never touched, and
a **compare-and-swap `update-ref <ref> <new> <old>` loop with 5 retries**
(`:33-50`) so concurrent snapshots of one lane cannot orphan each other.
`ckpt_latest` (`:61`) distinguishes "no checkpoint yet" (rc 0, empty stdout)
from "for-each-ref failed" (rc 1) — a real git failure (`:58-60`).

`resume.sh:59-97` resolves the restore point **from the event log first**, with
commit-first precedence: `select(.lane == $lane and (.type == "checkpoint" or
.type == "round_done")) | (.commit // .payload.checkpoint // empty)`
(`resume.sh:73-74`), falling back to the `refs/checkpoints/<lane>` ref. It
tolerates `el_read` rc 2 and uses the valid prefix (`resume.sh:240-242`).

---

## 3. Where a work-DAG already exists implicitly

Foreman already stores, in durable form, most of the node/edge material the
paper's §V.A commit-DAG needs:

| DAG element | Where it lives today |
|---|---|
| experiment node | the `(run, lane, attempt)` triple — `attempts/<LANE>.attempt` (`lib/eventlog.sh:219`) + `payload.attempt` |
| parent state | `merge_base` event `{merge_base, degraded}` (`merge-gate.sh:100`) + `refs/checkpoints/<lane>` parent chain (`lib/checkpoint.sh:42` `commit-tree … -p $parent`) |
| code diff | `refs/checkpoints/<lane>` commit tree (a real git commit, gc-safe) + `evidence/patch.diff` (`audit-run.sh:46`) |
| the agent that produced it | `payload.config_dir` / the `LANE_VENDOR`-mapped home in the `ownership` event (`lane-run.sh:649`); the pueue group in `lane-queue.sh:422` |
| runtime / process identity | `ownership` `{pid, launcher_pid, job_id}` |
| keep-or-discard | `round_done.exit_code` + `gate-decision.json` (`gate-eval.sh:56,60`) + `audit-verdict.json` (`audit-run.sh:110`) |
| verdict | `adapters/verdict.schema.json` — `{verdict: APPROVED\|WARNING\|BLOCKED, summary, findings:[{severity: critical\|high\|medium\|low, file, line, summary, evidence}]}`, `additionalProperties:false` |
| merge decision | `merge-gate.sh` `MERGEABLE` / `NOT_MERGEABLE:<reason>` (exit 6, `:70-79`) |
| isolation unit | the git worktree + branch (`lib/worktree.sh:29,42`) |

### 3.1 Questions the event log CAN answer today

Answerable with `el_read` + jq alone, no new store:

1. What command started attempt N of lane L in run R? → `prompt.payload.cmd`.
2. Did lane L complete, and with what exit code and which checkpoint? →
   `round_done.{exit_code,checkpoint}` + top-level `commit`.
3. Was the round launcher-owned or degraded? → presence of `ownership`, plus
   `round_done.exit_source` and `alert{kind:degraded,reason:launcher_absent}`.
4. Which OS process owned a lane at time T? → `ownership.{pid,job_id}`.
5. How many attempts has lane L consumed, and what happened after attempt N? →
   `attempts/L.attempt` + `el_read_after RUN N`.
6. Was the lane resumed, how often, and was a resume refused for a dirty tree?
   → `resume` events + `alert{kind:resume_refused_dirty}`.
7. What base was this lane dispatched from? → `merge_base.merge_base`.
8. Where did the round stall — implement or gate? → `state{state:"verifying"}`
   is the phase boundary marker.
9. Did the round end without a fresh report? → `waiting_child` +
   `alert{round_incomplete}` with no `round_done` (the SC-D predicate,
   `lane-run.sh:1145-1150`).
10. Full ordered wall-clock reconstruction of any run → `seq` + `ts`.

### 3.2 Questions it CANNOT answer

These are the real gaps the graph plane must close:

1. **Which vendor produced this attempt.** `LANE_VENDOR` is exported into the
   process (`lane-run.sh:367`) and appears only *indirectly* as
   `ownership.payload.config_dir` (a path that happens to end in the vendor
   name). There is **no `vendor` field on any event**. Vendor attribution is
   inferred from a path string.
2. **Which model/effort.** `WC_GROK_MODEL` / `WC_CODEX_MODEL` /
   `WC_CODEX_REASONING_EFFORT` (`lib/worker-cmd.sh:53,63,64`) are never logged.
3. **The verdict.** `audit-verdict.json` and `gate-decision.json` are written
   to the run dir as **files, never as events**. `gate-eval.sh` and
   `audit-run.sh` do not source `lib/eventlog.sh` at all — confirmed: neither
   file contains an `el_emit` call. The audit/gate outcome is therefore
   **outside the lineage store**.
4. **Cross-run lineage.** `seq` and cursors are per-run
   (`$FOREMAN_HOME/runs/$RUN/`). There is no index over runs, no parent-run
   pointer, no way to ask "which runs descend from spec S".
5. **Cross-lane relationships.** Two lanes racing the same spec (the
   documented Grok-vs-Codex race, `SKILL.md:103`) share no identifier.
6. **Spec → attempt.** The five-part spec (`references/five-part-spec.md`) is a
   prose artifact handed to the implementer; `prompt.payload.cmd` records only
   the argv, and for `grok --prompt-file SPEC` the spec *content* is behind a
   path that may live in a worktree since deleted.
7. **Rework causality.** Nothing links "attempt 3" to "the finding in attempt
   2's verdict that caused it".
8. **Which findings recur.** Findings live in per-run JSON files with no
   cross-run key.
9. **Cost / tokens / wall-clock per attempt.** `elapsed_s` exists only inside
   mirrored launcher heartbeats (`worker-run.sh:182`), and only in hard mode.
10. **Human decisions.** The architect's merge/ask/never call under
    `[audit.policy]` is doctrine consumed by the *model* (`SKILL.md:250-259`),
    never recorded.

**Assessment:** the event log is a high-quality *per-run execution trace*. It
is not yet a *DAG* — there are no edges between runs, and the two most
decision-relevant artifacts (verdict, gate decision) never enter it.

---

## 4. graphify — PRIMARY (mandated substrate)

### 4.1 Exhaustive inventory of `graphify-out/`

Exactly two committed files. `.gitignore:15-23` deliberately excludes the rest:

```text
graphify-out/cost.json
graphify-out/graph.html
graphify-out/.graphify_*
graphify-out/.cache/
graphify-out/.experiment_*
graphify-out/cache/
graphify-out/manifest.json
```

| File | Size | Notes |
|---|---|---|
| `graph.json` | 2,761,285 B (2.63 MiB) | the graph |
| `GRAPH_REPORT.md` | 99,685 B | human/agent-readable report |

**`cost.json` is gitignored and does not exist in this checkout** — confirmed
absent. The only cost figure available is inside `GRAPH_REPORT.md:10`:
`- Token cost: 0 input · 0 output`. That is the honest answer: **the committed
graph was produced at zero LLM token cost.** 3,499 of 3,579 nodes carry
`_origin: "ast"` (deterministic parsing) and 3,666 of 3,668 edges carry
`_origin: null`; only 25 of 3,668 edges are `INFERRED` and 1 is `AMBIGUOUS`.
The last build was AST/heuristic, not an LLM extraction pass — consistent with
`GRAPH_REPORT.md:15` (``Run `graphify update .` after code changes (no API
cost)``). An `--update` therefore also costs ~0 tokens.

### 4.2 `graph.json` — actual schema

Top-level keys: `directed`, `multigraph`, `graph`, `nodes` (3,579), `links`
(3,668), `hyperedges` (6), `built_at_commit`. This is **NetworkX node-link
JSON** with three graphify extensions (`graph.hyperedges`, `built_at_commit`,
and the provenance fields).

**Node record** (union over all 3,579 nodes):

```json
{
  "id":              "scripts_lane_run_lane_vendor_env_var",
  "label":           "lane_vendor_env_var()",
  "norm_label":      "lane_vendor_env_var()",
  "file_type":       "code | document | concept | rationale",
  "source_file":     "skills/foreman/scripts/lane-run.sh",
  "source_location": "L206",
  "source_url":      null,
  "captured_at":     null,
  "author":          null,
  "contributor":     null,
  "rationale":       null,
  "metadata":        {"language":"bash","kind":"bash_entrypoint"},
  "_origin":         "ast",
  "community":       17
}
```

Distributions: `file_type` = document 2,621 / code 891 / concept 52 /
rationale 15. `_origin` = `ast` 3,499 / `null` 80 (the 80 are the
LLM/prose-extracted concept and rationale nodes). `community` spans 380
distinct values. `metadata` is present on 472 nodes only.

**Edge record** (union over all 3,668 links):

```json
{
  "source":           "research_fetch_frontier_docs_rationale_1",
  "target":           "research_fetch_frontier_docs",
  "relation":         "rationale_for",
  "confidence":       "EXTRACTED",
  "confidence_score": 1.0,
  "weight":           1.0,
  "source_file":      "docs/research/fetch_frontier_docs.py",
  "source_location":  "L1",
  "context":          null,
  "_origin":          null
}
```

Relation vocabulary (complete, with counts): `contains` 2835, `calls` 330,
`defines` 320, `references` 76, `imports` 26, `conceptually_related_to` 21,
`implements` 17, `cites` 10, `imports_from` 10, `rationale_for` 10,
`semantically_similar_to` 7, `shares_data_with` 3, `method` 2, `re_exports` 1.
Confidence: `EXTRACTED` 3642, `INFERRED` 25, `AMBIGUOUS` 1.

**Hyperedges** — 6, all `EXTRACTED` at confidence 1.0, each
`{id, label, nodes:[…], relation, confidence, confidence_score, source_file}`.
Notably they already encode Foreman's own pipeline doctrine as first-class
group relations: `default_soft_pipeline`,
`parallel_worktree_report_consolidation`, `no_silent_fallback_lanes`,
`soft_mode_delegation_pipeline`, `enhancement_changesets_cs1_cs4`,
`cross_vendor_separation_defense`.

**God nodes** (`GRAPH_REPORT.md:390-400`) are a *derived report section*, not a
node attribute — a degree ranking. Top entries: `Superpowers Release Notes` 41
edges, **`Foreman workflow bug/event log` 34 edges**, `Writing Skills` 23,
`main()` 21, `Foreman` 21. `Import Cycles: None detected` (`:414-415`).

**`GRAPH_REPORT.md` structure:** `## Corpus Check` (:3), `## Summary` (:7),
`## Graph Freshness` (:12), `## Community Hubs` (:17), `## God Nodes` (:390),
`## Surprising Connections` (:402), `## Import Cycles` (:414),
`## Hyperedges` (:417), `## Communities` (:425, 380 total, 64 thin omitted,
one `###` per community). Corpus check (`:4-5`): `344 files · ~576,991 words`.

### 4.3 Freshness — quantified drift

`graph.json.built_at_commit` = `d4af3a92d487151666398f38c13d2e46aaf1823b`
(= `d4af3a9 Merge v0.2.8.1 field-failure fixes`).
`GRAPH_REPORT.md:1` dates the build `2026-07-19`; `:13` repeats
`Built from commit: d4af3a92`.

Current HEAD is `1e21a81`. **3 commits of drift**:

| commit | |
|---|---|
| `8729e96` | `chore(graphify): refresh graph for v0.2.8.1` (the commit that added this graph) |
| `38ca006` | `fix(install): UTF-8 BOM on install.ps1 + bootstrap-windows.ps1 + launcher/build.ps1` |
| `1e21a81` | `plan(v0.2.9): WSL compatibility — … 6 OpenSpec/EARS packages …` |

`git diff --stat d4af3a92..HEAD` = **34 files changed, 31,511 insertions,
19,885 deletions**, of which **26 files are brand new and therefore entirely
absent from the graph** — including all 6 v0.2.9 OpenSpec packages
(`openspec/changes/{crlf-extensionless-hardening,wsl-ci-parity,
wsl-launcher-shipped,wsl-preflight,wsl-seam-doctrine,
wsl-tool-path-persistence}/*`) and both v0.2.9 planning docs
(`docs/superpowers/plans/2026-07-19-v029-wsl-compat.md`,
`docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`).

**Coverage:** the graph references 358 distinct `source_file` values;
`git ls-files` is 471. So ~76% of tracked files are represented — the gap is
mostly binary/lock/asset files plus the 26 new ones. **Zero dangling
references**: `comm -23` of graph source_files against `git ls-files` is
empty, i.e. no node points at a deleted file. The graph is
*incomplete-but-not-wrong* — safe to extend, cheap to refresh.

The graph knows it can go stale and says so in-band (`GRAPH_REPORT.md:12-15`):

```text
## Graph Freshness
- Built from commit: `d4af3a92`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).
```

### 4.4 Is graphify wired into any workflow today?

Six wiring points exist, but **only one is automated, and it is a no-op in CI**:

| Site | What it does | Automated? |
|---|---|---|
| `skills/foreman/scripts/maintenance.sh:249-289` (`run_graph`) | if `graphify-out/graph.json` exists **and** `graphify` is importable, runs `graphify . --update` (`:274`) or `"$graph_py" -m graphify . --update` (`:281`); sets `GRAPH_STATUS=ok\|stale\|skipped` | yes — but see below |
| `.github/workflows/maintenance.yml:23` | runs `maintenance.sh --stage upstream` **only**, with the in-file comment `CI lacks Graphify and developer CLIs, so only upstream drift is meaningful here` | the graph stage is **never** run in CI |
| `skills/foreman/SKILL.md:87-91` | doctrine: *"Graph before files. For repo understanding, query the committed graphify graph (`graphify query "…" --budget 1500`) before reading sources"* | advisory only |
| `README.md:595-605` | same doctrine + "refresh with `graphify --update`" | advisory |
| `env/tool-check.sh:298` (`SKILL_IDS`) and `env/reference-manifest.toml:227-233,323-324` | inventories the graphify module + skill link; `check = "python -c \"import graphify\""` | reports only |
| `skills/foreman/scripts/docs-check.sh:23` | excludes `skills/graphify` from lint | n/a |

There are **no git hooks** in the repo (nothing beyond the two workflows in
`.github/`), and no release-checklist step that refreshes the graph. The only
refreshes in history are the two manual `chore(graphify): refresh graph …`
commits. **Verdict: the graph is refreshed by hand, at release time, by the
architect.** That is the single biggest operational weakness of adopting it as
the substrate.

### 4.5 Is `graph.json` rich enough to carry Foreman work-DAG records?

**Structurally: yes. Semantically: not without a companion store.** Detail:

Fits natively:

- It is a `MultiDiGraph` (`multigraph: true`, `directed: true`), so multiple
  distinct edges between the same pair (attempt 1 `modified` file X, attempt 3
  `modified` file X) are representable without collision.
- Nodes are open property bags: adding `entity_type: "attempt"`, `run`,
  `lane`, `attempt`, `vendor`, `verdict` is schema-legal — nothing validates
  the key set.
- Provenance fields already exist per-edge (`confidence`, `confidence_score`,
  `source_file`, `source_location`) and map cleanly onto the paper's
  requirement (`SOURCE-karpathy-graph-engineering.txt:293-300`: "Attach
  provenance to every edge").
- `hyperedges` already encode multi-party workflow relations — a round
  (`spec → implementer → gate → auditor → merge`) is exactly a hyperedge, and
  three of the six existing ones already describe Foreman's own pipeline.
- Node ids are stable, human-legible, derived deterministically from
  `source_file` + symbol (`scripts_lane_run_lane_vendor_env_var`), which makes
  them usable as foreign keys.

Does **not** fit, and this is decisive:

- **`graphify --update` rebuilds from the filesystem.** Any node the harness
  injected that is not derivable from a file on disk is, at best, unspecified
  under an incremental rebuild. Nothing in the committed artifact records a
  "preserve these nodes" contract. Work-DAG records written directly into
  `graph.json` are at risk on every refresh.
- **No temporal/versioning axis.** `captured_at` exists but is `null` on every
  node in this build. There is no `valid_from`/`superseded_by`, which the
  paper calls out as required (`:293-300`: "temporal facts, versioned
  decisions, audit trails").
- **No transactional write path.** The paper's `publish(update, graph,
  validator)` with `tx.upsert_versioned_nodes` / `tx.link_run`
  (`SOURCE-karpathy-graph-engineering.txt:295-305`) has no analogue. Writing
  is "regenerate the whole 2.6 MiB file".
- **2.6 MiB single JSON blob, git-tracked.** Appending per-attempt records at
  round frequency would make it a merge-conflict magnet and inflate repo size.
  The event log deliberately avoids exactly this (append-only JSONL, one line
  per event, stored **outside** every worktree — `SKILL.md:277-278`).
- **Query interface is a CLI, not a library.** The documented access is
  `graphify query "<q>" [--budget N] [--dfs]`, `graphify path A B`,
  `graphify explain NODE` (`skills/graphify/SKILL.md` Usage block). A `--mcp`
  stdio server flag and `--neo4j`/`--falkordb` exports exist in the usage
  block but none of it is wired in this repo. (R7 owns package internals; this
  is surface-level only.)

**Recommendation:** use graphify as the *knowledge* plane exactly as the paper
prescribes (`:293-300`, "They should not be collapsed"), keep the work-DAG in
a companion append-only store keyed **by graphify node id**, and treat
`graph.json` as regenerable-from-source at all times. §9 specifies the join.

---

## 5. Vendor plumbing attachment points (adding `gemini` as a 4th vendor)

Every file:line that must change. Twelve sites, four of which are hard gates.

### 5.1 Hard blockers (a gemini lane cannot run until these change)

| # | Site | Current code | Change |
|---|---|---|---|
| V1 | `skills/foreman/scripts/lane-run.sh:206-213` | `lane_vendor_env_var()` — `case "$1" in grok) echo GROK_HOME ;; codex) echo CODEX_HOME ;; claude) echo CLAUDE_CONFIG_DIR ;;` | add `gemini) echo GEMINI_CONFIG_DIR` (or whatever the Gemini CLI honours). **This is the single most important line**: `lane-run.sh:305-307` rejects any unknown `LANE_VENDOR` with ``lane-run: bad LANE_VENDOR '$LANE_VENDOR' (grok|codex|claude)`` before anything else happens |
| V2 | `env/tool-check.sh:56-83` (`vendor_authed`) | `case` over `grok` (`:60-81`, a `timeout 10 grok models` stdout probe), `codex) codex login status` (`:82`), `claude) claude auth status` (`:83`) | add a `gemini)` auth probe. Note `:44` — *"never `grok -p` / `codex exec` / `claude -p`"*: the probe must not bill inference |
| V3 | `env/tool-check.sh:134-153` | per-vendor inventory rows: version string + `not_authenticated` + the printed remediation (`grok login --device-code` / `codex login` / `claude auth login`) | add a `gemini)` row |
| V4 | `skills/foreman/scripts/lib/worker-cmd.sh:42-75` (`wc_build_argv`) | two branches only — `grok` `:46-57`, `codex` `:58-66`; default branch dies `unknown worker vendor: $vendor` (`:67-74`). Header `:6-7` states *"v1 covers the two live worker vendors (grok, codex); claude is out of scope (REQUIRES-SEPARATE-HOME)"* | add a `gemini)` branch. The binding constraint is at `:2-6`: **the prompt must never arrive on stdin** — `foreman-launch` nulls CMD's stdin unconditionally. Gemini's CLI must accept a prompt file or positional arg |

### 5.2 Concurrency / isolation / scheduling

| # | Site | Current | Change |
|---|---|---|---|
| V5 | `skills/foreman/scripts/lane-queue.sh:422` | `for spec in grok:3 codex:2 claude:3 misc:2 gate:1; do lq_ensure_group …` | add `gemini:N`. **Governance constraint** at `:375-383` and `:415-421`: caps are pinned by the T5b destructive-concurrency verdict and *"A future cap raise here MUST cite a specific GREEN row added to that doc"* (`docs/research/vendor-concurrency-results.md`). A new vendor with no GREEN row must start at **1** ("default-on-doubt is 1") |
| V6 | `skills/foreman/scripts/wt-new.sh:106-109` | `mkdir -p "$VENDOR_HOME/grok" "$VENDOR_HOME/codex" "$VENDOR_HOME/claude"` — unconditional, all three, every worktree | add `"$VENDOR_HOME/gemini"` |
| V7 | `skills/foreman/scripts/wt-new.sh:256-258` | three `log "vendor-home (<v>): …"` report lines | add a fourth |
| V8 | `skills/foreman/scripts/lane-run.sh:357` | `: "${LANE_CONFIG_DIR:="$WT/.harness/vendor-home/$LANE_VENDOR"}"` | already generic — **no change needed**, provided V1 and V6 land |
| V9 | `skills/foreman/scripts/worker-run.sh:116-122,141-144,149` | hard-mode: `case "$VENDOR" in grok) _WC_PROMPT_ARG="/foreman-prompt.txt"` and `WORKER_ENV_ALLOW+=(GROK_HOME)` / `(CODEX_HOME)` | add gemini branches to all three `case`s; default vendor is `hard_mode.vendor codex` (`:74`) |

### 5.3 Readiness / auth gating

| # | Site | Current | Change |
|---|---|---|---|
| V10 | `env/tool-check.sh:273-279` | `must_soft=(git python3 grok codex foreman_skill)`, `must_full=(… grok codex docker flock …)`, `should_hard=(… grok codex)` | decide whether gemini is a **must** or a **should**. Making it a must breaks every existing host's READY verdict |
| V11 | `env/tool-check.sh:3,15,17` and `:403-416` | the `--lane grok\|codex\|claude` usage string; the `LANE_READY: <lane>=yes\|no` emitter is already generic (it just matches the row id) | usage text only |
| V12 | `skills/foreman/scripts/lane-run.sh:326-330` | `bash "$lane_repo_root/env/tool-check.sh" --profile soft --lane "$LANE_VENDOR"`, then greps for `LANE_READY: ${LANE_VENDOR}=yes`. Fails closed with *"run Setup (foreman-setup) before Use"* | generic once V2/V3 land |

### 5.4 The cross-vendor invariant — enforcement points

The invariant ("auditor vendor must differ from worker vendor") is enforced in
**exactly one place in code**, and stated in six places in prose:

| Kind | Site |
|---|---|
| **CODE (the only one)** | `skills/foreman/scripts/audit-run.sh:31-33` — `if [[ "$AUDIT_VENDOR" == "$WORKER_VENDOR" ]]; then die "$EXIT_CONFIG" "audit vendor ($AUDIT_VENDOR) must differ from worker vendor ($WORKER_VENDOR)"; fi`, reading `worker.vendor` (default `grok`) and `audit.vendor` (default `codex`) from `.foreman/config.toml` at `:27-29` |
| CODE (a second, narrower gate) | `audit-run.sh:35-37` — `if [[ "$AUDIT_VENDOR" != "codex" ]]; then die "$EXIT_MISSING_CLI" "audit-run currently only auto-invokes Codex …"`. **A gemini auditor is refused here outright.** |
| prose | `skills/foreman/SKILL.md:113` |
| prose | `skills/foreman/SKILL.md:320` ("What you never do") |
| prose | `README.md:44`, `README.md:165` |
| prose | `skills/foreman/references/lanes.md:156,162` |
| prose | `agents/codex-auditor.md` ("Default soft-mode audit lane when the implementer was Grok (or any non-OpenAI worker)") |

**Soft mode has no code enforcement of the invariant at all** — it is doctrine
the architect model is trusted to follow. This is the most important finding of
§5: adding a 4th vendor multiplies the routing matrix from 3×2 to 4×3 while
enforcement remains one `if` in a hard-mode-only script. `ROADMAP.md:238-239`
already flags the intended fix — *"The vendor≠worker invariant is centralized
in one shared `lib/audit-call.sh` and enforced at every tier"* — but schedules
it for **v0.4.0**, not v0.2.9.

### 5.5 Audit routing logic (what actually decides the auditor)

1. `.foreman/config.toml:7-9` → `[audit] vendor="codex" model="gpt-5.6-sol"`.
2. `audit-run.sh:27-29` reads them via `toml_get`, with hard-coded fallbacks
   `grok` / `codex` / `gpt-5.6-sol`.
3. `:31-33` equality refusal; `:35-37` codex-only refusal.
4. `:78-86` `codex exec --model "$AUDIT_MODEL" -c model_reasoning_effort=high
   --sandbox read-only --skip-git-repo-check --cd "$WT"
   --output-schema "$SCHEMA" --output-last-message "$OUT" - < "$PROMPT"`.
5. `:90-93` post-audit tamper check: `git status --porcelain` before/after must
   match, else `die … "auditor mutated the worktree — audit invalid"`.
6. `:98-112` normalise → `audit-verdict.json`; verdict must be one of
   `APPROVED|WARNING|BLOCKED`.
7. `gate-eval.sh:43-47` consumes it: schema-invalid ⇒ gate fail; `BLOCKED` ⇒
   gate fail.

Note `lib/config.sh:58-64`: `[audit.policy]` (`warning_low_resolved`,
`warning_medium`, `blocked`) is parsed and resolvable but *"Consumed today as
soft-mode architect doctrine only (SKILL.md); gate-eval.sh does not read them
yet"*. Confirmed against `gate-eval.sh` — it does not source `lib/config.sh`.

---

## 6. Workflow pain surface — bugeventlog.md failure taxonomy

Read in full: `bugeventlog.md`, 828 lines, 33 dated entries + addenda,
2026-07-16 → 2026-07-19. Format declared at `:5-6`.

### 6.1 Ranked taxonomy

| # | Class | Occurrences | Est. cost | Representative citations |
|---|---|---|---|---|
| **1** | **"Background-and-stop" attractor** — a subagent backgrounds a long command and ends its turn, stranding the work. **Self-counted in the log: 11+ occurrences across 3 vendors' models.** Variants: orphaned bats storms, leaked `gate.lock`, unwritten reports | **11+** | ~5 h + a manual resume every time | `:284-322` (the systemic entry, occurrences 1-4), `:395-408` (#5), `:409-416` (#6), `:466-476` (#7), `:497-506` (#8), `:507-524` (audit orphan, **~1 h of release gate**), `:557-560` (#9-11), `:648-676` (lands *on the task implementing its own fix*), `:730-742` (P1+P4, lock leak) |
| **2** | **Watchdog / liveness false signals** — file mtime is the wrong liveness key | 6 distinct modes | alert fatigue; 2 lanes left unwatched | `:96-113` (read-heavy + already-completed lanes), `:355-382` (stale artifact key), `:383-393` (missing dispatch grace), `:452-478` (bats writes to `/tmp`, not the worktree) |
| **3** | **Host contention corrupting the verification signal** — concurrent bats suites flake wall-clock tests | 5+ | ~5 redundant gate reruns; one **bad push on a misread exit code** | `:417-437`, `:479-496`, `:507-524`, `:707-729` (v0.2.7.5 AFK run) |
| **4** | **Process-lifecycle / orphan reaping** — timeouts that don't kill the process group | 4 | **~70 min** on one lane alone; 53 stray bash procs | `:180-217` (the 70-min entry), `:150-166`, `:60-70` (600 s timeout swallowed the report) |
| **5** | **Windows↔WSL seam defects** — CRLF, BOM, PowerShell parsing, exec bits, `LD_PRELOAD` | 5 | one *fully broken* Windows install, shipped twice | `:11-25` (CRLF), `:26-38` (Git-Bash PATH), `:610-637` (stdbuf/LD_PRELOAD), `:772-790` (`cmd /c mklink`), `:812-828` (BOM-less UTF-8 em-dash) |
| **6** | **Vendor-CLI behavioural surprises** | 4 | 2 wasted grok rounds; codex auditor unusable headless | `:114-148` (grok 4-way fan-out serialises at the CLI), `:791-811` (grok `--prompt-file` **single-burst writes nothing**), codex `--device-auth` falls back to localhost:1455 |
| **7** | **Merge / history hazards** | 3 | ~1,900 lines stranded behind a manual re-port | `:149-166` (parallel root commits, no merge-base), `:71-90` (`wt-merge` aborts on gitignored reports), `:438-451` (`wt-cleanup` lost V2-V4 audit reports **unrecoverably**) |
| **8** | **Gate/verification discipline breaches** | 3 | one force-merge without a clean suite | `:323-341` (a `bash -n`-only edit carried across a session boundary), `:677-706` (force-merge), `:707-729` (pushed on the wrong exit code) |
| **9** | **Doctrine/scope mismatches** | 2 | one whole mode bypassed | `:479-496` (architect violated own serialised-gates doctrine), worktree fan-out inapplicable to a stateful live target |
| **10** | **Audit wall-clock as critical path** | 1 (chronic) | 24-27 min *per merge*, serially | `:44-59` |

### 6.2 What the evidence says for "improve the workflow"

1. **Class 1 dominates and is prompt-immune.** The log states it directly at
   `:297-301`: *"Prompt discipline measurably does not fix this: the pattern
   survived direct, capitalized prohibitions in two different models."* The
   structural answer already exists in code — `lane-run.sh --round` owns the
   whole round so an agent turn ending cannot strand it (`lane-run.sh:53-55`,
   `:1140-1150`) — but **`.foreman/config.toml:29` has `durable.enabled =
   false`**, and the log at `:672-676` says the fix only applies *"When lanes
   are dispatched THROUGH lane-run --round under pueue (post-v0.2.5
   doctrine)"*. **The single highest-leverage workflow change available is to
   make round-mode dispatch the default path, not an opt-in.**
2. **Classes 2+4 are both "the filesystem is the wrong liveness oracle."** The
   log's own conclusion (`:474-478`): *"a lane in GATE state is not judged by
   file mtime at all — the runner emits a heartbeat event and the watchdog
   reads the event log, not the filesystem."* This is exactly the graph-plane
   argument: **query the lineage store, not the disk.**
3. **Class 3 is unfixed.** `:719-722` — the v0.2.5 gate mutex *"serializes
   bats-vs-bats but NOT bats-vs-heavy-non-bats-load"*. A multi-vendor release
   that adds a 4th concurrent lane group makes this strictly worse.
4. **Classes 5+6 are exactly the v0.2.9 WSL package scope** — the empirical
   justification for shipping those 6 packages is in this log.

---

## 7. Change packages under `openspec/changes/` (per the MAXIMAL-scope update)

9 live packages (8 more under `archive/`). Every one is **0% executed** — every
`tasks.md` has zero `[x]` checkboxes.

| Package | Tasks | Disposition | Primary files it will touch |
|---|---|---|---|
| `wsl-launcher-shipped` (P1, BLOCKER) | 0/6 | v0.2.9 | `env/bootstrap-wsl.sh`, `foreman-setup.sh`, `env/tool-check.sh`, `env/reference-manifest.toml`, `launcher/package.json`, `.gitignore` |
| `crlf-extensionless-hardening` (P2, BLOCKER) | 0/7 | v0.2.9 | `.gitattributes`, git index modes of 3 SDD scripts, a new line-endings test |
| `wsl-preflight` (P3) | 0/9 | v0.2.9 | new preflight script, `foreman-setup.sh`, `lane-run.sh` lane-start path |
| `wsl-tool-path-persistence` (P4) | 0/6 | v0.2.9 | `~/.foreman/env.sh`, `env/tool-check.sh`, `foreman-setup.sh`, **the grok readiness probe at `lane-run.sh:326`** |
| `wsl-ci-parity` (P5) | 0/5 | v0.2.9 | `.github/workflows/*` (adds `ubuntu-latest`), `tests/run.sh` |
| `wsl-seam-doctrine` (P6) | 0/7 | v0.2.9 | `references/*`, an exec-bit hygiene guard, `install.sh` |
| `hard-mode-launcher` | 0/6 | *"APPROVED SPEC (executed next release, not in v0.2.7.5)"* (`proposal.md:3`). **But `ROADMAP.md:108-121` says it SHIPPED in v0.2.8** and `worker-run.sh`/`pr-open.sh` are demonstrably real (431/108 L). Stale folder — see §8 |
| `v030-soft-mode-report` | 0/6 | *"APPROVED SPEC (executed next release)"*; the v0.3.0 re-port via per-commit `git am -3` |
| `el-emit-spawn-reduction` | 0/15 | **Also stale** — `ROADMAP.md:21-23` records the el-emit perf bundle as *merged* in v0.2.0, and the optimisation is visibly in the code (`lib/eventlog.sh:88-98`, the F5 `printf %()T` note; `:102-110`, the F6 note) |
| `test-harness-fork-tax` | 0/23 | Same: `ROADMAP.md:21-22` records it merged in v0.2.0 |

### 7.1 File-collision analysis (safe landing order for the maximal release)

Taking v0.2.9 = 6 WSL packages **+** multi-vendor (§5) **+** both graph planes
(§9), these are the genuine overlaps:

| Contended file | WSL package | Multi-vendor | Graph |
|---|---|---|---|
| `env/tool-check.sh` | **P1** (add a `foreman-launch` row), **P4** (PATH persistence + *"decouple the grok readiness probe from unit tests"*) | **V2, V3, V10, V11** (gemini probe + row + must-lists) | — |
| `skills/foreman/scripts/lane-run.sh` | **P3** (lane-start preflight), **P4** (readiness-probe decoupling at `:326`) | **V1** (`lane_vendor_env_var:206`), **V12** | **G** (new payload keys / vendor field on events) |
| `env/bootstrap-wsl.sh` + `foreman-setup.sh` | **P1, P3, P4** | V10 (gemini install/auth instruction) | — |
| `.github/workflows/` | **P5** | — | a graph-refresh job |
| `skills/foreman/scripts/wt-new.sh` | — | **V6, V7** | — |
| `skills/foreman/scripts/lane-queue.sh` | — | **V5** | — |
| `skills/foreman/scripts/maintenance.sh` | — | — | **G** (`run_graph:249-289`) |
| `.gitattributes` / git index modes | **P2** | — | — |

**Recommended landing order** (dependency-first, contention-minimising):

1. **P2 `crlf-extensionless-hardening`** — touches only `.gitattributes` and
   index modes; unblocks everything on ext4. Extend it per §8.
2. **P1 `wsl-launcher-shipped`** — a genuine BLOCKER: without it every fresh
   WSL clone runs `launcher_absent` and `lane-run.sh:966` emits
   `alert{kind:degraded}`. Round-ownership (the class-1 fix) depends on it.
3. **P4 `wsl-tool-path-persistence`** — land the `tool-check.sh` refactor and
   the readiness-probe decoupling **first**, so V2/V3/V10 apply on top of a
   settled file instead of racing it.
4. **Multi-vendor V1-V12** — after P4, `tool-check.sh` and `lane-run.sh` are
   stable. Do V1+V4 (the two hard `case` statements) together; V5 lands the
   gemini pueue group at cap **1** per `lane-queue.sh:375-383`.
5. **P3 `wsl-preflight`** — after V1/V12, so the lane-start preflight is
   written once against the final 4-vendor readiness path.
6. **Graph plane (§9)** — additive only: new event types via `el_emit` (which
   already treats types opaquely, `lib/eventlog.sh:26-27`) + a new projector
   script + `maintenance.sh` wiring. Touches `lane-run.sh` only to add a
   `vendor` payload key.
7. **P5 `wsl-ci-parity`** last — CI should assert the *final* surface.
8. **P6 `wsl-seam-doctrine`** — docs plus the exec-bit guard; can land any time
   after P2, but the guard should assert the §8-corrected invariant.

**No package conflicts with the graph or multi-vendor direction.** The only
true ordering hazards are the three-way contention on `env/tool-check.sh` and
`lane-run.sh`. Serialise those two files; everything else can fan out.

---

## 8. Honest gaps — documented but absent

### 8.1 The exec-bit defect is 33 files, not 3 (verified)

**Finding.** On a fresh clone, `git ls-files -s skills/foreman/scripts/` reports
**`100644` for all 35 entries** — every one of the 33 `.sh` scripts plus
`nats/setup.sh` and `adapters/verdict.schema.json`. On this checkout, 33 of them
are `755` on disk, and `git status --porcelain skills/` lists all 33 as ` M`
(mode-only diff; `core.filemode=true`).

**What chmods them.** `install.sh:61-63`:

```bash
# WSL: also ensure scripts executable
chmod +x "$SKILL_SRC/scripts/"*.sh 2>/dev/null || true
chmod +x "$SKILL_SRC/scripts/lib/"*.sh 2>/dev/null || true
```

`SKILL_SRC` is `$ROOT/skills/foreman` (`install.sh:5`) where `ROOT` is the repo
itself (`:4`) — so `install.sh` mutates the **working tree in place**. Nothing
else chmods these files: the only other `chmod`s in the repo are runtime
(`worker-run.sh:356` `chmod 0600 sandbox.env`, `pr-open.sh:86` `chmod 0700
$ASKPASS`) or inside bats fixtures. `env/bootstrap-wsl.sh` does not chmod them.

**Three distinct defects follow.**

- **(a) Scope gap in the chmod itself.** The glob covers `scripts/*.sh` and
  `scripts/lib/*.sh` — it **misses `skills/foreman/scripts/nats/setup.sh`**,
  which is still `644` on disk here even after install. Confirmed by
  `find … -printf "%m %p"`. A third glob is needed, or `find … -name '*.sh'`.
- **(b) `install.sh` permanently dirties the repo.** Because the index says
  `100644` and `core.filemode=true`, every installed clone shows 33 modified
  files forever. This is not cosmetic: `wt-cleanup.sh`'s dirty-worktree guard,
  the dirty refusal behind `alert{kind:resume_refused_dirty}`
  (`lane-supervise.sh:300`), and `wt-merge.sh`'s dirty-index refusal all key on
  worktree cleanliness. Running Foreman **on Foreman** therefore starts from a
  dirty tree by construction.
- **(c) A fresh clone that never runs `install.sh` is partly broken.** Most
  call sites are safe — inter-script calls use `bash "$SCRIPT_DIR/x.sh"`
  (`checks-run.sh:38`, `foreman-cleanup.sh:95`, `wt-new.sh:80`,
  `lane-run.sh:326`). But two are **not**:
  - `lane-supervise.sh:141` — `if candidate="$(command -v resume.sh …)"`
  - `watch.sh:700` — `if candidate="$(command -v lane-queue.sh …)"`

  `command -v` only resolves a PATH entry that is **executable**; on a fresh
  ext4 clone these fall through to their fallbacks. And `SKILL.md` instructs
  the operator/agent to invoke scripts **directly, with no `bash` prefix** —
  `SKILL.md:40` (``Run it via skills/foreman/scripts/foreman-setup.sh …``),
  `:60`, `:177`, `:180`, `:183`. Those instructions produce `Permission
  denied` on a fresh clone until `install.sh` has run.

**Conclusion for the v0.2.9 plan.** `openspec/changes/crlf-extensionless-hardening`
and `ROADMAP.md:181-184` scope P2 to *"3 extensionless SDD scripts"* under
`skills/superpowers/…/scripts/{review-package,sdd-workspace,task-brief}`. That
is a strict undercount. The correct remedy is `git update-index --chmod=+x`
over **all 33 `skills/foreman/scripts/**/*.sh`, plus `nats/setup.sh`, plus the
3 SDD scripts**, after which `install.sh:61-63` becomes a no-op (and should
stay, idempotently, for tarball installs). `openspec/changes/wsl-seam-doctrine`'s
"exec-bit hygiene" task should assert this as a repo-wide invariant test:
*every `#!`-led file tracked by git has index mode 100755*.

### 8.2 Other documented-but-absent claims

| Claim | Where claimed | Reality |
|---|---|---|
| `[audit.policy]` is a gate policy | `.foreman/config.toml:48-54`, `SKILL.md:250-259` | `lib/config.sh:62-64` admits *"gate-eval.sh does not read them yet"*. Confirmed: `gate-eval.sh` never sources `lib/config.sh`. It is architect doctrine only |
| `hard-mode-launcher` is an unexecuted spec | `openspec/changes/hard-mode-launcher/proposal.md:3` | `ROADMAP.md:108-121` says it shipped in v0.2.8; `worker-run.sh` (431 L) and `pr-open.sh` (108 L) are real. **The change folder is stale and contradicts the ROADMAP** |
| `el-emit-spawn-reduction` / `test-harness-fork-tax` are pending | their `tasks.md` (0/15, 0/23) | `ROADMAP.md:21-23` records both merged into v0.2.0; the optimisations are visibly in `lib/eventlog.sh:88-110`. **Two more stale folders** |
| Durable lanes are the default | `SKILL.md:174-215` reads as the normal path | `.foreman/config.toml:29` — `enabled = false`. Round-ownership, the structural fix for the #1 failure class, is **off by default in this repo's own config** |
| `graphify` refresh is automated | `README.md:605`, `maintenance.sh:249` | `.github/workflows/maintenance.yml:23` runs `--stage upstream` only, with an in-file comment saying CI lacks graphify. Refresh is manual (§4.4) |
| CI covers the suite | implied by the "CI remains final authority" posture (`SKILL.md:276`) | Only two workflows exist, and `windows-smoke.yml:3-6` triggers **only on changes to `install.ps1` or itself**. `openspec/changes/wsl-ci-parity/proposal.md:5-9` states it plainly: *"the bats suite … runs on NO CI platform today"* |
| `audit.vendor` is configurable | `references/lanes.md:162` (*"empty = auto"*) | `audit-run.sh:35-37` hard-refuses anything but `codex` |
| Vendor≠worker is enforced | `SKILL.md:113`, `README.md:44,165` | Enforced in **exactly one line of code** (`audit-run.sh:31-33`), hard mode only. Soft mode has zero enforcement (§5.4) |
| `claude` is a supported worker lane | `wt-new.sh:109` provisions a claude vendor-home; `lane-run.sh:210` maps `CLAUDE_CONFIG_DIR`; `lane-queue.sh:422` gives it `claude:3` | `lib/worker-cmd.sh:6-7` — *"claude is out of scope (REQUIRES-SEPARATE-HOME)"*. There is no `claude` branch in `wc_build_argv`. **The claude lane is plumbed but cannot be built into an argv.** A gemini lane must not repeat this half-wiring |
| T5b concurrency caps | `ROADMAP.md:44-47` says caps stay `grok=1 codex=1` | `lane-queue.sh:422` actually ships `grok:3 codex:2`, raised by `ROADMAP.md:102-107` (v0.2.8). The v0.2.5 section is simply out of date |
| `graph.json` is current | `README.md:595` (*"This repo commits a knowledge graph"*) | 3 commits and 34 changed files stale; 26 files entirely unrepresented (§4.3) |
| `windows-smoke.yml` guards the Windows install | `ROADMAP.md:143-144` | It runs under `pwsh` (`windows-smoke.yml:17`), i.e. PowerShell 7. The v0.2.8.1 field failure (`bugeventlog.md:812-828`) was **specific to `powershell.exe` 5.1** ANSI decoding. The log's own proposed enhancement — *"extend the windows-latest CI smoke test to invoke via `powershell.exe` (5.1), not only `pwsh`"* — is **not implemented** |

---

## 9. Where the event log and graphify could be joined (NEW)

The paper is explicit that these are two planes, not one
(`SOURCE-karpathy-graph-engineering.txt:293-300`), and gives the exact edge
shape to connect them (`:301-310`):

```text
(agent_run_183) -produced->    (claim_441)
                -modified->    (commit_a81f)
                -evaluated_by->(evaluation_92)
(claim_441)     -about->       (entity_autoresearch)
                -supported_by->(source_readme)
                -supersedes->  (claim_238)
```

Foreman already owns both endpoints. What is missing is a **stable identifier
scheme**.

### 9.1 The two id spaces that exist today

| Plane | Id | Stability |
|---|---|---|
| Work | `(RUN, LANE, ATTEMPT)` — `runs/<RUN>/events.jsonl` + `attempts/<LANE>.attempt` (`lib/eventlog.sh:219`) | stable per run; **no cross-run key** |
| Work | `seq` (`lib/eventlog.sh:87`) | per-run, monotonic, gappy after compaction |
| Work | checkpoint SHA (`lib/checkpoint.sh:47`, `refs/checkpoints/<lane>`) | globally unique, git-durable |
| Work | `merge_base` SHA (`merge-gate.sh:100`) | globally unique |
| Knowledge | graphify node `id`, e.g. `scripts_lane_run_lane_vendor_env_var` | deterministic from `source_file` + symbol; **survives an `--update`** as long as the symbol survives |
| Knowledge | `(source_file, source_location)`, e.g. `("skills/foreman/scripts/lane-run.sh","L206")` | file path stable, **line number drifts on every edit** |

### 9.2 Proposed join keys — the specific identifiers

**JK-1 — the canonical work id: `foreman:run/<RUN>/lane/<LANE>/attempt/<N>`.**
Every event already carries `lane` at top level and `attempt` in payload for
`ownership`/`state`; the fix is to make `payload.attempt` **mandatory on every
event type**, which is schema-legal today (v2 fields nest inside payload only —
`lib/eventlog.sh:6-9`) and requires **no `el_emit` signature change**. `RUN` is
already the run-directory name. This is the paper's `agent_run_183`.

**JK-2 — work→knowledge: the checkpoint SHA is the bridge.** A checkpoint is a
real git commit (`lib/checkpoint.sh:42`), so `git diff-tree --name-only` over
it yields the exact set of `source_file` values that attempt touched. Those
strings are **already the graphify node key** (`nodes[].source_file`). So the
edge

```json
{"source":"foreman:run/dl2f/lane/impl-t3/attempt/2",
 "target":"scripts_lane_run",
 "relation":"modified",
 "confidence":"EXTRACTED","confidence_score":1.0,
 "source_file":"skills/foreman/scripts/lane-run.sh",
 "source_location":"L206",
 "provenance":{"checkpoint":"<sha>","event_seq":812}}
```

is derivable **mechanically, at zero LLM cost**, from data that already exists.
Resolve file→node by `source_file` equality; refine to the symbol node by
choosing the node whose `source_location` line number is the greatest one `<=`
the first changed hunk line. Fall back to the file-level node
(`_origin:"ast"`, `metadata.kind:"file"`, e.g. `install_sh_install`) when no
symbol matches — never guess.

**JK-3 — knowledge→work: `graphify_node_id` as an event payload key.** Adding
`payload.nodes: ["scripts_lane_run", …]` to `round_done` makes the reverse
lookup a plain jq filter over `events.jsonl`, with no index to maintain.

**JK-4 — verdict and finding ids: `foreman:verdict/<RUN>/<LANE>/<ATTEMPT>` and
`foreman:finding/<sha256(file+line+summary)>`.** The verdict schema already
requires `{severity,file,line,summary,evidence}` per finding
(`adapters/verdict.schema.json`), and `file` is a repo-relative path — i.e.
**the same key space as `nodes[].source_file`**. A content-hashed finding id
makes "which findings recur across runs" a graph query for the first time
(gap #8 in §3.2).

**JK-5 — vendor and model as first-class.** Add `payload.vendor`
(`grok|codex|claude|gemini`) and `payload.model` at the `prompt` emit site
(`lane-run.sh:851`), sourced from `$LANE_VENDOR` (already in scope there,
exported at `:367`) and the `WC_*_MODEL` vars (`lib/worker-cmd.sh:53,63`).
Without this, the multi-vendor release ships with **no queryable record of
which vendor did what** (§3.2 gap #1).

### 9.3 Concrete edge vocabulary for the joined graph

Reusing graphify's existing relation style (§4.2) plus 6 new predicates:

| Edge | From | To | Derived from |
|---|---|---|---|
| `produced` | attempt | verdict | `audit-verdict.json` presence |
| `modified` | attempt | graphify node | JK-2 (checkpoint diff) |
| `evaluated_by` | attempt | verdict | `audit-run.sh:110` |
| `gated_by` | attempt | gate-decision | `gate-eval.sh:56,60` |
| `descends_from` | attempt | attempt / merge_base sha | `merge_base` event (`merge-gate.sh:100`) + the checkpoint parent chain |
| `about` | finding | graphify node | finding `.file` → `nodes[].source_file` |
| `supersedes` | attempt N+1 | attempt N | `attempts/<LANE>.attempt` monotonicity |
| `participate_in` | round hyperedge | {spec, implementer, gate, auditor, merge} | reuse graphify's existing hyperedge shape (§4.2), which already carries three Foreman-pipeline hyperedges |

### 9.4 Where the projector should live

A new `skills/foreman/scripts/graph-project.sh` that reads `el_read RUN 0` plus
the checkpoint SHAs and emits a **separate** `graphify-out/worklog.jsonl`
(append-only, one record per attempt), with a merge step invoked from
`maintenance.sh` alongside `run_graph` (`maintenance.sh:249-289`).

Rationale, restating §4.5: `graphify --update` rebuilds from the filesystem, so
anything written **into** `graph.json` is at risk on every refresh. Keeping the
work-DAG in a sibling file keyed by graphify node id is the only design where a
routine `graphify --update` cannot destroy lineage. It also keeps `graph.json`
regenerable-from-source and avoids turning a 2.6 MiB tracked blob into a
per-round write target (which would recreate the `wt-merge`/gitignore and
merge-conflict pathologies already logged at `bugeventlog.md:71-90`).

### 9.5 Prerequisites, honestly

1. `graphify --update` must run **automatically** (post-merge hook or a CI
   job), otherwise node ids drift out from under the join — §4.3 already shows
   26 unrepresented files after only 3 commits.
2. `payload.attempt` must become universal (JK-1) — today only `ownership` and
   `state` carry it.
3. `gate-eval.sh` and `audit-run.sh` must emit events. Neither sources
   `lib/eventlog.sh` today. This is a small, additive, high-value change: it is
   what moves the *decision* into the lineage store.
4. `durable.enabled` must default true, or the event log is empty for most
   rounds and there is nothing to project.

---

## Appendix — one-line answers to the brief

- **Event schema:** frozen top level `{seq,ts,type,lane,commit?,payload}`
  (`lib/eventlog.sh:111-114`); 11 emitted types + 1 synthesised
  (`heartbeat_rollup`); v2 additions nest in `payload` only.
- **Attempt entity:** `el_attempt_new` (`lib/eventlog.sh:212`), per-run
  per-lane monotonic, sibling-locked, plain payload content.
- **Replay:** `el_read_after RUN ATTEMPT [TYPE]` (`:262`) — attempt-filtered,
  cursor-free, inherits `el_read`'s torn-line contract.
- **Compaction:** heartbeat-only, contiguity-preserving, atomic, fail-safe
  (`:332`).
- **Biggest workflow finding:** the background-and-stop attractor, 11+
  occurrences, prompt-immune, and its structural fix is shipped but disabled
  (`.foreman/config.toml:29`).
- **Biggest vendor finding:** the cross-vendor invariant is one `if` in
  `audit-run.sh:31-33`, hard mode only.
- **Biggest graph finding:** `graph.json` is structurally adequate and
  zero-token to refresh, but is rebuilt from the filesystem — so the work-DAG
  must be a companion store keyed by graphify node id, not rows inside it.
- **Biggest honest gap:** the exec-bit defect is 33 files, not 3, and
  `install.sh:61-63` is both the cause of the permanently dirty tree and an
  incomplete fix (it misses `scripts/nats/setup.sh`).
