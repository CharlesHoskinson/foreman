# v0.2.9.0 AFK Closeout Work-Package Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Use `superpowers:test-driven-development` for
> every behavior change and `superpowers:verification-before-completion`
> before every acceptance claim.

**Goal:** Complete v0.2.9.0 through bounded Grok implementation rounds,
independent host verification, cross-family audits, and one fail-closed final
release convergence.

**Architecture:** Foreman owns worktrees, evidence, verification, commits,
and merge decisions. Grok implements one package at a time. A different model
family performs the cold audit. Council reviews immutable commits and remains
advisory. SessionDB is the recovery authority. Graphify is a derived view and
must refresh from the final commit.

**Tech stack:** Node.js 24, TypeScript, Effect, `node:test`, npm lockfiles, Git
worktrees, OpenSpec, SessionDB, Graphify, Foreman, Grok, Codex, Agy, and
Council. Existing Bash/Bats commands remain compatibility gates during the
migration; they are not the target architecture.

## Global constraints

- Work on the v0.2.9.0 release branch. Do not merge the Council v0.3.0 branch.
- Apply the Node.js and TypeScript Iron Rule in `AGENTS.md` and
  `openspec/changes/node-typescript-runtime/`. Express every new product core
  and test in TypeScript. Do not add Python or shell implementation logic.
- Preserve untracked `SPEC.md`, `.harness/`, and worker report files.
- Pass provider prompts through files. Do not place task text on a process
  command line.
- Keep `agy` concurrency at one.
- Serialize Bats runs with the repository gate lock.
- Use a separate worktree and five-part specification for each behavior
  package.
- Write tests before implementation. Preserve the RED output.
- Treat a worker report as a claim. Verify the worktree and gate output.
- Require a different model family for each cold audit.
- Write a SessionDB checkpoint at least once per hour and after every accepted
  commit.
- Do not run paid Tier 2 work. Test only trigger and cost-finality behavior.
- Do not create tag `v0.2.9` until Task 12 passes at one unchanged commit.

## Common admission gate

Apply these steps to every core or integration candidate.

- [ ] Disable sparse checkout and inspect `git status --short`, `git diff
  --stat`, `git diff --check`, file modes, and the complete diff.
- [ ] Run the package-focused Bats slice through `tests/run.sh` under the gate
  lock. Require `RESULT PASS`, `fail=0`, and `skip=0` unless the package owns a
  reviewed skip budget.
- [ ] Run `bash skills/foreman/scripts/docs-check.sh` and the owning strict
  OpenSpec validation.
- [ ] Ask a different model family for a read-only cold audit of the complete
  worktree, not the worker report.
- [ ] If any gate fails or any audit returns `changes_requested`, write a new
  bounded Grok rework specification and repeat the gate plus cold audit.
- [ ] Commit only tracked product files. Exclude `.harness/`,
  `FOREMAN_REPORT*`, `SPEC.md`, and run-local artifacts.
- [ ] Record the accepted commit and evidence in SessionDB.

### Task 1: Admit active core candidates

**Packages:** `wsl-preflight`, `vendor-preflight`,
`test-infrastructure-hardening` inventory scanner,
`decision-lineage-and-telemetry` metrics rollup,
`doctrine-reality-drift` checker core, `graph-store-port`,
`knowledge-plane-refresh`, `round-ownership-default`, freshness tooling,
package audit index, and Tier 2 trigger/cost finality.

**Files:** The owning OpenSpec package, implementation files, focused tests,
and worker reports in each isolated worktree.

- [ ] Complete every in-flight Grok round. Do not accept an exit-zero worker
  without the common admission gate.
- [ ] Route each concrete cold-audit finding back to the same worktree in a
  new rework round. Add one named regression test for each defect class.
- [ ] Require strict TypeScript compilation and Node.js contract runs for
  GraphStore. Use the prior Python outputs only as parity fixtures, then delete
  the Python implementation.
- [ ] Require byte-exact process-boundary tests for WSL and vendor preflight.
- [ ] Require duplicate-key, torn-record, replay, attribution, and source-
  digest tests for metrics.
