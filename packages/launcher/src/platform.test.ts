import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOST_PID_ENV,
  PIDNS_INNER_ENV,
  PIDNS_KIND_ENV,
  UNSHARE_PIDNS_FLAGS,
  UNSHARE_PROBE_LADDER,
  UNSHARE_USERNS_PIDNS_FLAGS,
  buildEnvp,
  buildTaskkillArgv,
  buildUnshareArgv,
  classifyProbeFailure,
  formatAttempts,
  planPidnsExecve,
  planPosixDetachedSpawn,
  planTaskkill,
  processGroupKillTarget,
  resolveCapability,
} from "./platform.js";

describe("POSIX strong plan (pure; never execve)", () => {
  it("defines the ordered userns-first probe ladder", () => {
    assert.deepEqual(UNSHARE_PROBE_LADDER, [
      {
        kind: "posix_pidns_userns_strong",
        flags: UNSHARE_USERNS_PIDNS_FLAGS,
      },
      { kind: "posix_pidns_strong", flags: UNSHARE_PIDNS_FLAGS },
    ]);
  });

  it("builds unshare argv with caller-selected flags", () => {
    const argv = buildUnshareArgv("/path/to/node", [
      "/path/to/foreman-launch.js",
      "--",
      "true",
    ], UNSHARE_USERNS_PIDNS_FLAGS);
    assert.deepEqual(argv, [
      "unshare",
      "--user",
      "--map-current-user",
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
      flags: UNSHARE_USERNS_PIDNS_FLAGS,
      kind: "posix_pidns_userns_strong",
    });
    assert.equal(req.path, "/usr/bin/unshare");
    assert.equal(req.path.startsWith("/"), true);
    assert.equal(req.argv[0], "unshare");
    assert.equal(req.env[HOST_PID_ENV], "4242");
    assert.equal(req.env[PIDNS_INNER_ENV], "1");
    assert.equal(req.env[PIDNS_KIND_ENV], "posix_pidns_userns_strong");
    assert.equal(req.env["PATH"], "/usr/bin");
    assert.equal(req.env["FOO"], "bar");
  });

  it("classifies and formats ordered probe failures", () => {
    const usernsEperm = {
      flags: UNSHARE_USERNS_PIDNS_FLAGS,
      status: 1,
      signal: null,
      stderr: "unshare: Operation not permitted",
    } as const;
    const privilegedEperm = {
      flags: UNSHARE_PIDNS_FLAGS,
      status: 1,
      signal: null,
      stderr: "unshare: Operation not permitted",
    } as const;
    assert.equal(classifyProbeFailure([usernsEperm]), "userns_blocked");
    assert.equal(
      classifyProbeFailure([
        { ...usernsEperm, stderr: "user namespace disabled" },
        privilegedEperm,
      ]),
      "unshare_eperm",
    );
    assert.equal(
      classifyProbeFailure([{ ...usernsEperm, stderr: "unexpected" }]),
      "unshare_probe_failed",
    );
    assert.equal(
      formatAttempts([
        usernsEperm,
        { ...privilegedEperm, status: null, signal: "SIGTERM" },
      ]),
      `entry=${UNSHARE_USERNS_PIDNS_FLAGS.join(" ")} status=1 stderr=unshare: Operation not permitted | entry=${UNSHARE_PIDNS_FLAGS.join(" ")} status=SIGTERM stderr=unshare: Operation not permitted`,
    );
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
        reason: "userns_blocked",
        detail: "Operation not permitted",
        attempts: [],
      },
    });
    assert.equal(r.capability._tag, "Degraded");
    if (r.capability._tag === "Degraded") {
      assert.equal(r.capability.reason, "userns_blocked");
    }
    assert.match(r.diagnostic.message, /DEGRADED/);
  });

  it("strong probe resolves Strong", () => {
    const r = resolveCapability({
      platform: "linux",
      env: {},
      processPid: 22,
      probe: {
        _tag: "Ok",
        unsharePath: "/usr/bin/unshare",
        kind: "posix_pidns_userns_strong",
        flags: UNSHARE_USERNS_PIDNS_FLAGS,
        attempts: [],
      },
    });
    assert.equal(r.capability._tag, "Strong");
    if (r.capability._tag === "Strong") {
      assert.equal(r.capability.kind, "posix_pidns_userns_strong");
      assert.deepEqual(r.capability.flags, UNSHARE_USERNS_PIDNS_FLAGS);
    }
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
    if (r.capability._tag === "AlreadyInner") {
      assert.equal(r.capability.kind, "posix_pidns_strong");
    }
  });

  it("already-inner preserves a valid userns kind marker", () => {
    const r = resolveCapability({
      platform: "linux",
      env: {
        [PIDNS_INNER_ENV]: "1",
        [PIDNS_KIND_ENV]: "posix_pidns_userns_strong",
      },
      processPid: 1,
      probe: null,
    });
    assert.equal(r.capability._tag, "AlreadyInner");
    if (r.capability._tag === "AlreadyInner") {
      assert.equal(r.capability.kind, "posix_pidns_userns_strong");
    }
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
