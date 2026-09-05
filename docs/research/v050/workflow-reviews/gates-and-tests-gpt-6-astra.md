# Gates and tests review (GPT-6)

## Where the weight is

The largest opportunity is to stop repeating complete verification for unchanged inputs. The second is to remove timing-sensitive tests from the general test workload.

I inspected commit `07f4569`. Measurements below are single runs, not latency distributions. The checkout contains local changes, so working-tree results are not clean-checkout evidence.

| Step or artifact | Evidence (file:line or measurement) | Cost class | Why it exists (the safety property it buys) |
|---|---|---|---|
| Fresh verification environment for each check | `.foreman/config.toml:13` initializes a snapshot repository, installs dependencies, then runs `npm run verify`. `checks-run.sh:84` first creates a fresh archive. | Minutes, human steps | Tests committed content with independently installed dependencies. |
| Repeated architect verification | `CLAUDE.md:110` requires reading the diff and rerunning verification. QA doctrine repeats that requirement. | Minutes, tokens | Prevents acceptance of unsupported worker claims. |
| Two nested Bats locks | `tools/ci-local.sh:244` takes `/tmp/foreman-bats.lock`. `tests/run.sh:45` takes `$HOME/.foreman/gate.lock`. | Minutes waiting | Prevents concurrent suites from causing load-sensitive failures. The locks overlap in purpose. |
| Serial Bats files | `tests/run.sh:287` runs each file sequentially. Supplied baseline: 60 files, 771 cases. | Minutes | Preserves isolation and existing per-file accounting. It also serializes pure assertions. |
| Large timeout and silent waiting | `tests/run.sh:299` allows 600 seconds plus 30 seconds before forced termination. `ci-local.sh:244` captures the entire suite output. | Minutes, human steps | Bounds a wedged file. A previous test hung 31 minutes and blocked three verifications. |
| Serial local gates | `tools/ci-local.sh:536` through `:564` runs ten gates in order. OpenSpec validation starts one process per package at `:141`. | Seconds to minutes | Provides one comprehensive report. Serial execution is not itself a safety property. |
| Runtime rebuilds | `scripts/verify-runtime.ts:205` performs two sequential builds. `scripts/build-runtime.ts:267` builds entries sequentially. | Seconds, potentially more | Checks repeatability and equality with tracked bundles. Supplied build timing: 3.5 seconds. |
| Repeated manifest rejection tests | Missing, tampered, extra and linked bundles appear in `scripts/verify-runtime-manifest.test.ts:119` and again in `scripts/verify-runtime.ts:487`, `:547` and later probes. | Seconds, maintenance tokens | Proves manifest verification rejects invalid artifacts. These are overlapping tests of the same verifier. |
| Whole-tree documentation checks | `docs-check.sh:49`, `:65`, `:88`, `:150` perform broad scans. | Seconds, tokens resolving unrelated findings | Checks formatting, spelling, links, invocation policy and shell documentation. |
| Secret scan inside the unit suite | `packages/orchestration/src/secret-scan.test.ts:1244` scans the actual checkout. Scanner excludes only top-level `.git` and `.harness` at `secret-scan.ts:41`. | Seconds, diagnostic/retry time | Detects forbidden secret material. Ambient dependency and state files can exhaust its bounds. |
| Architecture policy | `packages/policy/src/architecture-git.ts:650` loads paths serially and binds declared runtime artifacts at `:657`. Measured **0.79 seconds, Pass**, against `HEAD^`. | Seconds | Enforces the TypeScript rule and manifest-bound generated output. |
| Appliance lock | `scripts/appliance-lock.ts:23` reads the reference manifest and lock projection. Measured **0.19 seconds, pass**. | Seconds | Detects dependency-pin projection drift. This is a data lockfile, not a scheduling mutex. |
| Type checking | `package.json:13` runs project builds followed by the whole-tree configuration. The latter includes production code and tests. Measured no-emit check: **5.10 seconds, pass**. | Seconds | Checks strict types. The passes overlap, but project-reference and whole-tree checks are not interchangeable. |
| Multiple meanings of “full” | Linux CI runs `npm run verify`, architecture policy, Council checks, then `ci-local.sh`. See `.github/workflows/gates-linux.yml:36`, `:50`, `:52`, `:176`. | Human steps, tokens | Covers distinct components. Neither `npm run verify` nor `ci-local.sh` alone represents this complete set. |

