# Positive-control record -- 2026-08-07 -- the three remaining single gates

Covers the last three rows in `tests/positive-control-todo.tsv` that are not
CI-workflow, `env/tool-check.sh`, or `tests/run.sh` gates:

- `tests/lib/positive-control.bash::assert_positive_control_token`
- `tests/lib/check-registry-compare.sh::check-registry-compare`
- `skills/foreman/scripts/gate-eval.sh::gate-eval`

The first two are the control machinery itself. Per the brief for this task:
giving them controls is not circular, but it changes what "known-bad input"
means -- the bad input must make the **checker** fail, not the thing it
checks. Both demonstrations below feed the checker a malformed instance of
the exact thing it exists to catch. `gate-eval.sh` is an ordinary consuming
gate and is controlled the same way as the `tests/run.sh` gates in the prior
record: two run-directories differing in exactly one field.

Current platform: `wsl` (WSL2, Ubuntu). Every arm below was executed in the
same shell session immediately before this record was written; nothing here
is inferred or backfilled from memory.

## Gate 1: `tests/lib/positive-control.bash::assert_positive_control_token`

### Predicate

The token-based sibling of `assert_positive_control`: judges a check on an
anchored **output token** rather than exit status, for checkers that always
exit 0 and report their verdict in text. It must reject (a) a "predicate"
whose output is identical on both arms -- `DOES NOT DISCRIMINATE` -- and (b)
one whose output differs but does not carry the expected anchored token. It
has no existing bats or evidence coverage; the only tests of this file
(`tests/positive-control.bats`) exercise `assert_positive_control`, its
exit-code sibling, not this function.

### Fixture pair

Reused directly, unmodified: `tests/fixtures/positive-control/unanchored-bad.txt`
(`ERROR: violation at line 3`) and
`tests/fixtures/positive-control/unanchored-good.txt` (`[ok] No violation
found`). These are the same two fixtures Row 1 of the 2026-08-06 record used
to control the exit-code helper; reusing them here checks the token-based
helper against the identical measured 2026-07-28 defect shape rather than a
fresh invented one. Both arms below pass **both** fixture files to the
helper unchanged; what varies between arms is the candidate predicate
supplied after `--`, exactly as in the exit-code helper's own record.

- Known-bad predicate, `always_same`: ignores its argument and prints
  `checked` regardless of content -- a predicate that cannot discriminate.
- Known-good predicate, `anchored_token`: greps the file with an anchored
  pattern and prints `VIOLATION: <content>` or `CLEAN: <content>`.

### Known-bad arm

```
source tests/lib/positive-control.bash
always_same() { printf 'checked\n'; }
assert_positive_control_token demo::always_same \
  tests/fixtures/positive-control/unanchored-bad.txt \
  tests/fixtures/positive-control/unanchored-good.txt \
  VIOLATION CLEAN -- always_same
```

Verbatim output:
```
positive-control demo::always_same: DOES NOT DISCRIMINATE -- identical output on both arms
```
Exit `1`. NEGATIVE, as required: the helper rejects a predicate that answers
both arms identically.

### Known-good arm

```
anchored_token() {
  if grep -qE '^ERROR.*violation' "$1"; then
    printf 'VIOLATION: %s\n' "$(cat "$1")"
  else
    printf 'CLEAN: %s\n' "$(cat "$1")"
  fi
}
assert_positive_control_token demo::anchored_token \
  tests/fixtures/positive-control/unanchored-bad.txt \
  tests/fixtures/positive-control/unanchored-good.txt \
  VIOLATION CLEAN -- anchored_token
```

Verbatim output: *(none on stdout or stderr)*. Exit `0`. POSITIVE, as
required.

## Gate 2: `tests/lib/check-registry-compare.sh::check-registry-compare`

### Predicate

Compares the derived full-repository check inventory against
`tests/positive-control-registry.tsv`, failing closed on: an unregistered
enforced check, a registry row malformed in shape (field count, unknown
kind, a named path that does not exist), an empty inventory, or -- the
property this arm demonstrates -- **a registry row that is stale**, i.e.
that names a check_id the inventory does not contain. It must reject a
registry inconsistent with the inventory and accept one that is consistent.
`tests/positive-control.bats` already exercises five malformed-shape arms
plus the shipped-registry-passes arm; this record adds the sixth documented
shape (stale row) as a standalone, non-bats demonstration and supplies the
registry row.

### Fixture pair

`tests/fixtures/positive-control/registry-compare-bad.tsv` is a byte-for-byte
copy of the committed `tests/positive-control-registry.tsv` at this record's
base commit, with exactly one row appended:
```
tests/gone.bats::vanished	assertion	README.md	README.md	README.md	deadbeef
```
`tests/gone.bats` does not exist and no inventory sweep of this repository
will ever produce that check_id, so the row is stale by construction. The
"known-good" arm needs no separate fixture file: it is the committed
`tests/positive-control-registry.tsv` itself, run with no environment
override, at the same commit. The two arms therefore differ in exactly the
one property `check-registry-compare.sh` reads for this failure mode --
presence of a registry row the inventory cannot corroborate -- with every
other row held byte-identical.

