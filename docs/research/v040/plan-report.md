# FOREMAN_REPORT

- run_id: v040
- role: plan
- slug: fast-audit
- branch: foreman/v040/plan/fast-audit
- worktree: C:/Users/charl/foreman-wt-v040-plan-fast-audit
- base_sha: 3eb9d05ce48fcd5a605dc18d71d9b9f71afbac53
- status: complete

## Summary

v0.4.0 makes the audit stage tiered, sharded, cache-aware, and overlapped with
implementation instead of one monolithic serial high-effort pass. The core
combination: a **medium-effort screen pass** classifies hunks by risk and
routes only flagged/always-deep regions to **high-effort deep audit**
(mechanical/config-only diffs never pay the 27-min tax); large diffs get
**sharded** by file with a mandatory cheap **structural pass** to catch
cross-file findings sharding would otherwise lose; a **hunk-hash cache**
(shared by scoped re-audit and by the new checkpoint-**stream** audit) makes
repeat/incremental audit near-free for unchanged code; the architect
pre-packages an **AUDIT_BUNDLE** (diff + criteria + graphify hits + relevant
excerpts) so the auditor spends no turns on recon; and where durable-lanes
(v0.2.0) checkpoints exist, an audit lane consumes them **during**
implementation via the shared event log, so only the final small delta plus a
fast consolidation happen after the worker reports done. Session-transport
(v0.3.0) resume is wired as an **interface** (adapter contract) the audit
dispatcher calls when available, not reimplemented here. Every tier keeps the
sacred invariant — auditor vendor family != worker vendor family, enforced by
one shared function, never duplicated — and gate-eval fails closed if a
mandated deep pass didn't actually run.

## Goals and non-goals

**Goals**
- Median audit wall-clock for a typical (non-security-sensitive,
  single/few-file) change < 10 min, without weakening rigor where it matters.
- Deep, high-effort, cross-vendor audit still happens for anything
  auth/crypto/concurrency/secrets/shell/cross-cutting, and for the audit
  tooling's own code (self-referential: a bug in the auditor defeats every
  future audit).
- Config-driven risk to (vendor, model, effort, scope) routing, not hardcoded.
- Reuse v0.2.0 (event log, checkpoints, watchdog) and v0.3.0 (session
  transport) primitives; do not re-implement either.

**Non-goals**
- Not reimplementing codex mcp-server / session transport (v0.3.0 owns it).
- Not building Docker hard-mode IMPLEMENT workers (`worker-run.sh` stays a
  stub; this plan's stream tier is speced for whichever lane runner emits
  checkpoints, soft or hard).
