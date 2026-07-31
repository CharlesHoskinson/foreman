# SPEC — lock-primitive-hardening, Round L1: the helper and its contract

You are implementing ONE ROUND of a large OpenSpec change package. Work ONLY in
`/root/fm-wt/s1-lock-L1` (a git worktree). Never touch `/root/foreman` — live
interactive sessions are running there.

**Read `AGENT_TRAPS.md` at the worktree root IN FULL as your first action.**
All of it, not the parts that look relevant to this task.

## 0. Scope boundary — read this before anything else

`lock-primitive-hardening` has 102 tasks across 15 groups. **You are
implementing three of them: T1, T12 and T15.** Everything else is another
round's work and you must NOT do it. Specifically you are NOT:

- migrating any caller onto the helper (`lib/eventlog.sh`,
  `lib/nats-bridge.sh`, `wt-new.sh`) — that is round L3
- writing the atomicity probe in `env/tool-check.sh` — that is round L2
- writing the pinned atomicity register in `env/reference-manifest.toml` —
  round L2
- writing `tests/lock.bats`'s full occupancy suite — round L4

Creating files outside your scope is a defect, not initiative.

## 1. Objective

Create `skills/foreman/scripts/lib/lock.sh`: the single shared lock helper the
durable core will acquire every lock through, replacing inline `mkdir`
spin-loops.

