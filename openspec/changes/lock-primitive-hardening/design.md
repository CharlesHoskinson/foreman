# Design — lock-primitive-hardening

## The defect, precisely

uutils `mkdir` performs a userspace existence check and only then creates.
GNU `mkdir` issues `mkdir(2)` and lets the kernel return `EEXIST`. POSIX
guarantees atomicity of the syscall, not of a check-then-act around it, so a
lock built on the former has a window between `statx` and create in which a
second process also observes "absent" and proceeds.

Traced on the reference box:

```
uutils:  statx(AT_FDCWD, ".../x", ...) = 0
         mkdir: /tmp/.../x: File exists
GNU:     mkdir(".../x", 0777) = -1 EEXIST (File exists)
```

Note the failure is invisible to a naive test. `mkdir x; mkdir x` reports
"File exists" and exits 1 under both implementations — the difference only
appears under contention, which is why this survived to now.

## Why flock, and why not just pin GNU

Three options were considered.

**Pin GNU coreutils** (call `gnumkdir`, or prepend a GNU path). Rejected: it
makes correctness depend on a distro-specific binary name that exists on
Ubuntu 26.04 and nowhere else, and it leaves the primitive one packaging
decision away from breaking again. It also does nothing for the next uutils
migration — Ubuntu is moving toward uutils as the default, so the hazard
grows rather than shrinks.

**Harden the mkdir mutex** (e.g. write a uniquely-named marker inside the
directory and verify ownership after acquisition). Rejected as the primary
mechanism: it is a real technique, but it adds a second round-trip to the hot
emit path for every lane on every emit, to defend a primitive we would rather
not be using where a better one exists.

**Use `flock` where available** — chosen. It is a kernel-arbitrated advisory
lock with no check-then-act, it is already a `required = true` tool for the
`hard` and `full` profiles in `env/reference-manifest.toml`, and it is already
the mechanism `lib/worktree.sh:154` and `scripts/task-new.sh:26` use. The
event log is the odd one out, not the trailblazer.

The `mkdir` fallback is retained solely for MSYS2 / Git-Bash, where `flock`
genuinely does not exist and where the original "atomic on Git Bash" claim
still holds (MSYS2 ships its own coreutils, not uutils). The fallback is
gated behind the atomicity probe so that the claim is checked rather than
trusted.

## Stale-lock semantics differ, and that matters

`flock` releases on process death; a `mkdir` lock does not. `el_init`
currently reclaims leftover `.seq.lock` and `.attempt.lock` directories
(`eventlog.sh:52-57`) precisely because a crashed lane leaves them behind.

The migration must not delete that reclamation — it is still correct for the
fallback path — but it must also not treat it as necessary on the `flock`
path, where a stale lock cannot exist. The helper therefore exposes the
mechanism in use so `el_init` can reclaim conditionally rather than
unconditionally.

This is the one place the change is not purely mechanical, and it is where a
reviewer should look hardest.

## The probe must be deterministic

An atomicity probe that samples contention (run N racers, count violations)
is itself flaky: a correct implementation can pass a bad probe by luck, and a
loaded box can fail a good one. The probe therefore asserts on *mechanism*,
not outcome — that creating an existing directory issues `mkdir(2)` and
surfaces `EEXIST`.

Where `strace` is unavailable, the probe degrades to a flavour check
(`mkdir --version` matching a known-bad implementation) plus the contention
sample as corroboration, and reports the weaker evidence honestly rather than
claiming a verdict it did not earn.

## Ordering

This package lands before the graph-plane packages. The graph plane is
specified around concurrent publication from many lanes and will inherit
whatever locking discipline exists when it is written. Building it on a
primitive known to be broken would bake the defect in one layer deeper.

It also lands before, or alongside, the multi-vendor packages: adding a
fourth vendor raises lane concurrency, which is exactly the pressure that
makes this defect bite.

## Risks

- **The migration is in the hot path.** `el_emit` is called on every event by
  every lane. A regression here degrades everything. Mitigation: the helper
  keeps `el_emit`'s existing signature and critical-section shape untouched;
  only the acquire/release calls change.
- **`flock` on a network or `/mnt` filesystem** has weaker guarantees. This is
  already covered by the `wsl-preflight` package's `FOREMAN_HOME`-not-under-
  `/mnt` refusal, and the two packages should be read together.
- **The fallback path loses test coverage** on a Linux CI box, because CI will
  always take the `flock` branch. The suite must exercise the fallback
  explicitly by forcing the mechanism, not by hoping for a host without
  `flock`.

## The replacement was measured, not assumed

Before specifying `flock` as the primary mechanism it was probed on every
filesystem a lane can realistically use, with the same 8-racer
release-contention harness that exposed the `mkdir` defect (2026-07-28,
reference box, Ubuntu 26.04 under WSL2):

| filesystem | context | violations |
|---|---|---|
| ext4 (`/root/.foreman`) | where `FOREMAN_HOME` lives | **0** / 10 rounds |
| tmpfs (`/tmp`) | where the bats suite runs | **0** / 10 rounds |
| drvfs (`/mnt/c`) | the case `wsl-preflight` refuses | **0** / 5 rounds |

All eight acquirers completed in every round — the lock serialises without
starving anyone. Note the drvfs result is included for completeness only: the
`wsl-preflight` package refuses a `FOREMAN_HOME` under `/mnt/*` for fsync
reasons that are unrelated to locking, and that refusal stands regardless of
this measurement.

For comparison, on the identical harness the current primitive scored 57
violations across 15 rounds. The change is from a primitive that demonstrably
fails to one that demonstrably does not, on this host.

