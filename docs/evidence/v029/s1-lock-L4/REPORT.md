# Lock Primitive Hardening Report

## T6 — Spec-Derived Lock Tests

COMPLETE

Created `tests/lock.bats` with 14 spec-derived cases covering occupancy,
trusted `flock`, forced pinned `mkdir`, refusal causes, independent locks,
owner-aware reclamation, and the operational process-kill guard. The existing
`el_attempt_new under concurrent contention` case is retained in
`tests/eventlog.bats` and is now explicitly labeled a load-dependent symptom
test rather than mechanism proof. The root append-failure case already detects
whether its `chmod 000` induction actually failed and explicitly skips with
`filesystem ignores mode 000 for writer (e.g. root)` if it did not; it cannot
silently pass on a successful append.

The occupancy case runs eight release-contending acquirers and checks the trace
as an occupancy state machine: exactly eight `ENTER` and eight `EXIT` records,
strict alternation, matching holder identities, no underflow, and no held state
at EOF.

Red-first evidence:

```text
$ flock /tmp/foreman-bats.lock env \
    FM_LOCK_OCCUPANCY_CONTROL=check-then-act-mkdir \
    bats -f '^occupancy:' tests/lock.bats
not ok 1 occupancy: eight release-contending acquirers strictly alternate ENTER and EXIT
# occupancy overlap: ENTER 7 while 8 still holds
...
exit 1
```

The deliberately non-atomic shim performs a userspace existence check, widens
the check/create gap, and falsely reports success when another racer wins the
create. The checker observed seven overlapping entries in this run and the
Bats process exited 1. The same occupancy case passes against the trusted
`flock` helper path.

## T7 — Platform and Full-Suite Gate

HISTORICAL PRE-REWORK RESULT — RED; the lock-suite failure is resolved in the
final rework section below. The unrelated full-suite findings were not in this
rework's scope.

- `flock /tmp/foreman-bats.lock bats tests/eventlog.bats`:
  34 passed, 1 explicitly skipped as root, exit 0.
- In the full 396-test run, historical tests 43 and 54 passed. Test 50
  explicitly skipped because root could append despite mode `000`; it did not
  report a vacuous pass.
- Reading the relevant fix confirms the green concurrency results are backed
  by the shared helper: `el_emit` holds `.seq.lock`, `el_attempt_new` holds
  `.attempt.lock`, each releases once at a single exit point, and `el_compact`
  holds `.seq.lock` across its read/transform/replace operation.
- The amended Git-Bash fallback is reachable without touching the real
  register. A structurally valid manifest, trace, inventory, digest, host
  class, and covered `local` filesystem are created below
  `BATS_TEST_TMPDIR`; forced selection reports `FM_LOCK_MECHANISM=mkdir`,
  creates one lock directory, and leaves zero after both success and an
  induced critical-section error.
- The unpinned `msys2-git-bash` path refuses non-zero with
  `FM_LOCK_PROBE_UNTRUSTED`, the resolved path and digest,
  `durable_lanes=unavailable`, and the route back: trace on a
  Foreman-controlled same-class host, commit the artifact, and add the digest
  to `[[lock_atomicity.pinned]]`.
- `flock /tmp/foreman-bats.lock bash tests/run.sh`: 396 cases, exit 1.
  Therefore the WSL/Ubuntu full-suite gate is **not green**. The lock-suite
  failure is the missing detected-class detail on `FM_LOCK_FS_UNSUPPORTED`.
  Numerous older integration suites also fail because they now transitively
  call the fail-closed lock helper without installing a trusted temporary
  inventory. NATS readiness and missing compiled-launcher failures also occur
  and are separate environmental/integration findings.

## T13 — Operational Process-Kill Discipline

COMPLETE

`tests/lock.bats` includes a static gate over `skills/foreman/scripts/**/*.sh`
that fails on `pkill -f` pattern matching. It passes in the current tree.

## Eleven-Requirement Coverage Audit

COMPLETE — see the final coverage-gap analysis appended below. The strict
classification is 3 covered, 1 vacuous-only, and 7 not covered.

## Suite Exit-Status Proof

COMPLETE

A disposable three-case Bats file in `/tmp` passed case 1, deliberately failed
case 2, and still ran and passed case 3. Bats returned 1:

```text
1..3
ok 1 control before induced failure
not ok 2 induced mid-run failure restores the prior EXIT trap
ok 3 control after induced failure still runs
induced_bats_exit=1
```

The occupancy negative control independently returned 1, and the lock suite
with its genuine spec/implementation disagreement also returned 1. No wrapper
converted any of those failures to success.

