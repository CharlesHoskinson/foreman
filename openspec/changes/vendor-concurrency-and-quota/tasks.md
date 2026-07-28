# Tasks — vendor-concurrency-and-quota

Ordering: T1 is a one-line topology change and lands first. T2-T3 are the
harness and can run in parallel. T4 depends on `agy-lane-activation`'s
credential decision. T5 gates.

Depends on `vendor-adapter-contract` (`adapter_caps` publishes `cap_n` and
`rc_unavailable`) and coordinates with `agy-lane-activation` (which owns the
lane wiring and the credential-seeding decision).

## T1 — topology and cap governance

- [ ] Add `agy:1` to the group topology at `lane-queue.sh:422`.
- [ ] Add the inline citation for the agy cap: no GREEN row exists,
      default-on-doubt is 1, per `:375-383` and `:415-421`.
- [ ] Leave the grok, codex and claude caps and citations untouched.
- [ ] IF `vendor-adapter-contract` T7 removes the claude lane, remove the
      `claude:3` group in that change, not this one — the topology must never
      advertise a lane that cannot run, and ownership of that removal stays
      with the package that makes the decision.
- [ ] State in the header that a cap raise requires a GREEN row at that N and
      may not be justified by analogy with another vendor.

## T2 — extend the concurrency harness

- [ ] Add an agy case to `vendor-concurrency-test.sh` mapping the vendor to
      `$HOME`, taking the lever from `adapter_home_var` rather than hard-coding
      it.
- [ ] Record in the script that `GEMINI_CLI_HOME` was probed against this CLI
      and has no effect, so a future reader does not re-add it.
- [ ] Post-run auth re-probe using `agy models`, the same non-billing command
      the readiness inventory uses.
- [ ] Add a shared-mutable-state monitor for vendors whose lanes cannot be
      fully isolated: watch the conversation database and its `-wal`/`-shm`
      companions, the settings file, and the credential.
- [ ] Keep the harness out of the automatic bats suite and out of CI, per the
      existing protocol; extend the shim tests for the new case only.

## T3 — entitlement and quota reporting

- [ ] Extend the readiness inventory to report, per vendor, the model set the
      credential can enumerate, and the plan or tier where the CLI exposes it.
- [ ] Report NOT-READY for a configuration whose pinned model is not in the
      enumerable set, naming both the pinned model and the available set.
- [ ] Report explicitly when an auditor lane's configured reasoning level
      cannot be served by the active credential.
- [ ] Classify quota exhaustion through the adapter's `rc_unavailable`
      contract; a quota-exhausted round must not consume a rework round.
- [ ] Record the model actually used in every round report and surface any
      difference from the pinned model.

## T4 — the destructive run (recorded evidence, or a recorded negative)

- [ ] Once `agy-lane-activation` has settled credential seeding, attempt
      `vendor-concurrency-test.sh agy 2`, then `3`, under the existing manual
      contained protocol.
- [ ] Record the outcome in `docs/research/vendor-concurrency-results.md`
      including the CLI version it was taken against.
- [ ] IF lanes cannot be isolated and authenticated at the same time, record
      that as a permanent constraint and leave the cap at 1 citing it. This is
      an acceptable outcome; an unjustified cap raise is not.
- [ ] Establish and record agy's headless behaviour at quota exhaustion —
      clean exit, block, or silent downgrade — before any cap raise.
- [ ] Measure the provisioning cost of a per-lane home, including the browser
      runtime cache each one lays down, before raising the cap above 1.

## T5 — docs, tests, gate

- [ ] `config/foreman.toml.example` documents the per-vendor cap key and states
      that it is governed by the recorded-row rule.
- [ ] `skills/foreman/references/lanes.md` updated for the four-group topology.
- [ ] Tests: topology contains one group per advertised lane; a cap raise
      without a citation fails a check; quota-exhausted rounds do not decrement
      the rework budget; a model mismatch is surfaced.
- [ ] Full suite green on WSL/Ubuntu 26.04.
- [ ] `shellcheck` clean on `lane-queue.sh` and `vendor-concurrency-test.sh`.
- [ ] `bugeventlog.md` entry if any finding from T4 is negative, recording the
      evidence and the constraint.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate vendor-concurrency-and-quota --strict` passes.
