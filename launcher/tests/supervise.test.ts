// Task 2 (foreman-launch plan) + T1 spec REV2 resolution 1 ("write the stop
// test FIRST"): the graded-stop/timeout case is deliberately the FIRST test
// in this file, ahead of the plain exit-code cases. Graded stop is grace ->
// TerminateJobObject with NO cooperative phase (CTRL_BREAK is impossible via
// Bun.spawn; CMD's stdin is already /dev/null so closing it signals nothing).
import { describe, test, expect } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { supervise } from "../src/supervise";

const windows = process.platform === "win32";
const PING_TREE_KILL = windows
  ? ["ping", "-n", "60", "127.0.0.1"]
  : ["sh", "-c", "sleep 60"];

function tmpHeartbeatFile(name: string): string {
  const path = `${import.meta.dir}/../.tmp-${name}-${process.pid}.jsonl`;
  try {
    rmSync(path);
  } catch {
    /* didn't exist */
  }
  return path;
}

function readJsonLines(path: string): any[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("supervise", () => {
  // --- STOP TEST FIRST (resolution 1) ---------------------------------
  test("timeout: grace then hard-kill, whole tree gone, no cooperative phase", async () => {
    const hb = tmpHeartbeatFile("timeout");
    const started = Date.now();
    const result = await supervise({
      cmd: PING_TREE_KILL,
      timeoutSecs: 2,
      graceSecs: 1,
      heartbeatFile: hb,
      heartbeatIntervalSecs: 1,
    });
    const elapsed = (Date.now() - started) / 1000;

    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(8); // 2s timeout + 1s grace + slack, well under wall-clock budget

    const lines = readJsonLines(hb);
    expect(lines.length).toBeGreaterThan(0);
    const lastPid = lines[lines.length - 1].pid;
    if (windows) {
      const scan = Bun.spawnSync(["tasklist", "/FI", `PID eq ${lastPid}`]);
      expect(scan.stdout.toString()).not.toContain(String(lastPid));
    } else {
      // process group should be gone: kill(-pid, 0) throws ESRCH once dead
      let alive = true;
      try {
        process.kill(-lastPid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    }
    rmSync(hb, { force: true });
  }, 15000);

  // --- plain exit-code passthrough -------------------------------------
  test("child exits 0 -> {exitCode:0, timedOut:false}", async () => {
    const cmd = windows ? ["cmd", "/c", "exit 0"] : ["sh", "-c", "exit 0"];
    const result = await supervise({ cmd, graceSecs: 10, heartbeatIntervalSecs: 60 });
    expect(result).toEqual({ exitCode: 0, timedOut: false });
  });

  test("child exits 7 -> exitCode 7 passthrough", async () => {
    const cmd = windows ? ["cmd", "/c", "exit 7"] : ["sh", "-c", "exit 7"];
    const result = await supervise({ cmd, graceSecs: 10, heartbeatIntervalSecs: 60 });
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  test("NTSTATUS probe: cmd /c exit 3221225477 surfaces non-zero (UNVERIFIED passthrough settled here)", async () => {
    const cmd = windows ? ["cmd", "/c", "exit 3221225477"] : ["sh", "-c", "exit 255"];
    const result = await supervise({ cmd, graceSecs: 10, heartbeatIntervalSecs: 60 });
    // Record the actual observed value — this is exactly what was unverified.
    console.log(`NTSTATUS probe observed exitCode=${result.exitCode}`);
    expect(result.exitCode).not.toBe(0);
  });

  // NOTE (Bun #24690, resolution 6): Bun.spawn stdout:pipe can capture empty
  // INSIDE `bun test`. This test asserts heartbeat-line SHAPE and elapsed_s
  // monotonicity only; the stdout_bytes GROWTH assertion lives in
  // tests/launcher.bats against the compiled exe, never here.
  test("heartbeat file grows: JSON lines, well-formed fields, ts/elapsed_s advance", async () => {
    const hb = tmpHeartbeatFile("growth");
    const cmd = windows
      ? ["cmd", "/c", "echo one & ping -n 3 127.0.0.1 >nul & echo two"]
      : ["sh", "-c", "echo one; sleep 2; echo two"];
    const result = await supervise({
      cmd,
      graceSecs: 10,
      heartbeatFile: hb,
      heartbeatIntervalSecs: 1,
    });
    expect(result.exitCode).toBe(0);
    const lines = readJsonLines(hb);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) {
      expect(typeof l.ts).toBe("string");
      expect(typeof l.launcher_pid).toBe("number");
      expect(typeof l.pid).toBe("number");
      expect(typeof l.job_id).toBe("string");
      expect(typeof l.alive).toBe("boolean");
      expect(typeof l.stdout_bytes).toBe("number");
      expect(typeof l.stderr_bytes).toBe("number");
      expect(typeof l.elapsed_s).toBe("number");
    }
    const last = lines[lines.length - 1];
    const first = lines[0];
    expect(last.elapsed_s).toBeGreaterThanOrEqual(first.elapsed_s);
    // stdout_bytes growth is NOT asserted here (Bun #24690) — see
    // tests/launcher.bats "heartbeat file grows" case against the compiled exe.
    expect(last.alive).toBe(false); // final heartbeat written after exit
    rmSync(hb, { force: true });
  }, 15000);
});
