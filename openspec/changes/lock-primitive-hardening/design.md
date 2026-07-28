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

## The probe must be deterministic, and its evidence is asymmetric

An atomicity probe that samples contention (run N racers, count violations)
is itself flaky: a correct implementation can pass a bad probe by luck, and a
loaded box can fail a good one. The probe therefore asserts on *mechanism*,
not outcome — that creating an existing directory issues `mkdir(2)` and
surfaces `EEXIST`.

Where no tracer is available the probe degrades to a flavour check
(`mkdir --version` matching a known-bad implementation) plus a contention
sample, and reports the weaker evidence honestly rather than claiming a verdict
it did not earn. What "honestly" means is now stated as a rule about which
evidence licenses which verdict, because the first round left it to prose and
the prose was read as "weaker evidence, same permission":

- `syscall` and `pinned-mechanism` may license `atomic` **or** `non-atomic`.
- `contention` may license `non-atomic` **only**. A single observed double-entry
  falsifies atomicity; a clean sample of any finite size is bounded satisfaction
  and demonstrates nothing, because a check-then-act `mkdir` that did not happen
  to lose the race produces an identical observation.
- `flavour` licenses no verdict at all and is recorded as corroboration.

Anything that cannot license `atomic` reports `unknown`, and `unknown` is
untrusted. The consequence for hosts with no tracer is worked through in
"What 'trusted' means" below; it is the finding the re-audit raised as N3 and it
is the reason this package now carries a pinned-mechanism evidence class.

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
- **`flock` on a network or `/mnt` filesystem** has weaker guarantees. The
  `wsl-preflight` package's `FOREMAN_HOME`-not-under-`/mnt` refusal covers one
  case, and the two packages should be read together, but it does not cover
  arbitrary NFS, CIFS, UNC or FUSE mounts. This package therefore carries the
  filesystem class in the verdict itself and refuses with
  `FM_LOCK_FS_UNSUPPORTED` on an uncovered class, rather than relying on a
  sibling package's path rule to keep locks off filesystems that cannot honour
  them.
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

## Wiring the fallback to the probe (RECONCILE R4)

The first draft of this package specified a `mkdir` atomicity probe in
`env/tool-check.sh` and a `mkdir` fallback in `lib/lock.sh`, and connected
nothing. The helper's mechanism selection was `flock` if present, `mkdir`
otherwise. That is the defect verbatim: a host can be reported NOT-READY by the
inventory and the helper will still hand out `mkdir` mutexes on the primitive
the inventory just condemned. A probe whose verdict nothing consumes is
documentation, not a control.

The wiring is deliberately boring:

**Where the verdict lives.** `${FOREMAN_TOOL_CHECK_JSON:-${HOME}/.foreman/last-tool-check.json}`
— the record `env/bootstrap-wsl.sh:411` already writes and
`references/reference-environment.md:50` already documents. No new artifact and
no new path convention. The probe row carries the absolute resolved `mkdir`
path, its version string, the verdict, the evidence class, and a UTC timestamp;
the last three are what make the verdict checkable rather than merely present.

**What "trusted" means, and why there are two classes rather than one.** The
first round said `atomic` on `syscall` evidence, full stop. That was correct
about strength and wrong about reachability, and the re-audit caught it: the
`mkdir` fallback exists **solely** for MSYS2 / Git-Bash, that host has no
`strace`, and a rule demanding host-produced syscall evidence therefore refuses
every acquisition there. The package's own scenario "Git-Bash falls back to the
`mkdir` mutex" became unsatisfiable. A probe that requires evidence the host
cannot produce is the same defect as a checker that cannot fail, and it was
introduced by the fix for a different instance of it.

The resolution starts by asking what evidence Git-Bash can actually produce, and
answering honestly:

| evidence | obtainable on Git-Bash? | what it can license |
|---|---|---|
| `strace` of `mkdir(2)` returning `EEXIST` | **no** — MSYS2/Git-Bash ships no tracer | `atomic` or `non-atomic` |
| N-racer contention sample | yes | **`non-atomic` only** |
| `mkdir --version` flavour string | yes | nothing on its own |
| SHA-256 of the resolved `mkdir` binary | yes (`sha256sum` is present) | identity, not behaviour |
| filesystem class of the lock directory | yes | scope of any verdict |

The first row is the whole problem and the second row is why it cannot be
patched over. **Contention evidence is asymmetric.** One observed double-entry
falsifies atomicity outright; a clean sample of any finite size is bounded
satisfaction and demonstrates nothing — a check-then-act `mkdir` that simply did
not lose the race produces exactly the same observation. This is the same
distinction `M2-concurrency.md` records for the Apalache runs, and it is why the
degraded flavour-plus-contention path can report `unknown` or `non-atomic` but
must never report `atomic`. Rows three to five are facts about identity and
environment, not about behaviour.

So atomicity **cannot** be established on Git-Bash by anything Git-Bash can run.
That is stated plainly rather than engineered around. What can be moved is
*where the syscall observation happens*: once, off-host, on a Foreman-controlled
MSYS2 host, with the trace committed as an artifact and keyed by the SHA-256 of
the binary it was taken against. The host's obligation then reduces to evidence
it demonstrably has — a digest and a filesystem class — and the fallback becomes
reachable without anyone claiming an unearned verdict.

