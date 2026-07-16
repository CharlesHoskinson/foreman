# VERDICT: GO-WITH-CAUTIONS — bun:ffi can reliably drive Windows Job Objects, empirically verified end-to-end on Bun 1.3.14 / Windows 11 x64 in this session; cautions are the "experimental" API label, one open Windows-FFI crash issue affecting compiled executables under sustained high-frequency FFI polling, and mandatory use of the CREATE_SUSPENDED (or launcher-in-job) pattern to close the grandchild race.

Research lane A of 4 — Foreman v0.2.5 (foreman-launch). Date: 2026-07-16.
**This report includes original empirical evidence**: all claims marked [MEASURED] were executed today with portable `bun-windows-x64` v1.3.14 on Windows 11 Pro 10.0.26200 (x64), scripts in session scratchpad (`jobtest.ts`, `jobtest2.ts`, `launcher.ts`, `createproc.ts`).

---

## Q1. bun:ffi API surface + Windows x64 status

**Officially supported on Windows x64, officially labeled experimental.**

- Bun's docs: "`bun:ffi` is **experimental**, with known bugs and limitations, and should not be relied on in production"; Node-API is recommended as the stable alternative. `dlopen` takes a `.dll` path on Windows; the docs explicitly note Windows HANDLE values should be typed `u64`. [https://bun.com/docs/runtime/ffi, accessed 2026-07-16]
- FFIType coverage: `ptr/pointer`, `i8..i64`, `u8..u64`, `f32/f64`, `bool`, `cstring`, `buffer`, `function/callback`, `napi_env/napi_value`. **No struct-by-value support** — structs are not an FFIType; you marshal structs BY POINTER via `ArrayBuffer`/`TypedArray` + `ptr()`, which is exactly what Job Objects need. [https://bun.com/docs/runtime/ffi, accessed 2026-07-16]
- Pointers are represented as JS **numbers** (docs: 52-bit address space fits in 53-bit JS numbers). [MEASURED] However, an `FFIType.u64` **return value comes back as a `bigint`** (job handle printed `typeof bigint`), and bigints pass back into `u64` args without issue. Plan for `bigint` handles, not numbers.
- `dlopen("kernel32.dll", …)` works out of the box. [MEASURED] All 13 kernel32 functions I bound resolved and called correctly (see Q2/plan).
- Windows-FFI bug landscape (github.com/oven-sh/bun, searched via `gh` 2026-07-16):
  - **#31941 (OPEN, updated 2026-06-26)**: "Segfault in JSFFIFunction::trampoline on Windows **standalone executable** after sustained FFI polling" — exactly `dlopen("kernel32.dll")` console APIs called every 100 ms for ~2 h from a `bun build --compile` binary (OpenCode TUI). This is the single most relevant open bug for foreman-launch if it ships as a compiled exe AND calls FFI on a hot timer. [https://github.com/oven-sh/bun/issues/31941, accessed 2026-07-16]
  - #17157 (JSCallback crash when C calls back into JS) is **CLOSED**; irrelevant anyway — the Job Object flow needs no JSCallback. [https://github.com/oven-sh/bun/issues/17157, accessed 2026-07-16]
  - #28055 (OPEN): bun:ffi unsupported on **Windows ARM64** — x64 only today. [https://github.com/oven-sh/bun/issues/28055, accessed 2026-07-16]
  - #30717: dlopen regression in 1.3.14's Rust rewrite for **embedded** (`with {type:"file"}`) libraries in compiled output — does not affect system DLLs like kernel32, but is a churn signal. [https://github.com/oven-sh/bun/issues/30717, accessed 2026-07-16] [UNVERIFIED — single source, not reproduced]
  - Historic crash reports (#11936, #20072-closed) show FFI edge-case fragility; none reproduce in the Job Object call set. [https://github.com/oven-sh/bun/issues/11936, accessed 2026-07-16]

## Q2. Exact call sequence — and the race question

**[MEASURED] The full chain works from bun:ffi**: `CreateJobObjectW → SetInformationJobObject(JobObjectExtendedLimitInformation=9, KILL_ON_JOB_CLOSE=0x2000) → Bun.spawn → OpenProcess(pid) → AssignProcessToJobObject → IsProcessInJob=1 → TerminateJobObject → WaitForSingleObject=WAIT_OBJECT_0`, grandchild `ping.exe` spawned *after* assignment was killed with the job (child exit code = TerminateJobObject's code, observed 123/99/77).

**The race is REAL. [MEASURED]** Test C2: a grandchild spawned by the child *before* `AssignProcessToJobObject` **survived** `TerminateJobObject` (escaped pid observed alive, killed manually). Windows only auto-associates processes created *while the parent is in the job* ("By default, all child processes are associated with the immediate job") — assignment is not retroactive to existing descendants. [https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject, accessed 2026-07-16]

**Race-safe fix works entirely in bun:ffi. [MEASURED]** Test D: `CreateProcessW(NULL, cmdline, …, CREATE_SUSPENDED|CREATE_NO_WINDOW, …, &STARTUPINFOW, &PROCESS_INFORMATION)` with both structs as `Uint8Array`s (`si` = 104 bytes, `cb=104` at offset 0; `pi` = 24 bytes) succeeded; hProcess/hThread/pid read back correctly from the `pi` buffer via `DataView`; assigned to job while suspended; `ResumeThread` returned prior-suspend-count 1; `TerminateJobObject` then killed the whole tree (exit 77). Command line must be a **mutable** UTF-16 buffer (`Buffer.from(str+"\0","utf16le")`) per CreateProcessW's contract. So yes — bun:ffi handles Win32 struct-by-pointer marshaling for this API.
- Even better (Windows 10 1607+): `PROC_THREAD_ATTRIBUTE_JOB_LIST` in a `STARTUPINFOEXW` assigns the job **before the initial thread runs** — "no race window" (Raymond Chen). Not tested here; CREATE_SUSPENDED suffices. [https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812, accessed 2026-07-16] [https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute, accessed 2026-07-16]
- Alternative that keeps `Bun.spawn` (and its stdio/exit plumbing): **put the launcher itself in the job first** — children then inherit membership atomically at creation. Trade-off: TerminateJobObject/handle-close kills the launcher too, so this suits a single "everything dies with the launcher" safety-net job, with per-service jobs layered via the CreateProcessW path when targeted kills are needed.
- Caveat of the pure-CreateProcessW path: you lose Bun.spawn's stdout/stderr piping and `exited` promise; you'd wire stdio handles into STARTUPINFOW yourself or poll `WaitForSingleObject(hProcess, 0)`/`GetExitCodeProcess` (both [MEASURED] working). Do NOT call blocking `WaitForSingleObject(h, INFINITE)` on the main thread — bun:ffi calls are synchronous and would freeze the event loop (Bun FFI is blocking-only; async FFI is an open request, oven-sh/bun#5490).
- Nested jobs: since Windows 8, a process already in a job (e.g., launcher running under a CI job object) can still be assigned to a new job if nesting rules hold; pre-Win8 this failed with ERROR_ACCESS_DENIED. On Win11 this is a non-issue. [https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject, accessed 2026-07-16]
- Prior art for Win32-from-bun:ffi: **Kilo-Org/kilocode** ships `packages/opencode/src/kilocode/background-process/windows-job.ts` — the identical 8-function kernel32 dlopen (CreateJobObjectW `returns:"u64"`, 144-byte `Uint8Array` with `setUint32(16, 0x2000, true)`, OpenProcess `0x0101`) in a production OpenCode fork. [https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/kilocode/background-process/windows-job.ts, accessed 2026-07-16] Also **ObscuritySRL/bun-win32** (zero-dependency Win32 FFI bindings incl. kernel32 process APIs; ~16 stars, active, no releases yet — reference material, not a dependency). [https://github.com/ObscuritySRL/bun-win32, accessed 2026-07-16]

## Q3. Handle lifetime + crash guarantee

- **No GC hazard. [MEASURED]** bun:ffi returns the HANDLE as a plain `bigint` (u64) — a value, not an object; no finalizer is attached to FFI return values (finalizers exist only where you opt in, e.g. `toArrayBuffer`'s deallocator). [https://bun.com/docs/runtime/ffi, accessed 2026-07-16] The kernel handle stays open until you call `CloseHandle` or the process dies; keep the bigint in a module-level variable purely for bookkeeping.
- **KILL_ON_JOB_CLOSE**: "Causes all processes associated with the job to terminate **when the last handle to the job is closed**" (flag 0x00002000, requires JOBOBJECT_EXTENDED_LIMIT_INFORMATION). [https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information, accessed 2026-07-16]
- **OS-level crash guarantee**: "Terminating a process has the following results: … All kernel objects are closed" — handle closure is performed by the kernel on any termination path (ExitProcess, TerminateProcess, fatal exception), not by user code. [https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process, accessed 2026-07-16]
- **[MEASURED] Test B**: launcher (Bun) created job+assigned child, then was hard-killed externally with `Stop-Process -Force` (TerminateProcess — no cleanup code runs). Child `ping.exe` was dead within 2 s. KILL_ON_JOB_CLOSE fires on hard launcher death. Caveat: it's "last handle" — if you duplicate/inherit the job handle into another live process, teardown waits for that handle too.

## Q4. Breaking-change risk + fallbacks

- bun:ffi has carried the "experimental / not for production" label continuously; the core surface used here (`dlopen`, `FFIType`, `ptr`, `CString`) has been shape-stable since 2022, but internals churn: Bun 1.3.14 (June 2026) landed a Rust rewrite of parts of this path with at least one dlopen regression (#30717, embedded-library case). [https://bun.com/docs/runtime/ffi; https://github.com/oven-sh/bun/issues/30717, accessed 2026-07-16] Behavior/doc mismatches exist (docs imply number returns; u64 actually returns bigint [MEASURED]) — pin the Bun version and keep a smoke test in CI.
- **koffi** (N-API-based FFI with real struct types) documents Node.js/Electron targets only; no official Bun support claim found on koffi.dev, and Bun's N-API layer still has behavioral-parity gaps. Treat "koffi under Bun" as plausible but [UNVERIFIED]. [https://koffi.dev/; https://github.com/oven-sh/bun/issues/158, accessed 2026-07-16]
- `ffi-napi`/`cbind` lineage is effectively dead on modern runtimes (node-ffi-napi maintainers request archival). [https://github.com/node-ffi-napi/node-ffi-napi/issues/269, accessed 2026-07-16]
- Realistic fallback ladder: (1) bun:ffi as planned; (2) a ~50-line prebuilt N-API addon exposing just the 6 job calls (Bun's recommended stable path); (3) Go (x/sys/windows has first-class Job Object support) — the stated project fallback.

## Q5. Prior art — npm/bun packages wrapping Job Objects

**No maintained npm package wraps Job Objects directly** — Node can't reach them without a native addon, so the ecosystem standardized on `taskkill /T /F` process-tree enumeration, which is NOT crash-safe (kills a snapshot; no kill-on-close guarantee):
- `tree-kill`: shells out to `taskkill /pid X /T /F` on Windows. [https://www.npmjs.com/package/tree-kill, accessed 2026-07-16]
- `taskkill`, `process-tree-kill`, `windows-kill`: same family, same enumeration race (a process that spawns between snapshot and kill escapes).
- Kilo-Org/kilocode's `windows-job.ts` (Q2) is the only found production **bun:ffi** Job Object implementation — in-tree, not published as a package. [accessed 2026-07-16]
- ObscuritySRL/bun-win32 publishes `@bun-win32/kernel32` bindings (pre-release, low adoption). [UNVERIFIED quality — not exercised]
- Conclusion: foreman-launch would be writing ~120 lines of first-party FFI, not adopting a dependency. Given the kilocode precedent and today's measurements, that is tractable.

---

## Minimal viable call plan (all [MEASURED] working, Bun 1.3.14 x64)

```ts
import { dlopen, ptr, FFIType } from "bun:ffi";
const k32 = dlopen("kernel32.dll", {
  CreateJobObjectW:        { args: ["ptr","ptr"],                    returns: "u64" }, // -> bigint job handle
  SetInformationJobObject: { args: ["u64","u32","ptr","u32"],        returns: "i32" }, // (job, 9, ptr(buf144), 144)
  CreateProcessW:          { args: ["ptr","ptr","ptr","ptr","i32","u32","ptr","ptr","ptr","ptr"], returns: "i32" },
  ResumeThread:            { args: ["u64"],                          returns: "u32" },
  OpenProcess:             { args: ["u32","i32","u32"],              returns: "u64" }, // 0x0101|0x100000, 0, pid
  AssignProcessToJobObject:{ args: ["u64","u64"],                    returns: "i32" },
  IsProcessInJob:          { args: ["u64","u64","ptr"],              returns: "i32" },
  TerminateJobObject:      { args: ["u64","u32"],                    returns: "i32" },
  WaitForSingleObject:     { args: ["u64","u32"],                    returns: "u32" }, // finite timeouts only
  GetExitCodeProcess:      { args: ["u64","ptr"],                    returns: "i32" },
  CloseHandle:             { args: ["u64"],                          returns: "i32" },
  GetLastError:            { args: [],                               returns: "u32" },
});
```
1. `CreateJobObjectW(null, null)` → bigint handle; fail if 0.
2. Build `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` = `new Uint8Array(144)` (x64: basic 64 B + IO_COUNTERS 48 B + 4×SIZE_T 32 B); `DataView.setUint32(16, 0x2000, true)` (LimitFlags @ offset 16 = KILL_ON_JOB_CLOSE); `SetInformationJobObject(job, 9, ptr(buf), 144)`.
3. Race-safe spawn: mutable cmdline `Buffer.from(cmd + "\0", "utf16le")`; `si = Uint8Array(104)` with `setUint32(0,104,true)`; `pi = Uint8Array(24)`; `CreateProcessW(null, ptr(cmdline), null, null, 0, 0x4|0x08000000, null, null, ptr(si), ptr(pi))`; read `hProcess=getBigUint64(0)`, `hThread=getBigUint64(8)`, `pid=getUint32(16)`.
   - Convenience path (accepts tiny race, mitigate by assigning immediately after spawn): `Bun.spawn(...)` → `OpenProcess(0x0101|SYNCHRONIZE, 0, child.pid)` → assign. Belt-and-braces: also keep the launcher itself inside one umbrella kill-on-close job.
4. `AssignProcessToJobObject(job, hProcess)` (while suspended) → `ResumeThread(hThread)`.
5. Liveness: poll `WaitForSingleObject(hProcess, 0)` (258=running, 0=exited) + `GetExitCodeProcess`; never INFINITE on the event-loop thread.
6. Kill: `TerminateJobObject(job, code)` — synchronous tree kill. Crash safety: do nothing; kernel closes the job handle on launcher death and KILL_ON_JOB_CLOSE reaps the tree.
7. Cleanup: `CloseHandle(hThread/hProcess/job)`.
Error handling caveat: call `GetLastError()` immediately after the failing FFI call and before ANY other Bun API touches the thread; correctness of last-error preservation across the FFI boundary is [UNVERIFIED] beyond the happy-path tests here.

## RISKS (ranked)

1. **Open Windows FFI segfault #31941** — trampoline crash in `bun build --compile` standalone exes after hours of 100 ms-interval FFI polling on Win x64. Mitigation: keep FFI calls event-driven/low-frequency (launcher setup/teardown + coarse liveness polls), pin Bun, track the issue. If foreman-launch must hot-poll via FFI in a compiled exe, this is the NO-GO tripwire.
2. **"Experimental" label + internals churn** (1.3.14 Rust rewrite already regressed one dlopen path). Mitigation: pin Bun version; CI smoke test running the exact Test A/B/D suite; the surface used is 12 plain C functions, no callbacks, no struct-by-value — minimal API exposure.
3. **Grandchild race if the Bun.spawn-then-assign shortcut is used** — empirically confirmed escape. Mitigation: CREATE_SUSPENDED path (measured working) or launcher-in-umbrella-job; optionally PROC_THREAD_ATTRIBUTE_JOB_LIST later.
4. **Stdio plumbing under CreateProcessW** — losing Bun.spawn's pipes means hand-wiring STARTUPINFOW handles (untested here) or accepting log-file redirection for supervised children.
5. **Blocking FFI on the event loop** — misuse of INFINITE waits freezes the supervisor; discipline required (finite timeouts / poll loop).
6. **Platform scope** — bun:ffi has no Windows ARM64 (#28055); x64-only launcher until Bun ships it.
7. **Doc/behavior drift** (u64→bigint vs docs' number narrative) — minor, but type all handle plumbing as `bigint` and assert `typeof` in the smoke test.

## Empirical test log (this session, 2026-07-16)
- Bun 1.3.14 portable zip (github releases `bun-windows-x64`), Windows 11 Pro 26200.
- Test A/A2: create job → KILL_ON_JOB_CLOSE → Bun.spawn cmd.exe → OpenProcess/Assign → IsProcessInJob=1 → grandchild born in job → TerminateJobObject → WaitForSingleObject=0, child exit=99, zero surviving grandchildren. **PASS**
- Test B: launcher hard-killed via `Stop-Process -Force`; job child dead ≤2 s. **PASS (kill-on-close on crash-path)**
- Test C2: grandchild spawned pre-assignment survived TerminateJobObject. **RACE CONFIRMED**
- Test D: CreateProcessW(CREATE_SUSPENDED) + STARTUPINFOW/PROCESS_INFORMATION by pointer → assign suspended → ResumeThread=1 → TerminateJobObject → wait=0, exit=77. **PASS (race-safe path)**