## Repository Immutability Proof

COMPLETE

Immediately before and after the induced mid-run failure, the proof captured:

1. the exact bytes of `git status --porcelain=v1 -uall`; and
2. a sorted SHA-256 inventory of every repository file outside `.git`.

Both comparisons were byte-identical:

```text
status_bytes_identical=yes
repository_content_identical=yes
```

The induced-failure case installed a temporary `EXIT` cleanup trap, performed
its cleanup, and restored the prior Bats trap before executing `false`. The
following Bats case ran, demonstrating that failure reporting was not
suppressed. The authored suite itself uses `BATS_TEST_TMPDIR` for every
artifact and Bats `teardown()` for recorded child PIDs, so it does not replace
Bats' traps.

## Validation Results and Findings

COMPLETE — HISTORICAL FINDING, RESOLVED BY THE FINAL REWORK BELOW

- **Pre-rework spec/implementation disagreement:** an uncovered filesystem
  refuses with `FM_LOCK_FS_UNSUPPORTED`, but the emitted diagnostic does not
  name the detected filesystem class. The spec requires the refusal to name
  that class. The final rework section records the code fix and GREEN evidence.

---

The two architect addenda below preserve the killed lane's historical RED
record. They are superseded by the final rework sections at the end.

## ARCHITECT ADDENDUM (lane was killed by its 30-minute timeout mid-write)

The lane hit `timeout 1800` at 14:28 having written `tests/lock.bats` (13
tests) but before completing the coverage-gap analysis this round asked for.
The suite is usable: it parses and runs.

**Result: 12 pass, 1 fail — and the failure is a genuine implementation
finding, not a test defect.**

### FINDING L4-F1 (HIGH) — `FM_LOCK_FS_UNSUPPORTED` names nothing

```text
not ok 6 uncovered filesystem refuses before acquisition and names its class
  stderr did not contain network; actual stderr: FM_LOCK_FS_UNSUPPORTED
```

The spec requires, twice:

> THEN the helper SHALL refuse with `FM_LOCK_FS_UNSUPPORTED`, **naming the
> path, the detected class, and the classes that are covered.**
> AND **the refusal names the detected filesystem class.**