Scope of the claim: this is one host and one kernel. It is evidence that
`flock` is correct here, not a proof that it is correct everywhere — which is
why the atomicity probe in `tool-check.sh` reports what it finds on each host
rather than asserting a universal guarantee.

## Formal verification, 2026-07-28: a race the primitive swap does not fix

`formal/specs/eventlog_concurrency.qnt` models the event log, the worktree
index, the NATS bridge lock, and the queue. Verified with Apalache 0.56.1 on
the host plus randomized simulation; see `formal/reports/M2-concurrency.md`
and `formal/reports/VERIFY-quint-architect.md`.

### The primitive swap is confirmed sound -- and insufficient

The model reproduces the measured defect independently: `toctou /
mutual_exclusion` and `toctou / seq_uniqueness` both VIOLATED, with the
counterexample state exactly the observed failure (`seqHolders: Set(0, 1)`,
`phase: Map(0 -> InCompact, 1 -> InSeq)`). Under `atomic`, both hold --
`mutual_exclusion` showed no violation within 8 steps (385.8 s of Apalache),
which is bounded satisfaction, not proof. The model also derives a consequence
the 8-racer harness did not measure directly: duplicate sequence numbers, the
failure mode that would corrupt crash recovery and replay.

That is corroboration of the remedy this package already specifies. The
problem is what the remedy does not reach.

| module | step | invariant | steps | result |
|---|---|---|---|---|
| `index_fail_open_atomic` | `index_step` | `mutual_exclusion` | 8 | **counterexample** (7.7 s) |
| `index_fail_open_atomic` | `index_step` | `no_lost_index_entry` | 12 | **counterexample** (61.9 s) |
| `nested_atomic` | `event_step` | `no_deadlock` | 5 | counterexample (54.0 s) |
| `nats_toctou` | `nats_step` | `nats_owner_token_sound` | 10 | **counterexample** (10.7 s) |

`index_fail_open_atomic` is the important row. It configures an **atomic**
test-and-set -- the fix this package specifies -- and adds `wt-new.sh`'s
bounded spin with its fail-open timeout. Mutual exclusion still breaks at 8
steps.

### Why fail-open is a policy defect, not a primitive defect

`wt-new.sh:203` logs `"WARN: index.json lock contention exceeded 30s --
proceeding unsynchronized"` and then enters the index critical section without
the lock. No lock primitive can defend a critical section a caller chose to
enter without acquiring it. This package replaces the *mechanism*; the fail-open
branch is *policy*, so the worst-behaved call site in the codebase was outside
the change's scope as originally written.

The per-PID temporary file name makes the consequence specifically nasty. With
a shared tmp name the failure would be a torn write -- visible, loud, probably
caught. With a per-PID name each racer writes a complete, well-formed
`index.json`; the loser's rename simply wins last, and a lane **disappears from
the index with no error anywhere**. That is `no_lost_index_entry` violated at
12 steps, and it is the difference between a bug that reports itself and one
that does not.

Hence the new requirement: a bounded spin that gives up refuses. There is no
third option. A caller that genuinely cannot tolerate a refusal raises its
timeout -- which is a decision someone makes explicitly, not a default the
codebase makes silently at 30 seconds.

### The compaction race, and the patch that does not work

`el_compact` can overwrite `events.jsonl` with a snapshot taken before a
concurrent `el_emit` append (`locking / no_lost_structural_event`, violated
under `toctou`). The event log is this release's definition of lane completion,
so a silently dropped committed event is a correctness defect in the mechanism
`round-ownership-default` depends on.

M2 states plainly that a **unique compaction temporary file name does not fix
it**, and that is worth recording because it is the first patch a reader will
reach for. The hazard is the read-modify-write spanning a concurrent append.
The snapshot and the write-back must be one serialized section with respect to
appends, or compaction must abandon its write.

### The NATS lock has no way back

Two independent problems, both verified in code:

1. **No reclamation path.** `el_init` reclaims `.seq.lock` (`eventlog.sh:52`)
   and `.attempt.lock` (`:57`). It does not reclaim `.nats-bridge.lock`. A
   crash wedges that lock permanently.
2. **Token inversion.** Under check-then-act both racers "acquire" and both
   write `$lock/owner`, so the loser's token lands on disk. The true holder can
   no longer release; the non-holder can.

Together these are a lock that can be neither released by its owner nor
recovered by the next run.

### Lock ordering: today's code is clean, and the point is to keep it so

M2's audit of the call graph found no nesting: `el_emit` takes only
`.seq.lock`, `el_attempt_new` only `.attempt.lock`, `el_compact` reuses
`.seq.lock` and calls only read-only `el_read` inside it, and `lane-run.sh`
calls them sequentially. A deliberately-nesting configuration deadlocks at 5
steps. The discipline is therefore recorded as a requirement rather than left
as a property that happens to hold: no nesting; if both are ever required,
`.seq.lock` first, `.attempt.lock` second, release in reverse.

### Standing limits of this evidence

Six results are symbolic (Apalache, bounded depths above). The remainder --
`seq_uniqueness`, `no_lost_attempt`, `no_lost_structural_event`,
`no_lost_index_entry` at higher depths -- are randomized simulation only, at
the sample counts recorded in `M2-concurrency.md`. `atomic /
mutual_exclusion` clean at 8 steps is bounded satisfaction; Apalache itself
prints "You may increase --max-steps". Re-run with:

```
quint verify formal/specs/eventlog_concurrency.qnt --main=<module> \
  --step=<step> --invariant=<invariant> --max-steps=<N> \
  --apalache-version=0.56.1
```

M2 also self-reported that its **first Apalache run returned a vacuous "safe"**
because it passed `--step=event_step` for actions that live in `index_step`.
Always confirm the step function matches the module under test before citing a
clean result.
