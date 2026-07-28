# M2 — Foreman event-log concurrency

> **Bounded symbolic model checking could not run inside the model agent's
> sandbox, but WAS run by the orchestrator on the host.** Quint 0.32.0 starts
> Apalache 0.56.1 as a local gRPC server and the codex sandbox forbids that
> socket, so every result the model agent itself executed (sections 3-8) is
> randomized simulation. The orchestrator then ran Apalache 0.56.1 on the WSL
> host against this exact spec: **six of the report's counterexamples are
> confirmed by bounded symbolic model checking**, including the check-then-act
> mutual-exclusion violation, the opposite-order nesting deadlock, the
> `wt-new.sh` fail-open violation, and the NATS owner-token inversion; and
> `atomic` / `mutual_exclusion` was shown to have **no** violating execution
> within 8 transitions. Full table, bounds, wall times and caveats in
> **section 10**. Bounded satisfaction is not a proof.

## 1. What is modelled and how to run the checks

The model has two processes. Besides the round-1 `el_emit`,
`el_attempt_new`, `el_compact`, and queue transitions, round 2 adds an
isolated `wt-new.sh` index scheduler and an isolated NATS bridge scheduler.
Index state records bounded retries, actual lock ownership, all processes
inside the critical section, each process's private snapshot/temp, the
durable index, and committed entries. NATS state records the directory's
true creator, apparent takers, the on-disk owner token, per-process in-memory
tokens, release denial/non-holder release, and a crash before owner recording.

The lock primitive is selected by `ATOMIC_LOCK`. In `atomic`, observing a
free lock and taking it is one action. In `toctou`, `toctou_check_*` records a
successful observation and `toctou_create_*` takes the lock later without
rechecking. Two processes can therefore both pass the check before either
create. A busy check/acquire takes the loser spin path, increments a bounded
retry counter, and retries; the model uses 2 retries instead of the shell's
1500.

The named modules are:

- `toctou`: split check/create, production-shaped non-nesting calls.
- `atomic`: atomic test-and-set, production-shaped non-nesting calls.
- `nested_atomic`: atomic test-and-set plus deliberately enabled opposite
  lock ordering.
- `index_fail_open_atomic`: atomic test-and-set plus `wt-new.sh`'s bounded
  wait followed by unowned entry into the index critical section.
- `nats_atomic`: NATS take/record-owner split with atomic test-and-set.
- `nats_toctou`: the same NATS split under check-then-act mkdir.

`event_step`, `index_step`, `nats_step`, and `queue_step` isolate their
subsystems for readable traces. The default `step` explores all four.

Source confirmation:

- `eventlog.sh:75-131` spins on `.seq.lock`, builds JSON, writes/renames
  `.seq.tmp`, appends, and unconditionally `rmdir`s the lock. Lines 81-84 and
  118-127 say gaps are acceptable, duplicates are not: jq failure writes
  nothing; append failure after reserve creates a gap.
- `eventlog.sh:212-242` uses the distinct sibling `.attempt.lock`, the same
  spin/timeout/release discipline, and the shared `$f.tmp` pathname.
- `eventlog.sh:332-426` holds `.seq.lock` over compaction's whole
  read/transform/validate/rename operation and preserves the original on
  every failure.
- `eventlog.sh:45-58` reclaims `.seq.lock` and `.attempt.lock` only during
  single-threaded initialization. Lines 68-74 reject in-band stale reclaim
  because check-then-rmdir has an ABA race.
- `wt-new.sh:191-251` retries `.index.lock` for about 30 seconds, then logs
  that it is proceeding unsynchronized. Its ownership bit remains zero, so
  its EXIT trap correctly cannot remove another process's lock. Both jq and
  Python paths use a per-process-unique temp filename before replacing the
  shared `index.json`.
- `nats-bridge.sh:79-94,140-193` takes `.nats-bridge.lock`, then records a
  random owner token in a second operation. Release is a silent no-op unless
  disk and memory tokens match. TERM is deferred across the gap and an owner
  write failure immediately removes the just-created directory, but a hard
  crash between the two steps cannot run either cleanup path.
- `eventlog.sh:50-58` does **not** reclaim `.nats-bridge.lock`: its only
  `rmdir` targets are `.seq.lock` and `.attempt.lock`. The NATS source says
  stale recovery is a separate explicit manual operation.
- The executable queue loop is `grok:3 codex:2 claude:3 misc:2 gate:1`
  (`lane-queue.sh:415-424`). The older comment at lines 372-383 still says
  grok/codex are 1; the loop is authoritative.
- `F-uutils-mkdir-blocker.md:35-49` records uutils' userspace `statx` check
  versus GNU's direct `mkdir(2)`/`EEXIST`; lines 68-73 record the
  `mv: cannot stat '...attempt.tmp'` failure.

Copy-pasteable commands:

```bash
SPEC=/root/foreman/formal/specs/eventlog_concurrency.qnt

quint typecheck "$SPEC"

# Known TOCTOU safety failures
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=mutual_exclusion --max-steps=20 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=seq_uniqueness --max-steps=25 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=no_lost_attempt --max-steps=25 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=rename_failure_witness --max-steps=25 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=no_lost_structural_event --max-steps=25 --max-samples=5000 \
  --backend=rust --verbosity=1

# Production-shaped deadlock check
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=no_deadlock --max-steps=40 --max-samples=10000 \
  --backend=rust --verbosity=1

# Atomic safety and queue admission
quint run "$SPEC" --main=atomic --step=event_step \
  --invariants mutual_exclusion seq_uniqueness no_lost_attempt \
    no_deadlock no_lost_structural_event \
  --max-steps=40 --max-samples=10000 --backend=rust --verbosity=1
quint run "$SPEC" --main=atomic --step=event_step \
  --invariant=rename_failure_witness \
  --max-steps=40 --max-samples=10000 --backend=rust --verbosity=1
quint run "$SPEC" --main=atomic --step=queue_step \
  --invariant=queue_caps_respected \
  --max-steps=40 --max-samples=10000 --backend=rust --verbosity=1

# Witnesses: exit 1 / VIOLATED is the expected good result
quint run "$SPEC" --main=atomic --step=event_step \
  --invariant=progress_witness --max-steps=30 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=nested_atomic --step=event_step \
  --invariant=no_deadlock --max-steps=12 --max-samples=5000 \
  --backend=rust --verbosity=1

# Atomic primitive plus wt-new fail-open timeout
quint run "$SPEC" --main=index_fail_open_atomic --step=index_step \
  --invariant=mutual_exclusion --max-steps=20 --max-samples=10000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=index_fail_open_atomic --step=index_step \
  --invariant=no_lost_index_entry --max-steps=24 --max-samples=20000 \
  --backend=rust --verbosity=1

# NATS crash window and check-then-act token inversion
quint run "$SPEC" --main=nats_atomic --step=nats_step \
  --invariant=nats_lock_recoverable --max-steps=12 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=nats_atomic --step=nats_step \
  --invariant=no_deadlock --max-steps=12 --max-samples=5000 \
  --backend=rust --verbosity=1
quint run "$SPEC" --main=nats_toctou --step=nats_step \
  --invariant=nats_token_inversion_witness \
  --max-steps=20 --max-samples=100000 --backend=rust --verbosity=1

# Full reproducible sequence counterexample
quint run "$SPEC" --main=toctou --step=event_step \
  --invariant=seq_uniqueness --max-steps=25 --max-samples=5000 \
  --backend=rust --verbosity=3 --seed=0xaee02b888944c811
```

Observed typecheck output (Quint emits nothing on success):

```text
$ quint typecheck /root/foreman/formal/specs/eventlog_concurrency.qnt
[no output]
exit 0
```

## 2. Invariants in plain English

`mutual_exclusion` says every modelled lock's ghost-holder/taker set contains
at most one process: seq, attempt, index, and NATS. A lock directory itself is
only one Boolean; ghost sets make both check-then-act and fail-open overlap
observable instead of letting the second entrant overwrite the first owner.

`seq_uniqueness` says that if two logged event identities carry the same
sequence number, they must be the same event. It does not demand consecutive
numbers. An append failure can reserve 7 and leave the next successful event
at 8; that gap is legal. Two different events both carrying 7 is illegal.

`no_lost_attempt` says the durable counter value must account for every
successfully completed allocation. With two one-shot callers, two successful
results require the counter to be at least 2. Thus two callers both returning
attempt 1 while disk still says 1 violates it. A failed `mv` is separately
recorded as an explicit failed call, not mislabeled as a completed allocation.

`no_deadlock` says either both calls have terminated or at least one process
has an enabled state-changing event-log action. Merely incrementing a wait
counter is not productive. This exposes the circular wait in the artificial
opposite-order nesting module while accepting normal completed executions.

`progress_witness` is the negation of “a process that previously lost/spun
later acquired.” It is intentionally checked as an invariant and expected to
be **violated**. A violation is a reachability witness, not a fairness proof:
the scheduler can produce progress, but the model does not prove every
waiting process eventually progresses.

The extra `no_lost_structural_event` property says compaction never removes a
structural event that was appended. `no_lost_index_entry` says every index
entry whose unique-temp rename completed remains in the durable index; it
therefore detects last-writer-wins stale-snapshot loss without relying on a
torn write or shared temp name.

`nats_owner_token_sound` says the token on disk is absent or belongs to the
process that truly created the lock directory. `nats_release_authority` says
no non-holder has removed that directory. `nats_lock_recoverable` says every
present NATS lock has either a live process still able to record ownership or
a live process whose memory token matches disk. `nats_token_inversion_witness`
is a negated reachability goal: VIOLATED means one execution denied the true
holder's release and allowed the non-holder's release.

`queue_caps_respected` checks the actual lower and upper bounds—grok 0–3,
codex 0–2, claude 0–3, misc 0–2, and gate 0–1—rather than a placeholder
non-negativity condition. `rename_failure_witness` is another negated
reachability goal: its violation demonstrates that one process can consume
the shared temp file before the other process's `mv`. There are no
vacuously-true placeholder invariants in the model.

## 3. Method, honestly

