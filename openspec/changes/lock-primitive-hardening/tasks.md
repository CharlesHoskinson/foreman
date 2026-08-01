# Tasks — lock-primitive-hardening

Ordering note: T1-T3 are serial (they own `lib/lock.sh` and then migrate
callers onto it). T4-T6 may run in parallel once T2 lands. T7 is the gate.

## T1 — the shared lock helper

- [x] Create `skills/foreman/scripts/lib/lock.sh` with the public contract
      (`fm_lock_acquire` / `fm_lock_release` / `fm_with_lock`), shdoc headers
      on every function.
- [x] Mechanism selection resolved once per process and cached: `flock` when
      `command -v flock` succeeds **and** a trusted, current verdict covers the
      lock path's filesystem class; `mkdir` fallback under the same rule; refusal
      otherwise (T14). Neither mechanism is selected on an untrusted verdict or
      an uncovered filesystem class.
- [x] Expose the selected mechanism to callers (needed by `el_init`'s
      conditional stale-lock reclamation).
- [x] Preserve the single-unconditional-release discipline on every exit path.
- [x] Timeout behaviour matches the current spin-loops (bounded, then a named
      error and non-zero exit) — no silent infinite wait.

## T2 — migrate the durable core

- [x] Replace the inline spin-loop at `lib/eventlog.sh:76` (`.seq.lock`).
- [x] Replace the inline spin-loop at `lib/eventlog.sh:221` (`.attempt.lock`).
- [x] Replace the inline spin-loop at `lib/eventlog.sh:351` (`el_compact`,
      reuses `.seq.lock`).
- [x] Migrate the sibling mutex in `lib/nats-bridge.sh`.
- [x] Make `el_init`'s stale-lock reclamation (`eventlog.sh:52-57`)
      conditional on the fallback mechanism; do not delete it.
- [x] Keep `.seq.lock` and `.attempt.lock` separate — the rationale at
      `eventlog.sh:195-205` still holds.
- [x] `el_emit`'s 5-positional signature and critical-section shape unchanged.

## T3 — correct the false doctrine in comments and docs

- [x] `lib/eventlog.sh:70` — the "mkdir is atomic on Git Bash and WSL" comment
      is the root cause of this defect surviving; replace it with the real
      contract and a pointer to this change.
- [x] `lib/eventlog.sh:195-205` — same claim repeated.
- [x] `wt-new.sh:186` — same claim repeated.
- [x] `skills/foreman/references/durable-lanes.md` — update the locking
      section.

## T4 — atomicity probe in the host inventory

- [x] Add a deterministic `mkdir` atomicity probe to `env/tool-check.sh`
      (assert `mkdir(2)` + `EEXIST`, not a contention sample).
- [x] Report the coreutils flavour and the SHA-256 digest of `mkdir` as
      inventory rows.
- [x] Write the probe row into the JSON inventory (`--json --out`): absolute
      resolved path, version string, **SHA-256 digest**, verdict (`atomic` /
      `non-atomic` / `unknown`), evidence class, the **filesystem classes the
      verdict covers**, and a UTC timestamp. `lib/lock.sh` reads this row and
      never writes it (T14).
- [x] Probe `flock` on the same schema, not only `mkdir`: an available `flock`
      still needs a verdict scoped to a filesystem class, because advisory
      locking on a network or DrvFs mount is the "available but unsafe" state the
      round-1 enum had no code for.
- [x] Evidence classes are exactly `syscall`, `pinned-mechanism`, `contention`
      and `flavour`, and each licenses only what it can carry: `syscall` and
      `pinned-mechanism` may license `atomic` or `non-atomic`; `contention` may
      license `non-atomic` **only**; `flavour` licenses nothing on its own.
      Anything that cannot license `atomic` reports `unknown`.
- [x] INFO when non-atomic but `flock` present and trusted for the filesystem
      class; NOT-READY when no mechanism can earn a trusted verdict.
