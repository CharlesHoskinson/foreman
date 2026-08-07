# Evidence rules

## Core rules

### A report is a claim

Reports, summaries, commit messages, and agent verdicts describe evidence; they are not evidence. Re-run the command that bears on the claim and read what it actually prints. A report containing “should work,” “likely fixed,” or a pass summary without output leaves the work **NOT DONE**.

Freshness matters. A prior run may refer to another tree, environment, configuration, or artifact. State which candidate the evidence measured.

### Read the diff

Before accepting delegated work, inspect the actual diff. Compare changed paths and content with the requested scope. A subagent or vendor lane can report success while omitting a requirement, touching an unrelated file, or leaving no artifact at all. The report is a lead; the diff is the first direct observation of what changed.

Diff inspection still does not prove behavior. Use it to establish scope and to select the execution evidence required next.

### An exit code is not a result

Read the runner's declared result record and all named fields. In `tests/run.sh`, runner errors produce `RESULT ERROR runner_errors=N`. Test failures produce `RESULT FAIL`. Policy failures in enforcement mode also produce `FAIL`, but shadow mode prints `RESULT SHADOW mode=shadow policy_failures=N exit=0` and exits `0` intentionally (`tests/run.sh`, result dispatch near lines 433–447).

Therefore exit `0` can coexist with policy failures. `ERROR`, `FAIL`, `SHADOW`, and `PASS` are distinct outcomes. Record the token and fields exactly; do not collapse them into a Boolean.

### Silence is not success

A diagnostic step must report the condition it was built to observe. Under `set -e`, a failing probe can terminate its shell before its own report line. That turns a detected failure into silence and invites a false clean interpretation.

Scope errexit off around a probe whose purpose is to capture failure, capture its status, restore the surrounding policy, and print a declared outcome. Print on every path: found and not-found, pass and fail. Never assign meaning to missing output.

### An absent figure is data

Zero asserts that a quantity was measured and its measured value was zero. If cost, count, duration, or coverage was not measured, record `unavailable` or `unmeasured`. A silent default of `0` is indistinguishable from a real clean result and corrupts later comparisons.

## Discrimination

### Require both polarities

A predicate is credible only after it demonstrates discrimination. In the same run:

1. Feed it a known-bad input and require **NEGATIVE**.
2. Feed it a known-good input and require **POSITIVE**.
3. Confirm the two outcomes came from the same predicate and configuration used for the real claim.

This is a positive control alongside the check, not a historical anecdote that it once failed. A check never observed rejecting its founding bad case may be disconnected, inverted, vacuous, or pointed at the wrong subject.

The fifth checker-failure session records four sibling shapes in `bugeventlog.md` around lines 1570–1575:

- an audit lane used process exit code as its predicate;
- `grep "violation"` matched `[ok] No violation found`;
- an invariant was trivially true in the scenario it was meant to detect;
- a model was checked against the wrong module's step function.

The substring predicate is incapable of discrimination: both `violation found` and `No violation found` contain `violation`. It reported clean controls as violations for its whole lifetime because nobody required a known-clean positive control.

The `rod` near-miss has the same root. A lane left `[[ "$durable_enabled" == "__disabled_for_independent_proof__" ]]` in the tree and reported success. The literal comparison could never be true, so nothing had established that the proof could go red (`docs/superpowers/specs/2026-07-31-v029-release-closeout-design.md`, “Per package”).

Negative and positive controls establish only the tested cases. They raise the floor; they do not prove the predicate sound for every input.

The two arms must also differ in the property the check actually reads, not merely in name or path. A registry row for `tests/run.sh::lookup_baseline` once named the identical fixture, `tests/fixtures/policy/trivial.bats`, as both `known_bad_input` and `known_good_input` -- the exact defect this mechanism exists to catch, committed into the mechanism itself. `lookup_baseline` reads the pass-baseline *table*, not the `.bats` file path, so naming the same file twice could never demonstrate discrimination no matter which file was named. The fix replaced both arms with baseline tables that differ in the one property the function reads: one omits a row for the running platform, one carries it (`docs/evidence/positive-control/2026-08-07-baseline-platform.md`). A different file name is not sufficient; the difference has to reach the code path the check exercises.

### Require independent corroboration

Two runs of one predicate repeat its blind spot. Corroboration requires a different predicate, mechanism, or actor capable of failing independently. Examples include execution plus an artifact-content check, a behavioral test plus a state invariant, or an independently framed reviewer checking the raw artifact.

Label a result **uncorroborated** until that second route agrees. The release closeout design requires independent corroboration for decision-changing results and records that all four planning-session false answers were caught by independent predicates and by nothing else (`docs/superpowers/specs/2026-07-31-v029-release-closeout-design.md`, “Three rules the registry enforces”).

### Reject empty selection

Before interpreting a suite or inventory, verify that it selected the expected nonzero population. Assert exact or bounded counts where the inventory is known. Selection count zero is an error, not a green result.

The repository's `npm test` glob was unquoted. Because `sh` has no `globstar`, `src/**/*.test.ts` became `src/*/*.test.ts`. It worked by accident only while no test lived below a nested `src` directory. The first nested test would silently change selection and drop the package's other files. `node --test` exits `0` when a glob selects zero tests, leaving no red signal (`docs/superpowers/specs/2026-08-06-v030-checkpoint.md`, Section 4; `docs/research/2026-08-06-testing-council/migration-parity.md`).

## Provenance of claims

### Rank claims by provenance

Use this ranking when evidence conflicts:

1. Direct execution against the identified candidate, with discriminating controls and readable artifacts.
2. Independent execution or an independent mechanism that corroborates the first result.
3. Inspection of the actual diff and source.
4. Reports, summaries, commit messages, test names, and inherited narrative.