The model agent used Quint's Rust randomized simulator. “No violation found”
means only that the sampled executions did not contain one. The orchestrator
used Apalache separately for one property. Complete per-invariant coverage is:

| Invariant | Configuration and outcome | Method and bound |
|---|---|---|
| `mutual_exclusion` | TOCTOU, index fail-open, and NATS TOCTOU violated; atomic event/NATS sampled clean | Apalache host run: TOCTOU violated, `--max-steps=12`. Simulation: TOCTOU 5,000 × 20; index 10,000 × 20; NATS TOCTOU 5,000 × 12; atomic event 10,000 × 40; atomic NATS 10,000 × 20 |
| `seq_uniqueness` | TOCTOU violated; atomic sampled clean | Simulation only: 5,000 × 25 and 10,000 × 40 |
| `no_lost_attempt` | TOCTOU violated; atomic sampled clean | Simulation only: 5,000 × 25 and 10,000 × 40 |
| `no_deadlock` | production TOCTOU/atomic and index sampled clean; nested locks and NATS crash violated | Simulation only: event TOCTOU/atomic 10,000 × 40; nesting 5,000 × 12; index 10,000 × 30; NATS atomic 5,000 × 12 |
| `progress_witness` | reachable in atomic event and clean atomic NATS executions | Simulation only: 5,000 × 30 and 10,000 × 16; VIOLATED is the expected witness |
| `no_lost_structural_event` | TOCTOU violated; atomic sampled clean | Simulation only: 5,000 × 25 and 10,000 × 40 |
| `no_lost_index_entry` | atomic mkdir plus fail-open timeout violated | Simulation only: 20,000 × 24 |
| `nats_owner_token_sound` | NATS TOCTOU violated; NATS atomic sampled clean | Simulation only: 10,000 × 14 and 10,000 × 20 |
| `nats_release_authority` | NATS TOCTOU violated; NATS atomic sampled clean | Simulation only: 20,000 × 18 and 10,000 × 20 |
| `nats_token_inversion_witness` | true-holder denial plus non-holder release reachable | Simulation only: 100,000 × 20; VIOLATED is the expected witness |
| `nats_lock_recoverable` | atomic pre-owner crash violated | Simulation only: 5,000 × 12 |
| `queue_caps_respected` | sampled clean | Simulation only: 10,000 × 40 |
| `rename_failure_witness` | TOCTOU missing-temp state reachable; atomic sampled clean | Simulation only: 5,000 × 25 and 10,000 × 40; VIOLATED is the expected witness |

The host-side command and result reported by the orchestrator were:

```text
$ quint verify specs/eventlog_concurrency.qnt --main=toctou \
    --invariant=mutual_exclusion --max-steps=12
[violation] Found an issue (22127ms) / error: found a counterexample
final state: phase = Map(0 -> InSeq, 1 -> InSeq),
             seqHolders = Set(0, 1), seqLockExists = true
```

Thus bounded symbolic checking independently reproduces the TOCTOU
mutual-exclusion violation. No other invariant has an Apalache result in this
report.

Inside the model agent's sandbox, bounded checking could not even start. This
real command and failure are retained as an environment caveat:

```text
$ JAVA_TOOL_OPTIONS='-Djava.net.preferIPv4Stack=true -Dio.netty.machineId=02:00:00:00:00:01 -Dio.netty.processId=1' \
  quint verify /root/foreman/formal/specs/eventlog_concurrency.qnt \
  --main=toctou --step=event_step --invariant=mutual_exclusion \
  --max-steps=6 --apalache-version=0.56.1 \
  --server-endpoint=127.0.0.1:8822 --verbosity=3
Picked up JAVA_TOOL_OPTIONS: ...
# APALACHE version: 0.56.1 | build: 70cdaf4
Starting checker server on port 8822...
Error while starting Apalache server:
java.lang.IllegalStateException: channel not registered to an event loop
...
exit 1
```

Without the JVM workaround, the underlying diagnostic was:

```text
java.net.SocketException: Operation not permitted (Socket creation failed)
...
Failed to find the loopback interface
```

The standalone `apalache-mc check` process runs in the sandbox, but it cannot
consume Quint's intermediate JSON; Quint performs the Quint-to-TLA translation
through that same gRPC service. This is a sandbox limitation, not a host
limitation. Nothing here claims that any invariant was symbolically
satisfied; the one host result is a bounded counterexample only.

## 4. The check-then-act counterexample

Randomized search output:

```text
$ quint run "$SPEC" --main=toctou --step=event_step \
    --invariant=mutual_exclusion --max-steps=20 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (46ms at 1739 traces/second).
Use --seed=0x6a3f1687eab70d9f --backend=rust to reproduce.
error: Invariant violated
exit 1

$ quint run "$SPEC" --main=toctou --step=event_step \
    --invariant=seq_uniqueness --max-steps=25 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (265ms at 14951 traces/second).
Use --seed=0x1539cc643b47ef32 --backend=rust to reproduce.
error: Invariant violated
exit 1
```

The following is the full transition projection of the actual verbosity-3
trace from seed `0xaee02b888944c811`. Every transition is included; fields
that remain unchanged are omitted:

