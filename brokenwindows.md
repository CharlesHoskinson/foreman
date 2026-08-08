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

### BW-004 — `flock` is absent on the Windows runner

`open` · carried from the v0.3.0 design doc §7.1

`tests/wt-new.bats` and the other lock-safety suites fail in `setup`, so the
concurrency-safety tests have never executed on Windows. 134 of the 270
Windows failures trace to this alone. Until it runs, "Windows is green" would
be a claim about tests that never ran.

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

### BW-011 — a third copy of the POSIX backslash path-confusion

`open` · reproduced 2026-08-08

`normalizeAbsoluteWorktreeInput` in
`packages/orchestration/src/resume-worktree-restore.ts:214` strips a trailing
`\` unconditionally, the same defect fixed in `credential-profile.ts` and
`secret-scan.ts`. Unlike `normalizeRootInput` it is genuinely exported. It was
out of scope by instruction when the other two were fixed, and is recorded
here rather than fixed silently alongside them. Three copies of one normalizer
is the underlying problem; a shared helper would retire the class.

```bash
sed -n '214,222p' packages/orchestration/src/resume-worktree-restore.ts
```

## Notes on scope

Six verified product defects from the v0.3.0 design doc §W2 are deliberately
**not** listed here. They are tracked release work with an owner and a
workstream, not unclaimed breakage. Their current state, spot-checked
2026-08-08, is that all six are still present in the tree.