- [ ] Mirror the probe in `env/tool-check.ps1` for the Windows host, including
      the digest and filesystem-class fields. The PS1 mirror is not required to
      produce syscall evidence — that is what `pinned-mechanism` exists for.
- [x] Degrade honestly where no tracer is available: report the weaker class as
      weaker and the verdict as `unknown`, never as `atomic`.
- [ ] Test: a clean 8-racer contention sample on a known check-then-act `mkdir`
      still reports `unknown`, never `atomic`.

## T5 — reference manifest and the pinned atomicity register

- [x] Record the coreutils-flavour hazard in `env/reference-manifest.toml`
      with the measured evidence and the date.
- [x] Promote `flock` to `required = true` for the `durable` profile.
- [x] Note that Ubuntu 26.04 ships a hybrid GNU/uutils coreutils, and which
      utilities resolve to which.
- [x] Add the **pinned atomicity register**: one entry per pinned primitive
      carrying its SHA-256 digest, the host class it was traced on, the path of
      the committed trace artifact, the filesystem classes the verdict covers,
      and the date. This is the artifact that makes `pinned-mechanism` evidence
      checkable rather than asserted.
- [ ] Seed it with at least one MSYS2 / Git-Bash `mkdir.exe`, so the fallback's
      only host has a reachable trusted path on day one.
- [x] Document that entries are added only from a trace taken on a
      Foreman-controlled host, never from a version string or a vendor claim.

## T6 — tests

- [x] New `tests/lock.bats`: mutual-exclusion-by-occupancy test, N >= 8
      acquirers, losers spin and retry, assert strict ENTER/EXIT alternation.
- [x] The occupancy test SHALL fail on a deliberately non-atomic primitive —
      prove the test detects the defect by running it against the uutils
      `mkdir` path directly.
- [x] Exercise the `mkdir` fallback explicitly by forcing the mechanism; do
      not rely on finding a host without `flock`.
- [x] Fix `tests/eventlog.bats` "append failure leaves a gap": skip when
      `EUID == 0` with a stated reason, or induce a failure root cannot
      bypass.
- [x] Retain "el_attempt_new under concurrent contention" as a symptom test.
- [ ] Confirm test 43 ("concurrent emitters produce unique monotonic seqs")
      stops being load-sensitive once the primitive is fixed; if it does not,
      that is a separate finding and must be logged, not papered over.

## T7 — gate

- [ ] Full suite green on WSL/Ubuntu 26.04 (the host that exposed this).
- [ ] **AMENDED 2026-07-29 — see D5.** Full suite green on Git-Bash/Windows
      with the fallback actually taken is **deferred**, because it requires a
      SHA-256 pinned from a syscall trace captured on a Foreman-controlled
      MSYS2/Git-Bash host, and no such host is available. Fabricating the entry
      was explicitly refused; a fabricated pin is worse than an unreachable
      fallback. What this release requires instead, and what remains fully
      testable here:
  - [ ] **Reachability of the code path** proven against a structurally valid
        register entry in a **temporary** manifest — the `mkdir` fallback IS
        selected, creates exactly one lock directory, and releases it exactly
        once including on the error exit path. The real register stays empty.
  - [ ] **The refusal path on an unpinned host** is exercised and correct: the
        helper refuses with `FM_LOCK_PROBE_UNTRUSTED`, names the host class and
        the consequence, and names the pinning procedure as the route back.
  - [ ] `env/reference-manifest.toml` ships with an **empty** pinned register
        and a recorded reason; durable lanes on MSYS2/Git-Bash are documented
        as unavailable until a real pin is committed from a traced host.
  - [ ] The deferral is recorded in `ROADMAP.md` under honest residuals, not
        silently carried.
- [ ] Confirm the refusal path on Git-Bash is reachable too: with the digest
      un-pinned, the helper refuses with `FM_LOCK_PROBE_UNTRUSTED` and names the
      pinning procedure, and non-durable lanes still run.
- [ ] The three previously-failing event-log tests (43, 50, 54) pass for the
      right reason — verified by reading the fix, not just the green tick.
