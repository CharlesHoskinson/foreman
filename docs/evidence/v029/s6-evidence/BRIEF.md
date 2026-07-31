# SPEC — evidence-contracts, round 1 (T1 only: the evidence mechanism)

**MANDATORY FIRST ACTION:** create `REPORT.md` at the worktree root with a
heading per deliverable below, each marked PENDING, then fill each in place as
you finish it. Do not batch. Four lanes on this project died mid-write today
having written nothing.

**SECOND:** read `AGENT_TRAPS.md` IN FULL. All of it.

Do NOT `git commit`. No graphify. `/usr/local/bin/openspec`, never `npx`.

## Scope

`evidence-contracts` has 43 task checkboxes. **You implement T1 only** — the
evidence mechanism itself. T2 (lane-type contracts), T3 (inconclusive
semantics) and everything after are later rounds. Work outside T1 is a defect,
not initiative.

Per decision **D8**, this package **owns** `lib/evidence.sh`.
`three-outcome-verdicts` consumes it and must not define it. Implement it here.

## Why this exists — the defect class, with today's instances

Lane success is currently decided by an architect eyeballing `git status`, or by
a process exit code. Both are unsound, and both failed today:

- A `git status --porcelain` digest was used as write evidence and **collapsed
  an untracked directory to a single line**, so files 2..N inside it produced a
  byte-identical digest. A lane that wrote four files looked identical to one
  that wrote one.
- An exec-bit change was staged, then silently reverted by a later `git add` of
  the same path. The suite passed against the **transient index state** and the
  commit carried the old mode. **Success was bound to the wrong artifact.**
- Four lanes across three vendors exited 0 having produced nothing.

Your job is to make artifact-and-content the only thing that can constitute
success.

## T1 — the mechanism

Implement `skills/foreman/scripts/lib/evidence.sh`.

**The canonical per-path record — implement exactly this shape**, because
`three-outcome-verdicts` shares the same function for `tree_sha256`:

- sorted bytewise-ascending by path
- `path\0state\0mode\0hash\n`
- states: `f` / git file mode / SHA-256 of bytes; `l` / `120000` / SHA-256 of
  the **link target string**; `d` / `040000` / 64 zeros; `-` / `000000` / 64
  zeros for a path that does not exist

The deliverable-set digest is the SHA-256 of the sorted concatenation, over
every declared deliverable entry plus every path the status enumeration reports
changed within the lane's work root.

**Emit an absent-state record** for every declared deliverable that does not
exist and every path reported deleted — so a removal changes the digest exactly
as a write does, and a lane that correctly deleted a file is distinguishable
from one that wrote nothing.

**Invoke the status enumeration as exactly:**
`git status --porcelain=v1 -z -uall --no-renames`
and **assert all three flags in a test**, each for its own reason: `-uall`
because of the untracked-directory collapse above; `-z` because porcelain v1
shell-quotes awkward paths; `--no-renames` so a rename decomposes into an
absent record plus a present record.

**A path that exists but whose bytes, mode or link target cannot be read is
UNCOMPUTABLE, not absent.** Encoding it as absent makes a permissions failure
indistinguishable from a deletion. Comment this at the call site.

**Fail closed on evidence-computation failure** — non-git work root, non-zero
digest command, unreadable declared deliverable — recording `INCONCLUSIVE` with
a distinct reason. **Never interpret a computation failure as "no change."**

One subtlety the spec is explicit about: the git-work-tree requirement applies
to the **work root only**. An artifact root that is not a git work tree (the run
directory) is computable by content records over the declared deliverables and
is **NOT** a computation failure. Assert both halves. The old code path that
rejected any non-git root is the known-bad input.

**Write both verified blind spots into the header of `lib/evidence.sh`:**
(a) without `-uall`, an untracked directory collapses to one `?? dir/` line, so
files 2..N inside produce a byte-identical digest; (b) with or without `-uall`,
the digest is blind to content changes within a path whose status string does
not change. Cite the `bugeventlog.md` root-cause entry of 2026-07-28.

## Dogfooding — this goes into use immediately (D9)

This becomes how lane success is decided for every remaining package in this
release, replacing the architect's judgement. So it must be safe to run
repeatedly, must never mutate the tree it measures, and its `INCONCLUSIVE`
reasons must be specific enough to act on.

Per **D7** it lands observational: compute and record, do not gate, until it has
produced verdicts on ten of this project's own rounds with no false positive.

## Verification — mandatory

> Every checker must be demonstrated to FAIL against a known-bad input before
> it is trusted.

Capture real output for each:

1. The untracked-directory collapse: a lane writing four files inside a new
   directory must produce a digest **different** from one writing one file.
   Show that a `--porcelain` digest without `-uall` does NOT distinguish them
   and yours does. This is the package's central claim — demonstrate it.
2. A deletion changes the digest exactly as a write does.
3. A rename decomposes into an absent plus a present record.
4. An unreadable path yields UNCOMPUTABLE, not absent.
5. A non-git work root yields `INCONCLUSIVE` with its reason; a non-git
   **artifact** root does NOT — it computes normally.
6. A path whose bytes change while its status string does not: show the content
   digest catches it and record that the porcelain digest alone does not.
7. `shellcheck` clean.
8. Your harness exits non-zero when any case fails. Prove it — a harness on
   another package here shipped printing failures while exiting 0.

Write `REPORT.md` with each item, the command, and the ACTUAL observed output.
A stated blocker is a good outcome; a fabricated pass is the failure this
release exists to eliminate.