- [ ] Require filesystem race, NUL, newline, Git-error, size, and timeout tests
  for doctrine checks.
- [ ] Commit accepted candidates separately and cherry-pick them to the
  release branch in dependency order.
- [ ] Re-run affected focused slices after each cherry-pick to catch
  integration failures at the first introducing commit.

Expected result: each accepted core has a product commit, host gate record,
and independent audit. Every rejected core remains unmerged.

### Task 2: Correct record debt and establish README decisions

**Files:**

- Modify: `openspec/changes/test-infrastructure-hardening/tasks.md`
- Add: `docs/research/vnext/README-ambiguity-decisions.md`
- Add: `docs/research/vnext/README-claim-ledger.tsv`
- Add: `docs/research/vnext/README-claim-ledger.md`
- Modify: `openspec/changes/readme-refresh/tasks.md`

- [ ] Correct stale test counts, ordinal references, installer doctrine,
  line-ending doctrine, formal-model counts, workflow claims, and evidence
  ownership against the current tree.
- [ ] Record the delegated decisions: roles are functional roles; implementer
  lanes share one functional role; Agy adds routing coverage and not a fourth
  vote; the v0.2.5 pin is stale; `CMD` and `GATE` are descriptive process
  roles with a launcher reference; host identity is the resolved credential
  and configuration home under the OS account.
- [ ] Seed the claim ledger from its source tables. Do not write final README
  prose in this task.
- [ ] Run:

```bash
bash skills/foreman/scripts/docs-check.sh
openspec validate test-infrastructure-hardening --strict
openspec validate readme-refresh --strict
git diff --check
```

Expected result: the records describe current code and all four decisions are
attributed and non-`TBD`.

### Task 3: Persist the WSL-native tool path

**Depends on:** accepted `wsl-preflight` core.

**Files:**

- Modify: `env/bootstrap-wsl.sh`
- Modify: `skills/foreman/scripts/foreman-setup.sh`
- Modify: `skills/foreman/scripts/lane-run.sh`
- Modify: `env/tool-check.sh`
- Modify: `tests/vendor-isolation.bats`
- Modify: `tests/grok-lane.bats`
- Modify: `docs/INSTALL.md`
- Modify: `docs/USAGE.md`
- Modify: `skills/foreman/references/reference-environment.md`

- [ ] Add a failing test in which a non-interactive shell has a Windows shim
  first on inherited PATH and no startup files.
- [ ] Make Setup and bootstrap write `~/.foreman/env.sh` atomically and
  idempotently. Include only resolved WSL-native directories.
- [ ] Make every vendor lane source the file before vendor resolution.
- [ ] Keep explicit caller environment values when the contract requires
  them. Reject malformed or unsafe persisted values.
- [ ] Prove two Setup runs produce byte-identical output and file content.
- [ ] Run:

```bash
bash tests/run.sh tests/vendor-isolation.bats tests/grok-lane.bats \
  tests/foreman-setup.bats tests/wsl-preflight.bats
openspec validate wsl-tool-path-persistence --strict
bash skills/foreman/scripts/docs-check.sh
```

Expected result: a lane started with `bash --noprofile --norc` resolves the
WSL-native vendor CLIs without reading `.bashrc`.

### Task 4: Wire vendor-preflight callers

**Depends on:** accepted vendor-preflight core and Task 3.

**Files:**

- Modify: `skills/foreman/scripts/foreman-setup.sh`
- Modify: `skills/foreman/scripts/lane-run.sh`
- Modify: `env/tool-check.sh`
- Modify: `env/reference-manifest.toml`
- Modify: `tests/vendor-preflight.bats`
- Modify: `tests/tool-check-auth.bats`
- Modify: `tests/foreman-setup.bats`
- Modify: `tests/lane-run.bats`

- [ ] First add failing caller tests for missing, not-authenticated, unknown,
  outdated, and ready states.
- [ ] Bind the readiness record to vendor, resolved executable, credential
  home, configuration home, host identity, probe contract, and timestamp.
- [ ] Make all callers consume the same record. Do not re-probe with a weaker
  path.
- [ ] Render exact remediation for each fact. An unknown fact must fail closed
  without asserting that the operator is signed out.
