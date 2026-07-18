# DRIFT AUDIT — v0.2.5 plan (2026-07-16) vs shipped v0.2.0 (main @ fe61fa1)

**Scope:** `docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md`
was frozen 2026-07-16, before the durable-lanes Round B rework (T3 lane-run,
T5 watch), the T7 config loader (`c829628`), and the perf bundle landed and
were tagged **v0.2.0** by 2026-07-17. The plan repeatedly treats
already-shipped work as still-to-do.

**Method:** direct source reads with `git blame`/`git log` for provenance.
Shipped code files all carry mtime 2026-07-16/17; the four Round B lane-run
fixes and three T5 watch fixes are present on main.

## Per-task drift table

| Plan claim | Shipped reality (file:line) | Required amendment | Sev |
|---|---|---|---|
| **T2:** lane-run integration must "fold in the four Round B audit fixes: prompt-emit must not abort CMD; reap bg loop before final checkpoint; signal forwarding; stream-activity scoped to current round" | **All four already shipped.** (1) prompt-emit guarded `lane-run.sh:302-304`; (2) watcher reaped immediately after CMD, before finalization checkpoint `lane-run.sh:436-452`; (3) signal handling = non-exiting pending-signal trap during lock acquisition `:235-292` + INT/TERM cleanup traps `:280-281` + bounded TERM→KILL + taskkill sweep `:119-177`; (4) round-scoped activity via `round_start_epoch`/`round_start_size` size-growth `:327-344,355-396` | Delete the "fold in the four Round B fixes" clause. Rescope T2 to ONLY: launcher spawn, ownership event, WAITING_CHILD terminal rule. Re-running these as "new work" risks regressing audited code. | MED |
| **T4:** watch.sh v2 "folds in the three Round B T5 audit fixes: malformed-ts must not reset age; alert emission foreground/reaped; restart-safe completion check" | **All three already shipped in the 3-state watcher.** (1) malformed-ts keeps prior good epoch or forces WARN-range, never resets to start `watch.sh:246-262`; (2) alerts emitted in foreground, status-checked, explicit "Emit in the FOREGROUND" `:388-392,402-411`; (3) restart-independent DEAD arming `wd_state:39-62` + seq-baseline round-boundary completion `:104-137,224-232` | Delete the "folds in the three T5 fixes" clause. Rescope T4 to ONLY the typed-state expansion (10 states) + phase-aware thresholds. | MED |
| **T7:** "config keys ([launcher], [queue], [freshness], threshold overrides)" and "[audit.policy]" policy keys | Shipped loader is a **closed allowlist**, not generic. `config.sh` parses ONLY `[durable]`/`[nats]`; every other section is skipped untouched (`:71-75`); storable keys are a hardcoded 9-key `case` (`:90-97`) plus a hardcoded `_CFG_ENV_VAR` table (`:24-35`). Interface is `cfg_load` then `cfg_get SECTION KEY DEFAULT` (`:116,150`). Thresholds already live under `[durable]` (`stall_warn/stall_dead`, `.foreman/config.toml:28-33`); `watch_tick` is env-only, deliberately NOT TOML-storable (`:16-23,96`). | T7 must (a) use the `cfg_load`/`cfg_get` interface (not invent a new one); (b) for EVERY new key, edit both the `_cfg_parse_toml` case allowlist AND `_CFG_ENV_VAR`, or the key silently no-ops; (c) put new typed-state thresholds under the existing `[durable]` namespace rather than a parallel `[freshness]` threshold home; (d) `[audit.policy]` parses as a section header (dot allowed by `:67` regex) but is skipped — needs an allowlist entry. Plan as written wires nothing. | HIGH |
| **T3:** schema v2 adds top-level `checkpoint?` field; "additive, no breakage" | Shipped SHA is the top-level **`commit`** field (`eventlog.sh:50`), and `resume.sh:74` reads `(.commit // .payload.checkpoint // empty)` — it does NOT read a top-level `.checkpoint`. A new `checkpoint?` field would be silently ignored by the resume path. | Reuse `commit` for the checkpoint SHA, OR update `resume.sh:74` (and watch consumers) to read `.checkpoint`. Naming collision is a real breakage, not additive. | HIGH |
| **T3:** events carry top-level `{run, attempt, state?, pid?, job_id?, worktree?, config_dir?, merge_base?}` | `el_emit` signature is fixed 5-positional `el_emit run type lane payload [commit]` (`eventlog.sh:19-20`); it writes only `{seq,ts,type,lane,commit?,payload}` (`:48-51`). No `run`/`attempt`/state fields exist; extra data currently nests in `payload`. Adding top-level fields = signature change across 6+ call sites, not additive. | Nest v2 fields inside `payload` (truly additive), OR accept an `el_emit` signature change and migrate all callers. `el_attempt_new` does not exist yet. | MED |
| **T3:** "does anything shipped conflict — validation regexes, PIPE_BUF line limits?" | `el_read` does NO field-schema validation — only `jq -e .` JSON well-formedness (`eventlog.sh:96`), so additive fields never trip it. **PIPE_BUF is a non-issue:** `el_emit` serializes the entire read-modify-append under the `.seq.lock` mkdir mutex (`:32-66`), so append atomicity does not depend on PIPE_BUF; larger v2 lines won't tear under concurrent lanes. BUT `el_read` halts (rc 2) at the first torn/malformed line (`:96-99,104-110`). | No regex/PIPE_BUF blocker — plan's concern is unfounded on the emit path. Real constraint: `el_compact` rollup lines must be written atomically (tmp+rename), because one malformed compaction line stops ALL downstream reads. | MED |
| **T3:** "Cursor semantics extended: replay after attempt X checkpoint Y" | Cursors are pure **line numbers** (`el_cursor_get`/`commit`, `eventlog.sh:116-128`); `nats-bridge.sh:195,250,302,307` depends on the integer cursor. No attempt/checkpoint dimension exists. | Attempt/checkpoint replay is net-new; it must be layered WITHOUT changing the line-number cursor `nats-bridge` reads, or the bridge breaks. | MED |
| **T6:** "wt-merge gitignored-FOREMAN_REPORT bug is unfixed" | **Confirmed present.** `wt-merge.sh:57` (status names reports in pathspec) and `:59` `git add -A -- ':!FOREMAN_REPORT.md' ':!FOREMAN_REPORT.json'`. Unchanged since `0001bc0c` (2026-07-15, blame) — predates both the bug report and the plan. Abort documented `bugeventlog.md:103-125`; "still broken — v0.2.5 T6 fixes it" `resume-checkpoint.md:49`. `.gitignore:20-21` ignores the reports. | Claim is ACCURATE — no drift on the claim. Refinement: the shipped code ALREADY uses the exclude-pathspec the bugeventlog floated as a candidate, and it STILL aborts (`bugeventlog:106-108`). The fix must stop NAMING the report paths in ANY pathspec at BOTH `:57` and `:59` (build the add-list from `status --porcelain` file output; porcelain never lists ignored files), and the bats case must use a genuinely gitignored tree — the existing test #46 used a non-ignored tree (`bugeventlog:115-117`). | LOW |
| **T2 / check 6:** ownership + waiting_child vs shipped vocabulary | Shipped event types: **prompt, heartbeat, checkpoint, round_done, alert** (lane-run `:85,302,363,389,508`; watch `:390,409`). New `ownership`/`waiting_child` names don't collide. But the plan's "What we already have" table (`plan:28`) lists lane-run's events as only "prompt, heartbeat/checkpoint loop, round_done" — it **omits `alert`**. | No name collision. Correct the inventory: `alert` already exists and must be represented in schema v2 (T3) and in the watch v2 state model (T4). | LOW |
| **Check 7:** insert foreman-launch between lane-run and CMD; "shipped contract compatible?" | Shipped code already forward-references `foreman-launch@0.2.5` (`lane-run.sh:64,80` — `emit_kill_alert` payload hardcodes `full_tree_kill_via:foreman-launch@0.2.5`), so intent is aligned. But live contract lines break on insertion: `cmd_pid=$!` (`:432`) would capture the LAUNCHER pid, voiding "wait $cmd_pid yields CMD's real exit status" (`:410-413`); `rc` (`:434`) would carry launcher codes 124/125, changing `round_done.exit_code` meaning (`:499-505`); `kill_cmd_bounded`+taskkill sweep (`:119-177`) become redundant/conflicting with Job-Object KILL_ON_JOB_CLOSE; `< /dev/null` stdin (`:428,430`) must be forwarded by the launcher, but the frozen foreman-launch contract (`plan:80-82`) omits stdin handling; the header CONTRACT block (`:6-18`, "CMD shares lane-run's process group, job control REMOVED") is superseded once the launcher owns a Job Object/PGID. Usage line shape is unchanged. | T2 must specify: gate the taskkill/kill_cmd_bounded path to launcher-ABSENT fallback only; redefine `round_done.exit_code` to document 124/125; extend the foreman-launch contract to forward `/dev/null` stdin; rewrite the header CONTRACT reasoning. | MED |

