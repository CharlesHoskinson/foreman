# W1 regime coverage record -- 2026-08-08

This closes the "W1 -- The Regime" workstream. Per foreman-qa doctrine
(`plugins/foreman-qa/skills/foreman-qa/references/evidence-rules.md`), a
coverage claim that omits its own exclusions is the failure this workstream
exists to prevent. Every figure below is reproduced by the command shown,
run against this worktree (`/root/fm-wt/w1-close`, branch `w1/close-regime`)
on 2026-08-08.

## 1. Measured coverage

```
$ bash tests/lib/check-registry-compare.sh
check-inventory: 796 rows -> tests/.check-inventory.tsv
positive-control: inventory=796 enforced(gate,probe)=34 registered=22 deferred=12
positive-control: assertion and verdict-predicate kinds are inventoried but NOT enforced -- coverage claims must say so
positive-control: OK
```

`inventory=796`, `enforced=34`, `registered=22`, `deferred=12`. `22 + 12 =
34`, so every enforced-kind check is accounted for as either registered or
explicitly deferred; none are silently missing from both.

## 2. What is not enforced at all

The comparator prints this itself, and it is repeated here because a reader
who sees "22 of 34" without it will badly overestimate coverage:

> assertion and verdict-predicate kinds are inventoried but NOT enforced --
> coverage claims must say so

Of the 796 checks the inventory found across the repository, only 34 are of
an enforced kind (`gate`, `probe`). The other 762 are `assertion` and
`verdict-predicate` kinds -- ordinary test assertions and policy
verdict-predicates -- and none of them carry, or are required to carry, a
positive control under this regime. `22 of 34` describes coverage of a
34-row subset that is itself under 5% of everything inventoried. It is not a
claim about the other 762 rows, and this document makes no such claim.

## 3. Deferred gates, grouped by reason

All 12 rows come from `tests/positive-control-todo.tsv`, verbatim. Grouped
into 6 categories so the pattern is visible rather than a flat list.

### Host mutation -- would permanently change a shared, long-lived dev host

3 gates. Each installs software or downloads assets directly onto the host
running the check, with no disposable target to redirect the mutation into.

- `.github/workflows/formal.yml::Install pinned Quint 0.32.0` -- installs
  Quint globally via `npm install -g` and writes `$GITHUB_ENV`; would mutate
  this host's global npm state, which already holds a different
  fnm-managed Quint, with no separable script exposing a stable predicate.
- `.github/workflows/gates-linux.yml::Install NATS test dependencies` --
  downloads and `sudo`-installs `nats-server`/`nats-cli` into
  `/usr/local/bin`; not safely reversible from a worktree.
- `.github/workflows/gates-linux.yml::Install gate dependencies` -- runs
  `sudo apt-get install` plus global npm installs and checksum-verified
  downloads directly against host package state.

### Requires a specific runner unreachable from this worktree

4 gates. Each depends on `windows-latest` GitHub Actions runner semantics
(`winget.exe`, MSYS2/Git Bash `PATH` resolution, PowerShell junction
`Test-Path`/`Get-Item`/`.LinkType`) that a WSL/Linux host cannot reproduce.

- `.github/workflows/gates-windows.yml::Install gate dependencies`
- `.github/workflows/gates-windows.yml::Run Council Node 24 gate` -- same
  commands as the already-controlled `gates-linux.yml` step, but this repo's
  own evidence record shows Windows `PATH` resolution (`flock`) diverging
  from Linux in ways invisible from a Linux run.
- `.github/workflows/gates-windows.yml::Run the shared gate definition with
  Git Bash` -- same reachability problem, and additionally runs with
  `FOREMAN_CI_BATS=0`, so even a faithful Windows reproduction would
  exercise a narrower predicate than the Linux gate does.
- `.github/workflows/windows-smoke.yml::Run install.ps1 and assert
  junctions resolve` -- requires real Windows junction semantics. This one
  is doubly blocked: `install.ps1` also writes into this real machine's own
  `$env:USERPROFILE\.claude\skills`, a live shared location, so it would be
  unsafe to execute even from a capable Windows host without a disposable
  target.

