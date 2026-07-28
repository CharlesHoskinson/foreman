# Tasks — round-ownership-default

Ordering: T1 is the prerequisite read. T2-T3 are serial and own the
enforcement. T4-T6 may run in parallel once T3 lands. T7 gates.

**Do not start T3 before `lock-primitive-hardening` has merged.** See
`design.md` — universal durable dispatch multiplies contention on a mutex
measured non-atomic on the reference host.

## T1 — confirm the premises before changing anything

- [ ] Re-confirm that `DURABLE_ENABLED` has no consumer: exactly two
      occurrences, both in `lib/config.sh` (`:66`, `:148`). Record the command
      and its output.
- [ ] Re-confirm `lane-run.sh --round`'s completion predicate at `:1143-1245`
      — gate pass AND attempt-fresh report, `round_done` suppressed otherwise.
- [ ] Confirm `cfg_get` resolves a boolean key through env > TOML > default
      the same way it resolves the integer `[durable]` keys.
- [ ] IF any premise fails, stop and record the finding; do not adapt the
      change to a premise that turned out false.

## T2 — resolve the flag

- [ ] Add `durable.enabled` to the loader's default table with default `true`.
- [ ] Set `enabled = true` in `config/foreman.toml.example` with a comment
      naming what it enforces.
- [ ] Set `enabled = true` in this repo's `.foreman/config.toml`.
- [ ] Set `resume_max_attempts` explicitly in both config files (uncomment,
      conservative value) — bounded auto-resume becomes reachable.
- [ ] Correct the "Used by" column for `durable.enabled` in
      `references/durable-lanes.md:71`.

## T3 — enforce at the dispatch boundary

- [ ] In `lane-run.sh`, resolve `durable.enabled` before any spawn.
- [ ] Refuse an unowned invocation while it is true: named reason, non-zero
      exit, no child spawned, no vendor CLI billed.
- [ ] Refuse round mode with an empty or whitespace-only gate command; add no
      default gate under any circumstance.
- [ ] Implement the escape hatch: an explicit unowned-dispatch flag carrying a
      required reason string, which emits an `alert` recording that reason.
- [ ] Never downgrade an owned dispatch to unowned — a missing launcher, queue
      daemon, or gate is a degrade or a refusal, never a disown.
- [ ] shdoc header on any new function; shellcheck clean.

## T4 — Setup migration

- [ ] `foreman-setup.sh` detects an explicit `durable.enabled = false` and
      reports the divergence, naming the background-and-stop failure class.
- [ ] Setup writes nothing to the user's `.foreman/config.toml`. Assert this
      by byte-comparing the file before and after.
- [ ] Report the launcher's presence in the same breath, since a round-owned
      default on a launcher-less host is a degraded default.

## T5 — doctrine

- [ ] `SKILL.md` — round-owned dispatch is the described default path; the
      unowned form is documented as the explicit, reason-carrying opt-out.
- [ ] `SKILL.md` — keep the foreground-only instruction as defence in depth,
      and state plainly that no design depends on it holding.
- [ ] `references/orchestration-hardening.md` — record the escape hatch, its
      reason requirement, and the stateful/live-target case it exists for.
- [ ] `references/durable-lanes.md` — the honest-limits section states what
      changes for an existing user on upgrade.
- [ ] Recommend `checks-run.sh TASK_ID` as the migration gate command in docs
      only. It is never a code default.

## T6 — tests

- [ ] New `tests/round-ownership.bats`.
- [ ] Refusal fires: unowned dispatch while enabled → non-zero, named reason,
      zero child processes spawned.
- [ ] Refusal does not fire: owned dispatch while enabled → proceeds
      unchanged.
- [ ] Opt-out honoured: `durable.enabled=false` → unowned dispatch runs as
      before.
- [ ] `DURABLE_ENABLED` env override reaches the enforcement point.
- [ ] Empty gate command is refused; no `round_done` is written.
- [ ] Escape hatch emits an `alert` carrying the stated reason verbatim.
- [ ] Consumer test: fails IF no code path reads `durable.enabled`.
- [ ] Prove the refusal test detects the defect — run it against the
      enforcement removed, and confirm it goes red. A test that cannot fail is
      not a test.