Two measurements need explicit qualification:

- `docs-check.sh` completed in **4.95 seconds with failure**. It reported markdownlint and codespell findings, plus a sandbox temporary-file error. This is not a valid clean-host performance baseline.
- The compiled secret scanner returned **`refused/bound_exceeded` in 0.50 seconds**. A fast refusal is not a clean scan.

## Ranked proposals

1. **Reuse trusted verification results for identical inputs**

   **What changes:** Give each deterministic gate a content-addressed result. Reuse it across worker completion, architect verification and integration when its complete input identity matches. Keep independent review of the diff.

   Key results by candidate content, base where relevant, checker code, configuration, dependency installation, tool versions and platform capabilities. Record selected tests and required outcomes. Store results outside the worker’s writable authority.

   **Expected speedup:** If three stages currently repeat an identical gate, reduce three executions to one: **67% of that gate’s execution time**. Measure actual invocation counts before claiming this saving. Reusing a qualified dependency installation also avoids repeated `npm ci` for the same lockfile and platform.

   **Safety:** Preserve artifact binding and independent execution. A worker report cannot populate the trusted cache. Mutable worktrees, changed dependencies, changed bases and changed capabilities invalidate applicable results. Never cache live authorization or containment state as a test result.

   **Effort:** L. **Risk:** High if cache inputs or trust boundaries are incomplete.

   **Exact files:** New `packages/orchestration/src/verification-cache.ts` and its TypeScript tests. Update `.foreman/config.toml`, `skills/foreman/scripts/checks-run.sh`, `CLAUDE.md`, and `plugins/foreman-qa/skills/foreman-qa/references/evidence-rules.md`. Coordinate dependency identity with `openspec/changes/build-determinism/`.

2. **Separate deterministic tests from tests that require a quiet host**

   **What changes:** Move pure state-transition assertions into TypeScript beside their owning modules. Use controlled clocks for scheduling logic. Retain real process, signal, lock and containment integration tests.

   After isolation is demonstrated, run deterministic files in bounded parallel shards. Reserve one exclusive phase for remaining timing-sensitive tests. Give each shard its own temporary roots and report files.

   **Expected speedup:** For parallelizable fraction `p` and `k` shards, execution becomes approximately `T × ((1 − p) + p/k)`. At `p=0.8`, four shards offer **2.5×**, before overhead. This is an example, not a measured partition.

   **Safety:** Do not remove the existing mutex before proving isolation. `tests/watch.bats:10` contains pure assertions, while `:56` begins real-time integration cases. Retain both kinds of evidence. Preserve platform baselines, skip budgets and empty-selection failures.

   **Effort:** L. **Risk:** Medium to high from hidden shared state.

   **Exact files:** `tests/run.sh`, `tests/watch.bats`, `tests/lane-run.bats`, `tests/decision-events.bats`, `tests/helpers.bash`, `scripts/run-tests.ts`, `packages/orchestration/src/watch.ts`. Put new scheduler logic in `packages/orchestration/src/verification-runner.ts`, using Effect.

3. **Define one gate plan with explicit pre-commit and full tiers**

   **What changes:** Replace overlapping command recipes with one machine-readable gate plan. Select pre-commit checks by affected properties and dependency closure, not changed-line count. Unknown mappings select broader checks.

   Proposed reference-host budgets:

   | Verdict | Proposed budget |
   |---|---|
   | Pre-commit | 10 seconds static checks, 35 seconds focused tests, 10 seconds snapshot/cache/report overhead: **55 seconds** |
   | Full | 30 seconds admission wait, 60 seconds preparation/static checks, 360 seconds parallel test phase, 120 seconds exclusive integration phase: **570 seconds** |

   These are acceptance targets. Existing timing data does not establish that all test phases fit.

   **Expected speedup:** Removes unrelated full-suite work from routine edits and replaces several commands with one. A warm, focused pre-commit verdict has credible headroom given the measured static checks. Cold dependency installation and large security changes may require the full tier.

   **Safety:** Label the scope explicitly. A focused pass is not release approval. The full verdict must account for every required check, including platform-specific obligations. Timeout or missing evidence produces an incomplete/error result, never a pass.

   Remove the outer Bats lock only after one canonical scheduler owns admission. Bound and report queue wait separately from execution time.

   **Effort:** M–L. **Risk:** Medium from incomplete impact mapping.

   **Exact files:** New `packages/orchestration/src/verification-plan.ts` and TypeScript tests. Update `package.json`, `scripts/run-tests.ts`, `tools/ci-local.sh`, `tests/run.sh`, `.github/workflows/gates-linux.yml`, `.github/workflows/gates-windows.yml`, and the Foreman testing skill. Existing shell files become thin adapters.