- [ ] `bugeventlog.md` entry appended recording this failure class, its
      evidence, root cause, impact, and the enhancement — per the repo's own
      append-only log discipline.
- [ ] `shellcheck` clean on `lib/lock.sh` and every migrated caller.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.

## T8 — OpenSpec conformance debt (discovered while authoring this package)

`openspec/README.md` states the repo follows OpenSpec folder conventions.
It does not: **all sixteen existing change packages fail `openspec validate`**
(nine live, seven archived), because they use `## ADDED Requirement: <title>`
where the CLI parses `## ADDED Requirements` → `### Requirement: <title>` →
`#### Scenario:`. This package is the first in the repo to validate, strict.

- [ ] Decide, as an architect decision: migrate to the parseable shape, or
      amend `openspec/README.md` to state the repo uses a documented variant
      and the CLI is not a gate. Do not leave the claim and the reality
      disagreeing.
- [ ] IF migrating: convert the nine live packages (the six v0.2.9 WSL
      packages and the two
      stale merged ones) — a mechanical header transform, no content change.
- [ ] IF migrating: add `openspec validate --strict` for every live change to
      the docs gate, so the next package cannot regress.
- [ ] Leave `openspec/changes/archive/**` alone either way; archived specs are
      historical records, not live contracts.

## T9 -- remove the fail-open path (the fix does not otherwise reach it)

Apalache 0.56.1, `formal/specs/eventlog_concurrency.qnt`: module
`index_fail_open_atomic`, step `index_step`. `mutual_exclusion` VIOLATED at 8
steps (7.7 s) and `no_lost_index_entry` VIOLATED at 12 steps (61.9 s) --
**with an atomic test-and-set primitive**. T1-T2's primitive swap does not fix
this call site, because the defect is the timeout policy.

- [x] `wt-new.sh:203` -- delete the "proceeding unsynchronized" branch. A
      timed-out acquisition exits non-zero with a named error.
- [x] Audit every other call site for the same pattern; the helper's timeout
      contract from T1 must have no fail-open caller anywhere.
- [ ] The refusal leaves `index.json` byte-identical -- assert this, because
      the per-PID tmp name converts a torn write into a *silent lost update*.
- [x] Make the index-lock timeout configurable; a caller that needs longer
      raises the timeout, never bypasses the lock.
- [ ] Test: `tests/lock.bats` gains a fail-open regression -- two contending
      `wt-new.sh` invocations, one forced to time out, and no index entry lost.
- [ ] Test: a static check (grep or shellcheck-adjacent) fails the suite if a
      timeout branch ever continues into a critical section again.

## T10 -- the compaction race

`locking / no_lost_structural_event` violated under `toctou` (simulation,
5,000 x 25). `el_compact` can overwrite `events.jsonl` with a snapshot taken
before a concurrent `el_emit` append -- the documented source of truth silently
loses a committed event. M2 states explicitly that a **unique compaction tmp
name does not fix this**, which rules out the obvious patch.

- [x] Make compaction's snapshot and write-back a single serialized section
      with respect to appends, under the T1 helper.
- [x] IF the log cannot be shown unchanged between snapshot and write-back,
      abandon the compaction and leave `events.jsonl` alone.
- [x] Do not "fix" this by renaming the temporary file. Record in `design.md`
      why that is insufficient, so the next reader does not retry it.
- [ ] Test: append during compaction; assert the appended event survives, and
      prove the test goes red against an implementation that only renames the
      tmp file.

## T11 -- per-lock, owner-aware reclamation (audit finding 6)

