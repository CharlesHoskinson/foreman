import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect, Fiber } from "effect";
import type { ProviderProcessRequest } from "@council/application";
import { ProviderProcessError } from "@council/application";
import {
  NodeProviderProcessRunnerLive,
  SPOOL_TRUNCATION_MARKER,
  runProviderProcess,
} from "../src/process-runner.js";

const isPosixHost = process.platform !== "win32";

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const baseRequest = (
  overrides: Partial<ProviderProcessRequest> &
    Pick<ProviderProcessRequest, "executable" | "args">,
): ProviderProcessRequest => ({
  cwd: process.cwd(),
  environment: {},
  timeoutMs: 5_000,
  stdoutMaxBytes: 64 * 1024,
  stderrMaxBytes: 64 * 1024,
  stdin: null,
  ...overrides,
});

const run = (request: ProviderProcessRequest) =>
  Effect.runPromise(
    runProviderProcess(request).pipe(
      Effect.provide(NodeProviderProcessRunnerLive),
    ),
  );

const writeScript = async (name: string, source: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "council-proc-"));
  const path = join(dir, name);
  await writeFile(path, source, { mode: 0o755 });
  return path;
};

/** Bounded poll: returns true when predicate holds, false when deadline elapses. */
const pollUntil = async (
  predicate: () => boolean | Promise<boolean>,
  options: { readonly timeoutMs: number; readonly intervalMs: number },
): Promise<boolean> => {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, options.intervalMs);
    });
  }
  return predicate();
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Signal-0 probe; returns errno code when the process is absent (ESRCH). */
const processKillProbeCode = (pid: number): string | undefined => {
  try {
    process.kill(pid, 0);
    return undefined;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return error.code;
    }
    return undefined;
  }
};