4. **Keep one source-to-bundle rebuild on the routine path**

   **What changes:** Routine verification checks the tracked manifest, rebuilds once and compares bytes. Run independent-checkout determinism tests when build inputs change and for release qualification.

   Consolidate duplicate manifest rejection cases into the TypeScript test suite. Retain copied-install execution smoke tests because they test a different property.

   **Expected speedup:** Removing one build saves approximately **3.5 seconds** using the supplied build measurement. It is not a minutes-scale saving by itself. Cached unaffected bundles may save more, after dependency tracking is reliable.

   **Safety:** The current two builds share `absWorkingDir: root` at `scripts/build-runtime.ts:282`. They do not establish independence from checkout location. Preserve and strengthen that qualification through the existing `build-determinism` package.

   **Effort:** M. **Risk:** Medium, particularly around dependency drift.

   **Exact files:** `scripts/verify-runtime.ts`, `scripts/verify-runtime-manifest.test.ts`, `scripts/build-runtime.ts`, `package.json`, `openspec/changes/build-determinism/specs/runtime-build/spec.md`.

5. **Make documentation and OpenSpec checks incremental**

   **What changes:** Check changed authored documents and shell adapters during pre-commit. Include inbound links when a target moves, disappears or changes anchors. Cache unchanged OpenSpec packages with their shared schema inputs.

   Keep full inventory checks for full verification. Validate the proposed bulk OpenSpec invocation against the existing per-package selection before replacing it.

   **Expected speedup:** A one-package change reduces **52 validator launches to one** on a warm cache. Absolute savings require measurement. Documentation gains are likely seconds per invocation, with additional savings from fewer unrelated findings.

   **Safety:** Configuration changes invalidate all affected results. Do not classify operational agent instructions as historical material. Explicitly distinguish imported source captures from authored prose.

   **Effort:** M. **Risk:** Medium from link dependencies and exclusions.

   **Exact files:** `skills/foreman/scripts/docs-check.sh`, `tools/ci-local.sh`, `.markdownlint-cli2.jsonc`, `.codespellrc`, `tests/docs-check.bats`, and new `packages/orchestration/src/documentation-check.ts`.

6. **Separate secret-scanner correctness from scanning the candidate**

   **What changes:** Keep synthetic fixtures and race tests in the unit suite. Make scanning the actual candidate an explicit gate with its own input inventory and result.

   Implement the existing `build-determinism` selection contract: all tracked files plus untracked, non-ignored files. Report the exceeded bound and observed count.

   **Expected speedup:** Removes repeated scans of dependency trees and ambient state from ordinary unit runs. The measured 0.50-second refusal supports a reliability problem, not a large direct runtime saving. Avoided investigation and retries are the larger likely benefit.

   **Safety:** Preserve no-follow traversal, directory identity checks, bounds and exact path-plus-digest fixture exemptions. A candidate-content result cannot authorize a later scan of a changed live worktree.

   **Effort:** M. **Risk:** Medium to high from selection mistakes.

   **Exact files:** `packages/orchestration/src/secret-scan.ts`, `packages/orchestration/src/secret-scan.test.ts`, `packages/orchestration/src/secret-scan-main.ts`, `skills/foreman/scripts/lane-run.sh`, and `openspec/changes/build-determinism/specs/runtime-build/spec.md`.

