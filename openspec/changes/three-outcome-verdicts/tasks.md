# Tasks — three-outcome-verdicts

Ordering: T1 is the premise check. T2-T3 are serial and own `audit-run.sh`.
T4-T5 own `gate-eval.sh` and may run once T2's artifact shape is fixed. T6-T7
run in parallel after T3. T8 gates.

Coordinate the audit invocation block (`audit-run.sh:379-387`) with
`vendor-adapter-contract`, which owns the argv construction. This package owns
the timeout, the exit-status interpretation, and the verdict recording around
it. The two must not both rewrite that block.

## T1 — confirm the premises before changing anything

- [ ] Re-confirm the stale-verdict hazard **behaviourally** (D12 — do not rely
      on line numbers; `gate-eval.sh` was modified by
      `decision-lineage-emission` and its line numbering has shifted): no path
      in `audit-run.sh` removes or rewrites `$RD/audit-verdict.json` before an
      audit starts, and `gate-eval.sh` performs no freshness check on that
      artifact. Verify with:
      `grep -nE 'audit-verdict\.json' skills/foreman/scripts/audit-run.sh skills/foreman/scripts/gate-eval.sh`
      and record the output as the evidence.
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
- [ ] Add `evidence: {diff_sha256, tree_sha256, base_sha, head_sha, attempt}`
      and a top-level `state` of `in_progress` or `complete`. `base_sha` and
      `head_sha` are lineage fields, not predicates.
- [ ] Compute `tree_sha256` with one canonical function shared with the gate,
      `checks-run.sh`, the docs check and `evidence-contracts`' `lib/evidence.sh`:
      git tree object id of `HEAD` combined with a sorted canonical content
      digest over every path `git status --porcelain=v1 -z -uall --no-renames`
      reports, so untracked files, staged and unstaged content, modes, symlinks,
      deletions and binary files are covered. Exactly one implementation exists
      in the harness; the gate, the checks artifact and the evidence helper all
      call it.
- [ ] Implement the canonical record: sorted by bytewise-ascending path, one
      fixed-arity NUL-separated newline-terminated record per path carrying
      path, state, six-digit mode, 64-char lowercase hex hash. States: `f` +
      git file mode + SHA-256 of bytes; `l` + `120000` + SHA-256 of the link
      TARGET STRING (not the referent); `d` + `040000` + 64 zeros; `-` +
      `000000` + 64 zeros for a path that does not exist.
- [ ] A deleted path is encoded with the absent state, never omitted. `-z`
      because porcelain v1 shell-quotes paths with spaces/quotes/newlines;
      `--no-renames` so a rename decomposes into an absent record plus a present
      record. Assert both flags in a test, as `-uall` is asserted.
- [ ] A reported path that exists but cannot be read is UNCOMPUTABLE, not
      absent: record `UNVERIFIED` naming the path. Encoding it as absent would
      make a permissions failure indistinguishable from a deletion; state this
      in the code comment so it is not "simplified" later.
- [ ] Before spawning the auditor: allocate the attempt id from
      `el_attempt_new`, record it atomically in `$RD` as the current audit
      attempt, and atomically publish `audit-verdict.json` with
      `verdict:"UNVERIFIED"`, `state:"in_progress"` and the full evidence
      reference. The prior verdict is replaced at audit START, not at audit
      end; that is what makes an interrupted same-diff re-audit detectable.
- [ ] Set `state:"complete"` only after the auditor returns and its output has
      been interpreted.
- [ ] IF the evaluated-tree identity cannot be computed, THEN record
      `UNVERIFIED` with a reason naming that failure and write no defaulted or
      empty `tree_sha256`.
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

## T4 — gate: bind the verdict to the attempt and the evaluated tree

`diff_sha256` alone does not discriminate either the current audit attempt or
the evaluated tree. Both defects are recorded in `design.md`.

- [ ] `gate-eval.sh` recomputes, for the task under evaluation: the diff
      content hash, and the evaluated-tree identity `tree_sha256` (git tree
      object id of `HEAD` combined with the canonical content digest defined in
      T2 over every path `git status --porcelain=v1 -z -uall --no-renames`
      reports). Exactly one function for each; `-uall`, `-z` and `--no-renames`
      are all mandatory.
- [ ] Read the current audit attempt id from `$RD` (the value `audit-run.sh`
      published before spawning the auditor).
- [ ] Require all four to hold: `evidence.diff_sha256` matches,
      `evidence.tree_sha256` matches, `evidence.attempt` equals the current
      published attempt, and `state == "complete"`.
- [ ] Give each of the four failures its own distinct gate reason: diff
      mismatch, evaluated-tree mismatch, superseded or unfinished attempt,
      incomplete audit.
- [ ] Bind on content and tree identity, never on `head_sha`: an amend or
      re-checkpoint that changes neither content nor tree must not invalidate a
      valid audit.
- [ ] IF any of the three identities cannot be computed or read, THEN fail
      closed with a distinct reason. Never treat uncomputable as a match, as
      empty, or as a pass.
