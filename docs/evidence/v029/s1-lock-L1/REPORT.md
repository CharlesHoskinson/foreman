# REPORT — lock-primitive-hardening L1, round 3 (N1–N3)

Worktree: `/root/fm-wt/s1-lock-L1`  
Scope: **only** `skills/foreman/scripts/lib/lock.sh` plus harness/report.  
Authority: `REWORK.md`. No git commit. No graphify. No `npx openspec`.

## AGENT_TRAPS.md

Read **in full** as the first action. Applied: success predicates bound to
observed stderr/exit/artifact content; every fix exercised against the state
that triggered the defect; a stated blocker is acceptable, a fabricated pass
is not; no `pkill -f`.

## Round-2 baseline (auditor confirmed FIXED — not re-touched)

| Finding | Status this round |
|---|---|
| H1 mixed → residual UNAVAILABLE | re-verified PASS (R1/R2) |
| H2 FS_UNSUPPORTED aggregate | re-verified PASS (R3) |
| H3 op-failure → UNAVAILABLE | re-verified PASS (R4) |
| H4 release on exit/signal | re-verified PASS (R5); N2 closes trap-reopen |
| H5 re-source preserves hold | re-verified PASS (R6); N3 keeps it |
| M1 NESTED before arg checks | re-verified PASS (R7) |
| Fail-closed / no ordering / lock separation | re-verified PASS (R9) |

---

## N1 — HIGH. flock acquisition no longer destroys caller FD 3

**Defect:** H3 open-error capture used `exec 3>&2` / `exec 3>&-` unconditionally.
On a **successful** flock acquisition, a caller-owned FD 3 was overwritten and
closed (`Bad file descriptor` on the next write; marker held only `before`).

**Fix:** allocate a temporary stderr-save descriptor with
`exec {save_stderr}>&2` and restore/close only that auto-allocated FD. Never
hardcode FD 3. On open failure, also close the just-allocated `lock_fd` if any.

**Command / observed (section N1):**

```text
CMD: open FD3; write before; flock acquire; write after; release
  acquire rc=0 mech=[flock] stderr=[]
  write_after_rc=0 still_open_rc=0
  marker content=[before
after
still-open]
  PASS N1 flock success preserves caller FD 3

CMD: open FD3; write; mkdir acquire; write; release
  acquire rc=0 content=[before-mkdir
after-mkdir] write_rc=0
  PASS N1 mkdir path preserves caller FD 3

CMD: open FD3; write; refuse (PROBE_UNTRUSTED); write
  refuse rc=1 stderr=[FM_LOCK_PROBE_UNTRUSTED] write_rc=0 content=[before-refuse
after-refuse]
  PASS N1 refused acquisition preserves caller FD 3
```

---

## N2 — HIGH. Traps saved/restored; command cannot clobber cleanup

**Defect:** `fm_with_lock` overwrote EXIT/HUP/INT/TERM and cleared them on the
way out. A caller EXIT trap never ran afterwards. A critical-section command
that installed its own EXIT trap and `exit 7` stranded the mkdir mutex
(H4 reopened whenever anyone else used traps).

**Fix:**

1. `trap -p EXIT HUP INT TERM` → save re-executable definitions.
2. Install wrapper cleanup traps; on finish, release once then **restore** the
   saved definitions (never leave traps permanently cleared).
3. Run COMMAND in a **subshell** so its trap mutations / `exit` cannot replace
   the parent’s cleanup. Parent owns release; once-flag prevents double release.
4. Refused acquisition returns before any trap is installed.

**Semantic note:** because COMMAND is in a subshell, `exit N` inside the
command becomes `fm_with_lock`’s return status `N` rather than terminating the
caller shell. Release still runs exactly once; callers that need the process
to die on command-exit should check the return code.

**Command / observed (section N2):**

```text
CMD: trap CALLER_EXIT; fm_with_lock -- true; exit 0
  stdout:
    after_with_lock held=[] lock_exists=no
    trap_p_EXIT=[trap -- 'echo CALLER_EXIT_FIRED' EXIT]
    CALLER_EXIT_FIRED
  lock dir exists? no
  PASS N2(a) caller EXIT trap fires after with_lock

CMD: fm_with_lock -- (trap EXIT; exit 7)
  outer_exit=0 stdout=[CMD_EXIT_TRAP
with_lock_rc=7] stderr=[]
  lock dir exists? no
  re-acquire after release rc=0 (expect 0)
  PASS N2(b) command EXIT trap + exit 7 still releases once

CMD: fm_with_lock -- kill -TERM $PPID
  exit=143 stdout=[] stderr=[]
  lock dir exists? no
  PASS N2(c) signal releases (exit=143)

CMD: fm_with_lock -- true (fall-through once-flag)
  rc=0 held=[] lock_exists=no
  second fm_lock_release rc=0 (expect 0 idempotent)
  PASS N2(d) no double release on fall-through

CMD: (default seam); fm_with_lock refuse path in sacrificial shell
    rc=1
    stderr=[FM_LOCK_PROBE_UNTRUSTED]
    stdout=[]
    trap_before=[trap -- 'echo N2E_CALLER' EXIT]
    trap_after=[trap -- 'echo N2E_CALLER' EXIT]
    lock_exists=no
    trap_unchanged=yes
  PASS N2(e) refuse installs no trap, releases nothing
```

H4 regression (R5) under the new semantics:

```text
CMD: bash -c 'fm_with_lock PATH -- exit 7; echo with_lock_rc=$?' (mkdir mutex)
  outer_exit=0 stderr=[] stdout=[with_lock_rc=7]
  lock dir exists? no
  PASS H4 exit 7 releases mkdir mutex

CMD: fm_with_lock PATH -- kill -TERM $PPID (mkdir mutex)
  exit=143 stderr=[] stdout=[]
  lock dir exists? no
  PASS H4 signal releases mkdir mutex (exit=143)
```

---

## N3 — MEDIUM. First source ignores inherited hold state

**Defect:** `: "${_FM_LOCK_HELD_PATH:=}"` preserved values exported into a fresh
process. A child launched with `_FM_LOCK_HELD_PATH=/not/held` (and friends)
sourced the library and refused its first acquisition as `FM_LOCK_NESTED`
while holding nothing and with no lock artifact on disk.

**Fix:** gate initialization on process-local sentinel `_FM_LOCK_INIT_PID`.
When it does not match `${BASHPID:-$$}`, clear hold state (including public
`FM_LOCK_MECHANISM`) and record this process’s PID. Same-process re-source
keeps the live hold (H5).

**Command / observed (section N3):**

```text
CMD: env _FM_LOCK_HELD_PATH=/not/held ... bash -c source+acquire
  wrap_exit=0
  stdout:
    after_source held=[] mech=[] FM_LOCK_MECHANISM=[] init_pid=[838831] bashpid=838831
    acquire rc=0 stderr=[] stdout=[mkdir] held=[…/n3.fresh.lock]
    released held=[] lock_exists=no
  PASS N3(a) inherited hold state ignored; first acquire succeeds

CMD: acquire …/n3.h5.lock rc=0 held=[…/n3.h5.lock] mech=[mkdir]
  after re-source: held=[…/n3.h5.lock] mech=[mkdir] FM_LOCK_MECHANISM=[mkdir] init=[830561]
CMD: after re-source; acquire …/n3.h5.nested.lock
  stderr=[FM_LOCK_NESTED] rc=1 held=[…/n3.h5.lock]
CMD: release outer rc=0 held=[] lock_exists=no
  PASS N3(b) H5 re-source preserve + NESTED + release intact
```

---

## shellcheck (R8)

```text
$ shellcheck skills/foreman/scripts/lib/lock.sh
shellcheck_exit=0
  PASS shellcheck clean
```

`bash -n skills/foreman/scripts/lib/lock.sh` also clean. No shellcheck stdout.

---

## Full regression run

```text
$ bash scratch-lock-harness.sh
# sections 1–8: six refusal codes + with_lock + re-source default — all PASS
# R1–R7: H1–H5, M1 — all PASS
# N1–N3: all PASS (a–e where applicable)
# R8 shellcheck PASS
# R9 previously-sound claims PASS
HARNESS DONE
HARNESS_EXIT=0
```

Captured in `scratch-lock-harness.out`.  
`grep -c FAIL` on that file: **0**. `grep -c PASS`: **31**.

### Six refusal codes (still demonstrated)

| Code | Observed stderr | exit |
|---|---|---|
| `FM_LOCK_PROBE_UNTRUSTED` | `FM_LOCK_PROBE_UNTRUSTED` | 1 |
| `FM_LOCK_FS_UNSUPPORTED` | `FM_LOCK_FS_UNSUPPORTED` | 1 |
| `FM_LOCK_NO_ATOMIC_PRIMITIVE` | `FM_LOCK_NO_ATOMIC_PRIMITIVE` | 1 |
| `FM_LOCK_UNAVAILABLE` | `FM_LOCK_UNAVAILABLE mkdir -p …: mkdir: Already exists` | 1 |
| `FM_LOCK_TIMEOUT` | `FM_LOCK_TIMEOUT` | 1 |
| `FM_LOCK_NESTED` | `FM_LOCK_NESTED` | 1 |

### Previously-sound claims (R9)

```text
CMD: default seam; parent absent; fm_lock_acquire …/sound_parent/x.lock 1
  stderr=[FM_LOCK_PROBE_UNTRUSTED] rc=1 parent_exists=no
  PASS no lock ordering stated (explicit refusal of ordering)
CMD: acquire .seq.lock -> mech=[flock] FM_LOCK_MECHANISM=[flock] rc=0
CMD: acquire .attempt.lock while .seq.lock held -> stderr=[FM_LOCK_NESTED]
  PASS three previously-sound claims intact
```

---

## Gaps / out of scope

| Item | Status |
|---|---|
| L2 trust evaluation body | Out of scope — seam still empty |
| L3 caller migration | Out of scope |
| L4 `tests/lock.bats` | Out of scope — scratch harness only |
| Full H4 matrix from r2 audit (`exec`, bare `return`, post-acquire/pre-trap signal window) | Not in REWORK N1–N3 proof list; N2 subshell addresses command-trap and `exit` cases that reopened H4. Direct `exec` replacing the wrapper shell remains a known shell-level limit if a caller uses `fm_with_lock PATH -- exec …` without an intermediate process. |

---

## Files touched this round

| Path | Action |
|---|---|
| `skills/foreman/scripts/lib/lock.sh` | N1 auto-FD; N2 trap save/restore + command subshell; N3 PID sentinel |
| `scratch-lock-harness.sh` | N1–N3 proofs; H4 assertion aligned to subshell exit semantics; background jobs clear inherited EXIT so trap-restore cannot delete harness ROOT |
| `scratch-lock-harness.out` | Full live capture |
| `REPORT.md` | Rewritten for round 3 |

No commit.
