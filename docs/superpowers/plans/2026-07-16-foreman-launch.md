# foreman-launch (Bun) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan executes through the
> **foreman skill** — tasks become five-part specs routed to implementer lanes
> in isolated worktrees, architect-verified, cross-vendor audited. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `foreman-launch`, a self-contained compiled executable that owns
every vendor-CLI process tree via Windows Job Objects (orphans impossible by
construction), emits heartbeats, and performs graded stops — v0.2.5 Task 1.

**Architecture:** TypeScript on Bun 1.3.14 (pinned), compiled with
`bun build --compile`. Child spawned with `Bun.spawn` (stdio streaming, exit
codes) and assigned to a dedicated Job Object immediately after spawn via six
`bun:ffi` kernel32 calls. `KILL_ON_JOB_CLOSE` makes every exit path — timeout,
cancel, launcher crash — reap the whole tree at OS level. POSIX build of the
same source uses setsid/kill(-pgid).

**Tech Stack:** Bun 1.3.14, bun:ffi (kernel32.dll), bun test, bats (harness-
level tests against the compiled binary), signtool (release signing).

**Research base (all verdicts GO-WITH-CAUTIONS, 2026-07-16, empirically
validated on this host):** `docs/research/bun025/REPORT_{ffi,compile,process,ecosystem}.md`

## Global Constraints

- Bun pinned to **1.3.14** via `.bun-version` AND `package.json`
  `"packageManager": "bun@1.3.14"`; launcher asserts `Bun.version === "1.3.14"`
  at startup and warns (not fails) on drift. Adopt 1.4.x (Rust core) only
  after 2+ patch releases (ecosystem report).
- **No hot FFI polling** — oven-sh/bun#31941 (trampoline segfault under
  sustained 100 ms FFI polling in compiled exes). Exit detection uses
  `proc.exited` (no FFI wait loop); heartbeats every 15 s are timer-driven JS.
- FFI surface is EXACTLY six kernel32 calls (verified working from compiled
  exes): CreateJobObjectW, SetInformationJobObject, OpenProcess,
  AssignProcessToJobObject, TerminateJobObject, CloseHandle. No CreateProcessW
  path in v0.2.5 (suspended-start deferred — see Risks).
- Verified Win32 constants (ffi report, live-tested):
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION = 144-byte buffer, LimitFlags at
  offset 16, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000,
  JobObjectExtendedLimitInformation class = 9,
  OpenProcess access = PROCESS_SET_QUOTA|PROCESS_TERMINATE = 0x0101.
- Handles are plain bigints (no GC finalizers); hold the job handle in a
  module-level variable for launcher lifetime; never CloseHandle it while the
  child runs (closing it IS the kill switch).
