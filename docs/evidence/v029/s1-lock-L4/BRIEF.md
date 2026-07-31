# SPEC — lock-primitive-hardening, Round L4: the regression suite and the gate

Read `AGENT_TRAPS.md` IN FULL first.

You are the highest-judgment lane on this project. This round is being given to
you rather than to a routine implementer because it is the round where the
whole package's credibility rests, and because a weaker lane has already
produced, on this same package, an evidence harness that **printed its failures
and exited 0**.

## Why this round is different

`tests/lock.bats` does not exist. Everything proving the lock work so far lives
in scratch harnesses written by the same lanes that wrote the code. That is
circular: the tests know what the implementation does, so they test what it
does rather than what it must do.

**Write these tests from the SPEC, not from the implementation.** Read
`openspec/changes/lock-primitive-hardening/specs/locking/spec.md` and derive
the tests from its requirements and scenarios. Consult `lib/lock.sh` only to
learn the API surface — never to learn what the expected behaviour is. If a
test you derived from the spec fails against the implementation, that is a
**finding**, not a test bug, and you must report it as such rather than
adjusting the test to match the code.

## Scope — tasks T6, T7 and T13

Create `tests/lock.bats`. Do NOT modify `lib/lock.sh`, `lib/eventlog.sh`,
`lib/nats-bridge.sh`, `wt-new.sh` or anything under `env/` — other rounds own
those. If a spec requirement cannot be satisfied by the current
implementation, report it; do not fix it here.

Do NOT `git commit`. No graphify. `/usr/local/bin/openspec`, never `npx`.

## T6 — the regression suite

- **Mutual-exclusion-by-occupancy**, N ≥ 8 acquirers, losers spin and retry,
  asserting strict ENTER/EXIT alternation. Occupancy, not timing.
- **The occupancy test SHALL FAIL against a deliberately non-atomic
  primitive.** This is the single most important line in the round. Prove the
  test detects the defect by running it against a check-then-act `mkdir`
  shim — a test that has never been observed catching the bug it exists for is
  not evidence. The measured signal it must reproduce: uutils `mkdir` gave
  **57 mutual-exclusion violations over 15 rounds of 8 racers**; GNU and
  `flock` gave 0.
- **Exercise the `mkdir` fallback explicitly by forcing the mechanism.** Do not
  rely on finding a host without `flock` — this host has it.
- Fix `tests/eventlog.bats` "append failure leaves a gap": it cannot fail as
  root. Either skip when `EUID == 0` **with a stated reason**, or induce a
  failure root cannot bypass. A silent pass under root is exactly the vacuity
  this release exists to remove.
- Retain "el_attempt_new under concurrent contention" as a **symptom** test,
  and label it as such. It is load-dependent: it fails while lanes saturate the
  box and passes on an idle machine. The mechanism test is
  `tests/probes/mkdir-atomicity.sh`.
- Confirm test 43 ("concurrent emitters produce unique monotonic seqs") stops
  being load-sensitive now the primitive is fixed. **If it does not, that is a
  separate finding and must be logged, not papered over.**

## T7 — the gate

- Full suite green on WSL/Ubuntu 26.04.
- **The Git-Bash half is AMENDED — see decision D5.** No Foreman-controlled
  MSYS2/Git-Bash host exists to capture a syscall trace, and seeding a
  plausible digest was refused rather than fabricated. What D5 still requires,
  and what you must deliver:
  - the fallback **code path** proven reachable against a structurally valid
    entry in a **temporary** manifest — the `mkdir` fallback is selected,
    creates exactly one lock directory, and releases it exactly once including
    on the error exit path. **Do not write into the real register.**
  - the **refusal path** on an unpinned host exercised: the helper refuses with
    `FM_LOCK_PROBE_UNTRUSTED`, names the host class and consequence, and names
    the pinning procedure as the route back.
- The three previously-failing event-log tests (43, 50, 54) pass **for the
  right reason** — verified by reading the fix, not by observing a green tick.
- `shellcheck` clean on everything you touch.
- Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.

## T13 — operational

No lane may `pkill -f` by pattern. `pkill -f "quint verify"` once matched its
own command line, killed its shell, and would have killed a sibling lane
sharing an Apalache server. Kill by recorded PID or process group. Assert this
with a static check over the scripts if you can express one.

## Non-negotiables on the suite itself

1. **It must exit non-zero when any case fails.** Prove it. A harness on this
   package already shipped printing failures while exiting 0.
2. **Every assertion observed failing** against a known-bad input, naming the
   offending case, before you trust it.
3. **No test may mutate the repository.** Use `BATS_TEST_TMPDIR`, temporary
   indexes, or disposable clones. Install cleanup as a trap, and **compose or
   restore** rather than replace — an earlier round's cleanup trap overwrote
   Bats' own failure-reporting trap and suppressed the output that would have
   shown the failure. Prove `git status --porcelain -uall` is byte-identical
   before and after, including across an induced mid-run failure.
4. **Gate every `bats` invocation** through the host-wide mutex
   (`flock /tmp/foreman-bats.lock`). Concurrent bats runs make load-sensitive
   tests fail spuriously, and other lanes are running right now.

## What I want from your judgment specifically

Beyond the checklist: read the spec's eleven requirements and tell me which are
**not** covered by any test you wrote, and which are covered only vacuously.
That list is more valuable to me than a green suite. If the implementation and
the spec disagree anywhere, say so plainly — three audit rounds have already
found defects in this package that its own authors' harnesses passed.

Write `REPORT.md`: the suite's structure, the red-first evidence for every
assertion class, the non-atomic-primitive proof, the coverage gaps you found,
and anything you could not satisfy. A stated blocker is a good outcome.