`nats_toctou / nats_owner_token_sound` VIOLATED at 10 steps (10.7 s);
`nats_toctou / no_deadlock` VIOLATED at 8 steps (21.4 s);
`nats_atomic / nats_lock_recoverable` violated on a pre-owner crash
(simulation, 5,000 x 12). Verified in code: `el_init` reclaims `.seq.lock`
(`eventlog.sh:52`) and `.attempt.lock` (`:57`) and **not**
`.nats-bridge.lock` -- a crash wedges it with no reclamation path. The audit
adds two defects the first draft created: "every stale foreman lock, at
`el_init`" cannot be run mid-run to recover one lock without touching live
locks, and `worktrees/.index.lock` (`wt-new.sh:192`) survives `SIGKILL` under
the `mkdir` fallback with no reclamation task at all.

- [x] Add `fm_lock_reclaim <lock>` to the helper: reclaims exactly the named
      lock, never a sweep, usable while a run is live.
- [x] Enumerate the locks in scope and their reclaiming process: `.seq.lock`
      and `.attempt.lock` at `el_init`; `.nats-bridge.lock` at bridge start;
      `worktrees/.index.lock` at `wt-new.sh` start.
- [x] Owner token records the holder's PID **and** its process start time, so a
      reused PID cannot be mistaken for a live holder.
- [x] Reclaim only when the recorded holder is provably dead. If liveness
      cannot be determined, refuse to reclaim and record the refusal -- deleting
      a live holder's lock is worse than a wedged lock.
- [x] Keep reclamation conditional on the mechanism the helper selected; never
      applied to a `flock` descriptor.
- [x] Under check-then-act both racers "acquire" and both write `$lock/owner`,
      so the loser's token lands on disk: the true holder can no longer
      release and the non-holder can. Write the owner token only from the
      process that actually won the acquisition.
- [x] Record a reclamation event naming the lock and the dead holder; never
      reclaim silently.
- [ ] Test: kill a token holder, run the owning reclaimer, assert the next
      acquisition succeeds; assert a losing racer cannot release; assert a live
      holder's lock is never reclaimed; assert reclaiming one lock leaves the
      other three untouched.

## T12 -- flat locking, chosen over ordered nesting (audit finding 6)

M2's verdict on today's code: **clean**. `el_emit` takes only `.seq.lock`,
`el_attempt_new` only `.attempt.lock`, `el_compact` reuses `.seq.lock` and
calls only read-only `el_read` inside it, and `lane-run.sh` calls them
sequentially, never nested. A deliberately-nesting configuration
(`nested_atomic / no_deadlock`) deadlocks at 5 steps (54.0 s). The first draft
stated both policies at once -- never nest, *and* here is the order to nest in
-- which left the implementer to choose. The policy is flat.

- [x] State the flat rule in `lib/lock.sh`'s header: no foreman lock is held
      while another is acquired. Do **not** state an ordering.
- [x] Refuse nesting at runtime: an acquisition requested while this process
      holds a foreman lock exits non-zero with `FM_LOCK_NESTED`.
- [x] Repeat the flat rule in `references/durable-lanes.md`'s locking section
      (T3 already touches that file); remove any ordering sentence.
- [x] Do not add nesting support to the helper. A future change that genuinely
      needs two locks amends the requirement in its own package, with its own
      deadlock argument.
- [x] Test: a nested acquisition attempt is refused and the outer lock is still
      held and released exactly once.

## T13 -- operational note carried from the formal work

- [x] Lanes SHALL NOT `pkill -f` by pattern. M2 reports `pkill -f "quint
      verify"` matched its own command line, killed its shell, and would have
      killed a sibling lane sharing the same Apalache server. Kill by recorded
      PID or process group, per the same discipline
      `three-outcome-verdicts` T3 applies to the audit timeout.

## T14 -- wire the mechanism to the verdict, and make Git-Bash reachable (RECONCILE R4, re-audit N3)

The probe was specified in `tool-check.sh` and the fallback in `lib/lock.sh`, and
nothing connected them: as first written the `mkdir` fallback could be selected
on a host the probe had already found non-atomic. Round 1 connected them by
requiring `atomic` on **syscall** evidence -- which the fallback's only host,
MSYS2 / Git-Bash, cannot produce, because it ships no tracer. That refused every
acquisition there and made this package's own "Git-Bash falls back to the mkdir
mutex" scenario unreachable. Trust is therefore earned by one of two classes, one
of which Git-Bash can actually supply.

