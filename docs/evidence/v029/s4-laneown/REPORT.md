# REPORT

## T1
DONE — ownership primitives finished in `tools/lanectl.sh` (synced to root copy).

Three-way ownership kept and verified:
1. `FM_LANE_OWNER` / `FM_LANE_LABEL` in the environment
2. per-owner PID registry under `$FM_LANE_DIR`
3. directory marker via `claim DIR LABEL` (`.fm-lane-owner`) — the only source that survives a vendor re-exec (new pid loses env + registry entry; cwd marker remains)

Commands: `launch` / `adopt` (full subtree) / `claim` / `ps [--all]` / `reap [--force]` (mine only; kill by pid never `pkill -f`) / `sweep`.

Re-exec claim checked in harness case 9: replacement process in a claimed directory with a new pid is attributable only via the marker, not env or the old registry entry.

## T2
DONE — state-based liveness, no existence-only predicates.

- `tools/reap-stale-lanes.sh`: `STAT` beginning `T` → `SUSPENDED`; zero CPU after grace → `WEDGED`; candidates restricted to processes with a `timeout` ancestor. CPU-delta hang check recorded as tried-and-REMOVED (inline comment; do not reintroduce).
- New `skills/foreman/scripts/lib/liveness.sh`: shared `lv_classify_pid` / `lv_is_live` / `lv_exists_only` (defect under test) / `lv_is_dispatched_lane`.
- `watch.sh` `wd_pid_alive`: replaced `kill -0` with `lv_is_live` (state-and-CPU).
- `lane-supervise.sh` `ls_sweep_lane`: replaced `kill -0` with `stall_from_pid` / state judgement; SUSPENDED/WEDGED are not ALIVE; lock-held conservatism kept except when positive stall evidence overrides.

## T3
DONE — stall taxonomy + content-hash evidence.

- `skills/foreman/scripts/lib/stall.sh`: `SUSPENDED`, `NEVER_LAUNCHED`, `NO_OUTPUT`, `WEDGED`, each named by evidence (`stall_report` / `stall_classify`). "not responding" is not a permitted state.
- `skills/foreman/scripts/lib/evidence.sh`: `ev_content_hash` for deliverable content; `NO_OUTPUT` never uses `git status --porcelain` alone. Porcelain blindness observed in harness (nested untracked content edit left porcelain digest unchanged; content hash changed).
- `lane-supervise.sh` logs stall taxonomy lines in shadow mode (D7) on classification.

## Verification
Harness: `bash tests/lane-ownership-harness.sh` — **PASS=24 FAIL=0**, exit 0.

| Case | Result |
|---|---|
| 1 SIGSTOP → SUSPENDED, not alive | PASS (red: exists-only lies) |
| 2 pgrep regression | PASS (existence-only would call stopped process alive) |
| 3 NEVER_LAUNCHED | PASS (names vendor searched for) |
| 4 foreign safety | PASS (foreign still alive after other owner's reap) |
| 5 subtree adopt | PASS (wrapper+child both registered) |
| 6 healthy negatives | PASS (blocked-under-grace + interactive left alone) |
| 7 harness non-zero on fail | PASS (mini-harness exit 1 proved) |
| 8 NO_OUTPUT content hash | PASS (red: porcelain blind) |
| 9 claim survives re-exec | PASS |
| 10 shellcheck | PASS (tools + new libs) |

Command observed:
```
bash tests/lane-ownership-harness.sh
# → PASS=24 FAIL=0 SKIP=0 / HARNESS OK / exit 0
```

## Deferred (D7 / out of T1–T3 scope)
- **T4** dispatch hygiene (`lane-run.sh` owner tagging + stdin `/dev/null` + vendor currency before dispatch) — not in T1–T3.
- **T5** full `tests/lane-ownership.bats` under `flock /tmp/foreman-bats.lock`, docs gate, `openspec validate`, `bugeventlog.md` merge — round-1 brief is T1–T3; harness above is the red-first proof.
- **Hard gating on stall taxonomy**: classification is wired and logged; auto-reap/auto-abandon actions beyond existing abandoned handling remain **shadow** (D7) — verdicts computed and logged, not yet release-blocking new gates.
- **watch.sh full typed-state rename** to SUSPENDED/NEVER_LAUNCHED/…: process liveness path fixed; event-log age machine (STALLED/DEAD) left as frozen v1 surface to avoid rewriting T4b.
