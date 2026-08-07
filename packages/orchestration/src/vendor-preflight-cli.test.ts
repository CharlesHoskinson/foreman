/**
 * vendor-preflight CLI parse, exits, and record emission.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  EXIT_BOUNDARY_FAILURE,
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_READY,
  MSG_UNCONFIGURED_VENDOR,
  parsePreflightArgv,
  runVendorPreflightCli,
  selectRecordedRefusalReason,
  stripPreflightNodeArgv,
} from "./vendor-preflight-cli.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import {
  PreflightClock,
  VendorPreflightFailure,
} from "./vendor-preflight-live.js";
import {
  PreflightRecordStore,
  livePreflightRecordStore,
} from "./vendor-preflight-store.js";

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

  it("parses tool-check-row for grok|codex only", () => {
    assert.deepEqual(parsePreflightArgv(["tool-check-row", "grok"]), {
      _tag: "ToolCheckRow",
      vendor: "grok",
    });
    assert.deepEqual(parsePreflightArgv(["tool-check-row", "codex"]), {
      _tag: "ToolCheckRow",
      vendor: "codex",
    });
    assert.equal(
      parsePreflightArgv(["tool-check-row", "claude"])._tag,
      "Invalid",
    );
    assert.equal(parsePreflightArgv(["tool-check-row"])._tag, "Invalid");
  });

  it("parses write-record and lane-gate with absolute paths only", () => {
    assert.deepEqual(
      parsePreflightArgv(["write-record", "grok", "/tmp/preflight/grok.json"]),
      {
        _tag: "WriteRecord",
        vendor: "grok",
        path: "/tmp/preflight/grok.json",
      },
    );
    assert.deepEqual(
      parsePreflightArgv(["lane-gate", "codex", "/abs/codex.json"]),
      {
        _tag: "LaneGate",
        vendor: "codex",
        path: "/abs/codex.json",
      },
    );
    assert.equal(
      parsePreflightArgv(["write-record", "grok", "relative.json"])._tag,
      "Invalid",
    );
    assert.equal(
      parsePreflightArgv(["lane-gate", "grok", "relative.json"])._tag,
      "Invalid",
    );
    assert.equal(parsePreflightArgv(["write-record", "grok"])._tag, "Invalid");
    assert.equal(parsePreflightArgv(["lane-gate", "grok"])._tag, "Invalid");
    assert.deepEqual(
      parsePreflightArgv([
        "node",
        "skills/foreman/runtime/dist/vendor-preflight.js",
        "lane-gate",
        "grok",
        "/tmp/x.json",
      ]),
      {
        _tag: "LaneGate",
        vendor: "grok",
        path: "/tmp/x.json",
      },
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

  it("tool-check-row writes one TSV row and one LF", async () => {
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["tool-check-row", "grok"], cap.io, {
        capabilityTable: table,
        layer: readyLayer(),
      }),
    );
    assert.equal(code, EXIT_READY);
    const out = cap.stdout();
    assert.ok(out.endsWith("\n"));
    const lines = out.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1);
    const parts = lines[0]!.split("\t");
    assert.equal(parts.length, 3);
    assert.equal(parts[0], "grok");
    assert.equal(parts[1], "ok");
    assert.ok(parts[2]!.length > 0);
    assert.ok(!parts[2]!.includes("\t"));
    // Must not emit JSON for the adapter command.
    assert.ok(!out.trimStart().startsWith("{"));
  });

  it("tool-check-row invalid args and boundary failures write no stdout", async () => {
    const capInvalid = ioCapture();
    const codeInvalid = await Effect.runPromise(
      runVendorPreflightCli(["tool-check-row", "claude"], capInvalid.io, {
        capabilityTable: table,
        layer: readyLayer(),
      }),
    );
    assert.equal(codeInvalid, EXIT_INVALID_ARGUMENTS);
    assert.equal(capInvalid.stdout(), "");

    const capBoundary = ioCapture();
    const codeBoundary = await Effect.runPromise(
      runVendorPreflightCli(["tool-check-row", "grok"], capBoundary.io, {
        capabilityTable: table,
        inspect: () =>
          Effect.fail(new VendorPreflightFailure("internal", "boom")),
      }),
    );
    assert.equal(codeBoundary, EXIT_BOUNDARY_FAILURE);
    assert.equal(capBoundary.stdout(), "");
  });

  it("binds inspect result vendor to the requested vendor before emission", async () => {
    // Injected inspect returns a valid Codex ready record for a Grok request.
    // Must not emit a Codex row or JSON; exit is boundary/internal failure.
    const codexReady = {
      schemaVersion: 1 as const,
      vendor: "codex" as const,
      timestamp: FIXED_TS,
      resolvedPath: "/usr/bin/codex",
      reportedVersion: "0.146.0",
      versionFloor: "0.146.0",
      facts: {
        discoverable: {
          value: "discoverable" as const,
          evidenceClass: "declared" as const,
          reason: "CLI resolved",
        },
        authenticated: {
          value: "authenticated" as const,
          evidenceClass: "declared" as const,
          reason: "signed in",
        },
        current: {
          value: "current" as const,
          evidenceClass: "declared" as const,
          reason: "meets floor",
        },
      },
      probes: [
        {
          kind: "version" as const,
          argv: ["codex", "--version"],
          outcome: "completed" as const,
          exitCode: 0,
        },
        {
          kind: "auth" as const,
          argv: ["codex", "login", "status"],
          outcome: "completed" as const,
          exitCode: 0,
        },
      ],
      remediation: { kind: "none" as const, instruction: null },
    };

    const capRow = ioCapture();
    const codeRow = await Effect.runPromise(
      runVendorPreflightCli(["tool-check-row", "grok"], capRow.io, {
        capabilityTable: table,
        inspect: () => Effect.succeed(codexReady),
      }),
    );
    assert.equal(codeRow, EXIT_BOUNDARY_FAILURE);
    assert.equal(capRow.stdout(), "");
    assert.ok(capRow.stderr().length > 0);

    const capInspect = ioCapture();
    const codeInspect = await Effect.runPromise(
      runVendorPreflightCli(["inspect", "grok"], capInspect.io, {
        capabilityTable: table,
        inspect: () => Effect.succeed(codexReady),
      }),
    );
    assert.equal(codeInspect, EXIT_BOUNDARY_FAILURE);
    assert.equal(capInspect.stdout(), "");
    assert.ok(capInspect.stderr().length > 0);
  });

  it("inspect command output and exit codes remain unchanged", async () => {
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["inspect", "grok"], cap.io, {
        capabilityTable: table,
        layer: readyLayer(),
      }),
    );
    assert.equal(code, EXIT_READY);
    const line = cap.stdout().replace(/\n$/, "");
    assert.ok(isCanonicalJsonText(line));
    const decoded = decodeVendorPreflightRecordV1(JSON.parse(line));
    assert.ok(!isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.vendor, "grok");
  });
});

function fixtureReadyRecord(
  vendor: "grok" | "codex" = "grok",
): VendorPreflightRecordV1 {
  return {
    schemaVersion: 1,
    vendor,
    timestamp: FIXED_TS,
    resolvedPath: `/usr/bin/${vendor}`,
    reportedVersion: vendor === "codex" ? "0.146.0" : "0.2.118",
    versionFloor: vendor === "codex" ? "0.146.0" : "0.2.118",
    facts: {
      discoverable: {
        value: "discoverable",
        evidenceClass: "declared",
        reason: "CLI resolved",
      },
      authenticated: {
        value: "authenticated",
        evidenceClass: "declared",
        reason: "signed in",
      },
      current: {
        value: "current",
        evidenceClass: "declared",
        reason: "meets floor",
      },
    },
    probes: [
      {
        kind: "version",
        argv: [vendor, "--version"],
        outcome: "completed",
        exitCode: 0,
      },
      {
        kind: "auth",
        argv:
          vendor === "codex"
            ? [vendor, "login", "status"]
            : [vendor, "models"],
        outcome: "completed",
        exitCode: 0,
      },
    ],
    remediation: { kind: "none", instruction: null },
  };
}

function fixtureNotReadyAuthUnknown(): VendorPreflightRecordV1 {
  return {
    schemaVersion: 1,
    vendor: "grok",
    timestamp: FIXED_TS,
    resolvedPath: "/usr/bin/grok",
    reportedVersion: "0.2.118",
    versionFloor: "0.2.118",
    facts: {
      discoverable: {
        value: "discoverable",
        evidenceClass: "probed",
        reason: "CLI resolved on PATH",
      },
      authenticated: {
        value: "unknown",
        evidenceClass: "probed",
        reason: "auth probe timed out",
      },
      current: {
        value: "current",
        evidenceClass: "probed",
        reason: "reported version meets floor",
      },
    },
    probes: [
      {
        kind: "version",
        argv: ["grok", "--version"],
        outcome: "completed",
        exitCode: 0,
      },
      {
        kind: "auth",
        argv: ["grok", "models"],
        outcome: "timeout",
        exitCode: null,
      },
    ],
    remediation: {
      kind: "diagnose",
      instruction: "Re-run bounded grok models",
    },
  };
}

describe("selectRecordedRefusalReason", () => {
  it("selects the first not-ready fact reason in discoverable → auth → current order", () => {
    const missing: VendorPreflightRecordV1 = {
      schemaVersion: 1,
      vendor: "grok",
      timestamp: FIXED_TS,
      resolvedPath: null,
      reportedVersion: null,
      versionFloor: "0.2.118",
      facts: {
        discoverable: {
          value: "missing",
          evidenceClass: "probed",
          reason: "CLI not on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "auth not evaluated",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "currency not evaluated",
        },
      },
      probes: [],
      remediation: {
        kind: "install",
        instruction: "npm install -g @xai-official/grok@latest",
      },
    };
    assert.equal(selectRecordedRefusalReason(missing), "CLI not on PATH");
    assert.equal(
      selectRecordedRefusalReason(fixtureNotReadyAuthUnknown()),
      "auth probe timed out",
    );

    const outdated: VendorPreflightRecordV1 = {
      ...fixtureReadyRecord("grok"),
      reportedVersion: "0.1.0",
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "authenticated",
          evidenceClass: "probed",
          reason: "signed in",
        },
        current: {
          value: "outdated",
          evidenceClass: "probed",
          reason: "version below floor",
        },
      },
    };
    assert.equal(selectRecordedRefusalReason(outdated), "version below floor");
  });
});

describe("write-record and lane-gate", () => {
  it("write-record inspects once, persists the validated record, exit 0 when ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-wr-"));
    const path = join(dir, "grok.json");
    let inspectCalls = 0;
    const rec = fixtureReadyRecord("grok");
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["write-record", "grok", path], cap.io, {
        capabilityTable: table,
        inspect: () => {
          inspectCalls += 1;
          return Effect.succeed(rec);
        },
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_READY);
    assert.equal(inspectCalls, 1);
    assert.equal(cap.stdout(), "");
    assert.ok(existsSync(path));
    const line = readFileSync(path, "utf8").replace(/\n$/, "");
    assert.ok(isCanonicalJsonText(line));
    const decoded = decodeVendorPreflightRecordV1(JSON.parse(line));
    assert.ok(!isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.vendor, "grok");
  });

  it("write-record persists a valid not-ready record and exits 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-wrnr-"));
    const path = join(dir, "grok.json");
    const rec = fixtureNotReadyAuthUnknown();
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["write-record", "grok", path], cap.io, {
        capabilityTable: table,
        inspect: () => Effect.succeed(rec),
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_NOT_READY);
    assert.ok(existsSync(path));
    const decoded = decodeVendorPreflightRecordV1(
      JSON.parse(readFileSync(path, "utf8")),
    );
    assert.ok(!isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.facts.authenticated.value, "unknown");
  });

  it("write-record rejects relative paths with exit 2", async () => {
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["write-record", "grok", "rel.json"], cap.io, {
        capabilityTable: table,
      }),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.equal(cap.stdout(), "");
  });

  it("write-record binds inspect result to the requested vendor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-bind-"));
    const path = join(dir, "grok.json");
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["write-record", "grok", path], cap.io, {
        capabilityTable: table,
        inspect: () => Effect.succeed(fixtureReadyRecord("codex")),
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_BOUNDARY_FAILURE);
    assert.equal(existsSync(path), false);
  });

  it("lane-gate passes only when all three facts are ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-lg-"));
    const path = join(dir, "grok.json");
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(path, fixtureReadyRecord("grok"));
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["lane-gate", "grok", path], cap.io, {
        capabilityTable: table,
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_READY);
    assert.equal(cap.stdout(), "");
    assert.equal(cap.stderr(), "");
  });

  it("lane-gate emits the selected recorded reason unchanged for exit 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-lg1-"));
    const path = join(dir, "grok.json");
    const rec = fixtureNotReadyAuthUnknown();
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(path, rec);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["lane-gate", "grok", path], cap.io, {
        capabilityTable: table,
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_NOT_READY);
    assert.equal(cap.stdout(), "");
    assert.equal(cap.stderr(), "auth probe timed out\n");
  });

  it("lane-gate rejects vendor mismatch with exit 3", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-mis-"));
    const path = join(dir, "x.json");
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(path, fixtureReadyRecord("codex"));
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["lane-gate", "grok", path], cap.io, {
        capabilityTable: table,
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_BOUNDARY_FAILURE);
    assert.equal(cap.stdout(), "");
  });

  it("lane-gate fails closed on missing record with exit 3", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-miss-"));
    const path = join(dir, "absent.json");
    const cap = ioCapture();
    const code = await Effect.runPromise(
      runVendorPreflightCli(["lane-gate", "grok", path], cap.io, {
        capabilityTable: table,
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_BOUNDARY_FAILURE);
  });

  it("lane-gate does not use PathLookup or ProcessExec", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cli-noio-"));
    const path = join(dir, "grok.json");
    // Seed via raw filesystem + public decoder shape (store write uses fs only).
    writeFileSync(
      path,
      canonicalize(fixtureReadyRecord("grok") as unknown) + "\n",
      "utf8",
    );

    const cap = ioCapture();
    // Provide ONLY PreflightRecordStore — no ProcessExec, PathLookup, or clock.
    // lane-gate must succeed without those services. A regression that
    // reintroduces inspectVendor-style probes would fail at runtime because
    // ProcessExec/PathLookup tags are absent from storeLayer.
    const code = await Effect.runPromise(
      runVendorPreflightCli(["lane-gate", "grok", path], cap.io, {
        capabilityTable: table,
        storeLayer: livePreflightRecordStore,
      }),
    );
    assert.equal(code, EXIT_READY);
    assert.equal(cap.stdout(), "");
    assert.equal(cap.stderr(), "");
  });
});
