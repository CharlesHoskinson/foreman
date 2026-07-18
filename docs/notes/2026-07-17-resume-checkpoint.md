# Resume checkpoint — 2026-07-17 (v0.2.0 bundle, ~1 hour from tag)

End-of-day snapshot after a ~9-hour session. Everything below is committed
except where noted. Pick up here tomorrow: ~1 hour to tag v0.2.0.

## TL;DR — what remains to tag v0.2.0

1. **Clean full-suite gate on the perf branch** (host must be calm — see
   "host stability" below). Tests 27 + 34 in `eventlog.bats` flaked ONLY
   under fork-exhaustion from a rogue VTICK agent (now gone); the el_emit
   code is manually verified byte-identical (seq 1/2, correct types).
2. **Apply the one audit WARNING** (zero-cost): in `tests/helpers.bash` the
   memoize flag read `read -r _crlf < "$_f"` returns 1 (no trailing newline);
   harden with `|| :` OR write the flag with `printf '%s\n'`. Non-blocking but
   recommended before merge.
3. **Cherry-pick the perf branch onto main** (`foreman/dl2e/implement/perf`
   @ `56ea69e`), run the authoritative full suite + docs-check on main.
4. **Advisor done-check** → **tag v0.2.0** → push tag → **cut the GitHub
   release** with the staged Nightwatch artwork.

## State of the tree

- **origin/main**: last pushed at `ea8498e` (Round B). LOCAL main is ~13
  commits ahead and MUST be pushed (T7, manifest, OpenSpec designs, all the
  bugeventlog entries, this checkpoint). **Push main as part of wrapping up.**
- **main HEAD** (local): T7 config loader (`c829628`) is merged; dependency
  manifest updated (shellcheck+PSScriptAnalyzer installed on the Windows host,
  parallel/flock documented); both OpenSpec change designs committed under
  `openspec/changes/`; markdownlint clean (openspec/changes added to the
  ignore list — transient change proposals, matching the docs/research
  precedent).
- **Perf changes**: committed to branch `foreman/dl2e/implement/perf` at
  `56ea69e` in worktree `foreman-wt-dl2e-implement-perf`. NOT on main yet
  (pending the clean gate). Push this branch too so it survives.
- **T7 worktree** `foreman-wt-dl2c-implement-t7-config` still exists (T7 is
  already merged to main from it — safe to `wt-cleanup dl2c`/remove tomorrow).
- **Stale worktrees** to clean tomorrow: `foreman-wt-durable-20260715-*`
  (t0/t1/t2 — long merged), `dl2c`, and `dl2e` after its merge.

## v0.2.0 bundle — final scope

