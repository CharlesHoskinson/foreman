# v0.3.0 — Node migration completion, 2026-08-07

Status: **design approved by the owner.** This continues
`2026-08-06-v030-checkpoint.md`, whose brainstorm stopped after Section 1.
Sections 2 (the regime) and 3 (exit criteria) are written here, and every item
that file left open in its §7 is now closed.

This document defines what v0.3.0 is, what it is not, and the order the
remaining work runs in. It does not contain implementation steps; those belong
to the plan that follows it.

## 1. Release definition

**v0.3.0 = "the Node migration is finished." One runtime, one language.**

The thesis is unchanged from the 2026-08-06 checkpoint. It was chosen because
it is provable with a single command, unlike the 18-sprint program, which the
same audit measured at 43 packages and roughly 819 open tasks — over half of
it the tool observing itself, including 87 tasks to decide whether the graph
plane was worth building.

The owner reconfirmed this thesis on 2026-08-07 after being shown that it
conflicted with an in-session instruction to keep v0.3.0 whole.

### 1.1 Python inventory

The release branch tracks 14 `.py` files. `main` tracks 21 because the branch
has already deleted the seven `skills/foreman/graph_store/` modules under
DST-0040.

| Class | Count | Disposition |
|---|---:|---|
| Foreman's own | 7 | Port or retire — this is the release |
| Vendored (`scrapling` x5, `superpowers` x1) | 6 | Declared, not rewritten |
| Archived (`openspec/changes/archive/`) | 1 | Stays |

The seven that must go:

| File | Disposition |
|---|---|
| `skills/foreman/scripts/fm-session.py` | Port — the session store, and the long pole |
| `tests/tier2_collect.py` | Port — live, driven by `tests/tier2-collect.sh` |
| `tests/tier2_compare.py` | Port — live, driven by `tests/tier2-collect.sh` |
| `skills/foreman/ontology/test_ontology.py` | Retire with the projector |
| `docs/research/fetch_frontier_docs.py` | Retire — research utility |
| `docs/research/vnext/contention-derive.py` | Retire — research utility |
| `docs/research/vnext/parallel-schedule.py` | Retire — research utility |

### 1.2 Exit proof

Four predicates, on one unchanged pushed commit:

1. `git ls-files '*.py'` returns exactly the 6 vendored plus 1 archived files.
2. `gates-linux` is green. Windows is **not** a gating platform for this
   release and is excluded by decision, not by omission.
3. `session.bats` passes with `FM_SESSION_CMD` pointed at the TypeScript
   implementation and `fm-session.py` deleted.
4. `tests/positive-control-todo.tsv` is empty for in-scope gates, or every
   remaining row carries a declared reason.

PR #27 leaves draft only when all four hold.

Predicate 2 was rewritten on 2026-08-08. It previously required
`gates-windows` green **and** the Windows gate actually running the Bats
suite, a clause added on 2026-08-07 because
`.github/workflows/gates-windows.yml` set `FOREMAN_CI_BATS: "0"` and so ran 2
of 57 Bats files in a `continue-on-error` probe that could not fail. That
reasoning was right about the defect and wrong about the remedy.

The suite was then measured on Windows for the first time: pass=444 fail=270
skip=26 (run `31199790530`), and a follow-up provisioning run was cancelled at
the 60-minute job cap. 147 of the 270 failures were missing runner tooling
rather than product defects, so the figure measures the runner more than the
code — but the suite does not fit the cap, and nothing on Windows is proven.
`19d5dc0` therefore removed the `push` and `pull_request` triggers, so a red
Windows result cannot block a merge and a green one cannot be mistaken for
Windows support. Evidence:
`docs/evidence/w0/2026-08-07-windows-suite-measurement.md`.

Keeping the old clause would have made the release wait on a platform this
release had already decided not to support, and the two statements were in
open contradiction: the architecture test
`components/council/tests/architecture/hosted-node24-ci.test.ts` still
required every gate workflow to declare a real `pull_request` trigger, which
`19d5dc0` had just removed, so `gates-linux` was red on the disagreement
rather than on any defect in shipped code.

That test now carries the decision per-platform: Linux must declare
`pull_request`; Windows must declare `workflow_dispatch` and must **not**
declare `push` or `pull_request`. Re-adding a gating trigger to Windows fails
the test, so the exclusion cannot quietly erode — both polarities were
demonstrated before the change landed. Windows remains open work, recorded in
`brokenwindows.md` (BW-004, the absent `flock`), not silently dropped.

