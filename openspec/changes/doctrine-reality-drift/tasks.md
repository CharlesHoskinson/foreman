# Tasks — doctrine-reality-drift

Ordering: T1-T2 are serial and build the mechanism. T3 seeds the registry and
depends on T2. T4 is coordination with the owning packages and runs alongside
T3. T5-T6 are the adjacent checks. T7 gates.

This package builds the checker and registers the claims. It does **not** fix
most of the claims — each is owned by the package that owns the code it
describes. See `proposal.md` Impact for the routing.

## T1 — the registry format

- [ ] Create `docs/doctrine-claims.tsv` with the columns `claim_id`,
      `doc_ref`, `claim_text`, `probe`, `expected`,
      `observed_at_registration`, `owner`.
- [ ] Document the format and, in the same place, its scope limit: pinned
      facts, not prose.
- [ ] State the rule that a probe may not invoke a model, hit the network, or
      run a build — and why (determinism, cost, trust in the gate).
- [ ] State the rule that a claim needing a complicated probe is a signal the
      claim is really several claims.

## T2 — the checker

- [ ] Create `skills/foreman/scripts/doctrine-check.sh`; shell, `jq`, `git`
      and the existing `toml_get` only.
- [ ] Fail on any probe whose result differs from `expected`, with a message
      naming claim id, doc ref, expected and observed.
- [ ] Fail distinctly on an empty probe result, comparing against
      `observed_at_registration` so a moved target is diagnosable as a stale
      probe rather than a false claim.
- [ ] Report registered-claim counts and pass/fail state. Emit no percentage
      and nothing that reads as coverage.
- [ ] Runs offline, completes without a build.
- [ ] shdoc headers on every function; shellcheck clean.

## T3 — seed the registry from the known contradictions

- [ ] Register all eleven contradictions tabulated in
      `docs/research/vnext/R5-internal-attachment-map.md` §8.2, each with its
      owning package.
- [ ] Register the concurrency caps claim specifically — it is the one
      confirmed to have misled a reader.
- [ ] For each, record whether it is resolved by this release or registered as
      knowingly false with the closing package named.
- [ ] A knowingly-false claim fails the check unless the document has been
      corrected to state the reality.

## T4 — coordinate the fixes, do not perform them

- [ ] Confirm `round-ownership-default` closes the durable-default and
      inert-flag claims; register against its outcome.
- [ ] Confirm `three-outcome-verdicts` closes the `[audit.policy]` claim.
- [ ] Confirm `vendor-adapter-contract` closes the `claude` worker lane and
      `audit.vendor` auto-selection claims.
- [ ] Confirm `lock-primitive-hardening` closes the mkdir-atomicity comment.
- [ ] Confirm `wsl-ci-parity` and `test-infrastructure-hardening` close the CI
      claims, including the `pwsh` versus `powershell.exe` 5.1 mismatch.
- [ ] Correct `ROADMAP.md:44-47`'s caps statement — no other package owns it.
- [ ] Register whichever resolution `lock-primitive-hardening` T8 reaches on
      the OpenSpec conformance claim. Do not decide it here.

## T5 — stale change folders

- [ ] Probe for change packages with zero completed tasks whose work the
      roadmap records as shipped.
- [ ] Report the three known cases (`hard-mode-launcher`,
      `el-emit-spawn-reduction`, `test-harness-fork-tax`).
- [ ] Resolve each by archiving the package, correcting the roadmap, or
      correcting the task list. Do not leave any standing.

## T6 — workaround stamps

- [ ] Probe for workaround comments carrying no model or tool identity and no
      date.
- [ ] Probe for stamps older than one release with no recorded re-test.
- [ ] Report counts only in this release; set no failure threshold before the
      count is measured.
- [ ] Record the rationale — frontier behaviour drifts under a fixed alias, so
      an unstamped workaround cannot be re-evaluated by anyone.

## T7 — tests and gate

- [ ] New `tests/doctrine-check.bats`.
- [ ] For each probe class, mutate the fixture and assert the probe goes red.
- [ ] Assert an empty probe result fails with the stale-probe reason, distinct
      from a value mismatch.
- [ ] Assert an always-green probe is reported as unprotected and is not
      counted as passing.
- [ ] Assert the checker's output contains no percentage.
- [ ] Wire the checker into `docs-check.sh`, recording its result in the same
      structure as the existing checks; assert the docs gate fails when a
      registered claim is false.
- [ ] Declare preconditions via `tests/lib/preconditions.bash` and register
      skip budgets (`test-infrastructure-hardening` owns that helper).
- [ ] Run the checker against the repository as it stands today and confirm it
      fails on the seeded contradictions that have not yet been closed — a
      checker that passes on a repo with eleven known contradictions is
      broken.
- [ ] Full suite green on WSL/Ubuntu 26.04, quiet host, `NOT_OK` read
      explicitly.
- [ ] Full suite green on Git-Bash/Windows.
- [ ] `bugeventlog.md` entry recording the doctrine-drift failure class, the
      caps mismatch as its live example, and this enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`, and the new
      doctrine check itself.
- [ ] `openspec validate doctrine-reality-drift --strict`.
