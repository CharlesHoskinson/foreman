// Windows Job Object ownership: the ONLY kill primitive foreman trusts.
// KILL_ON_JOB_CLOSE means every exit path (timeout, cancel, launcher crash)
// reaps the whole tree at kernel level. Handles are plain bigints — no GC
// finalizers (verified: docs/research/bun025/REPORT_ffi.md).
//
// FFI surface is EXACTLY six kernel32 calls (CreateJobObjectW,
// SetInformationJobObject, OpenProcess, AssignProcessToJobObject,
// TerminateJobObject, CloseHandle) PLUS GetLastError, which is
// diagnostics-only and does not count toward "six" — it is read
// immediately after any failing call above, never speculatively, and never
// polled (oven-sh/bun#31941: sustained FFI polling segfaults the trampoline
// in compiled exes; nothing here polls).
//
// Never set handle inheritance on Bun.spawn calls that feed pids into this
// module — a duplicated job handle in a child delays KILL_ON_JOB_CLOSE.
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
    CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
    SetInformationJobObject: {
      args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    AssignProcessToJobObject: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    TerminateJobObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
  });
}
let k32: ReturnType<typeof lib> | null = null;
const k = () => (k32 ??= lib());

/** Creates a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE set. Hold the
 * returned handle in a module-level var for the launcher's lifetime — closing
 * it IS the kill switch, so never close it while the child should keep running. */
export function createKillOnCloseJob(): bigint {
  const job = k().symbols.CreateJobObjectW(null, null) as bigint;
  if (job === 0n) throw new JobObjectError("CreateJobObjectW", k().symbols.GetLastError());
  const info = new Uint8Array(JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE);
  new DataView(info.buffer).setUint32(LIMIT_FLAGS_OFFSET, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, true);
  const ok = k().symbols.SetInformationJobObject(
    job,
    JobObjectExtendedLimitInformation,
    ptr(info),
    info.length,
  );
  if (!ok) {
    const e = k().symbols.GetLastError();
    k().symbols.CloseHandle(job);
    throw new JobObjectError("SetInformationJobObject", e);
  }
  return job;
}

/** Opens pid with PROCESS_SET_QUOTA_AND_TERMINATE and assigns it to job.
 * Throws JobObjectError (dead pid, access denied, etc.) — caller must decide
 * whether to kill the orphaned child it just spawned. */
export function assignPidToJob(job: bigint, pid: number): void {
  const h = k().symbols.OpenProcess(PROCESS_SET_QUOTA_AND_TERMINATE, 0, pid) as bigint;
  if (h === 0n) throw new JobObjectError("OpenProcess", k().symbols.GetLastError());
  const ok = k().symbols.AssignProcessToJobObject(job, h);
  const e = ok ? 0 : k().symbols.GetLastError();
  k().symbols.CloseHandle(h);
  if (!ok) throw new JobObjectError("AssignProcessToJobObject", e);
}

/** Hard-kills every process assigned to job (whole tree, kernel level). */
export function terminateJob(job: bigint, exitCode: number): void {
  if (!k().symbols.TerminateJobObject(job, exitCode))
    throw new JobObjectError("TerminateJobObject", k().symbols.GetLastError());
}

/** Closes the job handle. If this was the job's last handle and no process
 * escaped assignment, KILL_ON_JOB_CLOSE reaps anything still assigned. */
export function closeJob(job: bigint): void {
  k().symbols.CloseHandle(job);
}
