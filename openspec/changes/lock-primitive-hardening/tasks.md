# Tasks — lock-primitive-hardening

Ordering note: T1-T3 are serial (they own `lib/lock.sh` and then migrate
callers onto it). T4-T6 may run in parallel once T2 lands. T7 is the gate.

## T1 — the shared lock helper

- [ ] Create `skills/foreman/scripts/lib/lock.sh` with the public contract
      (`fm_lock_acquire` / `fm_lock_release` / `fm_with_lock`), shdoc headers
      on every function.
- [ ] Mechanism selection resolved once per process and cached: `flock` when
      `command -v flock` succeeds, `mkdir` fallback otherwise.
- [ ] Expose the selected mechanism to callers (needed by `el_init`'s
      conditional stale-lock reclamation).
- [ ] Preserve the single-unconditional-release discipline on every exit path.
- [ ] Timeout behaviour matches the current spin-loops (bounded, then a named
      error and non-zero exit) — no silent infinite wait.

## T2 — migrate the durable core

- [ ] Replace the inline spin-loop at `lib/eventlog.sh:76` (`.seq.lock`).
- [ ] Replace the inline spin-loop at `lib/eventlog.sh:221` (`.attempt.lock`).
- [ ] Replace the inline spin-loop at `lib/eventlog.sh:351` (`el_compact`,
      reuses `.seq.lock`).
- [ ] Migrate the sibling mutex in `lib/nats-bridge.sh`.
- [ ] Make `el_init`'s stale-lock reclamation (`eventlog.sh:52-57`)
      conditional on the fallback mechanism; do not delete it.
- [ ] Keep `.seq.lock` and `.attempt.lock` separate — the rationale at
      `eventlog.sh:195-205` still holds.
- [ ] `el_emit`'s 5-positional signature and critical-section shape unchanged.

## T3 — correct the false doctrine in comments and docs

- [ ] `lib/eventlog.sh:70` — the "mkdir is atomic on Git Bash and WSL" comment
      is the root cause of this defect surviving; replace it with the real
      contract and a pointer to this change.
- [ ] `lib/eventlog.sh:195-205` — same claim repeated.
- [ ] `wt-new.sh:186` — same claim repeated.
- [ ] `skills/foreman/references/durable-lanes.md` — update the locking
      section.

## T4 — atomicity probe in the host inventory

- [ ] Add a deterministic `mkdir` atomicity probe to `env/tool-check.sh`
      (assert `mkdir(2)` + `EEXIST`, not a contention sample).
- [ ] Report the coreutils flavour of `mkdir` as an inventory row.
- [ ] INFO when non-atomic but `flock` present; NOT-READY when non-atomic and
      `flock` absent.
- [ ] Mirror the probe in `env/tool-check.ps1` for the Windows host.
- [ ] Degrade honestly where `strace` is unavailable — report weaker evidence
      as weaker, never claim an unearned verdict.

## T5 — reference manifest

- [ ] Record the coreutils-flavour hazard in `env/reference-manifest.toml`
      with the measured evidence and the date.
- [ ] Promote `flock` to `required = true` for the `durable` profile.
- [ ] Note that Ubuntu 26.04 ships a hybrid GNU/uutils coreutils, and which
      utilities resolve to which.

## T6 — tests

- [ ] New `tests/lock.bats`: mutual-exclusion-by-occupancy test, N >= 8
      acquirers, losers spin and retry, assert strict ENTER/EXIT alternation.
- [ ] The occupancy test SHALL fail on a deliberately non-atomic primitive —
      prove the test detects the defect by running it against the uutils
      `mkdir` path directly.
- [ ] Exercise the `mkdir` fallback explicitly by forcing the mechanism; do
      not rely on finding a host without `flock`.
- [ ] Fix `tests/eventlog.bats` "append failure leaves a gap": skip when
      `EUID == 0` with a stated reason, or induce a failure root cannot
      bypass.
- [ ] Retain "el_attempt_new under concurrent contention" as a symptom test.
- [ ] Confirm test 43 ("concurrent emitters produce unique monotonic seqs")
      stops being load-sensitive once the primitive is fixed; if it does not,
      that is a separate finding and must be logged, not papered over.

## T7 — gate

- [ ] Full suite green on WSL/Ubuntu 26.04 (the host that exposed this).
- [ ] Full suite green on Git-Bash/Windows, exercising the fallback path.
- [ ] The three previously-failing event-log tests (43, 50, 54) pass for the
      right reason — verified by reading the fix, not just the green tick.
- [ ] `bugeventlog.md` entry appended recording this failure class, its
      evidence, root cause, impact, and the enhancement — per the repo's own
      append-only log discipline.
- [ ] `shellcheck` clean on `lib/lock.sh` and every migrated caller.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.

## T8 — OpenSpec conformance debt (discovered while authoring this package)

`openspec/README.md` states the repo follows OpenSpec folder conventions.
It does not: **all sixteen existing change packages fail `openspec validate`**
(nine live, seven archived), because they use `## ADDED Requirement: <title>`
where the CLI parses `## ADDED Requirements` → `### Requirement: <title>` →
`#### Scenario:`. This package is the first in the repo to validate, strict.