The implementation emits the bare code and names none of the three. An operator
on a DrvFs or network mount is told only that the filesystem is unsupported,
not which class was detected, which are covered, or which path was classified —
so they cannot act on it. This is also the unresolved half of L2 audit finding
F6 ("untrusted fallback refusal does not state the platform consequence or
remedy"), which was recorded as MEDIUM and treated as addressed.

**Why eleven audits missed it:** every previous test on this package was
written by the lane that wrote the code, and asserted the refusal *code*, which
is exactly what the code emits. This suite was derived from the spec instead,
and the spec asks for more than the code delivers. That is the whole point of
the discipline and it paid off on its first outing.

### Still owed from this round

The coverage-gap analysis — which of the specs

---

## ARCHITECT ADDENDUM (lane killed by its 30-minute timeout mid-write)

The lane hit `timeout 1800` at 14:28 having written `tests/lock.bats` (13 tests)
but before completing the coverage-gap analysis this round asked for. The suite
is usable: it parses and runs.

**Result: 12 pass, 1 fail — and the failure is a genuine implementation
finding, not a test defect.**

### Duplicate historical finding — L4-F1

```text
not ok 6 uncovered filesystem refuses before acquisition and names its class
  stderr did not contain network; actual stderr: FM_LOCK_FS_UNSUPPORTED
```

The spec requires this twice, at `specs/locking/spec.md:195-196` and `:238`:

> THEN the helper SHALL refuse with `FM_LOCK_FS_UNSUPPORTED`, **naming the path,
> the detected class, and the classes that are covered.**
> AND **the refusal names the detected filesystem class.**

The implementation emits the bare code and names none of the three. An operator
on a DrvFs or network mount is told only that the filesystem is unsupported —
not which class was detected, which classes are covered, or which path was
classified — so they cannot act on it. This is also the unresolved half of L2
audit finding F6 (untrusted fallback refusal states no platform consequence or
remedy), which was recorded MEDIUM and treated as addressed.

**Why eleven audits missed it:** every previous test on this package was written
by the lane that wrote the code, and asserted the refusal *code* — which is
exactly what the code emits. This suite was derived from the spec instead, and
the spec asks for more than the code delivers. That is the entire point of the
discipline, and it paid off on its first outing.

**The failure is left RED deliberately.** Adjusting the test to match the code
is the defect this discipline exists to prevent.

### Still owed in the duplicate addendum

The coverage-gap analysis — which of the spec's eleven requirements are covered
by no test, and which only vacuously. The lane was killed before producing it.

## Fix the suite-caught finding

Status: COMPLETE

`skills/foreman/scripts/lib/lock.sh` now uses its documented
`<subject> <target>: <message>` detail shape for all three trust diagnostics:

```text
FM_LOCK_FS_UNSUPPORTED filesystem <lock-path>: detected_class=<class> covered_classes=<csv>
FM_LOCK_NO_ATOMIC_PRIMITIVE mechanism <mechanism-csv>: atomic_primitive=absent trusted_verdict=non-atomic
FM_LOCK_PROBE_UNTRUSTED mechanism <resolved-binary>: path=<resolved-binary> host_class=<class> sha256=<digest> durable_lanes=unavailable remedy=<trace-commit-pin-route>
```

For filesystem refusals, the selected verdict source carries its covered
classes forward from either the current inventory row or the matching pinned
manifest entry. The detail therefore names the refused lock path, the detected
class, and the actual covered classes rather than a hard-coded platform list.
The refusal still goes through `fm_lock__refuse` once, before acquisition.

The existing test 6 was strengthened, not weakened: it now asserts the exact
lock path, `detected_class=network`, `covered_classes=local`, no lock artifact,
non-zero status, and byte identity of a protected fixture. Its pre-fix RED was:

```text
stderr did not contain /tmp/.../network/shared.lock; actual stderr: FM_LOCK_FS_UNSUPPORTED
not ok 1 uncovered filesystem refuses before acquisition and names its class
```

After the implementation fix:

```text
ok 3 uncovered filesystem refuses before acquisition and names its class
```

Sibling audit:

- `FM_LOCK_NO_ATOMIC_PRIMITIVE` had the same bare-detail gap. Its test now
  requires `mechanism mkdir` and `atomic_primitive=absent`. Restoring the old
  bare emission produced the expected RED (`stderr did not contain mechanism
  mkdir`); restoring the fix produced `ok 1`.
- `FM_LOCK_PROBE_UNTRUSTED` already named the resolved binary, digest,
  consequence, and trace/commit/pin route. It had no missing-remedy gap; only
  its prefix was aligned with the documented detail shape.
- `shellcheck skills/foreman/scripts/lib/lock.sh tests/lock.bats`,
  `bash -n ...`, and `git diff --check` all exited 0.

## Coverage-gap analysis

Status: COMPLETE

Classification rule: **COVERED** means the test exercises the requirement's
decisive predicate and would fail for a representative broken implementation.
**VACUOUS ONLY** means the assertion passes without the protected behavior
being reachable. **NOT COVERED** includes rows with partial probes when the
requirement's decisive predicate can still be broken while every named test
passes; the partial probes are named so they are not mistaken for zero work.

| # | Requirement | Status | Test evidence and exact gap |
|---:|---|---|---|
| 1 | One shared helper selects a provably atomic mechanism | **NOT COVERED** | `trusted flock acquisition creates no lock directory...`, `temporary pinned manifest makes mkdir fallback reachable...`, and `sequence and attempt locks are independent...` exercise the helper directly. They do not prove that every durable-core caller uses the helper instead of an inline lock, nor instrument exactly one release at every caller exit. A bypassing caller can ship green. |
| 2 | A non-atomic `mkdir` is detected, never assumed away | **NOT COVERED** | `trusted non-atomic mkdir with no flock refuses...` injects a hand-written trusted-negative inventory row; it never runs the detector. Missing: deterministic syscall/EEXIST probing, uutils-with-flock INFO/READY behavior, no-primitive NOT-READY behavior, and the contention/flavour evidence asymmetry. |
| 3 | Selection requires a trusted, current, filesystem-class-specific verdict | **NOT COVERED** | The flock, pinned-mkdir, unpinned, non-atomic, and uncovered-filesystem cases exercise selected branches with fresh fixtures. No negative test changes one currency field at a time (path, version, digest, filesystem class, pre-mtime timestamp, or >24-hour age), proves one bounded local probe per process, or proves the helper never writes the inventory. An implementation that ignores freshness can pass. |
| 4 | An untrusted mechanism states platform consequence and remedy | **COVERED** | `unpinned Git-Bash host refuses with class consequence and pinning route` directly asserts non-zero refusal, `FM_LOCK_PROBE_UNTRUSTED`, host class, `durable_lanes=unavailable`, and the trace/commit/pin route. It also proves the lock is absent and the fixture protected file is unchanged. Release-document wording and non-durable-lane availability remain outside this dynamic test. |
| 5 | Every refusal has one shape and one ordered cause | **NOT COVERED** | Six tests reach the six codes, but only the untrusted case counts code occurrences. Several tests would pass if a second code were also emitted; no table-driven test applies the same no-lock/no-entry/non-zero/byte-identical predicate to all six; and overlapping guards are not systematically exercised. The protected-file checks on direct helper calls are also not caller-entry proofs. |
| 6 | Mutual exclusion is regression-tested by occupancy | **COVERED** | `occupancy: eight release-contending acquirers strictly alternate ENTER and EXIT` runs eight contenders and checks strict occupancy. The known-bad check-then-act shim is an observed RED control that reports overlap, so this predicate is non-vacuous. |
| 7 | No lock acquisition may fail open | **VACUOUS ONLY** | `timeout on an engaged trusted mechanism refuses without touching protected data` proves helper timeout/non-zero after a trusted mechanism is engaged, but the `protected` file is never passed to the helper and no caller critical section is invoked. Its byte-identity assertion cannot fail even if `wt-new.sh` still warns and proceeds. Missing: a timed-out `wt-new.sh` integration, index/lane byte-identity checks, and a fail-open call-site regression scan. |
| 8 | Compaction never discards a concurrently appended event | **NOT COVERED** | No written test overlaps `el_compact` snapshot/write-back with `el_emit`. Existing compaction cases are sequential and would pass a unique-temp-file-only implementation that still loses the append. Missing: controlled overlap plus a known-bad unique-temp-only negative control. |
| 9 | Every foreman lock has a named, owner-aware reclamation path | **NOT COVERED** | `owner-aware reclaim removes only the named dead-holder mkdir lock` genuinely checks single-target reclaim and sibling survival. `owner-aware reclaim refuses a live holder...` takes the lock in the same process and stops at `held_by_this_process`, so it does not exercise token PID/start-time liveness. Missing: crash/restart integration for `.nats-bridge.lock` and `worktrees/.index.lock`, run-scoped-only `el_init`, PID reuse/unknown-liveness refusal, and proof that only the winner writes/releases the owner token. |
| 10 | Acquisitions are flat; nesting is refused rather than ordered | **NOT COVERED** | `nested acquisition refuses while outer lock remains held and releasable` directly proves the helper's runtime guard, and the independence case proves distinct paths. Missing: enumeration of today's caller graph, proof that `el_compact` calls only read-only helpers while holding `.seq.lock`, and a static check that neither lock documentation file states an ordering. A nested/bypassing caller can remain green. |
| 11 | The append-failure test is valid under root | **COVERED** | `append failure leaves a gap, never a duplicate seq` first probes whether mode `000` actually blocks append. On this root host it explicitly skips with `filesystem ignores mode 000 for writer (e.g. root)` instead of passing an inverted assertion; on a host where induction works, it asserts non-zero and the `1 3` gap. The root skip is an allowed outcome of this requirement, not a silent pass. |

The suite's `operational scripts never use pkill -f pattern matching` case is a
real static check, but it maps to task T13 rather than any of the eleven
requirements above and therefore does not inflate the requirement count.

## Suite non-vacuity and repository non-mutation

Status: COMPLETE

All three Bats invocations below ran inside one
`flock /tmp/foreman-bats.lock bash -c ...` critical section:

1. `bats tests/lock.bats` — 13/13 passed, exit 0.
2. `bats -f "append failure leaves a gap, never a duplicate seq"
   tests/eventlog.bats` — explicit root skip, exit 0.
3. `FM_LOCK_OCCUPANCY_CONTROL=check-then-act-mkdir bats tests/lock.bats` —
   test 1 reported seven occupancy overlaps, tests 2–13 still ran and passed,
   and Bats exited 1.

The batch recorded:

```text
positive_rc=0 root_case_rc=0 negative_rc=1
git_status_byte_identical=yes
batch_rc=0 mutation_rc=0
```

The exact `git status --porcelain -uall` snapshots before and after all three
runs had the same SHA-256:

```text
e591b331a09626a1899d3897bb8061785ddaeacc607bdc1a747f0d24ed111de6
```

This includes the induced first-case failure and the cleanup of all subsequent
cases. No test-created file or repository mutation survived.

`tests/lock.bats` contains zero shell `trap` commands. Cleanup uses Bats'
`teardown()` hook to kill/wait recorded occupancy children and restore `PATH`;
there is therefore no suite-owned EXIT trap that can replace Bats' reporting
trap. The induced run's visible `not ok 1`, detailed overlap diagnostics, and
the twelve following `ok` records independently confirm that failure reporting
was neither suppressed nor terminated early.
