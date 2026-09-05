# Rework after GPT-6 Astra audit round 3

Round 3 reported three blocking findings. Each was verified against the
cited file and line, then reworked. This rework has not been audited.

| Finding | Verified where | Change |
|---|---|---|
| B1 family receipt validators require `v040` | `execution-guard-cli.ts:134`, `:167`, `:1104` | Added to the authority list, the governor scope, and bootstrap task 1.2 with success, preserved-v040, and cross-program cases. |
| B2 expected set still rejects musl and WASM-branch entries | `package-lock.json` `libc` fields, `tslib` and `@emnapi/runtime` optional-only reachability | Expected set is now a reachability walk with `os`, `cpu`, and `libc` eligibility, never through an excluded optional. Existence and installed-version checks added. Six fixtures. |
| B3 final refusal experiment used the retired Bun selector | lane spec 198, tasks 7 and 8.3a | The runtime no longer reads `FOREMAN_LAUNCH_IMPL`. The refused round runs the Node launcher under a PATH without `unshare`, expecting `unshare_missing`, `containment_refused`, exit 2, zero vendor spawns. |
| N1 atomicity | three specs | Fixture archival uses WHEN and WHILE. Scan selection separates tracked from untracked. |
| N2 Bats cases test Bash internals | `watch.bats:6`, `lane-run.bats:1134` | New lane task 4a writes a case map: each case stays as an adapter-contract case or moves to a TypeScript unit test with the same assertion. |
| N3 platform accounting | `lane-run.bats:662`, `:1093` | P3 declares the host matrix from the case map and requires every case to execute on its designated host. |
| N4 captured-facts closure claim | its task 4 | Entry is `required`; bootstrap task 1.6 schedules the review with a receipt path. |
| N5 bootstrap sequence | tasks 1.x | Root contract first (1.0), build and commit before the coverage check (1.8, 1.9), activation on the committed candidate (1.10). |
| N6 receipts inside the frozen candidate | v0.4 design 992 | Final receipts go to `$FOREMAN_HOME/endstop/v050/receipts/`. No tracked change after the freeze. |
| N7 vacuous predicates | P1, P11 | P1 asserts both pins absent and the adapter grammar test executes. P11 binds the fourteen claim ids. |
| N8 lockfile-only comparison | spec 32 | Directory existence and installed version are checked. |
| N9 stale "thirteen" | proposal, design doc | Eleven. |
| N10 largest risk | design 129 | Named as the round-ownership and watchdog migration, with the case map as tranche 2 acceptance. |