### No failable assertion -- the predicate cannot go negative

1 gate.

- `.github/workflows/formal.yml::Install Apalache 0.56.1 (schedule tier)`
  -- the step's `run:` block only creates `~/.quint` and, if the Apalache
  dist directory is absent, prints an informational log line. It contains
  no assertion, test, or exit path capable of a non-zero result, so there
  is no predicate to control.

### Cannot fail by construction

1 gate. See Section 4 -- named there on its own because this is a distinct
category from "hard to test."

- `.github/workflows/gates-windows.yml::Probe the bats suite on Windows
  (non-gating)`

### Redundant with sub-gates already controlled elsewhere

1 gate.

- `.github/workflows/gates-linux.yml::Run the shared gate definition` --
  delegates to `tools/ci-local.sh`, which is genuinely runnable locally, but
  its lanes-completeness sweep reads `$FM_WT_DIR/*`, which would read other
  concurrently running lanes' live worktrees -- out of scope for this task's
  brief, which says to stay in this lane. Its constituent sub-gates
  (`tests/run.sh`'s `validate_baseline_file`, `validate_skip_budget_file`,
  `lookup_baseline`, `lookup_skip_budget`) are already independently
  controlled elsewhere in the registry, so reproducing the full 10-gate
  orchestration a second time to control the outer step was judged not
  worth the cross-lane read risk.

### Not yet attempted

2 gates. No control has been written; these are open, not analyzed as
infeasible.

- `.github/workflows/maintenance.yml::Open issue with findings` -- "no
  positive control yet; inventoried 2026-08-06."
- `.github/workflows/maintenance.yml::report` -- "no positive control yet;
  inventoried 2026-08-06."

## 4. Gates that cannot fail by construction

These are not "hard to test." They are steps whose own configuration
removes the possibility of a negative outcome, so no fixture, however
well-designed, could ever make them report failure. That makes them a
different category from every deferral in Section 3 that cites difficulty,
risk, or unreachability -- those checks *could* fail if reached; these
cannot fail regardless of what they observe.

- `.github/workflows/gates-windows.yml::Probe the bats suite on Windows
  (non-gating)` runs with `continue-on-error: true` and
  `TEST_GATE_MODE=shadow`. `continue-on-error: true` means the job step
  cannot fail the job no matter what its own command returns; shadow mode
  means the command it runs does not even attempt to signal policy failure
  via exit code. Two independent reasons stack to guarantee no `NEGATIVE`
  outcome is reachable. It is deliberately evidence-only, not enforcing --
  a legitimate design (obligation 60 in `bugeventlog.md`), but a reader
  should not mistake its presence in CI for a gate.

## 5. Beyond the registry: what W1's lanes found and fixed

These were discovered while doing the registry work, are outside the
registry itself, and are recorded here because they belong in the closing
account of the workstream. Each was independently reproduced before being
written down; none is taken on report alone.

### The TypeScript suite silently dropped tests

`package.json`'s `test` script passed unquoted glob patterns
(`packages/core/src/**/*.test.ts`, etc.) to `sh`, which has no `globstar`.
Adding `packages/core/src/sub/throwaway.test.ts` caused `sh` to pre-expand
that package's pattern to the one literal match, silently dropping every
sibling non-nested test file in `packages/core/src/` from the run with no
error: 31 tests across 10 suites (measured 1360 tests/250 suites baseline vs
1329/240 with the nested file present, reproduced and documented in
`docs/evidence/w1/2026-08-08-ts-suite-audit.md` on the release branch,
`agent/v029-release-artwork`). Fixed on that branch by routing `npm test`
through `scripts/run-tests.ts`, which resolves each glob itself via
`globSync` before handing already-expanded, quoted paths to `node --test`.
The suite total went from 1360 to 1363 (the three new positive/negative/
regression-control tests for the wrapper itself).

### Empty test selection exited 0

