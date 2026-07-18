# posix-cascade-parity Implementation Plan (v0.2.7.5 · package 5/7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS: `openspec/changes/posix-cascade-parity/specs/launcher-posix/spec.md`.
> POSIX work runs on WSL; the Windows launcher build is FROZEN.

**Goal:** Give the POSIX launcher build a kernel-guaranteed whole-tree kill
(the KILL_ON_JOB_CLOSE analog) by bootstrapping it as PID-namespace init, with
a subreaper safety net and the existing setsid/pgid path as the graceful fast
path.

**Architecture:** `launcher/src/posix.ts` already has `wrapWithSetsid` +
`terminateProcessGroup` (kill -pgid). This adds: a `unshare --pid --mount-proc
--fork --kill-child` bootstrap so the launcher is namespace init (kernel
SIGKILLs the whole namespace on its death); a `prctl(PR_SET_CHILD_SUBREAPER,1)`
call via bun:ffi; a fallback ladder; and the frozen exit-code/heartbeat
contract preserved.

**Tech Stack:** Bun 1.3.14 + bun:ffi (libc dlopen), TypeScript, util-linux
`unshare`, bats-core (WSL-guarded), WSL2 Ubuntu (probed: unshare unprivileged,
cgroup v2, systemd all present).

## Global constraints

Strict mode for bash; the Windows build carries ZERO diff. Every bats test is
WSL-guarded (skip on non-WSL). Contract (exit codes child/124/125, heartbeat
schema) is frozen — assert parity, don't change it. Fall back + LOG on any
`unshare` failure, never silently proceed without the guarantee.

## File structure

- Modify `launcher/src/posix.ts` — subreaper prctl + the pidns bootstrap entry.
- Create `launcher/src/posix-bootstrap.ts` (or a shell wrapper) — the
  `unshare` re-exec.
- Modify `launcher/README.md` — asymmetry → closed-via-pidns.
- Modify `tests/launcher.bats` — WSL kill-shot + fallback-downgrade cases.
- Modify `references/orchestration-hardening.md` — POSIX teardown doctrine.

---

### Task 1: subreaper safety net (prctl via bun:ffi)

- [ ] **Step 1: Write the failing bun test** (`launcher/tests/posix.test.ts`,
  WSL/linux-guarded) — the launcher calls `prctl(PR_SET_CHILD_SUBREAPER,1)` at
  startup and continues (logging) if it fails. Assert via a small FFI probe
  that after the call, `prctl(PR_GET_CHILD_SUBREAPER)` reads back 1.
- [ ] **Step 2: Run to verify it fails** (`bun test`, on WSL).
- [ ] **Step 3: Implement** a `setChildSubreaper()` in `posix.ts`:
  `dlopen("libc.so.6", { prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64,
  FFIType.u64, FFIType.u64], returns: FFIType.i32 } })`, call
  `prctl(PR_SET_CHILD_SUBREAPER=36, 1, 0, 0, 0)` once on startup (no fork
  around it); on non-zero return, log and continue.
- [ ] **Step 4: Run to verify it passes** (WSL).
- [ ] **Step 5: Commit** `git commit -m "feat(launcher-posix): PR_SET_CHILD_SUBREAPER safety net via bun:ffi"`.

---

### Task 2: pidns bootstrap (the cascade guarantee)

- [ ] **Step 1: Write the failing bats test** (`tests/launcher.bats`,
  WSL-guarded) — the kill-shot: a CMD under the pidns-wrapped POSIX launcher
  spawns a grandchild that `setsid`+double-forks to escape its pgid; killing
  the launcher leaves ZERO survivors of the recorded pids (whereas the
  pgid-only path would leave the escapee).

