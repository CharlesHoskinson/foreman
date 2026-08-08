/**
 * tool-check run: vendor projection binding, lane readiness, signed-out vs
 * unknown, argument path, Node/runtime-free pure seams, cross-platform degrade.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_OUTPUT_WRITE_FAILED,
  EXIT_READY,
  parseToolCheckArgv,
} from "./tool-check-cli.js";
import {
  resolveRepoRoot,
  runToolCheck,
  MAX_INVENTORY_OUT_PATH_BYTES,
  MAX_WINGET_LYCHEE_PACKAGE_DIRS,
  resolveLycheeWinGetPackageExe,
  writeInventoryOutAtomic,
  type ToolCheckIo,
} from "./tool-check-run.js";
import type { ToolRow } from "./tool-check-report.js";
import {
  detectWslFromEnv,
  checkFsClassFromProbe,
  checkHostClass,
} from "./tool-check-platform.js";
import { projectVendorPreflightToToolCheckRow } from "./vendor-preflight-tool-check.js";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import {
  PathLookup,
  ProcessExec,
  ProcessFailure,
} from "./queue-services.js";
import { PreflightClock } from "./vendor-preflight-live.js";

const FIXED = "2026-08-04T15:00:00.000Z";

const emptyTable: VendorCapabilityTableV1 = {
  schemaVersion: 1,
  capabilities: [],
};

function captureIo(): ToolCheckIo & { stdout: string; stderr: string } {
  const io = {
    stdout: "",
    stderr: "",
    writeStdout(t: string) {
      io.stdout += t;
    },
    writeStderr(t: string) {
      io.stderr += t;
    },
  };
  return io;
}

function stubLayer(): Layer.Layer<ProcessExec | PathLookup | PreflightClock> {
  return Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: () =>
        Effect.fail(new ProcessFailure("spawn_failed")),
      runIgnoredStdio: () =>
        Effect.fail(new ProcessFailure("spawn_failed")),
      runForeground: () => Effect.fail(new ProcessFailure("spawn_failed")),
    }),
    Layer.succeed(PathLookup, {
      which: () => Effect.succeed(null),
      fileExists: () => Effect.succeed(false),
      isExecutable: () => Effect.succeed(false),
    }),
    Layer.succeed(PreflightClock, {
      nowUtcRfc3339: () => Effect.succeed(FIXED),
    }),
  );
}

describe("platform pure helpers", () => {
  it("detects WSL force override", () => {
    assert.equal(detectWslFromEnv({ FOREMAN_TEST_WSL_FORCE: "1" }, null).isWsl, true);
    assert.equal(detectWslFromEnv({ FOREMAN_TEST_WSL_FORCE: "0" }, "microsoft").isWsl, false);
    assert.equal(
      detectWslFromEnv({}, "Linux version ... Microsoft ...").isWsl,
      true,
    );
  });

  it("classifies host and fs classes", () => {
    assert.equal(
      checkHostClass({}, "Linux", true),
      "wsl-linux",
    );
    assert.equal(
      checkFsClassFromProbe("/mnt/c/Users", "drvfs", "/mnt/c"),
      "mnt-drvfs",
    );
    assert.equal(
      checkFsClassFromProbe("/home", "ext4", "/"),
      "local",
    );
  });

  it("resolveRepoRoot finds this repository from source tree path", () => {
    const root = resolveRepoRoot(import.meta.url);
    assert.ok(root.length > 0);
    assert.ok(
      existsSync(join(root, "env/reference-manifest.toml")),
      `expected manifest under ${root}`,
    );
    assert.ok(
      existsSync(join(root, "packages/orchestration/src/tool-check-run.ts")),
    );
  });

  it("resolveRepoRoot finds this repository from bundled dist path shape", () => {
    // Simulate the bundled layout URL without requiring the built file.
    const fakeBundleUrl = new URL(
      "file://" +
        join(
          resolveRepoRoot(import.meta.url),
          "skills/foreman/runtime/dist/tool-check.js",
        ),
    );
    const root = resolveRepoRoot(fakeBundleUrl.href);
    assert.ok(existsSync(join(root, "env/reference-manifest.toml")));
  });
});

describe("runToolCheck argument path", () => {
  it("invalid lane claude exits 2 with T7 message", async () => {
    const io = captureIo();
    const result = await Effect.runPromise(
      runToolCheck(["node", "tool-check.js", "--lane", "claude"], io, {
        repoRoot: "/tmp",
        capabilityTable: emptyTable,
        layer: stubLayer(),
        nowUtc: () => FIXED,
      }),
    );
    assert.equal(result.exitCode, EXIT_INVALID_ARGUMENTS);
    assert.match(io.stderr, /T7 removed claude/);
  });

  it("help exits 0", async () => {
    const io = captureIo();
    const result = await Effect.runPromise(
      runToolCheck(["--help"], io, {
        repoRoot: "/tmp",
        capabilityTable: emptyTable,
        layer: stubLayer(),
      }),
    );
    assert.equal(result.exitCode, EXIT_READY);
    assert.match(io.stdout, /usage:/);
  });
});

describe("vendor binding and projection (R4B boundaries in TypeScript)", () => {
  it("signed-out evidence projects to not_authenticated with login instruction", () => {
    const record: VendorPreflightRecordV1 = {
      schemaVersion: 1,
      vendor: "grok",
      timestamp: FIXED,
      resolvedPath: "/usr/bin/grok",
      reportedVersion: "0.2.118",
      versionFloor: "0.2.118",
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "on PATH",
        },
        authenticated: {
          value: "not-authenticated",
          evidenceClass: "probed",
          reason: "negative marker",
        },
        current: {
          value: "current",
          evidenceClass: "probed",
          reason: "floor ok",
        },
      },
      probes: [],
      remediation: {
        kind: "login",
        instruction: "grok login --device-code",
      },
    };
    const row = projectVendorPreflightToToolCheckRow(record);
    assert.equal(row.status, "not_authenticated");
    assert.match(row.detail, /grok login --device-code/);
  });

  it("unknown auth projects to degraded without login instruction", () => {
    const record: VendorPreflightRecordV1 = {
      schemaVersion: 1,
      vendor: "grok",
      timestamp: FIXED,
      resolvedPath: "/usr/bin/grok",
      reportedVersion: "0.2.118",
      versionFloor: "0.2.118",
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "unmatched banner",
        },
        current: {
          value: "current",
          evidenceClass: "probed",
          reason: "floor ok",
        },
      },
      probes: [],
      remediation: {
        kind: "diagnose",
        instruction: "Re-run bounded grok models",
      },
    };
    const row = projectVendorPreflightToToolCheckRow(record);
    assert.equal(row.status, "degraded");
    assert.doesNotMatch(row.detail, /login --device-code/);
  });

  it("injected vendor override binds lane readiness", async () => {
    const io = captureIo();
    const result = await Effect.runPromise(
      runToolCheck(
        ["node", "tool-check.js", "--profile", "soft", "--lane", "grok"],
        io,
        {
          repoRoot: resolveRepoRoot(import.meta.url),
          capabilityTable: emptyTable,
          layer: stubLayer(),
          nowUtc: () => FIXED,
          vendorRowOverride: (vendor) =>
            Effect.succeed({
              id: vendor,
              status: vendor === "grok" ? "ok" : "missing",
              detail: "test override ready",
            } satisfies ToolRow),
        },
      ),
    );
    // soft must-tools still fail (git/python/etc missing under stub layer)
    assert.equal(result.exitCode, EXIT_NOT_READY);
    assert.match(io.stdout, /LANE_READY: grok=yes/);
    assert.match(io.stdout, /grok\s+ok/);
  });

  it("vendor mismatch override cannot report ok for wrong id", async () => {
    const io = captureIo();
    await Effect.runPromise(
      runToolCheck(
        ["--profile", "soft", "--lane", "grok"],
        io,
        {
          repoRoot: resolveRepoRoot(import.meta.url),
          capabilityTable: emptyTable,
          layer: stubLayer(),
          nowUtc: () => FIXED,
          vendorRowOverride: () =>
            Effect.succeed({
              id: "codex",
              status: "ok",
              detail: "spoofed other vendor",
            }),
        },
      ),
    );
    assert.match(io.stdout, /grok\s+degraded/);
    assert.doesNotMatch(io.stdout, /^grok\s+ok/m);
    assert.match(io.stdout, /LANE_READY: grok=no/);
  });

  it("not_authenticated lane is LANE_READY=no", async () => {
    const io = captureIo();
    await Effect.runPromise(
      runToolCheck(["--lane", "grok"], io, {
        repoRoot: resolveRepoRoot(import.meta.url),
        capabilityTable: emptyTable,
        layer: stubLayer(),
        nowUtc: () => FIXED,
        vendorRowOverride: (vendor) =>
          Effect.succeed({
            id: vendor,
            status: "not_authenticated",
            detail: "run: grok login --device-code",
          }),
      }),
    );
    assert.match(io.stdout, /LANE_READY: grok=no/);
    assert.match(io.stdout, /NOT_AUTHENTICATED: grok/);
  });
});

describe("lychee WinGet Packages fallback", () => {
  it("resolveLycheeWinGetPackageExe selects deterministic package-layout path", () => {
    const localAppData = "/virt/AppData/Local";
    const packagesRoot = join(
      localAppData,
      "Microsoft/WinGet/Packages",
    );
    const namesByDir = new Map<string, readonly string[]>([
      [
        packagesRoot,
        [
          "other.pkg",
          "lycheeverse.lychee_2.0.0",
          "lycheeverse.lychee_1.0.0",
        ],
      ],
      [
        join(packagesRoot, "lycheeverse.lychee_1.0.0"),
        ["0.24.1", "0.24.0"],
      ],
      [
        join(packagesRoot, "lycheeverse.lychee_2.0.0"),
        ["0.25.0"],
      ],
    ]);
    const files = new Set([
      join(
        packagesRoot,
        "lycheeverse.lychee_1.0.0",
        "0.24.0",
        "lychee.exe",
      ),
      join(
        packagesRoot,
        "lycheeverse.lychee_1.0.0",
        "0.24.1",
        "lychee.exe",
      ),
      join(
        packagesRoot,
        "lycheeverse.lychee_2.0.0",
        "0.25.0",
        "lychee.exe",
      ),
    ]);
    // Lexicographic package then version order: 1.0.0 before 2.0.0, 0.24.0 before 0.24.1.
    const expected = join(
      packagesRoot,
      "lycheeverse.lychee_1.0.0",
      "0.24.0",
      "lychee.exe",
    );
    const hit = resolveLycheeWinGetPackageExe(localAppData, {
      listNames: (dir) => namesByDir.get(dir) ?? null,
      isFile: (path) => files.has(path),
    });
    assert.equal(hit, expected);
  });

  it("resolveLycheeWinGetPackageExe returns null when no package layout match", () => {
    const hit = resolveLycheeWinGetPackageExe("/virt/AppData/Local", {
      listNames: () => [],
      isFile: () => false,
    });
    assert.equal(hit, null);
  });

  it("resolveLycheeWinGetPackageExe bounds package directory scan", () => {
    const localAppData = "/virt/AppData/Local";
    const packagesRoot = join(
      localAppData,
      "Microsoft/WinGet/Packages",
    );
    const many = Array.from(
      { length: MAX_WINGET_LYCHEE_PACKAGE_DIRS + 5 },
      (_, i) => `lycheeverse.lychee_z${String(i).padStart(3, "0")}`,
    );
    // Only a directory past the bound would contain the executable.
    const beyond = many[MAX_WINGET_LYCHEE_PACKAGE_DIRS]!;
    const hit = resolveLycheeWinGetPackageExe(localAppData, {
      listNames: (dir) => {
        if (dir === packagesRoot) return many;
        if (dir === join(packagesRoot, beyond)) return ["v1"];
        return [];
      },
      isFile: (path) =>
        path === join(packagesRoot, beyond, "v1", "lychee.exe"),
    });
    assert.equal(hit, null);
  });

  it("Windows package-layout lychee is selected and spawned when Links shim is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-tc-lychee-winget-"));
    try {
      const localAppData = join(dir, "Local");
      const packageExe = join(
        localAppData,
        "Microsoft/WinGet/Packages",
        "lycheeverse.lychee_0.24.2",
        "0.24.2",
        "lychee.exe",
      );
      mkdirSync(dirname(packageExe), { recursive: true });
      writeFileSync(packageExe, "", "utf8");
      // Links shim intentionally absent.
      const links = join(
        localAppData,
        "Microsoft/WinGet/Links/lychee.exe",
      );
      assert.equal(existsSync(links), false);

      const spawned: string[] = [];
      const layer = Layer.mergeAll(
        Layer.succeed(ProcessExec, {
          runCaptured: (opts) => {
            spawned.push(opts.command);
            if (opts.command === packageExe) {
              return Effect.succeed({
                exitCode: 0,
                stdout: "lychee 0.24.2\n",
                stderr: "",
              });
            }
            return Effect.fail(new ProcessFailure("spawn_failed"));
          },
          runIgnoredStdio: () =>
            Effect.fail(new ProcessFailure("spawn_failed")),
          runForeground: () =>
            Effect.fail(new ProcessFailure("spawn_failed")),
        }),
        Layer.succeed(PathLookup, {
          which: () => Effect.succeed(null),
          fileExists: (p) => Effect.succeed(existsSync(p)),
          isExecutable: (p) => Effect.succeed(existsSync(p)),
        }),
        Layer.succeed(PreflightClock, {
          nowUtcRfc3339: () => Effect.succeed(FIXED),
        }),
      );

      const io = captureIo();
      await Effect.runPromise(
        runToolCheck(["--profile", "full"], io, {
          repoRoot: resolveRepoRoot(import.meta.url),
          capabilityTable: emptyTable,
          layer,
          nowUtc: () => FIXED,
          processEnv: {
            LOCALAPPDATA: localAppData,
            HOME: join(dir, "home"),
            PATH: "",
          },
          vendorRowOverride: (v) =>
            Effect.succeed({
              id: v,
              status: "missing",
              detail: "not installed",
            }),
        }),
      );

      assert.ok(
        spawned.includes(packageExe),
        `expected spawn of package exe, got: ${JSON.stringify(spawned)}`,
      );
      assert.match(io.stdout, /lychee\s+ok/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("JSON --out write", () => {
  it("writes inventory schema to --out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-tc-out-"));
    const out = join(dir, "inv.json");
    try {
      const io = captureIo();
      await Effect.runPromise(
        runToolCheck(
          ["--profile", "soft", "--json", "--out", out],
          io,
          {
            repoRoot: resolveRepoRoot(import.meta.url),
            capabilityTable: emptyTable,
            layer: stubLayer(),
            nowUtc: () => FIXED,
            vendorRowOverride: (v) =>
              Effect.succeed({
                id: v,
                status: "missing",
                detail: "not installed",
              }),
          },
        ),
      );
      const text = readFileSync(out, "utf8");
      const parsed = JSON.parse(text) as {
        schema: string;
        tools: unknown[];
      };
      assert.equal(parsed.schema, "foreman.tool-check.v1");
      assert.ok(Array.isArray(parsed.tools));
      assert.match(io.stderr, /wrote/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeInventoryOutAtomic", () => {
  it("writes exact bytes via exclusive temp + rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-tc-atomic-out-"));
    try {
      const out = join(dir, "out.json");
      const body = '{"schema":"foreman.tool-check.v1"}\n';
      const r = writeInventoryOutAtomic(out, body);
      assert.equal(r._tag, "Ok");
      assert.equal(readFileSync(out, "utf8"), body);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects path containing NUL", () => {
    const r = writeInventoryOutAtomic("/tmp/out\0.json", "x\n");
    assert.equal(r._tag, "Failed");
    if (r._tag === "Failed") assert.match(r.reason, /NUL|nul|invalid/i);
  });

  it("rejects UTF-8 path over MAX_INVENTORY_OUT_PATH_BYTES before mutation", () => {
    const prefix = "/tmp/";
    const over =
      prefix +
      "a".repeat(
        MAX_INVENTORY_OUT_PATH_BYTES - Buffer.byteLength(prefix, "utf8") + 1,
      );
    assert.equal(
      Buffer.byteLength(over, "utf8"),
      MAX_INVENTORY_OUT_PATH_BYTES + 1,
    );
    const r = writeInventoryOutAtomic(over, "x\n");
    assert.equal(r._tag, "Failed");
    if (r._tag === "Failed") {
      assert.match(r.reason, /MAX_INVENTORY_OUT_PATH_BYTES/);
    }
  });

  it("accepts exact MAX_INVENTORY_OUT_PATH_BYTES through the bound check", () => {
    const prefix = "/tmp/";
    const exact =
      prefix +
      "a".repeat(
        MAX_INVENTORY_OUT_PATH_BYTES - Buffer.byteLength(prefix, "utf8"),
      );
    assert.equal(
      Buffer.byteLength(exact, "utf8"),
      MAX_INVENTORY_OUT_PATH_BYTES,
    );
    const r = writeInventoryOutAtomic(exact, "x\n");
    // Bound check must not reject exact length; later FS failure is allowed.
    if (r._tag === "Failed") {
      assert.doesNotMatch(r.reason, /MAX_INVENTORY_OUT_PATH_BYTES/);
    }
  });

  it("refuses to follow a pre-existing output symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-tc-out-sym-"));
    try {
      const real = join(dir, "real.json");
      writeFileSync(real, "original\n", "utf8");
      const link = join(dir, "out.json");
      symlinkSync(real, link);
      const r = writeInventoryOutAtomic(link, "replaced\n");
      assert.equal(r._tag, "Failed");
      assert.equal(readFileSync(real, "utf8"), "original\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("failed --out write does not report readiness success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-tc-out-fail-"));
    try {
      const real = join(dir, "real.json");
      writeFileSync(real, "x\n", "utf8");
      const link = join(dir, "out.json");
      symlinkSync(real, link);
      const io = captureIo();
      const result = await Effect.runPromise(
        runToolCheck(
          ["--profile", "soft", "--json", "--out", link],
          io,
          {
            repoRoot: resolveRepoRoot(import.meta.url),
            capabilityTable: emptyTable,
            layer: stubLayer(),
            nowUtc: () => FIXED,
            vendorRowOverride: (v) =>
              Effect.succeed({
                id: v,
                status: "ok",
                detail: "ready",
              }),
          },
        ),
      );
      assert.equal(result.exitCode, EXIT_OUTPUT_WRITE_FAILED);
      assert.notEqual(result.exitCode, EXIT_READY);
      assert.match(io.stderr, /failed to write|symlink|output/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseToolCheckArgv durable profile", () => {
  it("accepts durable", () => {
    const p = parseToolCheckArgv(["--profile", "durable"]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") assert.equal(p.profile, "durable");
  });
});

describe("onVendorRecord capture seam (R4C2)", () => {
  it("invokes onVendorRecord once per live inspect before projection", async () => {
    const captured: VendorPreflightRecordV1[] = [];
    const readyRecord: VendorPreflightRecordV1 = {
      schemaVersion: 1,
      vendor: "grok",
      timestamp: FIXED,
      resolvedPath: "/usr/bin/grok",
      reportedVersion: "0.2.118",
      versionFloor: "0.2.118",
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "on PATH",
        },
        authenticated: {
          value: "authenticated",
          evidenceClass: "probed",
          reason: "positive marker",
        },
        current: {
          value: "current",
          evidenceClass: "probed",
          reason: "floor ok",
        },
      },
      probes: [],
      remediation: { kind: "none", instruction: null },
    };
    const capabilityTable: VendorCapabilityTableV1 = {
      schemaVersion: 1,
      capabilities: [
        {
          vendor: "grok",
          cliName: "grok",
          evidenceClass: "probed",
          authArgv: ["models"],
          versionArgv: ["--version"],
          versionFloor: "0.2.118",
          authPositiveMarkers: ["You are logged in with grok.com."],
          authNegativeMarkers: ["not authenticated"],
          updateMutates: true,
          updateCheckArgv: ["update", "--check", "--json"],
          loginInstruction: "grok login --device-code",
          installInstruction: "install grok",
          updateInstruction: "update grok",
          diagnoseInstruction: "diagnose grok",
        },
      ],
    };
    // Live inspect via PathLookup + ProcessExec that answer as ready grok.
    const liveLayer = Layer.mergeAll(
      Layer.succeed(ProcessExec, {
        runCaptured: (opts) => {
          const cmd = opts.command;
          const args = opts.args.join(" ");
          if (args.includes("--version") || cmd.endsWith("grok")) {
            if (opts.args[0] === "--version") {
              return Effect.succeed({
                exitCode: 0,
                stdout: "grok 0.2.118\n",
                stderr: "",
              });
            }
            if (opts.args[0] === "models") {
              return Effect.succeed({
                exitCode: 0,
                stdout: "You are logged in with grok.com.\n",
                stderr: "",
              });
            }
            if (opts.args[0] === "update") {
              return Effect.succeed({
                exitCode: 0,
                stdout: '{"update_available":false}\n',
                stderr: "",
              });
            }
          }
          return Effect.fail(new ProcessFailure("spawn_failed"));
        },
        runIgnoredStdio: () => Effect.fail(new ProcessFailure("spawn_failed")),
        runForeground: () => Effect.fail(new ProcessFailure("spawn_failed")),
      }),
      Layer.succeed(PathLookup, {
        which: (name) =>
          Effect.succeed(name === "grok" ? "/usr/bin/grok" : null),
        fileExists: () => Effect.succeed(false),
        isExecutable: () => Effect.succeed(false),
      }),
      Layer.succeed(PreflightClock, {
        nowUtcRfc3339: () => Effect.succeed(FIXED),
      }),
    );
    const io = captureIo();
    // Force only grok vendor row by soft profile would also probe many tools;
    // onVendorRecord must still fire for the live grok inspect.
    await Effect.runPromise(
      runToolCheck(["--profile", "soft", "--lane", "grok"], io, {
        repoRoot: resolveRepoRoot(import.meta.url),
        capabilityTable,
        layer: liveLayer,
        nowUtc: () => FIXED,
        processEnv: {
          HOME: "/tmp/foreman-onvendor-home",
          FOREMAN_TEST_WSL_FORCE: "0",
          PATH: "/usr/bin",
        },
        onVendorRecord: (record) =>
          Effect.sync(() => {
            captured.push(record);
          }),
      }),
    );
    assert.ok(
      captured.some((r) => r.vendor === "grok"),
      "expected onVendorRecord to receive the grok preflight record",
    );
    // Must be the exact inspect record shape (decoded vendor binding).
    const grok = captured.find((r) => r.vendor === "grok")!;
    assert.equal(grok.schemaVersion, 1);
    assert.equal(typeof grok.facts.authenticated.value, "string");
    // vendorRowOverride path must NOT be required for the seam to work.
    void readyRecord;
  });

  it("does not invoke onVendorRecord when vendorRowOverride is used", async () => {
    let calls = 0;
    const io = captureIo();
    await Effect.runPromise(
      runToolCheck(["--profile", "soft", "--lane", "grok"], io, {
        repoRoot: resolveRepoRoot(import.meta.url),
        capabilityTable: emptyTable,
        layer: stubLayer(),
        nowUtc: () => FIXED,
        vendorRowOverride: (vendor) =>
          Effect.succeed({
            id: vendor,
            status: "ok",
            detail: "override",
          }),
        onVendorRecord: () =>
          Effect.sync(() => {
            calls += 1;
          }),
      }),
    );
    assert.equal(calls, 0);
  });
});

void dirname;
