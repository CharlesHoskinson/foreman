# Tasks — three-outcome-verdicts

Ordering: T1 is the premise check. T2-T3 are serial and own `audit-run.sh`.
T4-T5 own `gate-eval.sh` and may run once T2's artifact shape is fixed. T6-T7
run in parallel after T3. T8 gates.

Coordinate the audit invocation block (`audit-run.sh:78-86`) with
`vendor-adapter-contract`, which owns the argv construction. This package owns
the timeout, the exit-status interpretation, and the verdict recording around
it. The two must not both rewrite that block.

## T1 — confirm the premises before changing anything

- [ ] Re-confirm the stale-verdict hazard: no path in `audit-run.sh` removes or
      rewrites `$RD/audit-verdict.json` before an audit starts, and
      `gate-eval.sh:43-47` performs no freshness check. Record the evidence.
- [ ] Re-confirm `gate-eval.sh` does not source `lib/config.sh` and does not
      read `[audit.policy]`.
- [ ] Grep for every consumer of the literal strings `APPROVED`, `WARNING`,
      `BLOCKED` across scripts, tests, agents and references. Produce the list
      before writing any code; the fourth value must reach all of them.
- [ ] IF any premise fails, stop and record the finding rather than adapting
      the change to it.

## T2 — the verdict artifact

- [ ] `audit-run.sh` writes `audit-verdict.json` on every path, atomically
      (tmp + rename), before returning.
- [ ] Add `UNVERIFIED` with a machine-readable `reason` for each condition:
      non-zero exit, timeout, empty output, no JSON object, out-of-vocabulary
      verdict, worktree mutation, missing CLI, unauthenticated CLI.
- [ ] Add the provenance block: vendor, model, effort, started_at, ended_at,
      duration_s — recording what actually ran, not what was configured.
- [ ] Add `evidence: {diff_sha256, base_sha, head_sha, attempt}`.
- [ ] Leave `adapters/verdict.schema.json`'s enum at three values, and add a
      comment in both the schema and `audit-run.sh` stating the asymmetry is
      deliberate and why.
- [ ] Exit status keeps its current meaning for callers.

## T3 — bound the audit call

- [ ] Add `audit.timeout_min` to the config loader, defaulting from
      `limits.round_timeout_min`.
- [ ] Bound the audit invocation; on expiry terminate the process group, not
      just the process — the orphan-reaping failure class
      (`bugeventlog.md:180-217`, ~70 minutes on one lane) is the reason.
- [ ] Timeout records `UNVERIFIED` / `reason:"timeout"` / `duration_s`.
- [ ] Set the initial default generously; an over-tight bound manufactures the
      failures this package exists to represent. Record the reasoning next to
      the value.
- [ ] Do NOT implement effort tiering, audit sharding, audit bundles,
      hunk-scoped re-audits, or session reuse. They are v0.4.0's. Add a
      pointer, not a prototype.

## T4 — gate: evidence binding

- [ ] `gate-eval.sh` recomputes the diff content hash for the task under
      evaluation.
- [ ] Compare with the verdict's `evidence.diff_sha256`; mismatch is a
      distinct gate reason naming the mismatch.
- [ ] Bind on content hash, never on `head_sha`.
- [ ] Preserve the existing fail-closed behaviour for a missing or
      schema-invalid verdict artifact.

## T5 — gate: UNVERIFIED and policy

- [ ] Accept `UNVERIFIED` as a valid verdict value at `gate-eval.sh:43`.
- [ ] Fail with a reason string distinct from the `BLOCKED` reason, carrying
      the recorded `UNVERIFIED` reason.
- [ ] Ensure an `UNVERIFIED` failure is not counted against
      `limits.max_rework_rounds`, and name where that count lives.
- [ ] Source `lib/config.sh` and read `[audit.policy]`; every read takes the
      `audit-run.sh:27-29` pattern — value with a hard-coded fallback.
- [ ] Add `audit.policy.unverified`, default `retry`, to `lib/config.sh`'s
      key tables and to both config files.
- [ ] Never collapse `UNVERIFIED` into `BLOCKED` in any output.

## T6 — findings by id

- [ ] Derive a stable finding id in the normaliser from file, line, severity
      and a conservatively normalised summary (case, whitespace, punctuation
      only).
- [ ] Retain the raw finding text alongside the id.
- [ ] `wt-consolidate.sh` merges findings by id, selects a representative, and
      names every source lane against it.
- [ ] Consolidation never rewrites, paraphrases or synthesizes evidence text —
      assert byte-identity of the representative against a source finding.
- [ ] Do not add an id field to `adapters/verdict.schema.json`.

## T7 — doctrine

- [ ] `SKILL.md:244-251` — the verdict-to-action table gains `UNVERIFIED`, and
      the section states that the auditor's verdict is a claim with provenance,
      not an oracle.
- [ ] `references/orchestration-hardening.md` — record the artifact shape, the
      evidence binding, and the harness-assigns-UNVERIFIED rule.
- [ ] `references/lanes.md` — correct any statement implying the verdict
      vocabulary is three-valued at the gate.
- [ ] `lib/config.sh:62-64` — remove the "gate-eval.sh does not read them yet"
      note once it is false. Do not leave the code and the comment
      disagreeing.

## T8 — tests and gate

- [ ] New `tests/audit-verdict.bats`.
- [ ] Each `UNVERIFIED` condition produces the right reason: non-zero exit,
      timeout, empty output, no JSON object, bad verdict value, worktree
      mutation, missing CLI.