```bash
# tests/launcher.bats (WSL-guarded)
@test "posix pidns launcher reaps a setsid/double-fork escapee on kill" {
  command -v unshare >/dev/null || skip "unshare absent"
  # build the POSIX launcher (bun build --compile --target=bun-linux-x64) in WSL
  # spawn: launcher -- bash -c 'setsid bash -c "(sleep 300 & echo $! > pid) &"; ...'
  # record the escapee pid; kill the launcher; poll: kill -0 <escapee> fails within 5s
}
```

- [ ] **Step 2: Run to verify it fails** (pgid-only path leaves the escapee).
- [ ] **Step 3: Implement** the bootstrap: the POSIX launcher is invoked (or
  self-re-execs) under `unshare --pid --mount-proc --fork --kill-child --
  <launcher> …`, making it namespace init. `--mount-proc` gives a correct
  `/proc` for the launcher's own telemetry — VERIFY it does NOT change the
  heartbeat `pid`/`job_id` values the launcher reports (the pid is namespace-
  local after wrapping; if that shifts the reported pid, record the host pid
  before entering the namespace so the heartbeat stays consistent with what a
  host-side kill-shot targets). Detect `unshare` availability; on
  absence/failure fall back to the setsid+pgid path with a logged degraded
  marker. NOTE: each WSL bats test must actually `bun build --compile
  --target=bun-linux-x64` the Linux exe first (the Task-2 test body is
  pseudocode for that build+spawn+kill sequence).
- [ ] **Step 4: Run to verify it passes** (WSL) — zero survivors; and a
  forced-`unshare`-absent run logs the downgrade + still reaps via pgid.
- [ ] **Step 5: Commit** `git commit -m "feat(launcher-posix): pidns-init bootstrap = KILL_ON_JOB_CLOSE parity + fallback"`.

---

### Task 3: contract parity

- [ ] **Step 1: Write the failing test** — under the pidns wrapper, a CMD
  exiting 3 makes the launcher exit 3 with a final `alive:false` heartbeat,
  schema `{ts,launcher_pid,pid,job_id,alive,stdout_bytes,stderr_bytes,elapsed_s}`
  identical to the Windows build; 124 timeout / 125 launcher-error preserved.
- [ ] **Step 2: Run to verify it fails** (if the wrapper altered anything).
- [ ] **Step 3: Implement** any needed passthrough so `job_id` on POSIX carries
  the namespace/pgid id and exit codes/heartbeat are byte-parity.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "test(launcher-posix): exit-code + heartbeat contract parity under pidns"`.

---

### Task 4: docs

- [ ] **Step 1** — Rewrite `launcher/README.md`'s "POSIX asymmetry" section:
  no-kernel-cascade → closed via pidns-init; the `--kill-child` reverse edge;
  the subreaper net; the fallback ladder (per-session cgroup +
  `systemd-run --scope --collect`); honest availability notes (needs
  `unshare`; fallback needs systemd/cgroup-v2). Update
  `references/orchestration-hardening.md` likewise.
- [ ] **Step 2: docs-check + Commit** `git commit -m "docs(launcher-posix): POSIX cascade closed via pidns"`.

---

### Task 5: package proof + full gate

- [ ] **Step 1** — The WSL kill-shot IS the SC-style proof — capture it in the
  FOREMAN_REPORT. `bun test` (launcher) + WSL `tests/launcher.bats` under the
  mutex + docs-check; Windows `tests/launcher.bats` unchanged.
- [ ] **Step 2: Commit** the proof.

## Self-review

- Coverage: R(pidns init)→T2; R(subreaper)→T1; R(contract)→T3; R(README)→T4.
  All covered.
- Windows build untouched (stated; T3 asserts parity, not change).
- Fallback-on-unshare-absence tested (T2 Step 4).
- Names: `setChildSubreaper`, the `unshare … --kill-child` invocation
  consistent with the spec.

## Acceptance

Killing the pidns-wrapped launcher leaves zero survivors of a
setsid/double-fork escapee on WSL; fallback logs its downgrade; contract
byte-parity; docs updated; suite + docs-check green. Archive on ship.