- [ ] Bound every child process and prove that descendants are reaped.
- [ ] Run:

```bash
bash tests/run.sh tests/vendor-preflight.bats tests/tool-check-auth.bats \
  tests/foreman-setup.bats tests/lane-run.bats
openspec validate vendor-preflight --strict
bash skills/foreman/scripts/docs-check.sh
```

Expected result: Setup, tool-check, and lane launch report the same readiness
facts and reasons for one identity-bound record.

### Task 5: Integrate the doctrine registry

**Depends on:** accepted doctrine checker and Task 2.

**Files:**

- Add: `docs/doctrine-claims.tsv`
- Modify: `skills/foreman/scripts/doctrine-check.sh`
- Modify: `skills/foreman/scripts/docs-check.sh`
- Modify: `tests/doctrine-check.bats`
- Modify: `.github/workflows/windows-smoke.yml`
- Modify: `skills/foreman/references/orchestration-hardening.md`
- Modify: `bugeventlog.md`

- [ ] Seed the registry from load-bearing shipped-behavior claims. Each row
  must name one bounded fail-capable probe and an owner.
- [ ] Parse the registry once into a closed typed record set. Reject duplicate
  identifiers, NUL, newline ambiguity, unsafe paths, and unsupported probe
  types.
- [ ] Add doctrine checking to docs-check and the Windows Bash workflow.
- [ ] Add known-bad fixtures for stale text, Git failures, symlink retargeting,
  directory replacement, timeout, output overflow, and missing owners.
- [ ] Run:

```bash
bash tests/run.sh tests/doctrine-check.bats
bash skills/foreman/scripts/docs-check.sh
openspec validate doctrine-reality-drift --strict
```

Expected result: a stale or unprobeable registered claim makes the docs gate
fail with one bounded single-line diagnostic.

### Task 6: Publish release sigma

**Depends on:** accepted metrics-rollup core.

**Files:**

- Add: `skills/foreman/scripts/release-sigma.sh`
- Add: `tests/release-sigma.bats`
- Modify: `skills/foreman/references/release-metrics.md`
- Modify: `openspec/changes/decision-lineage-and-telemetry/tasks.md`
- Modify: `openspec/changes/release-metrics/tasks.md`

- [ ] Write failing tests for insufficient samples, changed code, mixed
  metric definitions, non-finite values, duplicate records, and a qualifying
  unchanged-code window.
- [ ] Bind every sample to commit, tree, event-log digest, metric definition,
  denominator, and collection command.
- [ ] Calculate thresholds per metric. Do not combine unrelated metrics into
  one aggregate sigma.
- [ ] Emit `not_evaluated` with a reason when evidence is insufficient.
- [ ] Prove deterministic byte-identical output for the same sample set.
- [ ] Run:

```bash
bash tests/run.sh tests/metrics-rollup.bats tests/release-sigma.bats \
  tests/release-metrics.bats tests/telemetry.bats
openspec validate decision-lineage-and-telemetry --strict
openspec validate release-metrics --strict
bash skills/foreman/scripts/docs-check.sh
```

Expected result: comparative claims can cite a qualified per-metric threshold,
and unqualified metrics render `not_evaluated`.

### Task 7: Complete the README refresh

**Depends on:** Tasks 2, 4, 5, and 6 plus every behavior described by the
README.

**Files:**

- Modify: `README.md`
- Modify: `docs/research/vnext/README-claim-ledger.tsv`
- Modify: `docs/research/vnext/README-claim-ledger.md`
- Modify: `docs/doctrine-claims.tsv`
- Modify: `skills/foreman/scripts/docs-check.sh`
- Modify: `tests/readme-structure.bats`
- Add or modify: `docs/STYLE.md`

- [ ] Disposition every ledger row against current code or a named owner.
- [ ] Rewrite the twelve ordered sections. Describe functional roles and
  model-family independence without presenting four lanes as four votes.
- [ ] Ground each shipped claim in code, a doctrine probe, or current release
  evidence. Mark plans and limits as such.
- [ ] Add one known-bad fixture per README checker predicate.
- [ ] Obtain a cross-family fact check of the final full text.
- [ ] Run:

```bash
bash tests/run.sh tests/readme-structure.bats tests/doctrine-check.bats
bash skills/foreman/scripts/docs-check.sh
openspec validate readme-refresh --strict
```

Expected result: the README gate and doctrine gate pass, the ledger is
complete, and the independent fact check has no unresolved claim.

### Task 8: Retire stale doctrine and correct release records

**Depends on:** Tasks 1 through 7.

**Files:**

- Modify: `AGENT_TRAPS.md`
- Modify: `skills/checkpoint/SKILL.md`
- Modify: `docs/design/session-store-ontology-links.md`
- Modify: `skills/foreman/graph_store/README.md`
- Modify: `docs/releases/v0.2.9.0-notes.md`
- Modify: `devlog/2026-08-02.md`
- Modify: `bugeventlog.md`
- Modify: `ROADMAP.md`
- Modify: `checklist.md`

- [ ] Remove live TerminusDB instructions and present-tense architecture
  claims. Keep dated history explicit and unchanged in meaning.
- [ ] Add the devlog correction block and bug-ledger entries for every defect
  class found during closeout.
- [ ] Draft release notes from accepted commits and current measurements. Mark
  any value that still needs final refresh.
- [ ] Update roadmap and checklist evidence, but do not mark the release or tag
  complete.
- [ ] Run:

```bash
bash skills/foreman/scripts/doctrine-check.sh
git diff -- AGENT_TRAPS.md skills/checkpoint/SKILL.md \
  docs/design/session-store-ontology-links.md \
  skills/foreman/graph_store/README.md
bash skills/foreman/scripts/docs-check.sh
git diff --check
```

Expected result: live operator and architecture documents contain no withdrawn
TerminusDB doctrine. The doctrine registry identifies permitted dated history
separately. Every release record distinguishes accepted evidence from values
that require final refresh.

### Task 9: Freeze the release manifest and gate set

**Depends on:** Tasks 1 through 8 and accepted package-audit-index tooling.

**Files:**

- Modify: `openspec/changes/v029-release-convergence/proposal.md`
- Modify: `openspec/changes/v029-release-convergence/design.md`
- Modify: `openspec/changes/v029-release-convergence/tasks.md`
- Modify:
  `openspec/changes/v029-release-convergence/specs/release-convergence/spec.md`
- Modify:
  `openspec/changes/v029-release-convergence/evidence/package-matrix.tsv`
- Add:
  `openspec/changes/v029-release-convergence/evidence/release-manifest.tsv`
- Modify: `skills/foreman/scripts/package-matrix-check.sh`
- Modify: `tests/package-matrix-check.bats`
- Add: `packages/release/src/package-audit.ts`
- Modify: `tests/package-audit.bats`

- [ ] Add failing fixtures for an archived package missing from the manifest,
  an active and archived duplicate, a deferred destination that disappeared,
  and evidence bound to the wrong tree.
- [ ] Freeze one manifest that lists every v0.2.9.0 shipped package and every
  deferred or residual destination.
- [ ] Make the checker reconcile active packages, archived packages, and the
  frozen manifest without reading mutable task prose as authority.
- [ ] Finalize the matrix, archive, and package-audit-index predicates. Do not
  archive packages or capture positive controls in this task.
- [ ] Run:

```bash
bash tests/run.sh tests/package-matrix-check.bats tests/package-audit.bats
bash skills/foreman/scripts/package-matrix-check.sh \
  openspec/changes/v029-release-convergence/evidence/package-matrix.tsv
openspec validate v029-release-convergence --strict
bash skills/foreman/scripts/docs-check.sh
```

Expected result: the complete gate inventory and the release manifest are
frozen before control capture, with no missing or double-counted package.

### Task 10: Capture real positive controls

**Depends on:** accepted inventory scanner and Task 9.

**Files:**

- Modify: `tests/positive-control-registry.tsv`
- Modify: `tests/lib/check-inventory.sh`
- Add: `tests/positive-control-record.schema.json`
- Add: `docs/evidence/v029/positive-controls/README.md`
- Add: one immutable JSON record under
  `docs/evidence/v029/positive-controls/` per registered check
