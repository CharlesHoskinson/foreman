# DESIGN PROMPT — project registry and project-bound sessions

You are designing a feature for the Foreman plugin. Produce a design, then
implement it. Assume no memory of the session that wrote this prompt.

**Read `skills/checkpoint/SKILL.md` first.** Then run
`python3 skills/foreman/scripts/fm-session.py recover` in the Foreman repo. That
is the system you are extending, and it will tell you the current state.

Repo: `/root/fm-wt/integrate` (branch `integrate/v029-w1`, level with `main`).

---

## The requirement

Foreman is used across many projects. Today its session store assumes exactly
one. Add a **project registry**, and bind every session to a project, so that
recovery answers *"what is true in THIS project"* rather than *"what is true in
whatever directory I happen to be in"*.

---

## What exists today — inline facts, verify them before trusting them

`skills/foreman/scripts/fm-session.py`, SQLite schema version 2.

**Tables:** `sessions(session_id, started_ts, start_sha, ended_ts, note)`,
`facts(id, statement, evidence, established_ts, session_id, superseded_by,
superseded_at, supersede_reason)`,
`measurements(id, metric, value, command, measured_ts, measured_sha,
scope_paths, session_id, value_num)`,
`obligations(id, statement, status, blocker, opened_ts, closed_ts, session_id)`.

**Database location** — this is the crux. `db_path()` returns
`FOREMAN_SESSION_DB` if set, else `<repo_root>/.foreman/session.db`, where
`repo_root()` is `git rev-parse --show-toplevel`. **The store is therefore
already per-repo by accident, not by design.** Understand exactly what that
implies before you choose an approach.

**The load-bearing mechanism.** `measurement_validity(measured_sha, scope_paths)`
computes `fresh | stale | unknown` at read time by running:

```
git rev-list <measured_sha>..HEAD -- <scope_paths>
```

A measurement is STALE the moment any commit touches its scope. The verdict is
never stored. This is the entire reason the system exists: it makes it
impossible to quote a number that was true eleven commits ago.

`.foreman/session.db` is in `.gitignore` — machine-local state, not source.

---

## Design questions you must answer, not defer

### 1. One database or many?

Either one registry at `~/.foreman/projects.db` holding every project's records,
or one `session.db` per project plus a registry that only lists them.

Argue it on **failure modes**, not tidiness. Specifically:

- A per-project file means `rm -rf` on a project takes its history. Is that
  correct behaviour or data loss?
- A single global file means one corrupt page loses every project, and it is
  backed up as one unit.
- Cross-project queries ("where else did I hit this error") need either one file
  or `ATTACH`. Only one of those is a real requirement — decide which.

### 2. How is staleness computed for a project you are not standing in?

This is the hardest question and the one most likely to be got wrong.

`measurement_validity` shells out to `git rev-list` **in the current working
directory**. If recovery shows a measurement from project B while you are in
project A, that call is either wrong or meaningless.

Your options, at least:

- Run `git -C <project_path> rev-list ...` — correct, but costs a subprocess per
  measurement and fails when the path is gone.
- Return `unknown` for measurements outside the current project — honest, cheap,
  and possibly useless.
- Compute freshness only for the current project and never surface others'
  measurements at all.

**Whatever you choose, a measurement must never be shown as `fresh` on the
strength of a git query that ran in the wrong repository.** That is a
false-green, and it is the exact defect this system was built to prevent.

### 3. What identifies a project?

Candidates: absolute path, `git remote get-url origin`, repo root basename, an
explicit registered name. Consider:

- Paths move. Remotes are absent on local-only repos and shared across forks.
- The same repo can be checked out at several paths simultaneously — this
  project has **fourteen live worktrees** right now, all one git repo. Are
  worktrees one project or many?
- A monorepo may hold several projects.

Pick one, and state what breaks when your assumption is violated.

### 4. What does recovery return?

`recover` currently returns facts, measurements, and obligations for one store.
With projects, decide:

- Default scope: current project only, or all projects?
- Is there a cross-project view, and what is it for?
- Does the LAUNCH POINT line change?

**Constraint: `recover` must stay deterministic and exact SQL.** No similarity
search, no ranking, no fuzzy matching. Two resumes of the same tree must return
the same world. If recovery ever becomes approximate it is no longer canonical.

### 5. Migration

An existing `.foreman/session.db` holds real records for this repo. Your change
must not lose them. Follow the in-place probe-based pattern already in
`connect()` — `PRAGMA table_info`, not a migration ledger — and bump
`SCHEMA_VERSION`.

---

## Constraints

- **Recovery must work offline, with no server, and with no network.** It runs
  mid-lane. Do not add a service dependency.
- **Do not break the existing CLI.** `begin`, `recover`, `end`, `fact`,
  `measure`, `obligation`, `close`, `supersede`, `project` all have callers,
  including `skills/checkpoint/SKILL.md` and `tools/ci-local.sh`'s lane gate.
- `--scope` stays mandatory on `measure`. A measurement that cannot be shown
  stale defeats the mechanism.
- Liveness is still not a record kind. Ask the process.
- **Write in Simplified Technical English** (`skills/ste/SKILL.md`): imperative
  instructions, one instruction per sentence, no semicolons, active voice.

---

## Deliverables

1. A short design document at `docs/design/project-registry.md` answering the
   five questions above, each with the failure mode that drove the answer.
2. The implementation in `fm-session.py`, plus any new CLI verbs.
3. Tests in `tests/session.bats`, **registered in `tests/baseline.tsv` and
   `tests/skip-budget.tsv`** — eight packages have shipped unregistered test
   files in this repo and it is the cheapest tripwire we have.
4. `skills/checkpoint/SKILL.md` updated for the new workflow.

## Verification — the bar

Prove each of these by running it and quoting the output:

- A measurement in project A is **not** reported fresh using project B's git
  history. Construct the case deliberately and show the verdict.
- A migrated pre-existing database keeps every prior record.
- `recover` with no project registered still works — do not require registration
  to use the tool.
- A project whose directory has been deleted degrades to a stated verdict rather
  than a crash or a silent pass.

Every checker must be shown to FAIL against a known-bad input before it is
trusted. A check never observed failing is not evidence.

## One trap, recorded from the session that wrote this

The failure this whole system exists to prevent is quoting a measurement whose
tree has moved. It has been committed four times in one day **by the author of
the system**, including once by asserting the contents of a file that did not
exist.

Do not assume the current code is correct because it is recent. Verify the
inlined facts above against the source before you build on them.