- Not flipping `audit.mode` default from `legacy` to `tiered` in this release
  (opt-in first; see Open questions #3).
- Not changing the worker-side five-part-spec contract.

## Architecture

### Chosen combination

| # | Proposal | Verdict | Why |
|---|---|---|---|
| 1 | Tiered screen->deep audit | **Accept, modified** | Biggest lever on median wall-clock; false-negative risk is real but boundable (see Risks #1) via always-deep categories/paths + periodic shadow-deep sampling to *measure* recall, not just assume it. |
| 2 | Sharded parallel audit | **Accept, modified** | Only above a file/size threshold (skip sharding for small diffs -- spawn overhead dominates below it); mandatory cheap whole-diff structural pass is non-optional, not a nice-to-have, because sharding provably loses cross-file findings otherwise. |
| 3 | Incremental checkpoint-stream audit | **Accept, contingent** | Converts latency from serial-after to overlapped-during -- the actual "flagship" win for the release goal. Contingent on v0.2.0's checkpoint_interval + watchdog landing as designed in `docs/superpowers/plans/2026-07-15-durable-lanes.md` Section 5 / lane-run; must fail *soft* to legacy end-of-round audit if those primitives are absent/disabled, never fail closed. |
| 4 | Audit bundle pre-packaging | **Accept** | Directly attacks the recon-time hypothesis; low risk, orthogonal to the others, extends `evidence-collect.sh`/`audit-run.sh` prompt assembly that already exists in miniature (task.md + plan.md + diff). |
| 5 | Scoped re-audits as first-class | **Accept, formalized** | Already practiced ad hoc (see `docs/superpowers/plans/2026-07-15-durable-lanes.md` audit-finding-keyed rounds); promote the informal practice to a real hunk-hash cache shared with #3 so there is one staleness mechanism, not two. |
| 6 | Session-transport leverage | **Accept, interface-only** | Mirrors the existing worker `adapter_session_run`/`adapter_session_can_resume`/`adapter_session_resume` contract already on `origin/dev/foreman-v1` (`skills/foreman/scripts/adapters/codex.sh`). Add the audit-side mirror; do not touch transport internals. |
| 7 | Effort/vendor routing table | **Accept** | `[audit.routing]` in `.foreman/config.toml`, keyed by risk_class; reuses the existing dotted-key `toml_get` (already handles nested tables -- confirmed in `skills/foreman/scripts/lib/common.sh`), no new TOML parser needed. |

### Rejected / deferred alternatives considered

- **Full N-way audit panel per tier (multi-vote)** -- rejected for v0.4.0: cost
  multiplies exactly the wall-clock this release is trying to cut; revisit only
  if shadow-sampling (Risk #1 mitigation) shows the screen tier's false
  negative rate is unacceptable even with always-deep categories.
- **Naive union-of-findings consolidation (no model call)** -- rejected: a pure
  set union can't judge severity interactions across shards (a low-severity
  finding in file A + a low-severity finding in file B can compose into a
  high-severity issue). Consolidation stays a real (cheap, medium-effort) model
  call, not string-concatenation.
- **Sharding by "dimension" (security/quality/regressions) instead of by
  file** -- rejected as the default: dimension-sharded auditors would each need
  the *whole* diff in context anyway (a security-dimension pass still needs
  every file), so it doesn't cut recon cost, only adds shard count. File
  sharding is where the actual context-size win is.
- **Auto-flip `audit.mode` default to tiered in v0.4.0** -- deferred to a
  follow-up release once shadow-sampling data exists (Open question #3).

### Sacred invariants (unchanged, made structurally harder to violate)

1. **Auditor vendor family != worker vendor family at every tier** -- screen,
   deep, shard, and stream all funnel through one shared check
   (`lib/audit-call.sh`, new in T3) instead of each entrypoint reimplementing
   the comparison. In `transport.mode = "mcp"`, the existing
   `enforce_mcp_decorrelation` (from `origin/dev/foreman-v1`,
   `skills/foreman/scripts/lib/common.sh`) is still the single source of truth
   for family comparison; new scripts call it, none duplicate it.
2. **Fail-closed gates.** `gate-eval.sh` rejects if a verdict is missing *or*
   if a risk class the routing table marks `always_deep` matched but no
   corresponding deep-tier record exists in `audit-meta.json`. A screen-tier
   APPROVED can never silently stand in for a mandated deep pass.
3. **Read-only sandbox at every tier** -- screen, shard-workers, structural
   pass, and stream calls all use `--sandbox read-only`; only the worker ever
   gets `workspace-write`.
4. **Diff is untrusted input** in every prompt variant (screen, shard,
   stream, consolidation) -- carried forward verbatim from the current
   `audit-run.sh` header.

## Verdict/consolidation schema changes

- New `verdict.schema.v2.json` (additive, versioned -- do not silently break
  `v1` consumers): adds `schema_version`, per-finding `tier`
  (`screen|deep|shard|stream|consolidation`), per-finding `hunk_id` (for cache
  keying/staleness), per-finding `escalate` (bool -- screen flags for deep),
  and top-level `audit_meta: {vendor, model, effort, tiers: [...]}`.
- New `$RD/audit-consolidated.json` -- the merged, tier-aware result for
  screen/shard/stream runs. `$RD/audit-verdict.json` (v1, single-call) keeps
  working unchanged for the `audit.mode = "legacy"` path.
- `gate-eval.sh` reads `audit-consolidated.json` when present, else falls back
  to `audit-verdict.json` -- additive, no forced migration in this release.

## Config keys (new, under `[audit]` in `.foreman/config.toml`)

```toml
[audit]
vendor = "codex"
model  = "gpt-5.6-sol"
mode   = "legacy"        # legacy | tiered -- opt-in this release (see Open Q3)

[audit.screen]
enabled = true
effort  = "medium"
# Non-overridable floor lives IN CODE (audit-screen.sh); config only ADDS paths/categories, never removes the floor.
always_deep_paths = [
  "**/auth/**", "**/crypto/**", "**/adapters/**",
  "skills/foreman/scripts/lib/checkpoint.sh",
  "skills/foreman/scripts/lib/eventlog.sh",
  "skills/foreman/scripts/gate-eval.sh",
  "skills/foreman/scripts/audit-run.sh*",
]
always_deep_categories = ["auth", "crypto", "concurrency", "secrets", "shell-injection"]

[audit.shard]
enabled             = true
min_files_to_shard  = 8
max_files_per_shard = 6
structural_pass     = true   # non-optional when shard.enabled

[audit.stream]
enabled          = false     # opt-in until checkpoint/watchdog wiring is proven (Risk #4)
min_interval_sec = 90
quiet_sec        = 20
max_inflight     = 1

[audit.cache]
enabled  = true
path     = ".foreman/audit-cache"
ttl_days = 14
noncacheable_classes = ["security_sensitive", "cross_cutting"]

[audit.session]
resume = true    # use mcp thread resume (v0.3.0) when transport.mode = "mcp"

[audit.routing]
[audit.routing.mechanical]
vendor = "codex"
model  = "gpt-5.6-sol"
effort = "low"
scope  = "screen"
[audit.routing.logic]
vendor = "codex"
model  = "gpt-5.6-sol"
effort = "medium"
scope  = "deep"
[audit.routing.security_sensitive]
vendor = "codex"
model  = "gpt-5.6-sol"
effort = "high"
scope  = "deep"
[audit.routing.cross_cutting]
vendor = "codex"
model  = "gpt-5.6-sol"
effort = "high"
scope  = "shard+deep"
```

All of these are read with the existing `toml_get FILE dotted.key default`
helper (confirmed nested-table capable) -- **no new TOML parser needed.**

## Task breakdown (ordered)

### T0 -- Verdict schema v2 + event taxonomy + gate-eval dual-read
- objective: Add `verdict.schema.v2.json` (additive fields: `schema_version`,
  finding `tier`/`hunk_id`/`escalate`, top-level `audit_meta`), define the
  audit timing event-type taxonomy every later task must emit, and make
  `gate-eval.sh` read `audit-consolidated.json` when present, else fall back
  to `audit-verdict.json` (v1), never breaking existing single-call audits.
- files: create `skills/foreman/scripts/adapters/verdict.schema.v2.json`;
  modify `skills/foreman/scripts/gate-eval.sh`,
  `skills/foreman/references/audit-checklist.md` (schema + event taxonomy
  table); do not touch `verdict.schema.json` (v1 stays as-is for `legacy`
  mode).
- interfaces: event types (payload keys in parens) -- `audit_screen_started()`,
  `audit_screen_done(verdict, escalate_count, ms)`,
  `audit_deep_started(risk_class)`, `audit_deep_done(verdict, ms)`,
  `audit_shard_started(shard_id, files)`, `audit_shard_done(shard_id, verdict, ms)`,
  `audit_structural_done(verdict, ms)`, `audit_consolidation_done(verdict, ms)`,
  `audit_stream_checkpoint(ckpt_sha)`, `audit_stream_audited(ckpt_sha, ms)`,
  `audit_cache_hit(hunk_id)`, `audit_cache_miss(hunk_id)`,
  `audit_session_resumed(thread_id)`. All emitted via existing `el_emit RUN_ID
  TYPE LANE PAYLOAD_JSON` (`skills/foreman/scripts/lib/eventlog.sh`) -- no new
  eventlog primitive needed, only new `type` string values.
- constraints: `verdict.schema.v2.json` must keep `additionalProperties:
  false` semantics per-object (no silent drift) but the top level must carry
  `schema_version` so `gate-eval.sh` can branch cleanly; v1 files (no
  `schema_version`) are treated as version 1. Do not remove or rename any v1
  field on the finding object.
- verification: a hand-built v2 sample validates against the new schema
  (match this repo's existing schema-validation test convention -- check
  `tests/*.bats` first); `gate-eval.sh` run twice -- once with only
  `audit-verdict.json` present (legacy path, must still pass/fail exactly as
  today) and once with `audit-consolidated.json` present (new path).
- depends_on: none

### T1 -- Config surface: `[audit.*]` keys + docs
- objective: Land every new config key above in
  `config/foreman.toml.example` with inline comments, and document the
  routing-table shape + the non-overridable-floor rule in
  `skills/foreman/references/lanes.md`.
- files: modify `config/foreman.toml.example`,
  `skills/foreman/references/lanes.md`.
- interfaces: exact TOML shape as in "Config keys" section above.
- constraints: every new key must have a safe default such that a repo with
  no `.foreman/config.toml` (or an old one missing `[audit.*]`) falls back to
  today's single-pass `legacy` behavior -- no key is required for existing
  behavior to keep working.
- verification: `python3 -c "import tomllib; tomllib.load(open('config/foreman.toml.example','rb'))"`
  parses cleanly; `toml_get .foreman/config.toml audit.routing.security_sensitive.effort`
  (against a throwaway copy of the example) returns `high`.
- depends_on: none

### T2 -- Screen tier: `audit-screen.sh` (hunk classification)
- objective: Medium-effort pass that classifies each diff hunk into
  `mechanical | logic | security_sensitive | cross_cutting`, applies the
  non-overridable always-deep floor (hardcoded) plus config-added
  `always_deep_paths`/`always_deep_categories`, and emits a screen verdict
  with an `escalate: [hunk_id, ...]` list -- conservatively biased toward
  escalation (a screen tier's job is recall, not precision).
- files: create `skills/foreman/scripts/audit-screen.sh`; reuse
  `skills/foreman/scripts/adapters/verdict.schema.v2.json` from T0.
- interfaces: `audit-screen.sh TASK_ID` writes `$RD/screen-verdict.json`
  (verdict schema v2, `tier: "screen"` on every finding, top-level
  `escalate: [...]` hunk ids). Hardcoded floor list (never removable by
  config) SHALL include at minimum: paths matching `**/auth/**`,
  `**/crypto/**`, `**/adapters/**`, and the audit-tooling's own scripts
  (`gate-eval.sh`, `audit-run.sh`, `audit-screen.sh` itself, `lib/*.sh`).
- constraints: `--sandbox read-only`; must still perform the vendor-not-equal-
  worker check via the shared function from T3 (temporal note: if T3 isn't
  merged yet, inline the check here first and let T3's refactor absorb it --
  do not ship T2 without the check present in some form).
- verification: run against a synthetic diff touching only a `docs/*.md`
  file -- screen verdict has empty `escalate`; run against a diff touching
  `skills/foreman/scripts/lib/checkpoint.sh` -- `escalate` is non-empty
  regardless of the diff's content (floor path override fires).
- depends_on: T0

### T3 -- Shared audit-call library (`lib/audit-call.sh`) + `audit-run.sh` refactor
- objective: Extract the common "build prompt, invoke codex exec with a given
  model/effort/sandbox, verify no worktree mutation, normalize JSON output"
  logic out of `audit-run.sh` into one sourced library function so every
  tier (screen, deep, shard, stream) calls the *same* code path for the
  cross-vendor check and the mutation-guard -- no per-entrypoint
  reimplementation to drift.
- files: create `skills/foreman/scripts/lib/audit-call.sh`; modify
  `skills/foreman/scripts/audit-run.sh` to source and call it (behavior must
  be byte-identical for `audit.mode = "legacy"`).
- interfaces: `audit_call RUN_ID VENDOR MODEL EFFORT PROMPT_FILE OUT_FILE
  SCHEMA_FILE` returns normalized JSON at `OUT_FILE`; internally performs
  the vendor-not-equal-worker check (fail with `EXIT_CONFIG` on violation),
  the `--sandbox read-only` invocation, the before/after `git status
  --porcelain` mutation guard, and JSON-fence stripping -- all logic
  currently inline in `audit-run.sh` lines ~27-112.
- constraints: no behavior change to the existing `legacy` path; this is a
  pure extraction. Do not add new flags to the extracted function beyond what
  T2/T4/T6/T7 need (documented next to each caller, not spec'd here).
- verification: re-run `audit-run.sh` against a known task dir from before
  the refactor and diff `audit-verdict.json` byte-for-byte against a
  pre-refactor capture.
- depends_on: T0

### T4 -- Shard + structural pass + consolidation
- objective: Above `audit.shard.min_files_to_shard`, split the diff by file
  into groups of at most `max_files_per_shard`, run one `audit_call` per
  shard in parallel, run one mandatory whole-diff **structural pass** (file
  list + changed function/interface signatures only, not full bodies --
  cheap, medium effort) to catch cross-file findings sharding would lose,
  then run one consolidation `audit_call` that merges shard + structural
  findings into `audit-consolidated.json` with a worst-of-severity verdict
  (never a naive union/max -- the consolidation call must exercise judgment
  on cross-shard severity interaction, per Architecture).
- files: create `skills/foreman/scripts/audit-shard.sh`,
  `skills/foreman/scripts/audit-consolidate.sh`.
- interfaces: `audit-shard.sh TASK_ID` shards, invokes `audit_call` (T3) per
  shard + one structural pass, writes `$RD/shard-N-verdict.json` and
  `$RD/structural-verdict.json`; `audit-consolidate.sh TASK_ID` reads all
  shard + structural verdicts, writes `$RD/audit-consolidated.json` (schema
  v2, `tier: "consolidation"`).
- constraints: below `min_files_to_shard`, `audit-shard.sh` SHALL no-op and
  hand off to a single deep `audit_call` instead (sharding below threshold is
  net-negative per Architecture's diminishing-returns analysis). Each shard
  call is still subject to the same vendor-check + read-only constraints
  (via T3, not reimplemented).
- verification: a synthetic 10-file diff produces exactly
  `ceil(10 / max_files_per_shard)` shard verdicts + 1 structural verdict + 1
  consolidated verdict; a synthetic finding split across two shards (e.g. an
  interface change in file A with a call site in file B) is caught by the
  structural pass even when neither shard flags it alone.
- depends_on: T3

### T5 -- Hunk-hash cache library (`lib/audit-cache.sh`)
- objective: One shared cache keyed by `hunk_id = sha256(file_path +
  normalized_hunk_text + N lines of surrounding context)`, storing
  `{hunk_id, verdict_contribution, findings[], audited_at, auditor_model,
  risk_class}` under `audit.cache.path`. Used by scoped re-audits (proposal
  5) and the stream tier (T6) as the *same* staleness mechanism.
- files: create `skills/foreman/scripts/lib/audit-cache.sh`; add
  `.foreman/audit-cache/` to `.gitignore`.
- interfaces: `audit_cache_lookup HUNK_ID` prints cached JSON entry or
  empty; `audit_cache_store HUNK_ID JSON_ENTRY`; `audit_cache_partition
  DIFF_FILE` splits a diff's hunks into `cached` (reuse verdict, emit
  `audit_cache_hit`) and `changed` (needs audit, emit `audit_cache_miss`) per
  `hunk_id`, respecting `ttl_days` and `noncacheable_classes` (a finding whose
  `risk_class` is in `noncacheable_classes` is never written to cache).
- constraints: cache entries expire at `ttl_days`; a cache-bust is required
  (documented, not automated this task) whenever `always_deep_paths`/
  `always_deep_categories` change, since a hunk's risk class can change
  without its text changing.
- verification: audit a diff twice unchanged -- second run is 100% cache
  hits, zero `audit_call` invocations; change one hunk -- only that hunk is a
  cache miss; a finding tagged `security_sensitive` is never present in the
  cache file after a run with `noncacheable_classes` including it.
- depends_on: T0

### T6 -- Incremental checkpoint-stream audit lane (`audit-stream.sh`)
- objective: A lane that consumes another lane's `refs/checkpoints/<lane>`
  commits (via `ckpt_latest`, `skills/foreman/scripts/lib/checkpoint.sh`) and
  the shared `events.jsonl` (via `el_read`/`el_cursor_get`/`el_cursor_commit`,
  `skills/foreman/scripts/lib/eventlog.sh`) to audit each checkpoint delta
  *during* implementation, throttled by `min_interval_sec`/`quiet_sec`
  (debounce: audit only after whichever fires first -- N seconds since last
  audit, or Q seconds of no new checkpoint). Findings write into the SAME
  run's `events.jsonl` (`audit_stream_audited`) tagged with `hunk_id`s from T5
  so staleness is handled identically to scoped re-audit.
- files: create `skills/foreman/scripts/audit-stream.sh`.
- interfaces: `audit-stream.sh RUN_ID LANE` is a long-running consumer loop;
  reads `ckpt_latest WT LANE`, diffs against the last-audited checkpoint (or
  `base_sha` for the first), calls `audit_cache_partition` (T5) + `audit_call`
  (T3, screen-tier effort) on the changed hunks only, emits
  `audit_stream_checkpoint`/`audit_stream_audited`. `max_inflight = 1` --
  never starts a new stream audit while one is running.
- constraints: WHERE `[durable]` primitives (checkpoint_interval,
  `refs/checkpoints/*`, watchdog) are absent or `audit.stream.enabled =
  false`, THE script SHALL no-op immediately and defer entirely to the
  end-of-round legacy/tiered audit -- fail soft, never block a merge on a
  missing v0.2.0 dependency. IF the worker rewrites a hunk after it was
  stream-audited, THEN that finding is marked stale (cache invalidated by T5,
  hunk_id changed) and excluded from final open findings, but its
  `events.jsonl` record is kept for provenance.
- verification: with a fixture lane emitting checkpoints on a timer, confirm
  audit calls fire no more often than `min_interval_sec` and do fire after
  `quiet_sec` of silence; confirm a rewritten hunk's earlier finding is absent
  from the final consolidated open-findings list but still present in
  `events.jsonl`; confirm the script no-ops cleanly when `refs/checkpoints/*`
  doesn't exist.
- depends_on: T3, T5; external: v0.2.0 checkpoint_interval + watchdog
  landing as designed in `docs/superpowers/plans/2026-07-15-durable-lanes.md`
  (confirm exact config key names before finalizing -- Open question #2)

### T7 -- Session-transport audit interface (mirrors worker contract)
- objective: Add the audit-side mirror of the existing worker session
  contract (`adapter_session_run` / `adapter_session_can_resume` /
  `adapter_session_resume`, already on `origin/dev/foreman-v1`
  `skills/foreman/scripts/adapters/codex.sh`) so a round-2+ re-audit of the
  same task reuses a warmed `codex mcp-server` thread instead of a cold
  `codex exec`. Interface only -- v0.3.0 owns the transport itself.
- files: modify `skills/foreman/scripts/adapters/codex.sh` (add
  `adapter_session_audit_run`, `adapter_session_audit_can_resume`,
  `adapter_session_audit_resume`, following the exact shape of the existing
  worker three); modify `skills/foreman/scripts/lib/audit-call.sh` (T3) to
  call these when `transport.mode = "mcp"` and `audit.session.resume = true`.
- interfaces: thread-id file is bound to the tuple `(task_id, worker_vendor,
  audit_vendor)` at creation (store alongside `thread-id`, e.g.
  `$RD/audit-thread-meta.json`); `adapter_session_audit_can_resume` SHALL
  return false (forcing a cold start) if the current invocation's tuple does
  not exactly match the stored one -- this is the fail-closed guard against
  reusing an audit thread across a changed worker vendor or a different task.
- constraints: never resume an audit thread across a different `task_id`
  (Open question #5 asks whether this is overly conservative -- ship
  conservative now). Still subject to `enforce_mcp_decorrelation`
  (unchanged, from `origin/dev/foreman-v1`).
- verification: round 1 audit creates a thread + meta file; round 2 re-audit
  of the same task resumes it (`adapter_session_audit_resume` invoked, no
  `codex exec` cold start in the transcript); a task-id or vendor mismatch
  forces a cold start instead of erroring.
- depends_on: T3; external: v0.3.0 (`origin/dev/foreman-v1`) merge for
  `adapter_session_run`/`enforce_mcp_decorrelation`/`transport_mode`

### T8 -- Audit bundle pre-packaging
- objective: Extend the prompt assembly already sketched in `audit-run.sh`
  (lines ~52-73: task.md + plan.md + diff) into a standalone `AUDIT_BUNDLE`
  artifact built once by the architect/harness before any tier runs: diff +
  acceptance-criteria excerpt + a targeted `graphify query` (callers of
  touched functions / existing tests over touched files) + full-body excerpts
  of any function whose signature changed or that the diff calls but doesn't
  define.
- files: modify `skills/foreman/scripts/evidence-collect.sh` (bundle
  assembly), modify `skills/foreman/scripts/audit-run.sh` (consume the
  pre-built bundle instead of inline assembly, for the legacy path too).
- interfaces: `evidence-collect.sh` writes `$RD/audit-bundle.md` (superset of
  today's `$RD/audit-prompt.md` header); all tiers (screen/deep/shard/stream)
  read from `audit-bundle.md` sections instead of re-deriving task.md/plan.md
  each time.
- constraints: graphify query is best-effort -- WHERE
  `graphify-out/graph.json` is missing or stale (per
  `graphify-out/GRAPH_REPORT.md`), THE script SHALL skip that section with a
  noted gap, never fail the bundle build.
- verification: `audit-bundle.md` for a fixture task contains a "## Graphify"
  section when the graph is fresh, and an explicit "graph unavailable/stale"
  note otherwise; `audit-run.sh` legacy path produces byte-identical
  `audit-verdict.json` output to before this change on the same fixture.
- depends_on: T3 (serializes on `audit-run.sh` with T3/T9 -- see
  Parallelism map)

### T9 -- Tiered dispatcher + routing-table wiring
- objective: Wire `audit.mode = "tiered"` end-to-end in `audit-run.sh`: run
  screen (T2) first, look up each escalated hunk's risk class in
  `[audit.routing]` (T1) to pick vendor/model/effort/scope, dispatch to deep
  (T3) or shard+structural+consolidation (T4) accordingly, and write
  `audit-meta.json` recording exactly which tiers ran (for `gate-eval.sh`'s
  T0 coverage check).
- files: modify `skills/foreman/scripts/audit-run.sh` (add the `tiered`
  branch alongside the existing `legacy` branch, selected by `audit.mode`).
- interfaces: `audit-meta.json: {mode, tiers_run: [...],
  mandated_deep_paths_covered: bool}` -- the exact field `gate-eval.sh` (T0)
  checks.
- constraints: `audit.mode = "legacy"` (the default per T1) SHALL produce
  byte-identical behavior to pre-v0.4.0 `audit-run.sh` -- this branch is
  strictly additive. The always-deep floor/paths (T2) always win over the
  routing table's `scope` even if routing would have said `screen`.
- verification: a fixture diff with one mechanical hunk and one
  `always_deep_paths`-matched hunk, under `audit.mode = "tiered"`, produces
  `audit-meta.json.tiers_run` containing both `screen` and `deep`, and
  `gate-eval.sh` passes; deleting the deep-tier output file and re-running
  `gate-eval.sh` alone now fails with "mandated deep pass missing" (T0's
  coverage check).
- depends_on: T2, T4, T1, T0 (serializes on `audit-run.sh` after T3, T8 --
  see Parallelism map)

### T10 -- Timing telemetry + before/after audit-metrics report
- objective: A report script that reads a run's `events.jsonl` and computes
  per-tier wall-clock (screen_ms, deep_ms, shard_ms, structural_ms,
  consolidation_ms, stream_ms accumulated, total_ms from first
  `audit_*_started` to final verdict write) plus cache hit rate, and can
  compare a `mode=legacy` run against a `mode=tiered` run on the same task
  lineage.
- files: create `skills/foreman/scripts/audit-metrics.sh`.
- interfaces: `audit-metrics.sh RUN_ID [--compare OTHER_RUN_ID]` prints a
  table (and optional `--json`) of the timings above, sourced purely from
  `events.jsonl` event types defined in T0.
- constraints: read-only; must not fail if some event types are absent
  (e.g. a `legacy`-mode run has no `audit_screen_*` events at all -- report
  those as `n/a`, not an error).
- verification: on a fixture `events.jsonl` with a known sequence of the T0
  event types, `audit-metrics.sh` prints the exact expected per-tier
  durations (computed from the fixture's own timestamps).
- depends_on: T0 (event taxonomy); informationally depends on T2/T4/T6/T7/T9
  having landed to be useful, but the script itself has no file-ownership
  conflict with them.

### T11 -- Doctrine + reference docs update
- objective: Update the audit doctrine surface to describe tiered audit,
  the sacred invariants (unchanged but now structurally centralized), the new
  config keys, and when stream/shard/session-resume apply.
- files: modify `skills/foreman/references/audit-checklist.md`,
  `skills/foreman/references/lanes.md` (already touched by T1 for config --
  this task extends it with doctrine, not just key listing),
  `skills/foreman/references/security-model.md`, `skills/foreman/SKILL.md`,
  `README.md` (soft loop section).
- interfaces: none (docs only); must cross-reference the exact script/config
  names landed in T0-T9, not aspirational ones.
- constraints: docs must be cold-readable (no reliance on this report's
  conversational context, per this repo's own doc-quality bar in
  `skills/foreman/references/audit-checklist.md` "Documentation & comments").
- verification: `markdownlint-cli2` passes on all modified files; a
  reader-cold check -- every script/config name mentioned actually exists at
  the stated path after T0-T9 land.
- depends_on: T0, T1, T2, T3, T4, T5, T6, T7, T8, T9 (docs describe the
  landed interfaces; do last)

### T12 -- Regression tests: invariant + cache + routing + schema
- objective: Bats tests that specifically catch the failure modes named in
  Risks #2 and #3: every new entrypoint (screen, shard, stream, deep via
  session-resume) enforces vendor-not-equal-worker identically; cache
  respects `noncacheable_classes` and `ttl_days`; the routing table's
  always-deep floor cannot be disabled by config; `gate-eval.sh` correctly
  dual-reads v1/v2 verdicts.
- files: create `tests/audit-screen.bats`, `tests/audit-cache.bats`,
  `tests/audit-tiered-dispatch.bats`, extend `tests/gate-eval.bats` if it
  exists (check first) or create it.
- interfaces: none new; tests call the scripts/functions from T0-T9 by their
  landed names.
- constraints: tests must not require live network/model calls -- stub
  `codex` invocation the same way existing bats fixtures do (check
  `tests/checkpoint.bats`/`tests/eventlog.bats` for the house fixture
  convention before inventing a new one).
- verification: `bats tests/audit-*.bats` green; specifically include one
  test per sacred invariant in the Architecture section (vendor check,
  fail-closed gate, read-only sandbox, untrusted-diff framing present in
  every prompt template).
- depends_on: T0-T9 (all)

## Parallelism map

- **can_run_parallel:** [T0, T1] (schema/events and config docs touch
  disjoint files); [T2, T5] once T0 lands (screen classifier and cache lib
  touch disjoint files); [T10, T11, T12] once T0-T9 land (metrics script,
  docs, tests touch disjoint files from each other, though T11/T12 both
  *reference* T0-T9's landed names).
- **must_be_serial:** T0 -> T3 -> T8 -> T9 -- `audit-run.sh` is a shared
  file across T3 (extraction), T8 (bundle consumption), and T9 (tiered
  dispatch branch); these three MUST run in this exact order on this file,
  one implementer round at a time, to avoid merge conflicts and logic
  clobbering. T4 depends on T3 (shares `lib/audit-call.sh`) but writes only
  new files, so T4 can start as soon as T3 lands, in parallel with T8. T6 and
  T7 both depend on T3 and have no file conflict with each other (disjoint
  new files) but both are gated on external merges (v0.2.0, v0.3.0
  respectively) -- do not block T8/T9 on T6/T7.

### File-ownership conflicts (flag to the architect before routing to implementers)

| File | Touched by | Resolution |
|---|---|---|
| `skills/foreman/scripts/audit-run.sh` | T3, T8, T9 | Strict serial order T3 -> T8 -> T9; one round each, re-verify between rounds |
| `skills/foreman/scripts/gate-eval.sh` | T0 | Single owner, no conflict |
| `skills/foreman/references/lanes.md` | T1 (config keys), T11 (doctrine) | T1 first, T11 second -- same file, serialize |
| `.foreman/config.toml` example / cache dir | T1, T5 (`.gitignore` entry) | Disjoint edits, low risk, but confirm T5's `.gitignore` line doesn't collide with an existing pattern before merge |

## Risks

1. **Screen-tier false negatives ship a real defect.** *Mitigation:*
   hardcoded non-overridable always-deep floor (auth/crypto/adapters/audit
   tooling itself) + config-extensible categories/paths; screen prompt
   required to be recall-biased (escalate liberally); periodic shadow
   full-deep sampling (suggest 1-in-10 screen-only-APPROVED diffs, see Open
   question #4) to *measure* the false-negative rate empirically rather than
   assume the floor list is complete, feeding back into the floor/category
   list over time.
2. **Divergent enforcement of the vendor-check invariant across new
   entrypoints.** A screen/shard/stream script that reimplements the check
   slightly differently could silently allow same-vendor audit on one path
   only. *Mitigation:* T3 centralizes the check in `lib/audit-call.sh`;
   every new entrypoint (T2, T4, T6, T7) calls it, none reimplement it; T12
   tests the invariant on every entrypoint individually, not just the legacy
   path.
3. **Verdict schema v2 breaks existing tooling mid-migration.**
   *Mitigation:* v2 is additive and versioned (`schema_version` field);
   `audit-verdict.json` (v1) keeps working untouched for `audit.mode =
   "legacy"`; `audit-consolidated.json` is a new, separate artifact for
   tiered mode; `gate-eval.sh` dual-reads both, defaulting to v1 semantics
   when `schema_version` is absent.
4. **Checkpoint-stream audit depends on v0.2.0 primitives that may not land
   exactly as currently drafted** (`docs/superpowers/plans/2026-07-15-durable-lanes.md`
   is still in flight per `foreman/dl2/*` WIP branches at plan time).
   *Mitigation:* T6 fails **soft** -- if `[durable]` config/checkpoint refs/
   watchdog aren't present or `audit.stream.enabled = false`, the stream
   lane no-ops and the run falls back to the legacy/tiered end-of-round
   audit; never block a merge on this dependency. Confirm exact config key
   names before finalizing T6 (Open question #2).
5. **Hunk-hash cache poisoning/staleness.** A cached verdict for a
   byte-identical hunk can go stale if surrounding *uncached* code changed
   its meaning (e.g. a called helper's behavior changed elsewhere).
   *Mitigation:* `hunk_id` includes N lines of surrounding context (not just
   the changed lines) to reduce false-identical hits; `ttl_days` bounds
   staleness age; `noncacheable_classes` excludes `security_sensitive`/
   `cross_cutting` findings from the cache entirely so the riskiest findings
   are always freshly (re-)audited.

## Metrics

- **Timing events** (defined in T0, emitted by T2/T4/T6/T7/T9 into the
  existing `events.jsonl` via `el_emit`): `audit_screen_*`, `audit_deep_*`,
  `audit_shard_*`, `audit_structural_*`, `audit_consolidation_*`,
  `audit_stream_*`, `audit_cache_hit/miss`, `audit_session_resumed`.
- **Aggregator:** `audit-metrics.sh` (T10) computes per-tier and total
  wall-clock, cache hit rate, and stream-vs-end-of-round latency split from
  one run's `events.jsonl`; `--compare` diffs two runs (e.g. a `legacy` vs
  `tiered` run over the same task lineage).
- **Before/after protocol:** tag every `audit-meta.json` with `mode:
  legacy|tiered`; before = existing 27-min full-audit and similar plan-time
  audit data points already on record; after = median/p90 total_ms from
  `audit-metrics.sh` across a sample of tiered runs. Target: median < 10 min
  for typical (non-always-deep, non-cross-cutting) changes; accept that
  mandated deep passes (auth/crypto/concurrency/self-referential audit
  tooling) may still take ~27 min -- that cost is intentionally preserved,
  not optimized away.
- **False-negative recall proxy:** rate of shadow full-deep audits (Risk #1
  mitigation) that surface a `BLOCKED`-severity finding a prior screen-only
  `APPROVED` missed; tracked over time as the empirical justification (or
  counter-evidence) for eventually flipping `audit.mode`'s default.

## Open questions

1. Should the always-deep path/category floor be *only* a hardcoded
   non-overridable list in `audit-screen.sh` (config can add, never
   subtract), as this plan assumes? Confirm that's the intended security
   posture rather than making it fully config-driven.
2. What are the *final* v0.2.0 config key names/event types for
   `checkpoint_interval`, `refs/checkpoints/<lane>` wiring, and watchdog
   states (RUNNING -> STALLED -> DEAD)? T6 is speced against the current
   draft in `docs/superpowers/plans/2026-07-15-durable-lanes.md` Section 5;
   needs a quick alignment pass once durable-lanes finalizes (or
   confirmation it already matches).
3. Does v0.4.0 intend `audit.mode` to default to `tiered` at release, or stay
   `legacy`-default with `tiered` opt-in until shadow-sampling data (Risk #1)
   justifies the flip? This plan assumes opt-in first.
4. What shadow full-deep sampling rate is acceptable given its cost (extra
   audit passes purely for measurement)? Plan suggests 1-in-10
   screen-only-APPROVED diffs as a starting point -- needs a cost-tolerance
   sign-off.
5. Should audit-session resume (T7) ever be allowed to reuse a thread across
   *different* `task_id`s within the same lane (e.g. sequential small tasks
   in one run), or must it always be strictly 1:1 with `task_id` as this plan
   assumes? The conservative default may leave session-transport's latency
   win under-realized for very small sequential tasks.
