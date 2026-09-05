# Rework after GPT-6 Astra audit round 2

Every finding was verified against the cited file and line before any change.
All five blocking findings reproduced.

| Finding | Verified where | Change |
|---|---|---|
| B1 bootstrap cycle, thirteen children from twelve owners | `release-coverage-cli.ts:1062`, `:1252` | Bootstrap runs under the root contract before activation, as v0.4 did. `session-store-recovery` becomes a bootstrap dependency of the governor with no child. The family holds eleven children with eleven distinct package ids, `v050-release` bound to the governor. |
| B2 allowed file scopes | `execution-contract.ts:632`, `verify-runtime.ts:196` | Every scope is now exact paths or terminal `/**`. The governor scope covers other packages' `specs/**`, `release-brief.json`, the archive destination, and the v0.4 fixtures. The lane scope adds `scripts/verify-runtime.ts`, `round-*.ts` by exact name, and the runtime manifest. Recovery adds the runtime outputs. |
| B3 v0.4 tests read the live package | `release-coverage.test.ts:2417`, `:2436` | New requirement "Frozen v040 fixtures". Bootstrap task 1.1a copies the register, inventory, and roadmap into `packages/policy/src/fixtures/v040/` and changes only fixture-loading lines. Archiving happens after. |
| B4 lockfile rule rejects platform optionals | `package-lock.json`, 75 of 161 entries absent on Linux x64 | Two requirements: the expected installed set excludes workspace links and platform-excluded optionals, then the tuple comparison runs on that set. Three fixtures in the task. |
| B5 deleting `posix*.ts` breaks Windows | `launch.ts:20`, `supervise.ts:24`, `build.ps1:28` | Retirement boundary redefined: remove the POSIX build script, the WSL manifest row, the Setup build step, and the runtime's POSIX Bun fallback. Keep the source. Add a Windows rebuild check. P2 measures that boundary. |
| N1 atomicity | four spec files | Derived-data, probe, record reading, rename, and rebuild requirements split. Path independence triggers on identical declared inputs. Clean scan qualified to an uncontaminated checkout. |
| N2 roadmap owner equality | `release-coverage.ts:975` | Roadmap entries now mirror the row's owner column. The cross-field rule applies to package entries only. |
| N3 carried obligations | `evidence-contracts` spec 370, `doctrine` spec 90 | Reconciliation now covers `specs/**`. Tranche 7 waits for the `evidence-contracts` milestone. The two resume entries are `required` with receipt paths. |
| N4 predicates as procedures | P8, P9, P10, P11 | P8 and P9 are single test commands with fixtures. P10 requires the live-traversal case executed, not skipped. P11 names the mutation-control invocation. Task 8.3a re-runs the live receipts on the candidate. Task 8.4 carries the full argument list. |
| N5 vocabulary | spec 221 and 240 | Measured failures record `FAILED`, unmeasurable ones `UNCOMPUTABLE`. Both refuse publication. |
| N6 decision table | `lane-run.sh:1152` | Table is total, `any` is no longer a wildcard, launcher-absent skips admission as the baseline did, malformed records get no spawn flags. |
| N7 journal stages | v0.4 design 1012 | Retained stages enumerated. `image_pushed` excluded. Annotated tag, no signature. Task 6.3 evidence is a branch listing. |
| N8 narrative sync | design doc | Predicate 2 and 4 narratives and the package map now match the OpenSpec text. |
