// Supervised spawn: the child (and its whole process tree) is assigned to a
// Windows Job Object (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) immediately after
// Bun.spawn returns, or — on POSIX — spawned under `setsid` so it owns its
// own process group from the moment it execs. Either way, closing the
// job/killing the group reaps every descendant; orphans are impossible by
// construction.
//
// GRADED STOP (T1 spec REV2, binding resolution 1): there is no cooperative
// phase. CTRL_BREAK is impossible via Bun.spawn (needs a shared console +
// CREATE_NEW_PROCESS_GROUP) and CMD's stdin is already "ignore" (mapped to
// the null device), so closing stdin signals nothing. On timeout: wait
// `graceSecs`, then hard-kill (TerminateJobObject on Windows, SIGKILL the
// process group on POSIX). That is the entire contract.
//
// No hot FFI polling (#31941): exit detection is `child.exited`; heartbeats
// are a plain JS `setInterval`, never an FFI wait loop.
import { appendFileSync } from "node:fs";
import {
  createKillOnCloseJob,
  assignPidToJob,
  terminateJob,
  closeJob,
} from "./win/jobobject";
import { wrapWithSetsid, terminateProcessGroup } from "./posix";

const isWindows = process.platform === "win32";

export type LaunchEventType = "spawned" | "heartbeat" | "grace" | "killed" | "exited";

export interface LaunchEvent {
  ts: string;
  type: LaunchEventType;
  pid?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
}

export interface SuperviseOptions {
  cmd: string[];
  timeoutSecs?: number;
  graceSecs: number;
  heartbeatFile?: string;
  heartbeatIntervalSecs: number;
  onEvent?: (e: LaunchEvent) => void;
}

export interface SuperviseResult {
  exitCode: number;
  timedOut: boolean;
}

/** Heartbeat JSON schema is FROZEN (T1 spec REV2 resolution 3 — T2 consumes
 * these exact field names): {ts, launcher_pid, pid, job_id, alive,
 * stdout_bytes, stderr_bytes, elapsed_s}. launcher_pid is this process's own
 * pid (the job-owning supervisor); pid is Bun.spawn().pid of CMD's root
 * child. Kill-shot tests taskkill launcher_pid; tree observation keys on
 * pid. */
interface HeartbeatLine {
  ts: string;
  launcher_pid: number;
  pid: number;
  job_id: string;
  alive: boolean;
  stdout_bytes: number;
  stderr_bytes: number;
  elapsed_s: number;
}

export async function supervise(opts: SuperviseOptions): Promise<SuperviseResult> {
  const { cmd, timeoutSecs, graceSecs, heartbeatFile, heartbeatIntervalSecs, onEvent } = opts;
  const launcherPid = process.pid;
  const emit = (e: Omit<LaunchEvent, "ts">) => onEvent?.({ ts: new Date().toISOString(), ...e });

  // Windows: create the job before spawning (cheap, pid-independent).
  // POSIX: no separate job primitive — setsid groups at exec time.
  // The job handle's lifetime is this async function's own live frame (held
  // in `job` until the explicit closeJob() near the bottom) — per the
  // plan's "module-level var for launcher lifetime" intent, since this
  // frame IS the launcher for as long as it's supervising this one child.
  const job = isWindows ? createKillOnCloseJob() : null;
  const spawnCmd = isWindows ? cmd : wrapWithSetsid(cmd);

  const child = Bun.spawn(spawnCmd, {
    stdin: "ignore", // CMD's stdin is the null device; launcher never inherits the caller's stdin
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });

  // Assign to job IMMEDIATELY after spawn returns. A microsecond grandchild
  // race is documented and accepted for v0.2.5 (plan Risks §2) — vendor CLIs
  // boot slower than this window.
  if (isWindows && job !== null) {
    try {
      assignPidToJob(job, child.pid);
    } catch (err) {
      closeJob(job);
      child.kill();
      throw err;
    }
  }

  const jobId = isWindows ? String(job) : String(child.pid);
  const startedAt = Date.now();
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let exited = false;

  emit({ type: "spawned", pid: child.pid });

  const pumpStream = async (
    src: ReadableStream<Uint8Array> | null | undefined,
    dst: { write: (chunk: Uint8Array) => unknown },
    onBytes: (n: number) => void,
  ) => {
    if (!src) return;
    const reader = src.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          onBytes(value.byteLength);
          dst.write(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  const stdoutDone = pumpStream(child.stdout as ReadableStream<Uint8Array>, process.stdout, (n) => (stdoutBytes += n));
  const stderrDone = pumpStream(child.stderr as ReadableStream<Uint8Array>, process.stderr, (n) => (stderrBytes += n));

  const writeHeartbeat = (alive: boolean) => {
    if (!heartbeatFile) return;
    const line: HeartbeatLine = {
      ts: new Date().toISOString(),
      launcher_pid: launcherPid,
      pid: child.pid,
      job_id: jobId,
      alive,
      stdout_bytes: stdoutBytes,
      stderr_bytes: stderrBytes,
      elapsed_s: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    };
    try {
      // Single appendFileSync call = single write() syscall for a line this
      // short — the "atomic single-line write" the contract requires so a
      // concurrent reader (bats, or --detach's bounded poll) never sees a
      // torn line.
      appendFileSync(heartbeatFile, JSON.stringify(line) + "\n");
    } catch {
      /* best-effort; heartbeat I/O must never crash the supervisor */
    }
    emit({ type: "heartbeat", pid: child.pid, stdoutBytes, stderrBytes });
  };

  // First heartbeat fires immediately at spawn — not after the first
  // interval — so `--detach`'s bounded <=5s poll can observe it even when
  // --heartbeat-interval is the 15s default.
  writeHeartbeat(true);
  const hbTimer = setInterval(() => {
    if (!exited) writeHeartbeat(true);
  }, Math.max(1, heartbeatIntervalSecs) * 1000);

  const terminateTree = () => {
    if (isWindows && job !== null) {
      try {
        terminateJob(job, 1);
      } catch {
        /* best-effort: process may have already exited in the race */
      }
    } else {
      terminateProcessGroup(child.pid, "SIGKILL");
    }
  };

  let timedOut = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutSecs !== undefined) {
    timeoutTimer = setTimeout(() => {
      if (exited) return;
      timedOut = true;
      emit({ type: "grace", pid: child.pid });
      // GRADED STOP: grace, then hard-kill. No cooperative phase (resolution 1).
      graceTimer = setTimeout(() => {
        if (exited) return;
        emit({ type: "killed", pid: child.pid });
        terminateTree();
      }, graceSecs * 1000);
    }, timeoutSecs * 1000);
  }

  const exitCode = await child.exited;
  exited = true;
  clearTimeout(timeoutTimer);
  clearTimeout(graceTimer);
  clearInterval(hbTimer);
  await Promise.allSettled([stdoutDone, stderrDone]);
  writeHeartbeat(false);
  emit({ type: "exited", pid: child.pid });

  if (isWindows && job !== null) closeJob(job);

  return { exitCode: exitCode ?? 0, timedOut };
}
