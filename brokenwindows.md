# brokenwindows.md — small breakages that are still in the tree

A running log of things this repository is *missing* or has left broken: the
small, cheap, unglamorous defects that nobody has claimed. Not the release
program, not the sprint backlog, not the incident history.

Three files already exist and this one is none of them:

- `bugeventlog.md` — incidents that already happened, with their fallout.
- `AGENT_TRAPS.md` — standing rules distilled from those incidents.
- `docs/RESIDUALS.md` — what a release deliberately does not do, decided.

This file is the gap between them: **known, undecided, unassigned**. A row
leaves when it is fixed, or when it is promoted to `RESIDUALS.md` as a
deliberate decision. A row does not leave because it got old.

## Rules

1. Every row carries the command that reproduces it. A row without one is a
   rumour.
2. Say whether the row was **reproduced** by the person writing it, or
   **carried** from another document. Carried rows are not evidence.
3. A gate that cannot fail is a broken window, not a passing gate.
4. Fixing a row means deleting it here in the same commit as the fix.

Status: `open` · `fixed-unlanded` (fixed locally, not on `main`) · `blocked`
(needs an owner decision).

## Open

### BW-002 — `dependencies/check-drift.sh` cannot detect a missing port

`open` · carried from `docs/evidence/w1/2026-08-08-regime-coverage.md` §5

Both mechanisms that exist to catch a dependency declared in the manifest but
dropped from the TypeScript side stayed green after `sqlite3`'s entire
declaration was deleted. `check-drift.sh` classifies a manifest-only tool as
`INFO` by design; `tests/durable-preflight.bats` test 8 is scoped to
`(coreutils, nats-cli)` and never looks at `sqlite3`. The W1 record states
plainly: "This is a gate that cannot fail, and it is not fixed."

```bash
bash dependencies/check-drift.sh; echo "exit: $?"
```

### BW-003 — the `sqlite3` manifest contradiction

`open` · carried from the v0.3.0 design doc §7.2

`dependencies/README.md:104` declares the `sqlite3` CLI "Not required —
convenience only", because the code uses the python3 stdlib module. But
`tests/session.bats:360` and `:518` shell out to the CLI. It is absent on the
WSL host, so those tests fail rather than skip with a reason. Either the
manifest is wrong or the suite is. Installing `sqlite3` hides the
contradiction rather than resolving it, which is why it has deliberately not
been installed.

### BW-005 — two `maintenance.yml` gates have no positive control

`open` · carried from `docs/evidence/w1/2026-08-08-regime-coverage.md` §3

`maintenance.yml::Open issue with findings` and `maintenance.yml::report` are
the only two deferrals in the registry filed as "not yet attempted" rather
than analysed as infeasible. They are open work, not reasoned exclusions.

```bash
grep maintenance tests/positive-control-todo.tsv
```

### BW-006 — `RESUME.md` names a trunk that no longer exists

`open` · reproduced 2026-08-08

