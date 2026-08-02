# v0.2.9.0 AFK Release Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Execute each behavior change with
> `superpowers:test-driven-development`.

**Goal:** Restore the independent review plane, reconcile the release scope,
and produce an executable package inventory before the remaining v0.2.9.0
implementation rounds.

**Architecture:** The Foreman architect owns specifications, worktrees,
verification, commits, and release gates. Grok implements one bounded task per
worktree. Council reviews only immutable committed bundles and cannot write a
release artifact. SessionDB is the decision authority; code consumers and
fail-capable tests are the implementation authority.

**Tech Stack:** Bash 5, Bats, Git worktrees, OpenSpec, SessionDB, Graphify,
Foreman durable lanes, Grok, Antigravity (`agy`), Codex, and Council.

## Preconditions

- Work from branch
  `foreman/v029-release-20260802/implement/small-four` in
  `/home/charl/foreman-wt-v029-release-20260802-implement-small-four`.
- Preserve the dirty Council rework in
  `/home/charl/foreman-wt-council-v030-20260802-implement-council`.
- Do not merge the Council v0.3.0 branch into the v0.2.9.0 branch.
- Do not restore the deferred graph plane to v0.2.9.0.
- Do not create tag `v0.2.9` from this bootstrap plan.
- Pass provider prompts through files.
- Keep `agy` at concurrency one.
- Keep the existing Claude Setup refusal unchanged.
- Write a SessionDB checkpoint before each provider dispatch and after each
  accepted commit.

## Authoritative scope decision

SessionDB Fact 238 moves these packages to v0.3.0:

- `graph-context-builder`
- `graph-dogfood`
- `graph-eval-falsification`
- `work-dag-projection`

Their specifications, kill criteria, and off-switch contract remain in the
repository. v0.2.9.0 has no default graph-context path.

---

### Task 1: Commit the convergence contract

**Files:**

- Add: `openspec/changes/v029-release-convergence/proposal.md`
- Add: `openspec/changes/v029-release-convergence/design.md`
- Add: `openspec/changes/v029-release-convergence/tasks.md`
- Add:
  `openspec/changes/v029-release-convergence/specs/release-convergence/spec.md`
- Add:
  `openspec/changes/v029-release-convergence/evidence/package-matrix.tsv`
- Add: `docs/superpowers/plans/2026-08-02-v029-afk-bootstrap.md`

- [ ] **Step 1: Validate the package in strict mode**

Run:

```bash
openspec validate v029-release-convergence --strict
```

Expected: `Change 'v029-release-convergence' is valid`.

- [ ] **Step 2: Run the documentation and whitespace checks**

Run:

```bash
bash skills/foreman/scripts/docs-check.sh
git diff --check
```

Expected: docs-check passes and `git diff --check` prints nothing.

- [ ] **Step 3: Review the exact staged scope**

Run:

```bash
git status --short
git diff --stat
git diff -- openspec/changes/v029-release-convergence \
  docs/superpowers/plans/2026-08-02-v029-afk-bootstrap.md
```

Expected: only the convergence package and this plan are in the commit. Keep
the recovered `SPEC.md` untracked for Task 3.

- [ ] **Step 4: Commit the contract**

Run:

```bash
git add openspec/changes/v029-release-convergence \
  docs/superpowers/plans/2026-08-02-v029-afk-bootstrap.md
git commit -m "openspec: define v0.2.9 release convergence"
```

Expected: one new commit on the v0.2.9.0 implementation branch.

---

### Task 2: Admit `agy` through Setup without inference

**Worker:** Grok through a Foreman implementation lane.

**Files:**

- Modify: `env/tool-check.sh`
- Modify: `skills/foreman/scripts/foreman-setup.sh`
- Modify: `tests/tool-check-auth.bats`
- Modify: `tests/foreman-setup.bats`
- Do not modify: `skills/foreman/scripts/adapters/agy.sh`

**Interface:**

```text
bash env/tool-check.sh --profile soft --lane agy
LANE_READY: agy=yes|no

bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane agy
SETUP: READY|NOT-READY
```

The readiness path must source the existing `agy` adapter and call
`adapter_auth_probe agy`. It must never use `agy --print`.

- [ ] **Step 1: Create a task worktree and five-part specification**

Use the Foreman worktree helper. Derive its exact invocation from `--help`.
The specification file must include:

1. Objective: admit only the existing `agy` adapter through tool-check and
   Setup.
2. Inputs: the four allowed files, `adapters/agy.sh`, the OpenSpec requirement,
   and this task.
3. Outputs: failing-test evidence, minimal implementation, focused green
   output, `FOREMAN_REPORT.md`, and `FOREMAN_REPORT.json`.
4. Constraints: tests first, no inference, no adapter edit, no Claude behavior
   change, no `agy` promotion to a profile `must`, and no Git commit.
5. Acceptance: the commands in Step 5 pass and the live Setup probe reports
   READY.

- [ ] **Step 2: Write the positive tool-check test and verify RED**

Add this behavior to `tests/tool-check-auth.bats` before editing production
code:

```bash
@test "tool-check --lane agy uses the adapter model-list probe without inference" {
  cat > "$SHIM/agy" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "agy version 1.1.8"; exit 0 ;;
  models) echo "gemini-3.6-flash-high"; exit 0 ;;
  --print|-p|--prompt)
    echo "INFERENCE-WAS-CALLED" > "$BATS_TEST_TMPDIR/agy-inference-called"
    exit 99
    ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$SHIM/agy"

  run env PATH="$SHIM:$PATH" bash "$TC" --profile soft --lane agy

  [ "$status" -eq 0 ]
  [[ "$output" == *"agy"*"ok"* ]]
  [[ "$output" == *"LANE_READY: agy=yes"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/agy-inference-called" ]
}
```

Run:

```bash
bats tests/tool-check-auth.bats --filter 'tool-check --lane agy'
```

Expected RED: the command fails because `agy` is not an accepted lane.

- [ ] **Step 3: Add negative and indeterminate tests and verify RED**

Add separate tests for these outputs from `agy models`:

```text
Error: Please sign in to view available models.
network proxy returned an indeterminate response
future-model-without-lineage
```

The first two shims return nonzero. The third shim returns zero. Every case
must emit `LANE_READY: agy=no`. Also assert that a missing `agy` binary reports
`missing`, not `not_authenticated`.

Run:

```bash
bats tests/tool-check-auth.bats --filter 'agy'
```

Expected RED: all new tests fail for the missing lane integration.

- [ ] **Step 4: Implement the minimum readiness integration**

Make these changes only after the RED output is captured:

- Accept `agy` in `--lane` usage and validation.
- Keep the special `claude` refusal unchanged.
- In `vendor_authed`, run the adapter probe in a subshell so its generic
  function names do not leak into tool-check:

```bash
agy)
  (
    source "$ROOT/skills/foreman/scripts/adapters/agy.sh"
    adapter_auth_probe agy
  )
  ;;
```

- Change the unknown-vendor branch in `vendor_authed` from success to failure.
- Add the `agy` inventory row by calling `agy --version` and `vendor_authed
  agy`.
- Include `agy` as a `should` tool for soft, hard, and full profiles. Do not
  make it a `must`; default readiness must not depend on its installation or
  authentication state.
- Add an `agy` operator instruction in `fs_auth_instruction`. Since this CLI
  has no login subcommand, instruct the operator to run `agy` interactively
  and complete sign-in. Do not invent a command.
- Update Setup usage to `grok|codex|agy|claude`.

- [ ] **Step 5: Verify GREEN through the Foreman gate queue**

Run these commands as one serialized gate job:

```bash
bats tests/tool-check-auth.bats tests/foreman-setup.bats \
  tests/adapters.bats tests/audit-routing.bats
bash -n env/tool-check.sh skills/foreman/scripts/foreman-setup.sh
shellcheck env/tool-check.sh skills/foreman/scripts/foreman-setup.sh
```

Expected: all tests pass, syntax checks pass, and ShellCheck reports no new
finding.

- [ ] **Step 6: Run the live zero-inference Setup probe**

Run:

```bash
bash skills/foreman/scripts/foreman-setup.sh --profile soft --lane agy
```

Expected on this host: `LANE_READY: agy=yes` and `SETUP: READY`.

- [ ] **Step 7: Architect review and commit**

The architect must inspect the diff, rerun Step 5 independently, verify the
live command, confirm `lane-queue.sh` still declares `agy:1`, and then commit:

```bash
git commit -m "feat(setup): admit the authenticated agy lane"
```

---

### Task 3: Correct release scope and stale checklist claims