```text
S0  init
    phase={0:Idle,1:Idle}, seqDisk=0, seqLockExists=false,
    seqHolders={}, eventLog={}
S1  choose_emit(0)
    phase={0:WantSeq,1:Idle}
S2  toctou_check_seq(0)
    phase={0:CheckedSeq,1:Idle}
S3  choose_emit(1)
    phase={0:CheckedSeq,1:WantSeq}
S4  toctou_check_seq(1)
    phase={0:CheckedSeq,1:CheckedSeq}
S5  toctou_create_seq(0)
    phase={0:InSeq,1:CheckedSeq}, seqLockExists=true, seqHolders={0}
S6  toctou_create_seq(1)
    phase={0:InSeq,1:InSeq}, seqHolders={0,1}
    mutual_exclusion is already false
S7  seq_read(0)
    seqLocal={0:1,1:0}, phase={0:SeqRead,1:InSeq}
S8  seq_read(1)
    seqLocal={0:1,1:1}, phase={0:SeqRead,1:SeqRead}
S9  seq_build_json(0)
    phase={0:SeqBuilt,1:SeqRead}
S10 seq_build_json(1)
    phase={0:SeqBuilt,1:SeqBuilt}
S11 seq_write_tmp(1)
    tmp=(present=true,value=1,writer=1)
S12 seq_rename_tmp(1)
    seqDisk=1, tmp.present=false, phase[1]=SeqReserved
S13 seq_append(1)
    eventLog={(1,1)}
S14 seq_write_tmp(0)
    tmp=(present=true,value=1,writer=0)
S15 seq_rename_tmp(0)
    seqDisk=1, tmp.present=false, phase[0]=SeqReserved
S16 seq_append(0)
    eventLog={(0,1),(1,1)}
    seq_uniqueness is false: two distinct events have sequence 1
```

S2 and S4 correspond to both uutils processes completing their userspace
`statx` “absent” checks. S5 and S6 are the separated create phase; the second
entrant does not receive an atomic kernel `EEXIST`, which is exactly the
measured distinction from GNU mkdir. S7/S8 are both shell processes reading
the same `.seq=0`. S11-S16 show the shared temp/rename protocol cannot repair
an already-broken mutex: both persist and append candidate 1.

The observed `mv: cannot stat` signature is a different scheduling of the
same shared-name interference. Its complete projected trace, from seed
`0x2ed678bd2af44949`, is:

```text
S0  init
S1  choose_attempt(1)
S2  choose_attempt(0)
S3  toctou_check_attempt(1)       # statx observes absent
S4  toctou_check_attempt(0)       # statx also observes absent
S5  toctou_create_attempt(0)      # holders={0}
S6  toctou_create_attempt(1)      # holders={0,1}
S7  attempt_read(1)               # local[1]=1
S8  attempt_write_tmp(1)          # tmp present, writer=1
S9  attempt_read(0)               # local[0]=1
S10 attempt_write_tmp(0)          # clobbers shared tmp, writer=0
S11 attempt_rename_tmp(0)         # consumes tmp; disk=1
S12 release_attempt(0)            # completed={(0,1)}, lock dir removed
S13 attempt_rename_missing(1)     # tmp absent; renameFailures={(1,1)}
```

S10 is one process overwriting the other process's fixed `$f.tmp`; S11 moves
that single directory entry away; S13 is the exact model-level counterpart of
GNU `mv` reporting `cannot stat`. This is consistent with the measured 57
mutual-exclusion violations for 15 rounds × 8 uutils racers and zero for GNU
mkdir/flock. The model does not predict the number 57; it demonstrates the
pairwise interleaving that makes any positive count possible.

The completed-attempt invariant also fails when both renames occur one after
the other and both calls return 1:

```text
$ quint run "$SPEC" --main=toctou --step=event_step \
    --invariant=no_lost_attempt --max-steps=25 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (184ms at 7772 traces/second).
Use --seed=0x8d2af8324ddf25c --backend=rust to reproduce.
error: Invariant violated
exit 1
```

## 5. Confirmation the atomic primitive holds

Within the randomized bounds—not as a proof—the atomic configuration had no
violation across the five event-log safety invariants:

```text
$ quint run "$SPEC" --main=atomic --step=event_step \
    --invariants mutual_exclusion seq_uniqueness no_lost_attempt \
      no_deadlock no_lost_structural_event \
    --max-steps=40 --max-samples=10000 --backend=rust --verbosity=1
[ok] No violation found (964ms at 10373 traces/second).
Use --seed=0xb90fa5457f66fbd5 --backend=rust to reproduce.
exit 0

$ quint run "$SPEC" --main=atomic --step=event_step \
    --invariant=rename_failure_witness \
    --max-steps=40 --max-samples=10000 --backend=rust --verbosity=1
[ok] No violation found (762ms at 13123 traces/second).
Use --seed=0x4381c6dd284b9bda --backend=rust to reproduce.
exit 0

$ quint run "$SPEC" --main=atomic --step=queue_step \
    --invariant=queue_caps_respected \
    --max-steps=40 --max-samples=10000 --backend=rust --verbosity=1
[ok] No violation found (333ms at 30030 traces/second).
Use --seed=0x9e166d59dfc9adb3 --backend=rust to reproduce.
exit 0
```