- Modify: `tests/check-inventory.bats`

- [ ] Scan the complete repository at the candidate commit.
- [ ] For every `kind: gate` member, run its actual predicate against a
  reachable known-bad arm and a known-good arm in the same control run.
- [ ] Bind each record to check identifier, demonstrated source commit,
  predicate digest, input digests, command, bad-arm outcome, good-arm outcome,
  and record digest. The evidence commit must descend from the demonstrated
  source commit. Do not put the evidence commit's own tree hash inside the
  tracked record.
- [ ] Reject stale, duplicate, synthetic-only, missing, and unregistered
  control records.
- [ ] Demonstrate the comparator by adding one unregistered fixture, observing
  failure, then registering its real control and observing success.
- [ ] Re-scan the inventory after record publication. Any new or changed gate
  predicate returns execution to Task 9 and invalidates affected records. The
  final checker recomputes predicate and input digests from the current tree.
- [ ] Run:

```bash
bash tests/run.sh tests/check-inventory.bats tests/package-matrix-check.bats \
  tests/package-audit.bats
bash tests/selftest-test-infrastructure.sh
openspec validate test-infrastructure-hardening --strict
```

Expected result: every member of the frozen release gate inventory has current
discrimination evidence from its real predicate.

### Task 11: Archive and build immutable per-package audits

**Depends on:** Task 10.

**Files:**

- Add: `skills/foreman/schemas/package-audit.schema.json`
- Modify: `packages/release/src/package-audit.ts`
- Modify: `tests/package-audit.bats`
- Add: `docs/evidence/v029/package-audits/README.md`
- Add per package: `docs/evidence/v029/package-audits/<package>/source-verdict.json`
- Add per package: `docs/evidence/v029/package-audits/<package>/scope.json`
- Add per package: `docs/evidence/v029/package-audits/<package>/worker.json`
- Add per package: `docs/evidence/v029/package-audits/<package>/verification.json`
- Add per package: `docs/evidence/v029/package-audits/<package>/package-audit.json`
- Add: `docs/evidence/v029/package-audits/index.json`
- Move: shipped package directories to `openspec/changes/archive/`

- [ ] Require accepted implementation and source cold-audit evidence before
  archiving a package. The source audit is admission evidence; it is distinct
  from the immutable package audit built after the archive move.
- [ ] Run `openspec archive "$package" --yes` for one shipped package at a
  time. Commit the archive move before recording its package audit.
- [ ] Build each audit from committed base and head objects after the archive
  move. Record diff and tree identities.
- [ ] Preserve each source verdict byte for byte. Keep aggregation separate
  from source artifacts.
- [ ] Require an auditor model family different from the package implementer.
- [ ] Reject missing, stale, mutable, malformed, or same-family artifacts.
- [ ] Use this recorder interface for each package:

```bash
node packages/release/dist/package-audit.js record \
  --package "$package" --matrix "$matrix" --base "$base" --head "$head" \
  --source-verdict "$source_verdict" --scope "$scope_manifest" \
  --worker "$worker_manifest" --verification "$verification_manifest" \
  --output "$audit_dir/package-audit.json"
```

- [ ] Build the index twice and require byte-identical output:

```bash
node packages/release/dist/package-audit.js check \
  --matrix openspec/changes/v029-release-convergence/evidence/package-matrix.tsv \
  --manifest openspec/changes/v029-release-convergence/evidence/release-manifest.tsv \
  --evidence-root docs/evidence/v029/package-audits \
  --output docs/evidence/v029/package-audits/index.json
bash tests/run.sh tests/package-audit.bats
openspec validate --all --strict --no-interactive
bash skills/foreman/scripts/docs-check.sh
```

Expected result: every archived shipped package has a current, immutable,
independently audited artifact and the index has no unresolved verdict.

### Task 12: Run final release convergence

**Depends on:** Task 11.

- [ ] From the release worktree, record the merge identity before the final
  freeze:

```bash
bash skills/foreman/scripts/merge-gate.sh record \
  v029-release-20260802 release-candidate
```

- [ ] Stop implementation writes and record the final candidate commit and
  tree.