- Bun.spawn hazards (process report): always pipe stdout AND stderr together
  (#15564); never pass stdin as an async iterable (#33020); windowsHide true;
  NTSTATUS exit-code passthrough is UNVERIFIED → Task 2 test asserts it.
- Compile constraints (compile report): `--target=bun-windows-x64`; NO
  `--bytecode` when cross-compiling (#18416); no `--env=inline` (#17406);
  never install as symlink (#18193); builds are not reproducible — CI builds
  once, publishes artifact + SHA256; post-build signtool signing (works since
  Bun 1.2.23); LGPL notice for redistributed binaries (embedded
  JavaScriptCore) — same pattern Claude Code uses.
- Contract (frozen; consumed by lane-run.sh in v0.2.5 T2):
  `foreman-launch [--timeout SECS] [--grace SECS=10] [--heartbeat-file F]
  [--heartbeat-interval SECS=15] -- CMD [ARGS...]`
  stdout/stderr of CMD pass through unmodified; heartbeat JSON lines go ONLY
  to F; exit code = child's; **124** = timeout kill; **125** = launcher error.
- Repo layout: launcher lives in `launcher/` (its own package.json, src/,
  tests/); compiled artifacts in `launcher/dist/` (gitignored); bats-level
  tests in `tests/launcher.bats` run against the compiled binary.

---

### Task 1: launcher package scaffold + version pin + FFI smoke module

**Files:**

- Create: `launcher/package.json`, `launcher/.bun-version`, `launcher/bunfig.toml`
- Create: `launcher/src/win/jobobject.ts`
- Test: `launcher/tests/jobobject.test.ts`

**Interfaces:**

- Produces: `createKillOnCloseJob(): bigint` (job handle);
  `assignPidToJob(job: bigint, pid: number): void` (throws on failure);
  `terminateJob(job: bigint, exitCode: number): void`;
  `closeJob(job: bigint): void`; all throw `JobObjectError` with the Win32
  `GetLastError` code on failure. On non-Windows platforms every export
  throws `UnsupportedPlatformError` (POSIX path never imports this module).

- [ ] **Step 1: Write the failing test** (`launcher/tests/jobobject.test.ts`)

```ts
import { describe, test, expect } from "bun:test";
import { createKillOnCloseJob, assignPidToJob, terminateJob, closeJob } from "../src/win/jobobject";

const windows = process.platform === "win32";

describe.if(windows)("jobobject", () => {
  test("creates a job handle as bigint", () => {
    const job = createKillOnCloseJob();
    expect(typeof job).toBe("bigint");
    expect(job).not.toBe(0n);
    closeJob(job);
  });

  test("terminates an assigned child and its grandchild", async () => {
    const job = createKillOnCloseJob();
    // child spawns a grandchild that would outlive a naive kill
    const child = Bun.spawn(["cmd", "/c", "start /b ping -n 60 127.0.0.1 >nul & ping -n 60 127.0.0.1 >nul"], {
      stdout: "pipe", stderr: "pipe", windowsHide: true,
    });
    assignPidToJob(job, child.pid);
    await Bun.sleep(500); // let the grandchild spawn INSIDE the job
    terminateJob(job, 1);
    await child.exited;
    // no process in the tree survives: pgrep-equivalent via tasklist
    const scan = Bun.spawnSync(["tasklist", "/FI", `PID eq ${child.pid}`]);
    expect(scan.stdout.toString()).not.toContain(String(child.pid));
    closeJob(job);
  });

  test("assignPidToJob throws JobObjectError on a dead pid", () => {
    const job = createKillOnCloseJob();
    expect(() => assignPidToJob(job, 4_000_000)).toThrow("JobObjectError");
    closeJob(job);
  });

});
```

- [ ] **Step 2: Run to verify fail** — `cd launcher && bun test` → FAIL
  (module missing).

- [ ] **Step 3: Implement `launcher/src/win/jobobject.ts`**

```ts
// Windows Job Object ownership: the ONLY kill primitive foreman trusts.
// KILL_ON_JOB_CLOSE means every exit path (timeout, cancel, launcher crash)
// reaps the whole tree at kernel level. Handles are plain bigints — no GC
// finalizers (verified: docs/research/bun025/REPORT_ffi.md).
import { dlopen, FFIType, ptr } from "bun:ffi";

export class JobObjectError extends Error {
  constructor(call: string, public lastError: number) {
    super(`JobObjectError: ${call} failed (GetLastError=${lastError})`);
  }

}
export class UnsupportedPlatformError extends Error {}

const JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JobObjectExtendedLimitInformation = 9;
const PROCESS_SET_QUOTA_AND_TERMINATE = 0x0101;

function lib() {
  if (process.platform !== "win32") throw new UnsupportedPlatformError();
  return dlopen("kernel32.dll", {
    CreateJobObjectW:        { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
    SetInformationJobObject: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    OpenProcess:             { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    AssignProcessToJobObject:{ args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    TerminateJobObject:      { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    CloseHandle:             { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError:            { args: [], returns: FFIType.u32 },
  });

}
let k32: ReturnType<typeof lib> | null = null;
const k = () => (k32 ??= lib());

export function createKillOnCloseJob(): bigint {
  const job = k().symbols.CreateJobObjectW(null, null) as bigint;
  if (job === 0n) throw new JobObjectError("CreateJobObjectW", k().symbols.GetLastError());
  const info = new Uint8Array(JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE);
  new DataView(info.buffer).setUint32(LIMIT_FLAGS_OFFSET, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, true);
  const ok = k().symbols.SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr(info), info.length);
  if (!ok) { const e = k().symbols.GetLastError(); k().symbols.CloseHandle(job); throw new JobObjectError("SetInformationJobObject", e); }
  return job;

}

export function assignPidToJob(job: bigint, pid: number): void {
  const h = k().symbols.OpenProcess(PROCESS_SET_QUOTA_AND_TERMINATE, 0, pid) as bigint;
  if (h === 0n) throw new JobObjectError("OpenProcess", k().symbols.GetLastError());
  const ok = k().symbols.AssignProcessToJobObject(job, h);
  const e = ok ? 0 : k().symbols.GetLastError();
  k().symbols.CloseHandle(h);
  if (!ok) throw new JobObjectError("AssignProcessToJobObject", e);

}

export function terminateJob(job: bigint, exitCode: number): void {
  if (!k().symbols.TerminateJobObject(job, exitCode))
    throw new JobObjectError("TerminateJobObject", k().symbols.GetLastError());
}

export function closeJob(job: bigint): void {
  k().symbols.CloseHandle(job);

}
```

- [ ] **Step 4: Run to verify pass** — `cd launcher && bun test` → 3 pass
  (Windows). Also `bun test` on WSL → all skipped, 0 fail.

- [ ] **Step 5: Architect commits** `feat(launcher): kernel32 job-object module (KILL_ON_JOB_CLOSE, tree-terminate)`

---

### Task 2: supervised spawn — job-owned child with heartbeats and graded stop

**Files:**

- Create: `launcher/src/supervise.ts`
- Create: `launcher/src/posix.ts`
- Test: `launcher/tests/supervise.test.ts`

**Interfaces:**

- Consumes: Task 1 exports.
- Produces: `supervise(opts: {cmd: string[]; timeoutSecs?: number;
  graceSecs: number; heartbeatFile?: string; heartbeatIntervalSecs: number;
  onEvent?: (e: LaunchEvent) => void}): Promise<{exitCode: number;
  timedOut: boolean}>`. `LaunchEvent` = `{ts: string; type: "spawned" |
  "heartbeat" | "grace" | "killed" | "exited"; pid?: number;
  stdoutBytes?: number; stderrBytes?: number}`. Heartbeat JSON lines appended
  to heartbeatFile (atomic single-line writes).

Behavior (all from research constraints): spawn via `Bun.spawn` with
`stdout: "pipe", stderr: "pipe", windowsHide: true`; **assign to job
immediately after spawn returns** (residual microsecond grandchild race
documented — see Risks); passthrough both streams to own stdout/stderr while
counting bytes; heartbeat timer (JS `setInterval`, never FFI polling) writes
`{ts,pid,alive,stdout_bytes,stderr_bytes,elapsed_s}`; on timeout: emit
`grace` event → request cooperative stop by closing child stdin → wait
graceSecs → `terminateJob` → resolve `{exitCode:124-style, timedOut:true}`
(the CLI wrapper maps to exit 124); on child exit: cancel timers, `closeJob`,
resolve child's real exitCode. POSIX (`posix.ts`): same contract with
`Bun.spawn` + `detached`-equivalent process group via `setsid` wrapper and
`process.kill(-pid)`.

- [ ] **Step 1: failing tests** — key cases (full code in worktree):
  child exits 0 → `{exitCode:0, timedOut:false}`, job closed;
  child exits 7 → exitCode 7 passthrough; **NTSTATUS probe**: child is
  `["cmd","/c","exit 3221225477"]` → assert exitCode surfaces non-zero and
  record the actual value in the test log (UNVERIFIED passthrough — this
  test settles it); timeout: child `ping -n 60` with timeoutSecs 2,
  graceSecs 1 → timedOut true, tree gone (tasklist scan), duration < 8 s;
  heartbeat file grows and parses as JSON lines with increasing
  stdout_bytes when child prints.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement supervise.ts + posix.ts per the interface.**
- [ ] **Step 4: run → PASS on Windows; POSIX cases pass under WSL.**
- [ ] **Step 5: Architect commits** `feat(launcher): supervised spawn — job ownership, heartbeats, graded stop`

---

### Task 3: CLI entry + compiled binary + bats harness tests

**Files:**

- Create: `launcher/src/launch.ts` (arg parsing → supervise; exit-code
  contract 124/125; `--version` prints launcher+Bun versions)
- Create: `launcher/build.ps1` (the compile report's build recipe verbatim:
  pinned `bun ci`, `bun build --compile --minify --target=bun-windows-x64
  --compile-exec-argv="--smol" ... --outfile dist/foreman-launch.exe`,
  optional signtool block, SHA256 print; plus `--target=bun-linux-x64` build)
- Create: `tests/launcher.bats` (harness level, against the compiled exe)
- Modify: `.gitignore` (`launcher/dist/`)

**Interfaces:**

- Consumes: Task 2 `supervise`.
- Produces: `dist/foreman-launch.exe` honoring the frozen contract (Global
  Constraints) — the artifact lane-run.sh (v0.2.5 T2) invokes.

- [ ] **Step 1: bats tests first** — `foreman-launch -- cmd /c "echo hi"`
  → stdout contains hi, exit 0; `-- cmd /c "exit 9"` → exit 9;
  `--timeout 2 --grace 1 -- ping -n 60 127.0.0.1` → exit 124, tree dead,
  wall-clock < 10 s; **crash-safety test**: start launcher wrapping a
  ping-tree, `taskkill /F` the LAUNCHER pid, assert the ping tree is gone
  within 5 s (KILL_ON_JOB_CLOSE — the F1 kill shot); missing `--` → exit
  125 + usage; heartbeat file contains parseable JSON lines.
- [ ] **Step 2: run → FAIL (no binary).**
- [ ] **Step 3: implement launch.ts; build via build.ps1.**
- [ ] **Step 4: bats → all pass; `bun test` in launcher/ still green.**
- [ ] **Step 5: Architect commits** `feat(launcher): CLI + compiled foreman-launch + harness tests`

---

### Task 4: CI smoke + docs + manifest wiring

**Files:**

- Create: `launcher/tests/ffi-smoke.ts` (compile report's smoke: compiled exe
  dlopens kernel32, calls GetTickCount64, prints FFI_OK — guards Bun-version
  bumps against #31941-class regressions)
- Modify: `env/reference-manifest.toml` (+`bun` dev-profile tool, pinned
  check `bun --version` == 1.3.14; `foreman-launch` presence check)
- Modify: `env/bootstrap-windows.ps1`, `env/bootstrap-wsl.sh` (user-scoped
  bun install per ecosystem report: official install.ps1 / install script)
- Create: `skills/foreman/references/launcher.md` (contract, exit codes,
  heartbeat schema, LGPL redistribution notice, version policy incl. 1.4.x
  soak rule, #31941 tripwire, grandchild-race residual + suspended-start
  escalation path)
- [ ] **Steps:** smoke test green from compiled exe → manifest/bootstrap
  entries + tool-check recognition → docs → full bats suite + docs-check →
  Architect commits `feat(launcher): CI smoke, manifest, bootstrap, doctrine`

---

## Risks (ranked, from the four reports)

1. **bun:ffi officially experimental**; #31941 trampoline segfault under
   sustained 100 ms FFI polling in compiled exes → design never hot-polls FFI
   (constraint), CI smoke guards regressions, fallback ladder: tiny N-API
   addon → Go port (documented cost: small, single file).
2. **Grandchild assignment race** (empirically real): a child can spawn a
   grandchild in the microseconds before AssignProcessToJobObject. Accepted
   for v0.2.5 (vendor CLIs boot slower than the window; taskkill /T /F sweep
   in lane-run as belt-and-braces); escalation path = FFI CreateProcessW
   CREATE_SUSPENDED (proven working in research) if ever observed.
3. **Rust-core transition**: stable frozen at 1.3.14, 1.4.x canary → pin +
   soak rule; version assert at startup.
4. **Defender/SmartScreen false positives** on bun-compiled exes → sign
   releases; document local-build path.
5. **No Windows ARM64 FFI** (#28055) → x64-only artifact for now; noted in
   launcher.md.

## Sequencing

Executes as v0.2.5 Task 1 (critical path). v0.2.5 T2 (lane-run integration)
consumes the frozen CLI contract. T0 (pueue) runs in parallel. Plan-time
Codex audit of Tasks 1–2 code blocks BEFORE implementation (durable-lanes
practice).
