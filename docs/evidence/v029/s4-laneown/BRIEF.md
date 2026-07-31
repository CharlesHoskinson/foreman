# SPEC — lane-ownership-and-reaping, round 1

**MANDATORY FIRST ACTION:** create `REPORT.md` with a heading per deliverable,
each PENDING, then fill in place as you go. Do not batch — lanes here have died
mid-write having written nothing.

**SECOND:** read `AGENT_TRAPS.md` IN FULL, all of it.

No `git commit`. No graphify. `/usr/local/bin/openspec`, never `npx`. Gate every
`bats` run through `flock /tmp/foreman-bats.lock`.

## This package is already partly built and in daily use

`tools/lanectl.sh` and `tools/reap-stale-lanes.sh` exist on `main` and have been
used all day to supervise real lanes. **Read them first** — copies are at this
worktree root. Your job is to finish the package around them, not to reinvent
them, and to wire the harness to use them.

## Why it exists — nine strandings in one session

Read `docs/incidents/2026-07-29-lane-strandings.md` in full. The three defects:

1. **Existence is treated as liveness.** A grok round sat at `STAT=Tl` with
   `TIME=00:00:00` for eleven minutes — suspended by `SIGTTIN` after the CLI
   self-updated. The watchdog armed against exactly that polled `pgrep`, which
   matches a stopped process, and would have waited its full budget calling the
   lane alive.
2. **Lanes carry no ownership.** A `lane-watchdog5.sh` ran 40+ minutes and could
   only be attributed by reading `/proc/<pid>/cwd` and grepping for a harness
   path. It belonged to a different session, so the safe action was to leave a
   wedged process running.
3. **A never-launched lane is indistinguishable from a working one.** An audit
   lane sat 21 minutes having never started its vendor CLI: no error, no
   artifact, no process.

## Scope — T1 through T3

- **T1** — finish the ownership primitives. Ownership is recorded three ways
  deliberately: `FM_LANE_OWNER`/`FM_LANE_LABEL` in the environment, a per-owner
  PID registry, and a directory marker. **The third exists because the first two
  both fail against a self-replacing process** — grok re-execs, so the env is
  lost and the registered PID goes stale. Verify that claim yourself and keep
  all three.
- **T2** — replace every `pgrep`-existence liveness check in `watch.sh` and
  `lane-supervise.sh` with state-and-CPU judgement. `STAT` beginning `T` is
  SUSPENDED; zero CPU after grace is WEDGED. Restrict candidates to processes
  with a `timeout` ancestor so interactive sessions are structurally excluded.
  **Record inline that a CPU-delta hang check was tried and REMOVED** after
  false-positiving on every run — once against a live interactive session, once
  against a healthy lane blocked on a model response. Do not reintroduce it.
- **T3** — the stall taxonomy: `SUSPENDED`, `NEVER_LAUNCHED`, `NO_OUTPUT`,
  `WEDGED`, each named by the evidence that produced it. `NO_OUTPUT` is decided
  by content hash, **never** by `git status --porcelain`, which collapses an
  untracked directory to one line. `lib/evidence.sh` now exists for this.

## Verification — every case observed failing

1. `SIGSTOP` a stub lane → reported SUSPENDED, NOT alive.
2. **The pgrep regression:** assert an existence-only predicate would have called
   that same stopped process alive. This is the defect under test.
3. `NEVER_LAUNCHED` reachable with a lane whose vendor never starts.
4. Foreign safety: a process owned by another owner is listed and NOT signalled —
   assert it is still alive afterwards.
5. Subtree adoption: adopt a wrapper+child pair by the wrapper pid; both attributed.
6. The healthy-lane negatives: a lane blocked on a model response, and an idle
   interactive session, are both left alone.
7. Your harness exits non-zero when any case fails. Prove it.
8. `shellcheck` clean.

Per **D7** anything gating lands in shadow mode first. Report what you deferred.