Hence exactly two trusted evidence classes:

- **`syscall`** — a trace on *this* host observed the create issued to the kernel
  and the kernel returning `EEXIST` / `ERROR_ALREADY_EXISTS`. WSL and Linux.
- **`pinned-mechanism`** — the resolved primitive is byte-identical by SHA-256 to
  an entry in the pinned atomicity register in `env/reference-manifest.toml`;
  that entry cites a committed `syscall` trace taken on a Foreman-controlled host
  of the same class; and the lock path's filesystem class is one the entry names.
  MSYS2 / Git-Bash.

`flavour`, `contention`, an absent record, and a digest matching no entry are all
untrusted. The digest is load-bearing and the version string is not: a version
string is self-reported by the binary under test, and the F-uutils case is
precisely a binary whose behaviour did not match what its packaging implied.

**The cost, stated rather than hidden.** A digest pin is per Git-for-Windows
build, so a host running a build nobody has pinned gets a refusal. That is a
documented refusal with a named remedy — run the tracing probe on a controlled
host of that class, commit the trace, add the digest — and the spec requires the
release to state, per host class, whether durable lanes are available and on what
evidence. It is not a lockout, because non-durable lanes are unaffected and the
route back is written down. The alternative — accepting a version string — buys
back the coverage by giving up the property the whole package exists to defend.

**What "current" means.** Six conditions now, all of which must hold: same
absolute resolved path; same version string; **same SHA-256 digest**; the
verdict's covered filesystem classes **include the class the lock directory
resolves to now**; record timestamp not earlier than that binary's mtime; record
not more than 24 hours old. The first three catch the real failure mode on this
host — Ubuntu 26.04 ships a hybrid coreutils, and a `PATH` change or a package
upgrade can move `mkdir` between uutils and GNU. The digest also catches an
in-place rebuild that keeps the version string, which the mtime condition alone
would miss on a mtime-preserving copy.

**Filesystem identity, which the first round omitted.** The fourth condition is
new and it closes the axis that actually varies at lock time. `flock` on a
network or DrvFs mount has weaker guarantees — this design already conceded that
in its Risks section — and the round-1 record schema carried path, version,
verdict, evidence class and timestamp, with nothing about *where the lock lives*.
A verdict earned wherever `tool-check.sh` happened to run was therefore "trusted
and current" for a lock taken on drvfs, 9p, NFS or a UNC share. The classes are
distinguished at least as local fixed volume, `/mnt` DrvFs or other
Windows-hosted mount, network mount (NFS, CIFS/SMB, `//server/share`), and FUSE;
the class is computed for the directory that will contain the lock, not for
`FOREMAN_HOME` and not for `$PWD`; and a verdict is never inherited across
classes. For a WSL/Windows release this is the axis that matters.

**What happens when the record cannot be read.** One bounded local probe per
process, held in memory only, and a refusal if that probe cannot earn a trusted
verdict. The helper never writes the inventory record: `tool-check.sh` owns it,
and a second writer would make the staleness test meaningless, since the helper
would be validating its own timestamp.

## Six refusal causes, ordered so that they cannot overlap

The first round named four codes, asserted they were "ordered and disjoint", and
was wrong on both counts as well as incomplete. Three defects, all fixed here.

**It was not total.** There was no code for a mechanism that is *available but
unusable or unsafe*: `flock` present on a filesystem where advisory locking does
not coordinate the writers (a network mount, a DrvFs path), a lock path that
cannot be created or opened, a read-only filesystem, permission denial,
descriptor exhaustion, or `flock` returning `ENOLCK` / `EOPNOTSUPP`. In every one
of those states the helper would have selected `flock`, silently failed to lock,
and entered the critical section — the exact failure this package exists to
remove, reached by a different road. Two codes close it: `FM_LOCK_FS_UNSUPPORTED`
for *unsafe* and `FM_LOCK_UNAVAILABLE` for *unusable*, the latter declared the
residual class so the enum is total by construction.