- [ ] Decide, as an architect decision: migrate to the parseable shape, or
      amend `openspec/README.md` to state the repo uses a documented variant
      and the CLI is not a gate. Do not leave the claim and the reality
      disagreeing.
- [ ] IF migrating: convert the nine live packages (the six v0.2.9 WSL
      packages, `hard-mode-launcher`, `v030-soft-mode-report`, and the two
      stale merged ones) — a mechanical header transform, no content change.
- [ ] IF migrating: add `openspec validate --strict` for every live change to
      the docs gate, so the next package cannot regress.
- [ ] Leave `openspec/changes/archive/**` alone either way; archived specs are
      historical records, not live contracts.

## T9 -- remove the fail-open path (the fix does not otherwise reach it)

Apalache 0.56.1, `formal/specs/eventlog_concurrency.qnt`: module
`index_fail_open_atomic`, step `index_step`. `mutual_exclusion` VIOLATED at 8
steps (7.7 s) and `no_lost_index_entry` VIOLATED at 12 steps (61.9 s) --
**with an atomic test-and-set primitive**. T1-T2's primitive swap does not fix
this call site, because the defect is the timeout policy.

- [ ] `wt-new.sh:203` -- delete the "proceeding unsynchronized" branch. A
      timed-out acquisition exits non-zero with a named error.
- [ ] Audit every other call site for the same pattern; the helper's timeout
      contract from T1 must have no fail-open caller anywhere.
- [ ] The refusal leaves `index.json` byte-identical -- assert this, because
      the per-PID tmp name converts a torn write into a *silent lost update*.
- [ ] Make the index-lock timeout configurable; a caller that needs longer
      raises the timeout, never bypasses the lock.
- [ ] Test: `tests/lock.bats` gains a fail-open regression -- two contending
      `wt-new.sh` invocations, one forced to time out, and no index entry lost.
- [ ] Test: a static check (grep or shellcheck-adjacent) fails the suite if a
      timeout branch ever continues into a critical section again.

## T10 -- the compaction race

`locking / no_lost_structural_event` violated under `toctou` (simulation,
5,000 x 25). `el_compact` can overwrite `events.jsonl` with a snapshot taken
before a concurrent `el_emit` append -- the documented source of truth silently
loses a committed event. M2 states explicitly that a **unique compaction tmp
name does not fix this**, which rules out the obvious patch.

- [ ] Make compaction's snapshot and write-back a single serialized section
      with respect to appends, under the T1 helper.
- [ ] IF the log cannot be shown unchanged between snapshot and write-back,
      abandon the compaction and leave `events.jsonl` alone.
- [ ] Do not "fix" this by renaming the temporary file. Record in `design.md`
      why that is insufficient, so the next reader does not retry it.
- [ ] Test: append during compaction; assert the appended event survives, and
      prove the test goes red against an implementation that only renames the
      tmp file.

## T11 -- NATS lock reclamation and owner token

`nats_toctou / nats_owner_token_sound` VIOLATED at 10 steps (10.7 s);
`nats_toctou / no_deadlock` VIOLATED at 8 steps (21.4 s);
`nats_atomic / nats_lock_recoverable` violated on a pre-owner crash
(simulation, 5,000 x 12). Verified in code: `el_init` reclaims `.seq.lock`
(`eventlog.sh:52`) and `.attempt.lock` (`:57`) and **not**
`.nats-bridge.lock` -- a crash wedges it with no reclamation path.

- [ ] Add `.nats-bridge.lock` to `el_init`'s stale-lock reclamation, under the
      same fallback-mechanism condition T2 introduces.
- [ ] Under check-then-act both racers "acquire" and both write `$lock/owner`,
      so the loser's token lands on disk: the true holder can no longer
      release and the non-holder can. Write the owner token only from the
      process that actually won the acquisition.
- [ ] Record a reclamation event naming the lock; never reclaim silently.
- [ ] Test: kill a token holder, run `el_init`, assert the next acquisition
      succeeds; and assert a losing racer cannot release.

## T12 -- record the lock-ordering discipline while it is still clean

M2's verdict on today's code: **clean**. `el_emit` takes only `.seq.lock`,
`el_attempt_new` only `.attempt.lock`, `el_compact` reuses `.seq.lock` and
calls only read-only `el_read` inside it, and `lane-run.sh` calls them
sequentially, never nested. A deliberately-nesting configuration
(`nested_atomic / no_deadlock`) deadlocks at 5 steps (54.0 s).

- [ ] State the ordering in `lib/lock.sh`'s header: no nesting; if both locks
      are ever required, `.seq.lock` first, `.attempt.lock` second, release in
      reverse.
- [ ] Repeat it in `references/durable-lanes.md`'s locking section (T3 already
      touches that file).
- [ ] Do not add nesting support to the helper. The discipline is "flat", and
      the ordering rule exists only for a future that must justify itself.

## T13 -- operational note carried from the formal work

- [ ] Lanes SHALL NOT `pkill -f` by pattern. M2 reports `pkill -f "quint
      verify"` matched its own command line, killed its shell, and would have
      killed a sibling lane sharing the same Apalache server. Kill by recorded
      PID or process group, per the same discipline
      `three-outcome-verdicts` T3 applies to the audit timeout.

T7 remains the final gate for this package, and its checklist now also covers
T9-T13's tests and a re-run of `openspec validate lock-primitive-hardening
--strict`.