`RESUME.md` §"Release freeze" instructs every reader to send all v0.3.0 work
to `release/v0.3.0` (PR #27) and states that `main` is frozen. PR #27 merged
on 2026-08-07 and no `release/v0.3.0` branch exists on the remote. The file
that exists specifically so a cold reader is not misled currently misleads a
cold reader — the same failure its own header describes, which is why it was
written to contain nothing that can rot.

```bash
git ls-remote --heads origin 'release/v0.3.0'   # returns nothing
gh pr view 27 --repo CharlesHoskinson/foreman --json state  # MERGED
```

### BW-007 — no mechanism keeps a derived plugin copy fresh

`open` · reproduced 2026-08-08

`plugins/foreman-qa/INSTALL.md` correctly says an installed copy is derived
and disposable, but nothing regenerates one. The Windows-side copy at
`%USERPROFILE%\.claude\plugins\foreman-qa` had drifted to 4 skills against the
repo's 5, missing `foreman-afk` entirely, and was not registered in
`installed_plugins.json`. `install.sh` does not mention the plugin at all, so
there is no supported refresh path — only the manual steps in INSTALL.md and
`tools/plugin-drift.sh` to detect the drift after the fact.

```bash
bash tools/plugin-drift.sh ~/.claude/plugins/foreman-qa plugins/foreman-qa
grep -c foreman-qa install.sh   # 0
```

### BW-008 — the session store is stale and points at another host

`open` · reproduced 2026-08-08

`fm-session.py recover` reports its last session as `2026-08-03`, still
describing v0.2.9.0 work, with the recorded commands referencing
`/home/charl/foreman` and `/home/charl/.foreman/...` — paths belonging to a
different host than the `/root/foreman` checkout that is current. The store
that `RESUME.md` names as "the only thing that stays true without someone
remembering to edit it" is not currently true here.

```bash
python3 skills/foreman/scripts/fm-session.py recover | head -5
```

### BW-010 — secret-scan cannot scan its own worktree clean

`open` · reproduced 2026-08-08

`secret-scan.test.ts` case "scans the current Foreman worktree clean under
default bounds" returns `{"_tag":"Refused","reason":"bound_exceeded"}`, so the
file exits 1 on a clean checkout. Reproduced at `f2142ce` and at its parent,
so it is pre-existing and not caused by any current work. It means a whole-file
pass summary for this package cannot be used as evidence for anything else in
it — which is how it was nearly missed.

```bash
npx tsx scripts/run-tests.ts 'packages/orchestration/src/secret-scan.test.ts'; echo "exit: $?"
```

### BW-011 — three separate path normalizers must be kept in agreement

`open` · reproduced 2026-08-08

The POSIX backslash path-confusion this row used to track is **fixed** at all
three sites — `normalizeAbsolutePath`, `normalizeRootInput`, and
`normalizeAbsoluteWorktreeInput` — failing-test-first, six tests, `# fail 6`
before and `# pass 6` after. What remains is the shape that produced it: three
independent normalizers over one concept. Each is now a single `resolve()`
call, so they agree today by being trivial rather than by construction, and
nothing fails if one of them grows a special case again.

An earlier version of this row said the defect was "the same defect fixed in
`credential-profile.ts` and `secret-scan.ts`". That was carried, not
reproduced, and it was false — measurement found all three sites unfixed. Rule
2 exists for exactly this.

Retiring the class means one shared helper. That is a refactor rather than a
defect fix and it re-cuts bundle digests, so it was deliberately kept out of
the v0.3.0 tag commit and belongs to v0.4.0.

```bash
sed -n '214,222p' packages/orchestration/src/resume-worktree-restore.ts
```

### BW-012 — the positive-control registry does not survive a language port

`open` · reproduced 2026-08-08

The Node/TypeScript port turned `env/tool-check.sh` into a 9-line Node adapter
and left nine registry rows naming shell functions that no longer exist. The
comparator went red, and because `tests/positive-control.bats:186` asserts the
committed registry is itself green, **no branch in the repository could pass
CI** until it was fixed. The failure set is byte-identical on `origin/main` and
on any branch cut from it.

The deeper defect is that `tests/lib/check-inventory.sh` recognises a check by
a name pattern (`probe*`, `check*`, `fmTc*`). A port that renames functions
makes them invisible, and invisible checks silently leave the coverage
universe. The regime cannot currently detect its own erosion by rename.

```bash
bash tests/lib/check-registry-compare.sh; echo "exit: $?"
```

### BW-013 — the scanner recognises checks by hardcoded name, not by property

`open` · reproduced 2026-08-08

The round-2 repair for BW-012 added six literal function names to the
`check-inventory.sh` grep pattern. It works — `enforced` went 32 to 38 and the
six newly visible checks are the genuine TypeScript successors, with nothing
dropped — but it converts a rule into a hand-maintained allowlist. The seventh
differently-named check is invisible again and BW-012 recurs.

A check should be recognised by a property it carries (an explicit marker, or
a convention the code actually follows), not by appearing on a list someone
remembered to extend.

```bash
git -C . diff origin/main -- tests/lib/check-inventory.sh
```

### BW-014 — the Tier 2 port is blocked on statistical equivalence

`blocked` · reproduced 2026-08-08

`tests/tier2_collect.py` and `tests/tier2_compare.py` are two of the four
Foreman Python files predicate 1 still counts. Two porting attempts were made
and both were rejected on measured evidence, not on review taste.

The first passed all 27 tests in `tests/tier2-compare.bats` and was still not
equivalent. The oracle drives the CLI from outside and never asserts a
statistical value, so it cannot see the part a port most endangers. Running
both implementations over the same fixtures showed two divergences:

- every whole-valued float lost its decimal — Python `12.0`, TypeScript `12` —
  across machine-readable records that are hashed and schema-checked downstream
- `seeded-06` reported `uncertainty_half_width` of `0.09999999999999992` in
  Python and `0.0837499999999996` in TypeScript, about 16% apart on identical
  input, because Python's MT19937 had been replaced with mulberry32 and the
  bootstrap resamples no longer matched

The second attempt tried to preserve float-ness with a `__FLOAT__` sentinel and
made it worse. After a clean rebuild the TypeScript emits
`"confidence_level": "__FLOAT__[object Object]__FLOAT__"`,
`"absolute_difference": null`, `"percent": "__FLOAT__NaN__FLOAT__"`, and
reports `decision: "evaluated"` where Python reports `"not_evaluated"`.

The port is backed out. The Python drives Tier 2 again and the 27-test oracle
is green. Predicate 1 therefore stands at 11 tracked `.py` rather than 7, and
that is the honest number: a statistical evaluator that reports different
confidence intervals for the same data has changed behaviour, and shipping it
to satisfy a file count would trade a correctness property for an inventory
one.

What the next attempt needs, which neither had: a fixture-level equivalence
test inside the oracle, so `tier2-compare.bats` can fail on a numeric
divergence instead of passing over it.

```bash
python3 tests/tier2_compare.py compare tests/fixtures/tier2/comparison.json --output /tmp/py.json
# then the same via the TypeScript bundle, and: cmp /tmp/py.json /tmp/ts.json
```

### BW-015 — `argvWithoutDetach` keeps a hardcoded list of value-taking flags

`open` · carried from the W2 council, 2026-08-08

The D3 fix stopped `argvWithoutDetach` from stripping a `--detach` that is a
flag's *value*, and it works. But it does so by special-casing four flag names
— `--timeout`, `--grace`, `--heartbeat-file`, `--heartbeat-interval` — and
advancing past their values. A fifth value-taking flag added later is not in
that list, so `--new-flag --detach` loses its value again and the defect
returns silently.

This is the same shape as [[BW-013]]: a rule expressed as an allowlist someone
must remember to extend. The principled form drives the value/flag distinction
from the same metadata the real CLI parser uses, rather than a second copy that
can drift from it.

Only `--heartbeat-file` is covered by a test, so the other three are not
protected either.

```bash
grep -n -A12 'export function argvWithoutDetach' packages/launcher/src/cli.ts
```

### BW-016 — removing an export from `index.ts` does not fence the subpath

`open` · carried from the W2 council, 2026-08-08

The D6 fix removed four `set*RaceHook` setters and their types from
`packages/orchestration/src/index.ts`, and a test now asserts they are absent
from the package namespace. That closes the barrel.

It does not close the package. The setters still exist in their implementation
modules, and whether a consumer can reach them by deep import
(`.../secret-scan.js`, `.../credential-profile.js`) depends on the `exports`
field in `package.json`, which the change did not touch and no test covers. A
race hook installed into a credential-authority write path is the hazard; index
hygiene alone does not prove it is unreachable.

`setSecretScanDirectoryAnchorCapabilityForTests` is still exported from the
barrel next to where the race hook was removed, which suggests the boundary is
drawn by habit rather than by rule.

```bash
python3 -c "import json;print(json.load(open('packages/orchestration/package.json')).get('exports'))"
```

### BW-017 — a worktree with symlinked `node_modules` builds a different artifact

`open` · reproduced 2026-08-08

Two workstreams sharing one checkout kept colliding, so a second git worktree
was created and its `node_modules` symlinked to the main checkout's to avoid a
slow reinstall. The bundles built there passed `verify-runtime: ok` locally and
failed CI with `destruction-guard drift`.

The symlink is the defect. `esbuild` inlines whatever dependency tree it is
pointed at, and the main checkout's `node_modules` is not what
`package-lock.json` describes. Building through the symlink moved **all
fifteen** bundles, each about 2 KB larger, with `repo-hygiene.js` the only one
untouched — a blast radius far wider than the two packages the change actually
edited. After `npm ci` in the worktree, the same source produced a credible
result: 12 of 16 bundles, +117 to +304 bytes each.

The trap is not the drift, which CI caught. It is that `verify-runtime: ok`
was true the whole time — of a tree nobody ships. A local green from a
non-reproducible dependency tree is not evidence about the build the lockfile
describes, and it is the only build that matters.

Use `npm ci` in a new worktree. The minutes it costs are cheaper than a CI
cycle plus the diagnosis.

```bash
git worktree add /path/wt <branch> && cd /path/wt && npm ci   # not: ln -s ../node_modules
```

### BW-018 — the launcher suite cannot complete on a pidns-capable host

`open` · reproduced 2026-08-08

`packages/launcher/src/supervise.test.ts` aborts mid-file on this WSL2 host
(Node v24.18.0, running as root, `unshare` available). Four describes report
`✔` — seven named tests pass — then a spawned child prints `hi` and
`foreman-launch: capability=posix_pidns_strong unshare=/usr/bin/unshare`, and
the process dies:

```text
ERR_MODULE_NOT_FOUND: Cannot find module
  '/root/foreman/packages/launcher/src/heartbeat.js'
  imported from /root/foreman/packages/launcher/src/supervise.test.ts
```

That sibling cannot exist. The package sets `outDir: "dist"`, and
`npx tsc -b --force` emits zero `.js` files into `src/`. So some spawned
process is running the test file as a plain `node` entry, without the loader
that maps `./heartbeat.js` onto `heartbeat.ts`.

The crash takes the rest of the file with it. Tests that CI runs and passes
never report here at all — the exit-125 SpawnError path, "exactly one tree kill"
on interrupt, "no zombie direct children on /proc" under 1000+ short
descendants, and the byte-exact compiled-bundle piping test.

**CI is green on the same commit and reaches more of this file than this host
does**: `tests 1398 / pass 1394 / fail 0 / skipped 4`, including
`✔ large piped stdout and stderr are byte-exact through foreman-launch.js`. So
this is not a CI blind spot. It is a host-specific abort, and the visible
difference is that this host reports `capability=posix_pidns_strong` with
`unshare` permitted, a path a GitHub runner does not take.

Cause **not** identified. One hypothesis was tested and refuted: that the
test's `spawn(..., { env: process.env })` leaks node's `NODE_TEST_CONTEXT` and
`NODE_TEST_WORKER_ID` markers into the child — which `scripts/run-tests.ts`
strips for exactly that reason. Running the compiled bundle by hand with and
without those variables exits 0 both ways, with no module error.

```bash
npx tsx scripts/run-tests.ts 'packages/launcher/src/supervise.test.ts'; echo "exit=$?"
ls packages/launcher/src/*.js 2>/dev/null | wc -l   # 0 — the import cannot resolve
```

Why it matters: §4.1 of the v0.3.0 design doc makes local truth one command.
On a host with strong pidns capability that command cannot go green, so the
regime's own local gate is unavailable exactly where the pidns kill-cascade is
live. Pre-existing and not from the branch that found it — identical on
`ca2e5f6`.

## Notes on scope

Six verified product defects from the v0.3.0 design doc §W2 are deliberately
**not** listed here. They are tracked release work with an owner and a
workstream, not unclaimed breakage.

Their state, measured on 2026-08-08 rather than carried:

| Defect | State | Landed by |
|---|---|---|
| Unguarded recursion in `canonical-json.ts` | fixed | `a744e9f` |
| POSIX backslash path-confusion, three sites | fixed | this commit |
| `argvWithoutDetach` argv corruption | fixed | `a744e9f` |
| `decodeUtf8Fatal` BOM / digest disagreement | fixed | `a744e9f` |
| Unthrottled spawn fallback discards vendor caps | fixed | `a744e9f` |
| `set*RaceHook` reaching the published surface | fixed | `d74600e` |

An earlier version of this section said "all six are still present in the
tree", spot-checked the same day. It was wrong in both directions: five had
already landed in `a744e9f` and `d74600e`, and the sixth was still present
after a report claimed it fixed. Both errors came from carrying a claim
instead of running the command that would have settled it.