Background, so you understand what you are defending against: uutils `mkdir`
(Ubuntu 26.04's default) performs a userspace `statx` existence check and only
then creates, instead of issuing `mkdir(2)` and letting the kernel return
`EEXIST`. That check-then-act window is a TOCTOU. Measured on the reference
box with 8 racers on one lock: **uutils 57 mutual-exclusion violations over 15
rounds; GNU 0; `flock` 0 on ext4, tmpfs and drvfs.** The failure is invisible
to a naive test — `mkdir x; mkdir x` reports "File exists" and exits 1 under
both implementations. It only appears under contention.

## 2. Files

Create: `skills/foreman/scripts/lib/lock.sh`, and `REPORT.md` at the worktree
root.

Modify: nothing else. Do NOT `git commit`.

## 3. Interfaces — the contract

### 3a. Public API

`fm_lock_acquire`, `fm_lock_release`, `fm_with_lock`. shdoc headers on every
function, matching the style of the existing `lib/*.sh` files (read
`lib/common.sh` and `lib/eventlog.sh` for house style — do not invent a new one).

Requirements:

- Mechanism selection is resolved **once per process and cached**: `flock` when
  `command -v flock` succeeds AND a trusted, current verdict covers both `flock`
  and the filesystem class the lock path resolves to; `mkdir` fallback under the
  **same** trust rule and no weaker one; refusal otherwise.
- Expose the selected mechanism to callers — `el_init`'s conditional stale-lock
  reclamation needs it. `flock` releases on process death; a `mkdir` lock does
  not, so reclamation is correct for the fallback and unnecessary on `flock`.
- Preserve single-unconditional-release discipline on every exit path.
- Timeout is bounded, then a named error and non-zero exit. Never a silent
  infinite wait.
- `.seq.lock` and `.attempt.lock` stay separate. Do NOT collapse them.

### 3b. THE SEAM WITH ROUND L2 — important

Full trust evaluation (reading the tool-check JSON, the 6-condition currency
check, SHA-256 register matching, filesystem-class computation) is **round L2's
work, not yours.**

Define the seam as a single internal function — e.g.
`fm_lock__verdict_for <mechanism> <lock_path>` — that returns a trusted verdict
or nothing, and document its contract in the header. For this round implement
the **conservative** default: with no verdict source available, no mechanism
earns trust, so the helper refuses with `FM_LOCK_PROBE_UNTRUSTED`. That is the
correct behaviour for "atomicity unproven", and L2 replaces the body without
touching your callers.

Do not stub it in a way that returns "trusted" — failing open is the exact
defect this package exists to remove.

### 3c. Flat locking (T12)

No foreman lock is held while another is acquired. State the flat rule in the
file header. **Do NOT state a lock ordering** — a stated ordering is a standing
permission to nest, and the two policies cannot both be in force. A
deliberately-nesting configuration deadlocks at 5 steps under the formal model.
Refuse nesting at runtime with `FM_LOCK_NESTED`. Do not add nesting support.

### 3d. Refusal vocabulary (T15) — exactly six codes, one shape, ordered

Exactly these six, and each refusal names exactly one:

`FM_LOCK_NESTED`, `FM_LOCK_FS_UNSUPPORTED`, `FM_LOCK_NO_ATOMIC_PRIMITIVE`,
`FM_LOCK_PROBE_UNTRUSTED`, `FM_LOCK_UNAVAILABLE`, `FM_LOCK_TIMEOUT`.

Implement as an **ordered chain, first matching guard wins**, in exactly this
order — this is what makes the causes disjoint by construction rather than by
argument:

1. `FM_LOCK_NESTED` — process already holds a foreman lock. Decided at request.
2. `FM_LOCK_FS_UNSUPPORTED` — lock path's filesystem class covered by no trusted
   verdict for any available mechanism. Decided at init, on the filesystem.
3. `FM_LOCK_NO_ATOMIC_PRIMITIVE` — a trusted verdict **exists** for every
   available mechanism and every one says `non-atomic`. Atomicity positively
   **disproved**.
4. `FM_LOCK_PROBE_UNTRUSTED` — **no** trusted verdict of either polarity exists.
   Atomicity **unproven** rather than disproved.
5. `FM_LOCK_UNAVAILABLE` — residual. A mechanism was selected and trusted but the
   acquisition could not be attempted or relied on: path uncreatable/unopenable,
   read-only fs, permission denied, fd exhaustion, or the locking call reporting
   the operation unsupported (`ENOLCK`, `EOPNOTSUPP`, `EINVAL`). Carries a detail
   string naming the failing operation and its errno.
6. `FM_LOCK_TIMEOUT` — bounded spin expired on a mechanism already selected,
   trusted, and engaged at least once.

Guards 3 and 4 are **not** a choice — 3 requires a trusted negative verdict, 4
requires no trusted verdict at all. An earlier draft of this spec offered the
implementer a choice between them and that was the defect. Do not reintroduce it.

Trust and filesystem causes are decided at initialization, **before any spin**.
Assert this ordering in the helper rather than leaving it implied — it is what
makes `FM_LOCK_TIMEOUT` impossible on an untrusted mechanism.

**The one refusal shape**, scoped to the refused acquisition: it holds no lock,
enters no critical section, writes the code to stderr, exits non-zero, and the
files *that acquisition* would have protected are byte-identical. An outer lock
the process already holds is untouched and outside the invariant.

## 4. Constraints

- `shellcheck` clean.
- Match existing `lib/*.sh` house style — read the neighbours first.
- No `pkill -f` by pattern anywhere. Kill by recorded PID or process group.
  (`pkill -f "quint verify"` once matched its own command line and killed its
  own shell.)
- Do not run graphify or any graph rebuild.
- Use `/usr/local/bin/openspec`, never `npx openspec`.
- Do NOT `git commit`.

## 5. Verification — mandatory

Standing rule that overrides your instinct to report success:

> **Every checker must be demonstrated to FAIL against a known-bad input before
> it is trusted. A check never observed failing is not evidence.**

Write a small scratch harness (not the full `tests/lock.bats` — that is L4) that
demonstrates, with real captured output:

1. Each of the six refusal codes can be produced, and each produces the SAME
   observable shape (no lock held, code on stderr, non-zero exit, protected
   files byte-identical).
2. A nested acquisition is refused with `FM_LOCK_NESTED` **and** the outer lock
   is still held and released exactly once by its owner.
3. With no verdict source available, the helper refuses with
   `FM_LOCK_PROBE_UNTRUSTED` rather than acquiring. Show it refusing.
4. `shellcheck skills/foreman/scripts/lib/lock.sh` clean — quote the output.

Then write `REPORT.md` at the worktree root with:

- The public API as implemented, with signatures
- The exact seam function L2 will replace, and its documented contract
- For each of the six codes: the command that produced it and the ACTUAL
  observed stderr/exit
- Anything in this brief you could not satisfy, stated plainly

Do not claim a command passed unless you ran it and are quoting its real output.
A stated blocker is a good outcome. A fabricated pass is the failure mode this
entire release exists to eliminate.