Execution is not automatically correct; a non-discriminating execution remains weak. But execution-derived findings expose actual behavior and outrank inspection-derived guesses when both are otherwise well formed.

The measured repository review was stark: five of five execution-derived defect claims were confirmed true; three of three inspection-derived counts were false. The false inspection claims were a test file's pass/fail counts, “zero output-content assertions” where there were 61 across 27 of 34 tests, and a documentation-change description wrong in four respects. The checkpoint preserves the false zero-assertion claim in Section 2 and separately lists six concrete defects found by running code in Section 3 (`docs/superpowers/specs/2026-08-06-v030-checkpoint.md`). Do not convert that ranking into “execution never lies”; apply discrimination, reachability, and artifact binding to executed checks too.

### Treat inherited claims as leads

Never act directly on a claim merely because it appears in a report, prior session, agent response, commit message, PR description, or test name. Locate its source artifact, inspect the invocation and implementation, then execute a discriminating check. Before deletion, require this chain and a recovery path.

The entry “a root cause inferred from test names, published, and wrong” records seven `tests/lane-queue.bats` failures. A plausible narrative inferred missing TypeScript behavior from the test names and published that cause in a commit and PR description. Reading the calls and code showed the behavior existed; the tests were correctly rejecting the stale pre-Endstop invocation form (`bugeventlog.md`, 2026-08-06 entry around lines 3728–3769).

### An authority citation is not verified behavior

Citing a documented endpoint or official API describes what it is claimed to do, not what it does. `gh api -X POST repos/{owner}/{repo}/branches/{branch}/rename` is documented as a rename; it also deletes the old ref and closes any open pull request whose head pointed at it, emitting `head_ref_deleted` a second before the closure. Two different actors ran that documented endpoint expecting a retarget and got a closed PR both times -- the second time from a *corrected* instruction that had replaced an assumed delete-and-push specifically because it cited this "safer," documented call instead (`bugeventlog.md`, "GitHub's branch-rename endpoint closed PR #27, twice," 2026-08-07).

A plan or brief may state a symptom. It must not hand an implementer a root cause -- or a fix -- that has not been executed and observed, even one that names an official API. "Documented" and "verified" are different claims; only the second licenses an instruction. Verify the call against a disposable target before it runs against the record that matters, or mark the instruction unverified and require the actor to report the verbatim outcome before a second actor repeats it.

## CI is not proof of coverage

A CI pass proves only the paths taken in that environment. Before using it to support a behavior claim, establish that the runner reached that path: required syscall permitted, capability present, feature enabled, branch selected, and skip or early-return absent.

`packages/launcher/src/supervise.test.ts` exercises a PID-namespace cascade requiring `unshare`. The hosted runner denies `unshare`, so it never exercises that primary safety path. On a host where `unshare` succeeded, the child lost its `tsx` loader during re-exec and could not resolve `heartbeat.js` because the source is `heartbeat.ts`. The path was green in CI and broken on every host capable of taking it (`bugeventlog.md`, “Two host-property findings”; `docs/research/2026-08-06-testing-council/suite-health.md`, Section 2.6; `node-runner.md`, Section 4.4).

If CI cannot reach a path, report CI evidence as **not applicable to that path**. Add or identify a capable environment; do not extrapolate green.

### A not-found result is not proof of absence

A tool or dependency reported missing may be present and merely unreachable. 134 Windows CI failures reported `flock` "not found"; `flock` was installed on the runner the whole time, and the package manager confirmed it (`util-linux is up to date -- skipping`). Git for Windows' bash simply does not put it on `PATH`. The failure signature was indistinguishable from genuine absence and was not.

This is the reachability rule seen from the failing side: CI green proves only the paths CI took; a "not found" here proves only that the *lookup* failed, not that the *thing* is absent. Before recording a dependency as missing, check whether it exists off `PATH` -- a known install location, the package manager's own report, a direct search -- before writing an install step or an absence-based skip reason that fixes the wrong problem.

## A local gate is not CI

A local gate that scans the live working tree, not the git index, can fail for reasons a clean checkout at the same commit never will. `tools/ci-local.sh`'s `codespell` and `comments` sub-gates run over the working directory; untracked scratch files in the checkout turned both `fail` while a clean worktree at the identical commit reported both `pass`.

A local red that a clean checkout cannot reproduce is worse than a silent pass -- it teaches the team that red is normal and trains reviewers to stop reading it. Before recording a local-gate failure as a real defect, reconcile `git status --porcelain` or reproduce it in a clean worktree at the same commit.

## Artifact-bound predicates

### Bind the predicate to the artifact

Define success in terms of the named deliverable and its required properties. Check existence, non-emptiness, format, identity, and content as the contract requires. A lane exiting `0` while its deliverable is absent, empty, stale, or malformed is a failure.

Report the precise artifact defect: `report.json absent`, `report.json empty`, `report.json invalid schema`, or `candidate digest mismatch`. “Lane failed” hides the evidence needed for recovery.

### Reject unknown outcomes

Enumerate every recognized outcome token and its meaning. If output matches none, classify it as `ERROR` and investigate. Never use an `else => PASS` default. New output, truncated output, and parser drift must fail closed rather than inherit success.

## When to stop

If current tools, permissions, environment, or artifacts cannot verify a claim, stop at **UNVERIFIED**. State:

- the exact claim that remains open;
- why present evidence cannot settle it;
- the exact command, capable environment, or artifact that would settle it;
- which narrower claims, if any, were actually measured.

Do not soften the verdict into “likely works,” “should be fine,” or pass. Uncertainty named precisely is a valid result; invented certainty is not.