- [x] Helper initialization reads the verdict from
      `${FOREMAN_TOOL_CHECK_JSON:-${HOME}/.foreman/last-tool-check.json}` --
      the record `env/bootstrap-wsl.sh:411` already writes.
- [x] Trust exactly two evidence classes: `syscall` (a trace on **this** host
      observed the create issued to the kernel and `EEXIST` /
      `ERROR_ALREADY_EXISTS` returned) and `pinned-mechanism` (the resolved
      primitive's SHA-256 matches an entry in the pinned atomicity register in
      `env/reference-manifest.toml`, that entry cites a committed `syscall`
      trace taken on a Foreman-controlled host of the same class, and the lock
      path's filesystem class is one the entry names).
- [x] Treat `non-atomic`, `unknown`, an absent record, and a digest matching no
      register entry as untrusted. No caller may promote a degraded verdict, and
      a **version-string match is not a digest match**.
- [x] Currency check, all six conditions: same absolute resolved path, same
      version string, same SHA-256 digest, covered filesystem classes include the
      class the lock directory resolves to now, record timestamp not earlier than
      that binary's mtime, record no more than 24 hours old.
- [x] Compute the filesystem class for the directory that will hold the lock --
      not `$PWD`, not `FOREMAN_HOME` -- distinguishing at least local fixed
      volume, `/mnt` DrvFs or other Windows-hosted mount, network mount (NFS,
      CIFS/SMB, `//server/share` UNC), and FUSE. Never inherit a verdict across
      classes.
- [x] Absent, unreadable, unparsable, stale or mismatched record -> run one
      bounded local probe per process, cached in process memory only. The helper
      never writes the inventory record; `tool-check.sh` owns it.
- [x] Refuse per the ordered causes in T15: no trusted verdict of either polarity
      -> `FM_LOCK_PROBE_UNTRUSTED`; trusted and negative -> 
      `FM_LOCK_NO_ATOMIC_PRIMITIVE`; uncovered filesystem class ->
      `FM_LOCK_FS_UNSUPPORTED`. Fail closed; never fall through to the mutex.
- [x] Resolve mechanism selection and verdict trust once, at initialization,
      before any bounded spin.
- [ ] Seed the pinned atomicity register: run the tracing probe on a
      Foreman-controlled MSYS2 / Git-Bash host, commit the trace artifact, and
      record the `mkdir.exe` SHA-256 with the filesystem classes it covers. This
      is what makes the Git-Bash scenario reachable rather than documentation.
- [x] Document the pinning procedure in `references/durable-lanes.md` (T3 already
      touches that file) so an unpinned host has a named route back to
      availability rather than a permanent exclusion.
- [x] State, per host class, whether durable lanes are available and on what
      evidence -- WSL/Linux on `syscall`, MSYS2/Git-Bash on `pinned-mechanism`,
      unpinned hosts unavailable until a digest is pinned -- and state that
      lanes taking no foreman lock are unaffected.
- [x] Test: force the `mkdir` fallback on a host whose probe returns a trusted
      `non-atomic` -> the helper refuses and names the absent primitive.
- [ ] Test: remove or backdate the inventory record -> the helper probes locally
      rather than assuming, and refuses if the local probe cannot earn a trusted
      verdict.
- [ ] Test: a resolved `mkdir` whose version string matches the register but
      whose SHA-256 does not -> refused with `FM_LOCK_PROBE_UNTRUSTED`.
- [x] Test: a pinned digest with a covered filesystem class -> the fallback is
      selected, creates exactly one lock directory, and releases it exactly once
      including on the error exit path. This test is the reachability proof for
      the Git-Bash scenario and must run on Git-Bash in T7.
- [ ] Test: the same pinned digest with the lock path forced onto an uncovered
      filesystem class -> refused, not inherited.

## T15 -- one refusal shape, six ordered causes

R4 asks whether the fail-open removal (T9) and the probe refusal (T14) can
contradict each other. They cannot, and the spec now says why in a testable way.
The re-audit then found the round-1 enum was **not total** (no code for a
mechanism that is available but unusable or unsafe), **not disjoint** (a
definitive `non-atomic` probe satisfied two codes at once, and this task list
handed the choice to the implementer), and **not uniform** (the one-shape
invariant was unsatisfiable for `FM_LOCK_NESTED`, which arises by definition with
a lock held). All three are fixed here.

- [x] Define the refusal vocabulary in `lib/lock.sh` as exactly six codes:
      `FM_LOCK_NESTED`, `FM_LOCK_FS_UNSUPPORTED`, `FM_LOCK_NO_ATOMIC_PRIMITIVE`,
      `FM_LOCK_PROBE_UNTRUSTED`, `FM_LOCK_UNAVAILABLE`, `FM_LOCK_TIMEOUT`.
      Exactly one is named per refusal.
- [x] Implement the causes as an ordered chain in exactly that order, first
      matching guard wins, so the causes are made disjoint by the code path rather
      than of a comment.
- [x] Guard 3 (`FM_LOCK_NO_ATOMIC_PRIMITIVE`) fires only when a **trusted**
      verdict exists for every available mechanism and is negative. Guard 4
      (`FM_LOCK_PROBE_UNTRUSTED`) fires only when **no** trusted verdict of
      either polarity exists. Do **not** offer the implementer a choice between
      them; the previous wording of this task did, and that was the defect.
- [x] `FM_LOCK_FS_UNSUPPORTED`: the lock path's filesystem class is covered by no
      trusted verdict for any available mechanism — an available `flock` on a
      network, UNC, DrvFs or FUSE mount refuses here rather than silently not
      locking.
- [x] `FM_LOCK_UNAVAILABLE` is the **residual** code and makes the enum total:
      lock path cannot be created or opened, read-only filesystem, permission
      denied, descriptor exhaustion, or the locking call reporting the operation
      unsupported (`ENOLCK`, `EOPNOTSUPP`, `EINVAL`). It carries a detail string
      naming the failing operation and its errno.
- [x] Every refusal has one shape, **scoped to the refused acquisition**: that
      acquisition holds no lock and enters no critical section, the code is on
      stderr, the exit is non-zero, and the files *that acquisition* would have
      protected are byte-identical. An outer lock held by the process is
      untouched and outside the invariant.
- [x] Trust and filesystem causes are decided at initialization, before any spin;
      `FM_LOCK_TIMEOUT` can only arise on an already-trusted, already-engaged
      mechanism. Assert this ordering in the helper rather than leaving it
      implied.
- [x] Audit every call site: no caller distinguishes between causes by
      continuing into the critical section.
- [x] Test: each of the six causes produces the same observable refusal shape,
      and a timeout refusal never occurs on an untrusted mechanism.
- [ ] Test: with the inventory record removed and the local probe forced to a
      definitive `non-atomic` with no `flock`, the refusal names
      `FM_LOCK_NO_ATOMIC_PRIMITIVE` and never `FM_LOCK_PROBE_UNTRUSTED`.
- [ ] Test: `flock` present and trusted but the lock path on a read-only mount ->
      `FM_LOCK_UNAVAILABLE` with the errno in the detail string, and no
      unsynchronized entry.
- [x] Test: `flock` present, lock path forced onto an uncovered filesystem class
      -> `FM_LOCK_FS_UNSUPPORTED` before any acquisition attempt.
- [x] Test: a nested acquisition is refused and the outer lock is still held and
      released exactly once by its owner -- the refusal shape is asserted against
      the refused acquisition's files, not the outer section's.
- [ ] Static check: every refusal exit path in `lib/lock.sh` emits one of the six
      codes; the suite fails if an unnamed refusal path exists.

T7 remains the final gate for this package, and its checklist now also covers
T9-T15's tests and a re-run of `openspec validate lock-primitive-hardening
--strict`.
