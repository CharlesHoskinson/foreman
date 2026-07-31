# Merge Integration Audit

## VERDICT

**BLOCKED**

The merged result must not ship: it can reclaim without a positive `mkdir`
selection, its owner token is unsound under the required check-then-act case,
its register path accepts EEXIST from an unrelated target, and its committed
positive-path regression suites fail the new trust precondition.

This verdict changes to **APPROVED** when F1-F4 are fixed as specified below,
the deterministic probes for all three behavioral defects go red-before/green-
after, `tests/lock.bats` is committed, the relevant Bats/full WSL gate is green,
the scratch harness remains 0-failure with non-zero fault-injection behavior,
and ShellCheck still has zero errors. D5's on-host Git-Bash run remains deferred
and is not required to change this verdict.

## Findings

### F1 — HIGH — two reclaim callers can delete while the mechanism is flock or indeterminate

- `skills/foreman/scripts/lib/nats-bridge.sh:89`
- `skills/foreman/scripts/wt-new.sh:112`
- `skills/foreman/scripts/lib/lock.sh:1291`

`nb_bridge_once` and `wt-new.sh` invoke `fm_lock_reclaim` before
`fm_lock_acquire` performs mechanism selection. Unlike `el_init`
(`eventlog.sh:64-90`), neither caller first proves that
`fm_lock__select_mechanism` selected `mkdir`. The callee only distinguishes an
on-disk regular file from a directory (`lock.sh:1298-1309`); given a directory
with a provably dead owner it removes that directory at `lock.sh:1347-1352`
without consulting the current trust/mechanism verdict. Thus an existing
fallback-format lock can be deleted when the current mechanism would be
`flock`, or when mechanism selection would refuse as indeterminate. This
violates the requirement that indeterminacy never authorizes deletion and that
reclamation is never applied on the flock path.

To clear F1, both callers must establish `mkdir` positively before invoking
reclaim (and surface an indeterminate selection without deletion), or
`fm_lock_reclaim` must enforce the same mechanism gate itself.

Runtime evidence: with `fm_lock__select_mechanism` forced indeterminate and a
dead-owner `.nats-bridge.lock` directory present, `nb_bridge_once` emitted
`FM_LOCK_RECLAIMED`, removed the directory, and only afterward refused
acquisition with `FM_LOCK_PROBE_UNTRUSTED` (bridge rc 5).

### F2 — HIGH — the owner token is overwriteable by a check-then-act loser

- `skills/foreman/scripts/lib/lock.sh:1051`
- `skills/foreman/scripts/lib/lock.sh:1124`
- `skills/foreman/scripts/lib/lock.sh:1208`
- `skills/foreman/scripts/lib/lock.sh:1182`

`fm_lock__acquire_mkdir` treats every zero result from the selected `mkdir` as
a win; `fm_lock_acquire` then unconditionally calls
`fm_lock__write_owner_token`, whose `mv -f` overwrites an existing
`owner`. There is no exclusive owner-token creation and release does not verify
that the on-disk token belongs to the releasing process before deleting it.

A deterministic check-then-act double-success probe demonstrated the required
bad interleaving: process A created/acquired the directory; process B's
simulated non-atomic `mkdir` also returned success and overwrote `owner` with
B's PID; B then released successfully and removed the directory while A was
still alive. A's later release also returned success against the already
missing lock. This is exactly the contract failure described by T11: the true
holder can lose ownership and the non-winner can release.

To clear F2, owner publication must itself identify exactly one winner (and
release must verify that identity), with a regression that deterministically
forces two check-then-act successes and proves the loser neither overwrites the
token nor releases the winner's lock.

### F3 — HIGH — register-backed `mkdir` evidence is not bound to the probed target

- `skills/foreman/scripts/lib/lock.sh:526`
- `skills/foreman/scripts/lib/lock.sh:321`
- `env/tool-check.sh:612`
- `env/tool-check.ps1:264`

The target-aware branch of `fm_lock__trace_valid` exists at
`lock.sh:310-319`, but the register consumer calls it without the target at
`lock.sh:526`. That activates the bound-less branch, which accepts any
`mkdir(...) = -1 EEXIST` in the artifact. The independent validators embedded
in `tool-check.sh` and `tool-check.ps1` likewise accept an arbitrary
`mkdir`/`EEXIST` occurrence.

Runtime evidence: a temporary pin matching the real `mkdir` digest and current
host class, but whose entire trace was only
`mkdir("/unrelated/preexisting", 0777) = -1 EEXIST`, produced
`fm_lock__pinned_verdict ... = atomic`. Thus the shipped register-backed path
does not retain the promised “EEXIST bound to the probed target” fix and a
structurally plausible fake/unrelated trace can license acquisition.

To clear F3, the register schema/artifact must identify the probe target and
all three validators must bind the kernel refusal to that target; regression
coverage must show the unrelated-EEXIST artifact is rejected through the
actual register lookup, not only through a direct helper call with an optional
target argument.

### F4 — HIGH — the committed regression suite was not migrated to the trust contract

- `tests/eventlog.bats:5`
- `tests/helpers.bash:35`
- `tests/wt-new.bats:4`