- [ ] Quiesce the periodic checkpoint writer by its exact command identity,
  verify its lock is free, write one final manual SessionDB checkpoint, and
  commit the refreshed release-branch sidecar:

```bash
set -euo pipefail
mapfile -t checkpoint_pids < <(
  pgrep -f '^bash /home/charl/.foreman/hourly-v029-checkpoint.sh$'
)
if test "${#checkpoint_pids[@]}" -gt 1; then
  echo "multiple hourly checkpoint writers found" >&2
  exit 1
fi
if test "${#checkpoint_pids[@]}" -eq 1; then
  kill -TERM "${checkpoint_pids[0]}"
  while kill -0 "${checkpoint_pids[0]}" 2>/dev/null; do sleep 1; done
fi
flock -n /home/charl/.foreman/hourly-v029-checkpoint.lock true || exit 1
if test "${#checkpoint_pids[@]}" -eq 1; then
  source_head="$(git rev-parse HEAD)"
  source_tree="$(git rev-parse 'HEAD^{tree}')"
  python3 skills/foreman/scripts/fm-session.py fact \
    "FINAL RELEASE FREEZE SOURCE: head=$source_head tree=$source_tree" \
    --evidence "git rev-parse HEAD and HEAD^{tree}; hourly writer lock released"
  python3 skills/foreman/scripts/fm-session.py sidecar \
    --out "$PWD/.foreman/session.ndjson"
  git add .foreman/session.ndjson
  git commit -m "session: freeze the v0.2.9 release checkpoint"
  exit 75
fi
git diff --quiet HEAD -- .foreman/session.ndjson || exit 1
git show HEAD:.foreman/session.ndjson \
  | rg -F 'FINAL RELEASE FREEZE SOURCE:' >/dev/null || exit 1
freeze_commit="$(git rev-parse HEAD)"
```

  Exit 75 means that the sidecar commit was created and Task 12 must restart.
  On restart, zero writers are valid only when the tracked sidecar is clean and
  contains the freeze-source fact. The immutable Council bundle and release
  evidence bind to `freeze_commit`, which is the descendant sidecar commit.
  Do not restart the periodic writer before Council review or tag creation.

- [ ] Run the authoritative full local gate and supplemental self-test:

```bash
bash tools/ci-local.sh
bash formal/run-checks.sh --self-test
openspec validate --all --strict --no-interactive
git diff --check
```

- [ ] Run SessionDB freshness in report mode. Resolve all findings. Run apply
  mode once, commit any required records, and restart this task from the new
  commit.
- [ ] Refresh the Graphify graph from the final commit. Run graph freshness,
  orphan, contradiction, and release-scope queries. Resolve all findings and
  restart this task after any edit.
- [ ] Refresh `docs/releases/v0.2.9.0-notes.md`, `devlog/2026-08-02.md`,
  `bugeventlog.md`, `ROADMAP.md`, and `checklist.md` from the same commit.
  If any tracked record changes, commit it and restart Task 12 before building
  the Council bundle.
- [ ] Build one immutable final Council bundle. Require three admissible
  verdicts from at least two model-family domains and require the typed outcome
  `approved`. Treat `insufficient_evidence`, `judge_unstable`, and
  `outcome_unknown` as release failures.
- [ ] Re-run the deterministic gates after Council without changing tracked
  files:

```bash
bash tools/ci-local.sh
bash skills/foreman/scripts/merge-gate.sh check \
  v029-release-20260802 release-candidate \
  foreman/v029-release-20260802/implement/small-four
git diff --check
```

- [ ] Push the reviewed release branch and update its draft GitHub pull
  request. Do not push the tag yet.
- [ ] Verify `git status --short` contains only explicitly excluded local
  artifacts and verify `HEAD^{tree}` still matches the reviewed tree.
- [ ] Create annotated tag `v0.2.9` with message `Total GeorgeCall` only after
  every preceding step passes and no tracked file changed. Push the tag after
  the local and GitHub commit identities match.

Expected result: code, tests, OpenSpec, SessionDB, Graphify, measurements,
release prose, Council evidence, GitHub branch, and tag all bind to one
unchanged commit.