The loser-progress witness was reachable:

```text
$ quint run "$SPEC" --main=atomic --step=event_step \
    --invariant=progress_witness --max-steps=30 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (48ms at 1958 traces/second).
Use --seed=0x7143d679d3c1907f --backend=rust to reproduce.
error: Invariant violated
exit 1
```

Here VIOLATED is the expected witness result: a loser spun and later
acquired. It does not establish starvation freedom under every schedule.

## 6. Lock-ordering analysis and discipline

Today's `eventlog.sh` does not hold both locks at once. `el_emit` takes only
`.seq.lock`; `el_attempt_new` takes only `.attempt.lock`; neither calls the
other. `el_compact` takes `.seq.lock` and calls only the read-only `el_read`
while holding it. Repository-wide call-site search shows `lane-run.sh`
invokes `el_attempt_new` and then, only after it returns, invokes `el_emit`.
There is no `el_compact` caller that nests attempt allocation. Today's code
therefore obeys a no-nesting discipline.

The artificial `nested_atomic` configuration permits one process to acquire
attempt then wait for seq while another acquires seq then waits for attempt.
After correcting and replay-testing the enabledness predicate, the real
circular-wait trace is:

```text
S0 init
S1 choose_nest_attempt_first(0)
S2 choose_nest_seq_first(1)
S3 nested_take_attempt_first(0)
   phase[0]=NeedSeq, attemptHolders={0}
S4 nested_take_seq_first(1)
   phase[1]=NeedAttempt, seqHolders={1}
   no_deadlock=false: each needs the lock held by the other
```

Executed result:

```text
$ quint run "$SPEC" --main=nested_atomic --step=event_step \
    --invariant=no_deadlock --max-steps=12 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (51ms at 7157 traces/second).
Use --seed=0xb95e808a6529690 --backend=rust to reproduce.
error: Invariant violated
exit 1
```

Discipline rule: **continue to avoid nesting. If a future operation genuinely
needs both locks, every path must acquire `.seq.lock` first and
`.attempt.lock` second, then release in reverse order. Never acquire
`.seq.lock` while holding `.attempt.lock`.** Today's code obeys the stronger
rule “never hold one while acquiring the other.”

The shell's bounded 1500-try loops would eventually return a timeout if a
future nested wrapper preserved those bounds and unwound correctly. That
limits wall-clock blocking, but it does not make opposite ordering safe:
during the circular wait no useful operation can proceed, and incorrect
error unwinding could leak a first lock. The model therefore classifies the
wait state as a productive deadlock rather than counting retry ticks as
progress.

## 7. Abstractions

- **Two processes, not eight.** Mutual exclusion and shared-temp corruption
  need only two contenders, so this cannot hide the bug class. It cannot
  predict the measured violation frequency.
- **Two retries, not 1500/300, and no wall-clock time.** The same bound
  abstracts eventlog's 1500 × 20 ms and index's 300 × 100 ms waits. It
  preserves exhaustion/entry interleavings but cannot establish real timeout
  duration or probabilistic starvation.
- **Integer identities and structured records.** Run/lane names, JSON,
  timestamps, and shell strings are opaque. They do not participate in lock
  atomicity, candidate arithmetic, or temp consumption, so this is safe for
  the hunted race. It does not verify input validation or JSON correctness.
- **One run and one lane counter.** The actual attempt lock is per run while
  counter files are per lane. Same-lane racers are the collision needed for
  the observed defect. Cross-lane contention and throughput are not assessed.
- **Atomic rename when the temp exists.** The model separates write and
  rename and faithfully permits clobber/consumption. It abstracts ENOSPC,
  filesystem durability, fsync, and crash consistency; those omissions may
  hide other persistence bugs, but not the known `cannot stat` interleaving.
- **Index temp files are process-local snapshots.** This intentionally gives
  `$IDX.tmp.$$` its strongest advertised behavior: no cross-process clobber or
  missing-temp failure. The shared rename target remains modelled, so stale
  read/modify/write snapshots can still cause a lost update.
- **Append is one atomic set insertion.** This retains event identity and
  sequence, so duplicates are visible and gaps remain legal. Torn writes,
  `PIPE_BUF`, physical ordering, and reader behavior are outside the model;
  this abstraction might hide malformed-tail bugs.
- **Jq is success or failure.** Failure exits before temp reserve; success
  produces the chosen integer. This preserves the ordering argument but does
  not model jq parsing details.
- **Compaction is identity on structural events.** The snapshot/validate/mv
  phases are separate, failures preserve the current log, and a successful
  rename installs the snapshot. This is safe for detecting a concurrent
  structural append being discarded. Heartbeat rollup contents, line order,
  and cursor shifts are omitted and may contain other issues.
- **One precise crash window.** Only a hard NATS crash after directory take
  and before owner recording is modelled. TERM deferral, owner-write failure
  cleanup, crashes after token recording, filesystem durability, and manual
  stale-lock recovery are abstracted. This is enough to test whether that
  admitted interleaving has any automatic recovery path.