The positive-path fixtures set an isolated `FOREMAN_HOME` but provide neither a
trusted temporary inventory/register nor a lock-verdict seam. Consequently the
migrated callers correctly fail closed before the tests reach their intended
assertions. Fresh results:

- `tests/eventlog.bats`: **7 passed, 28 failed**; positive emit, attempt, and
  compaction cases refuse with `FM_LOCK_PROBE_UNTRUSTED`.
- `tests/wt-new.bats`: **7 passed, 7 failed**; positive worktree cases refuse
  the index lock with `FM_LOCK_PROBE_UNTRUSTED`.

This host has `strace`, but the audit sandbox denies ptrace, so an ambient local
probe returns `unknown`; that environmental fact explains the observed
refusal, but it does not make tests that depend on ambient host evidence
hermetic. The test package also contains no `tests/lock.bats`, despite the
occupancy/reclamation regression requirement. The uncommitted scratch harness
cannot substitute for the shipped suite.

To clear F4, add explicit trusted fixtures for intended positive paths,
explicit refusal fixtures for negative paths, and the required committed lock
regressions; then demonstrate the relevant suite (and the WSL/Linux gate) green
without depending on ambient ptrace permissions.

### Confirmed integration properties (partial)

- `eventlog.sh:64-90` correctly skips reclamation for both `flock` and an
  indeterminate selection.
- `durable-lanes.md:115-160` is coherent after the auto-merge: it states the
  hard FLAT rule, explicitly states that there is no lock ordering, and gives no
  ordering that would authorize nesting.
- All non-document L2 files are byte-identical to `s1/lock-L2-trust`, and all
  non-document L3 files are byte-identical to `s1/lock-L3-callers`. The merged
  `durable-lanes.md` is the union of the L2 availability section and the L3
  locking section; neither side was silently dropped there.
- The L3 fixes remain in the final source: there is no unconditional caller
  `rmdir`; every reclaim call captures its status and re-emits the callee's
  record; and `wt-new.sh:137` acquires the index lock before
  `wt-new.sh:163` runs `git worktree add`.
- The L2 trust checks for register membership, `LOCK_EX|LOCK_NB`, fake
  non-trace rejection, host-class matching, and per-class aggregation remain.
  F3 above qualifies this conclusion: target binding is present only in the
  direct target-aware validator, not in the actual register consumers.
- D5's retained fallback/error-path check passed using a temporary manifest:
  `mkdir` was selected, the command observed the lock directory plus owner
  token, command rc 7 propagated, release ran exactly once, and no lock
  remained. With an empty temporary register and host class forced to
  `msys2-git-bash`, acquisition returned 1, created no lock, and emitted
  `FM_LOCK_PROBE_UNTRUSTED` with `host_class=msys2-git-bash`,
  `durable_lanes=unavailable`, and the trace/commit/pin remedy. The real
  register contains zero entries and records why at
  `env/reference-manifest.toml:381`; the Git-Bash host class, consequence, and
  pinning route are documented at `durable-lanes.md:183-203`.

### Shellcheck delta — cosmetic, not a masked defect

- `lock.sh`: 0 diagnostics, 0 errors.
- `eventlog.sh`: 2 diagnostics versus baseline 1. New:
  `eventlog.sh:49` SC1091 for dynamically sourced `lock.sh`.
- `nats-bridge.sh`: 8 diagnostics versus baseline 7. New:
  `nats-bridge.sh:33` SC1091 for dynamically sourced `lock.sh`.
- `wt-new.sh`: 3 diagnostics versus baseline 2. New:
  `wt-new.sh:23` SC1091 for dynamically sourced `lib/lock.sh`.

All three additions are cosmetic source-following notes: each script resolves
the helper relative to `BASH_SOURCE`, but ShellCheck cannot follow the variable
path. `shellcheck -S error -x` returns 0 for all four files. These warnings do
not mask F1-F3, which are behavioral/contract defects.

## Verification

- Criteria read from
  `openspec/changes/lock-primitive-hardening/specs/locking/spec.md`.
- D5 applied from commit `1e00795`: the unavailable on-host Git-Bash run is not
  treated as a defect; its retained temporary-pin, refusal, and empty-register
  obligations remain in scope.
- Fresh merged-tree L1/L2 scratch harness: **68 passed, 0 failed, exit 0**.
  It covers all six refusal codes, ordered guard behavior, the flat/no-ordering
  rule, one refusal shape, fail-closed defaults, FD 3 preservation, caller and
  command trap preservation, and inherited-state NESTED prevention.
- Harness fault injection: **68 passed, 1 intentionally failed, exit 1**.
  This confirms printed failures cannot exit success.
- The retained L3 scratch output cannot be treated as fresh integration
  evidence because its script was not retained and it reports
  `HARNESS_USING_RECLAIM_DOUBLE=1`; its important merged assertions were
  rechecked directly. F1 and F2 are the integration cases that the branch
  doubles did not model.
- Shellcheck counts and zero-error gate were run fresh as listed above.
- Merge-only review found no conflict-resolution loss. `git diff --check`
  reports one extra blank line at `durable-lanes.md:204`; this is cosmetic and
  does not affect the verdict.