**They were not disjoint.** With the record absent and the local probe returning
a definitive `non-atomic`, both `FM_LOCK_PROBE_UNTRUSTED` ("the probe cannot
return an `atomic` verdict") and `FM_LOCK_NO_ATOMIC_PRIMITIVE` ("`non-atomic` and
no `flock`") fired on identical state, and `tasks.md` T14 handed the choice to
the implementer in so many words. The guards are now complementary rather than
merely different: cause 3 requires a trusted verdict to be **present and
negative**, cause 4 requires **no** trusted verdict to be present. A definitive
`non-atomic` is a trusted negative, so it names cause 3 and cannot name cause 4.

**They were not uniform.** The one-shape invariant said "no lock is held … and
every file the lock protects is byte-identical", but `FM_LOCK_NESTED` arises *by
definition* while an outer lock is held and its critical section is mid-flight,
so one of the four causes could not satisfy the invariant meant to unify them.
The fix is to scope the invariant to the **refused acquisition** rather than to
the process: that acquisition holds no lock, enters no critical section, and
leaves the files *it* would have protected byte-identical. The outer lock stays
held by its owner, is released exactly once by its owner, and is explicitly
outside the invariant. Scoped that way the shape holds for all six causes at
once, which is what makes it testable rather than argued.

The evaluation order, first matching guard wins:

```
  request time      initialization                    engage            spin
  ------------      --------------                    ------            ----
  FM_LOCK_NESTED    FM_LOCK_FS_UNSUPPORTED            FM_LOCK_UNAVAILABLE
                    FM_LOCK_NO_ATOMIC_PRIMITIVE       (residual)        FM_LOCK_TIMEOUT
                    FM_LOCK_PROBE_UNTRUSTED
```

Trust is still decided once, before any acquisition is attempted, so a timeout
can only arise on a mechanism already selected, trusted and engaged, and a trust
refusal can never arise after a spin. There is no state in which the fail-open
requirement and the probe-trust requirement both apply and prescribe different
outcomes.

## Every predicate in this package, and the known-bad input it rejects

The standard this package applies to other people's checkers applies to its own.
Each predicate introduced or amended here is listed with a concrete input it is
demonstrated to reject — not a restatement of the rule.

| predicate | known-bad input it rejects |
|---|---|
| trusted verdict requires `syscall` or `pinned-mechanism` | the uutils 0.8.0 `mkdir` on Ubuntu 26.04, which traces `statx` then create; rejected on this host's own syscall evidence |
| `contention` cannot license `atomic` | a check-then-act `mkdir` that wins every round of an 8-racer sample on an idle box; the round-1 rule would have called it `unknown`, this rule refuses to let any caller promote it |
| digest, not version string | a `mkdir.exe` reporting `(GNU coreutils) 8.32` that is a rebuilt or shimmed binary; the version matches the register, the SHA-256 does not, and the fallback is refused |
| covered filesystem class | a `flock`-trusted host whose `FOREMAN_HOME` is a `//server/share` UNC path or a `/mnt/c` DrvFs path; the binary verdict is fine and the lock would still not coordinate, so `FM_LOCK_FS_UNSUPPORTED` fires before selection |
| `FM_LOCK_UNAVAILABLE` as residual | `flock` present, filesystem covered, lock path on a read-only mount so `open()` fails `EROFS`; round 1 had no code for this and would have proceeded |
| cause 3 vs cause 4 guards | the state that made round 1 ambiguous — record absent, local probe returns definitive `non-atomic`, no `flock` — now names `FM_LOCK_NO_ATOMIC_PRIMITIVE` only |
| refusal shape scoped to the acquisition | the nested case, where the process-wide phrasing was unsatisfiable; the outer lock is held and its files are mid-write, and the invariant no longer claims otherwise |
| platform-availability statement | a release that ships a host class whose only reachable outcome is refusal without naming it; the statement is what converts an unreachable scenario into a documented one |

The one predicate this package cannot demonstrate against a known-bad input on
the host that needs it is atomicity on Git-Bash itself, and that is stated as a
limit rather than papered over: the rejection is demonstrated on the controlled
host where the trace is taken, and the Git-Bash host inherits it by digest.

## Flat locking, chosen over ordered nesting (audit finding 6)

The first draft said both things: the durable core shall never hold one lock
while acquiring another, *and* where a future change requires both, take
`.seq.lock` first and `.attempt.lock` second. Those are two policies, and an
implementer reading the spec had to pick one. A stated ordering is a standing
permission to nest.

The policy is flat, and the helper enforces it at runtime with `FM_LOCK_NESTED`
rather than by documentation. The ordering sentence is removed from the spec
and from `lib/lock.sh`'s header. A future change that genuinely needs two locks
amends the requirement in its own package and brings its own deadlock argument
— which is a low bar to clear and a high bar to clear *accidentally*, which is
the correct asymmetry. The formal model's finding stands behind this: a
deliberately-nesting configuration deadlocks at 5 steps.

## Reclamation is per-lock, owner-aware, and refuses when unsure

"`el_init` reclaims every stale foreman lock under the run directory" was wrong
in two directions. It was too broad — `el_init` is global run initialization,
and a NATS bridge that crashes mid-run cannot re-run it to recover one lock
without touching locks other live processes hold. And it was too narrow — it
enumerated three locks and left `worktrees/.index.lock` (`wt-new.sh:192`), which
survives `SIGKILL` under the `mkdir` fallback, with no path at all.

So reclamation is a single-lock operation, `fm_lock_reclaim <lock>`, and each
lock names its reclaimer: `el_init` for the two run-scoped event-log locks, the
bridge for its own lock, `wt-new.sh` for the worktree index lock. It is
owner-aware — the token records PID *and* process start time, because a reused
PID is exactly the case where a naive liveness check reclaims a live lock — and
it fails closed: if liveness cannot be determined, the lock stays. A wedged lock
is a visible outage; a reclaimed live lock is a silent double-holder, which is
the failure this whole package exists to remove.