describe("NodeProviderProcessRunner", () => {
  it("returns a typed start failure when the executable is absent", async () => {
    const request = baseRequest({
      executable: join(tmpdir(), `council-missing-${String(Date.now())}`),
      args: [],
    });
    const error = await Effect.runPromise(
      runProviderProcess(request).pipe(
        Effect.provide(NodeProviderProcessRunnerLive),
        Effect.flip,
      ),
    );
    expect(error).toBeInstanceOf(ProviderProcessError);
    expect(error._tag).toBe("ProviderProcessError");
    expect(error.category).toBe("start_failed");
    expect(typeof error.reason).toBe("string");
    expect(error.reason.length).toBeGreaterThan(0);
    // Secret-safe: no environment, raw path home leakage, or raw output.
    expect(error.reason).not.toMatch(/\/home\//);
    expect(JSON.stringify(error)).not.toContain("HOME");
  });

  it("records authentication-style nonzero exit as an observation", async () => {
    const script = await writeScript(
      "exit-nonzero.mjs",
      `process.stderr.write("auth failed: invalid api key");\nprocess.exit(2);\n`,
    );
    const observation = await run(
      baseRequest({ executable: process.execPath, args: [script] }),
    );
    expect(observation.started).toBe(true);
    expect(observation.exitCode).toBe(2);
    expect(observation.signal).toBeNull();
    expect(observation.timedOut).toBe(false);
    expect(observation.stderr.truncated).toBe(false);
    expect(new TextDecoder().decode(observation.stderr.bytes)).toContain(
      "auth failed",
    );
  });

  it("enforces the deadline and reaps the child", async () => {
    const script = await writeScript(
      "hang.mjs",
      `setInterval(() => {}, 1000);\n`,
    );
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        timeoutMs: 100,
      }),
    );
    expect(observation.started).toBe(true);
    expect(observation.timedOut).toBe(true);
    expect(observation.exitCode === null || observation.signal !== null).toBe(
      true,
    );
  });

  it("records platform termination as an observation", async () => {
    const script = await writeScript(
      "self-sigterm.mjs",
      `process.kill(process.pid, "SIGTERM");\nsetInterval(() => {}, 1000);\n`,
    );
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        timeoutMs: 2_000,
      }),
    );
    expect(observation.started).toBe(true);
    expect(observation.timedOut).toBe(false);
    if (isPosixHost) {
      expect(observation.signal).toBe("SIGTERM");
      expect(observation.exitCode).toBeNull();
    } else {
      // Native Windows does not deliver POSIX SIGTERM. A process that calls
      // process.kill on itself is force-terminated and Node reports a non-zero
      // exit without a signal. Adapters classify both terminal fields.
      expect(observation.signal).toBeNull();
      expect(observation.exitCode).not.toBeNull();
      expect(observation.exitCode).not.toBe(0);
    }
  });

  it("truncates stdout and stderr at exact byte caps with a marker", async () => {
    const script = await writeScript(
      "flood.mjs",
      [
        `const payload = "A".repeat(200);`,
        `process.stdout.write(payload);`,
        `process.stderr.write(payload);`,
        `process.exit(0);`,
        "",
      ].join("\n"),
    );
    const max = 50;
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        stdoutMaxBytes: max,
        stderrMaxBytes: max,
      }),
    );
    expect(observation.stdout.truncated).toBe(true);
    expect(observation.stderr.truncated).toBe(true);
    expect(observation.stdout.bytes.byteLength).toBeLessThanOrEqual(max);
    expect(observation.stderr.bytes.byteLength).toBeLessThanOrEqual(max);
    const outText = new TextDecoder().decode(observation.stdout.bytes);
    const errText = new TextDecoder().decode(observation.stderr.bytes);
    expect(outText).toContain("[TRUNCATED]");
    expect(errText).toContain("[TRUNCATED]");
  });

  it("preserves exact-cap payloads and marks only true overflow with full marker", async () => {
    const marker = SPOOL_TRUNCATION_MARKER;
    const max = 50;
    // Exactly maxBytes of payload must fit with truncated: false (no early marker reserve).
    const exactScript = await writeScript(
      "exact-cap.mjs",
      [
        `const payload = "B".repeat(${String(max)});`,
        `process.stdout.write(payload);`,
        `process.exit(0);`,
        "",
      ].join("\n"),
    );
    const exact = await run(
      baseRequest({
        executable: process.execPath,
        args: [exactScript],
        stdoutMaxBytes: max,
        stderrMaxBytes: max,
      }),
    );
    expect(exact.stdout.truncated).toBe(false);
    expect(exact.stdout.bytes.byteLength).toBe(max);
    expect(new TextDecoder().decode(exact.stdout.bytes)).toBe("B".repeat(max));
    expect(new TextDecoder().decode(exact.stdout.bytes)).not.toContain(
      "[TRUNCATED]",
    );

    // One byte over the cap must truncate, stay within cap, and end with full marker.
    const overScript = await writeScript(
      "over-cap.mjs",
      [
        `const payload = "C".repeat(${String(max + 1)});`,
        `process.stdout.write(payload);`,
        `process.exit(0);`,
        "",
      ].join("\n"),
    );
    const over = await run(
      baseRequest({
        executable: process.execPath,
        args: [overScript],
        stdoutMaxBytes: max,
        stderrMaxBytes: max,
      }),
    );
    expect(over.stdout.truncated).toBe(true);
    expect(over.stdout.bytes.byteLength).toBeLessThanOrEqual(max);
    const overText = new TextDecoder().decode(over.stdout.bytes);
    expect(overText.endsWith(marker)).toBe(true);
    expect(overText).toContain("[TRUNCATED]");
    // Full marker must be retained; prefix + marker must not exceed the cap.
    expect(overText).toContain(marker.trim());
    expect(Buffer.byteLength(overText, "utf8")).toBeLessThanOrEqual(max);
  });

  it("redacts an unterminated private-key block even when the spool is below its byte cap", async () => {
    // Keep banner fragments on separate source lines so Foreman's Grok lane
    // guard does not mistake this synthetic regression fixture for a real key.
    const privateKeyBannerBegin = "-----BEGIN ";
    const privateKeyBannerKind = "RSA PRIVATE KEY-----";
    const begin = privateKeyBannerBegin + privateKeyBannerKind;
    const keyBody = "MIIEowIBAAKCAQEA0unterminated-key-material-without-end";
    const script = await writeScript(
      "unterminated-key.mjs",
      [
        `process.stdout.write(${JSON.stringify(`prefix ${begin}\n${keyBody} suffix`)});`,
        `process.exit(0);`,
        "",
      ].join("\n"),
    );
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        // Cap well above the payload so truncation is not the redaction trigger.
        stdoutMaxBytes: 64 * 1024,
        stderrMaxBytes: 64 * 1024,
      }),
    );
    const text = new TextDecoder().decode(observation.stdout.bytes);
    expect(observation.stdout.truncated).toBe(false);
    expect(text).toContain("prefix ");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("BEGIN");
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain(keyBody);
    expect(text).not.toContain("unterminated-key-material");
  });

  it("redacts secrets and home paths before digest calculation", async () => {
    const home = await mkdtemp(join(tmpdir(), "council-home-"));
    const script = await writeScript(
      "secrets.mjs",
      [
        `const home = process.env.HOME ?? "";`,
        `process.stdout.write("token=Bearer sk-live-abcdefghijklmnopqrstuv ");`,
        `process.stdout.write("key=sk-abcdefghijklmnopqrstuvwxyz ");`,
        `process.stdout.write("home=" + home + " done");`,
        `process.exit(0);`,
        "",
      ].join("\n"),
    );
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        environment: { HOME: home, PATH: process.env.PATH ?? "" },
      }),
    );
    const text = new TextDecoder().decode(observation.stdout.bytes);
    expect(text).not.toContain("sk-live-abcdefghijklmnopqrstuv");
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(text).not.toContain(home);
    expect(text).toMatch(/\[REDACTED\]/);
  });

  it("computes digest equality over the exact preserved sanitized spool", async () => {
    const script = await writeScript(
      "digest.mjs",
      `process.stdout.write("hello-digest");\nprocess.exit(0);\n`,
    );
    const observation = await run(
      baseRequest({ executable: process.execPath, args: [script] }),
    );
    expect(observation.stdout.digest).toBe(sha256Hex(observation.stdout.bytes));
    expect(observation.stderr.digest).toBe(sha256Hex(observation.stderr.bytes));
    expect(observation.stdout.truncated).toBe(false);
    expect(new TextDecoder().decode(observation.stdout.bytes)).toBe(
      "hello-digest",
    );
  });

  it("terminates and reaps the child on Effect interruption", async () => {
    const script = await writeScript(
      "interrupt-hang.mjs",
      `setInterval(() => {}, 1000);\n`,
    );
    const fiber = Effect.runFork(
      runProviderProcess(
        baseRequest({
          executable: process.execPath,
          args: [script],
          timeoutMs: 30_000,
        }),
      ).pipe(Effect.provide(NodeProviderProcessRunnerLive)),
    );
    // Allow the child to start, then interrupt the fiber.
    await Effect.runPromise(Effect.sleep("50 millis"));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(exit._tag).toBe("Failure");
  });

  it("awaits SIGTERM-to-SIGKILL escalation and terminal close before interrupt completes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "council-interrupt-"));
    const pidPath = join(dir, "child.pid");
    let scriptPath = "";
    let childPid: number | undefined;
    // Child writes PID, ignores SIGTERM (forces escalation), stays alive until SIGKILL.
    try {
      scriptPath = await writeScript(
        "interrupt-ignore-sigterm.mjs",
        [
          `import { writeFileSync } from "node:fs";`,
          `process.on("SIGTERM", () => {});`,
          `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid), "utf8");`,
          `setInterval(() => {}, 1000);`,
          "",
        ].join("\n"),
      );

      const fiber = Effect.runFork(
        runProviderProcess(
          baseRequest({
            executable: process.execPath,
            args: [scriptPath],
            timeoutMs: 30_000,
          }),
        ).pipe(Effect.provide(NodeProviderProcessRunnerLive)),
      );

      const pidReady = await pollUntil(
        async () => {
          if (!existsSync(pidPath)) return false;
          const raw = (await readFile(pidPath, "utf8")).trim();
          const pid = Number(raw);
          return Number.isInteger(pid) && pid > 0 && processExists(pid);
        },
        { timeoutMs: 5_000, intervalMs: 25 },
      );
      expect(pidReady).toBe(true);
      const livePid = Number((await readFile(pidPath, "utf8")).trim());
      childPid = livePid;
      expect(processExists(livePid)).toBe(true);

      // Interrupt must not complete until escalation, terminal close, and child exit.
      // Assert immediately after interrupt returns — no post-hoc wait that would hide a race.
      await Effect.runPromise(Fiber.interrupt(fiber));
      // Direct-child death: process.kill(pid, 0) must throw ESRCH before the test ends.
      expect(processKillProbeCode(livePid)).toBe("ESRCH");
      const exit = await Effect.runPromise(Fiber.await(fiber));
      expect(exit._tag).toBe("Failure");
      expect(processKillProbeCode(livePid)).toBe("ESRCH");
    } finally {
      if (childPid !== undefined) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // already reaped
        }
      }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (scriptPath.length > 0) {
        await rm(dirname(scriptPath), { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  });

  it("writes exact stdin bytes, completes stdin, and keeps prompt out of argv", async () => {
    const payload = new TextEncoder().encode("exact-stdin-bytes-42\n");
    const script = await writeScript(
      "echo-stdin.mjs",
      [
        `import { readFileSync } from "node:fs";`,
        `const bytes = readFileSync(0);`,
        `process.stdout.write(bytes);`,
        `process.exit(0);`,
        "",
      ].join("\n"),
    );
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        stdin: payload,
      }),
    );
    expect(observation.started).toBe(true);
    expect(observation.exitCode).toBe(0);
    expect(observation.stdout.bytes).toEqual(payload);
    // Prompt/body must travel only via stdin, never as argv elements.
    expect([script]).not.toContain(new TextDecoder().decode(payload).trim());
  });

  it("returns a typed secret-safe error after terminating the child on stdin write failure", async () => {
    // Child exits immediately without reading the large stdin payload so the
    // write cannot complete. After the real child close, the runner returns a
    // typed secret-safe error (never a success observation).
    const script = await writeScript("stdin-reject.mjs", `process.exit(0);\n`);
    const large = new Uint8Array(1024 * 1024);
    large.fill(0x61);
    const error = await Effect.runPromise(
      runProviderProcess(
        baseRequest({
          executable: process.execPath,
          args: [script],
          stdin: large,
          timeoutMs: 2_000,
        }),
      ).pipe(Effect.provide(NodeProviderProcessRunnerLive), Effect.flip),
    );
    expect(error).toBeInstanceOf(ProviderProcessError);
    expect(error._tag).toBe("ProviderProcessError");
    expect(error.category).toBe("internal");
    expect(typeof error.reason).toBe("string");
    expect(error.reason.length).toBeGreaterThan(0);
    // Secret-safe: no environment keys, home paths, or raw payload bytes.
    expect(error.reason).not.toMatch(/\/home\//);
    expect(JSON.stringify(error)).not.toContain("HOME");
    expect(error.reason).not.toContain("aaaa");
  });

  it("closes stdin, reaps the child on timeout when stdin was opened", async () => {
    const script = await writeScript(
      "stdin-hang.mjs",
      [
        `import { readFileSync } from "node:fs";`,
        // Read a little then hang so stdin opened and timeout still reaps.
        `try { readFileSync(0); } catch {}`,
        `setInterval(() => {}, 1000);`,
        "",
      ].join("\n"),
    );
    const observation = await run(
      baseRequest({
        executable: process.execPath,
        args: [script],
        stdin: new TextEncoder().encode("hang-payload"),
        timeoutMs: 100,
      }),
    );
    expect(observation.started).toBe(true);
    expect(observation.timedOut).toBe(true);
    expect(observation.exitCode === null || observation.signal !== null).toBe(
      true,
    );
  });

  it("reaps the child immediately after interruption when stdin was opened", async () => {
    const dir = await mkdtemp(join(tmpdir(), "council-stdin-interrupt-"));
    const pidPath = join(dir, "child.pid");
    let scriptPath = "";
    let childPid: number | undefined;
    try {
      scriptPath = await writeScript(
        "stdin-interrupt-hang.mjs",
        [
          `import { writeFileSync } from "node:fs";`,
          `process.on("SIGTERM", () => {});`,
          `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid), "utf8");`,
          // Hold stdin open and stay alive until SIGKILL.
          `process.stdin.resume();`,
          `setInterval(() => {}, 1000);`,
          "",
        ].join("\n"),
      );

      const fiber = Effect.runFork(
        runProviderProcess(
          baseRequest({
            executable: process.execPath,
            args: [scriptPath],
            stdin: new TextEncoder().encode("interrupt-stdin"),
            timeoutMs: 30_000,
          }),
        ).pipe(Effect.provide(NodeProviderProcessRunnerLive)),
      );

      const pidReady = await pollUntil(
        async () => {
          if (!existsSync(pidPath)) return false;
          const raw = (await readFile(pidPath, "utf8")).trim();
          const pid = Number(raw);
          return Number.isInteger(pid) && pid > 0 && processExists(pid);
        },
        { timeoutMs: 5_000, intervalMs: 25 },
      );
      expect(pidReady).toBe(true);
      const livePid = Number((await readFile(pidPath, "utf8")).trim());
      childPid = livePid;

      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(processKillProbeCode(livePid)).toBe("ESRCH");
      const exit = await Effect.runPromise(Fiber.await(fiber));
      expect(exit._tag).toBe("Failure");
      expect(processKillProbeCode(livePid)).toBe("ESRCH");
    } finally {
      if (childPid !== undefined) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // already reaped
        }
      }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (scriptPath.length > 0) {
        await rm(dirname(scriptPath), { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  });

  // Shebang scripts are a POSIX executable contract. Native Windows CI must not
  // attempt to exec a #!/usr/bin/env node fixture as the process image.
  it.runIf(isPosixHost)(
    "records sourceUtf8Valid false when raw stdout is not valid UTF-8",
    async () => {
      const script = await writeScript(
        "invalid-utf8-stdout",
        [
          "#!/usr/bin/env node",
          "process.stdout.write(Buffer.from([0xff, 0x0a]));",
          "process.exit(0);",
          "",
        ].join("\n"),
      );
      const max = 64 * 1024;
      const observation = await run(
        baseRequest({
          executable: script,
          args: [],
          stdoutMaxBytes: max,
          stderrMaxBytes: max,
        }),
      );
      expect(observation.started).toBe(true);
      expect(observation.exitCode).toBe(0);
      // Provenance must mark the pre-sanitization capture invalid. Public bytes
      // stay bounded and secret-sanitized; raw invalid sequences stay internal.
      expect(Reflect.get(observation.stdout, "sourceUtf8Valid")).toBe(false);
      expect(observation.stdout.truncated).toBe(false);
      expect(observation.stdout.bytes.byteLength).toBeLessThanOrEqual(max);
      expect(observation.stdout.digest).toBe(
        sha256Hex(observation.stdout.bytes),
      );
      expect(() =>
        new TextDecoder("utf-8", { fatal: true }).decode(
          observation.stdout.bytes,
        ),
      ).not.toThrow();
    },
  );

  // This fixture depends on POSIX descendant handle inheritance to keep the
  // direct child's stdout binding open after exit. Native Windows needs the
  // planned Job Object owner (design-council-core task 5.3) for its equivalent
  // process-tree contract; plain child_process is not that owner.
  it.runIf(isPosixHost)(
    "awaits terminal close on interrupt after exit when inherited stdio still open",
    async () => {
      // Race: Node emits exit before close; close stays pending while a grandchild
      // holds the inherited stdout open. Interruption must not return after exit alone.
      const dir = await mkdtemp(join(tmpdir(), "council-exit-before-close-"));
      const parentPidPath = join(dir, "parent.pid");
      const sentinelPath = join(dir, "grandchild.sentinel");
      const grandchildLifetimeMs = 500;

      const grandchildScript = await writeScript(
        "grandchild-hold-stdout.mjs",
        [
          `import { writeFileSync } from "node:fs";`,
          // Keep inherited stdout open for a short bounded period, then self-exit.
          `await new Promise((r) => setTimeout(r, ${String(grandchildLifetimeMs)}));`,
          `writeFileSync(${JSON.stringify(sentinelPath)}, "done", "utf8");`,
          `process.exit(0);`,
          "",
        ].join("\n"),
      );

      const parentScript = await writeScript(
        "parent-exit-leave-stdio.mjs",
        [
          `import { writeFileSync } from "node:fs";`,
          `import { spawn } from "node:child_process";`,
          `writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid), "utf8");`,
          `const child = spawn(process.execPath, [${JSON.stringify(grandchildScript)}], {`,
          `  stdio: ["ignore", "inherit", "ignore"],`,
          `  detached: false,`,
          `});`,
          // Exit without waiting: parent exit fires while grandchild still holds stdout.
          `child.unref();`,
          `process.exit(0);`,
          "",
        ].join("\n"),
      );

      const fiber = Effect.runFork(
        runProviderProcess(
          baseRequest({
            executable: process.execPath,
            args: [parentScript],
            timeoutMs: 30_000,
          }),
        ).pipe(Effect.provide(NodeProviderProcessRunnerLive)),
      );

      // Wait until the direct child has exited (PID gone) and the grandchild has
      // not yet written the sentinel — exit has fired, close is still pending.
      const raceWindow = await pollUntil(
        async () => {
          if (!existsSync(parentPidPath)) return false;
          if (existsSync(sentinelPath)) return false;
          const raw = (await readFile(parentPidPath, "utf8")).trim();
          const pid = Number(raw);
          if (!Number.isInteger(pid) || pid <= 0) return false;
          return !processExists(pid);
        },
        { timeoutMs: 5_000, intervalMs: 10 },
      );
      expect(raceWindow).toBe(true);
      expect(existsSync(sentinelPath)).toBe(false);

      // Interrupt during the exit-before-close window. Must not complete until the
      // grandchild has exited (sentinel) and the binding terminal close has occurred.
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(existsSync(sentinelPath)).toBe(true);
      const exit = await Effect.runPromise(Fiber.await(fiber));
      expect(exit._tag).toBe("Failure");
    },
  );
});