- **NATS tokens are process integers.** Unguessability and PID recycling are
  outside scope; only token identity, overwriting, matching, and release
  authority matter for the modelled race.
- **Bare release clears directory existence.** Holder sets are ghost state;
  any overlapping holder's `rmdir` can remove the single directory. This
  matches the ownership-free shell release and is conservative after a mutex
  failure.
- **Queue model assumes working pueue.** It checks only the configured counts.
  The script's explicit “pueue absent” foreground fallback bypasses queue caps
  and is not modeled. Consequently `queue_caps_respected` is not a claim
  about degraded mode or daemon failure, nor about queue fairness.
- **Deadlock is enabled productive progress, not temporal fairness.** This
  detects circular lock ordering but does not prove every waiter is scheduled.

## 8. Fail-closed vs fail-open

`eventlog.sh` is fail-closed. `el_emit` returns 1 after exhausting the
`.seq.lock` budget, and `el_attempt_new` likewise reports `lock timeout`;
neither enters its critical section. `wt-new.sh` is fail-open: after exhausting
the `.index.lock` budget it logs a warning and executes the shared
read/modify/write anyway. These choices are orthogonal to whether mkdir itself
is atomic.

- **`el_emit` / `el_attempt_new`:** retain fail-closed timeout behavior, and
  replace the vulnerable mkdir implementation with a proven atomic primitive.
- **`wt-new.sh` index update:** return nonzero on timeout and do not read or
  replace `index.json` without owning `.index.lock`.

`nb_bridge_once` also fails closed on contention (`return 5`) and on an owner
write failure (remove its just-created directory, then `return 1`). Preserve
those choices; the separate crash window needs explicit stale recovery or an
acquisition scheme whose ownership is atomic with taking the lock.

### Hazard A: atomic mkdir does not repair wt-new's fail-open timeout

Yes, `mutual_exclusion` is violable even with GNU/atomic mkdir. This projected
trace is from the actual full-verbosity simulation seed
`0x43227c9e37cb4672`:

```text
S0 init
   indexLockExists=false, indexHolders={}, owns={0:false,1:false}
S1 choose_index(1)
S2 atomic_take_index(1)
   indexLockExists=true, indexHolders={1}, owns[1]=true
S3 choose_index(0)
S4 spin_index(0)                 # retries[0]=1
S5 spin_index(0)                 # retries[0]=2 (abstract bound exhausted)
S6 timeout_index_fail_open(0)
   phase={0:InIndex,1:InIndex}, indexHolders={0,1},
   owns={0:false,1:true}
   mutual_exclusion=false
```

The primitive behaved perfectly: only process 1 acquired. The violation is
process 0 deliberately entering without acquisition. Process 0's ownership
bit remains false, faithfully modelling the guarded EXIT trap; it cannot
release process 1's directory, but that does not undo the overlapping
critical sections.

Randomized simulation:

```text
$ quint run "$SPEC" --main=index_fail_open_atomic --step=index_step \
    --invariant=mutual_exclusion --max-steps=20 --max-samples=10000 \
    --backend=rust --verbosity=1
[violation] Found an issue (43ms at 581 traces/second).
Use --seed=0x43227c9e37cb4672 --backend=rust to reproduce.
error: Invariant violated
exit 1
```

The per-process-unique temp name prevents one writer from consuming or
clobbering the other's temp. It does **not** preserve the read/modify/write
invariant after the lock is abandoned. This full fixed-seed projection shows
both unique-temp renames succeeding and a silent lost update:

```text
S0  init
S1  choose_index(1)
S2  choose_index(0)
S3  atomic_take_index(1)         # holder={1}, owns[1]=true
S4  spin_index(0)                # retries[0]=1
S5  spin_index(0)                # retries[0]=2
S6  index_read(1)                # local[1]={1}, from disk={}
S7  index_write_unique_tmp(1)    # private tmp for process 1
S8  timeout_index_fail_open(0)   # holders={0,1}, owns[0]=false
S9  index_read(0)                # local[0]={0}, also from stale disk={}
S10 index_write_unique_tmp(0)    # distinct private tmp for process 0
S11 index_rename_unique_tmp(0)   # disk={0}, committed={0}
S12 index_rename_unique_tmp(1)   # disk={1}, committed={0,1}
    no_lost_index_entry=false: entry 0 was silently dropped
```

There is no torn file and no `mv: cannot stat`: last writer wins with a valid
JSON index that silently omits another lane. Randomized simulation found it
with 20,000 samples of at most 24 steps:

```text
[violation] Found an issue (43ms at 1465 traces/second).
Use --seed=0x94bd4878f1149812 --backend=rust to reproduce.
error: Invariant violated
exit 1
```

### Hazard B: NATS take/record-owner window

With atomic mkdir, a hard crash can occur after the directory take but before
the owner write:

```text
S0 init
S1 choose_nats(1)
S2 atomic_take_nats(1)
   lock=true, trueHolder=1, takers={1}, ownerDisk=NONE
S3 nats_crash_before_owner(1)
   lock=true, takers={}, ownerDisk=NONE, phase[1]=NatsCrashed
   nats_lock_recoverable=false
S4 choose_nats(0)
S5 nats_observe_busy(0)
   waited[0]=true, phase[0]=WantNats
   no_deadlock=false
```

At S3 no live pre-record process remains and no memory/disk token pair exists,
so token-gated release has no possible caller. At S5 the only contender has
already observed the permanent lock; no state-changing acquisition or release
action remains. The clean atomic NATS model can violate `progress_witness`
(meaning a waiter later acquires), but from this crash state that witness is
unreachable: `acquiredAfterSpin` remains false because the orphan has no
release transition. This is enabled-progress analysis, not a temporal
fairness proof.

Randomized simulation results:

```text
$ quint run "$SPEC" --main=nats_atomic --step=nats_step \
    --invariant=nats_lock_recoverable --max-steps=12 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (44ms at 341 traces/second).
Use --seed=0xb04af3bd78d2bc7f --backend=rust to reproduce.
error: Invariant violated

$ quint run "$SPEC" --main=nats_atomic --step=nats_step \
    --invariant=no_deadlock --max-steps=12 --max-samples=5000 \
    --backend=rust --verbosity=1
[violation] Found an issue (50ms at 420 traces/second).
Use --seed=0xddea22c68be742d2 --backend=rust to reproduce.
error: Invariant violated
```

Under check-then-act mkdir, two processes can both finish the apparent take
and then race their owner writes. The following full fixed-seed projection
shows exactly the requested “loser's token on disk” case:

```text
S0  init
S1  choose_nats(0)
S2  choose_nats(1)
S3  toctou_check_nats(0)          # absent
S4  toctou_check_nats(1)          # absent
S5  toctou_create_nats(1)         # trueHolder=1, takers={1}
S6  toctou_create_nats(0)         # apparent loser; takers={0,1}
S7  nats_record_owner(1)          # mem[1]=2, ownerDisk=2
S8  nats_record_owner(0)          # mem[0]=1, ownerDisk=1 (loser wins write)
    nats_owner_token_sound=false
S9  nats_release_denied(1)        # true holder token 2 != disk token 1
    lock remains true, releaseDenied={1}
S10 nats_release_matching_owner(0)
    non-holder token matches; lock=false, unauthorizedReleases={0}
    nats_token_inversion_witness=false (expected reachability result)
```

So the answer is **yes**: the true holder can no longer release, while the
non-holder can. Token gating prevents arbitrary release, but once the
check-then-act primitive admits two “successful” acquirers, the second owner
write transfers release authority to whichever token happens to be last.

```text
$ quint run "$SPEC" --main=nats_toctou --step=nats_step \
    --invariant=nats_token_inversion_witness \
    --max-steps=20 --max-samples=100000 --backend=rust --verbosity=1
[violation] Found an issue (55ms at 8691 traces/second).
Use --seed=0xe9d5f41ed7e26073 --backend=rust to reproduce.
error: Invariant violated
exit 1
```

Finally, `el_init` does not cover this lock. Its complete reclaim body removes
only `$rd/.seq.lock` and `$rd/.attempt.lock`; `.nats-bridge.lock` appears
nowhere in `el_init`. The NATS library explicitly assigns its stale recovery
to a separate manual operation.

### Existing round-1 additional race: compaction

The model also exposes one consequence not listed in the measured finding:
`el_compact` can discard a concurrent structural append when uutils admits
both compaction and emit through `.seq.lock`.

The interleaving is: compactor checks the absent lock; emitter also checks;
both create/enter; compactor snapshots an empty log; emitter reserves seq 1
and appends event `(0,1)`; emitter releases and removes the lock directory;
compactor validates its old empty snapshot and renames it over
`events.jsonl`. The durable log becomes empty although `everAppended`
contains `(0,1)`.

Actual simulation output:

```text
$ quint run "$SPEC" --main=toctou --step=event_step \
    --invariant=no_lost_structural_event \
    --max-steps=25 --max-samples=5000 --backend=rust --verbosity=1
[violation] Found an issue (258ms at 16578 traces/second).
Use --seed=0x841a106c98c454aa --backend=rust to reproduce.
error: Invariant violated
exit 1
```

Affected function and consequence: `el_compact` can replace a log containing
a newly appended source-of-truth event with a snapshot taken before that
append, silently losing the event. Suggested fix: replace the vulnerable
primitive for `.seq.lock` with `flock` on WSL/Linux or a proven atomic GNU
mkdir path; retain one common serialization point for both emit and compact.
A unique compaction temp name alone would not fix the stale-snapshot overwrite.

No unrelated new race was inferred from the queue-count abstraction.

## 9. Limitations

The model agent executed only randomized simulation; all bounded symbolic
results were produced separately by the orchestrator and are tabulated in
section 10. Six counterexamples are symbolically confirmed, and one bounded
satisfaction result exists (`atomic` / `mutual_exclusion`, 8 steps). The
remaining `atomic` safety invariants (`seq_uniqueness`, `no_lost_attempt`,
`no_lost_structural_event`) were NOT symbolically checked and remain
simulation-only. Even an Apalache “no violation”
result would establish only bounded satisfaction in this finite abstraction,
not unbounded safety, shell/filesystem crash durability, scheduler fairness,
or behavior with more than two processes.