- [ ] Preserve the existing fail-closed behaviour for a missing or
      schema-invalid verdict artifact.

## T5 — gate: UNVERIFIED and policy

- [ ] Accept `UNVERIFIED` as a valid verdict value at `gate-eval.sh:43`.
- [ ] Fail with a reason string distinct from the `BLOCKED` reason, carrying
      the recorded `UNVERIFIED` reason.
- [ ] Ensure an `UNVERIFIED` failure is not counted against
      `limits.max_rework_rounds`, and name where that count lives.
- [ ] Source `lib/config.sh` and read `[audit.policy]`; every read takes the
      `audit-run.sh:56-58` pattern — value with a hard-coded fallback.
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
- [ ] Planted staleness control A -- interrupted same-diff re-audit: record an
      `APPROVED`, spawn a re-audit of the byte-identical diff, kill it after the
      pre-audit publish, run the gate. The gate must fail naming the unfinished
      attempt. Assert the same fixture PASSES a `diff_sha256`-only gate; a
      control the old predicate also rejects demonstrates nothing.
- [ ] Planted staleness control B -- byte-identical patch, different tree:
      audit on base A, rebase onto base B so the patch is byte-identical, run
      the gate. The gate must fail naming the evaluated-tree mismatch. Assert
      the same fixture PASSES a `diff_sha256`-only gate.
- [ ] Control C -- tree canonicalisation: two worktrees with identical
      `HEAD^{tree}` but a differing untracked file, unstaged edit, or file mode
      must produce different `tree_sha256` values.
- [ ] Control C2 -- deletion: a worktree with a tracked file deleted (porcelain
      reports ` D path`, `stat` and `sha256sum` both fail on it) must produce a
      COMPUTED `tree_sha256` differing from the same worktree with the file
      present. Prove the pre-fix definition goes red on this fixture: it records
      `UNVERIFIED` for an uncomputable tree on a perfectly valid deletion.
- [ ] Control C3 -- type change and link target: replacing a regular file with a
      symlink of the same name, and retargeting an existing symlink, must each
      change `tree_sha256`. A digest hashing the referent rather than the target
      string is asserted to FAIL the retarget case.
- [ ] Control C4 -- unreadable path: chmod a reported path unreadable; the
      result must be `UNVERIFIED` naming that path, and must NOT be the same
      identity the deletion fixture produces.
- [ ] Control D -- no authorizing artifact exists while an audit is in flight:
      sample `audit-verdict.json` between spawn and completion; no sample may
      be an authorizing verdict for a superseded attempt.
- [ ] Control E -- fail-closed: force the diff-hash, tree-identity and
      attempt-id computations to fail in turn; three distinct gate reasons, no
      pass, no silent match.
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

## T9 -- bind the other two gate inputs to the diff and the tree

Apalache found `post_fix / no_unverified_checks_merge` and
`post_fix / no_unverified_docs_merge` VIOLATED at depth 8 (state 6) with the
verdict binding of T4 working perfectly. `post_fix_full_binding` holds through
depth 10. The verdict binding alone is necessary and insufficient. Note the
model abstracts the change as an opaque `DiffId`, so it cannot speak to whether
`diff_sha256` discriminates the evaluated tree -- T4 covers that.

- [ ] `checks-run.sh:41-42` already writes `{sha, command, exit_code, status}`.
      Add `diff_sha256` and `tree_sha256` for the diff and tree actually
      evaluated. Do not repurpose `sha`.
- [ ] Emit the same `diff_sha256` and `tree_sha256` from the docs check into
      `docs-check.json`.
- [ ] `gate-eval.sh:40` currently reads `jq -r .status` from
      `checks-result.json` and nothing else. Read and compare both identities.
- [ ] `gate-eval.sh:49-52` does the same for `docs-check.json`. Same fix.
- [ ] Do NOT add an `attempt` field to the checks or docs artifacts. They are
      not produced by an audit attempt; the attempt binds the verdict only.
      State this in the code comment so it is not "fixed" later.
- [ ] Each of the three inputs gets its own distinct mismatch reason string,
      and each names which identity mismatched -- a reader must be able to tell
      which artifact was stale and why.
- [ ] Reuse T4's hash computations; there SHALL be exactly one diff-hash
      function and exactly one tree-identity function in the gate.
- [ ] Test: a round-N `pass` in `checks-result.json` must not authorise a
      round-N+1 diff. Prove the test goes red against current code.
- [ ] Test: a `checks-result.json` whose `diff_sha256` matches but whose
      `tree_sha256` differs must not authorise merge.
- [ ] Test: the byte-identical-diff-with-identical-tree case still passes for
      all three artifacts, not only the verdict.

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
      the `audit-run.sh:56-58` fallback pattern introduced by T5.
- [ ] Test: an unresolved medium `WARNING` fails the gate with a reason naming
      the finding; a resolved-low `WARNING` passes because policy said so.

T8 remains the final gate for this package, and its checklist now also covers
T9-T12's tests and a re-run of `openspec validate three-outcome-verdicts
--strict`.
