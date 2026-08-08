# Tool-check positive-control coverage reconciliation — 2026-08-08

## Summary

This record documents the change in positive-control coverage for the `env/tool-check.sh` probe suite following its port to Node/TypeScript (`packages/orchestration/src/tool-check*.ts`).

Prior to the TypeScript port, `env/tool-check.sh` contained 9 shell probe checks, all of which were registered in `tests/positive-control-registry.tsv`. When domain logic was ported to TypeScript, 3 probes were re-pointed to their direct TypeScript function successors, while the remaining 6 checks are no longer controlled by separable two-polarity test fixtures in the registry.

Per the Foreman QA evidence rules ("a coverage claim that omits its own exclusions is the failure this regime exists to prevent"), the 6 checks whose logic still ships in TypeScript are explicitly deferred in `tests/positive-control-todo.tsv` rather than silently removed from the control universe.

## Controlled before (9 shell probes)

1. `env/tool-check.sh::check_one`
2. `env/tool-check.sh::fm_tc_probe_mkdir_once`
3. `env/tool-check.sh::fm_tc_probe_flock_once`
4. `env/tool-check.sh::fm_tc_sha256`
5. `env/tool-check.sh::fm_tc_version_line`
6. `env/tool-check.sh::fm_tc_fs_class`
7. `env/tool-check.sh::fm_tc_host_class`
8. `env/tool-check.sh::fm_tc_pinned_lookup`
9. `env/tool-check.sh::fm_tc_run_atomicity_probes`

## Controlled now (3 TypeScript probe successors in `tests/positive-control-registry.tsv`)

1. `packages/orchestration/src/tool-check-run.ts::checkOne` — re-pointed successor to `check_one`. Controlled with `home-missing` vs `home-ok` fixtures.
2. `packages/orchestration/src/tool-check-atomicity.ts::probeMkdirOnce` — re-pointed successor to `fm_tc_probe_mkdir_once`. Controlled with `probe-mkdir-decoy.pointer` vs `probe-mkdir-real.pointer` fixtures.
3. `packages/orchestration/src/tool-check-atomicity.ts::probeFlockOnce` — re-pointed successor to `fm_tc_probe_flock_once`. Controlled with `probe-flock-bad.pointer` vs `probe-flock-real.pointer` fixtures.

## Uncontrolled now (6 TypeScript check successors deferred in `tests/positive-control-todo.tsv`)

1. `packages/orchestration/src/tool-check-platform.ts::sha256FileSync`
   - **Status:** Defer (`tests/positive-control-todo.tsv`)
   - **Reason:** The sha256 checksum predicate still ships in TypeScript (`sha256FileSync`), but the inventory scanner does not inventory it as a separable check in the registry and it lacks a two-polarity control fixture; therefore it is uncontrolled.
2. `packages/orchestration/src/tool-check-platform.ts::readProcVersion`
   - **Status:** Defer (`tests/positive-control-todo.tsv`)
   - **Reason:** The version-line parsing predicate still ships in TypeScript (`readProcVersion`), but the inventory scanner does not inventory it as a separable check in the registry and it lacks a two-polarity control fixture; therefore it is uncontrolled.
3. `packages/orchestration/src/tool-check-platform.ts::classifyFsClassFromProbe`
   - **Status:** Defer (`tests/positive-control-todo.tsv`)
   - **Reason:** The filesystem class probe predicate still ships in TypeScript (`classifyFsClassFromProbe`), but the inventory scanner does not inventory it as a separable check in the registry and it lacks a two-polarity control fixture; therefore it is uncontrolled.
4. `packages/orchestration/src/tool-check-platform.ts::classifyHostClass`
   - **Status:** Defer (`tests/positive-control-todo.tsv`)
   - **Reason:** The host platform classification predicate still ships in TypeScript (`classifyHostClass`), but the inventory scanner does not inventory it as a separable check in the registry and it lacks a two-polarity control fixture; therefore it is uncontrolled.
5. `packages/orchestration/src/tool-check-atomicity.ts::lookupPinnedVerdict`
   - **Status:** Defer (`tests/positive-control-todo.tsv`)
   - **Reason:** The pinned trace/verdict lookup predicate still ships in TypeScript (`lookupPinnedVerdict`), but the inventory scanner does not inventory it as a separable check in the registry and it lacks a two-polarity control fixture; therefore it is uncontrolled.
6. `packages/orchestration/src/tool-check-atomicity.ts::runAtomicityProbes`
   - **Status:** Defer (`tests/positive-control-todo.tsv`)
   - **Reason:** The top-level atomicity probe orchestrator predicate still ships in TypeScript (`runAtomicityProbes`), but the inventory scanner does not inventory it as a separable check in the registry and it lacks a two-polarity control fixture; therefore it is uncontrolled.