### Known-bad arm

```
POSITIVE_CONTROL_REGISTRY=tests/fixtures/positive-control/registry-compare-bad.tsv \
  bash tests/lib/check-registry-compare.sh
```

Verbatim output:
```
check-inventory: 796 rows -> tests/.check-inventory.tsv
FAIL stale registry row names a check the repository does not contain: tests/gone.bats::vanished
positive-control: inventory=796 enforced(gate,probe)=34 registered=20 deferred=15
positive-control: assertion and verdict-predicate kinds are inventoried but NOT enforced -- coverage claims must say so
positive-control: 1 failure(s)
```
Exit `1`. NEGATIVE, as required.

### Known-good arm

```
bash tests/lib/check-registry-compare.sh
```

Verbatim output (captured at this record's base commit, before this task's
own registry rows were added):
```
check-inventory: 796 rows -> tests/.check-inventory.tsv
positive-control: inventory=796 enforced(gate,probe)=34 registered=19 deferred=15
positive-control: assertion and verdict-predicate kinds are inventoried but NOT enforced -- coverage claims must say so
positive-control: OK
```
Exit `0`. POSITIVE, as required. (`registered=19` here; this task's own three
rows are added in a following commit, which is why the comparator's own
after-the-fact self-check --
`tests/positive-control.bats::"the committed registry and todo satisfy the
comparator"` -- is what attests to the post-registration state, not this
record.)

## Gate 3: `skills/foreman/scripts/gate-eval.sh::gate-eval`

### Predicate

Reads a run directory's inputs (`meta.json`, `hashes.txt`,
`checks-result.json`, `audit-verdict.json`, `docs-check.json`, ...) and
decides PASS/FAIL. Among its many inputs, an audit verdict of `BLOCKED`
under the default `audit.policy.blocked = never` must fail the gate; every
other input held identical must pass. `tests/gate-eval.bats` covers only one
arm (docs-check absent); `tests/decision-events.bats` already carries both
arms of this exact demonstration inline (`seed_gate_fixture ... 'APPROVED'`
vs `'BLOCKED'`) but as literal strings, not committed fixture files. This
record externalises the one property that differs into two fixture files so
the registry can name them, and reruns both arms as a standalone
demonstration outside bats.

### Fixture pair

`tests/fixtures/gate-eval/verdict-blocked.json` (`{"verdict":"BLOCKED"}`) and
`tests/fixtures/gate-eval/verdict-approved.json` (`{"verdict":"APPROVED"}`).
Both are read into an otherwise-identical run-directory built by the same
`seed_gate_fixture` construction `tests/decision-events.bats` uses (fresh
throwaway git repo, matching `diff_sha256`/`tree_sha256`/`base_sha`/`attempt`
computed the same way for both arms) -- the audit-verdict JSON's content is
the only thing that varies between arms.

### Known-bad arm

Run-directory built with `audit-verdict.json`'s verdict field taken verbatim
from `verdict-blocked.json`; every other field (`meta.json`, `hashes.txt`,
`checks-result.json`, `docs-check.json`, `audit-attempt.current`) identical
in construction to the known-good arm.

```
bash skills/foreman/scripts/gate-eval.sh run-bad
```

Verbatim output:
```
[foreman] GATE FAIL (run-bad):
 - audit verdict BLOCKED (policy: never)
```
`gate-decision.json`:
```json
{
  "pass": false,
  "reasons": [
    "audit verdict BLOCKED (policy: never)"
  ]
}
```
Exit `1`. NEGATIVE, as required.

### Known-good arm

Same construction, `audit-verdict.json`'s verdict field taken from
`verdict-approved.json`; nothing else differs.

```
bash skills/foreman/scripts/gate-eval.sh run-good
```

Verbatim output:
```
[foreman] GATE PASS (run-good)
```
`gate-decision.json`:
```json
{
  "pass": true,
  "reasons": []
}
```
Exit `0`. POSITIVE, as required.

## Scope

These three rows bring the enforced-kind registry from 19 to 22 rows and
shrink `tests/positive-control-todo.tsv` from 15 to 12 deferred rows -- the
12 that remain are the CI-workflow gates already judged unreachable or
unsafe to execute from this WSL/Linux worktree by prior W1 tasks (2 GitHub
Actions maintenance-workflow steps still awaiting a control, plus 10 gates
deferred for stated environment-reachability or shared-host-mutation
reasons). No control in this record was demonstrated by weakening any
checker; all three checkers are unmodified by this task.