`node --test 'packages/core/src/nonexistent-*.test.ts'` reported `tests 0`
in every category and exited `0` -- a suite invocation matching nothing
looks identical to "everything passed" by exit code alone. Fixed by the same
`scripts/run-tests.ts` wrapper: each pattern is required to resolve to at
least one file before `node --test` is allowed to run, and an empty pattern
is named on stderr with a non-zero exit.

### 26 capability guards were silent

The release-branch audit (`docs/evidence/w1/2026-08-08-ts-suite-audit.md`)
classified 75 bare `if (...) return;` statements in
`packages/*/src/*.test.ts` test bodies. 47 were harmless type-narrowing
idiom immediately following an assertion, 2 were grep false positives
(helper-function control flow, not test bodies), and 26 (24 platform guards
such as `IS_WIN`, plus 2 external-tool-availability guards) were real
capability guards returning early with no signal: Node counted each as an
ordinary pass. All 26 were converted to `t.skip("reason")` on the release
branch (commits `db30293`, `a49f5fe`, `b21c93a`, "W1 Task 9").

On this Linux host none of those 26 guards fire (the conditions they guard
against, such as `win32`, are not true here), so running the suite here does
not move pass/skip counts -- the fix is proven instead by a synthetic
control, independently reproduced for this record:

```
$ node --test old.test.mjs   # if (true) return;
ℹ pass 1
ℹ skipped 0
$ node --test new.test.mjs   # if (true) { t.skip("reason"); return; }
ℹ pass 0
ℹ skipped 1
```

The old pattern is indistinguishable from a genuine pass; the new pattern
reports a skip, which is what actually happened.

### The dependency-drift check cannot detect a missing port

`env/tool-check.sh` and `dependencies/check-drift.sh` are now both thin
Node adapters delegating to TypeScript
(`packages/orchestration/src/tool-check-report.ts`'s `profileToolIds`, and
`packages/orchestration/src/dependency-drift.ts`, bundled to
`skills/foreman/runtime/dist/`). Negative control performed for this record:
in a disposable worktree at the release-branch tip
(`agent/v029-release-artwork`, `4a87807`), removed both `"sqlite3"` entries
from `profileToolIds` in `tool-check-report.ts`, ran `npm run build` (dist
hashes for `tool-check.js` and `dependency-drift.js` changed, confirming the
rebuild picked up the edit), then re-ran both checks:

```
$ bash dependencies/check-drift.sh
INFO  manifest declares "sqlite3" but env/tool-check.sh does not report it
dependencies: no drift (manifest, tool-check and bootstrap agree)
$ echo $?
0
$ bats tests/durable-preflight.bats -f "preflight ids align with manifest"
ok 1 preflight ids align with manifest (coreutils, nats-cli)
```

Both stayed green after `sqlite3`'s entire TypeScript-side declaration was
deleted. `check-drift.sh` classifies a manifest-only tool as `INFO`, not
`DRIFT`, by design (its rule 2: "the manifest legitimately documents tools
the readiness report does not gate on"); `tests/durable-preflight.bats` test
8 is scoped only to `(coreutils, nats-cli)` and never looks at `sqlite3` at
all. Neither mechanism that exists to catch exactly this class of gap
caught it. **This is a gate that cannot fail, and it is not fixed.** It is
recorded here, not in Section 3, because it was not deferred with a reason
-- it was measured to be broken and left that way, which this record exists
to surface rather than hide.

## 6. Task-by-task context

For reference, task-by-task history of how coverage reached `registered=22`
(reported as context from the workstream plan; the figures actually
re-measured for this record are Sections 1-3 above, not this breakdown):
Task 1 controlled 3 `tests/run.sh` gates; Task 2 controlled all 9
`env/tool-check.sh` gates without modifying that script; Task 3 controlled 4
of 14 CI workflow gates and deferred 10; Task 4 controlled the last 3
individual gates. Tasks 6-9 ran on the release branch
(`agent/v029-release-artwork`) and produced the TypeScript-suite
accountability fixes recorded in Section 5. Task 5 (this document) records
the close; it registers no further controls.