**Worker:** Grok through a new Foreman implementation lane.

**Files:**

- Modify: `checklist.md`
- Read: `SPEC.md`
- Read: `docs/evidence/v029/**`
- Read: SessionDB Fact 238

- [ ] **Step 1: Re-derive criteria 7, 9, 10, and 12**

Run the commands named in `SPEC.md`. Also prove that no default graph context
path is enabled:

```bash
rg -n "graph.context|graph_context|context_builder|work_dag" \
  .foreman config skills/foreman/scripts env tests
bash skills/foreman/scripts/docs-check.sh
bash tools/plugin-drift.sh ~/.claude/skills/foreman skills/foreman
sqlite3 .foreman/session.db \
  "select id,status,statement from obligations where id=24;"
git ls-files assets/v029-total-georgecall.png
```

Expected: criterion 7 can cite a disabled default plus Fact 238 deferral;
documentation and plugin claims use current command output; obligation 24 is
done; the release art is tracked.

- [ ] **Step 2: Edit only `checklist.md`**

Replace stale notes. Do not mark a criterion complete unless its complete
acceptance condition is proven. Specifically:

- Narrow criterion 7 to the recorded graph deferral and disabled default.
- Remove the stale documentation failure count.
- Remove obligation 24 as a plugin blocker.
- Name the tracked release art path.

- [ ] **Step 3: Verify the documentation-only diff**

Run:

```bash
git diff -- checklist.md
bash skills/foreman/scripts/docs-check.sh
git diff --check
```

Expected: only `checklist.md` changes, the facts match current output, and both
checks pass.

- [ ] **Step 4: Architect review and commit**

Run the derivation commands independently. Commit only after they reproduce:

```bash
git commit -m "checklist: reconcile v0.2.9 scope with current evidence"
```

---

### Task 4: Recover and review the Council Task 2 rework

**Worktree:**
`/home/charl/foreman-wt-council-v030-20260802-implement-council`

**Crash boundary:** commit `ba1164b8` is the last committed product candidate.
The later dirty diff is the crash-preserved response to Council round 2. All
old `/tmp` evidence is gone and has no authority.

- [ ] **Step 1: Preserve and inspect the dirty candidate**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: the known Task 2 rework remains present and whitespace is clean.
Do not reset, clean, or restore any path.

- [ ] **Step 2: Re-run focused verification through the gate queue**

Run:

```bash
bash tests/run.sh tests/docs-check.bats tests/council-localization.bats \
  tests/plugin-drift.bats
bash skills/foreman/scripts/docs-check.sh
bats tests/line-endings.bats
openspec validate council-v030-localization --strict
git diff --check
```

Expected: targeted tests, docs-check, line endings, strict OpenSpec, and
whitespace all pass. If the package name differs, obtain it with
`openspec list` and use the exact name.

- [ ] **Step 3: Audit the two round-2 findings from source**

Verify that:

- every new negative-control predicate can fail when its prohibited pattern is
  present
- root-ignore matching rejects generalized variants rather than only the
  literal reviewed token
- `tests/baseline.tsv` equals the current exact number of
  `tests/docs-check.bats` tests
- documentation no longer describes stale post-commit state or vanished
  `/tmp` artifacts as current evidence

- [ ] **Step 4: Commit the verified rework**

Stage only Task 2 paths and commit with a Simplified Technical English message:

```bash
git commit -m "fix(council): make localization guards fail capable"
```

- [ ] **Step 5: Build a new immutable Council bundle**

Use the committed parent and head. Require different commit IDs. Record:

```text
base_commit
head_commit
tree_hash
diff_content_hash
```

Blind worker and provider identities in reviewer inputs. Keep the identity map
outside the bundle.

- [ ] **Step 6: Run three non-author Council reviews**

Use one pinned Google-family `agy` reviewer and two independent Codex/OpenAI
reviewers. The Grok implementer cannot review its own work. Require three
admissible verdicts and at least two model-family domains.

Any admissible `changes_requested` verdict forces rework and a new committed
bundle. Missing, malformed, stale, or hash-mismatched output is inadmissible,
not approval.

---

### Task 5: Validate the package matrix as an executable artifact

**Worker:** Grok through a new Foreman implementation lane.

**Files:**

