# v0.2.9 Gate Positive-Control Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Use test-first development for each package.

**Goal:** Close release criterion 4 with a mechanical inventory and one
fail-capable control for every v0.2.9 `kind: gate` check.

**Architecture:** A full-tree scanner derives gate identities from executable
surfaces. A committed registry binds each identity to known-bad, known-good,
and same-run control evidence. A comparator fails on an empty inventory, an
unregistered gate, a stale row, a malformed row, a missing evidence path, or a
control record that does not show opposite classifications. The v0.2.9 release
gate compares `kind: gate` only. Probe and verdict-predicate expansion moves to
a preserved v0.3 package. Exhaustive assertion registration is withdrawn.

**Tech stack:** Bash 5, Bats, TSV, JSON, Git, OpenSpec, Foreman, Grok, and
Council.

## Scope decision

The release checklist and SessionDB obligation 65 define the v0.2.9 unit as:

```text
kind = gate
check_id = <repository-relative path>::<check name>
```

The following are not v0.2.9 release work:

- `probe`: preserve for v0.3.
- `verdict-predicate`: preserve for v0.3.
- `assertion`: withdraw from exhaustive registration. Individual assertion
  tests remain test-first and fail-capable under their owning packages.

Do not count keyword sites. One gate wrapper is one named check even when it
emits several diagnostic branches. Do not count `gate-eval.sh` refusal reasons
as gates; they are deferred verdict predicates.

## Gate identity sources

The scanner must derive named gates from these executable sources:

1. `gate_*` functions in `tools/ci-local.sh`.
2. Named gate functions or one script-level `main` gate in
   `skills/foreman/scripts/gate-*`, `skills/foreman/scripts/*-eval.sh`, and
   `skills/foreman/scripts/*-gate.sh`.
3. Named policy gates in `tests/run.sh`: bare skip, skip budget, and pass
   baseline.
4. Formal checks declared in `formal/expectations.tsv` and consumed by
   `formal/run-checks.sh`.
5. Workflow steps that directly decide a result and are not wrappers around an
   already inventoried script. Each such step needs a stable `id`.

The scanner must not double-count a workflow step that only invokes an
inventoried wrapper. The inventory report must name the recognition rule for
each row so the grammar limitation remains visible.

## Task 1: Split the broad positive-control contract

**Files:**

- Modify:
  `openspec/changes/test-infrastructure-hardening/specs/test-harness/spec.md`
- Modify: `openspec/changes/test-infrastructure-hardening/tasks.md`
- Create: `openspec/changes/positive-control-expansion/`
- Modify: `openspec/changes/v029-release-convergence/tasks.md`

**Steps:**

1. Write the v0.2.9 `kind: gate` comparator requirement.
2. Preserve probe and verdict-predicate inventory plus controls in the new
   v0.3 package.
3. Record exhaustive assertion registration as withdrawn with its size reason.
4. Keep the current known incidents and schema language unchanged.
5. Run strict OpenSpec validation for all three packages.

## Task 2: Build the scanner and comparator under TDD

**Files:**

- Create: `tests/lib/check-inventory.sh`
- Create: `tests/check-inventory.bats`
- Create: `tests/fixtures/check-inventory/`
- Modify: `tests/baseline.tsv`

**RED controls:**

- fixture tree with one gate from each source rule;
- empty fixture tree;
- unregistered gate;
- stale registry row;
- duplicate gate identity;
- malformed six-column registry row;
- unknown kind;
- absent known-bad, known-good, or control-record path;
- control record with identical bad/good classifications;
- wrapper workflow step that must not duplicate its called gate;
- renamed gate with a stale old row;
- literal shell payload in a TSV field that must never execute.

**Interface:**

```bash
bash tests/lib/check-inventory.sh \
  --root ROOT \
  --inventory OUT.tsv \
  --registry REGISTRY.tsv \
  --kind gate
```

The derived inventory header is:

```text
check_id<TAB>kind<TAB>recognizer
```

The committed registry header remains:

```text
check_id<TAB>kind<TAB>known_bad_input<TAB>known_good_input<TAB>control_record<TAB>demonstrated_at
```

The script parses fields literally and never executes a registry value.

## Task 3: Derive and freeze the current gate census

**Ownership:** Grok gathers candidates in isolated batches. The architect
decides each identity and removes duplicates.

**Steps:**

1. Run the scanner at the current release head.
2. Review every row against its executable consumer.
3. Add stable workflow step ids where a direct workflow gate lacks one.
4. Refactor an inline `tests/run.sh` policy only when it needs a stable name.
5. Record the reviewed census count as a SessionDB measurement with scanner and
   source scopes.
6. Re-run the scanner after every landing-stage commit.

Do not lock the expected count in prose. The derived artifact and fresh
SessionDB measurement own the number.

## Task 4: Add control evidence in three batches

### Batch A: shared local gate runner

Cover each `tools/ci-local.sh::gate_*` identity. Reuse an existing fail-capable
fixture when it proves the exact predicate. Add a new paired fixture when it
does not.

### Batch B: formal gate rows

Use `formal/expectations.tsv` known-violating arms and their matching holding
arms. The control record must show both classifications from one bounded run.

### Batch C: workflow, test-policy, and script-level gates

Cover direct workflow gates, the three `tests/run.sh` policy gates, and each
script-level gate. A wrapper does not inherit evidence from a child unless the
wrapper's own success predicate is exercised.

Each batch updates `tests/positive-control-registry.tsv` deliberately. No
command regenerates that committed file.

## Task 5: Make the comparator a release gate

**Files:**

- Modify: `tests/run.sh`
- Modify: `tools/ci-local.sh`
- Modify: `.github/workflows/gates-linux.yml`
- Modify only if portable: `.github/workflows/gates-windows.yml`

**Steps:**

1. Run the scanner at the landing-stage head.
2. Fail on every inventory/registry/control mismatch.
3. Emit one machine-readable result artifact.
4. Add a planted unregistered gate and prove the build becomes red.
5. Remove the plant or add its row and prove the build becomes green.
6. Keep the Windows scope consistent with criterion 2 and the documented mode
   derivation defect.

## Task 6: Verify, review, and record

Run:

```bash
bats tests/check-inventory.bats
bash tests/lib/check-inventory.sh \
  --root . \
  --inventory tests/.check-inventory.tsv \
  --registry tests/positive-control-registry.tsv \
  --kind gate
TEST_GATE_MODE=enforce bash tests/run.sh
FOREMAN_CI_BATS=1 bash tools/ci-local.sh
openspec validate test-infrastructure-hardening --strict
openspec validate positive-control-expansion --strict
bash skills/foreman/scripts/docs-check.sh
git diff --check
```

Build an immutable committed bundle. Use three non-author Council reviewers
from at least two model-family domains. Treat findings as advisory engineering
input. Only Foreman audit, check, and merge gates determine release eligibility.

## Stop conditions

Do not tick criterion 4 when:

- the inventory is empty;
- one gate is unregistered;
- one registry row is stale or malformed;
- one evidence path is absent;
- one control record lacks opposite bad/good classifications;
- the scanner count is quoted without a fresh SessionDB verdict;
- the comparator is not invoked by the local release gate.
