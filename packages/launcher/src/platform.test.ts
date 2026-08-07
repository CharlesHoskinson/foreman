import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOST_PID_ENV,
  PIDNS_INNER_ENV,
  buildEnvp,
  buildTaskkillArgv,
  buildUnshareArgv,
  planPidnsExecve,
  planPosixDetachedSpawn,
  planTaskkill,
  processGroupKillTarget,
  resolveCapability,
} from "./platform.js";

describe("POSIX strong plan (pure; never execve)", () => {
  it("builds absolute unshare argv with recursion marker and host pid env", () => {
    const argv = buildUnshareArgv("/path/to/node", [
      "/path/to/foreman-launch.js",
      "--",
      "true",
    ]);
    assert.deepEqual(argv, [
      "unshare",
      "--pid",
      "--mount-proc",
      "--fork",
      "--kill-child",
      "--",
      "/path/to/node",
      "/path/to/foreman-launch.js",
      "--",
      "true",
    ]);

    const req = planPidnsExecve({
      unsharePath: "/usr/bin/unshare",
      execPath: "/path/to/node",
      originalArgs: ["/path/to/foreman-launch.js", "--", "sleep", "1"],
      hostPid: 4242,
      baseEnv: { PATH: "/usr/bin", FOO: "bar" },
    });
    assert.equal(req.path, "/usr/bin/unshare");
    assert.equal(req.path.startsWith("/"), true);
    assert.equal(req.argv[0], "unshare");
    assert.equal(req.env[HOST_PID_ENV], "4242");
    assert.equal(req.env[PIDNS_INNER_ENV], "1");
    assert.equal(req.env["PATH"], "/usr/bin");
    assert.equal(req.env["FOO"], "bar");
  });

  it("buildEnvp last-wins and drops undefined", () => {
    const envp = buildEnvp(
      { FOO: "bar", GONE: undefined, BAZ: "old" } as NodeJS.ProcessEnv,
      { BAZ: "new", NEW: "1" },
    );
    assert.equal(envp.includes("FOO=bar"), true);
    assert.equal(envp.includes("BAZ=new"), true);
    assert.equal(envp.includes("NEW=1"), true);
    assert.equal(envp.some((e) => e.startsWith("GONE=")), false);
  });

  it("failed probe resolves to degraded process-group capability", () => {
    const r = resolveCapability({
      platform: "linux",
      env: {},
      processPid: 11,
      probe: {
        _tag: "Failed",
        unsharePath: "/usr/bin/unshare",
        detail: "Operation not permitted",
      },
    });
    assert.equal(r.capability._tag, "Degraded");
    if (r.capability._tag === "Degraded") {
      assert.equal(r.capability.kind, "posix_process_group_degraded");
    }
    assert.match(r.diagnostic.message, /DEGRADED/);
  });

  it("strong probe resolves Strong", () => {
    const r = resolveCapability({
      platform: "linux",
      env: {},
      processPid: 22,
      probe: { _tag: "Ok", unsharePath: "/usr/bin/unshare" },
    });
    assert.equal(r.capability._tag, "Strong");
  });

  it("already-inner skips probe", () => {
    const r = resolveCapability({
      platform: "linux",
      env: { [PIDNS_INNER_ENV]: "1", [HOST_PID_ENV]: "999" },
      processPid: 1,
      probe: null,
    });
    assert.equal(r.capability._tag, "AlreadyInner");
    assert.equal(r.launcherPid, 999);
  });
});

describe("POSIX degraded process group", () => {
  it("plans detached process group spawn and negative-PID target", () => {
    const plan = planPosixDetachedSpawn(["/bin/sleep", "5"]);
    assert.equal(plan.mode, "detached_process_group");
    assert.equal(plan.file, "/bin/sleep");
    assert.deepEqual(plan.args, ["5"]);
    assert.equal(processGroupKillTarget(12345), -12345);
  });
});

describe("Windows degraded boundary", () => {
  it("reports windows_job_object_unavailable before spawn planning", () => {
    const r = resolveCapability({
      platform: "win32",
      env: {},
      processPid: 5,
      probe: null,
    });
    assert.equal(r.capability._tag, "Degraded");
    if (r.capability._tag === "Degraded") {
      assert.equal(r.capability.kind, "windows_job_object_unavailable");
    }
  });

  it("taskkill boundary is injectable shape only", () => {
    const argv = buildTaskkillArgv(777);
    assert.deepEqual(argv, ["taskkill.exe", "/PID", "777", "/T", "/F"]);
    const req = planTaskkill(777);
    assert.equal(req.executable, "taskkill.exe");
    assert.equal(req.pid, 777);
  });
});