- Add: `skills/foreman/scripts/package-matrix-check.sh`
- Add: `tests/package-matrix-check.bats`
- Modify:
  `openspec/changes/v029-release-convergence/evidence/package-matrix.tsv`
- Modify: `tests/baseline.tsv`

**Interface:**

```text
bash skills/foreman/scripts/package-matrix-check.sh \
  openspec/changes/v029-release-convergence/evidence/package-matrix.tsv
```

The checker exits zero only when every active package appears exactly once and
all rows obey their disposition-specific evidence requirements.

- [ ] **Step 1: Write fixture-first RED tests**

Add tests for:

- one valid matrix
- a missing active package
- a duplicate package
- an unknown package
- an unknown disposition
- `v029-implemented` with an empty consumer
- `v029-implemented` with an empty verification command
- a deferred row without a destination or preservation file
- a malformed header or column count

Run:

```bash
bats tests/package-matrix-check.bats
```

Expected RED: the script is absent.

- [ ] **Step 2: Implement the minimum fail-closed checker**

The checker must:

- use `openspec list` as the active-package inventory
- parse literal tab-separated fields without evaluating them
- require the exact six-column header
- allow only the dispositions in the convergence design
- report every error before exiting nonzero
- never execute a verification command from the matrix

- [ ] **Step 3: Verify GREEN and repository integration**

Run:

```bash
bats tests/package-matrix-check.bats
bash skills/foreman/scripts/package-matrix-check.sh \
  openspec/changes/v029-release-convergence/evidence/package-matrix.tsv
bash -n skills/foreman/scripts/package-matrix-check.sh
shellcheck skills/foreman/scripts/package-matrix-check.sh
```

Expected: fixtures pass. The live matrix remains nonzero until Task 6 adds one
row for each active package; that live failure is correct at this boundary.

- [ ] **Step 4: Architect review and commit**

Inspect the parser against hostile fields and whitespace. Commit the checker
and tests only after the focused suite passes.

---

### Task 6: Classify every active package

**Ownership:** The architect decides dispositions. Grok gathers candidate
evidence in bounded batches. Council reviews the final committed matrix.

- [ ] **Step 1: Generate the active package census**

Run:

```bash
openspec list
find openspec/changes -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

Expected: both inventories can be reconciled. Record any directory omitted by
`openspec list` as a validation finding.

- [ ] **Step 2: Classify the four deferred graph packages**

Set their disposition to `v030-deferred`. Cite SessionDB Fact 238 and their
preserved OpenSpec paths. Do not describe their behavior as shipped.

- [ ] **Step 3: Classify remaining packages in batches of five**

For each package:

1. Read its proposal, design, requirements, and tasks.
2. Locate the consuming code.
3. Locate or run a fail-capable test.
4. Classify missing behavior as `v029-gap`.
5. Classify delivered behavior as `v029-implemented` only with both a consumer
   and a verification command.
6. Classify mixed scope as `split` and name the preserved destination.

Do not use file existence, an unticked box, or worker narration by itself as
evidence.

- [ ] **Step 4: Run the live matrix checker**

Run:

```bash
bash skills/foreman/scripts/package-matrix-check.sh \
  openspec/changes/v029-release-convergence/evidence/package-matrix.tsv
```

Expected: zero errors, one row per active package, and exit 0.

- [ ] **Step 5: Derive the next implementation plans**

Group all `v029-gap` rows by dependency and consuming subsystem. Write one
Superpowers implementation plan per independent group. Each plan must state
exact files, test-first RED commands, GREEN verification, Grok ownership,
architect review, Council bundle boundaries, and release gates.

- [ ] **Step 6: Council review and commit**

Commit the completed matrix and reconciled package task records. Build an
immutable Council bundle. Resolve every admissible dissent before accepting
the matrix as the source for subsequent AFK rounds.

## Bootstrap completion gate

The bootstrap plan is complete only when all conditions hold:

- `agy` Setup readiness passes without inference.
- The Council Task 2 rework has a committed, dissent-free immutable review.
- The release checklist agrees with SessionDB Fact 238 and current evidence.
- The package-matrix checker passes its negative controls.
- Every active OpenSpec package has exactly one evidence-bound disposition.
- The next implementation plans exist for every `v029-gap` row.
- SessionDB records the accepted commit IDs and state hashes.

After this gate, continue with the next generated plan. Do not stop at the
bootstrap boundary and do not create the release tag.
