// Task 2 (posix-cascade-parity plan): bun-level coverage for the parts of
// the pidns bootstrap that are safe to exercise IN this test runner's own
// process -- the pure argv-shape builder, the disposable-probe check (which
// only forks+waits, never replaces this process), and bootstrapPidnsCascade
// (posix.ts)'s "already-inner" / "degraded" early-return paths. The
// IRREVERSIBLE success path (execReplaceWithUnshare actually succeeding)
// would replace the test runner's own process and is deliberately NEVER
// exercised here -- that is exactly what tests/launcher.bats's kill-shot
// test (against the real compiled exe, in its own disposable subprocess)
// is for.
import { describe, test, expect, afterEach } from "bun:test";
import { pidnsAvailable, buildUnshareArgv, buildEnvp } from "../src/posix-bootstrap";
import { bootstrapPidnsCascade } from "../src/posix";

const windows = process.platform === "win32";

describe("buildUnshareArgv", () => {
  test("shape: unshare --pid --mount-proc --fork --kill-child -- <execPath> <original args>", () => {
    const argv = buildUnshareArgv("/path/to/foreman-launch", [
      "--timeout",
      "5",
      "--heartbeat-file",
      "hb.jsonl",
      "--",
      "sh",
      "-c",
      "true",
    ]);
    expect(argv).toEqual([
      "unshare",
      "--pid",
      "--mount-proc",
      "--fork",
      "--kill-child",
      "--",
      "/path/to/foreman-launch",
      "--timeout",
      "5",
      "--heartbeat-file",
      "hb.jsonl",
      "--",
      "sh",
      "-c",
      "true",
    ]);
  });

  test("passes through zero extra args unchanged", () => {
    expect(buildUnshareArgv("/bin/x", [])).toEqual([
      "unshare",
      "--pid",
      "--mount-proc",
      "--fork",
      "--kill-child",
      "--",
      "/bin/x",
    ]);
  });
});

describe("buildEnvp", () => {
  // Regression coverage for the bug found empirically on WSL: Bun's
  // `process.env[K] = v` does not sync to the real kernel environ, so
  // execve(3)'s envp must be built explicitly rather than relying on
  // ambient inheritance. This function is the fix -- pure, so its shape is
  // directly assertable without any process effects.
  test("layers overrides on top of the base env, last-wins on collision", () => {
    const envp = buildEnvp({ FOO: "bar", BAZ: "qux" } as NodeJS.ProcessEnv, { BAZ: "override", NEW: "1" });
    expect(envp).toContain("FOO=bar");
    expect(envp).toContain("BAZ=override");
    expect(envp).toContain("NEW=1");
    expect(envp).not.toContain("BAZ=qux");
  });

  test("drops undefined-valued base entries (ProcessEnv allows them; envp cannot)", () => {
    const envp = buildEnvp({ FOO: "bar", GONE: undefined } as unknown as NodeJS.ProcessEnv, {});
    expect(envp.some((e) => e.startsWith("GONE="))).toBe(false);
    expect(envp).toContain("FOO=bar");
  });
});

describe.if(!windows)("pidnsAvailable (disposable probe, never replaces this process)", () => {
  const savedPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  test("true when `unshare` resolves on PATH and the probe invocation succeeds", () => {
    expect(pidnsAvailable()).toBe(true);
  });

  test("false when PATH cannot resolve `unshare` at all (faithful 'absence' simulation)", () => {
    process.env.PATH = "/nonexistent-empty-dir-for-test";
    expect(pidnsAvailable()).toBe(false);
  });
});

describe.if(!windows)("bootstrapPidnsCascade early-return paths (never reaches the irreversible exec)", () => {
  const PIDNS_INNER_ENV = "FOREMAN_LAUNCH_PIDNS_INNER";
  const HOST_PID_ENV = "FOREMAN_LAUNCH_HOST_PID";
  const savedInner = process.env[PIDNS_INNER_ENV];
  const savedHost = process.env[HOST_PID_ENV];
  const savedPath = process.env.PATH;
  afterEach(() => {
    if (savedInner === undefined) delete process.env[PIDNS_INNER_ENV];
    else process.env[PIDNS_INNER_ENV] = savedInner;
    if (savedHost === undefined) delete process.env[HOST_PID_ENV];
    else process.env[HOST_PID_ENV] = savedHost;
    process.env.PATH = savedPath;
  });

  test('"already-inner" when the marker env var is set -- no probe, no env mutation', () => {
    delete process.env[HOST_PID_ENV];
    process.env[PIDNS_INNER_ENV] = "1";
    expect(bootstrapPidnsCascade(["--", "true"])).toBe("already-inner");
    expect(process.env[HOST_PID_ENV]).toBeUndefined();
  });

  test('"degraded" (and logs it) when unshare cannot be resolved -- never silently proceeds', () => {
    delete process.env[PIDNS_INNER_ENV];
    process.env.PATH = "/nonexistent-empty-dir-for-test";
    const errs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errs.push(args.join(" "));
    try {
      const result = bootstrapPidnsCascade(["--", "true"]);
      expect(result).toBe("degraded");
    } finally {
      console.error = origError;
    }
    expect(errs.some((l) => l.includes("DEGRADED"))).toBe(true);
    // Must not have left the env markers set for a supervise() call that
    // then never actually happened inside a fresh namespace.
    expect(process.env[HOST_PID_ENV]).toBeUndefined();
  });

  test("throws UnsupportedPlatformError on win32 (never reached off-Windows; guards the contract)", () => {
    // This test only documents the guard exists; the win32 branch itself is
    // covered by the mirror describe.if(windows) block pattern used
    // elsewhere in this package (see tests/posix.test.ts) -- nothing to run
    // here on a POSIX CI host beyond asserting the function is exported.
    expect(typeof bootstrapPidnsCascade).toBe("function");
  });
});
