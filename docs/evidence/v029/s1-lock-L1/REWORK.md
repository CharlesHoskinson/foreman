# REWORK — lock-primitive-hardening L1, round 3

Read `AGENT_TRAPS.md` IN FULL first.

Round 2 was re-audited by GPT-5.6 Sol. **All six original findings (H1-H5, M1)
are confirmed FIXED — do not touch them.** The three previously-sound claims
(fail-closed, no lock ordering, lock separation + mechanism exposure) are also
confirmed intact.

**The rework introduced three NEW defects.** That is this project's documented
pattern — fix rounds carrying a new defect in the same package — and this round
exists to break it. Fix only these three. Work only in
`skills/foreman/scripts/lib/lock.sh`. Do NOT `git commit`.

## N1 — HIGH. flock acquisition destroys a caller-owned file descriptor 3

`lib/lock.sh:289-293`. The H3 open-error capture uses `exec 3>&2`
unconditionally and later `exec 3>&-`. If the sourcing process already owns
FD 3, the helper **overwrites and then closes it**.

Reproduced by the auditor: opened FD 3 to a marker file, wrote `before`,
performed a **successful trusted flock acquisition**, then a second write to
FD 3 failed with `Bad file descriptor` and the marker contained only `before`.

Note this happens on the **success path**, not an error path. A library that
silently destroys a caller's descriptor is worse than the timeout it was added
to diagnose.

**Fix:** do not hardcode FD 3. Use an automatically-allocated descriptor
(`exec {fd}>...` gives an unused one in bash 4.1+, which this repo already
requires elsewhere) or save and restore any pre-existing FD. Never close a
descriptor the helper did not open.

**Prove:** caller opens FD 3, writes, acquires successfully, writes again,
releases — both writes land and FD 3 is still open and still points at the
caller's file. Also prove it for the mkdir path and for a refused acquisition.

## N2 — HIGH. The wrapper overwrites caller and command traps

`lib/lock.sh:547-570`. H4's fix installs EXIT/HUP/INT/TERM traps by
overwriting, and clears all four at line 570 rather than restoring their prior
definitions. Destructive in **both** directions:

- A caller EXIT trap installed before `fm_with_lock` **never runs** — the
  wrapper overwrote it and then cleared it.
- The critical-section command can overwrite the wrapper's cleanup trap. The
  auditor reproduced the original H4 symptom this way: a command that installs
  its own EXIT trap and calls `exit 7` **still stranded the mutex**.

So H4 is fixed for the plain case and reopened for the case where anyone else
uses traps.

**Fix:** save the existing definitions (`trap -p EXIT HUP INT TERM` returns
re-executable strings), compose rather than replace, and restore exactly on the
way out instead of clearing. The safest structure is to run the critical-section
command in a **subshell** so its trap changes cannot reach the wrapper's, with
the wrapper's cleanup owned by the parent shell — evaluate that against the
requirement that release happens exactly once.

**Prove, capturing real output:** (a) a caller EXIT trap set before
`fm_with_lock` still fires afterwards; (b) a command that installs its own EXIT
trap and exits 7 still releases the lock exactly once; (c) a signal still
releases; (d) no double release in any of these; (e) a REFUSED acquisition
installs no trap and releases nothing.

## N3 — MEDIUM. First source trusts inherited private hold state

`lib/lock.sh:35-44`. H5's idempotent `: "${_FM_LOCK_HELD_PATH:=}"` cannot
distinguish a legitimate re-source from a **first** source in a process that
merely inherited the variable from its environment.

Reproduced: a fresh process launched with exported `_FM_LOCK_HELD_PATH=/not/held`,
`_FM_LOCK_MECHANISM=mkdir`, `FM_LOCK_MECHANISM=mkdir` sourced the library and
immediately refused its first acquisition as `FM_LOCK_NESTED`, holding no lock,
with no lock artifact on disk. Since `lane-run.sh` and friends export
environment into child lanes, this is reachable in normal operation.

**Fix:** gate initialization on a **process-local sentinel** (e.g. record the
owning PID alongside the hold state and treat the state as foreign when it does
not match `$BASHPID`), or validate ownership against the lock artifact before
honouring an inherited hold. H5's live-state preservation must keep working:
a genuine re-source inside the SAME process that holds a lock must still see
its hold.

**Prove:** (a) fresh process with the variables exported to bogus values ->
first acquisition SUCCEEDS (or refuses for the right reason, never NESTED);
(b) genuine re-source while holding -> still NESTED, outer hold preserved,
release still works — the H5 case must not regress.

## Constraints

- Only `lib/lock.sh`. Do not touch the six earlier fixes; re-verify them.
- `shellcheck` clean — quote the real output.
- No `pkill -f` by pattern anywhere.
- Do NOT `git commit`. No graphify. `/usr/local/bin/openspec`, never `npx`.

## Verification

Extend `scratch-lock-harness.sh` (NOT `tests/lock.bats`). Every fix must be
OBSERVED producing correct behaviour against the state that triggered the
original defect, with real captured output. Then **re-run the entire existing
harness** and show all previously-passing sections still pass — that regression
run is the point of this round.

Rewrite `REPORT.md`: each fix, the command exercising it, the ACTUAL observed
output, the full regression run, and anything unsatisfied. A stated blocker is
a good outcome; a fabricated pass is the failure this release exists to
eliminate.