## The 5 most important amendments (priority order)

1. **T7 — the config loader is a closed allowlist, not an open one (HIGH).**
   `[launcher]/[queue]/[freshness]/[audit.policy]` will silently no-op unless
   T7 edits `config.sh`'s `_cfg_parse_toml` case (`:90-97`) AND
   `_CFG_ENV_VAR` (`:24-35`) for every new key, and uses the shipped
   `cfg_load`/`cfg_get` interface. Fold new thresholds into the existing
   `[durable]` namespace rather than a parallel `[freshness]` home.

2. **T3 — resolve the `checkpoint` vs `commit` field collision (HIGH).**
   Shipped SHA is top-level `commit`; `resume.sh:74` reads
   `.commit // .payload.checkpoint`, never a top-level `.checkpoint`. Reuse
   `commit`, or the "additive" schema silently drops checkpoint recovery.

3. **T2 & T4 — strike the already-shipped Round B fixes (MED, but highest
   rework risk).** All four lane-run fixes and all three watch T5 fixes are on
   main (citations above). Rescope T2 to launcher/ownership/WAITING_CHILD and
   T4 to the typed-state expansion; re-implementing audited fixes is pure
   regression risk.

4. **Check 7 — foreman-launch insertion is a contract change, not a drop-in
   (MED).** `cmd_pid`/`rc` semantics, the taskkill sweep, and stdin forwarding
   all change. T2 must gate the existing kill path to launcher-absent
   fallback, document exit codes 124/125 in `round_done`, and extend the
   foreman-launch contract to forward `/dev/null` stdin.

5. **T3 — retarget the "conflict" analysis (MED).** PIPE_BUF is a non-issue
   (the `.seq.lock` mutex serializes all appends) and `el_read` does no field
   validation — so additive fields are safe. The real constraints are: keep
   the integer line-number cursor intact for `nats-bridge`, and make
   `el_compact` write atomically since `el_read` halts on the first
   torn/malformed line.

Minor: T6's "unfixed" claim is accurate (no drift) — only refine the fix to
stop naming reports in pathspecs at both `wt-merge.sh:57` and `:59`. The
plan's shipped-event inventory (`plan:28`) omits the existing `alert` type;
add it before T3/T4 consume the vocabulary.
