/**
 * Foreman Setup CLI: argument parse, readiness projection, vendor preflight
 * persistence, login instructions only for positive not-authenticated evidence.
 * Sprint 3 R4C2 — TDD red-first.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { isCanonicalJsonText } from "@foreman/core";
import {
  PathLookup,
  ProcessExec,
  ProcessFailure,
} from "./queue-services.js";
import { PreflightClock } from "./vendor-preflight-live.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import {
  livePreflightRecordStore,
  PreflightRecordStore,
  PreflightStoreFailure,
} from "./vendor-preflight-store.js";
import {
  EXIT_BOUNDARY_FAILURE,
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_READY,
  USAGE,
  authInstruction,
  parseSetupArgv,
  parseDurableEnabledFromToml,
  resolveForemanHome,
  resolvePreflightRecordPath,
  runForemanSetup,
  stripSetupNodeArgv,
  type SetupIo,
} from "./foreman-setup.js";

const FIXED = "2026-08-04T15:00:00.000Z";

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
      authNegativeMarkers: ["not authenticated", "sign in", "log in"],
      updateMutates: true,
      updateCheckArgv: ["update", "--check", "--json"],
      loginInstruction: "grok login --device-code",
      installInstruction: "npm install -g @xai-official/grok@latest",
      updateInstruction: "npm install -g @xai-official/grok@latest",
      diagnoseInstruction: "Re-run bounded grok models",
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

function captureIo(): SetupIo & { stdout: string; stderr: string } {
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

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "foreman-setup-home-"));
}

function vendorLayer(opts: {
  grokAuthStdout: string;
  codexAuthStdout?: string;
}): Layer.Layer<ProcessExec | PathLookup | PreflightClock> {
  return Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: (o) => {
        const name = o.command.includes("codex")
          ? "codex"
          : o.command.includes("grok")
            ? "grok"
            : o.command;
        const head = o.args[0] ?? "";
        if (head === "--version") {
          const ver =
            name === "codex" ? "codex-cli 0.146.0" : "grok 0.2.118";
          return Effect.succeed({
            exitCode: 0,
            stdout: ver + "\n",
            stderr: "",
          });
        }
        if (name === "grok" && head === "models") {
          return Effect.succeed({
            exitCode: 0,
            stdout: opts.grokAuthStdout,
            stderr: "",
          });
        }
        if (name === "codex" && head === "login") {
          return Effect.succeed({
            exitCode: 0,
            stdout: opts.codexAuthStdout ?? "Logged in\n",
            stderr: "",
          });
        }
        if (name === "grok" && head === "update") {
          return Effect.succeed({
            exitCode: 0,
            stdout: '{"update_available":false}\n',
            stderr: "",
          });
        }
        // Other tools: missing
        return Effect.fail(new ProcessFailure("spawn_failed"));
      },
      runIgnoredStdio: () => Effect.fail(new ProcessFailure("spawn_failed")),
      runForeground: () => Effect.fail(new ProcessFailure("spawn_failed")),
    }),
    Layer.succeed(PathLookup, {
      which: (n) => {
        if (n === "grok") return Effect.succeed("/usr/bin/grok");
        if (n === "codex") return Effect.succeed("/usr/bin/codex");
        return Effect.succeed(null);
      },
      fileExists: () => Effect.succeed(false),
      isExecutable: () => Effect.succeed(false),
    }),
    Layer.succeed(PreflightClock, {
      nowUtcRfc3339: () => Effect.succeed(FIXED),
    }),
  );
}

describe("parseSetupArgv", () => {
  it("defaults to soft profile and no lane", () => {
    const p = parseSetupArgv([]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") {
      assert.equal(p.profile, "soft");
      assert.equal(p.lane, null);
    }
  });

  it("accepts --profile hard|full and --lane grok|codex", () => {
    const p = parseSetupArgv(["--profile", "full", "--lane", "codex"]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") {
      assert.equal(p.profile, "full");
      assert.equal(p.lane, "codex");
    }
  });

  it("rejects --lane claude and unknown args with exit-2 shape", () => {
    const claude = parseSetupArgv(["--lane", "claude"]);
    assert.equal(claude._tag, "Invalid");
    const unk = parseSetupArgv(["--unknown"]);
    assert.equal(unk._tag, "Invalid");
    const badProf = parseSetupArgv(["--profile", "durable"]);
    assert.equal(badProf._tag, "Invalid");
  });

  it("help returns Help tag", () => {
    assert.equal(parseSetupArgv(["--help"])._tag, "Help");
  });

  it("stripSetupNodeArgv drops node and script", () => {
    assert.deepEqual(
      stripSetupNodeArgv(["node", "foreman-setup.js", "--profile", "soft"]),
      ["--profile", "soft"],
    );
  });
});

describe("authInstruction and paths", () => {
  it("returns known login instructions without absolute paths", () => {
    assert.match(authInstruction("grok"), /grok login --device-code/);
    assert.match(authInstruction("codex"), /codex login/);
    assert.doesNotMatch(authInstruction("grok"), /\//);
  });

  it("resolves FOREMAN_HOME and preflight record path", () => {
    const home = resolveForemanHome({ FOREMAN_HOME: "/tmp/fh" });
    assert.equal(home, "/tmp/fh");
    assert.equal(
      resolvePreflightRecordPath(home, "grok"),
      join("/tmp/fh", "preflight", "grok.json"),
    );
  });

  it("on native Windows prefers USERPROFILE over Git-Bash-style HOME", () => {
    const home = resolveForemanHome(
      {
        HOME: "/c/Users/runneradmin",
        USERPROFILE: "C:\\Users\\runneradmin",
      },
      "win32",
    );
    assert.equal(home, join("C:\\Users\\runneradmin", ".foreman"));
  });

  it("on POSIX prefers HOME over USERPROFILE", () => {
    const home = resolveForemanHome(
      {
        HOME: "/home/runneradmin",
        USERPROFILE: "C:\\Users\\runneradmin",
      },
      "linux",
    );
    assert.equal(home, join("/home/runneradmin", ".foreman"));
  });

  it("parseDurableEnabledFromToml reads repository TOML only", () => {
    assert.equal(parseDurableEnabledFromToml(""), null);
    assert.equal(
      parseDurableEnabledFromToml("[durable]\nenabled = false\n"),
      false,
    );
    assert.equal(
      parseDurableEnabledFromToml("[durable]\nenabled = true\n"),
      true,
    );
    assert.equal(
      parseDurableEnabledFromToml("[other]\nenabled = false\n"),
      null,
    );
  });
});

describe("runForemanSetup persistence and readiness", () => {
  it("persists not-ready grok record under FOREMAN_HOME and exits 1 with login line", async () => {
    const home = tempHome();
    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runForemanSetup(
          ["--profile", "soft", "--lane", "grok"],
          io,
          {
            repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
            capabilityTable,
            processEnv: {
              HOME: home,
              FOREMAN_HOME: home,
              FOREMAN_TEST_WSL_FORCE: "0",
              PATH: "/usr/bin",
            },
            layer: vendorLayer({
              grokAuthStdout: "You are not authenticated.\n",
            }),
            storeLayer: livePreflightRecordStore,
            nowUtc: () => FIXED,
            // Skip launcher side effects
            ensureLauncher: () => Effect.succeed({ ok: true as const }),
            durableEnabled: null,
          },
        ),
      );
      assert.equal(code, EXIT_NOT_READY);
      assert.match(io.stdout, /SETUP: NOT-READY/);
      assert.match(io.stdout, /grok: NOT-READY -- run grok login --device-code/);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      const path = resolvePreflightRecordPath(home, "grok");
      assert.ok(existsSync(path), "expected persisted grok.json");
      const body = readFileSync(path, "utf8");
      assert.ok(isCanonicalJsonText(body.replace(/\n$/, "")));
      const decoded = decodeVendorPreflightRecordV1(JSON.parse(body));
      assert.ok(!isVendorPreflightContractFailure(decoded));
      assert.equal(decoded.vendor, "grok");
      assert.equal(decoded.facts.authenticated.value, "not-authenticated");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not emit login instruction for degraded unknown auth", async () => {
    const home = tempHome();
    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--profile", "soft", "--lane", "grok"], io, {
          repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "Error: leader socket unavailable\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_NOT_READY);
      assert.match(io.stdout, /SETUP: NOT-READY/);
      assert.doesNotMatch(
        io.stdout,
        /grok: NOT-READY -- run grok login --device-code/,
      );
      // Still persist the unknown-auth record.
      const path = resolvePreflightRecordPath(home, "grok");
      assert.ok(existsSync(path));
      const decoded = decodeVendorPreflightRecordV1(
        JSON.parse(readFileSync(path, "utf8")),
      );
      assert.ok(!isVendorPreflightContractFailure(decoded));
      assert.equal(decoded.facts.authenticated.value, "unknown");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("with --lane persists only that vendor", async () => {
    const home = tempHome();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            codexAuthStdout: "Not logged in\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.ok(existsSync(resolvePreflightRecordPath(home, "grok")));
      assert.equal(
        existsSync(resolvePreflightRecordPath(home, "codex")),
        false,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("without --lane persists both grok and codex", async () => {
    const home = tempHome();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(["--profile", "soft"], io, {
          repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            codexAuthStdout: "Not logged in\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.ok(existsSync(resolvePreflightRecordPath(home, "grok")));
      assert.ok(existsSync(resolvePreflightRecordPath(home, "codex")));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fail-closed exit 3 when requested vendor has no captured record (empty capability table)", async () => {
    const home = tempHome();
    const io = captureIo();
    const emptyTable: VendorCapabilityTableV1 = {
      schemaVersion: 1,
      capabilities: [],
    };
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
          capabilityTable: emptyTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      assert.doesNotMatch(io.stdout, /SETUP: NOT-READY/);
      assert.match(io.stderr, /boundary|missing|preflight|record/i);
      assert.doesNotMatch(io.stderr, /\/home\/|\\\\Users\\\\|stack|Error:/i);
      assert.equal(
        existsSync(resolvePreflightRecordPath(home, "grok")),
        false,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fail-closed exit 3 on store write failure; never SETUP: READY", async () => {
    const home = tempHome();
    const io = captureIo();
    const failStore = Layer.succeed(PreflightRecordStore, {
      read: () => Effect.fail(new PreflightStoreFailure("absent")),
      write: () => Effect.fail(new PreflightStoreFailure("write_failed")),
    });
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: failStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      assert.match(io.stderr, /preflight|persist|boundary/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("invalid arguments exit 2 without SETUP line", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runForemanSetup(["--lane", "claude"], io, {
        repoRoot: "/tmp",
        capabilityTable,
        ensureLauncher: () => Effect.succeed({ ok: true as const }),
      }),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.doesNotMatch(io.stdout, /SETUP:/);
    assert.match(io.stderr, /usage:|lane|claude|invalid/i);
  });

  it("help exits 0 with usage", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runForemanSetup(["--help"], io, {
        repoRoot: "/tmp",
        capabilityTable,
      }),
    );
    assert.equal(code, EXIT_READY);
    assert.match(io.stdout, /usage:/);
    assert.equal(USAGE.includes("foreman-setup"), true);
  });

  it("prints durable.enabled=false warning without rewriting config", async () => {
    const home = tempHome();
    const repo = mkdtempSync(join(tmpdir(), "foreman-setup-repo-"));
    const io = captureIo();
    try {
      mkdirSync(join(repo, ".foreman"), { recursive: true });
      const cfg = join(repo, ".foreman/config.toml");
      writeFileSync(cfg, "[durable]\nenabled = false\n", "utf8");
      const before = readFileSync(cfg, "utf8");
      await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
        }),
      );
      assert.match(io.stdout, /durable\.enabled=false/);
      assert.match(io.stdout, /differs from the shipped/);
      assert.equal(readFileSync(cfg, "utf8"), before);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("lane ready when grok ok reports SETUP: READY even if other must-tools fail", async () => {
    const home = tempHome();
    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: join(tmpdir(), "foreman-setup-repo-missing"),
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_READY);
      assert.match(io.stdout, /SETUP: READY/);
      assert.match(io.stdout, /LANE_READY: grok=yes/);
      const path = resolvePreflightRecordPath(home, "grok");
      assert.ok(existsSync(path));
      const decoded = decodeVendorPreflightRecordV1(
        JSON.parse(readFileSync(path, "utf8")),
      );
      assert.ok(!isVendorPreflightContractFailure(decoded));
      assert.equal(decoded.facts.authenticated.value, "authenticated");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("USAGE constant", () => {
  it("documents profile and lane flags", () => {
    assert.match(USAGE, /--profile soft\|hard\|full/);
    assert.match(USAGE, /--lane grok\|codex/);
  });
});