| Item | Status |
|---|---|
| T3 lane-run + T5 watch (Round B) | merged + pushed (`ea8498e`) |
| T7 config loader + doctrine + wiring | merged to LOCAL main (`c829628`), Opus-APPROVED |
| el-emit spawn reduction (F1-F4) | on perf branch, Opus-APPROVED, manually verified; needs clean gate |
| test-harness fork-tax (B#1/B#2-half1/B#3/A) | on perf branch, Opus-APPROVED; needs clean gate |
| **WATCH_VTICK** | **CUT → v0.2.5** (user decision) |

Deferred to v0.2.5 (all correctly): WATCH_VTICK, slow/fast test tagging (D),
inline-setup consolidation (B#2-half2), el_emit F5/F6, `bats --jobs`
parallelism (needs GNU parallel — blocked by host proxy stripping gnu.org
binaries; get it from a GitHub mirror or WSL).

## WATCH_VTICK — why it was cut, and the v0.2.5 head-start

VTICK (virtual clock to de-flake the wall-clock watch.bats tests) is a real
multi-layer refactor, not a drop-in. Layers found:

1. `wd_sleep_remainder` does `tick*1000` in integer bash arithmetic → CRASHES
   on fractional `WATCH_TICK` (the fix attempt used `0.01`). **Two viable
   fixes, both discovered:** (a) parse `tick` into ms like the EPOCHREALTIME
   stamps (I wrote this); (b) use `WATCH_TICK=0` (valid integer, zero explicit
   sleep — the rogue VTICK agent's approach, simpler).
2. The `WD_AGE=$((WD_AGE + vclock))` add must cover BOTH the latched
   (`wd_sample`) path AND the unlatched real-time fallback. The final agent
   report claims placing it right after the WD_AGE-setting block covers both,
   and that tests 18/23 reach `STALLED→DEAD→exit 3` via direct (`timeout`-free)
   invocation — but a clean full `bats watch.bats` was never obtained (fork
   exhaustion). **v0.2.5 must build this test-first against tests 18 and 23.**
3. Branch `foreman/dl2d/implement/vtick` exists at the T7 base (`c829628`);
   the actual VTICK diff was lost when worktrees were torn down — reconstruct
   from the two bugeventlog entries + this note (it is ~30 lines total).

## Artefact index (for tomorrow + the v0.2.5 planning session)

- Perf investigation (5 Opus reports): `~/.foreman/runs/dl2d/perf/`
  (A-lane-run-timing, B-fork-tax, C-hotpath-spawns, D-fast-slow-tagging,
  E-jobs-parallel-safety) + round-2 audits `R2-el-emit-audit.md`,
  `R2-testharness-audit.md`.
- Gate-speedup research (the keystone analysis): `~/.foreman/runs/dl2c/gate-speedup-research.md`
- v0.2.5 plan-vs-bugeventlog review: `~/.foreman/runs/dl2c/v025-plan-review.md`
- T7 audit: `~/.foreman/runs/dl2c/audit/R-t7-audit.md`
- Perf audit: `~/.foreman/runs/dl2e/audit/R-perf-audit.md`
- Nightwatch release image (staged): `~/foreman-nightwatch-v0.2.0.png` (also `~/Downloads/foreman3.png`)
  (attach to the v0.2.0 GitHub release the way First Light was attached to
  v0.1.0, which is done + live).

## Biggest learnings this session (all in bugeventlog.md)

1. **The background-and-stop attractor is the dominant failure — 12
   occurrences across 3 vendors (Grok, Sonnet, and the model-family lanes).**
   Agents background a long task and end their turn, orphaning it; prompt
   prohibitions provably do NOT hold. This ate most of the day. The v0.2.5
   structural fix (artifact-defined completion + a launcher that owns the
   whole round incl. gate+report) is now the clear #1 priority — the v0.2.5
   plan review says the current plan *detects* it but does not *prevent lost
   work*; fix = the launcher must own the finish/verify/report phase, and add
   an auto-resume primitive (12 manual SendMessage resumes today).
2. **A host-wide gate mutex is mandatory.** Concurrent bats runs corrupt
   wall-clock tests; even read-only auditor/investigation agents that run
   `bats` to "measure" orphaned their runs and caused MSYS2 fork-exhaustion
   (`errno 11`, a single el_emit at 10.4s vs ~100ms) that flaked unrelated
   gates and stretched T7's gate from ~45min to ~2h. Doctrine now: NO agent
   runs bats unless it is the sole gate; investigation agents reason from
   code. v0.2.5: pueue `gate` group (parallel=1) so any bats run queues.
3. **Watchdog liveness must be content/process-aware, not scaffold-existence.**
   Three false-alert modes hit today: stale-report existence key; no
   dispatch-grace period; and the gate-phase blind spot (a lane running its
   suite writes only to /tmp, not the worktree). Final form: size-gated report
   freshness OR a live worktree process.
4. **Host stability:** this machine hit MSYS2 fork-resource exhaustion under
   the day's many concurrent agents/gates. Keep concurrency LOW; serialize
   gates; watch total process count. A transient heavy WSL process also
   periodically loaded the host and flaked wall-clock tests identically on
   main (not a product bug).
5. **wt-cleanup drops versioned audit reports** (only archives fixed
   FOREMAN_REPORT.md names) — lost V2/V3/V4 audit reports. Fix: glob
   `FOREMAN_REPORT*.*` + `DIFF_*.patch`.

## Cross-vendor invariant held

Sonnet 5 implemented; Opus audited (Fable was DOWN all session — the auditor
substitution was Opus, stated explicitly each time). T7 and the perf bundle
each got an independent Opus cold-diff audit; both APPROVED.