- [ ] Stale-verdict regression: a failed re-audit must not leave a prior
      `APPROVED` readable by the gate. Prove this test goes red against the
      current code.
- [ ] Evidence binding: mismatched diff fails with the mismatch reason;
      byte-identical diff after a rebase still passes.
- [ ] `UNVERIFIED` fails the gate with a reason distinct from `BLOCKED`, and
      leaves the rework count unchanged across two consecutive occurrences.
- [ ] Malformed `.foreman/config.toml` leaves the gate's outcome unchanged.
- [ ] Consolidation merges by id and preserves evidence bytes exactly.
- [ ] Timeout leaves no surviving audit process — assert on the process table,
      not on the exit code.
- [ ] Declare preconditions via `tests/lib/preconditions.bash` and register
      skip budgets (`test-infrastructure-hardening` owns that helper).
- [ ] Full suite green on WSL/Ubuntu 26.04, on a quiet host, reading `NOT_OK`
      explicitly rather than a compound exit code.
- [ ] Full suite green on Git-Bash/Windows.
- [ ] `bugeventlog.md` entry recording the stale-verdict hazard, its evidence,
      and this enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate three-outcome-verdicts --strict`.

## T9 -- bind the other two gate inputs (formal: `post_fix` violations)

Apalache found `post_fix / no_unverified_checks_merge` and
`post_fix / no_unverified_docs_merge` VIOLATED at depth 8 (state 6) with the
verdict binding of T4 working perfectly. `post_fix_full_binding` holds through
depth 10. The verdict binding alone is necessary and insufficient.

- [ ] `checks-run.sh:41-42` already writes `{sha, command, exit_code, status}`.
      Add `diff_sha256` for the diff actually evaluated. Do not repurpose `sha`.
- [ ] Emit the same `diff_sha256` from the docs check into `docs-check.json`.
- [ ] `gate-eval.sh:40` currently reads `jq -r .status` from
      `checks-result.json` and nothing else. Read and compare `diff_sha256`.
- [ ] `gate-eval.sh:49-52` does the same for `docs-check.json`. Same fix.
- [ ] Each of the three inputs gets its own distinct mismatch reason string --
      a reader must be able to tell which artifact was stale.
- [ ] Reuse T4's hash computation; there SHALL be exactly one diff-hash
      function in the gate.
- [ ] Test: a round-N `pass` in `checks-result.json` must not authorise a
      round-N+1 diff. Prove the test goes red against current code.
- [ ] Test: the byte-identical-diff-after-rebase case still passes for all
      three artifacts, not only the verdict.

## T10 -- a separate audit-attempt bound and a terminal state

Apalache: `uncapped_errors / audit_attempts_bounded_by_three` VIOLATED at
depth 8 (state 7); `capped_errors` holds and reaches `Abandoned` at state 6,
within `2 * cap` transitions. `rework_rounds_bounded` passes *vacuously* in the
failing configuration because `round` never advances -- do not cite it.

- [ ] Add the bound as its own config key with a conservative default. Name it
      `limits.max_audit_attempts` (or `audit.max_consecutive_unverified`), and
      state in the key's comment that it MUST NOT be `max_rework_rounds`.
- [ ] Do NOT derive the default from `limits.max_rework_rounds`.
- [ ] Persist the attempt count in `$RD` so it survives an agent restart.
- [ ] Add the terminal `Abandoned` state with a reason distinct from rework
      exhaustion; the gate refuses to merge from it under every policy value.
- [ ] Test: an always-`UNVERIFIED` auditor reaches `Abandoned`, with the
      rework-round count still zero.
- [ ] Test: raising `limits.max_rework_rounds` does not change when that task
      is abandoned.

## T11 -- close the gate-to-merge TOCTOU

Apalache: `post_fix_toctou / no_unaudited_merge` VIOLATED at depth 7 (state 5).
`wt-merge.sh` commits pending worker changes *after* the gate hashed the diff.

- [ ] Re-check the diff content hash inside the merge transaction in
      `wt-merge.sh`; abort with a distinct reason on mismatch.
- [ ] Alternatively freeze the tree before the gate hashes it -- pick one
      mechanism and state which in `design.md`; do not implement both halves.
- [ ] Stop creating commits from uncommitted worker changes after the gate has
      run. A dirty worktree at gate time is committed first or refused.
- [ ] Move the merge-freshness evaluation inside the merge transaction; it has
      the same check-to-use race.
- [ ] Test: mutate the worktree between gate pass and merge; the merge must
      abort naming the content-hash change.

## T12 -- WARNING is decided by policy

Apalache: `post_fix / no_warning_authorized_merge` VIOLATED at depth 6
(state 4) -- `WARNING` reaches a merge. This is the same root cause as T5's
policy read: `[audit.policy]` is prose the gate never reads.

- [ ] The gate's verdict branch must not be "not `BLOCKED` therefore pass".
      Every verdict value takes an explicit arm.
- [ ] `WARNING` resolves `warning_low_resolved` and `warning_medium` through
      the `audit-run.sh:27-29` fallback pattern introduced by T5.
- [ ] Test: an unresolved medium `WARNING` fails the gate with a reason naming
      the finding; a resolved-low `WARNING` passes because policy said so.

T8 remains the final gate for this package, and its checklist now also covers
T9-T12's tests and a re-run of `openspec validate three-outcome-verdicts
--strict`.