## 2. Settled decisions

Rows marked 08-06 carry forward from the checkpoint. Rows marked 08-07 were
decided in this session.

| Decision | Choice | Date |
|---|---|---|
| Release thesis | The Node migration is finished — one runtime, one language | 08-06, reconfirmed 08-07 |
| Scope boundary | Foreman's own Python plus the broken lane-queue port; vendored plugins declared, not rewritten | 08-06 |
| Session port | Shrink the surface first, then port | 08-06 |
| Sequencing | Regime first, migration written under it | 08-06 |
| Retrofit exit condition | Every finding fixed **or declared** | 08-06 |
| TDD regime | Positive controls only; repo-wide mutation testing is not adopted | 08-07 |
| Property testing | Scoped to the correctness-critical primitives | 08-07 |
| Ontology and tier2 | Port tier2; retire the ontology with the projector | 08-07 |
| Execution strategy | Freeze `main`; the release branch is trunk | 08-07 |
| `site-patterns.md` | Keep; landed at `8706c04` on three independent reviews | 08-07 |

The TDD-regime row supersedes the checkpoint's repo-wide mutation testing
choice. The suite-health lens argued mutation testing costs hours per run plus
permanent triage, and proposed a positive-control registry scoped to the
gates instead. That registry now exists on `main` with 2 rows proven and 32
gates inventoried as lacking a control, which settled the argument on
evidence.

## 3. Workstreams

Six streams. W0 gates all of them. W1 precedes W2 through W5, per the settled
sequencing. W3 and W5 are independent of each other and can run as parallel
lanes. W4 is the long pole.

### W0 — Unblock

Blocks everything else.

- Merge `main` into the release branch while PR #27 is still `MERGEABLE`,
  clearing the 27-commit gap at its lowest cost.
- Rename the branch. `agent/v029-release-artwork` describes neither v0.3.0 nor
  its contents and has already misled triage. GitHub retargets the open PR on
  rename. Retitle PR #27 to the thesis.
- Freeze `main`. Nothing lands there until v0.3.0 merges except hotfixes,
  which branch off `main` and are cherry-picked to the release branch the same
  day.
- Make the gate trustworthy. Exit predicate 2 *is* a green `gates-linux`, and
  until it is green no one can distinguish new breakage from old.
  - `main`: `tests/baseline.tsv` has two columns where `tests/skip-budget.tsv`
    has three. One expected-pass number must hold for linux, windows and wsl
    at once, so a baseline recorded on a host where `unshare` works is
    unreachable on a GitHub runner. `tests/launcher.bats` expects 4 and the
    runner reaches 3. Give `baseline.tsv` a platform column.
  - Release branch: both `gates-linux` and `gates-windows` die at the
    **Architecture policy against pull request base** step — diagnosed
    2026-08-07 by two independent lanes reaching the same step from different
    platforms, at the same timestamp. Nothing is Windows-specific, and the Bats
    suite never runs on that branch at all.

    An earlier revision of this document blamed `unshare: Operation not
    permitted` in the launcher tests. **That was wrong.** Those lines came from
    *passing* tests: the `ENOENT` is a deliberate assertion of
    `EXIT_LAUNCHER_ERROR`, the Node workspace gates passed 1365/0, and
    `tests/launcher.bats` never executed. The cause had been inferred from log
    proximity — the same mistake `bugeventlog.md` already records for this
    week, made twice.
  - Release branch: `architecture-policy.js` is **unpassable by construction**
    in three cases. It recognizes no `bats` shebang interpreter, so any edit to
    any `.bats` file trips `prohibited_extensionless_executable`. It offers no
    path to add a new compliant thin-adapter `.sh` file, because new files are
    extension-banned before the thin-adapter grammar is reachable. And it
    blanket-denies any edit to `wt-new.sh`. Repairing it requires editing
    `.bats` files and adding `.sh` adapters — precisely what it refuses — so it
    blocks its own repair. This is a policy-tool defect, not shipped-runtime
    code, and it is the real blocker on PR #27.
- Re-measure the session store. `recover` reports the 2026-07-31 session with
  12 of 13 measurements stale; the program must not start from numbers nobody
  may quote.

### W1 — The regime

Positive controls for the 32 inventoried gates. The registry stands at 2 of
34. No gate ships that cannot fail.

Then the suite-accountability defects the checkpoint's §4 recorded, where
every defect found that week lived:

- `npm test` globs are unquoted, so `sh`, which has no globstar, reads
  `src/**/*.test.ts` as `src/*/*.test.ts`. It works by accident because
  nothing lives in a `src/` subdirectory yet.
- `node --test` exits 0 when a glob selects zero tests, so that drop stays
  green.
- 168 bare `if (…) return;` statements in TypeScript test bodies, which Node
  counts as passes. Several are real capability guards.
- Four of five skips are anonymous: the codebase uses `{ skip: true }`, which
  prints a bare `# SKIP`, rather than `{ skip: "reason" }`.
- `tests/baseline.tsv` claims 21 passes for lane-queue against a real
  14 pass / 2 skip / 7 fail.
- `tests/run.sh` now defaults `TEST_GATE_MODE` to `enforce` at line 15, but
  its header comment at line 4 still says the default is `shadow`. Two
  contracts in one file.

An unrunnable gate counts as a failure, never as a pass.

### W2 — The six verified defects

Each lands failing-test-first, as the regime's first proof. All six were found
by review agents that ran the code, and all six are unfixed.

| Defect | Location |
|---|---|
| Unguarded recursion throws a raw `RangeError`; `MAX_JSON_DEPTH` is consulted only after parsing | `packages/core/src/canonical-json.ts` |
| `normalizeAbsolutePath("/tmp/x\\")` collapses to `/tmp/x` on POSIX, where `\` is a legal filename character — a path-confusion primitive inside credential-authority comparison | `packages/orchestration/src`, duplicated in `secret-scan.ts` |
| `argvWithoutDetach` corrupts the re-exec argv when a flag value is literally `--detach` | launcher |
| `decodeUtf8Fatal` silently strips a UTF-8 BOM, so `sha256Hex(bytes) !== sha256Hex(decodedText)` while the text still passes `isCanonicalJsonText` | `packages/core` |
| Unthrottled spawn fallback discards vendor caps: when `pueue` is unavailable it spawns directly with no concurrency limiting, and the measured `grok=3` / `codex=2` caps evaporate | `queue-admission.ts:643-653` |
| Six `set*RaceHook` functions reach the published `.d.ts`, letting a consumer install a hook into a credential-authority write path | `packages/orchestration/src/index.ts` |

Two are security-shaped: the path confusion and the discarded concurrency
caps.

### W3 — lane-queue contract reconciliation

Five artifacts encode two contracts after the `add` verb gained five mandatory
Endstop flags: `SKILL.md` and the shipped CLI carry the new contract;
`queue-admission.ts:639`, `docs/USAGE.md` and `tests/lane-queue.bats` carry
the old one, and `queue-admission.ts` prints the wrong syntax. In scope by
name under the settled scope boundary.

### W4 — The session port

The long pole. Order matters and is settled: shrink the surface first, then
port.

1. Retire `fm-session.py project`. It emits TerminusDB documents, TerminusDB
   is withdrawn across three archived change packages, and the verb has zero
   rows and no callers. The `skills/foreman/ontology/` SQLite schema and its
   test retire with it.
2. Write golden fixtures. `session.bats` has 34 tests, 44 exit-status checks,
   20 sqlite probes and 42 sidecar probes, and **zero output-content
   assertions** — a port could print anything at all and pass. Fixtures land
   before the Python is deleted, never after.
3. The conformance seam is **already in place** and needs no work. Commit
   `51bcc1d` changed `setup()` to
   `SESS="${FM_SESSION_CMD:-python3 $SCRIPTS/fm-session.py}"` at
   `tests/session.bats:13`, which turned all 34 tests into a
   cross-implementation conformance suite. The checkpoint named this as the
   cheapest step any review lens found; it landed before this design was
   written. What remains is to point `FM_SESSION_CMD` at the TypeScript
   implementation and make the suite pass.
4. Port the remaining surface to TypeScript. The store's real surface is four
   tables: `facts` 510 rows, `measurements` 136, `obligations` 103,
   `sessions` 10.
5. Delete `fm-session.py`.

Sprint 6's project registry is not built. There is no `projects` table and
there never has been.

### W5 — The remaining Foreman Python

- Port `tests/tier2_collect.py` and `tests/tier2_compare.py`. Both are live in
  the formal Tier 2 path through `tests/tier2-collect.sh`.
- Retire the three `docs/research/` utilities.
- The ontology retires in W4 with the projector.

### W6 — Release close

Run the exit proof on one unchanged pushed commit, take PR #27 out of draft,
merge as v0.3.0, and unfreeze `main`.

## 4. Verification

### 4.1 Per-change bar

- Every new or changed gate carries a positive-control row proving that
  known-bad input fails and known-good input passes.
- Every defect fix lands failing-test-first.
- Local truth is one command:
  `FOREMAN_CI_BATS=1 bash tools/ci-local.sh`, whose last line must read
  `CI-LOCAL RESULT PASS gates_failed=0`.
- No measurement is quoted without the command that produced it.

### 4.2 Property testing

`fast-check` is declared only in `components/council/package.json` at `4.9.0`,
while the hoisted `node_modules` copy is `3.23.2`, a transitive of `effect`. A
property test written at the root today would bind silently to an undeclared,
major-behind version. Therefore:

- Adopt `fast-check` as a pinned root devDependency, which closes the
  silent-bind hazard on its own.
- Put arbitraries in a private `packages/testkit`, not in `@foreman/core`,
  which ships.
- Write property tests for the correctness-critical primitives only: canonical
  JSON, path normalization, and UTF-8 decoding. Three of the six W2 defects
  are exactly this shape.

Broader property testing is a v0.4.0 question.

## 5. Risks

| Risk | Mitigation |
|---|---|
| The gate can lie. It did twice this week: `TEST_GATE_MODE` defaulted to `shadow`, pointing the instruments at a disarmed trigger, and `baseline.tsv` claimed 21 lane-queue passes against a real 14/2/7 | W1, plus the rule that an unrunnable gate counts as a failure |
| Host-capability coupling. The `baseline.tsv` / `skip-budget.tsv` column asymmetry put `main` red for six consecutive runs and will do it again | Platform column in W0, not deferred |
| Silent session divergence, since `session.bats` asserts no output content | Golden fixtures before deletion, W4 step 2 |
| A frozen `main` with no hotfix path breaks quietly the first time something urgent lands | Hotfix branches off `main`, cherry-picked to the release branch the same day |
| Stale facts: 12 of 13 measurements are stale and the last recorded session is 2026-07-31 | Re-measure at W0 close |
| The release branch carries 296k lines of generated bundles under `skills/foreman/runtime/dist/`, which look like noise but are the shipping artifact | Do not de-track them. Review `packages/*/src`; let `manifest.json` digests prove dist matches source, and `git diff --exit-code` on dist prove it was regenerated |

## 6. Out of scope

Deferred to v0.4.0, with the sprint numbers they carry in the v0.3.0 program
package:

- Sprints 8 through 13: the Council advisory plane, durable Council runtime
  and security, Gemini, aggregate readiness, supervised research gateway,
  evidence provenance, Council MCP and host plugins, `@foreman/release` and
  the formal-model plane, and `@foreman/knowledge` with Graphify convergence.
- Sprint 16: external dogfood, the Windows boundary, ready-token multi-domain
  Council closure, and the Council evaluation program.
- Sprint 6's project registry, cut on the evidence that no `projects` table
  has ever existed.
- The knowledge and graph plane at roughly 310 tasks, doctrine-drift detection
  at 41, and decision lineage at 47.
- Repo-wide mutation testing.

Deferring these does not retire their specifications. The change packages under
`openspec/changes/` remain valid and unmodified; only their release assignment
moves.

## 7. Open items

None blocking. Every item the 2026-08-06 checkpoint left open in its §7 is now
closed: mutation testing resolved to positive controls, property testing
scoped to the primitives, `site-patterns.md` kept at `8706c04`, and Sections 2
and 3 of the design written above.

Two items surfaced during W0 execution on 2026-08-07 and need an owner
decision. Both are the same shape: a gate that cannot run is being read as a
gate that passed.

1. **`flock` is absent on the Windows runner**, so `tests/wt-new.bats` and the
   other lock-safety suites fail in `setup`. The concurrency-safety tests have
   therefore never executed on Windows. Provisioning `flock` will likely turn
   most of them green — 134 of the 270 Windows failures trace to it alone —
   but until it runs, "Windows is green" would be a claim about tests that
   never ran.
2. **`dependencies/README.md:104` declares the `sqlite3` CLI "Not required —
   convenience only"**, because the code uses the python3 stdlib module. But
   `tests/session.bats:360` and `:518` shell out to the CLI, and it is absent
   on the WSL host, so those three tests fail rather than skip with a reason.
   Either the manifest is wrong or the suite is. Installing `sqlite3` would
   hide the contradiction rather than resolve it, so it has deliberately not
   been installed.

Neither blocks W0's remaining tasks. Both block the claim that a green gate
means a passing suite.