7. **Keep cheap safety checks and shrink their reporting burden**

   **What changes:** Keep architecture policy and appliance-lock validation in the fast tier. Require an explicit policy base. Print concise findings and a result reference instead of the full unchanged legacy-debt inventory.

   Correct stale QA instructions. The runner defaults to `enforce` at `tests/run.sh:15`, and runner errors exit 2 at `:434`. The testing skill describes older behavior. Also stop converting `RESULT SHADOW` into `GATE PASS` at `ci-local.sh:262`.

   **Expected speedup:** Little execution-time benefit: both measured checks total **0.98 seconds**. Significant reduction in output tokens and manual interpretation.

   **Safety:** Preserve distinct Pass, Fail, Shadow and Error outcomes. Appliance projection validation is not redundant with runtime reproducibility. Architecture policy is not redundant with type checking.

   **Effort:** S–M. **Risk:** Low.

   **Exact files:** `tools/ci-local.sh`, `packages/policy/src/architecture-main.ts`, `plugins/foreman-qa/skills/foreman-testing/SKILL.md`, `plugins/foreman-qa/skills/foreman-testing/references/gate-and-ratchets.md`, `CLAUDE.md`.

## What must not be cut

- **Exact candidate and dependency identity.** `brokenwindows.md:273` records locally green bundles built through a dependency symlink that later failed CI.
- **Protection against concurrent writers.** `AGENT_TRAPS.md:304` prohibits carrying forward a green result while a lane changes its worktree.
- **Real process and containment tests.** `brokenwindows.md:302` records a capable WSL path failing despite green CI on an incapable host.
- **Timeouts, cancellation and lock ownership.** `tests/run.sh:291` records the 31-minute hang. Shorten waits through isolation and measurement, not by suppressing failures.
- **Positive and negative controls.** QA doctrine records checks that passed both good and bad inputs.
- **Nonempty test selection and complete result accounting.** `scripts/run-tests.ts:6` records shell glob expansion silently dropping tests.
- **Skip budgets and capability evidence.** A skipped safety path is not a passed safety path.
- **Source-to-bundle comparison and copied-install smoke tests.** Manifest hashes alone cannot prove generated code matches source or runs without repository dependencies.
- **Secret traversal boundaries and fixture identity.** `secret-scan.ts:4` documents the no-follow, bounded traversal contract.
- **The Node.js 24 and TypeScript rule.** Implement this reduction in TypeScript packages, with thin compatibility adapters.

## Measure first

For proposals 1–3, collect invocation counts, per-file durations and queue wait separately. No complete-suite runtime was measured in this review.

Read-only commands for the current checkout:

```bash
git rev-parse HEAD
git --no-optional-locks status --porcelain
rg -n 'npm ci|npm run verify|docs-check|checks-run' \
  .foreman/config.toml skills/foreman/scripts/checks-run.sh \
  .github/workflows/gates-linux.yml

/usr/bin/time -p node_modules/.bin/tsc \
  -p tsconfig.all.json --pretty false

/usr/bin/time -p node --import tsx scripts/appliance-lock.ts --check

/usr/bin/time -p node skills/foreman/runtime/dist/architecture-policy.js \
  check --base HEAD^ --repo-root /home/charl/foreman

rg -n 'sleep|timeout|WATCH_TICK|VTICK|setup_tmp_repo' \
  tests/watch.bats tests/lane-run.bats tests/decision-events.bats
```

The operator’s separately authorized benchmark environment should collect these existing runner timings before implementation:

```bash
/usr/bin/time -v npm test
/usr/bin/time -v npm run verify-runtime
/usr/bin/time -v env TEST_GATE_MODE=enforce bash tests/run.sh
```

These were not run here. Their fixtures can create repositories, commit temporary content, or exercise process-control paths.

Repeat representative files individually through `tests/run.sh`, preserving its mutex. Record external elapsed time and Bats timing output:

```bash
/usr/bin/time -v env TEST_GATE_MODE=enforce \
  bash tests/run.sh --timing tests/watch.bats

/usr/bin/time -v env TEST_GATE_MODE=enforce \
  bash tests/run.sh --timing tests/lane-run.bats
```

For cache sizing, count identical gate input sets across the three reported rounds. For parallelism, compute the critical path from measured file durations. Validate the proposed budgets on documentation, pure TypeScript, orchestration and build-input changes, including cold-cache runs.

## Model self-identification

I am GPT-6 running as Codex. This is a self-report, not independent model-identity evidence.