The NATS crash action represents a hard process death at the precise
mkdir-to-owner-write boundary. It does not claim that the source's TERM guard
or owner-write failure cleanup is broken; both paths are intentionally
different because code still runs. The model also does not evaluate the
manual stale-recovery procedure's operational reliability.

A follow-up could add a third process to show an overlapping holder's bare
event-log `rmdir` exposing a still-live critical section to a new entrant,
model pueue's degraded direct-spawn mode explicitly, and separately analyze
compaction versus line-number cursors. Those omissions do not remove any
two-process trace reported here.

## 10. Bounded symbolic (Apalache) results — orchestrator-run

Run by the Foreman M2 orchestrator on the WSL host, **outside** the codex
sandbox that blocked Apalache's local gRPC socket in sections 3 and 9.
Environment: Quint 0.32.0, Apalache 0.56.1 (`/root/.quint/apalache-dist-0.56.1`),
OpenJDK 21.0.11. Every run below is `quint verify`, i.e. **bounded symbolic
model checking**, not randomized simulation. All were run against the final
spec (`sha256` of the file as checked: recompute with `sha256sum` before
citing these numbers — the spec must not have changed since).

Command shape:

```bash
quint verify /root/foreman/formal/specs/eventlog_concurrency.qnt \
  --main=<MODULE> --step=<STEP> --invariant=<INV> --max-steps=<N>
```

| module | step | invariant | max-steps | outcome | wall time |
|---|---|---|---|---|---|
| `toctou` | `event_step` | `mutual_exclusion` | 8 | **counterexample found** | 27.7 s |
| `nested_atomic` | `event_step` | `no_deadlock` | 5 | **counterexample found** | 54.0 s |
| `index_fail_open_atomic` | `index_step` | `mutual_exclusion` | 8 | **counterexample found** | 7.7 s |
| `index_fail_open_atomic` | `index_step` | `no_lost_index_entry` | 12 | **counterexample found** | 61.9 s |
| `nats_toctou` | `nats_step` | `nats_owner_token_sound` | 10 | **counterexample found** | 10.7 s |
| `nats_atomic` | `nats_step` | `no_deadlock` | 8 | **counterexample found** | 21.4 s |
| `atomic` | `event_step` | `mutual_exclusion` | 8 | **no violation** | 385.8 s |

An earlier orchestrator run also found the `toctou` / `mutual_exclusion`
counterexample at `--max-steps=12` (22.1 s), with the violating final state
printed as:

```text
phase:          Map(0 -> InSeq, 1 -> InSeq)
seqHolders:     Set(0, 1)
seqLockExists:  true
seqDisk:        0
[violation] Found an issue (22127ms).
error: found a counterexample
```

Verbatim output of the one bounded-satisfaction result:

```text
$ quint verify specs/eventlog_concurrency.qnt --main=atomic \
    --step=event_step --invariant=mutual_exclusion --max-steps=8
[ok] No violation found (385777ms).
You may increase --max-steps.
exit 0
```

### What this establishes, and what it does not

- **Establishes.** The six counterexample rows are exhaustive existence
  results: within the stated transition bound Apalache *proved* a violating
  execution exists. These are not sampling artefacts. In particular, the two
  headline claims of this report — that check-then-act breaks mutual
  exclusion where atomic test-and-set does not, and that opposite-order
  nesting of `.seq.lock` / `.attempt.lock` deadlocks — are now backed by
  symbolic model checking, not only by randomized simulation.
- **Establishes (weakly).** `atomic` / `mutual_exclusion` has **no**
  violating execution within 8 transitions of this two-process abstraction.
  Apalache itself prints "You may increase --max-steps": this is bounded
  satisfaction, not a proof. It does not cover 9+ step executions, three or
  more contenders, crash/stale-lock states, or filesystem-level durability.
- **Does not establish.** Nothing here is a proof of unbounded safety, of
  fairness/starvation freedom, or of the real shell code — only of the
  model. The remaining `atomic` safety invariants (`seq_uniqueness`,
  `no_lost_attempt`, `no_lost_structural_event`) were **not** symbolically
  checked; at 385 s for a single 8-step invariant the sweep was cost-bound.
  They remain simulation-only results (section 5).

### Method caveat (honest)

Quint 0.32.0 drives a single shared Apalache server (port 8822). During this
sweep a sibling Foreman formal lane was verifying its own spec against the
same server, so the wall times above include contention and should be read as
upper bounds, not benchmarks. The pass/fail outcomes are unaffected.

One earlier orchestrator run reported "no counterexample" for
`index_fail_open_atomic` / `mutual_exclusion` because it was invoked with
`--step=event_step`; the fail-open index actions live in `index_step`, so the
relevant transitions were simply not in the step relation. The corrected run
is the one tabulated above. This is recorded because it is exactly the failure
mode a formal model is supposed to guard against: a vacuous "safe" result
produced by checking the wrong thing.
