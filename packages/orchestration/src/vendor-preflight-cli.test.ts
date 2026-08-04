/**
 * vendor-preflight CLI parse, exits, and record emission.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize, isCanonicalJsonText } from "@foreman/core";
import {
  PathLookup,
  ProcessExec,
  ProcessFailure,
  type CapturedProcessResult,
  type RunCapturedOptions,
  type RunForegroundOptions,
  type RunIgnoredStdioOptions,
} from "./queue-services.js";
import {
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_READY,
  MSG_UNCONFIGURED_VENDOR,
  parsePreflightArgv,
  runVendorPreflightCli,
  stripPreflightNodeArgv,
} from "./vendor-preflight-cli.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
} from "./vendor-preflight-contract.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import { PreflightClock } from "./vendor-preflight-live.js";

const FIXED_TS = "2026-08-04T15:00:00.000Z";

const table: VendorCapabilityTableV1 = {
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
      authNegativeMarkers: ["not authenticated", "sign in", "log in"],
      updateMutates: true,
      updateCheckArgv: ["update", "--check", "--json"],
      loginInstruction: "grok login --device-code",
      installInstruction: "npm install -g @xai-official/grok@latest",
      updateInstruction: "npm install -g @xai-official/grok@latest",
      diagnoseInstruction: "Re-run bounded grok models",
    },
    {
      vendor: "claude",
      cliName: "claude",
      evidenceClass: "declared",
      authArgv: ["auth", "status"],
      versionArgv: ["--version"],
      versionFloor: "2.1.220",
      authPositiveMarkers: [],
      authNegativeMarkers: [],
      updateMutates: true,
      updateCheckArgv: null,
      loginInstruction: "claude auth login",
      installInstruction: "Install Claude Code",
      updateInstruction: "claude update",
      diagnoseInstruction: "Re-run claude auth status",
    },
    {
      vendor: "codex",
      cliName: "codex",
      evidenceClass: "declared",
      authArgv: ["login", "status"],
      versionArgv: ["--version"],
      versionFloor: "0.146.0",
      authPositiveMarkers: [],
      authNegativeMarkers: ["Not logged in"],
      updateMutates: true,
      updateCheckArgv: null,
      loginInstruction: "codex login",
      installInstruction: "npm install -g @openai/codex@latest",
      updateInstruction: "npm install -g @openai/codex@latest",
      diagnoseInstruction: "Re-run codex login status",
    },
  ],
};

function ioCapture() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: () => stdout,
    stderr: () => stderr,
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
  };
}

function readyLayer() {
  return Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: (o: RunCapturedOptions) => {
        if (o.args[0] === "models" || o.args[0] === "login" || o.args[0] === "auth") {
          if (o.args[0] === "auth") {
            return Effect.succeed({
              exitCode: 0,
              stdout: JSON.stringify({ loggedIn: true }),
              stderr: "",
            } satisfies CapturedProcessResult);
          }
          if (o.args[0] === "login") {
            return Effect.succeed({
              exitCode: 0,
              stdout: "Logged in using ChatGPT\n",
              stderr: "",
            });
          }
          return Effect.succeed({
            exitCode: 0,
            stdout: "You are logged in with grok.com.\n",
            stderr: "",
          });
        }
        // version
        const ver =
          o.command.includes("claude") || o.args.includes("--version")
            ? o.command.includes("claude")
              ? "2.1.220\n"
              : o.command.includes("codex")
                ? "0.146.0\n"
                : "0.2.118\n"
            : "0.2.118\n";
        // Use floor-meeting versions based on executable path
        let stdout = "0.2.118\n";
        if (o.command.includes("claude")) stdout = "2.1.220\n";
        if (o.command.includes("codex")) stdout = "0.146.0\n";
        if (o.command.includes("grok")) stdout = "0.2.118\n";
        void ver;
        return Effect.succeed({ exitCode: 0, stdout, stderr: "" });
      },
      runIgnoredStdio: (_o: RunIgnoredStdioOptions) =>
        Effect.fail(new ProcessFailure("spawn_failed")),
      runForeground: (_o: RunForegroundOptions) =>
        Effect.fail(new ProcessFailure("spawn_failed")),
    }),
    Layer.succeed(PathLookup, {
      which: (name) => Effect.succeed(`/usr/bin/${name}`),
      fileExists: () => Effect.succeed(true),
      isExecutable: () => Effect.succeed(true),
    }),
    Layer.succeed(PreflightClock, {
      nowUtcRfc3339: () => Effect.succeed(FIXED_TS),
    }),
  );
}

describe("parsePreflightArgv", () => {
  it("parses inspect <vendor> and rejects garbage", () => {
    assert.deepEqual(parsePreflightArgv(["inspect", "grok"]), {
      _tag: "Inspect",
      vendor: "grok",
    });
    assert.deepEqual(
      parsePreflightArgv([
        "node",
        "skills/foreman/runtime/dist/vendor-preflight.js",
        "inspect",
        "claude",
      ]),
      { _tag: "Inspect", vendor: "claude" },
    );
    assert.equal(parsePreflightArgv(["inspect"])._tag, "Invalid");
    assert.equal(parsePreflightArgv(["status", "grok"])._tag, "Invalid");
    assert.deepEqual(
      stripPreflightNodeArgv(["node", "vendor-preflight.js", "inspect", "x"]),
      ["inspect", "x"],
    );
  });
});

describe("runVendorPreflightCli", () => {
  it("exit 0 emits one canonical JSON record when fully ready", async () => {
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(
        ["inspect", "grok"],
        cap.io,
        { capabilityTable: table, layer: readyLayer() },
      ),
    );
    assert.equal(code, EXIT_READY);
    assert.equal(cap.stderr(), "");
    const line = cap.stdout().replace(/\n$/, "");
    assert.ok(isCanonicalJsonText(line));
    const parsed = JSON.parse(line);
    const decoded = decodeVendorPreflightRecordV1(parsed);
    assert.ok(!isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.vendor, "grok");
    assert.equal(canonicalize(parsed), line);
  });

  it("exit 1 when auth unknown after timeout", async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(ProcessExec, {
        runCaptured: (o: RunCapturedOptions) => {
          if (o.args[0] === "models") {
            return Effect.fail(new ProcessFailure("timeout"));
          }
          return Effect.succeed({
            exitCode: 0,
            stdout: "0.2.118\n",
            stderr: "",
          });
        },
        runIgnoredStdio: () => Effect.fail(new ProcessFailure("spawn_failed")),
        runForeground: () => Effect.fail(new ProcessFailure("spawn_failed")),
      }),
      Layer.succeed(PathLookup, {
        which: () => Effect.succeed("/usr/bin/grok"),
        fileExists: () => Effect.succeed(true),
        isExecutable: () => Effect.succeed(true),
      }),
      Layer.succeed(PreflightClock, {
        nowUtcRfc3339: () => Effect.succeed(FIXED_TS),
      }),
    );
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["inspect", "grok"], cap.io, {
        capabilityTable: table,
        layer,
      }),
    );
    assert.equal(code, EXIT_NOT_READY);
    const rec = decodeVendorPreflightRecordV1(JSON.parse(cap.stdout().trim()));
    assert.ok(!isVendorPreflightContractFailure(rec));
    assert.equal(rec.facts.authenticated.value, "unknown");
    assert.notEqual(rec.remediation.kind, "login");
  });

  it("agy is a closed unconfigured CLI error without inventing a probe", async () => {
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["inspect", "agy"], cap.io, {
        capabilityTable: table,
        layer: readyLayer(),
      }),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.match(cap.stderr(), new RegExp(MSG_UNCONFIGURED_VENDOR));
    assert.equal(cap.stdout(), "");
  });

  it("invalid argv exits 2 with no record", async () => {
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["nope"], cap.io, {
        capabilityTable: table,
        layer: readyLayer(),
      }),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.equal(cap.stdout(), "");
  });
});
