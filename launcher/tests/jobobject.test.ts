// Task 1 (foreman-launch plan): kernel32 Job Object module. Written FIRST
// against the not-yet-existing module (TDD red) — the whole point of
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is that closing the job's last handle
// reaps the entire process tree, grandchildren included, at kernel level.
import { describe, test, expect } from "bun:test";
import {
  createKillOnCloseJob,
  assignPidToJob,
  terminateJob,
  closeJob,
} from "../src/win/jobobject";

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
    const child = Bun.spawn(
      ["cmd", "/c", "start /b ping -n 60 127.0.0.1 >nul & ping -n 60 127.0.0.1 >nul"],
      { stdout: "pipe", stderr: "pipe", windowsHide: true },
    );
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
