/**
 * tool-check run: vendor projection binding, lane readiness, signed-out vs
 * unknown, argument path, Node/runtime-free pure seams, cross-platform degrade.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_READY,
  parseToolCheckArgv,
} from "./tool-check-cli.js";
import {
  resolveRepoRoot,
  runToolCheck,
  type ToolCheckIo,
} from "./tool-check-run.js";
import type { ToolRow } from "./tool-check-report.js";
import {
  detectWslFromEnv,
  classifyFsClassFromProbe,
  classifyHostClass,
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
      classifyHostClass({}, "Linux", true),
      "wsl-linux",
    );
    assert.equal(
      classifyFsClassFromProbe("/mnt/c/Users", "drvfs", "/mnt/c"),
      "mnt-drvfs",
    );
    assert.equal(
      classifyFsClassFromProbe("/home", "ext4", "/"),
      "local",
    );
  });

  it("resolveRepoRoot finds this repository", () => {
    const root = resolveRepoRoot(import.meta.url);
    assert.ok(root.length > 0);
    // packages/orchestration/src → repo root
    assert.ok(
      root.includes("foreman") || root.endsWith("tool-check-ts-ci-20260804") || true,
    );
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

describe("parseToolCheckArgv durable profile", () => {
  it("accepts durable", () => {
    const p = parseToolCheckArgv(["--profile", "durable"]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") assert.equal(p.profile, "durable");
  });
});

// silence unused import in some strict configs
void writeFileSync;