- [ ] Declare preconditions via `tests/lib/preconditions.bash` and register
      skip budgets, per `test-infrastructure-hardening`. Do not re-implement
      that helper here.

## T7 — gate

- [ ] Full suite green on WSL/Ubuntu 26.04, run on a quiet host with no other
      bats suite and no heavy lane active — the quiet-host precondition from
      `bugeventlog.md:707-729`, not merely the gate mutex.
- [ ] Read `NOT_OK` / `SUITE_RC` explicitly; never conclude from a compound
      command's exit code.
- [ ] Full suite green on Git-Bash/Windows.
- [ ] Run one real round end to end with the new default and confirm from the
      event log — not from the console — that `round_done` was emitted with a
      passing gate and an attempt-fresh report.
- [ ] Run one deliberately unowned dispatch and confirm the refusal fires
      before any vendor process starts.
- [ ] `bugeventlog.md` entry recording this failure class, its 11+ occurrence
      count, and this structural enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate round-ownership-default --strict`.

## T8 -- carry round ownership across auto-resume

The structural fix in T3 holds only until the first auto-resume. Apalache
0.56.1 on `formal/specs/lane_lifecycle.qnt`, depth 12:
`init_postfix` / `step_postfix` leaves
`witness_shipped_resume_loses_round_ownership` **not reachable**, while
`init_postfix` / `step_shipped_resume_bug` makes it **REACHABLE**. The single
differing action, `successfulResumePlain`, models `lane-supervise.sh`'s
re-dispatch -- and the shipped code at `:343-345` does exactly that.

- [ ] Record `gate_cmd` and `report_path` in the `prompt` event payload at
      dispatch. Additive payload only -- `el_emit` treats `type` opaquely, so
      no `lib/eventlog.sh` change. Coordinate the payload shape with
      `decision-lineage-and-telemetry`, which makes the same additive move.
- [ ] Record the dispatch mode explicitly, including for an escape-hatch plain
      dispatch. Absence of the fields means "unknown", never "plain".
- [ ] `lane-supervise.sh` reads those fields and re-dispatches with `--round
      GATE_CMD REPORT_PATH`, using the recorded values verbatim.
- [ ] Replace the warn-and-proceed branch at `lane-supervise.sh:343-345` with a
      refusal: no `ls_reenqueue` with a bare cmd when the prior round was
      round-owned. Emit an `alert` naming the missing parameters.
- [ ] Never substitute a default gate command in the supervisor -- the same
      prohibition T3 places on `lane-run.sh` applies here.
- [ ] Count a refusal against `durable.resume_max_attempts` so refusals cannot
      loop.
- [ ] Update the header notes at `lane-supervise.sh:79-83`, which currently
      state that no event payload records `--round GATE_CMD REPORT_PATH` mode.
      Do not leave the code and the comment disagreeing.

## T9 -- tests for resume ownership

- [ ] `tests/round-ownership.bats`: a stalled round-owned round is resumed in
      `--round` mode with the recorded GATE_CMD and REPORT_PATH.
- [ ] Prove the test detects the defect: run it against the shipped
      warn-and-proceed branch and confirm it goes red. A test that cannot fail
      is not a test.
- [ ] A `prompt` event with no ownership fields is treated as unknown; the
      supervisor refuses and emits the `alert` -- it does not fall back to
      plain.
- [ ] Repeated refusals are bounded by `durable.resume_max_attempts`.
- [ ] End-to-end: dispatch a round-owned round, kill it mid-round, let the
      supervisor resume it, and confirm **from the event log** that the
      resumed attempt's `prompt` event carries the ownership fields and that
      `round_done` still required a passing gate and an attempt-fresh report.

T7 remains the final gate for this package, and its checklist now also covers
T8-T9's tests and a re-run of `openspec validate round-ownership-default
--strict`.
